import { describe, expect, it } from 'vitest';
import { CATEGORY_COLORS, CATEGORY_ICONS, categoryColor, defaultAppearance } from './category-appearance';

// The icons the onboarding starter templates store (apps/api onboarding templates).
const TEMPLATE_ICONS = [
  'briefcase', 'laptop', 'gift', 'trending-up', 'dots-horizontal', 'shopping-cart', 'car', 'home',
  'bolt', 'heart', 'film', 'coffee', 'book', 'bag', 'key',
];

describe('category appearance', () => {
  it('has an icon for every name the starter templates use', () => {
    expect(TEMPLATE_ICONS.filter((name) => !CATEGORY_ICONS[name])).toEqual([]);
  });

  it('accepts only #RRGGBB colors', () => {
    expect(categoryColor('#4CAF50')).toBe('#4CAF50');
    expect(categoryColor('#4caf50')).toBe('#4caf50');
    expect(categoryColor('red')).toBeNull();
    expect(categoryColor('#FFF')).toBeNull();
    expect(categoryColor(null)).toBeNull();
  });

  it("gives a subcategory its parent's look", () => {
    expect(defaultAppearance({ icon: 'car', color: '#2196F3' }, 5)).toEqual({ icon: 'car', color: '#2196F3' });
  });

  it('cycles the palette for top-level categories', () => {
    expect(defaultAppearance(undefined, 0)).toEqual({ icon: null, color: CATEGORY_COLORS[0] });
    expect(defaultAppearance(undefined, CATEGORY_COLORS.length + 1).color).toBe(CATEGORY_COLORS[1]);
  });
});
