'use client';

import { useState } from 'react';

type CopyableCodeBlockProps = {
  label: string;
  value: string;
  copyButtonLabel?: string;
};

export function CopyableCodeBlock({
  label,
  value,
  copyButtonLabel = 'Copy JSON'
}: CopyableCodeBlockProps) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    if (!value.trim()) {
      return;
    }

    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="field-stack">
      <div className="inline-row justify-between workflow-copy-label-row">
        <span className="key-value-label">{label}</span>
        <button type="button" className="button-secondary button-secondary-compact workflow-copy-button" onClick={copyValue}>
          {copied ? 'Copied' : copyButtonLabel}
        </button>
      </div>
      <pre className="code-block pre-wrap telnyx-code-block">{value}</pre>
    </div>
  );
}
