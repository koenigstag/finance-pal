import { PlusIcon, WalletIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useGroupScope } from '@/features/groups/group-context';
import type { TransactionFormValues } from '@/features/transactions/transaction-form-model';
import { pickDefaultAccountId } from '@/features/transactions/transaction-form-model';
import { TransactionDialog } from '@/features/transactions/transaction-dialog';
import { AccountActionsSheet, type AccountAction } from './account-actions-sheet';
import { AccountDialog } from './account-dialog';
import { AccountList } from './account-list';
import { useAccounts, type Account } from './queries';

export function AccountsPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  const accounts = useAccounts(group.id);
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<{ open: boolean; account?: Account }>({ open: false });
  const [sheet, setSheet] = useState<{ open: boolean; account?: Account }>({ open: false });
  const [newTransaction, setNewTransaction] = useState<{
    open: boolean;
    accountId?: string;
    type?: TransactionFormValues['type'];
  }>({ open: false });
  const canCreate = ability.can('create', 'Account');
  const canUpdate = ability.can('update', 'Account');
  const canDelete = ability.can('delete', 'Account');
  const canAddTransactions = ability.can('create', 'Transaction');

  // The sheet closes first; each action then opens its own dialog or page.
  const onAction = (action: AccountAction, account: Account) => {
    setSheet((current) => ({ ...current, open: false }));
    if (action === 'edit') {
      setDialog({ open: true, account });
    } else if (action === 'transactions') {
      void navigate(`/g/${group.id}/transactions?account=${account.id}`);
    } else {
      setNewTransaction({ open: true, accountId: account.id, type: action });
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <PageHeader
        title={t('accounts.title')}
        action={canCreate ? { label: t('accounts.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      />

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
        <AccountList accounts={accounts.data} onSelect={(account) => setSheet({ open: true, account })} />
      )}

      <AccountActionsSheet
        account={sheet.account}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        canEdit={canUpdate}
        canAddTransactions={canAddTransactions}
        onAction={onAction}
      />

      <TransactionDialog
        groupId={group.id}
        defaultAccountId={newTransaction.accountId}
        defaultType={newTransaction.type}
        open={newTransaction.open}
        onOpenChange={(open) => setNewTransaction((current) => ({ ...current, open }))}
      />

      <AccountDialog
        groupId={group.id}
        account={dialog.account}
        accountCount={accounts.data?.length ?? 0}
        implicitFavourite={
          !!dialog.account &&
          !dialog.account.isFavourite &&
          pickDefaultAccountId(accounts.data ?? []) === dialog.account.id
        }
        canDelete={canDelete}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}
