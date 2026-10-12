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
import { FinanceMcpService } from './finance-mcp.service';
import { McpController } from './mcp.controller';

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

function setup(scopes: ApiKeyScope[] = ['accounts:read', 'categories:read', 'transactions:read', 'budgets:read']) {
  const transactions = { list: jest.fn().mockResolvedValue({ items: [coffee], nextCursor: null, tagsByTransactionId: new Map() }) };
  const categories = { list: jest.fn().mockResolvedValue([food, cafe]) };
  const service = new FinanceMcpService(
    { findOneByOrFail: jest.fn().mockResolvedValue({ timeZone: 'Europe/Kyiv' }) } as unknown as Repository<ApiKey>,
    { findOneBy: jest.fn().mockResolvedValue({ mainCurrencyId: UAH, exchangeRates: null }) } as unknown as Repository<Profile>,
    { forGroup: jest.fn().mockResolvedValue({ groupName: 'Home' }) } as unknown as AbilityFactory,
    {} as AccountsService,
    categories as unknown as CategoriesService,
    transactions as unknown as TransactionsService,
    {} as BudgetsService,
    {} as OverviewService,
    {} as ExchangeRatesService,
    {
      currencyCodes: jest.fn().mockResolvedValue(new CurrencyCodes(new Map([[UAH, 'UAH']]))),
      accountsOf: jest.fn().mockResolvedValue([card]),
      categoriesOf: jest.fn().mockResolvedValue([food, cafe]),
    } as unknown as ExternalLookupService,
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

  return { call, callTool, transactions, categories };
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
});
