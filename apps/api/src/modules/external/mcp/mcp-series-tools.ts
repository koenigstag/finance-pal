import { Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TZDate } from '@date-fns/tz';
import { z } from 'zod';
import type { RecurringRule } from '@ft/api-database';
import { RECURRENCE_UNITS, percentOf, seriesEndSchema } from '@ft/shared-contracts';
import {
  RecurringRulesService,
  type CreateRecurringRuleInput,
  type RecurringRuleView,
  type UpdateRecurringRuleInput,
} from '../../recurring/recurring-rules.service';
import { endsOnAfter, localDayOf, type Schedule } from '../../recurring/recurrence-dates';
import { ExternalLookupService } from '../external-lookup.service';
import { favouriteAccount, findAccount, namesCategory, resolveCategoryPair, type AccountLike } from '../references';
import { readBound } from './mcp-dates';
import { describeSeries } from './mcp-describe';
import {
  ADDS,
  CHANGES,
  DELETES,
  READS,
  ToolInputError,
  amountArg,
  amountOf,
  can,
  idOrName,
  timeZoneArg,
  timeZoneOf,
  toolHandler,
  type McpContext,
} from './mcp-tool';

const unitArg = z.enum(RECURRENCE_UNITS).describe('day, week, month or year');
const everyArg = z.number().int().min(1).max(366).describe('Every so many units: 2 with week is every other week');
const endsOnArg = z
  .string()
  .nullable()
  .optional()
  .describe('YYYY-MM-DD, the last day a payment may fall on; null never ends. Or give payments instead');
const paymentsArg = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe('Instead of endsOn: how many payments are left, the next one included; kept as the date the last one falls on');
const percentageArg = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .describe('Each payment is this percentage, above 0 and at most 100: of percentageOf, or of the account balance on its date');
const roundsArg = z
  .union([z.literal(1), z.literal(10), z.literal(100), z.literal(1000)])
  .nullable()
  .optional()
  .describe('Instead of an amount or a percentage: each payment is whatever leaves the balance on a multiple of this');

const DATE_HELP =
  'YYYY-MM-DD, or a date and time with an offset; it must lie after now. A day is dated at noon, and every payment comes at that time of day';

/**
 * The MCP endpoint's repeating series: listing them, and setting up, changing and ending them. A
 * series keeps one planned payment at a time, its next; a change applies from that payment on, what
 * already happened stays as it was, and so does a payment edited on its own. They go by the
 * transaction scopes: a series is a way of planning transactions.
 *
 * Like the transaction tools, these only plan: a series starts after now, and moves only to dates
 * after now. One started in the past would record every date since as having happened.
 */
@Injectable()
export class McpSeriesTools {
  private readonly tool = toolHandler(new Logger('McpTools'));

  constructor(
    private readonly series: RecurringRulesService,
    private readonly lookup: ExternalLookupService,
  ) {}

  register(server: McpServer, context: McpContext): void {
    if (can(context, 'transactions:read')) {
      this.listSeries(server, context);
    }
    if (can(context, 'transactions:create')) {
      this.addSeries(server, context);
    }
    if (can(context, 'transactions:update')) {
      this.updateSeries(server, context);
    }
    if (can(context, 'transactions:delete')) {
      this.endSeries(server, context);
    }
  }

  private listSeries(server: McpServer, context: McpContext): void {
    server.registerTool(
      'list_series',
      {
        title: 'List repeating series',
        description:
          'The repeating series: what each payment is, how often it comes, its next payment, and when it ends (endsOn; none ' +
          'runs on until ended). A series keeps one planned payment at a time, which search_transactions lists with its series ' +
          'id. ended: true is a series past its last day; paused: true one put on hold, with no next payment until resumed.',
        inputSchema: {
          includePaused: z.boolean().optional().describe('Also list paused series'),
          timeZone: timeZoneArg,
        },
        annotations: READS,
      },
      this.tool(async ({ includePaused, timeZone }) => {
        const zone = timeZoneOf(context, timeZone);
        const views = await this.series.list(context.apiKey.userId, context.apiKey.groupId, includePaused ?? false);
        const describe = await this.describer(context, zone);
        return { timeZone: zone, series: views.map(describe) };
      }),
    );
  }

