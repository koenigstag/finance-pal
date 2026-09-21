import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional';
import { ScheduledNotification } from '@ft/api-database';
import type { Action } from '@ft/shared-contracts';
import { AbilityFactory } from '../_core/authz/ability.factory';

export interface CreateScheduledNotificationInput {
  text: string;
  sendAt: string;
  timezone: string;
}

// How far back a note that has been sent stays in the list: long enough to answer "did it go
// out?", short enough that a group scheduling one a week doesn't scroll through a year of them.
const KEEP_SENT_DAYS = 7;

/**
 * Notes a group schedules for a moment that hasn't come yet. They belong to the group, not to
 * whoever wrote them: anyone in it sees what is coming, and anyone who may record money in it may
 * schedule one or call one off — the same rule the ledger's own rows follow, and the same one the
 * RLS policies on the table enforce whatever these queries ask for.
 */
@Injectable()
export class ScheduledNotificationsService {
  constructor(
    @InjectRepository(ScheduledNotification) private readonly notifications: Repository<ScheduledNotification>,
    private readonly abilities: AbilityFactory,
  ) {}

  /**
   * What is still to come, soonest first, then the last week's, so that a note already sent can
   * be seen off without pushing what matters — the next one — down the list.
   */
  async list(userId: string, groupId: string): Promise<ScheduledNotification[]> {
    // 404 for a group the caller isn't in, like every other group-scoped read.
    await this.abilities.forGroup(userId, groupId);
    return this.notifications
      .createQueryBuilder('n')
      .where('n.group_id = :groupId', { groupId })
      .andWhere(`(n.sent_at IS NULL OR n.sent_at > now() - make_interval(days => :days))`, { days: KEEP_SENT_DAYS })
      .orderBy('(n.sent_at IS NULL)', 'DESC')
      .addOrderBy('n.send_at', 'ASC')
      .getMany();
  }

  @Transactional()
  async create(userId: string, groupId: string, input: CreateScheduledNotificationInput): Promise<ScheduledNotification> {
    await this.authorize(userId, groupId, 'create');

    const sendAt = new Date(input.sendAt);
    // A moment that has passed would go out on the scheduler's next tick, which is not what
    // anybody picking a date and a time meant by it.
    if (sendAt <= new Date()) {
      throw new BadRequestException('sendAt must be in the future');
    }

    return this.notifications.save(
      this.notifications.create({
        groupId,
        text: input.text,
        sendAt,
        timezone: input.timezone,
        // Explicit rather than left to the column default: save() hands back this object.
        sentAt: null,
        createdBy: userId,
      }),
    );
  }

  /** Calling one off, or clearing one that has already gone out from the list. */
  @Transactional()
  async remove(userId: string, groupId: string, notificationId: string): Promise<ScheduledNotification> {
    await this.authorize(userId, groupId, 'delete');
    const notification = await this.findOrFail(groupId, notificationId);
    await this.notifications.delete({ id: notificationId, groupId });
    return notification;
  }

  private async authorize(userId: string, groupId: string, action: Action): Promise<void> {
    const { ability } = await this.abilities.forGroup(userId, groupId);
    if (!ability.can(action, 'ScheduledNotification')) {
      throw new ForbiddenException(`Not allowed to ${action} a scheduled notification`);
    }
  }

  private async findOrFail(groupId: string, notificationId: string): Promise<ScheduledNotification> {
    const notification = await this.notifications.findOneBy({ id: notificationId, groupId });
    if (!notification) {
      throw new NotFoundException('Scheduled notification not found');
    }
    return notification;
  }
}
