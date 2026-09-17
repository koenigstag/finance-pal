import type { TRANSACTION_TYPES } from '@ft/shared-contracts';

type TransactionType = (typeof TRANSACTION_TYPES)[number];

// How types are listed in the form and the filter. A UI choice, independent of the order of the
// contract's enum.
export const TRANSACTION_TYPE_ORDER = ['income', 'expense', 'transfer'] as const satisfies readonly TransactionType[];
