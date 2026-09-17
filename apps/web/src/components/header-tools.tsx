import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface HeaderToolsSlot {
  target: HTMLElement | null;
  setTarget: (element: HTMLElement | null) => void;
}

const HeaderToolsContext = createContext<HeaderToolsSlot | null>(null);

/** Lets a page put controls of its own into the app header, which sits outside the page. */
export function HeaderToolsProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const slot = useMemo(() => ({ target, setTarget }), [target]);
  return <HeaderToolsContext.Provider value={slot}>{children}</HeaderToolsContext.Provider>;
}

/** Where in the header the page's controls appear. Renders nothing outside a provider. */
export function HeaderToolsOutlet({ className }: { className?: string }) {
  const slot = useContext(HeaderToolsContext);
  return slot ? <div ref={slot.setTarget} className={className} /> : null;
}

/** Page controls rendered into the header's outlet, for as long as the page is shown. */
export function HeaderTools({ children }: { children: ReactNode }) {
  const slot = useContext(HeaderToolsContext);
  return slot?.target ? createPortal(children, slot.target) : null;
}
