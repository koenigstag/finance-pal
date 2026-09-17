import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface PageAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  // The page's primary action, if the caller may perform it.
  action?: PageAction;
}

/**
 * A page's title row. The primary action is a regular button beside the title from md up; on a
 * phone it becomes a floating button above the bottom navigation, where a thumb reaches it and it
 * doesn't squeeze the title.
 */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold md:text-2xl">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && (
        <>
          <Button className="hidden md:inline-flex" onClick={action.onClick}>
            <action.icon />
            {action.label}
          </Button>
          <Button
            size="icon-lg"
            aria-label={action.label}
            onClick={action.onClick}
            className="fixed right-4 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 size-14 rounded-full shadow-lg md:hidden [&_svg:not([class*='size-'])]:size-6"
          >
            <action.icon />
          </Button>
        </>
      )}
    </div>
  );
}
