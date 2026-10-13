import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ServerInferRequest } from '@ts-rest/core';
import { z } from 'zod';
import type { Transaction } from '@ft/api-database';
import type { externalContract } from '@ft/shared-contracts';
import { AccountsService, type UpdateAccountInput } from '../../ledger/accounts/accounts.service';
import { BudgetsService } from '../../ledger/budgets/budgets.service';
import { CategoriesService, type UpdateCategoryInput } from '../../ledger/categories/categories.service';
import { TransactionsService } from '../../ledger/transactions/transactions.service';
import { ExternalLookupService } from '../external-lookup.service';
import { ExternalTransactionsService } from '../external-transactions.service';
import { findParentId } from '../references';
import { currentMonth, transactionMoment } from './mcp-dates';
import { amountSourceOf, describeAccount, describeBudgetLine, describeCategory, transactionDescriber } from './mcp-describe';
import {
  ADDS,
  CHANGES,
  DELETES,
  ToolInputError,
  amountArg,
  amountOf,
  can,
  findByNameOrId,
  idOrName,
  monthArg,
  timeZoneArg,
  timeZoneOf,
  toolHandler,
  type McpContext,
} from './mcp-tool';

type UpdateTransactionBody = ServerInferRequest<typeof externalContract.transactions.update>['body'];

const nameArg = z.string().trim().min(1).max(120);
const accountTypeArg = z.enum(['regular', 'savings', 'debt']);
const currencyArg = z
  .string()
  .regex(/^[A-Za-z]{3}$/)
  .transform((code) => code.toUpperCase());
const DATE_HELP = 'YYYY-MM-DD, or a date and time with an offset; it must lie after now. A day to come is dated at noon, as the app dates one';

/**
 * The MCP endpoint's tools that change a group: adding, updating and deleting transactions,
 * accounts and categories, and setting a month's budget. Each needs its own scope — a key gets
 * none of them by viewing — and goes through the same service as the app, so a role, a validation
 * rule or a live update can't differ between the two. Transactions go through the external API's
 * own service, which reads accounts and categories by name and dates and prices them as the app
 * does.
 *
 * Transactions are written only while planned, dated after now: an assistant schedules, moves and
 * calls off payments to come, and what has happened — the history balances are reconciled against
 * — stays the person's to change in the app. For the same reason an account with transactions that
 * already happened isn't deleted here.
 */
@Injectable()
export class McpWriteTools {
  private readonly tool = toolHandler(new Logger('McpTools'));

  constructor(
    private readonly external: ExternalTransactionsService,
    private readonly transactions: TransactionsService,
    private readonly accounts: AccountsService,
    private readonly categories: CategoriesService,
    private readonly budgets: BudgetsService,
    private readonly lookup: ExternalLookupService,
  ) {}

  register(server: McpServer, context: McpContext): void {
    if (can(context, 'transactions:create')) {
      this.addTransaction(server, context);
    }
    if (can(context, 'transactions:update')) {
      this.updateTransaction(server, context);
    }
    if (can(context, 'transactions:delete')) {
      this.deleteTransaction(server, context);
    }
    if (can(context, 'accounts:create')) {
      this.addAccount(server, context);
    }
    if (can(context, 'accounts:update')) {
      this.updateAccount(server, context);
    }
    // Deleting an account deletes its transactions, which takes the scope for that too.
    if (can(context, 'accounts:delete') && can(context, 'transactions:delete')) {
      this.deleteAccount(server, context);
    }
    if (can(context, 'categories:create')) {
      this.addCategory(server, context);
    }
    if (can(context, 'categories:update')) {
      this.updateCategory(server, context);
    }
    if (can(context, 'categories:delete')) {
      this.deleteCategory(server, context);
    }
    if (can(context, 'budgets:create') || can(context, 'budgets:update')) {
      this.setBudget(server, context);
    }
    if (can(context, 'budgets:delete')) {
      this.removeBudgetLine(server, context);
    }
  }

