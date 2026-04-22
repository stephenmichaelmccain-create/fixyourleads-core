# Low Token Workflow

This file exists to keep new chats fast and cheap.

## Source of truth

Before a fresh chat reads large parts of the repo, it should read:

- `docs/PROJECT_STATUS.md`
- `docs/MINIMUM_PRODUCTION_WORKFLOW.md`
- `docs/LOW_TOKEN_WORKFLOW.md`

Only read more files after a concrete task is chosen.

## Chat lanes

Use separate chats for separate lanes:

- UI and branding
- production and Railway
- workflow logic and backend
- CRM data cleanup or imports

Do not mix all lanes into one chat unless something is truly blocked across all
of them.

## Response rules

Ask the assistant to stay in low-token mode:

- do not restate unchanged project history
- do not re-list env vars unless something changed
- do not paste logs unless the exact lines matter
- summarize only new findings, blockers, and next steps
- prefer short paragraphs or 3-5 bullets

## Screenshot rules

When using screenshots:

- send one screenshot at a time
- say exactly what is wrong in one sentence
- ask for one focused change

That is cheaper than asking for a broad review of the whole screen.

## Working pattern

Use this loop:

1. pick one lane
2. give one focused task
3. let Codex make the change
4. ask Codex to update docs if the project state changed
5. commit and push repo-safe changes
6. start a fresh chat only when the lane changes or context gets noisy

## Handoff rule

After a meaningful milestone, update the repo docs instead of carrying the full
story in chat memory.

Minimum docs to keep current:

- `docs/PROJECT_STATUS.md`
- `docs/NEW_CHAT_PROMPT.md`

## Copy-paste control line

Use this line near the top of a fresh chat:

```text
Low-token mode. Read only the project docs first. Do not repeat unchanged context. Give me only new findings, blockers, and next steps.
```
