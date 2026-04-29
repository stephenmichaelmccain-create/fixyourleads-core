'use client';

import { useEffect, useRef } from 'react';
import { createManualMeetingAppointmentAction } from './actions';

type ManualMeetingDialogProps = {
  defaultAttendeeEmails: string[];
  initialCompanyName?: string;
  initialContactName?: string;
  initialContactPhone?: string;
  initialContactEmail?: string;
  initialMeetingAt?: string;
  initialPurpose?: string;
  initialMeetingUrl?: string;
  initialHostEmail?: string;
  initialNotes?: string;
  initialOpen?: boolean;
  meetingError?: string;
  meetingStage: string;
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
  if (!value) return '';
  if (value === 'company_required') return 'Add the client or company name for this appointment.';
  if (value === 'phone_required') return 'A valid phone number is required before saving the appointment.';
  if (value === 'meetingAt_required') return 'Pick the appointment date and time.';
  if (value === 'purpose_required') return 'Add the appointment purpose so the team has context.';
  if (value === 'meetingUrl_invalid') return 'Meeting link must be a valid URL.';
  if (value === 'host_invalid') return 'Pick a host from the default attendee list or leave it set to none.';
  if (value === 'startTime_in_past') return 'Appointment time has to be in the future.';
  return 'The appointment could not be saved. Check the details and try again.';
}

export function ManualMeetingDialog({
  defaultAttendeeEmails,
  initialCompanyName,
  initialContactName,
  initialContactPhone,
  initialContactEmail,
  initialMeetingAt,
  initialPurpose,
  initialMeetingUrl,
  initialHostEmail,
  initialNotes,
  initialOpen = false,
  meetingError,
  meetingStage
}: ManualMeetingDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const meetingAtInputRef = useRef<HTMLInputElement>(null);

  function clearDialogParams() {
    const url = new URL(window.location.href);
    url.searchParams.delete('manualBook');
    url.searchParams.delete('meetingError');
    url.searchParams.delete('manualBookingCompanyName');
    url.searchParams.delete('manualBookingContactName');
    url.searchParams.delete('manualBookingContactPhone');
    url.searchParams.delete('manualBookingContactEmail');
    url.searchParams.delete('manualBookingMeetingAt');
    url.searchParams.delete('manualBookingPurpose');
    url.searchParams.delete('manualBookingMeetingUrl');
    url.searchParams.delete('manualBookingHostEmail');
    url.searchParams.delete('manualBookingNotes');
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

  function openMeetingDatePicker() {
    const input = meetingAtInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
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
      <button className="button" type="button" onClick={openDialog}>
        Make appointment
      </button>

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
          <form action={createManualMeetingAppointmentAction} className="panel-stack lead-book-meeting-form">
            <input type="hidden" name="meetingStage" value={meetingStage} />

            <div className="inline-row justify-between lead-panel-header">
              <span className="metric-label">Make appointment</span>
              <button className="lead-context-close" type="button" onClick={closeDialog} aria-label="Close manual booking dialog">
                Close
              </button>
            </div>

            <div className="lead-book-meeting-summary">
              <div className="lead-book-meeting-summary-item">
                <span className="key-value-label">Pipeline stage</span>
                <strong>{meetingStage.replace(/_/g, ' ')}</strong>
              </div>
              <div className="lead-book-meeting-summary-item">
                <span className="key-value-label">Auto-added attendees</span>
                <strong>{defaultAttendeeEmails.length > 0 ? defaultAttendeeEmails.length : 'None yet'}</strong>
              </div>
            </div>

            {meetingError ? (
              <div className="inline-row lead-book-meeting-error">
                <span className="status-dot error" />
                {bookingErrorCopy(meetingError)}
              </div>
            ) : null}

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-company-name">
                Client / company
              </label>
              <input
                id="manual-booking-company-name"
                name="companyName"
                className="text-input"
                defaultValue={initialCompanyName}
                placeholder="Clinic or company name"
                required
              />
            </div>

            <div className="lead-book-meeting-summary">
              <div className="field-stack">
                <label className="key-value-label" htmlFor="manual-booking-contact-name">
                  Contact name
                </label>
                <input
                  id="manual-booking-contact-name"
                  name="contactName"
                  className="text-input"
                  defaultValue={initialContactName}
                  placeholder="Owner or contact name"
                />
              </div>
              <div className="field-stack">
                <label className="key-value-label" htmlFor="manual-booking-contact-email">
                  Contact email
                </label>
                <input
                  id="manual-booking-contact-email"
                  name="contactEmail"
                  type="email"
                  className="text-input"
                  defaultValue={initialContactEmail}
                  placeholder="name@example.com"
                />
              </div>
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-contact-phone">
                Contact phone
              </label>
              <input
                id="manual-booking-contact-phone"
                name="contactPhone"
                className="text-input"
                defaultValue={initialContactPhone}
                placeholder="Phone number"
                required
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-meeting-at">
                Appointment date and time
              </label>
              <div className="text-input-with-action">
                <input
                  ref={meetingAtInputRef}
                  id="manual-booking-meeting-at"
                  type="datetime-local"
                  name="meetingAt"
                  className="text-input lead-booking-datetime-input"
                  defaultValue={initialMeetingAt || defaultMeetingInputValue()}
                  min={minMeetingInputValue()}
                  step={60}
                  required
                />
                <button
                  type="button"
                  className="text-input-action-button"
                  aria-label="Open date and time picker"
                  onClick={openMeetingDatePicker}
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

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-purpose">
                Purpose
              </label>
              <input
                id="manual-booking-purpose"
                name="purpose"
                className="text-input"
                defaultValue={initialPurpose}
                placeholder="Demo, setup call, onboarding"
                required
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-host-email">
                Host / person in charge
              </label>
              <select
                id="manual-booking-host-email"
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
              <label className="key-value-label" htmlFor="manual-booking-link">
                Meeting link
              </label>
              <input
                id="manual-booking-link"
                name="meetingUrl"
                className="text-input"
                defaultValue={initialMeetingUrl}
                placeholder="Optional. Leave empty to add later."
              />
            </div>

            <div className="field-stack">
              <label className="key-value-label" htmlFor="manual-booking-notes">
                Handoff notes
              </label>
              <textarea
                id="manual-booking-notes"
                name="notes"
                className="text-area"
                rows={5}
                defaultValue={initialNotes}
                placeholder="Anything the meeting taker should know before joining."
              />
            </div>

            <div className="text-muted">
              Default attendee emails auto-added to this appointment: {defaultAttendeeEmails.length > 0 ? defaultAttendeeEmails.join(', ') : 'none yet'}.
            </div>

            <div className="inline-actions">
              <button className="button-secondary button-secondary-strong" type="submit">
                Save appointment
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