  private addSeries(server: McpServer, context: McpContext): void {
    server.registerTool(
      'add_series',
      {
        title: 'Set up a repeating series',
        description:
          'Plan a repeating expense, income or transfer: a payment every so many days, weeks, months or years from its first ' +
          'date, which must lie after now, optionally ending on a day or after so many payments. Name accounts and categories ' +
          "as the app calls them, or by id; left out, the account is the group's favourite one. A payment is an amount, a " +
          'percentage (of a fixed amount, or of the balance on its date), or a rounding of the balance. To turn a planned ' +
          'one-off transaction into a series, pass its id as replaces: the series takes its place.',
        inputSchema: {
          type: z.enum(['expense', 'income', 'transfer']),
          amount: amountArg.optional().describe('Each payment, above zero. Not needed with a percentage or roundsBalanceTo'),
          percentage: percentageArg,
          percentageOf: amountArg.optional().describe('The fixed amount the percentage is of; left out, the account balance'),
          roundsBalanceTo: roundsArg,
          firstDate: z.string().describe(DATE_HELP),
          every: everyArg.optional(),
          unit: unitArg,
          endsOn: endsOnArg,
          payments: paymentsArg,
          account: z.string().optional(),
          toAccount: z.string().optional().describe('Transfers only, and required there'),
          category: z.string().optional(),
          subcategory: z.string().optional(),
          note: z.string().max(1000).optional(),
          replaces: z.string().uuid().optional().describe('A planned one-off transaction the series takes the place of'),
          timeZone: timeZoneArg.describe('The IANA zone its days are counted in; left out, the key’s own'),
        },
        annotations: ADDS,
      },
      this.tool(async (args) => {
        const zone = timeZoneOf(context, args.timeZone);
        const { groupId, userId } = context.apiKey;
        const accounts = await this.lookup.accountsOf(groupId);
        const account = findAccount(accounts, ...ref(args.account), 'account') ?? favouriteAccount(accounts);
        let toAccountId: string | null = null;
        if (args.type === 'transfer') {
          const to = findAccount(accounts, ...ref(args.toAccount), 'toAccount');
          if (!to) {
            throw new ToolInputError('A transfer needs toAccount');
          }
          if (to.id === account.id) {
            throw new ToolInputError('A transfer needs two different accounts');
          }
          toAccountId = to.id;
        } else if (args.toAccount !== undefined) {
          throw new ToolInputError('Only a transfer has a toAccount');
        }
        const category = categoryReference(args.category, args.subcategory);
        const pair = namesCategory(category) ? resolveCategoryPair(await this.lookup.categoriesOf(groupId), args.type, category) : {};

        const startsAt = seriesMoment(args.firstDate, zone);
        const schedule: Schedule = { startsAt, intervalUnit: args.unit, intervalValue: args.every ?? 1, timezone: zone };
        const input: CreateRecurringRuleInput = {
          type: args.type,
          ...amountSource(args, null),
          currencyId: account.currencyId,
          accountId: account.id,
          categoryId: pair.categoryId ?? null,
          subcategoryId: pair.subcategoryId ?? null,
          toAccountId,
          note: args.note?.trim() || null,
          intervalUnit: args.unit,
          intervalValue: args.every ?? 1,
          startsAt: startsAt.toISOString(),
          endsOn: endOf(args, schedule, startsAt),
          timezone: zone,
          ...(args.replaces && { replacesTransactionId: args.replaces }),
        };
        const created = await this.series.create(userId, groupId, input);
        return { added: (await this.describer(context, zone))(created) };
      }),
    );
  }

