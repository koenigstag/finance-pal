import { endOfDay } from 'date-fns';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AccountList } from '@/features/accounts/account-list';
import { useAccounts } from '@/features/accounts/queries';
import { useCategories } from '@/features/categories/queries';
import { useGroupScope } from '@/features/groups/group-context';
import { useTransactionPages, type Transaction } from '@/features/transactions/queries';
import { TransactionDialog } from '@/features/transactions/transaction-dialog';
import { TransactionList } from '@/features/transactions/transaction-list';

const RECENT_LIMIT = 10;

export function GroupHome() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const accounts = useAccounts(group.id);
  const categories = useCategories(group.id);
  // "Recent" stops at the end of today: planned occurrences further out would otherwise crowd the
  // top, while something just added for today must still show up. Fixed for the page's lifetime,
  // since a new cutoff each render would be a new query.
  const [recentUntil] = useState(() => endOfDay(new Date()).toISOString());
  const recentFilters = useMemo(() => ({ dateTo: recentUntil, limit: RECENT_LIMIT }), [recentUntil]);
  const recent = useTransactionPages(group.id, recentFilters);
  const [dialog, setDialog] = useState<{ open: boolean; transaction?: Transaction }>({ open: false });
  const canCreate = ability.can('create', 'Transaction');
  const canUpdate = ability.can('update', 'Transaction');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t(`groups.roles.${group.role}`)}
            {!canCreate && ` · ${t('groups.readOnly')}`}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setDialog({ open: true })}>
            <PlusIcon />
            {t('transactions.new')}
          </Button>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t('accounts.title')} to={`/g/${group.id}/accounts`} />
        {accounts.isPending ? (
          <Spinner className="mx-auto size-6 text-muted-foreground" />
        ) : accounts.isError ? (
          <QueryError onRetry={() => void accounts.refetch()} />
        ) : accounts.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('accounts.empty.title')}</p>
        ) : (
          <AccountList groupId={group.id} accounts={accounts.data} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t('home.recent')} to={`/g/${group.id}/transactions`} />
        {recent.isPending ? (
          <Spinner className="mx-auto size-6 text-muted-foreground" />
        ) : recent.isError ? (
          <QueryError onRetry={() => void recent.refetch()} />
        ) : recent.data.pages[0].items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('transactions.empty.title')}</p>
        ) : (
          <TransactionList
            transactions={recent.data.pages[0].items}
            accounts={accounts.data ?? []}
            categories={categories.data ?? []}
            onSelect={canUpdate ? (transaction) => setDialog({ open: true, transaction }) : undefined}
          />
        )}
      </section>

      <TransactionDialog
        groupId={group.id}
        transaction={dialog.transaction}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </div>
  );
}

function SectionHeader({ title, to }: { title: string; to: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <Button variant="link" size="sm" asChild>
        <Link to={to}>{t('home.seeAll')}</Link>
      </Button>
    </div>
  );
}
