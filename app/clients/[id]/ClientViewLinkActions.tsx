'use client';

import { useState } from 'react';

type ClientViewLinkActionsProps = {
  clientViewPath: string;
  appBaseUrl?: string | null;
};

export function ClientViewLinkActions({ clientViewPath, appBaseUrl }: ClientViewLinkActionsProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    const absoluteUrl =
      appBaseUrl && appBaseUrl.trim()
        ? `${appBaseUrl.replace(/\/$/, '')}${clientViewPath}`
        : `${window.location.origin}${clientViewPath}`;

    await navigator.clipboard.writeText(absoluteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="client-view-actions">
      <a className="button-secondary" href={clientViewPath} target="_blank" rel="noreferrer">
        Open client view
      </a>
      <button type="button" className="button-secondary" onClick={copyLink}>
        {copied ? 'Copied link' : 'Copy client view link'}
      </button>
    </div>
  );
}
