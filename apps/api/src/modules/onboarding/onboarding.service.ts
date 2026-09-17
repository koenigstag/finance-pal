import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, Category, Profile, User } from '@ft/api-database';
import { ACCOUNT_TEMPLATES } from './templates/account-templates.const';
import { CATEGORY_TEMPLATES } from './templates/category-templates.const';
import { DEFAULT_VALUES, ONBOARDING_REQUIRED_FIELDS } from './onboarding.const';

export interface OnboardingStatus {
  isOnboarded: boolean;
  missingFields: string[];
}

export interface ProfileUpdate {
  displayName?: string;
  startDayOfWeek?: number;
  mainCurrencyId?: number;
  language?: string;
  exchangeRates?: Record<string, string> | null;
}

export interface SeedResult {
  accountsCreated: number;
  categoriesCreated: number;
}

@Injectable()
export class OnboardingService {
  constructor(
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  getProfile(userId: string): Promise<Profile | null> {
    return this.profiles.findOneBy({ id: userId });
  }

  async getStatus(userId: string): Promise<OnboardingStatus> {
    const profile = await this.profiles.findOneBy({ id: userId });
    const missingFields = ONBOARDING_REQUIRED_FIELDS.filter((field) => !profile || profile[field] == null);
    return { isOnboarded: missingFields.length === 0, missingFields };
  }

  // Same call for first-time onboarding and for filling in a field added after a profile
  // already exists — see ONBOARDING_REQUIRED_FIELDS for why that's the point.
  @Transactional()
  async upsertProfile(userId: string, patch: ProfileUpdate): Promise<Profile> {
    const existing = await this.profiles.findOneBy({ id: userId });
    if (existing) {
      await this.profiles.update({ id: userId }, patch);
      return { ...existing, ...patch };
    }

    const user = await this.users.findOneBy({ id: userId });
    if (!user) {
      // Unreachable in practice — JwtAuthGuard already resolved this userId from a valid
      // token — but findOneByOrFail's error wouldn't explain why, so this is more honest.
      throw new NotFoundException('User not found');
    }

    return this.profiles.save(
      this.profiles.create({
        id: userId,
        email: user.email,
        mainCurrencyId: patch.mainCurrencyId ?? DEFAULT_VALUES.currencyId,
        language: patch.language ?? DEFAULT_VALUES.language,
        displayName: patch.displayName ?? null,
        startDayOfWeek: patch.startDayOfWeek ?? null,
        exchangeRates: patch.exchangeRates ?? null,
      }),
    );
  }

  /**
   * Populates a group with starter accounts/categories from the onboarding templates. Pure
   * mechanics only — authorizing the caller against this group is GroupsService's job (the
   * same "load membership, check CASL" step every other group mutation goes through), not
   * onboarding's.
   */
  @Transactional()
  async seedGroup(groupId: string, userId: string, requestedLanguage?: string): Promise<SeedResult> {
    const alreadySeeded = await this.accounts.exists({ where: { groupId } });
    if (alreadySeeded) {
      throw new ConflictException('Group already has accounts — seed only applies to a fresh group');
    }

    // The starter accounts follow the caller's own profile: someone who picked EUR during
    // onboarding shouldn't find their first accounts in USD. Defaults only cover a caller who
    // seeds before creating a profile.
    const profile = await this.profiles.findOneBy({ id: userId });
    const currencyId = profile?.mainCurrencyId ?? DEFAULT_VALUES.currencyId;
    const language = requestedLanguage ?? profile?.language ?? DEFAULT_VALUES.language;

    const accountRows = ACCOUNT_TEMPLATES.filter((t) => t.lang === language).map((t) =>
      this.accounts.create({
        groupId,
        createdBy: userId,
        currencyId,
        type: t.type,
        name: t.name,
        icon: t.icon,
        color: t.color,
        sortOrder: t.sortOrder,
      }),
    );
    await this.accounts.save(accountRows);

    const categoryRows = CATEGORY_TEMPLATES.filter((t) => t.lang === language).map((t) =>
      this.categories.create({
        groupId,
        createdBy: userId,
        type: t.type,
        name: t.name,
        icon: t.icon,
        color: t.color,
        sortOrder: t.sortOrder,
      }),
    );
    await this.categories.save(categoryRows);

    return { accountsCreated: accountRows.length, categoriesCreated: categoryRows.length };
  }
}
