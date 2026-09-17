import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Bottom padding for the end of a page's scrolling content: on phones it keeps the last item clear
 * of the floating action button; from md up, a little room before the window's edge.
 */
export const PAGE_BOTTOM_SPACE = 'pb-24 md:pb-8';

interface PageAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
}

interface PageHeaderProps {
  title: ReactNode;
  // The page's primary action, if the caller may perform it.
  action?: PageAction;
}

/**
 * A page's heading and its primary action.
 *
 * The heading itself is never drawn: the navigation — the bottom tabs on a phone, the tabs under
 * the header from md up — already says which page this is, and a title repeating it only takes
 * room from the content. It stays in the page for screen readers, which have no tab bar to read.
 *
 * The action is a regular button above the content from md up; on a phone it becomes a floating
 * button above the bottom navigation, where a thumb reaches it.
 */
export function PageHeader({ title, action }: PageHeaderProps) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      {action && (
        <>
          <div className="hidden justify-end md:flex">
            <Button onClick={action.onClick}>
              <action.icon />
              {action.label}
            </Button>
          </div>
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
    </>
  );
}
