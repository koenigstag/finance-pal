import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Repository } from 'typeorm';
import { z } from 'zod';
import { ApiKey, Profile } from '@ft/api-database';
import { effectiveRates, isValidTimezone } from '@ft/shared-contracts';
import type { RequestApiKey } from '../../_core/authn/request-user';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { AccountsService } from '../../ledger/accounts/accounts.service';
import { BudgetsService } from '../../ledger/budgets/budgets.service';
import { CategoriesService } from '../../ledger/categories/categories.service';
import { ExchangeRatesService } from '../../ledger/exchange-rates/exchange-rates.service';
import { OverviewService } from '../../ledger/overview/overview.service';
import { TransactionsService } from '../../ledger/transactions/transactions.service';
import { ExternalLookupService } from '../external-lookup.service';
import { currentMonth, daysCounted, localDay, monthPeriod, rangePeriod, readBound, type Period } from './mcp-dates';
import { transactionDescriber } from './mcp-describe';
import { Converter, accountsReport, budgetReport, categoryTree, moneyByCategory, type ReportContext } from './mcp-reports';
import {
  READS,
  ToolInputError,
  can,
  dayArg,
  findByNameOrId,
  monthArg,
  timeZoneArg,
  timeZoneOf,
  toolHandler,
  type McpContext,
} from './mcp-tool';
import { McpWriteTools } from './mcp-write-tools';

/**
 * The MCP endpoint's server: tools an AI assistant uses to answer questions about one group's
 * money — accounts, categories, transactions, budgets — as the key's owner sees them, and only
 * within the key's scopes. A tool the key has no scope for isn't offered at all.
 *
 * Every tool goes through the ledger's own services, under the request's RLS transaction, so an
 * assistant sees and does exactly what its owner could in the app. The tools here read; those that
 * write are McpWriteTools', offered only to a key with scopes beyond viewing.
 */
@Injectable()
export class FinanceMcpService {
  private readonly tool = toolHandler(new Logger('McpTools'));

  constructor(
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    private readonly abilities: AbilityFactory,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly transactions: TransactionsService,
    private readonly budgets: BudgetsService,
    private readonly overview: OverviewService,
    private readonly rates: ExchangeRatesService,
    private readonly lookup: ExternalLookupService,
    private readonly writes: McpWriteTools,
  ) {}

  /** A server for one request: the transport is stateless, so each request gets its own. */
  async serverFor(apiKey: RequestApiKey): Promise<McpServer> {
    // One after another: the request's RLS transaction holds a single connection.
    const key = await this.apiKeys.findOneByOrFail({ id: apiKey.id });
    const { groupName } = await this.abilities.forGroup(apiKey.userId, apiKey.groupId);
    const profile = await this.profiles.findOneBy({ id: apiKey.userId });
    const context: McpContext = {
      apiKey,
      groupName,
      timeZone: key.timeZone && isValidTimezone(key.timeZone) ? key.timeZone : 'UTC',
      mainCurrencyId: profile?.mainCurrencyId ?? null,
      manualRates: profile?.exchangeRates ?? null,
      currencies: await this.lookup.currencyCodes(),
    };

    const server = new McpServer(
      { name: 'finance-pal', title: 'Finance Pal', version: '1.0.0' },
      { instructions: instructionsFor(context) },
    );
    if (can(context, 'accounts:read')) {
      this.addAccountTools(server, context);
    }
    if (can(context, 'categories:read')) {
      this.addCategoryTools(server, context);
    }
    if (can(context, 'transactions:read')) {
      this.addTransactionTools(server, context);
    }
    if (can(context, 'budgets:read')) {
      this.addBudgetTools(server, context);
    }
    this.writes.register(server, context);
    return server;
  }

  private addAccountTools(server: McpServer, context: McpContext): void {
    server.registerTool(
      'list_accounts',
      {
        title: 'List accounts',
        description:
          "The group's accounts with their balances, in each account's own currency, and the group's total in the main currency: " +
          'the accounts marked to count in it, as the app shows it. A balance leaves out transactions dated later (planned ones); ' +
          'plannedBalance, where it differs, counts them in. Types: regular, savings, debt.',
        inputSchema: { includeArchived: z.boolean().optional().describe('Also list accounts put away in the archive') },
        annotations: READS,
      },
      this.tool(async ({ includeArchived }) => {
        const report = await this.reportContext(context);
        const accounts = await this.accounts.list(context.apiKey.userId, context.apiKey.groupId, includeArchived ?? false);
        return accountsReport(accounts, report);
      }),
    );
  }

