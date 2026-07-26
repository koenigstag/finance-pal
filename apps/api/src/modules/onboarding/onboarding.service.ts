import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { Account, Category, Profile, User } from '@ft/api-database';
import { GroupsService } from '../groups/groups.service';
import { ACCOUNT_TEMPLATES } from './templates/account-templates.const';
import { CATEGORY_TEMPLATES } from './templates/category-templates.const';
import { DEFAULT_VALUES } from './onboarding.const';

export interface OnboardingResult {
  profile: Profile;
  groupId: string;
}

@Injectable()
export class OnboardingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Profile) private readonly profiles: Repository<Profile>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly groupsService: GroupsService,
  ) {}

  /**
   * Creates everything a brand-new user needs: a profile, a default group they own, and that
   * group's starter accounts/categories. Called from AuthService.register(), which runs on a
   * @Public() route — no JWT exists yet for RlsContextInterceptor to act on, so this sets
   * app.current_user_id itself before touching any RLS-protected table, exactly the way the
   * interceptor would for an authenticated request (see its doc comment, which anticipates
   * this exact call site).
   */
  @Transactional()
  async seedNewUser(user: User, language: string = DEFAULT_VALUES.language): Promise<OnboardingResult> {
    await this.dataSource.query(`SELECT set_config('app.current_user_id', $1, true)`, [user.id]);

    const profile = await this.profiles.save(
      this.profiles.create({
        id: user.id,
        email: user.email,
        mainCurrencyId: DEFAULT_VALUES.currencyId,
        language,
      }),
    );

    const { group } = await this.groupsService.create(user.id, DEFAULT_VALUES.groupName);

    const accountRows = ACCOUNT_TEMPLATES.filter((t) => t.lang === language).map((t) =>
      this.accounts.create({
        groupId: group.id,
        createdBy: user.id,
        currencyId: DEFAULT_VALUES.currencyId,
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
        groupId: group.id,
        createdBy: user.id,
        type: t.type,
        name: t.name,
        icon: t.icon,
        color: t.color,
        sortOrder: t.sortOrder,
      }),
    );
    await this.categories.save(categoryRows);

    return { profile, groupId: group.id };
  }
}
