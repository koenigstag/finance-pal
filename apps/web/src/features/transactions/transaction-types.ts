import type { TRANSACTION_TYPES } from '@ft/shared-contracts';
import { ArrowDownIcon, ArrowLeftRightIcon, ArrowUpIcon, type LucideIcon } from 'lucide-react';

type TransactionType = (typeof TRANSACTION_TYPES)[number];

// How types are listed in the form and the filter. A UI choice, independent of the order of the
// contract's enum.
export const TRANSACTION_TYPE_ORDER = ['income', 'expense', 'transfer'] as const satisfies readonly TransactionType[];

// Money coming in points up, going out points down; a transfer moves it sideways.
export const TRANSACTION_TYPE_ICONS: Record<TransactionType, LucideIcon> = {
  income: ArrowUpIcon,
  expense: ArrowDownIcon,
  transfer: ArrowLeftRightIcon,
};
