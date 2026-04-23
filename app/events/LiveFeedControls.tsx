'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

function secondsSince(value: string) {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function syncLabel(snapshotAt: string, nowTick: number) {
  void nowTick;

  const elapsed = secondsSince(snapshotAt);

  if (elapsed < 5) {
    return 'just now';
  }

  if (elapsed < 60) {
    return `${elapsed}s ago`;
  }

  const minutes = Math.floor(elapsed / 60);
  return `${minutes}m ago`;
}

export function LiveFeedControls({
  snapshotAt,
  categoryLabel,
  visibleCount,
  latestEventLabel,
  latestEventAt,
  companyName,
  compact = false
}: {
  snapshotAt: string;
  categoryLabel: string;
  visibleCount: number;
  latestEventLabel: string | null;
  latestEventAt: string | null;
  companyName?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [isLive, setIsLive] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(5);
  const [isPending, startTransition] = useTransition();
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTick((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isLive) {
      return;
    }

    const timer = window.setInterval(() => {
      startTransition(() => {
        router.refresh();
      });
    }, intervalSeconds * 1000);

    return () => window.clearInterval(timer);
  }, [intervalSeconds, isLive, router, startTransition]);

  return (
    <section className={`panel panel-stack live-feed-bar${compact ? ' live-feed-bar-compact' : ''}`}>
      <div className="live-feed-header">
        <div className="panel-stack">
          <div className="metric-label">Live feed</div>
          <h2 className="section-title">
            {compact ? 'Auto-refreshing operator feed.' : 'Watch the latest operator activity without reloading the page.'}
          </h2>
          {!compact ? (
            <p className="text-muted">
              {companyName ? `${companyName} live feed` : 'Workspace live feed'} refreshes automatically while this page stays open.
            </p>
          ) : null}
        </div>
        <div className="live-feed-actions">
          <span className={`live-indicator ${isLive ? 'is-live' : 'is-paused'}`}>
            <span className="live-indicator-dot" />
            {isPending ? 'Refreshing' : isLive ? 'Live' : 'Paused'}
          </span>
          <button
            type="button"
            className={isLive ? 'button-secondary' : 'button'}
            onClick={() => setIsLive((value) => !value)}
          >
            {isLive ? 'Pause feed' : 'Resume feed'}
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => {
              startTransition(() => {
                router.refresh();
              });
            }}
          >
            Refresh now
          </button>
        </div>
      </div>

      <div className="live-feed-meta">
        <div className="live-feed-stat">
          <span className="key-value-label">View</span>
          <strong>{categoryLabel}</strong>
          <span className="tiny-muted">{visibleCount} visible events</span>
        </div>
        <div className="live-feed-stat">
          <span className="key-value-label">Last sync</span>
          <strong>{syncLabel(snapshotAt, nowTick)}</strong>
          <span className="tiny-muted">{new Date(snapshotAt).toLocaleTimeString()}</span>
        </div>
        <div className="live-feed-stat">
          <span className="key-value-label">Latest event</span>
          <strong>{latestEventLabel || 'No events yet'}</strong>
          <span className="tiny-muted">
            {latestEventAt ? new Date(latestEventAt).toLocaleString() : 'Waiting for activity'}
          </span>
        </div>
        <label className="live-feed-stat live-feed-interval" htmlFor="live-feed-interval">
          <span className="key-value-label">Refresh rate</span>
          <select
            id="live-feed-interval"
            className="text-input select-input"
            value={intervalSeconds}
            onChange={(event) => setIntervalSeconds(Number(event.currentTarget.value))}
            disabled={!isLive}
          >
            <option value={5}>Every 5 seconds</option>
            <option value={10}>Every 10 seconds</option>
            <option value={20}>Every 20 seconds</option>
            <option value={30}>Every 30 seconds</option>
          </select>
        </label>
      </div>
    </section>
  );
}
