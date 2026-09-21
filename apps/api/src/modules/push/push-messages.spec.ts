import { formatAmount, renderPushMessage, topicFor, type PushMessage } from './push-messages';

const GROUP_ID = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

const recorded: PushMessage = {
  kind: 'transaction.recorded',
  groupId: GROUP_ID,
  groupName: 'Household',
  actor: 'Anna',
  type: 'expense',
  amount: '450.00',
  currency: 'UAH',
};

describe('renderPushMessage', () => {
  it('titles a notification with the group and links to its transactions', () => {
    const payload = renderPushMessage(recorded, 'en');

    expect(payload.title).toBe('Household');
    expect(payload.body).toMatch(/Anna/);
    expect(payload.body).toMatch(/450/);
    // Relative to the app's scope, so it also lands right under a project path on GitHub Pages.
    expect(payload.path).toBe(`g/${GROUP_ID}/transactions`);
  });

  it('writes in the recipient\'s language, not the language of whoever set it off', () => {
    expect(renderPushMessage(recorded, 'ru').body).toMatch(/Anna потратил/);
  });

  it('reads a language with a region as the language', () => {
    expect(renderPushMessage(recorded, 'ru-RU').body).toMatch(/потратил/);
  });

  it('falls back to English for a language it has no words in', () => {
    expect(renderPushMessage(recorded, 'fr').body).toMatch(/^Anna spent/);
  });

  it('names someone who has no display name rather than leaving a gap', () => {
    expect(renderPushMessage({ ...recorded, actor: null }, 'en').body).toMatch(/^Someone spent/);
    expect(renderPushMessage({ ...recorded, actor: null }, 'ru').body).toMatch(/^Кто-то/);
  });

  it('tells income, expense and transfer apart', () => {
    expect(renderPushMessage({ ...recorded, type: 'income' }, 'en').body).toMatch(/received/);
    expect(renderPushMessage({ ...recorded, type: 'transfer' }, 'en').body).toMatch(/moved/);
  });

  it('gives notifications about one group the same tag, so a later one replaces the last', () => {
    const first = renderPushMessage(recorded, 'en');
    const second = renderPushMessage({ ...recorded, amount: '12.00' }, 'en');

    expect(first.tag).toBe(second.tag);
    expect(renderPushMessage({ ...recorded, groupId: GROUP_ID.replace('3f', '4f') }, 'en').tag).not.toBe(first.tag);
  });

  it('keeps the kinds apart, so a notification never replaces one about something else', () => {
    const tags = [
      renderPushMessage(recorded, 'en').tag,
      renderPushMessage({ kind: 'planned.recorded', groupId: GROUP_ID, groupName: 'Household', type: 'expense', amount: '12.00', currency: 'UAH' }, 'en').tag,
      renderPushMessage({ kind: 'member.added', groupId: GROUP_ID, groupName: 'Household', actor: 'Anna' }, 'en').tag,
    ];

    expect(new Set(tags).size).toBe(tags.length);
  });

  it('announces a planned transaction without an actor', () => {
    const payload = renderPushMessage(
      { kind: 'planned.recorded', groupId: GROUP_ID, groupName: 'Household', type: 'expense', amount: '12000.00', currency: 'UAH' },
      'en',
    );

    expect(payload.title).toBe('Household');
    expect(payload.body).toMatch(/^A planned expense of/);
  });

  it("passes a scheduled note's own words through, untranslated", () => {
    const note = { kind: 'scheduled.due' as const, id: 'a1', groupId: GROUP_ID, groupName: 'Household', text: 'Rent goes out tomorrow' };

    // The same words whichever language the recipient reads the app in: they are not ours.
    expect(renderPushMessage(note, 'en').body).toBe('Rent goes out tomorrow');
    expect(renderPushMessage(note, 'ru')).toMatchObject({ title: 'Household', body: 'Rent goes out tomorrow' });
  });

  it('gives each scheduled note its own tag, so two due together are both read', () => {
    const note = { kind: 'scheduled.due' as const, id: 'a1', groupId: GROUP_ID, groupName: 'Household', text: 'One' };
    const other = { ...note, id: 'b2', text: 'Two' };

    expect(renderPushMessage(note, 'en').tag).not.toBe(renderPushMessage(other, 'en').tag);
  });

  it('sends whoever was added to a group to that group', () => {
    const payload = renderPushMessage({ kind: 'member.added', groupId: GROUP_ID, groupName: 'Household', actor: 'Anna' }, 'en');

    expect(payload.body).toBe('Anna added you to this group');
    expect(payload.path).toBe(`g/${GROUP_ID}`);
  });

  it('opens the app where it was left for the test notification', () => {
    expect(renderPushMessage({ kind: 'push.test' }, 'en').path).toBeUndefined();
    expect(renderPushMessage({ kind: 'push.test' }, 'ru').body).toMatch(/Уведомления/);
  });
});

describe('topicFor', () => {
  it('routes each kind to the switch it answers to', () => {
    expect(topicFor({ kind: 'scheduled.due', id: 'a1', groupId: GROUP_ID, groupName: 'Household', text: 'Rent' })).toBe(
      'scheduled',
    );
    expect(topicFor(recorded)).toBe('transactions');
    expect(topicFor({ kind: 'member.added', groupId: GROUP_ID, groupName: 'Household', actor: null })).toBe('members');
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
