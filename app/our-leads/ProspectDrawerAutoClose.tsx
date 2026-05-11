'use client';

import { useEffect } from 'react';

const DRAWER_SELECTOR = '.prospect-add-drawer, .prospect-bulk-drawer';

export function ProspectDrawerAutoClose() {
  useEffect(() => {
    const closeOpenDrawers = (except?: HTMLElement | null) => {
      const drawers = document.querySelectorAll<HTMLDetailsElement>(DRAWER_SELECTOR);
      drawers.forEach((drawer) => {
        if (except && drawer === except) {
          return;
        }
        if (drawer.open) {
          drawer.open = false;
        }
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      const drawers = Array.from(document.querySelectorAll<HTMLDetailsElement>(DRAWER_SELECTOR));
      const interactedDrawer = drawers.find((drawer) => drawer.contains(target));

      if (interactedDrawer) {
        closeOpenDrawers(interactedDrawer);
        return;
      }

      closeOpenDrawers(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeOpenDrawers(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return null;
}
