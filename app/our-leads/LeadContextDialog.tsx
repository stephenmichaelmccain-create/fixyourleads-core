'use client';

import { useRef } from 'react';

type LeadContextDialogProps = {
  createdAt: string;
  updatedAt: string;
  source: string;
  clinicType: string;
  zipCode: string;
  predictedRevenue: string;
  websiteHref?: string;
};

export function LeadContextDialog({
  createdAt,
  updatedAt,
  source,
  clinicType,
  zipCode,
  predictedRevenue,
  websiteHref
}: LeadContextDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="details-summary button-ghost lead-context-trigger"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        Lead context
      </button>

      <dialog
        ref={dialogRef}
        className="lead-context-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className="lead-context-dialog-card">
          <div className="panel-stack lead-context-popover">
            <div className="inline-row justify-between lead-panel-header">
              <span className="metric-label">Lead context</span>
              <button
                className="lead-context-close"
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Close lead context"
              >
                Close
              </button>
            </div>
            <div className="lead-context-preview-grid">
              <div className="lead-context-preview-item">
                <span className="key-value-label">Created</span>
                <strong>{createdAt}</strong>
              </div>
              <div className="lead-context-preview-item">
                <span className="key-value-label">Updated</span>
                <strong>{updatedAt}</strong>
              </div>
              <div className="lead-context-preview-item">
                <span className="key-value-label">Source</span>
                <strong>{source}</strong>
              </div>
              <div className="lead-context-preview-item">
                <span className="key-value-label">Clinic type</span>
                <strong>{clinicType}</strong>
              </div>
              <div className="lead-context-preview-item">
                <span className="key-value-label">ZIP</span>
                <strong>{zipCode}</strong>
              </div>
              <div className="lead-context-preview-item">
                <span className="key-value-label">Predicted revenue</span>
                <strong>{predictedRevenue}</strong>
              </div>
            </div>
            {websiteHref ? (
              <div className="inline-actions">
                <a
                  className="button-ghost lead-preview-link"
                  href={websiteHref}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open full website
                </a>
              </div>
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
