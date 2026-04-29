'use client';

import { useEffect, useRef } from 'react';
import { createProspectMeetingAction, createProspectMeetingAutoAction } from './actions';

type LeadBookMeetingDialogProps = {
  initialOpen?: boolean;
  renderTrigger?: boolean;
  prospectId: string;
  nextProspectId: string;
  q: string;
  view: string;
  status: string;
  city: string;
  nextActionDue: string;
  companyName: string;
  contactName: string;
  contactPhone: string;
  website: string;
  purpose: string;
  notes: string;
  initialMeetingAt?: string;
  initialMeetingUrl?: string;
  defaultAttendeeEmails: string[];
  initialHostEmail?: string;
  meetingError?: string;
};

function defaultMeetingInputValue() {
  const value = new Date();
  value.setDate(value.getDate() + 1);
  value.setHours(10, 0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function minMeetingInputValue() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function bookingErrorCopy(value?: string) {
  if (!value) {
    return '';
  }

  if (value === 'phone_required') return 'A valid phone number is required before you can book the meeting.';
  if (value === 'meetingAt_required') return 'Pick the meeting date and time.';
  if (value === 'purpose_required') return 'Add the meeting purpose so the meeting taker has context.';
  if (value === 'meetingUrl_invalid') return 'Meeting link must be a valid URL.';
  if (value === 'host_invalid') return 'Pick a host from the default attendee list or leave it set to none.';
  if (value === 'startTime_in_past') return 'Meeting time has to be in the future.';

  return 'The meeting could not be booked. Check the details and try again.';
}

export function LeadBookMeetingDialog({
  initialOpen = false,
  renderTrigger = true,
  prospectId,
  nextProspectId,
  q,
  view,
  status,
  city,
  nextActionDue,
  companyName,
  contactName,
  contactPhone,
  website,
  purpose,
  notes,
  initialMeetingAt,
  initialMeetingUrl,
  defaultAttendeeEmails,
  initialHostEmail,
  meetingError
}: LeadBookMeetingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  function clearDialogParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete('bookMeeting');
    url.searchParams.delete('meetingError');
    window.history.replaceState({}, '', url.toString());
  }

  function lockPageScroll() {
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockPageScroll() {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  function openDialog() {
    dialogRef.current?.showModal();
    lockPageScroll();
  }

  function closeDialog() {
    dialogRef.current?.close();
    clearDialogParams();
    unlockPageScroll();
  }

  useEffect(() => {
    if (initialOpen) {
      openDialog();
    }

    return () => {
      unlockPageScroll();
    };
  }, [initialOpen]);

  return (
    <>
      {renderTrigger ? (
        <button
          className="lead-command-button"
          data-tone="success"
          type="button"
          onClick={openDialog}
        >
          <span className="lead-command-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <rect x="4" y="5" width="16" height="15" rx="2" />
              <path d="M8 3v4" />
              <path d="M16 3v4" />
              <path d="M4 9h16" />
              <path d="m9 14 2 2 4-5" />
            </svg>
          </span>
          <span className="lead-command-label">Book</span>
        </button>
      ) : null}

      <dialog
        ref={dialogRef}
        className="lead-context-dialog"
        onClose={() => {
          clearDialogParams();
          unlockPageScroll();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            closeDialog();
          }
        }}
      >
        <div className="lead-context-dialog-card lead-book-meeting-dialog-card">
          <form action={createProspectMeetingAction} className="panel-stack lead-book-meeting-form">
            <input type="hidden" name="prospectId" value={prospectId} />
            <input type="hidden" name="nextProspectId" value={nextProspectId} />
            <input type="hidden" name="q" value={q} />
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="city" value={city} />
            <input type="hidden" name="nextActionDue" value={nextActionDue} />
            <input type="hidden" name="meetingStage" value="demo_booked" />

            <div className="inline-row justify-between lead-panel-header">
              <span className="metric-label">Book meeting</span>
              <button
                className="lead-context-close"
                type="button"
                onClick={closeDialog}
                aria-label="Close booking dialog"
              >
                Close
              </button>
            </div>

            <div className="lead-book-meeting-summary">
              <div className="lead-book-meeting-summary-item">
                <span className="key-value-label">Clinic</span>
                <strong>{companyName}</strong>
              </div>
              <div className="lead-book-meeting-summary-item">
                <span className="key-value-label">Website</span>
                <strong>{website || 'Not set'}</strong>
              </div>
            </div>

            {meetingError ? (
              <div className="inline-row lead-book-meeting-error">
                <span className="status-dot error" />
                {bookingErrorCopy(meetingError)}
              </div>
            ) : null}

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-contact-name">
                Contact name
              </label>
              <input
                id="lead-booking-contact-name"
                name="contactName"
                className="text-input"
                defaultValue={contactName}
                placeholder="Owner or contact name"
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-contact-phone">
                Contact phone
              </label>
              <input
                id="lead-booking-contact-phone"
                name="contactPhone"
                className="text-input"
                defaultValue={contactPhone}
                placeholder="Phone number"
                required
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-meeting-at">
                Meeting date and time
              </label>
              <input
                id="lead-booking-meeting-at"
                type="datetime-local"
                name="meetingAt"
                className="text-input"
                defaultValue={initialMeetingAt || defaultMeetingInputValue()}
                min={minMeetingInputValue()}
                step={900}
                required
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-purpose">
                Purpose
              </label>
              <input
                id="lead-booking-purpose"
                name="purpose"
                className="text-input"
                defaultValue={purpose}
                placeholder="Discovery call, demo, intro meeting"
                required
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-host-email">
                Host / person in charge
              </label>
              <select
                id="lead-booking-host-email"
                name="hostEmail"
                className="text-input"
                defaultValue={initialHostEmail || ''}
              >
                <option value="">None</option>
                {defaultAttendeeEmails.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-link">
                Meeting link
              </label>
              <input
                id="lead-booking-link"
                name="meetingUrl"
                className="text-input"
                defaultValue={initialMeetingUrl}
                placeholder="Optional. Leave empty to auto-generate from calendar sync."
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="lead-booking-notes">
                Handoff notes
              </label>
              <textarea
                id="lead-booking-notes"
                name="notes"
                className="text-area"
                rows={5}
                defaultValue={notes}
                placeholder="Anything the meeting taker should know before joining."
              />
            </div>

            <div className="text-muted">
              Default attendee emails auto-added to this meeting: {defaultAttendeeEmails.length > 0 ? defaultAttendeeEmails.join(', ') : 'none yet'}.
            </div>

            <div className="text-muted">
              One-click auto-book finds the next available slot from your calendar and creates the meeting. Save meeting still works for manual overrides.
            </div>

            <div className="inline-actions">
              <button className="button" type="submit" formAction={createProspectMeetingAutoAction}>
                Auto-book next slot
              </button>
              <button className="button-secondary button-secondary-strong" type="submit">
                Save meeting
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
