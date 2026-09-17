import { describe, expect, it } from 'vitest';
import { ACCOUNT_ICON_NAMES, CATEGORY_ICON_NAMES, COLORS, ICONS, defaultAppearance, validColor } from './appearance';

// The icons the onboarding starter templates store (apps/api onboarding templates).
const CATEGORY_TEMPLATE_ICONS = [
  'briefcase', 'laptop', 'gift', 'trending-up', 'dots-horizontal', 'shopping-cart', 'car', 'home',
  'bolt', 'heart', 'film', 'coffee', 'book', 'bag', 'key',
];
const ACCOUNT_TEMPLATE_ICONS = ['wallet', 'card'];

describe('appearance', () => {
  it('has an icon for every name the starter templates use', () => {
    expect([...CATEGORY_TEMPLATE_ICONS, ...ACCOUNT_TEMPLATE_ICONS].filter((name) => !ICONS[name])).toEqual([]);
  });

  it('offers every icon to both pickers, each once, accounts leading with money icons', () => {
    const offered = new Set(Object.keys(ICONS));
    offered.delete('credit-card');
    for (const names of [CATEGORY_ICON_NAMES, ACCOUNT_ICON_NAMES]) {
      expect(new Set(names)).toEqual(offered);
      expect(names).toHaveLength(offered.size);
    }
    expect(ACCOUNT_ICON_NAMES.slice(0, 2)).toEqual(['wallet', 'card']);
    expect(CATEGORY_ICON_NAMES[0]).toBe('shopping-cart');
  });

  it('accepts only #RRGGBB colors', () => {
    expect(validColor('#4CAF50')).toBe('#4CAF50');
    expect(validColor('#4caf50')).toBe('#4caf50');
    expect(validColor('red')).toBeNull();
    expect(validColor('#FFF')).toBeNull();
    expect(validColor(null)).toBeNull();
  });

  it("takes a parent's look", () => {
    expect(defaultAppearance({ icon: 'car', color: '#2196F3' }, 5)).toEqual({ icon: 'car', color: '#2196F3' });
  });

  it('cycles the palette otherwise, with an optional fallback icon', () => {
    expect(defaultAppearance(undefined, 0)).toEqual({ icon: null, color: COLORS[0] });
    expect(defaultAppearance(undefined, COLORS.length + 1, 'wallet')).toEqual({ icon: 'wallet', color: COLORS[1] });
  });
});
