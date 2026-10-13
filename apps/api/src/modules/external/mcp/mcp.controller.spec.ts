import { Logger, NotFoundException } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Repository } from 'typeorm';
import type { ApiKey, Category, Profile, Transaction } from '@ft/api-database';
import type { ApiKeyScope } from '@ft/shared-contracts';
import type { RequestApiKey } from '../../_core/authn/request-user';
import type { AbilityFactory } from '../../_core/authz/ability.factory';
import type { AccountsService } from '../../ledger/accounts/accounts.service';
import type { BudgetsService } from '../../ledger/budgets/budgets.service';
import type { CategoriesService } from '../../ledger/categories/categories.service';
import type { ExchangeRatesService } from '../../ledger/exchange-rates/exchange-rates.service';
import type { OverviewService } from '../../ledger/overview/overview.service';
import type { TransactionsService } from '../../ledger/transactions/transactions.service';
import type { RecurringRulesService } from '../../recurring/recurring-rules.service';
import { UndoBlockedError, type ChangeSetsService } from '../changes/change-sets.service';
import { CurrencyCodes, type ExternalLookupService } from '../external-lookup.service';
import type { ExternalTransactionsService } from '../external-transactions.service';
import { FinanceMcpService } from './finance-mcp.service';
import { McpController } from './mcp.controller';
import { McpChangeTools } from './mcp-change-tools';
import { McpSeriesTools } from './mcp-series-tools';
import { McpWriteTools } from './mcp-write-tools';

// The controller answers once the request's transaction commits; these calls have none, so at once.
jest.mock('typeorm-transactional', () => ({
  ...jest.requireActual('typeorm-transactional'),
  runOnTransactionCommit: (callback: () => void) => callback(),
}));

const UAH = 1;
const groupId = '11111111-1111-4111-8111-111111111111';

const card = { id: 'acc-card', name: 'Card', archived: false, currencyId: UAH, isFavourite: true };
const food = { id: 'cat-food', name: 'Food', type: 'expense', parentId: null, archived: false, sortOrder: 1 } as Category;
const cafe = { id: 'cat-cafe', name: 'Cafe', type: 'expense', parentId: food.id, archived: false, sortOrder: 1 } as Category;
const coffee = {
  id: 'tx-1',
  type: 'expense',
  date: new Date('2026-10-03T07:15:00Z'),
  amount: '85.00',
  currencyId: UAH,
  accountId: card.id,
  categoryId: food.id,
  subcategoryId: cafe.id,
  toAccountId: null,
  destAmount: null,
  note: 'Flat white',
  percentage: null,
  percentageBase: null,
  roundBalanceTo: null,
  percentageAsOf: null,
  recurringRuleId: null,
  isCustomized: false,
} as unknown as Transaction;
// The same coffee, planned: dated well after any day these specs run on.
const plannedCoffee = { ...coffee, id: 'tx-2', date: new Date('2030-11-03T10:00:00Z') } as Transaction;

const VIEW: ApiKeyScope[] = ['accounts:read', 'categories:read', 'transactions:read', 'budgets:read'];

// Payday on the 20th, every month, in Kyiv: a series planned well after any day these specs run on.
const payday = {
  id: '55555555-5555-4555-8555-555555555555',
  type: 'income',
  amount: '50000.00',
  currencyId: UAH,
  accountId: card.id,
  categoryId: food.id,
  subcategoryId: null,
  toAccountId: null,
  note: 'Salary',
  percentage: null,
  percentageBase: null,
  roundBalanceTo: null,
  intervalUnit: 'month',
  intervalValue: 1,
  startsAt: new Date('2030-01-20T10:00:00Z'),
  endsOn: null,
  timezone: 'Europe/Kyiv',
  active: true,
};

