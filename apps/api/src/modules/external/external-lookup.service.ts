import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account, Category, CategoryRule, Currency } from '@ft/api-database';

/**
 * What the external API reads besides the ledger services themselves: a group's accounts and
 * categories to resolve names against, and currency codes, which is how it speaks of currencies
 * instead of the app's internal ids. Every read runs under RLS as the key's owner, in the
 * request's transaction — one query after another, since that transaction holds one connection.
 */
@Injectable()
export class ExternalLookupService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Currency) private readonly currencies: Repository<Currency>,
    @InjectRepository(CategoryRule) private readonly categoryRules: Repository<CategoryRule>,
  ) {}

  // Archived ones included: a request may still name them, if nothing active has the name.
  accountsOf(groupId: string): Promise<Account[]> {
    return this.accounts.find({ where: { groupId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  categoriesOf(groupId: string): Promise<Category[]> {
    return this.categories.find({ where: { groupId }, order: { sortOrder: 'ASC', createdAt: 'ASC' } });
  }

  categoryRulesOf(groupId: string): Promise<CategoryRule[]> {
    return this.categoryRules.find({ where: { groupId } });
  }

  async currencyCodes(): Promise<CurrencyCodes> {
    const currencies = await this.currencies.find();
    return new CurrencyCodes(new Map(currencies.map((currency) => [currency.id, currency.code])));
  }

  async currencyIdOf(code: string): Promise<number> {
    const currency = await this.currencies.findOneBy({ code });
    if (!currency) {
      throw new BadRequestException(`Unknown currency "${code}"`);
    }
    return currency.id;
  }
}

export class CurrencyCodes {
  constructor(private readonly byId: ReadonlyMap<number, string>) {}

  of(currencyId: number): string {
    const code = this.byId.get(currencyId);
    // currency_id is a foreign key into the table these came from.
    if (code === undefined) {
      throw new Error(`Currency ${currencyId} is missing`);
    }
    return code;
  }
}