  private updateSeries(server: McpServer, context: McpContext): void {
    server.registerTool(
      'update_series',
      {
        title: 'Change a repeating series',
        description:
          'Change a series from its next payment on: what each payment is, its accounts and category, how often it comes, its ' +
          'next date (after now; the series then counts from it), when it ends, or pause and resume it. Payments that already ' +
          'happened stay as they were, and so does a payment edited on its own. To change only the next payment, use ' +
          'update_transaction on it instead. An amount the series works out (a percentage, a rounding) is changed by changing ' +
          'those; percentage: null with an amount makes it a fixed amount.',
        inputSchema: {
          id: z.string().uuid().describe("The series' id, from list_series or a transaction's series"),
          amount: amountArg.optional(),
          percentage: percentageArg,
          percentageOf: amountArg.nullable().optional().describe('The fixed amount the percentage is of; null makes it the balance'),
          roundsBalanceTo: roundsArg,
          nextDate: z.string().optional().describe(DATE_HELP),
          every: everyArg.optional(),
          unit: unitArg.optional(),
          endsOn: endsOnArg,
          payments: paymentsArg,
          paused: z.boolean().optional().describe('true puts it on hold, removing its planned payment; false resumes it'),
          account: z.string().optional(),
          toAccount: z.string().optional().describe('Transfers only'),
          category: z.string().nullable().optional().describe('null leaves it with no category'),
          subcategory: z.string().nullable().optional(),
          note: z.string().max(1000).optional().describe('An empty one clears it'),
          timeZone: timeZoneArg,
        },
        annotations: CHANGES,
      },
      this.tool(async (args) => {
        const { groupId, userId } = context.apiKey;
        const view = await this.series.get(userId, groupId, args.id);
        const { rule } = view;
        const zone = timeZoneOf(context, args.timeZone ?? rule.timezone);
        const patch: UpdateRecurringRuleInput = {};

        if (args.amount !== undefined || args.percentage !== undefined || args.percentageOf !== undefined || args.roundsBalanceTo !== undefined) {
          const worksItOut = rule.percentage !== null || rule.roundBalanceTo !== null;
          if (args.amount !== undefined && worksItOut && args.percentage === undefined && args.roundsBalanceTo === undefined) {
            throw new ToolInputError(
              'This series works its amount out (a percentage or a rounding of the balance), so a typed one would not hold: ' +
                'change percentage or roundsBalanceTo, or pass percentage: null with the amount to make it fixed',
            );
          }
          Object.assign(patch, amountSource(args, rule));
        }
        if (args.account !== undefined || args.toAccount !== undefined) {
          const accounts = await this.lookup.accountsOf(groupId);
          if (args.account !== undefined) {
            const account = named(accounts, args.account, 'account');
            patch.accountId = account.id;
            patch.currencyId = account.currencyId;
          }
          if (args.toAccount !== undefined) {
            if (rule.type !== 'transfer') {
              throw new ToolInputError('Only a transfer has a toAccount');
            }
            patch.toAccountId = named(accounts, args.toAccount, 'toAccount').id;
          }
        }
        if (args.category !== undefined || args.subcategory !== undefined) {
          if (args.category === null) {
            patch.categoryId = null;
            patch.subcategoryId = null;
          } else {
            const reference = {
              ...categoryReference(args.category ?? undefined, args.subcategory ?? undefined),
              ...(args.subcategory === null && { subcategoryId: null }),
            };
            const pair = resolveCategoryPair(await this.lookup.categoriesOf(groupId), rule.type, reference, rule.categoryId);
            if (pair.categoryId !== undefined) {
              patch.categoryId = pair.categoryId;
            }
            if (pair.subcategoryId !== undefined) {
              patch.subcategoryId = pair.subcategoryId;
            }
          }
        }
        if (args.note !== undefined) {
          patch.note = args.note.trim() || null;
        }

        // The schedule: a new next date starts the series afresh from it; a new repeat keeps its anchor.
        const nextPayment = view.nextOccurrence ?? undefined;
        if (args.nextDate !== undefined) {
          patch.startsAt = seriesMoment(args.nextDate, zone, nextPayment).toISOString();
          patch.timezone = zone;
        }
        if (args.unit !== undefined) {
          patch.intervalUnit = args.unit;
        }
        if (args.every !== undefined) {
          patch.intervalValue = args.every;
        }
        if (args.endsOn !== undefined || args.payments !== undefined) {
          const startsAt = patch.startsAt ? new Date(patch.startsAt) : rule.startsAt;
          const schedule: Schedule = {
            startsAt,
            intervalUnit: patch.intervalUnit ?? rule.intervalUnit,
            intervalValue: patch.intervalValue ?? rule.intervalValue,
            timezone: patch.timezone ?? rule.timezone,
          };
          // Counted from the next payment as it will be after this change.
          const from = patch.startsAt ? startsAt : (nextPayment ?? new Date());
          patch.endsOn = endOf(args, schedule, from);
        }
        if (args.paused !== undefined) {
          patch.active = !args.paused;
        }
        if (Object.keys(patch).length === 0) {
          throw new ToolInputError('Name at least one thing to change');
        }
        const updated = await this.series.update(userId, groupId, args.id, patch);
        return { updated: (await this.describer(context, zone))(updated) };
      }),
    );
  }

  private endSeries(server: McpServer, context: McpContext): void {
    server.registerTool(
      'end_series',
      {
        title: 'End a repeating series',
        description:
          'End a series now: it makes no more payments, and its planned one goes, unless keepPlanned keeps it as a one-off ' +
          "transaction. Payments that already happened stay. The app can't bring a series back, so only end what the person " +
          'asked to; to stop it for a while, pause it with update_series, and to end it later, give it an endsOn.',
        inputSchema: {
          id: z.string().uuid().describe("The series' id"),
          keepPlanned: z.boolean().optional().describe('Keep its planned payment as a one-off transaction'),
        },
        annotations: DELETES,
      },
      this.tool(async ({ id, keepPlanned }) => {
        const removed = await this.series.remove(context.apiKey.userId, context.apiKey.groupId, id, keepPlanned ?? false);
        return { ended: (await this.describer(context, context.timeZone))(removed), keptPlanned: keepPlanned ?? false };
      }),
    );
  }

  private async describer(context: McpContext, timeZone: string) {
    const { groupId } = context.apiKey;
    const accounts = await this.lookup.accountsOf(groupId);
    const categories = await this.lookup.categoriesOf(groupId);
    return (view: RecurringRuleView) => describeSeries(view, { accounts, categories, currencies: context.currencies, timeZone });
  }
}

