// The app's colors for amounts: money coming in or held (green), going out or owed (red), and
// neither — a zero balance, or a transfer that only moves money between accounts (gray). Full
// class names, written out, so Tailwind finds them.
export const MONEY_COLORS = {
  positive: 'text-[#39998b]',
  negative: 'text-[#c0668a]',
  neutral: 'text-[#95949a]',
} as const;

/** For a balance or any signed amount, by its sign. */
export function signColor(sign: -1 | 0 | 1): string {
  return sign > 0 ? MONEY_COLORS.positive : sign < 0 ? MONEY_COLORS.negative : MONEY_COLORS.neutral;
}

/** For a transaction's amount, by what it does to the money. */
export function transactionTypeColor(type: 'income' | 'expense' | 'transfer'): string {
  return type === 'income' ? MONEY_COLORS.positive : type === 'expense' ? MONEY_COLORS.negative : MONEY_COLORS.neutral;
}
