'use client';

import { useMemo, useRef, useState } from 'react';

type CompanySelectorOption = {
  id: string;
  name: string;
  isActive: boolean;
  needsRouting: boolean;
  needsEmail: boolean;
};

export function CompanySelectorForm({
  action,
  label,
  initialSelection,
  compact = false,
  options
}: {
  action: '/leads' | '/conversations' | '/bookings' | '/events';
  label: string;
  initialSelection: string;
  compact?: boolean;
  options: CompanySelectorOption[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState(initialSelection);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeOption = useMemo(
    () => options.find((option) => option.id === selectedCompanyId) || null,
    [options, selectedCompanyId]
  );

  const submitForm = () => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    setIsSubmitting(true);

    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }

    form.submit();
  };

  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      className={`context-form${compact ? ' is-compact' : ''}`}
    >
      <div className="field-stack context-field">
        <label className="key-value-label" htmlFor={`companyId-${action.slice(1)}`}>
          {label}
        </label>
        <select
          id={`companyId-${action.slice(1)}`}
          name="companyId"
          value={selectedCompanyId}
          className="text-input select-input"
          onChange={(event) => {
            const nextCompanyId = event.currentTarget.value;
            setSelectedCompanyId(nextCompanyId);

            if (!nextCompanyId || nextCompanyId === initialSelection) {
              setIsSubmitting(false);
              return;
            }

            submitForm();
          }}
        >
          <option value="">Choose a company</option>
          {options.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
              {company.isActive
                ? ' — active'
                : company.needsRouting
                  ? ' — needs routing'
                  : company.needsEmail
                    ? ' — needs clinic email'
                    : ' — ready'}
            </option>
          ))}
        </select>
      </div>

      <div className="inline-actions context-form-actions">
        <button type="submit" className={compact ? 'button-secondary' : 'button'}>
          {isSubmitting
            ? 'Opening…'
            : selectedCompanyId
              ? compact
                ? 'Open'
                : activeOption
                  ? `Open ${activeOption.name}`
                  : 'Open workspace'
              : 'Load workspace'}
        </button>
        {initialSelection && (
          <a className="button-ghost" href={action}>
            Clear
          </a>
        )}
        {compact && (
          <span className="tiny-muted context-form-hint">
            Changes open instantly.
          </span>
        )}
      </div>
    </form>
  );
}
