'use client';

import { useState } from 'react';

type LeadNotesComposerProps = {
  initialNotes: string;
  textAreaId: string;
  textAreaName: string;
  placeholder?: string;
};

export function LeadNotesComposer({
  initialNotes,
  textAreaId,
  textAreaName,
  placeholder = 'Add notes about this call...'
}: LeadNotesComposerProps) {
  const [notes, setNotes] = useState(initialNotes);

  return (
    <>
      <div className="field-stack lead-notes-field">
        <label className="key-value-label" htmlFor={textAreaId}>
          Caller notes
        </label>
        <textarea
          id={textAreaId}
          name={textAreaName}
          className="text-area lead-notes-editor"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder={placeholder}
        />
      </div>
    </>
  );
}
