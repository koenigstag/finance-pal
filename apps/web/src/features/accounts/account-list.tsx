import { PencilIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { AppearanceIcon } from '@/components/appearance/appearance-icon';
import { Button } from '@/components/ui/button';
import { useCurrencyCodes } from '@/features/currencies/queries';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
import { pickDefaultAccountId } from '@/features/transactions/transaction-form-model';
import { FavouriteToggle } from './favourite-toggle';
import { useSetFavouriteAccount, type Account } from './queries';

interface AccountListProps {
  groupId: string;
  accounts: Account[];
  // Present only for callers allowed to edit.
  onEdit?: (account: Account) => void;
  // Whether the caller may star and unstar accounts.
  canUpdate?: boolean;
}

/** Accounts with their balances; each row opens that account's transactions. */
export function AccountList({ groupId, accounts, onEdit, canUpdate = false }: AccountListProps) {
  const { t, i18n } = useTranslation();
  const currencyCodes = useCurrencyCodes();
  const setFavourite = useSetFavouriteAccount(groupId);
  // The starred account, or the first one when none is: the account new transactions start on.
  const favouriteId = pickDefaultAccountId(accounts);

  return (
    <ul className="divide-y rounded-xl border">
      {accounts.map((account) => {
        const currency = currencyCodes.get(account.currencyId);
        const hasPlanned = account.plannedBalance !== account.balance;
        return (
          <li key={account.id} className="flex items-center gap-2 pr-2">
            <Link
              to={`/g/${groupId}/transactions?account=${account.id}`}
              className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-muted/50"
            >
              <AppearanceIcon icon={account.icon} color={account.color} fallbackIcon="wallet" />
              <div className="min-w-0 flex-1">
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
            <FavouriteToggle
              favourite={account.id === favouriteId}
              // Unstarring hands the default back to the first account; starring the first account
              // while it's only the default pins it, so reordering accounts won't move the default.
              onToggle={
                canUpdate
                  ? () => setFavourite.mutate({ accountId: account.id, isFavourite: !account.isFavourite })
                  : undefined
              }
            />
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