// An account the external API's lookups take: by id when it is one, by name otherwise.
function ref(value: string | undefined): [string | undefined, string | undefined] {
  if (value === undefined) {
    return [undefined, undefined];
  }
  const { id, name } = idOrName(value);
  return [id, name];
}

// The account a call names, which it does: findAccount only comes back empty-handed for no name.
function named<T extends AccountLike>(accounts: T[], value: string, field: 'account' | 'toAccount'): T {
  return findAccount(accounts, ...ref(value), field) as T;
}

function categoryReference(category: string | undefined, subcategory: string | undefined) {
  const c = category === undefined ? {} : idOrName(category);
  const s = subcategory === undefined ? {} : idOrName(subcategory);
  return { categoryId: c.id, categoryName: c.name, subcategoryId: s.id, subcategoryName: s.name };
}

/**
 * When a series starts, or starts afresh: an exact moment as given, or a day at noon, the time of
 * day each of its payments then comes at, as the app sets one. Kept to the time it already has when
 * it stays on the same day. Always after now: an earlier start would record each date since.
 */
function seriesMoment(value: string, timeZone: string, previous?: Date): Date {
  const now = new Date();
  const start = readBound(value, timeZone, 'start');
  let moment = start;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    moment =
      previous && localDayOf(previous, timeZone) === value
        ? previous
        : new Date(new TZDate(year, month - 1, day, 12, timeZone).getTime());
  }
  if (moment <= now) {
    throw new ToolInputError(`${value} isn't after now: a series only plans, starting from a date ahead`);
  }
  return moment;
}

// The series' last day from a call's endsOn or payments, the latter counted from `from`.
function endOf(args: { endsOn?: string | null; payments?: number }, schedule: Schedule, from: Date): string | null | undefined {
  if (args.endsOn !== undefined && args.payments !== undefined) {
    throw new ToolInputError('Give endsOn or payments, not both');
  }
  if (args.payments !== undefined) {
    return endsOnAfter(schedule, from, args.payments);
  }
  if (args.endsOn === undefined || args.endsOn === null) {
    return args.endsOn;
  }
  if (!seriesEndSchema.safeParse(args.endsOn).success) {
    throw new ToolInputError(`endsOn: "${args.endsOn}" isn't a date like 2027-09-20`);
  }
  return args.endsOn;
}

/**
 * What each payment is, as the series service takes it: a fixed amount, a percentage of a base
 * amount or of the balance, or a rounding of the balance. The amount of one worked out is what it
 * comes to now: of a base, that; of the balance, nothing for now, which each payment works out on
 * its own date. `rule` is the series being changed, whose own source stays where a call names none.
 */
function amountSource(
  args: { amount?: string | number; percentage?: string | number | null; percentageOf?: string | number | null; roundsBalanceTo?: number | null },
  rule: Pick<RecurringRule, 'percentage' | 'percentageBase' | 'roundBalanceTo'> | null,
): { amount: string; percentage?: string | null; percentageBase?: string | null; roundBalanceTo?: number | null } {
  if (args.percentage !== undefined && args.percentage !== null && args.roundsBalanceTo !== undefined && args.roundsBalanceTo !== null) {
    throw new ToolInputError('Give a percentage or roundsBalanceTo, not both');
  }
  const percentage =
    args.percentage === undefined ? (rule?.percentage ?? null) : args.percentage === null ? null : percentageOf(args.percentage);
  const base =
    percentage === null
      ? null
      : args.percentageOf === undefined
        ? (rule?.percentageBase ?? null)
        : args.percentageOf === null
          ? null
          : amountOf(args.percentageOf, 'percentageOf');
  const rounds = percentage !== null ? null : args.roundsBalanceTo === undefined ? (rule?.roundBalanceTo ?? null) : args.roundsBalanceTo;

  let amount: string;
  if (percentage !== null) {
    amount = base !== null ? percentOf(base, percentage) : '0';
  } else if (rounds !== null) {
    amount = '0';
  } else if (args.amount !== undefined) {
    amount = amountOf(args.amount);
  } else {
    throw new ToolInputError('Give an amount, a percentage or roundsBalanceTo');
  }
  return { amount, percentage, percentageBase: base, roundBalanceTo: rounds };
}

function percentageOf(value: string | number): string {
  const text = String(value).trim().replace(',', '.').replace(/%$/, '');
  const number = Number(text);
  if (!/^\d+(\.\d{1,4})?$/.test(text) || number <= 0 || number > 100) {
    throw new ToolInputError(`percentage: "${value}" isn't a percentage above 0 and at most 100, with up to four decimals`);
  }
  return text;
}