  private addTransaction(server: McpServer, context: McpContext): void {
    server.registerTool(
      'add_transaction',
      {
        title: 'Add a transaction',
        description:
          'Plan an expense, an income or a transfer: one dated after now, in the currency of the account it is on. Only planned ' +
          'transactions can be added here, not ones that already happened. Name accounts and categories as the app calls them, ' +
          "or by id. Left out, the account is the group's favourite one. An expense or income in a category with its own " +
          'currency also gets its amount in that currency, at the current rate.',
        inputSchema: {
          type: z.enum(['expense', 'income', 'transfer']),
          amount: amountArg.describe('Above zero, like 85, "85.50" or "1 250,50"'),
          date: z.string().describe(DATE_HELP),
          account: z.string().optional().describe('The account the money leaves, or arrives in for an income'),
          toAccount: z.string().optional().describe('Transfers only, and required there: where the money goes'),
          received: amountArg
            .optional()
            .describe('Transfers between accounts in different currencies: what arrived. Left out, converted at the current rate'),
          category: z.string().optional().describe('Expenses and income: a category of that type, or a subcategory'),
          subcategory: z.string().optional().describe("One of the category's subcategories"),
          note: z.string().max(1000).optional(),
          timeZone: timeZoneArg,
        },
        annotations: ADDS,
      },
      this.tool(async (args) => {
        const timeZone = timeZoneOf(context, args.timeZone);
        const account = args.account ? idOrName(args.account) : {};
        const toAccount = args.toAccount ? idOrName(args.toAccount) : {};
        const category = args.category ? idOrName(args.category) : {};
        const subcategory = args.subcategory ? idOrName(args.subcategory) : {};
        const date = plannedMoment(args.date, timeZone);
        const { transaction } = await this.external.create(context.apiKey, {
          type: args.type,
          amount: amountOf(args.amount),
          date: date.toISOString(),
          accountId: account.id,
          accountName: account.name,
          toAccountId: toAccount.id,
          toAccountName: toAccount.name,
          destAmount: args.received === undefined ? undefined : amountOf(args.received, 'received'),
          categoryId: category.id,
          categoryName: category.name,
          subcategoryId: subcategory.id,
          subcategoryName: subcategory.name,
          note: args.note,
        });
        return { added: await this.describeTransaction(context, transaction, timeZone) };
      }),
    );
  }

  private updateTransaction(server: McpServer, context: McpContext): void {
    server.registerTool(
      'update_transaction',
      {
        title: 'Update a transaction',
        description:
          'Change a planned transaction (one dated after now) found with search_transactions; one that already happened can ' +
          'only be changed in the app. Only what the call names changes; its type stays, and a new date must lie after now too. ' +
          'An amount the app works out (amountFrom in search_transactions) can only be changed in the app, by changing how it is worked out. ' +
          'A new category drops a subcategory the call does not name again, null clears the category or the subcategory, and ' +
          'an empty note clears the note.',
        inputSchema: {
          id: z.string().uuid().describe("The transaction's id"),
          amount: amountArg.optional(),
          date: z.string().optional().describe(DATE_HELP),
          account: z.string().optional(),
          toAccount: z.string().optional().describe('Transfers only'),
          received: amountArg.optional().describe('Transfers between accounts in different currencies: what arrived'),
          category: z.string().nullable().optional(),
          subcategory: z.string().nullable().optional(),
          note: z.string().max(1000).optional(),
          timeZone: timeZoneArg,
        },
        annotations: CHANGES,
      },
      this.tool(async (args) => {
        const timeZone = timeZoneOf(context, args.timeZone);
        // Also the 404 for a transaction that isn't there.
        const existing = await this.plannedTransaction(context, args.id);
        const body: UpdateTransactionBody = {};
        if (args.amount !== undefined) {
          const { amountFrom } = amountSourceOf(existing, context.currencies);
          if (amountFrom) {
            // The app would work the amount out again at once, from the balance or the base: a typed
            // one wouldn't hold, and the call would look as if it had.
            throw new ToolInputError(
              `This amount is worked out by the app (${JSON.stringify(amountFrom)}), so a typed one wouldn't hold; how it's worked out can only be changed in the app`,
            );
          }
          body.amount = amountOf(args.amount);
        }
        if (args.date !== undefined) {
          body.date = plannedMoment(args.date, timeZone, existing.date).toISOString();
        }
        if (args.account !== undefined) {
          const { id, name } = idOrName(args.account);
          Object.assign(body, { accountId: id, accountName: name });
        }
        if (args.toAccount !== undefined) {
          const { id, name } = idOrName(args.toAccount);
          Object.assign(body, { toAccountId: id, toAccountName: name });
        }
        if (args.received !== undefined) {
          body.destAmount = amountOf(args.received, 'received');
        }
        if (args.category !== undefined) {
          Object.assign(body, args.category === null ? { categoryId: null } : named('category', args.category));
        }
        if (args.subcategory !== undefined) {
          Object.assign(body, args.subcategory === null ? { subcategoryId: null } : named('subcategory', args.subcategory));
        }
        if (args.note !== undefined) {
          body.note = args.note;
        }
        if (Object.keys(body).length === 0) {
          throw new ToolInputError('Name at least one thing to change');
        }
        const transaction = await this.external.update(context.apiKey, args.id, body);
        return { updated: await this.describeTransaction(context, transaction, timeZone) };
      }),
    );
  }

