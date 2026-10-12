import { cn } from '@/lib/utils';

interface BudgetBarProps {
  amount: string;
  recorded: string;
  planned: string;
  // Spending has a limit to stay under, so going past it shows as a warning. Income, savings and
  // debts have a figure to reach, and reaching it is good news.
  goal: 'limit' | 'target';
  // What a screen reader hears, as the row reads it: "1 300 ₴ of 15 000 ₴".
  label: string;
}

/**
 * How far a budget line has got: what is recorded as a solid bar, what is still planned this month
 * after it in a lighter shade. Past the amount, the bar is full.
 */
export function BudgetBar({ amount, recorded, planned, goal, label }: BudgetBarProps) {
  // Display only: one conversion per figure, never summed back into anything.
  const whole = Math.max(Number(amount), 0.01);
  const done = Math.min(Math.max(Number(recorded), 0) / whole, 1);
  const ahead = Math.min(Math.max(Number(planned), 0) / whole, 1 - done);
  const past = Number(recorded) + Number(planned) > Number(amount);
  const fill = goal === 'target' ? 'bg-[#39998b]' : past ? 'bg-[#c0668a]' : 'bg-primary';

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(done * 100)}
      className="flex h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <div className={cn('h-full', fill)} style={{ width: `${done * 100}%` }} />
      <div className={cn('h-full opacity-40', fill)} style={{ width: `${ahead * 100}%` }} />
    </div>
  );
}
