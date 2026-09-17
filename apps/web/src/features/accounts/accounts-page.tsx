import { PlusIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QueryError } from '@/components/query-error';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useGroupScope } from '@/features/groups/group-context';
import { AccountDialog } from './account-dialog';
import { AccountList } from './account-list';
import { useAccounts, type Account } from './queries';

export function AccountsPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const accounts = useAccounts(group.id);
  const [dialog, setDialog] = useState<{ open: boolean; account?: Account }>({ open: false });
  const canCreate = ability.can('create', 'Account');
  const canUpdate = ability.can('update', 'Account');

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('accounts.title')}</h1>
        {canCreate && (
          <Button onClick={() => setDialog({ open: true })}>
            <PlusIcon />
            {t('accounts.new')}
          </Button>
        )}
      </div>

      {accounts.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : accounts.isError ? (
        <QueryError onRetry={() => void accounts.refetch()} />
      ) : accounts.data.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WalletIcon />
            </EmptyMedia>
            <EmptyTitle>{t('accounts.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('accounts.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <AccountList
          groupId={group.id}
          accounts={accounts.data}
          onEdit={canUpdate ? (account) => setDialog({ open: true, account }) : undefined}
        />
      )}

      <AccountDialog
        groupId={group.id}
        account={dialog.account}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}
