import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { accountsContract } from '@ft/shared-contracts';
import { AccountTarget } from '@ft/api-database';
import { CurrentUser, type RequestUser } from '../../_core/authn/request-user';
import { requireUser } from '../../_core/authn/require-user';
import { AccountsService, type AccountWithBalance } from './accounts.service';

function toAccountDto({ account, balance }: AccountWithBalance) {
  return {
    id: account.id,
    groupId: account.groupId,
    type: account.type,
    name: account.name,
    currencyId: account.currencyId,
    isFavourite: account.isFavourite,
    icon: account.icon,
    color: account.color,
    description: account.description,
    isIncludedInBalance: account.isIncludedInBalance,
    sortOrder: account.sortOrder,
    archived: account.archived,
    archivedAt: account.archivedAt?.toISOString() ?? null,
    balance,
    plannedBalance: account.cachedBalance,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

function toAccountTargetDto(target: AccountTarget) {
  return {
    accountId: target.accountId,
    limitAmount: target.limitAmount,
    goalAmount: target.goalAmount,
  };
}

@Controller()
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @TsRestHandler(accountsContract.list)
  list(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.list, async ({ params, query }) => {
      const accounts = await this.accounts.list(requireUser(user).id, params.groupId, query.includeArchived ?? false);
      return { status: 200 as const, body: accounts.map(toAccountDto) };
    });
  }

  @TsRestHandler(accountsContract.create)
  create(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.create, async ({ params, body }) => {
      const created = await this.accounts.create(requireUser(user).id, params.groupId, body);
      return { status: 201 as const, body: toAccountDto(created) };
    });
  }

  @TsRestHandler(accountsContract.get)
  get(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.get, async ({ params }) => {
      const account = await this.accounts.get(requireUser(user).id, params.groupId, params.accountId);
      return { status: 200 as const, body: toAccountDto(account) };
    });
  }

  @TsRestHandler(accountsContract.update)
  update(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.update, async ({ params, body }) => {
      const updated = await this.accounts.update(requireUser(user).id, params.groupId, params.accountId, body);
      return { status: 200 as const, body: toAccountDto(updated) };
    });
  }

  @TsRestHandler(accountsContract.archive)
  archive(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.archive, async ({ params }) => {
      const updated = await this.accounts.archive(requireUser(user).id, params.groupId, params.accountId);
      return { status: 200 as const, body: toAccountDto(updated) };
    });
  }

  @TsRestHandler(accountsContract.restore)
  restore(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.restore, async ({ params }) => {
      const updated = await this.accounts.restore(requireUser(user).id, params.groupId, params.accountId);
      return { status: 200 as const, body: toAccountDto(updated) };
    });
  }

  @TsRestHandler(accountsContract.remove)
  remove(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.remove, async ({ params }) => {
      const removed = await this.accounts.remove(requireUser(user).id, params.groupId, params.accountId);
      return { status: 200 as const, body: toAccountDto(removed) };
    });
  }

  @TsRestHandler(accountsContract.upsertTarget)
  upsertTarget(@CurrentUser() user?: RequestUser) {
    return tsRestHandler(accountsContract.upsertTarget, async ({ params, body }) => {
      const target = await this.accounts.upsertTarget(requireUser(user).id, params.groupId, params.accountId, body);
      return { status: 200 as const, body: toAccountTargetDto(target) };
    });
  }
}
