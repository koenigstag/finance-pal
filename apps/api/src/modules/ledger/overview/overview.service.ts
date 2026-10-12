import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transaction } from '@ft/api-database';
import { AbilityFactory } from '../../_core/authz/ability.factory';
import { totalByDay, type MoneyMoved, type OverviewDayTotal } from './overview-days';

// Each transaction that counts, dated up to now. Expenses and incomes go by the top-level category
// they're filed under (a subcategory's carry their parent's id in category_id as well). A transfer
// counts only between a debt account and one that isn't: into the debt, money was lent out or paid
// back, and so spent; out of it, money was borrowed or paid back to the group, and so received. A
// transfer between two debts only moves what is owed, and one between the group's own accounts
// moves nothing in or out at all.
const MONEY_MOVED_SQL = `
  SELECT t.date,
         t.type::text AS type,
         t.category_id AS "categoryId",
         NULL::uuid AS "accountId",
         t.currency_id AS "currencyId",
         t.amount::text AS amount
  FROM transactions t
  WHERE t.group_id = $1
    AND t.deleted_at IS NULL
    AND t.type IN ('expense', 'income')
    AND t.date >= $2
    AND t.date <= $3
    AND t.date <= now()
  UNION ALL
  SELECT t.date,
         CASE WHEN dest.type = 'debt' THEN 'expense' ELSE 'income' END,
         NULL::uuid,
         CASE WHEN dest.type = 'debt' THEN dest.id ELSE src.id END,
         t.currency_id,
         t.amount::text
  FROM transactions t
  JOIN accounts src ON src.id = t.account_id AND src.deleted_at IS NULL
  JOIN accounts dest ON dest.id = t.to_account_id AND dest.deleted_at IS NULL
  WHERE t.group_id = $1
    AND t.deleted_at IS NULL
    AND t.type = 'transfer'
    AND t.date >= $2
    AND t.date <= $3
    AND t.date <= now()
    AND (src.type = 'debt') <> (dest.type = 'debt')
`;

/** What a group spent and received, day by day, for the overview's charts. */
@Injectable()
export class OverviewService {
  constructor(
    @InjectRepository(Transaction) private readonly transactions: Repository<Transaction>,
    private readonly abilities: AbilityFactory,
  ) {}

  async days(
    userId: string,
    groupId: string,
    { dateFrom, dateTo, timezone }: { dateFrom: string; dateTo: string; timezone: string },
  ): Promise<OverviewDayTotal[]> {
    // Also the 404 for a group the caller isn't in, like every other group-scoped route.
    const { ability } = await this.abilities.forGroup(userId, groupId);
    if (!ability.can('read', 'Transaction')) {
      throw new ForbiddenException('Not allowed to read transactions');
    }
    const rows: MoneyMoved[] = await this.transactions.query(MONEY_MOVED_SQL, [groupId, dateFrom, dateTo]);
    // smallint arrives as a number already; spelled out so a driver change can't turn it into a string.
    return totalByDay(
      rows.map((row) => ({ ...row, currencyId: Number(row.currencyId) })),
      timezone,
    );
  }
}
