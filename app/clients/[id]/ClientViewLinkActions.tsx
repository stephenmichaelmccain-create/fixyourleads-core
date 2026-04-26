'use client';

import { useState } from 'react';

type ClientViewLinkActionsProps = {
  clientViewUrl: string | null;
  variant?: 'default' | 'simple';
};

export function ClientViewLinkActions({ clientViewUrl, variant = 'default' }: ClientViewLinkActionsProps) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    if (!clientViewUrl) {
      return;
    }

    await navigator.clipboard.writeText(clientViewUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className={`client-view-actions${variant === 'simple' ? ' is-simple' : ''}`}>
      <a
        className={`button-secondary button-secondary-compact${clientViewUrl ? '' : ' is-disabled'}`}
        href={clientViewUrl || '#'}
        target="_blank"
        rel="noreferrer"
        aria-disabled={!clientViewUrl}
        onClick={(event) => {
          if (!clientViewUrl) {
            event.preventDefault();
          }
        }}
      >
        Client view
      </a>
      <button
        type="button"
        className="button-secondary button-secondary-compact"
        onClick={copyLink}
        disabled={!clientViewUrl}
      >
        {copied ? 'Copied link' : 'Copy client view link'}
      </button>
    </div>
  );
}
