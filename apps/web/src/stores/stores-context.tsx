import { createContext, useContext, type ReactNode } from 'react';
import { rootStore, type RootStore } from './root-store';

// Defaults to the app's instance, so a component rendered without the provider still works;
// the provider exists to hand tests (or stories) their own RootStore.
const StoresContext = createContext<RootStore>(rootStore);

export function StoresProvider({ stores, children }: { stores: RootStore; children: ReactNode }) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
}

/** The client stores. Components reading observables from them must be wrapped in observer(). */
export function useStores(): RootStore {
  return useContext(StoresContext);
}