  private addCategoryTools(server: McpServer, context: McpContext): void {
    server.registerTool(
      'list_categories',
      {
        title: 'List categories',
        description:
          'Expense and income categories in the order the app lists them, each with its subcategories. ' +
          "A transaction is filed under a top-level category and, optionally, one of its subcategories; a category's totals take in its subcategories'.",
        inputSchema: {
          type: z.enum(['expense', 'income']).optional().describe('Only categories of this type'),
          includeArchived: z.boolean().optional().describe('Also list categories put away in the archive'),
        },
        annotations: READS,
      },
      this.tool(async ({ type, includeArchived }) => {
        const categories = await this.categories.list(context.apiKey.userId, context.apiKey.groupId, includeArchived ?? false);
        return categoryTree(type ? categories.filter((category) => category.type === type) : categories);
      }),
    );
  }

  private addTransactionTools(server: McpServer, context: McpContext): void {
    server.registerTool(
      'search_transactions',
      {
        title: 'Search transactions',
        description:
          'Transactions, newest first, a page at a time, filtered by any of: dates, type, account, category, text in the note. ' +
          'Each one comes with its account and category names, its local date and time, and planned: true when it is dated later ' +
          '(scheduled, not happened yet). A transfer moves money between two accounts: received is what arrived when their currencies differ. ' +
          'To total money up, use summarize_by_category instead of adding pages up.',
        inputSchema: {
          from: dayArg('The earliest'),
          to: dayArg('The latest'),
          type: z.enum(['expense', 'income', 'transfer']).optional(),
          account: z.string().optional().describe('An account, by name or id: transactions on it, transfers into it included'),
          category: z
            .string()
            .optional()
            .describe('A category or subcategory, by name or id. A category takes in its subcategories'),
          note: z.string().optional().describe('Text the note contains, ignoring case'),
          limit: z.number().int().min(1).max(200).optional().describe('How many per page; 50 when left out'),
          cursor: z.string().optional().describe("The previous page's nextCursor, for the page after it"),
          timeZone: timeZoneArg,
        },
        annotations: READS,
      },
      this.tool(async (args) => {
        const timeZone = timeZoneOf(context, args.timeZone);
        const { userId, groupId } = context.apiKey;
        const accounts = await this.lookup.accountsOf(groupId);
        const categories = await this.lookup.categoriesOf(groupId);
        const page = await this.transactions.list(userId, groupId, {
          dateFrom: args.from ? readBound(args.from, timeZone, 'start').toISOString() : undefined,
          dateTo: args.to ? readBound(args.to, timeZone, 'end').toISOString() : undefined,
          type: args.type,
          accountId: args.account ? findByNameOrId(accounts, args.account, 'account').id : undefined,
          categoryId: args.category ? findByNameOrId(categories, args.category, 'category').id : undefined,
          search: args.note,
          limit: args.limit,
          cursor: args.cursor,
        });
        const describe = transactionDescriber(accounts, categories, context.currencies, timeZone, new Date());
        return { timeZone, transactions: page.items.map(describe), nextCursor: page.nextCursor };
      }),
    );

    server.registerTool(
      'summarize_by_category',
      {
        title: 'Summarize spending and income',
        description:
          'What was spent and received over a month or between two dates, as the app\'s overview shows it: per top-level category ' +
          "and per debt account, largest first, with each one's share, the total, and averages per day and per week over the days " +
          'that have come. In the main currency, at current rates. Only what is dated up to now counts. Transfers between the ' +
          "group's own accounts count as neither; one into a debt account (lending, paying a loan off) counts as spent, one out of " +
          'it (borrowing) as received.',
        inputSchema: {
          month: monthArg,
          from: dayArg('Instead of month: the first day'),
          to: dayArg('Instead of month: the last day'),
          type: z.enum(['expense', 'income']).optional().describe('Only spending, or only income; both when left out'),
          byDay: z.boolean().optional().describe('Also give the total of each day'),
          timeZone: timeZoneArg,
        },
        annotations: READS,
      },
      this.tool(async (args) => {
        const timeZone = timeZoneOf(context, args.timeZone);
        const period = this.periodOf(args, timeZone);
        const report = await this.reportContext(context);
        const { userId, groupId } = context.apiKey;
        const days = await this.overview.days(userId, groupId, {
          dateFrom: period.from.toISOString(),
          dateTo: period.to.toISOString(),
          timezone: timeZone,
        });
        const names = {
          categories: await this.lookup.categoriesOf(groupId),
          accounts: await this.lookup.accountsOf(groupId),
          daysSoFar: daysCounted(period, new Date(), timeZone),
          withDays: args.byDay ?? false,
        };
        return {
          period: { from: period.firstDay, to: period.lastDay, timeZone, daysSoFar: names.daysSoFar },
          currency: report.codeOf(report.mainCurrencyId),
          ...(args.type !== 'income' && { spent: moneyByCategory(days, 'expense', names, report) }),
          ...(args.type !== 'expense' && { received: moneyByCategory(days, 'income', names, report) }),
          currenciesWithoutRate: report.converter.missingCurrencies,
        };
      }),
    );
  }

