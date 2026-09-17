import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router/dom';
import i18n from './i18n';
import './lib/zod-messages';
import './styles.css';
import { queryClient } from './lib/query-client';
import { router } from './app/router';
import { startStoreEffects } from './stores/effects';
import { rootStore } from './stores/root-store';
import { StoresProvider } from './stores/stores-context';

startStoreEffects(rootStore, i18n);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <StoresProvider stores={rootStore}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StoresProvider>
  </StrictMode>,
);
