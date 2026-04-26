'use client';

import { useState } from 'react';

type LeadNotesComposerProps = {
  initialNotes: string;
  quickNotes: string[];
  textAreaId: string;
  textAreaName: string;
  placeholder?: string;
};

export function LeadNotesComposer({
  initialNotes,
  quickNotes,
  textAreaId,
  textAreaName,
  placeholder = 'Add notes about this call...'
}: LeadNotesComposerProps) {
  const [notes, setNotes] = useState(initialNotes);

  function applyQuickNote(snippet: string) {
    setNotes((current) => {
      const normalizedCurrent = current.trim().toLowerCase();
      const normalizedSnippet = snippet.trim().toLowerCase();

      if (normalizedCurrent.includes(normalizedSnippet)) {
        return current;
      }

      if (!current.trim()) {
        return snippet;
      }

      return `${current.trimEnd()}\n${snippet}`;
    });
  }

  return (
    <>
      <div className="field-stack lead-quick-notes-field">
        <label className="key-value-label" htmlFor={textAreaId}>
          Quick notes
        </label>
        <div className="lead-quick-notes-row">
          {quickNotes.map((note) => (
            <button
              key={note}
              type="button"
              className="lead-quick-note-chip"
              onClick={() => applyQuickNote(note)}
            >
              {note}
            </button>
          ))}
        </div>
      </div>
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
