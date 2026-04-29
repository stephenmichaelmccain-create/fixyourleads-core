'use client';

import { useRef } from 'react';
import { completeMeetingAndScheduleNextAction } from './actions';

type ScheduleNextStageDialogProps = {
  appointmentId: string;
  currentStage: string;
  nextStageLabel: string;
  returnTo: string;
  suggestedStartIso: string;
};

function toLocalDateTimeInputValue(iso: string) {
  const value = new Date(iso);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function minMeetingInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function ScheduleNextStageDialog({
  appointmentId,
  currentStage,
  nextStageLabel,
  returnTo,
  suggestedStartIso
}: ScheduleNextStageDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function openDialog() {
    dialogRef.current?.showModal();
  }

  function closeDialog() {
    dialogRef.current?.close();
  }

  function openDatePicker() {
    const input = inputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    if (!input) return;
    try {
      if (typeof input.showPicker === 'function') {
        input.showPicker();
        return;
      }
    } catch {}
    input.focus();
    input.click();
  }

  return (
    <>
      <button type="button" className="button-secondary button-secondary-strong" onClick={openDialog}>
        Schedule {nextStageLabel}
      </button>

      <dialog
        ref={dialogRef}
        className="lead-context-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
      >
        <div className="lead-context-dialog-card">
          <form action={completeMeetingAndScheduleNextAction} className="panel-stack">
            <input type="hidden" name="appointmentId" value={appointmentId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="stage" value={currentStage} />

            <div className="inline-row justify-between lead-panel-header">
              <span className="metric-label">Schedule next stage</span>
              <button className="lead-context-close" type="button" onClick={closeDialog} aria-label="Close schedule dialog">
                Close
              </button>
            </div>

            <div className="lead-book-meeting-summary-item">
              <span className="key-value-label">Next meeting</span>
              <strong>{nextStageLabel}</strong>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor={`schedule-next-${appointmentId}`}>
                Date and time
              </label>
              <div className="text-input-with-action">
                <input
                  ref={inputRef}
                  id={`schedule-next-${appointmentId}`}
                  type="datetime-local"
                  name="nextStartTime"
                  className="text-input lead-booking-datetime-input"
                  defaultValue={toLocalDateTimeInputValue(suggestedStartIso)}
                  min={minMeetingInputValue()}
                  step={60}
                  required
                />
                <button
                  type="button"
                  className="text-input-action-button"
                  aria-label="Open date and time picker"
                  onClick={openDatePicker}
                >
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <rect x="4" y="5" width="16" height="15" rx="2" />
                    <path d="M8 3v4" />
                    <path d="M16 3v4" />
                    <path d="M4 9h16" />
                    <path d="M8 13h3" />
                    <path d="M13 13h3" />
                    <path d="M8 17h3" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="inline-actions">
              <button className="button-secondary button-secondary-strong" type="submit">
                Save {nextStageLabel}
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