  private addBudgetTools(server: McpServer, context: McpContext): void {
    server.registerTool(
      'get_budget',
      {
        title: 'Get the budget for a month',
        description:
          "A month's budget as the app's budget page shows it. Each line is an amount meant for an expense or income category " +
          '(its subcategories count toward it) or for a savings or debt account, beside what was recorded against it so far, ' +
          'what is planned (dated later in the month), and what remains — below zero when the line is past its amount. For an ' +
          "account, recorded is how much its balance changed: money put in less money taken out. Each section's total is in the " +
          'main currency, and notInBudget is the money in categories with no line. Months are set one at a time: a month nobody ' +
          'set has no lines.',
        inputSchema: { month: monthArg, timeZone: timeZoneArg },
        annotations: READS,
      },
      this.tool(async (args) => {
        const timeZone = timeZoneOf(context, args.timeZone);
        const month = args.month ?? currentMonth(new Date(), timeZone);
        const period = monthPeriod(month, timeZone);
        const report = await this.reportContext(context);
        const { userId, groupId } = context.apiKey;
        const lines = await this.budgets.list(userId, groupId, month);
        const totals = await this.budgets.totals(userId, groupId, period.from.toISOString(), period.to.toISOString());
        const names = { categories: await this.lookup.categoriesOf(groupId), accounts: await this.lookup.accountsOf(groupId) };
        return { month, timeZone, currency: report.codeOf(report.mainCurrencyId), ...budgetReport(lines, totals, names, report) };
      }),
    );
  }

  private periodOf(args: { month?: string; from?: string; to?: string }, timeZone: string): Period {
    if (args.from !== undefined || args.to !== undefined) {
      if (args.month !== undefined || args.from === undefined || args.to === undefined) {
        throw new ToolInputError('Give a month, or both from and to');
      }
      return rangePeriod(args.from, args.to, timeZone);
    }
    return monthPeriod(args.month ?? currentMonth(new Date(), timeZone), timeZone);
  }

  // What reports convert into, at the rates the app uses: the provider's, and the owner's own for a
  // currency no provider quotes.
  private async reportContext(context: McpContext): Promise<ReportContext> {
    if (context.mainCurrencyId === null) {
      throw new ToolInputError('The owner of this key has to finish setting up their profile in the app first: totals are in its main currency');
    }
    const codeOf = (currencyId: number) => context.currencies.of(currencyId);
    const base = codeOf(context.mainCurrencyId);
    let fetched: { base: string; rates: Record<string, string> } | undefined;
    try {
      const snapshot = await this.rates.getRates(base);
      fetched = { base: snapshot.baseCode, rates: snapshot.rates };
    } catch (error) {
      // No provider answers and nothing is cached: totals then take what needs no rate, and say so.
      if (!(error instanceof ServiceUnavailableException)) {
        throw error;
      }
    }
    return {
      codeOf,
      mainCurrencyId: context.mainCurrencyId,
      converter: new Converter(codeOf, effectiveRates(base, fetched, context.manualRates)),
    };
  }
}

function instructionsFor(context: McpContext): string {
  const { groupName, timeZone, mainCurrencyId, currencies, apiKey } = context;
  const main = mainCurrencyId === null ? null : currencies.of(mainCurrencyId);
  const writes = apiKey.scopes.some((scope) => !scope.endsWith(':read'));
  const lines = [
    writes
      ? `Finance Pal, a money tracker. These tools work in the group "${groupName}", as its member who connected them. Some of them change it: add, update and delete what the person asks for, and say what you changed. Deleting can't be undone in the app. Transactions can only be added, changed or deleted while planned, dated after now; ones that already happened are the person's to change in the app.`
      : `Finance Pal, a money tracker. These tools read the group "${groupName}", as its member who connected them sees it, and change nothing.`,
    'Amounts are decimal strings, each beside its currency (an ISO 4217 code).' +
      (main ? ` Totals are in the main currency, ${main}, converted at current rates; a currency with no rate is left out of a total and named in currenciesWithoutRate.` : ''),
    `Dates are read and given in ${timeZone} unless a call names another timeZone; today there is ${localDay(new Date(), timeZone)}.`,
    'Transactions dated after now are planned: scheduled, or the next of a repeating series. Balances and totals count what is dated up to now, unless they say otherwise.',
    'Accounts and categories can be named by their name or their id.',
  ];
  if (apiKey.scopes.length === 0) {
    lines.push('This key may do nothing, so there are no tools to call.');
  }
  return lines.join('\n');
}
