'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

type LeadSafeSubmitButtonProps = {
  className?: string;
  buttonType?: 'submit' | 'button';
  name?: string;
  value?: string;
  icon: ReactNode;
  label: string;
  meta?: string;
  ariaLabel?: string;
  tone?: string;
  confirmWindowMs?: number;
  onConfirmed?: () => void;
};

export function LeadSafeSubmitButton({
  className = 'lead-command-button',
  buttonType = 'submit',
  name,
  value,
  icon,
  label,
  meta,
  ariaLabel,
  tone,
  onConfirmed,
  confirmWindowMs = 3500
}: LeadSafeSubmitButtonProps) {
  const [isArmed, setIsArmed] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const arm = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }

    setIsArmed(true);
    timeoutRef.current = window.setTimeout(() => {
      setIsArmed(false);
      timeoutRef.current = null;
    }, confirmWindowMs);
  };

  const disarm = () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    setIsArmed(false);
  };

  return (
    <button
      type={buttonType}
      className={className}
      data-armed={isArmed ? 'true' : 'false'}
      data-tone={tone}
      name={name}
      value={value}
      aria-label={ariaLabel || label}
      onClick={(event) => {
        if (!isArmed) {
          event.preventDefault();
          arm();
          return;
        }

        disarm();
        if (buttonType === 'button') {
          event.preventDefault();
          onConfirmed?.();
        }
      }}
      onBlur={() => {
        if (isArmed) {
          disarm();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && isArmed) {
          event.preventDefault();
          disarm();
        }
      }}
    >
      <span className="lead-command-icon">{icon}</span>
      <span className="lead-command-label">{label}</span>
      {isArmed || meta ? (
        <span className="lead-command-meta">{isArmed ? 'Tap again to confirm' : meta}</span>
      ) : null}
    </button>
  );
}
