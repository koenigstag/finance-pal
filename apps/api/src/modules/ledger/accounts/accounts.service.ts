import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, AccountTarget, AccountType } from '@ft/api-database';
import { ACCOUNT_TYPES, type Action, type AppAbility, type Subject } from '@ft/shared-contracts';
import { AbilityFactory } from '../../_core/authz/ability.factory';

// The shared string union, not api-database's TypeORM enum — see the identical comment on
// GroupWithRole.role in GroupsService for why (assignable one way, not the other).
export interface CreateAccountInput {
  type?: (typeof ACCOUNT_TYPES)[number];
  name: string;
  currencyId: number;
  isFavourite?: boolean;
  icon?: string;
  color?: string;
  description?: string;
  isIncludedInBalance?: boolean;
  sortOrder?: number;
}

export type UpdateAccountInput = Partial<CreateAccountInput>;

export interface UpsertAccountTargetInput {
  limitAmount?: string | null;
  goalAmount?: string | null;
}

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(AccountTarget) private readonly targets: Repository<AccountTarget>,
    private readonly abilities: AbilityFactory,
  ) {}

  async list(userId: string, groupId: string, includeArchived: boolean): Promise<Account[]> {
    await this.authorize(userId, groupId, 'read', 'Account');
    return this.accounts.find({
      where: includeArchived ? { groupId } : { groupId, archived: false },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
  }

  async get(userId: string, groupId: string, accountId: string): Promise<Account> {
    await this.authorize(userId, groupId, 'read', 'Account');
    return this.findOrFail(groupId, accountId);
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateAccountInput): Promise<Account> {
    await this.authorize(userId, groupId, 'create', 'Account');
    const account = this.accounts.create({
      ...input,
      type: input.type as AccountType | undefined,
      groupId,
      createdBy: userId,
    });
    return this.accounts.save(account);
  }

  @Transactional()
  async update(userId: string, groupId: string, accountId: string, patch: UpdateAccountInput): Promise<Account> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { ...patch, type: patch.type as AccountType | undefined });
    return this.findOrFail(groupId, accountId);
  }

  @Transactional()
  async archive(userId: string, groupId: string, accountId: string): Promise<Account> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { archived: true, archivedAt: new Date() });
    return this.findOrFail(groupId, accountId);
  }

  @Transactional()
  async restore(userId: string, groupId: string, accountId: string): Promise<Account> {
    await this.authorize(userId, groupId, 'update', 'Account');
    await this.findOrFail(groupId, accountId);
    await this.accounts.update({ id: accountId, groupId }, { archived: false, archivedAt: null });
    return this.findOrFail(groupId, accountId);
  }

  @Transactional()
  async remove(userId: string, groupId: string, accountId: string): Promise<Account> {
    await this.authorize(userId, groupId, 'delete', 'Account');
    const account = await this.findOrFail(groupId, accountId);
    await this.accounts.softDelete({ id: accountId, groupId });
    return account;
  }

  @Transactional()
  async upsertTarget(
    userId: string,
    groupId: string,
    accountId: string,
    input: UpsertAccountTargetInput,
  ): Promise<AccountTarget> {
    await this.authorize(userId, groupId, 'update', 'AccountTarget');
    await this.findOrFail(groupId, accountId);

    const existing = await this.targets.findOneBy({ accountId });
    const target = this.targets.create({
      accountId,
      limitAmount: input.limitAmount !== undefined ? input.limitAmount : (existing?.limitAmount ?? null),
      goalAmount: input.goalAmount !== undefined ? input.goalAmount : (existing?.goalAmount ?? null),
    });
    return this.targets.save(target);
  }

  private async findOrFail(groupId: string, accountId: string): Promise<Account> {
    const account = await this.accounts.findOneBy({ id: accountId, groupId });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  private async authorize(userId: string, groupId: string, action: Action, subject: Subject): Promise<void> {
    const ctx = await this.abilities.forGroup(userId, groupId);
    assertCan(ctx.ability, action, subject);
  }
}

function assertCan(ability: AppAbility, action: Action, subject: Subject): void {
  if (!ability.can(action, subject)) {
    throw new ForbiddenException(`Not allowed to ${action} ${subject}`);
  }
}
