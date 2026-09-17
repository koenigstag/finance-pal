import type { en } from './en';

// Same shape as `en` with any string values — see the comment there.
type Catalog<T> = { [K in keyof T]: T[K] extends string ? string : Catalog<T[K]> };

export const ru: Catalog<typeof en> = {
  app: {
    name: 'Финансовый трекер',
    tagline: 'Личные и общие бюджеты',
    getStarted: 'Начать',
  },
};
