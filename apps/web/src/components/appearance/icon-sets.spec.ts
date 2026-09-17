import { describe, expect, it } from 'vitest';
import { iconName, parseIconName, searchIcons } from './icon-sets';

const INDEX: [string, string][] = [
  ['apple', 'Apple'],
  ['paypal', 'PayPal'],
  ['rocket', 'rocket'],
  ['rocket-off', 'rocket-off'],
  ['x', 'X'],
  ['1password', '1Password'],
];

describe('parseIconName', () => {
  it('reads the set a name carries', () => {
    expect(parseIconName('tabler:rocket')).toEqual({ set: 'tabler', name: 'rocket' });
    expect(parseIconName('simple:paypal')).toEqual({ set: 'simple', name: 'paypal' });
  });

  it('leaves a bare name to lucide, as every name stored before the sets existed', () => {
    expect(parseIconName('piggy-bank')).toEqual({ set: null, name: 'piggy-bank' });
  });

  it('keeps a name that only looks prefixed', () => {
    expect(parseIconName('brand:new')).toEqual({ set: null, name: 'brand:new' });
    expect(parseIconName('tabler:')).toEqual({ set: null, name: 'tabler:' });
  });

  it('round-trips through iconName', () => {
    expect(iconName('tabler', 'rocket')).toBe('tabler:rocket');
    expect(iconName(null, 'wallet')).toBe('wallet');
  });
});

describe('searchIcons', () => {
  it('lists the start of the set without a search', () => {
    expect(searchIcons(INDEX, '', 3)).toEqual(['apple', 'paypal', 'rocket']);
  });

  it('puts what starts with the search first, so the results share a shard', () => {
    expect(searchIcons(INDEX, 'rocket', 10)).toEqual(['rocket', 'rocket-off']);
  });

  it('searches the title too, which is how a brand is known', () => {
    expect(searchIcons(INDEX, 'paypal', 10)).toEqual(['paypal']);
    expect(searchIcons(INDEX, '1password', 10)).toEqual(['1password']);
  });

  it('matches every word, in any order', () => {
    expect(searchIcons([['credit-card', 'credit-card']], 'card credit', 10)).toEqual(['credit-card']);
  });

  it('gives back no more than asked for', () => {
    expect(searchIcons(INDEX, '', 2)).toHaveLength(2);
  });
});
