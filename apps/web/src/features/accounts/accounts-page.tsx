import { BanknoteIcon, ChevronDownIcon, HandshakeIcon, PlusIcon, SigmaIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';
import { PAGE_BOTTOM_SPACE, PageHeader } from '@/components/page-header';
import { QueryError } from '@/components/query-error';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useGroupScope } from '@/features/groups/group-context';
import { useSwipeTrack } from '@/lib/swipe';
import type { TransactionFormValues } from '@/features/transactions/transaction-form-model';
import { TransactionDialog } from '@/features/transactions/transaction-dialog';
import { pickDefaultAccountId } from '@/features/transactions/transaction-form-model';
import { AccountActionsSheet, type AccountAction } from './account-actions-sheet';
import { AccountDialog } from './account-dialog';
import { AccountList, AccountRows } from './account-list';
import { AccountsSummary } from './accounts-summary';
import { useAccounts, type Account } from './queries';
import { cn } from '@/lib/utils';

// What each tab shows: the money on hand, what's owed and owing, or everything at once.
const TAB_TYPES = {
  balance: ['regular', 'savings'],
  debts: ['debt'],
  total: ['regular', 'savings', 'debt'],
} as const satisfies Record<string, readonly Account['type'][]>;

type AccountsTab = keyof typeof TAB_TYPES;

const TAB_ORDER = ['balance', 'debts', 'total'] as const satisfies readonly AccountsTab[];

// Cash for the money on hand, a handshake for what people owe each other — not the two arrows,
// which already mean a transfer — and a sum for everything added up.
const TAB_ICONS: Record<AccountsTab, LucideIcon> = { balance: BanknoteIcon, debts: HandshakeIcon, total: SigmaIcon };