  private deleteTransaction(server: McpServer, context: McpContext): void {
    server.registerTool(
      'delete_transaction',
      {
        title: 'Delete a transaction',
        description:
          'Delete a planned transaction (one dated after now) found with search_transactions; one that already happened can only ' +
          "be deleted in the app. The app can't undo it, so only delete what the person asked to. Deleting the planned " +
          'transaction of a repeating series leaves the series going.',
        inputSchema: { id: z.string().uuid().describe("The transaction's id") },
        annotations: DELETES,
      },
      this.tool(async ({ id }) => {
        await this.plannedTransaction(context, id);
        const { transaction } = await this.transactions.remove(context.apiKey.userId, context.apiKey.groupId, id);
        return { deleted: await this.describeTransaction(context, transaction, context.timeZone) };
      }),
    );
  }

  private addAccount(server: McpServer, context: McpContext): void {
    server.registerTool(
      'add_account',
      {
        title: 'Add an account',
        description:
          'Create an account, starting at a balance of zero: record what is in it as an income. Its transactions are all in its currency, which never changes.',
        inputSchema: {
          name: nameArg,
          currency: currencyArg.optional().describe('ISO 4217, like UAH. Left out, the main currency'),
          type: accountTypeArg.optional().describe('Left out, regular. Savings and debt accounts can be budgeted for'),
          description: z.string().max(1000).optional(),
          countedInTotal: z.boolean().optional().describe("Whether it counts in the group's total; left out, it does"),
          favourite: z.boolean().optional().describe('Where new transactions start; marking one unmarks the others'),
        },
        annotations: ADDS,
      },
      this.tool(async (args) => {
        const currencyId = args.currency ? await this.lookup.currencyIdOf(args.currency) : context.mainCurrencyId;
        if (currencyId === null) {
          throw new ToolInputError('Name a currency: the owner of this key has no main currency set up yet');
        }
        const created = await this.accounts.create(context.apiKey.userId, context.apiKey.groupId, {
          name: args.name,
          currencyId,
          type: args.type,
          description: args.description,
          isIncludedInBalance: args.countedInTotal,
          isFavourite: args.favourite,
        });
        return { added: describeAccount(created, context.currencies) };
      }),
    );
  }