function setup(scopes: ApiKeyScope[] = VIEW) {
  const transactions = {
    list: jest.fn().mockResolvedValue({ items: [coffee], nextCursor: null, tagsByTransactionId: new Map() }),
    get: jest.fn().mockResolvedValue({ transaction: coffee, tagIds: [] }),
    remove: jest.fn().mockResolvedValue({ transaction: coffee, tagIds: [] }),
  };
  const external = {
    create: jest.fn().mockResolvedValue({ transaction: coffee, replayed: false }),
    update: jest.fn().mockResolvedValue(coffee),
  };
  const categories = { list: jest.fn().mockResolvedValue([food, cafe]) };
  const accounts = {
    usage: jest.fn().mockResolvedValue({ transactionCount: 12, plannedTransactionCount: 1, recurringRuleCount: 2, budgetCount: 0 }),
    remove: jest.fn().mockResolvedValue({ account: { ...card, type: 'regular', isIncludedInBalance: true, description: null }, balance: '0.00' }),
  };
  const budgets = {
    list: jest.fn().mockResolvedValue([]),
    create: jest.fn(async (_userId: string, _groupId: string, input: { month: string; amount: string }) => ({
      id: 'line-1',
      month: `${input.month}-01`,
      amount: input.amount,
      currencyId: UAH,
    })),
    update: jest.fn(),
  };
  const lookup = {
    currencyCodes: jest.fn().mockResolvedValue(new CurrencyCodes(new Map([[UAH, 'UAH']]))),
    accountsOf: jest.fn().mockResolvedValue([card]),
    categoriesOf: jest.fn().mockResolvedValue([food, cafe]),
    seriesOf: jest.fn().mockResolvedValue([]),
  };
  const recurring = {
    list: jest.fn().mockResolvedValue([{ rule: payday, nextOccurrence: new Date('2030-01-20T10:00:00Z') }]),
    get: jest.fn().mockResolvedValue({ rule: payday, nextOccurrence: new Date('2030-01-20T10:00:00Z') }),
    create: jest.fn(async (_userId: string, _groupId: string, input: Record<string, unknown>) => ({
      rule: { ...payday, ...input, startsAt: new Date(input.startsAt as string) },
      nextOccurrence: new Date(input.startsAt as string),
    })),
    update: jest.fn(async () => ({ rule: payday, nextOccurrence: new Date('2030-01-20T10:00:00Z') })),
    remove: jest.fn(async () => ({ rule: payday, nextOccurrence: null })),
  };
  // Each write is kept as a change; here it's simply run, and kept unless it's a dry run.
  const changes = {
    record: jest.fn(async (_apiKey: RequestApiKey, request: { dryRun?: boolean }, run: () => Promise<unknown>) => ({
      result: await run(),
      changeId: request.dryRun ? null : 'change-1',
      touched: [],
    })),
    list: jest.fn().mockResolvedValue([]),
    undo: jest.fn(),
  };
  const writes = new McpWriteTools(
    external as unknown as ExternalTransactionsService,
    transactions as unknown as TransactionsService,
    accounts as unknown as AccountsService,
    categories as unknown as CategoriesService,
    budgets as unknown as BudgetsService,
    lookup as unknown as ExternalLookupService,
  );
  const service = new FinanceMcpService(
    { findOneByOrFail: jest.fn().mockResolvedValue({ timeZone: 'Europe/Kyiv' }) } as unknown as Repository<ApiKey>,
    { findOneBy: jest.fn().mockResolvedValue({ mainCurrencyId: UAH, exchangeRates: null }) } as unknown as Repository<Profile>,
    { forGroup: jest.fn().mockResolvedValue({ groupName: 'Home' }) } as unknown as AbilityFactory,
    accounts as unknown as AccountsService,
    categories as unknown as CategoriesService,
    transactions as unknown as TransactionsService,
    budgets as unknown as BudgetsService,
    {} as OverviewService,
    {} as ExchangeRatesService,
    lookup as unknown as ExternalLookupService,
    writes,
    new McpSeriesTools(recurring as unknown as RecurringRulesService, lookup as unknown as ExternalLookupService),
    new McpChangeTools(changes as unknown as ChangeSetsService),
  );
  const apiKey: RequestApiKey = { id: 'key-1', userId: 'user-1', groupId, scopes, name: 'Claude' };
  const controller = new McpController(service);

  // One JSON-RPC message, posted the way an MCP client posts it, and the answer it gets.
  async function call(method: string, params: Record<string, unknown> = {}) {
    const request = {
      method: 'POST',
      originalUrl: '/api/mcp',
      headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: { jsonrpc: '2.0', id: 1, method, params },
    } as unknown as Request;
    const sent: { status?: number; headers: Record<string, string>; body?: Buffer } = { headers: {} };
    const response = {
      status(code: number) {
        sent.status = code;
        return this;
      },
      setHeader(name: string, value: string) {
        sent.headers[name.toLowerCase()] = value;
        return this;
      },
      send(body: Buffer) {
        sent.body = body;
        return this;
      },
    } as unknown as Response;
    await controller.post(request, response, apiKey);
    return { ...sent, message: JSON.parse(sent.body?.toString() ?? 'null') };
  }

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const { message } = await call('tools/call', { name, arguments: args });
    const result = message.result as { isError?: boolean; content: { text: string }[] };
    return { isError: result.isError ?? false, text: result.content[0].text };
  };

  const toolNames = async () =>
    ((await call('tools/list')).message.result.tools as { name: string }[]).map((tool) => tool.name).sort();

  return { call, callTool, toolNames, transactions, external, categories, accounts, budgets, recurring, changes };
}

