import { useEffect, useState } from 'react';

/** The part of the screen left to see, against the layout viewport that fixed elements sit in. */
export interface VisibleViewport {
  // How far above the layout viewport's bottom the visible part ends: an on-screen keyboard's
  // height, where the keyboard is drawn over the page. In CSS pixels.
  inset: number;
  // How tall the visible part is, in CSS pixels.
  height: number;
}

function readVisibleViewport(): VisibleViewport | null {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport;
  if (!viewport) {
    return null;
  }
  return {
    // The visible part can be scrolled within the layout viewport too, which iOS does to bring a
    // field into view: that's what offsetTop says, and it leaves less of the bottom covered.
    inset: Math.max(0, Math.round(window.innerHeight - viewport.offsetTop - viewport.height)),
    height: Math.round(viewport.height),
  };
}

/**
 * What of the screen is left to see, followed as it changes, or null where the browser can't say.
 *
 * Android takes the keyboard's room out of the page (index.html asks it to), so `bottom: 0` lands
 * above the keyboard by itself. iOS doesn't: there the keyboard covers the page, the layout
 * viewport keeps its height, and something fixed to its bottom stays where it was, under the
 * keyboard. Only the visual viewport shrinks, and this follows it, so an element can be put above
 * the keyboard by hand. Where the keyboard does resize the page, the inset stays 0.
 */
export function useVisibleViewport(): VisibleViewport | null {
  const [visible, setVisible] = useState(readVisibleViewport);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }
    const update = () => {
      const next = readVisibleViewport();
      // Unchanged figures keep the same object, so nothing re-renders for them.
      setVisible((current) =>
        current && next && current.inset === next.inset && current.height === next.height ? current : next,
      );
    };
    // Whatever changed between the first render and now.
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);

  return visible;
}
