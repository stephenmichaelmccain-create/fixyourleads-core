'use client';

import { useRef } from 'react';
import { deleteCompanyAction } from '@/app/companies/actions';

export function DeleteClientButton({
  companyId,
  companyName
}: {
  companyId: string;
  companyName: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        className="button-danger client-row-delete-trigger"
        type="button"
        onClick={() => dialogRef.current?.showModal()}
      >
        Delete
      </button>

      <dialog
        ref={dialogRef}
        className="client-delete-dialog"
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dialogRef.current?.close();
          }
        }}
      >
        <div className="client-delete-card">
          <div className="panel-stack" style={{ gap: 10 }}>
            <div className="metric-label">Delete client</div>
            <h3 className="client-delete-title">Delete {companyName}?</h3>
            <p className="text-muted">
              This removes the client workspace and all related setup, leads, contacts, bookings, and events.
            </p>
          </div>

          <form action={deleteCompanyAction} className="client-delete-actions">
            <input type="hidden" name="companyId" value={companyId} />
            <button
              className="button-ghost"
              type="button"
              onClick={() => dialogRef.current?.close()}
            >
              No
            </button>
            <button className="button-danger" type="submit">
              Yes, delete
            </button>
          </form>
        </div>
      </dialog>
    </>
  );
}
