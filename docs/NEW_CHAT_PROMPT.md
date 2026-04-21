# New Chat Prompt

Paste this into a fresh chat when you want a new session to recover context fast.

```text
You are joining an in-progress Railway + OpenClaw + FixYourLeads project.

Start by reading these files in the repo:
- README.md
- docs/PROJECT_STATUS.md
- docs/MINIMUM_PRODUCTION_WORKFLOW.md
- docs/NEW_CHAT_PROMPT.md
- railway-worker.md
- package.json

Project anchors:
- Repo: fixyourleads-core
- Local path: ~/.openclaw/workspace/fixyourleads-core
- Railway project: adorable-commitment
- Live app URL: https://app-production-9ba1.up.railway.app

Important rules:
- Do not expose secret values.
- Report env var names only.
- Separate confirmed facts from hypotheses.
- Prefer concrete repo and deploy findings over theory.
- Treat GitHub as the stable backup and history source for repo-safe changes.

Current runtime env contract:
- DATABASE_URL
- REDIS_URL
- TELNYX_API_KEY
- TELNYX_FROM_NUMBER
- APP_BASE_URL
- INTERNAL_API_KEY

Already established:
- Codex Railway MCP works after OAuth.
- Railway list-projects works.
- Railway whoami is unreliable because of a server-side validation issue.
- The repo has a local bootstrap command:
  npm run env:openclaw
- That bootstrap currently auto-loads:
  - TELNYX_API_KEY
  - APP_BASE_URL via FYL_BASE_URL
  - INTERNAL_API_KEY
- The remaining local runtime gaps are:
  - DATABASE_URL
  - REDIS_URL
  - TELNYX_FROM_NUMBER
- The live app is up and the production schema has been pushed.
- Production currently has:
  - app
  - worker
  - Postgres
  - Redis
- Production also has a demo company and sample lead/conversation/event for
  smoke testing.
- The app now has:
  - a Companies page
  - manual conversation send/book controls
  - duplicate lead suppression by company/contact
  - optional SMTP-based booking notifications

Current product target:
- lightweight multi-tenant CRM for clinic outreach
- lead sourcing from Google Maps and similar sources
- dedupe/suppression so the same clinic is not contacted twice
- Telnyx for SMS and voice
- appointment booking
- client notifications from fixyourleadsadmin@gmail.com
- no bloated generic CRM features
- no agent-dependent runtime behavior

What I need from you:
1. Summarize current repo state and deploy assumptions.
2. Check git status and recent commits.
3. Confirm what is already wired correctly.
4. Identify the smallest missing pieces for the minimum production workflow.
5. Prefer product progress over infra churn unless production is actually broken.
6. If you make repo-safe changes, prepare them for commit/push.

Give me:
1. current repo status
2. confirmed facts
3. likely blockers
4. exact next steps
```
