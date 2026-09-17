import { HouseIcon, ReceiptTextIcon, WalletIcon, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  // Home is the group's index route, which every other route would also match.
  end: boolean;
}

function useNavItems(groupId: string): NavItem[] {
  const { t } = useTranslation();
  return [
    { to: `/g/${groupId}`, label: t('nav.home'), icon: HouseIcon, end: true },
    { to: `/g/${groupId}/accounts`, label: t('nav.accounts'), icon: WalletIcon, end: false },
    { to: `/g/${groupId}/transactions`, label: t('nav.transactions'), icon: ReceiptTextIcon, end: false },
  ];
}

/** Tabs under the header, from md up. Phones get BottomNav instead. */
export function TopNav({ groupId }: { groupId: string }) {
  const items = useNavItems(groupId);

  return (
    <nav className="hidden border-b md:block">
      <div className="mx-auto flex max-w-5xl gap-1 px-4">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors',
                isActive
                  ? 'border-primary font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )
            }
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/**
 * A tab bar fixed to the bottom of the screen on phones, within thumb reach. Pads itself for the
 * home indicator (safe-area inset), which index.html's viewport-fit=cover exposes.
 */
export function BottomNav({ groupId }: { groupId: string }) {
  const items = useNavItems(groupId);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/80 md:hidden">
      <div className="grid grid-cols-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors',
                isActive ? 'font-medium text-foreground' : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="size-5" />
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