export function AccountsPage() {
  const { t } = useTranslation();
  const { group, ability } = useGroupScope();
  // Archived ones too: they're kept out of the tabs and put away in a fold of their own.
  const accounts = useAccounts(group.id, true);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // In the URL, so a reload or the back button returns to the same tab.
  const tab: AccountsTab = TAB_ORDER.find((option) => option === params.get('tab')) ?? 'balance';
  const [dialog, setDialog] = useState<{ open: boolean; account?: Account }>({ open: false });
  // By id, so the sheet shows the account as the cache has it now (a star or balance just changed).
  const [sheet, setSheet] = useState<{ open: boolean; accountId?: string }>({ open: false });
  const [newTransaction, setNewTransaction] = useState<{
    open: boolean;
    accountId?: string;
    toAccountId?: string;
    type?: TransactionFormValues['type'];
  }>({ open: false });
  const canCreate = ability.can('create', 'Account');
  const canUpdate = ability.can('update', 'Account');
  const canDelete = ability.can('delete', 'Account');
  const canAddTransactions = ability.can('create', 'Transaction');

  // A list per tab rather than just the one on screen: the tabs either side are rendered while
  // the strip is being dragged, and they all come out of the accounts already fetched.
  const byTab = useMemo(() => {
    const live = (accounts.data ?? []).filter((account) => !account.archived);
    return Object.fromEntries(
      TAB_ORDER.map((option) => [option, live.filter((account) => TAB_TYPES[option].some((type) => type === account.type))]),
    ) as Record<AccountsTab, Account[]>;
  }, [accounts.data]);
  const archived = useMemo(() => (accounts.data ?? []).filter((account) => account.archived), [accounts.data]);

  // The tabs sit side by side in the order they are listed in, so dragging the strip left moves
  // to the next tab along and dragging it right to the one before. Unlike the months there is a
  // first and a last, and a drag towards nothing gives a little and comes back.
  const tabIndex = TAB_ORDER.indexOf(tab);
  const strip = useSwipeTrack({
    count: TAB_ORDER.length,
    index: tabIndex,
    position: tab,
    onCommit: (delta) => setParams({ tab: TAB_ORDER[tabIndex + delta] }, { replace: true }),
  });

  // The sheet closes first; each action then opens its own dialog or page.
  const onAction = (action: AccountAction, account: Account) => {
    setSheet((current) => ({ ...current, open: false }));
    if (action === 'edit') {
      setDialog({ open: true, account });
    } else if (action === 'transactions') {
      void navigate(`/g/${group.id}/transactions?account=${account.id}`);
    } else if (action === 'give' || action === 'receive') {
      // Your side of it: the account you would normally pay from, never another person's.
      const yours = pickDefaultAccountId(
        (accounts.data ?? []).filter((candidate) => candidate.type !== 'debt' && !candidate.archived),
      );
      setNewTransaction(
        action === 'give'
          ? { open: true, type: 'transfer', accountId: yours, toAccountId: account.id }
          : { open: true, type: 'transfer', accountId: account.id, toAccountId: yours },
      );
    } else {
      setNewTransaction({ open: true, accountId: account.id, type: action });
    }
  };

  const tabContent = (option: AccountsTab) => {
    const visible = byTab[option];
    if (visible.length === 0 && !(option === 'balance' && archived.length > 0)) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <WalletIcon />
            </EmptyMedia>
            <EmptyTitle>{t('accounts.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('accounts.empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      );
    }
    // Total is the shape of it — what's held, in what, and what's owed — rather than a fourth
    // copy of the list, which the other two tabs already give in full.
    if (option === 'total') {
      return <AccountsSummary accounts={visible} />;
    }
    return (
      <div className="flex flex-col gap-4">
        <AccountList accounts={visible} onSelect={(account) => setSheet({ open: true, accountId: account.id })} />
        {/* Closed to begin with: an archived account is there to be looked up, not looked at. */}
        {option === 'balance' && archived.length > 0 && (
          <details className="group flex flex-col gap-1">
            <summary className="flex cursor-pointer list-none items-center gap-1 px-1 text-sm font-medium text-muted-foreground marker:content-none">
              {t('accounts.groups.archived')}
              <span className="tabular-nums">({archived.length})</span>
              <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <div className="pt-1">
              <AccountRows accounts={archived} onSelect={(account) => setSheet({ open: true, accountId: account.id })} />
            </div>
          </details>
        )}
      </div>
    );
  };

  return (
    <section className={cn('flex flex-1 flex-col gap-4', PAGE_BOTTOM_SPACE)}>
      <PageHeader
        title={t('accounts.title')}
        action={canCreate ? { label: t('accounts.new'), icon: PlusIcon, onClick: () => setDialog({ open: true }) } : undefined}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          className="w-full md:w-96"
          value={tab}
          onValueChange={(value) => {
            // Deselecting the active item reports ''; one tab is always chosen.
            if (value) {
              setParams({ tab: value }, { replace: true });
            }
          }}
        >
          {TAB_ORDER.map((option) => {
            const Icon = TAB_ICONS[option];
            return (
              <ToggleGroupItem key={option} value={option} className="flex-1">
                <Icon />
                {t(`accounts.tabs.${option}`)}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </PageHeader>

      {accounts.isPending ? (
        <Spinner className="mx-auto size-6 text-muted-foreground" />
      ) : accounts.isError ? (
        <QueryError onRetry={() => void accounts.refetch()} />
      ) : (
        /*
          The tabs side by side, clipped to the one on screen. The negative margin pays for the
          padding inside each, so the rows stay as wide as the page while a gutter opens between
          one tab and the next as the strip is dragged across, and the strip takes what is left of
          the screen so a tab holding one row can still be swiped off. Only the tab on screen is
          rendered while the strip is still: the others would otherwise scroll the page to the
          length of the longest of them, and they all come from accounts already fetched, so there
          is nothing to load that rendering them early would get ahead of.
        */
        <div {...strip.viewport} className="-mx-2 flex-1 overflow-hidden">
          <div style={strip.track} className="flex w-full items-start">
            {TAB_ORDER.map((option) => (
              // A tab waiting off to the side is to be seen, not read out or tabbed into.
              <div key={option} inert={option !== tab} className="w-full shrink-0 px-2">
                {(option === tab || strip.active) && tabContent(option)}
              </div>
            ))}
          </div>
        </div>
      )}

      <AccountActionsSheet
        groupId={group.id}
        accounts={accounts.data ?? []}
        accountId={sheet.accountId}
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
        defaultToAccountId={newTransaction.toAccountId}
        open={newTransaction.open}
        onOpenChange={(open) => setNewTransaction((current) => ({ ...current, open }))}
      />

      <AccountDialog
        groupId={group.id}
        account={dialog.account}
        accountCount={accounts.data?.length ?? 0}
        canDelete={canDelete}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />
    </section>
  );
}
