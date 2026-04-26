'use client';

import { useRef, useState } from 'react';

type CopyableUrlFieldProps = {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  fallbackCopyValue?: string;
};

export function CopyableUrlField({
  id,
  name,
  label,
  defaultValue = '',
  placeholder = '',
  fallbackCopyValue = ''
}: CopyableUrlFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);

  const hasCopyValue = Boolean(defaultValue.trim() || fallbackCopyValue.trim());

  async function copyUrl() {
    const currentValue = inputRef.current?.value.trim() || '';
    const nextValue = currentValue || fallbackCopyValue.trim();

    if (!nextValue) {
      return;
    }

    await navigator.clipboard.writeText(nextValue);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <div className="field-stack">
      <div className="inline-row justify-between workflow-copy-label-row">
        <label className="key-value-label" htmlFor={id}>
          {label}
        </label>
        <button
          type="button"
          className="button-secondary button-secondary-compact workflow-copy-button"
          onClick={copyUrl}
          disabled={!hasCopyValue}
        >
          {copied ? 'Copied' : 'Copy URL'}
        </button>
      </div>
      <input
        ref={inputRef}
        id={id}
        className="text-input"
        name={name}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
    </div>
  );
}
