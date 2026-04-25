'use client';

import { useEffect } from 'react';

type LeadQueueAutoCenterProps = {
  selectedProspectId?: string;
};

export function LeadQueueAutoCenter({ selectedProspectId }: LeadQueueAutoCenterProps) {
  useEffect(() => {
    if (!selectedProspectId) {
      return;
    }

    const selectedLead = document.getElementById('selected-lead');
    if (!selectedLead) {
      return;
    }

    const queueScroller = selectedLead.closest<HTMLElement>('.lead-queue-scroll');
    if (!queueScroller) {
      return;
    }

    const syncToCenter = () => {
      const scrollerBounds = queueScroller.getBoundingClientRect();
      const cardBounds = selectedLead.getBoundingClientRect();
      const targetLeft =
        queueScroller.scrollLeft +
        (cardBounds.left - scrollerBounds.left) -
        (scrollerBounds.width - cardBounds.width) / 2;

      queueScroller.scrollTo({
        left: Math.max(0, targetLeft),
        behavior: 'smooth'
      });
    };

    const frameId = window.requestAnimationFrame(syncToCenter);
    return () => window.cancelAnimationFrame(frameId);
  }, [selectedProspectId]);

  return null;
}