  private updateAccount(server: McpServer, context: McpContext): void {
    server.registerTool(
      'update_account',
      {
        title: 'Update an account',
        description:
          'Rename an account, change its type or description, whether it counts in the total or is the favourite, or put it ' +
          'away in the archive and take it back out. Its currency stays. Turning a savings or debt account regular takes it ' +
          'out of the budget.',
        inputSchema: {
          account: z.string().describe('By name or id'),
          name: nameArg.optional(),
          type: accountTypeArg.optional(),
          description: z.string().max(1000).optional().describe('An empty one clears it'),
          countedInTotal: z.boolean().optional(),
          favourite: z.boolean().optional(),
          archived: z.boolean().optional().describe('true puts it away, false brings it back'),
        },
        annotations: CHANGES,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const account = findByNameOrId(await this.lookup.accountsOf(groupId), args.account, 'account');
        const patch: UpdateAccountInput = {};
        if (args.name !== undefined) {
          patch.name = args.name;
        }
        if (args.type !== undefined) {
          patch.type = args.type;
        }
        if (args.description !== undefined) {
          patch.description = args.description;
        }
        if (args.countedInTotal !== undefined) {
          patch.isIncludedInBalance = args.countedInTotal;
        }
        if (args.favourite !== undefined) {
          patch.isFavourite = args.favourite;
        }
        if (Object.keys(patch).length === 0 && args.archived === undefined) {
          throw new ToolInputError('Name at least one thing to change');
        }
        if (Object.keys(patch).length > 0) {
          await this.accounts.update(userId, groupId, account.id, patch);
        }
        if (args.archived === true && !account.archived) {
          await this.accounts.archive(userId, groupId, account.id);
        } else if (args.archived === false && account.archived) {
          await this.accounts.restore(userId, groupId, account.id);
        }
        return { updated: describeAccount(await this.accounts.get(userId, groupId, account.id), context.currencies) };
      }),
    );
  }

  private deleteAccount(server: McpServer, context: McpContext): void {
    server.registerTool(
      'delete_account',
      {
        title: 'Delete an account',
        description:
          'Delete an account that has no transactions that already happened, with what it has planned: its planned ' +
          "transactions, its repeating series and its budget lines. The app can't undo it, so only delete what the person " +
          'asked to. An account with a history can only be deleted in the app; archive it with update_account instead. The ' +
          'answer counts what went with it.',
        inputSchema: { account: z.string().describe('By name or id') },
        annotations: DELETES,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const account = findByNameOrId(await this.lookup.accountsOf(groupId), args.account, 'account');
        const usage = await this.accounts.usage(userId, groupId, account.id);
        if (usage.transactionCount > 0) {
          throw new ToolInputError(
            `"${account.name}" has ${usage.transactionCount} transactions that already happened, so it can only be deleted in the app; archive it instead`,
          );
        }
        const deleted = await this.accounts.remove(userId, groupId, account.id);
        return {
          deleted: describeAccount(deleted, context.currencies),
          deletedWithIt: {
            plannedTransactions: usage.plannedTransactionCount,
            repeatingSeries: usage.recurringRuleCount,
            budgetLines: usage.budgetCount,
          },
        };
      }),
    );
  }

  private addCategory(server: McpServer, context: McpContext): void {
    server.registerTool(
      'add_category',
      {
        title: 'Add a category',
        description:
          'Create an expense or income category, or a subcategory of a top-level one of the same type. Categories are two levels ' +
          'deep. A top-level category may have a currency of its own, which its subcategories share.',
        inputSchema: {
          name: nameArg,
          type: z.enum(['expense', 'income']),
          parent: z.string().optional().describe('Makes it a subcategory of this top-level category, by name or id'),
          currency: currencyArg.optional().describe('Top-level only: ISO 4217, like USD'),
        },
        annotations: ADDS,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const categories = await this.lookup.categoriesOf(groupId);
        const parent = args.parent ? idOrName(args.parent) : {};
        const created = await this.categories.create(userId, groupId, {
          name: args.name,
          type: args.type,
          parentId: args.parent ? findParentId(categories, args.type, parent.id, parent.name) : undefined,
          currencyId: args.currency ? await this.lookup.currencyIdOf(args.currency) : undefined,
        });
        return { added: describeCategory(created, categories, context.currencies) };
      }),
    );
  }

  private updateCategory(server: McpServer, context: McpContext): void {
    server.registerTool(
      'update_category',
      {
        title: 'Update a category',
        description:
          'Rename a category, move it under another top-level one or back to the top (parent null), change or clear its ' +
          'currency, or put it away in the archive and take it back out (with its subcategories). Its type stays, and its ' +
          'currency can only change while nothing is filed under it.',
        inputSchema: {
          category: z.string().describe('By name or id'),
          name: nameArg.optional(),
          parent: z.string().nullable().optional().describe('A top-level category of the same type, or null for the top level'),
          currency: currencyArg.nullable().optional().describe('Top-level only; null clears it'),
          archived: z.boolean().optional().describe('true puts it away, false brings it back'),
        },
        annotations: CHANGES,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const categories = await this.lookup.categoriesOf(groupId);
        const category = findByNameOrId(categories, args.category, 'category');
        const patch: UpdateCategoryInput = {};
        if (args.name !== undefined) {
          patch.name = args.name;
        }
        if (args.parent !== undefined) {
          const parent = args.parent === null ? {} : idOrName(args.parent);
          patch.parentId = args.parent === null ? null : findParentId(categories, category.type, parent.id, parent.name);
        }
        if (args.currency !== undefined) {
          patch.currencyId = args.currency === null ? null : await this.lookup.currencyIdOf(args.currency);
        }
        if (Object.keys(patch).length === 0 && args.archived === undefined) {
          throw new ToolInputError('Name at least one thing to change');
        }
        if (Object.keys(patch).length > 0) {
          await this.categories.update(userId, groupId, category.id, patch);
        }
        if (args.archived === true && !category.archived) {
          await this.categories.archive(userId, groupId, category.id);
        } else if (args.archived === false && category.archived) {
          await this.categories.restore(userId, groupId, category.id);
        }
        const updated = await this.categories.get(userId, groupId, category.id);
        return { updated: describeCategory(updated, categories, context.currencies) };
      }),
    );
  }

  private deleteCategory(server: McpServer, context: McpContext): void {
    server.registerTool(
      'delete_category',
      {
        title: 'Delete a category',
        description:
          'Delete a category with its subcategories. Transactions and repeating series filed under it keep their money and lose ' +
          "the category (a subcategory's stay in its parent); its rules and budget lines go. The app can't undo it, so only " +
          'delete what the person asked to; to keep it for old transactions, archive it with update_category instead.',
        inputSchema: { category: z.string().describe('By name or id') },
        annotations: DELETES,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const categories = await this.lookup.categoriesOf(groupId);
        const category = findByNameOrId(categories, args.category, 'category');
        const usage = await this.categories.usage(userId, groupId, category.id);
        const deleted = await this.categories.remove(userId, groupId, category.id);
        return {
          deleted: describeCategory(deleted, categories, context.currencies),
          deletedWithIt: { subcategories: usage.subcategoryCount, categoryRules: usage.categoryRuleCount, budgetLines: usage.budgetCount },
          keptWithoutIt: {
            transactions: usage.transactionCount + usage.plannedTransactionCount,
            repeatingSeries: usage.recurringRuleCount,
          },
        };
      }),
    );
  }

  private setBudget(server: McpServer, context: McpContext): void {
    server.registerTool(
      'set_budget',
      {
        title: "Set a month's budget line",
        description:
          'Set how much is meant for a top-level expense or income category, or a savings or debt account, in a month: adds the ' +
          "line, or changes the one it has. A category's amount is in the main currency, an account's in its own. Each month is " +
          'set on its own, nothing carries over.',
        inputSchema: {
          month: monthArg,
          category: z.string().optional().describe('A top-level category, by name or id; or account instead'),
          account: z.string().optional().describe('A savings or debt account, by name or id'),
          amount: amountArg.describe('Above zero'),
          timeZone: timeZoneArg,
        },
        annotations: CHANGES,
      },
      this.tool(async (args) => {
        const { userId, groupId } = context.apiKey;
        const { month, target, line } = await this.budgetLineFor(context, args);
        const amount = amountOf(args.amount);
        if (line) {
          if (!can(context, 'budgets:update')) {
            throw new ToolInputError(`"${target.name}" has a line in ${month} already, and this key may only add new ones`);
          }
          const updated = await this.budgets.update(userId, groupId, line.id, amount);
          return { changed: describeBudgetLine(updated, target.name, context.currencies) };
        }
        if (!can(context, 'budgets:create')) {
          throw new ToolInputError(`"${target.name}" has no line in ${month}, and this key may only change existing ones`);
        }
        const created = await this.budgets.create(userId, groupId, {
          month,
          ...(target.kind === 'category' ? { categoryId: target.id } : { accountId: target.id }),
          amount,
        });
        return { added: describeBudgetLine(created, target.name, context.currencies) };
      }),
    );
  }

  private removeBudgetLine(server: McpServer, context: McpContext): void {
    server.registerTool(
      'remove_budget_line',
      {
        title: "Remove a month's budget line",
        description: "Take a category's or an account's line out of a month's budget. The money recorded stays as it is.",
        inputSchema: {
          month: monthArg,
          category: z.string().optional().describe('By name or id; or account instead'),
          account: z.string().optional().describe('By name or id'),
          timeZone: timeZoneArg,
        },
        annotations: DELETES,
      },
      this.tool(async (args) => {
        const { month, target, line } = await this.budgetLineFor(context, args);
        if (!line) {
          throw new ToolInputError(`"${target.name}" has no line in ${month}`);
        }
        const removed = await this.budgets.remove(context.apiKey.userId, context.apiKey.groupId, line.id);
        return { removed: describeBudgetLine(removed, target.name, context.currencies) };
      }),
    );
  }

  // The month a budget call is about, what it's for, and the line that has for it, if any.
  private async budgetLineFor(
    context: McpContext,
    args: { month?: string; category?: string; account?: string; timeZone?: string },
  ) {
    if ((args.category === undefined) === (args.account === undefined)) {
      throw new ToolInputError('Name a category or an account, one of the two');
    }
    const { userId, groupId } = context.apiKey;
    const month = args.month ?? currentMonth(new Date(), timeZoneOf(context, args.timeZone));
    const target =
      args.category !== undefined
        ? { kind: 'category' as const, ...findByNameOrId(await this.lookup.categoriesOf(groupId), args.category, 'category') }
        : { kind: 'account' as const, ...findByNameOrId(await this.lookup.accountsOf(groupId), args.account as string, 'account') };
    const lines = await this.budgets.list(userId, groupId, month);
    const line = lines.find((candidate) => (target.kind === 'category' ? candidate.categoryId : candidate.accountId) === target.id);
    return { month, target, line };
  }

  // The transaction a call is about, refused unless it's still planned.
  private async plannedTransaction(context: McpContext, id: string): Promise<Transaction> {
    const { transaction } = await this.transactions.get(context.apiKey.userId, context.apiKey.groupId, id);
    if (transaction.date <= new Date()) {
      throw new ToolInputError('That transaction already happened: only planned ones, dated after now, can be changed here');
    }
    return transaction;
  }

  // As search_transactions lists it, with the names it has after the change.
  private async describeTransaction(context: McpContext, transaction: Transaction, timeZone: string) {
    const { groupId } = context.apiKey;
    const describe = transactionDescriber({
      accounts: await this.lookup.accountsOf(groupId),
      categories: await this.lookup.categoriesOf(groupId),
      series: await this.lookup.seriesOf(groupId),
      currencies: context.currencies,
      timeZone,
      now: new Date(),
    });
    return describe(transaction);
  }
}

// When a call dates a transaction, which must lie after now: only planned ones are written here.
function plannedMoment(value: string, timeZone: string, previous?: Date): Date {
  const now = new Date();
  const moment = transactionMoment(value, timeZone, now, previous);
  if (moment <= now) {
    throw new ToolInputError(`${value} isn't after now: only planned transactions can be added or moved here`);
  }
  return moment;
}

// A category or subcategory as the external API's update body names one.
function named(field: 'category' | 'subcategory', value: string): Record<string, string | undefined> {
  const { id, name } = idOrName(value);
  return { [`${field}Id`]: id, [`${field}Name`]: name };
}
