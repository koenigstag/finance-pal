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
import { CurrencyCodes, type ExternalLookupService } from '../external-lookup.service';
import type { ExternalTransactionsService } from '../external-transactions.service';
import { FinanceMcpService } from './finance-mcp.service';
import { McpController } from './mcp.controller';
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
} as unknown as Transaction;
// The same coffee, planned: dated well after any day these specs run on.
const plannedCoffee = { ...coffee, id: 'tx-2', date: new Date('2030-11-03T10:00:00Z') } as Transaction;

const VIEW: ApiKeyScope[] = ['accounts:read', 'categories:read', 'transactions:read', 'budgets:read'];

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
  );
  const apiKey: RequestApiKey = { id: 'key-1', userId: 'user-1', groupId, scopes };
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

  return { call, callTool, toolNames, transactions, external, categories, accounts, budgets };
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
        'add_transaction',
        'get_budget',
        'list_accounts',
        'list_categories',
        'search_transactions',
        'set_budget',
        'summarize_by_category',
      ]);
    });

    it("don't offer deleting an account without deleting its transactions", async () => {
      await expect(setup(['accounts:delete']).call('tools/list')).resolves.toMatchObject({ message: { error: expect.anything() } });
      expect(await setup(['accounts:delete', 'transactions:delete']).toolNames()).toEqual(['delete_account', 'delete_transaction']);
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
      expect(JSON.parse(text)).toEqual({ added: { id: 'line-1', month: '2026-11', for: 'Food', budgeted: '5000', currency: 'UAH' } });
    });

    it('refuse to change a line with a key that may only add them', async () => {
      const { callTool, budgets } = setup(['budgets:create']);
      budgets.list.mockResolvedValue([{ id: 'line-1', categoryId: food.id, accountId: null }]);
      await expect(callTool('set_budget', { month: '2026-11', category: 'Food', amount: 6000 })).resolves.toMatchObject({ isError: true });
      expect(budgets.update).not.toHaveBeenCalled();
    });
  });
});
