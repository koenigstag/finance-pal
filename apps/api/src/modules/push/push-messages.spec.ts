import { formatAmount, renderPushMessage, topicFor, type PushMessage } from './push-messages';

const GROUP_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const planned: PushMessage = {
  kind: 'planned.recorded',
  groupId: GROUP_ID,
  groupName: 'Household',
  type: 'expense',
  amount: '12000.00',
  currency: 'UAH',
};

const added: PushMessage = {
  kind: 'member.added',
  groupId: GROUP_ID,
  groupName: 'Household',
  actor: 'Anna',
};

describe('renderPushMessage', () => {
  it('titles a notification with the group and links to its transactions', () => {
    const payload = renderPushMessage(planned, 'en');

    expect(payload.title).toBe('Household');
    expect(payload.body).toMatch(/12[\s,]?000/);
    // Relative to the app's scope, so it also lands right under a project path on GitHub Pages.
    expect(payload.path).toBe(`g/${GROUP_ID}/transactions`);
  });

  it("writes in the recipient's language, not the language of whoever set it off", () => {
    expect(renderPushMessage(planned, 'ru').body).toMatch(/^Запланированный расход/);
    expect(renderPushMessage(added, 'ru').body).toMatch(/добавил\(а\) вас/);
  });

  it('reads a language with a region as the language', () => {
    expect(renderPushMessage(planned, 'ru-RU').body).toMatch(/^Запланированный/);
  });

  it('falls back to English for a language it has no words in', () => {
    expect(renderPushMessage(planned, 'fr').body).toMatch(/^A planned expense of/);
  });

  it('tells income, expense and transfer apart', () => {
    expect(renderPushMessage({ ...planned, type: 'income' }, 'en').body).toMatch(/^A planned income of/);
    expect(renderPushMessage({ ...planned, type: 'transfer' }, 'en').body).toMatch(/^A planned transfer of/);
  });

  it('gives notifications about one group the same tag, so a later one replaces the last', () => {
    const first = renderPushMessage(planned, 'en');
    const second = renderPushMessage({ ...planned, amount: '12.00' }, 'en');

    expect(first.tag).toBe(second.tag);
    expect(renderPushMessage({ ...planned, groupId: GROUP_ID.replace('3f', '4f') }, 'en').tag).not.toBe(first.tag);
  });

  it('keeps the two kinds apart, so neither replaces the other', () => {
    expect(renderPushMessage(planned, 'en').tag).not.toBe(renderPushMessage(added, 'en').tag);
  });

  it('sends whoever was added to a group to that group', () => {
    const payload = renderPushMessage(added, 'en');

    expect(payload.title).toBe('Household');
    expect(payload.body).toBe('Anna added you to this group');
    expect(payload.path).toBe(`g/${GROUP_ID}`);
  });

  it('names someone who has no display name rather than leaving a gap', () => {
    expect(renderPushMessage({ ...added, actor: null }, 'en').body).toMatch(/^Someone added/);
    expect(renderPushMessage({ ...added, actor: null }, 'ru').body).toMatch(/^Кто-то/);
  });

  it('opens the app where it was left for the test notification', () => {
    expect(renderPushMessage({ kind: 'push.test' }, 'en').path).toBeUndefined();
    expect(renderPushMessage({ kind: 'push.test' }, 'ru').body).toMatch(/Уведомления/);
  });
});

describe('topicFor', () => {
  it('routes each kind to the switch it answers to', () => {
    expect(topicFor(planned)).toBe('planned');
    expect(topicFor(added)).toBe('members');
  });

  it('gives the test notification no topic, so it reaches every device its owner has', () => {
    expect(topicFor({ kind: 'push.test' })).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats an amount the way the recipient reads amounts', () => {
    expect(formatAmount('450.00', 'UAH', 'en')).toMatch(/450/);
    // A locale that groups with spaces and marks decimals with a comma.
    expect(formatAmount('1234.50', 'UAH', 'ru')).toMatch(/1\s?234,50/);
  });

  it('falls back to the plain amount and code rather than failing over a currency Intl refuses', () => {
    expect(formatAmount('450.00', '!!', 'en')).toBe('450.00 !!');
  });

  it('falls back for an amount that is not a number at all', () => {
    expect(formatAmount('one or two', 'UAH', 'en')).toBe('one or two UAH');
  });
});
