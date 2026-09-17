// The English catalog is the source of truth for keys: ru.ts is type-checked against its shape,
// so a key added here and forgotten there fails the build instead of rendering a raw key.
export const en = {
  app: {
    name: 'Finance Tracker',
    tagline: 'Personal and shared budgets',
    getStarted: 'Get started',
  },
} as const;
