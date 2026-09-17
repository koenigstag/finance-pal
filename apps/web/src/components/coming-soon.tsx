import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/page-header';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

/** A page that has its place in the navigation but isn't built yet. */
export function ComingSoon({ title, icon: Icon }: { title: string; icon: LucideIcon }) {
  const { t } = useTranslation();

  return (
    <section className="flex flex-col gap-4">
      <PageHeader title={title} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyTitle>{t('common.comingSoon.title')}</EmptyTitle>
          <EmptyDescription>{t('common.comingSoon.description')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </section>
  );
}