describe('McpController', () => {
  it('introduces the server, in the key’s time zone', async () => {
    const { call } = setup();
    const { status, headers, message } = await call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('application/json');
    expect(message.result.serverInfo).toMatchObject({ name: 'finance-pal' });
    expect(message.result.capabilities.tools).toBeDefined();
    expect(message.result.instructions).toContain('"Home"');
    expect(message.result.instructions).toContain('Europe/Kyiv');
    expect(message.result.instructions).toContain('UAH');
  });

  it('offers every tool to a key that may view everything, all of them read-only', async () => {
    const { call } = setup();
    const { message } = await call('tools/list');
    const tools = message.result.tools as { name: string; annotations: { readOnlyHint: boolean } }[];
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'get_budget',
      'list_accounts',
      'list_categories',
      'list_series',
      'search_transactions',
      'summarize_by_category',
    ]);
    expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
  });

  it('offers only the tools a key has scopes for', async () => {
    const { call } = setup(['categories:read']);
    const { message } = await call('tools/list');
    expect((message.result.tools as { name: string }[]).map((tool) => tool.name)).toEqual(['list_categories']);
  });

  it('refuses a tool the key has no scope for as one that isn’t there', async () => {
    const { call } = setup(['categories:read']);
    const { message } = await call('tools/call', { name: 'search_transactions', arguments: {} });
    const refused = message.error ?? (message.result.isError && message.result);
    expect(refused).toBeTruthy();
  });

  it('searches transactions by names, reading dates in the key’s time zone', async () => {
    const { callTool, transactions } = setup();
    const { isError, text } = await callTool('search_transactions', { from: '2026-10-01', to: '2026-10-31', category: 'food' });
    expect(isError).toBe(false);
    expect(transactions.list).toHaveBeenCalledWith('user-1', groupId, {
      dateFrom: '2026-09-30T21:00:00.000Z',
      dateTo: '2026-10-31T21:59:59.999Z',
      type: undefined,
      accountId: undefined,
      categoryId: food.id,
      search: undefined,
      limit: undefined,
      cursor: undefined,
    });
    expect(JSON.parse(text)).toEqual({
      timeZone: 'Europe/Kyiv',
      transactions: [
        {
          id: 'tx-1',
          date: '2026-10-03T10:15+03:00',
          type: 'expense',
          amount: '85.00',
          currency: 'UAH',
          account: 'Card',
          category: 'Food',
          subcategory: 'Cafe',
          note: 'Flat white',
        },
      ],
      nextCursor: null,
    });
  });

  it('answers a call it can’t take with the reason, for the assistant to read', async () => {
    const { callTool } = setup();
    await expect(callTool('search_transactions', { category: 'Rent' })).resolves.toEqual({
      isError: true,
      text: 'No category is named "Rent"',
    });
    await expect(callTool('search_transactions', { from: 'last week' })).resolves.toMatchObject({ isError: true });
  });

  it('passes on what the ledger refuses, and keeps anything unexpected to itself', async () => {
    const { callTool, categories } = setup();
    categories.list.mockRejectedValueOnce(new NotFoundException('Group not found'));
    await expect(callTool('list_categories', {})).resolves.toEqual({ isError: true, text: 'Group not found' });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    categories.list.mockRejectedValueOnce(new Error('connection reset by peer at 10.0.0.5'));
    const unexpected = await callTool('list_categories', {});
    expect(unexpected.isError).toBe(true);
    expect(unexpected.text).not.toContain('10.0.0.5');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('10.0.0.5'));
    logged.mockRestore();
  });

  it('lists categories as a tree', async () => {
    const { callTool } = setup();
    const { text } = await callTool('list_categories', {});
    expect(JSON.parse(text)).toEqual([
      { id: food.id, name: 'Food', type: 'expense', subcategories: [{ id: cafe.id, name: 'Cafe' }] },
    ]);
  });

  describe('write tools', () => {
    it('are offered only for the scopes the key has', async () => {
      const { toolNames } = setup([...VIEW, 'transactions:create', 'budgets:update']);
      expect(await toolNames()).toEqual([
        'add_series',
        'add_transaction',
        'apply_changes',
        'get_budget',
        'list_accounts',
        'list_categories',
        'list_changes',
        'list_series',
        'search_transactions',
        'set_budget',
        'summarize_by_category',
        'undo_changes',
      ]);
    });

    it("don't offer deleting an account without deleting its transactions", async () => {
      await expect(setup(['accounts:delete']).call('tools/list')).resolves.toMatchObject({ message: { error: expect.anything() } });
      expect(await setup(['accounts:delete', 'transactions:delete']).toolNames()).toEqual([
        'apply_changes',
        'delete_account',
        'delete_transaction',
        'end_series',
        'list_changes',
        'undo_changes',
      ]);
    });

    it('say they change things, and the instructions say so too', async () => {
      const { call } = setup(['transactions:read', 'transactions:delete']);
      const tools = (await call('tools/list')).message.result.tools as { name: string; annotations: Record<string, boolean> }[];
      expect(tools.find((tool) => tool.name === 'delete_transaction')?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
      });
      const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      expect(init.message.result.instructions).toContain('Some of them change it');
    });

    it('plan a transaction by names, dating a day to come at noon', async () => {
      const { callTool, external } = setup([...VIEW, 'transactions:create']);
      const { isError, text } = await callTool('add_transaction', {
        type: 'expense',
        amount: '1 250,50',
        date: '2030-11-03',
        account: 'card',
        category: 'Food',
        subcategory: 'Cafe',
        note: 'Flat white',
      });
      expect(isError).toBe(false);
      expect(external.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', groupId }),
        expect.objectContaining({
          type: 'expense',
          amount: '1250.50',
          // Noon in Kyiv, back on UTC+2 by November.
          date: '2030-11-03T10:00:00.000Z',
          accountName: 'card',
          categoryName: 'Food',
          subcategoryName: 'Cafe',
          note: 'Flat white',
        }),
      );
      expect(JSON.parse(text).added).toMatchObject({ id: 'tx-1', account: 'Card', category: 'Food', subcategory: 'Cafe' });
    });

    it('turn an amount they can’t read into a reason', async () => {
      const { callTool, external } = setup(['transactions:create']);
      await expect(callTool('add_transaction', { type: 'expense', amount: '1.234', date: '2030-11-03' })).resolves.toMatchObject({
        isError: true,
      });
      expect(external.create).not.toHaveBeenCalled();
    });

    it('add only what is planned, dated after now', async () => {
      const { callTool, external } = setup(['transactions:create']);
      const refused = await callTool('add_transaction', { type: 'expense', amount: '85', date: '2026-10-03' });
      expect(refused).toEqual({ isError: true, text: "2026-10-03 isn't after now: only planned transactions can be added or moved here" });
      expect(external.create).not.toHaveBeenCalled();
    });

    it('leave a transaction that already happened alone', async () => {
      const { callTool, external, transactions } = setup(['transactions:update', 'transactions:delete']);
      // Whatever the id, the ledger answers with the coffee that already happened.
      const id = '33333333-3333-4333-8333-333333333333';
      for (const [name, args] of [
        ['update_transaction', { id, amount: '90' }],
        ['delete_transaction', { id }],
      ] as const) {
        await expect(callTool(name, args)).resolves.toEqual({
          isError: true,
          text: 'That transaction already happened: only planned ones, dated after now, can be changed here',
        });
      }
      expect(external.update).not.toHaveBeenCalled();
      expect(transactions.remove).not.toHaveBeenCalled();
    });

    it('keep a planned transaction planned when moving it', async () => {
      const { callTool, external, transactions } = setup(['transactions:update']);
      transactions.get.mockResolvedValue({ transaction: plannedCoffee, tagIds: [] });
      await expect(callTool('update_transaction', { id: plannedCoffee.id, date: '2026-10-01' })).resolves.toMatchObject({ isError: true });
      expect(external.update).not.toHaveBeenCalled();
    });

    it('leave an amount the app works out to the app, saying how it is worked out', async () => {
      const { callTool, external, transactions } = setup(['transactions:update']);
      const interest = { ...plannedCoffee, percentage: '3.5000', percentageAsOf: new Date('2026-10-12T08:00:00Z') } as Transaction;
      transactions.get.mockResolvedValue({ transaction: interest, tagIds: [] });
      const refused = await callTool('update_transaction', { id: '44444444-4444-4444-8444-444444444444', amount: '3520' });
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('"percentage":"3.5","of":"balance","followsBalance":true');
      expect(external.update).not.toHaveBeenCalled();
      // What isn't the amount still changes.
      await callTool('update_transaction', { id: '44444444-4444-4444-8444-444444444444', note: 'Interest' });
      expect(external.update).toHaveBeenCalled();
    });

    it('change only what a call names, clearing a category with null', async () => {
      const { callTool, external, transactions } = setup(['transactions:update']);
      transactions.get.mockResolvedValue({ transaction: plannedCoffee, tagIds: [] });
      const id = '22222222-2222-4222-8222-222222222222';
      await callTool('update_transaction', { id, category: null, note: '' });
      expect(external.update).toHaveBeenCalledWith(expect.anything(), id, { categoryId: null, note: '' });
      await expect(callTool('update_transaction', { id })).resolves.toEqual({ isError: true, text: 'Name at least one thing to change' });
    });

    it('delete an account with nothing but plans, and say what went with it', async () => {
      const { callTool, accounts } = setup(['accounts:delete', 'transactions:delete']);
      accounts.usage.mockResolvedValue({ transactionCount: 0, plannedTransactionCount: 1, recurringRuleCount: 2, budgetCount: 0 });
      const { text } = await callTool('delete_account', { account: 'Card' });
      expect(accounts.remove).toHaveBeenCalledWith('user-1', groupId, card.id);
      expect(JSON.parse(text).deletedWithIt).toEqual({ plannedTransactions: 1, repeatingSeries: 2, budgetLines: 0 });
    });

    it('leave an account with a history to the app', async () => {
      const { callTool, accounts } = setup(['accounts:delete', 'transactions:delete']);
      await expect(callTool('delete_account', { account: 'Card' })).resolves.toMatchObject({ isError: true });
      expect(accounts.remove).not.toHaveBeenCalled();
    });

    it('add a budget line the month lacks, given the scope to', async () => {
      const { callTool, budgets } = setup(['budgets:create']);
      const { text } = await callTool('set_budget', { month: '2026-11', category: 'food', amount: 5000 });
      expect(budgets.create).toHaveBeenCalledWith('user-1', groupId, { month: '2026-11', categoryId: food.id, amount: '5000' });
      expect(JSON.parse(text)).toEqual({
        added: { id: 'line-1', month: '2026-11', for: 'Food', budgeted: '5000', currency: 'UAH' },
        changeId: 'change-1',
      });
    });

    it('refuse to change a line with a key that may only add them', async () => {
      const { callTool, budgets } = setup(['budgets:create']);
      budgets.list.mockResolvedValue([{ id: 'line-1', categoryId: food.id, accountId: null }]);
      await expect(callTool('set_budget', { month: '2026-11', category: 'Food', amount: 6000 })).resolves.toMatchObject({ isError: true });
      expect(budgets.update).not.toHaveBeenCalled();
    });
  });

  describe('series tools', () => {
    it('go by the transaction scopes', async () => {
      expect(await setup(['transactions:read']).toolNames()).toEqual(['list_series', 'search_transactions', 'summarize_by_category']);
      const all = await setup(['transactions:read', 'transactions:create', 'transactions:update', 'transactions:delete']).toolNames();
      expect(all).toEqual(expect.arrayContaining(['add_series', 'update_series', 'end_series']));
    });

    it('list a series with its next payment and how often it comes', async () => {
      const { callTool } = setup(['transactions:read']);
      const { text } = await callTool('list_series', {});
      expect(JSON.parse(text).series[0]).toEqual({
        id: payday.id,
        type: 'income',
        amount: '50000.00',
        currency: 'UAH',
        account: 'Card',
        category: 'Food',
        note: 'Salary',
        every: 1,
        unit: 'month',
        firstPayment: '2030-01-20T12:00+02:00',
        nextPayment: '2030-01-20T12:00+02:00',
      });
    });

    it('set one up from a day ahead, ending after so many payments', async () => {
      const { callTool, recurring } = setup(['transactions:create']);
      const { isError, text } = await callTool('add_series', {
        type: 'expense',
        amount: '30 000',
        firstDate: '2030-11-20',
        unit: 'month',
        payments: 3,
        account: 'Card',
        note: 'Card payment',
      });
      expect(isError).toBe(false);
      expect(recurring.create).toHaveBeenCalledWith(
        'user-1',
        groupId,
        expect.objectContaining({
          type: 'expense',
          amount: '30000',
          accountId: card.id,
          intervalUnit: 'month',
          intervalValue: 1,
          // Noon in Kyiv.
          startsAt: '2030-11-20T10:00:00.000Z',
          // The third: November, December, January.
          endsOn: '2031-01-20',
          timezone: 'Europe/Kyiv',
        }),
      );
      expect(JSON.parse(text).added).toMatchObject({ endsOn: '2031-01-20', every: 1, unit: 'month' });
    });

    it('only plan: a series starting now or before is refused', async () => {
      const { callTool, recurring } = setup(['transactions:create']);
      await expect(callTool('add_series', { type: 'expense', amount: 10, firstDate: '2026-10-01', unit: 'day' })).resolves.toMatchObject({
        isError: true,
      });
      expect(recurring.create).not.toHaveBeenCalled();
    });

    it('work a percentage out from its base, and leave one of the balance at nothing for now', async () => {
      const { callTool, recurring } = setup(['transactions:create']);
      await callTool('add_series', { type: 'expense', percentage: 3.5, percentageOf: 10000, firstDate: '2030-11-01', unit: 'month' });
      expect(recurring.create).toHaveBeenLastCalledWith(
        'user-1',
        groupId,
        expect.objectContaining({ amount: '350.00', percentage: '3.5', percentageBase: '10000' }),
      );
      await callTool('add_series', { type: 'expense', percentage: '3.5', firstDate: '2030-11-01', unit: 'day' });
      expect(recurring.create).toHaveBeenLastCalledWith('user-1', groupId, expect.objectContaining({ amount: '0', percentageBase: null }));
    });

    it('end a series on a day, or after so many more payments from the next', async () => {
      const { callTool, recurring } = setup(['transactions:update']);
      await callTool('update_series', { id: payday.id, endsOn: '2030-06-30' });
      expect(recurring.update).toHaveBeenLastCalledWith('user-1', groupId, payday.id, { endsOn: '2030-06-30' });
      await callTool('update_series', { id: payday.id, payments: 2 });
      expect(recurring.update).toHaveBeenLastCalledWith('user-1', groupId, payday.id, { endsOn: '2030-02-20' });
      await callTool('update_series', { id: payday.id, paused: true });
      expect(recurring.update).toHaveBeenLastCalledWith('user-1', groupId, payday.id, { active: false });
    });

    it('refuse a typed amount on a series that works its amount out', async () => {
      const { callTool, recurring } = setup(['transactions:update']);
      recurring.get.mockResolvedValue({ rule: { ...payday, percentage: '3.5000' }, nextOccurrence: null });
      await expect(callTool('update_series', { id: payday.id, amount: '3520' })).resolves.toMatchObject({ isError: true });
      expect(recurring.update).not.toHaveBeenCalled();
      // With percentage null the amount is fixed from then on.
      await callTool('update_series', { id: payday.id, amount: '3520', percentage: null });
      expect(recurring.update).toHaveBeenLastCalledWith(
        'user-1',
        groupId,
        payday.id,
        expect.objectContaining({ amount: '3520', percentage: null, percentageBase: null, roundBalanceTo: null }),
      );
    });

    it('end one, keeping its planned payment when asked', async () => {
      const { callTool, recurring } = setup(['transactions:delete']);
      const { text } = await callTool('end_series', { id: payday.id, keepPlanned: true });
      expect(recurring.remove).toHaveBeenCalledWith('user-1', groupId, payday.id, true);
      expect(JSON.parse(text)).toMatchObject({ ended: { id: payday.id, nextPayment: null, ended: true }, keptPlanned: true });
    });
  });

  describe('changes', () => {
    const PLANS: ApiKeyScope[] = ['transactions:create', 'budgets:create'];
    const plan = { tool: 'add_transaction', type: 'expense', amount: 85, date: '2030-11-01', note: 'Coffee' };
    const budget = { tool: 'set_budget', month: '2030-11', category: 'Food', amount: 5000 };

    it('keep each write as a change of its own, and answer with its id', async () => {
      const { callTool, changes } = setup(PLANS);
      const { isError, text } = await callTool('add_transaction', { type: 'expense', amount: 85, date: '2030-11-01' });
      expect(isError).toBe(false);
      expect(changes.record).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Claude' }),
        { steps: [{ tool: 'add_transaction', args: { type: 'expense', amount: 85, date: '2030-11-01' } }] },
        expect.any(Function),
      );
      expect(JSON.parse(text)).toMatchObject({ added: { id: coffee.id }, changeId: 'change-1' });
    });

    it('make several at once as one change, each step answering as its tool does', async () => {
      const { callTool, changes, external, budgets } = setup(PLANS);
      const { isError, text } = await callTool('apply_changes', { steps: [plan, budget], description: 'November plans' });
      expect(isError).toBe(false);
      expect(changes.record).toHaveBeenCalledTimes(1);
      expect(changes.record).toHaveBeenCalledWith(
        expect.anything(),
        {
          steps: [
            { tool: 'add_transaction', args: { type: 'expense', amount: 85, date: '2030-11-01', note: 'Coffee' } },
            { tool: 'set_budget', args: { month: '2030-11', category: 'Food', amount: 5000 } },
          ],
          description: 'November plans',
          dryRun: false,
        },
        expect.any(Function),
      );
      expect(external.create).toHaveBeenCalledTimes(1);
      expect(budgets.create).toHaveBeenCalledTimes(1);
      const answer = JSON.parse(text);
      expect(answer).toMatchObject({ changeId: 'change-1', diff: [] });
      expect(answer.results).toEqual([
        expect.objectContaining({ step: 1, tool: 'add_transaction', added: expect.objectContaining({ id: coffee.id }) }),
        expect.objectContaining({ step: 2, tool: 'set_budget', added: expect.objectContaining({ id: 'line-1' }) }),
      ]);
    });

    it('try them out with dryRun, keeping nothing', async () => {
      const { callTool, changes } = setup(PLANS);
      const { text } = await callTool('apply_changes', { steps: [plan], dryRun: true });
      expect(changes.record).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dryRun: true }), expect.any(Function));
      const answer = JSON.parse(text);
      expect(answer).toMatchObject({ dryRun: true, kept: false });
      expect(answer).not.toHaveProperty('changeId');
    });

    it('stop at the first step that fails, and say nothing was changed', async () => {
      const { callTool, budgets } = setup(PLANS);
      const { isError, text } = await callTool('apply_changes', { steps: [plan, { tool: 'set_budget', amount: 5000 }, budget] });
      expect(isError).toBe(true);
      expect(text).toBe('Step 2 (set_budget) failed, so nothing was changed: Name a category or an account, one of the two');
      // The step after it never ran.
      expect(budgets.create).not.toHaveBeenCalled();
    });

    it('take only steps of the tools the key has', async () => {
      const { callTool, changes } = setup(PLANS);
      await expect(callTool('apply_changes', { steps: [{ tool: 'delete_transaction', id: coffee.id }] })).resolves.toMatchObject({
        isError: true,
      });
      expect(changes.record).not.toHaveBeenCalled();
    });

    it('undo one, with the permissions its tools needed', async () => {
      const { callTool, changes } = setup(PLANS);
      changes.undo.mockResolvedValue({
        changeSet: {
          id: 'change-1',
          createdAt: new Date('2026-10-13T12:00:00Z'),
          source: 'Claude',
          description: null,
          steps: [{ tool: 'add_transaction', args: {} }],
        },
        touched: [],
      });
      const { isError, text } = await callTool('undo_changes', { changeId: '66666666-6666-4666-8666-666666666666' });
      expect(isError).toBe(false);
      expect(JSON.parse(text)).toEqual({
        undone: true,
        change: { changeId: 'change-1', madeAt: '2026-10-13T15:00+03:00', source: 'Claude', tools: ['add_transaction'] },
        diff: [],
      });
      const [, changeId, options] = changes.undo.mock.calls[0] as [unknown, string, { dryRun: boolean; mayUndo: (tool: string) => boolean }];
      expect(changeId).toBe('66666666-6666-4666-8666-666666666666');
      expect(options.dryRun).toBe(false);
      expect(options.mayUndo('add_transaction')).toBe(true);
      expect(options.mayUndo('delete_account')).toBe(false);
    });

    it('say what stands in the way of undoing one', async () => {
      const { callTool, changes } = setup(PLANS);
      changes.undo.mockRejectedValue(
        new UndoBlockedError([{ what: 'transaction', id: coffee.id, label: 'expense 85.00 Coffee on 2030-11-01', reason: 'it has been changed since' }]),
      );
      const { isError, text } = await callTool('undo_changes', { changeId: '66666666-6666-4666-8666-666666666666' });
      expect(isError).toBe(true);
      expect(text).toBe(
        'Nothing was undone: the change can’t be taken back as things are now.\n' +
          `- transaction "expense 85.00 Coffee on 2030-11-01" (${coffee.id}): it has been changed since`,
      );
    });

    it('are not offered to a key that only reads', async () => {
      expect(await setup().toolNames()).not.toContain('apply_changes');
    });
  });
});
