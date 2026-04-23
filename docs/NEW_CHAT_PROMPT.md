# New Chat Prompt

Use the short version first. Only use the longer one if the new chat actually
needs the extra context.

## Low-token starter

```text
You are joining the FixYourLeads project.

Read only these files first:
- docs/PROJECT_STATUS.md
- docs/MINIMUM_PRODUCTION_WORKFLOW.md
- docs/LOW_TOKEN_WORKFLOW.md

Repo anchors:
- repo: fixyourleads-core
- Railway project: adorable-commitment
- live app: https://app-production-9ba1.up.railway.app

Rules:
- low-token mode
- do not repeat unchanged context
- do not print secret values
- report confirmed facts separately from guesses
- prefer product progress over infra churn
- prefer native Telnyx features for transport, scheduling, routing, and voice before proposing custom app-side rebuilds
- keep updates short and delta-only
- use GitHub as the stable backup for repo-safe changes

What to do first:
1. read the three docs above
2. check git status
3. tell me only:
   - where the project stands
   - what is blocked
   - the next 3 highest-ROI steps
```

## UI-only starter

```text
You are joining the FixYourLeads project to work on UI only.

Read only:
- docs/PROJECT_STATUS.md
- docs/LOW_TOKEN_WORKFLOW.md
- app/globals.css
- app/layout.tsx
- app/page.tsx
- app/diagnostics/page.tsx

Rules:
- low-token mode
- no infra deep dive unless the UI is blocked by it
- keep brand aligned with fixyourleads.com
- remove non-production copy and placeholder states when possible
- keep updates short and focused on visible progress

What to do:
1. inspect current UI state
2. identify the highest-value UI cleanup or feature
3. implement it
4. summarize only the user-visible changes and any blocker
```

## Full recovery starter

```text
You are joining an in-progress Railway + FixYourLeads project.

Start by reading these files in the repo:
- README.md
- docs/PROJECT_STATUS.md
- docs/MINIMUM_PRODUCTION_WORKFLOW.md
- docs/LOW_TOKEN_WORKFLOW.md
- docs/NEW_CHAT_PROMPT.md
- railway-worker.md
- package.json

Project anchors:
- Repo: fixyourleads-core
- Railway project: adorable-commitment
- Live app URL: https://app-production-9ba1.up.railway.app

Important rules:
- Do not expose secret values.
- Report env var names only.
- Separate confirmed facts from hypotheses.
- Prefer concrete repo and deploy findings over theory.
- Treat GitHub as the stable backup and history source for repo-safe changes.
- Keep updates short and avoid repeating unchanged context.

Current runtime env contract:
- DATABASE_URL
- REDIS_URL
- TELNYX_API_KEY
- TELNYX_FROM_NUMBER
- APP_BASE_URL
- INTERNAL_API_KEY

Current product target:
- lightweight multi-tenant CRM for clinic outreach
- lead sourcing from Google Maps and similar sources
- dedupe/suppression so the same clinic is not contacted twice
- Telnyx for communications execution
- the app as the workflow brain and source of truth
- appointment booking
- client notifications from fixyourleadsadmin@gmail.com
- no bloated generic CRM features
- no agent-dependent runtime behavior

What I need from you:
1. Summarize current repo state and deploy assumptions.
2. Check git status and recent commits.
3. Confirm what is already wired correctly.
4. Identify the smallest missing pieces for the minimum production workflow.
5. If you make repo-safe changes, prepare them for commit/push.

Give me:
1. current repo status
2. confirmed facts
3. likely blockers
4. exact next steps
```
