import { PencilIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { Account } from './queries';

interface AccountListProps {
  groupId: string;
  accounts: Account[];
  // Present only for callers allowed to edit.
  onEdit?: (account: Account) => void;
}

/** Accounts with their balances; each row opens that account's transactions. */
export function AccountList({ groupId, accounts, onEdit }: AccountListProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();

  return (
    <ul className="divide-y rounded-xl border">
      {accounts.map((account) => {
        const currency = currencyCodes.get(account.currencyId);
        const hasPlanned = account.plannedBalance !== account.balance;
        return (
          <li key={account.id} className="flex items-center gap-2 pr-2">
            <Link
              to={`/g/${groupId}/transactions?account=${account.id}`}
              className="flex min-w-0 flex-1 items-center justify-between gap-4 px-4 py-3 hover:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{account.name}</p>
                <p className="text-sm text-muted-foreground">
                  {t(`accounts.types.${account.type}`)}
                  {!account.isIncludedInBalance && ` · ${t('accounts.excluded')}`}
                </p>
              </div>
              <div className="text-right">
                <p className={cn('font-medium tabular-nums', account.balance.startsWith('-') && 'text-destructive')}>
                  {formatMoney(account.balance, currency, i18n.language)}
                </p>
                {hasPlanned && (
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {t('accounts.planned', { amount: formatMoney(account.plannedBalance, currency, i18n.language) })}
                  </p>
                )}
              </div>
            </Link>
            {onEdit && (
              <Button variant="ghost" size="icon" aria-label={t('accounts.edit')} onClick={() => onEdit(account)}>
                <PencilIcon />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
