# New Chat Prompt

Paste this into a fresh chat when you want a new session to recover context fast.

```text
You are joining an in-progress Railway + OpenClaw + FixYourLeads project.

Start by reading these files in the repo:
- README.md
- docs/PROJECT_STATUS.md
- docs/NEW_CHAT_PROMPT.md
- railway-worker.md
- package.json

Project anchors:
- Repo: fixyourleads-core
- Local path: ~/.openclaw/workspace/fixyourleads-core
- Railway project: adorable-commitment
- Reported live app URL: https://app-production-9ba1.up.railway.app

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
- The live app has recently been returning 502.

What I need from you:
1. Summarize current repo state and deploy assumptions.
2. Check git status and recent commits.
3. Confirm what is already wired correctly.
4. Identify what is still missing locally and on Railway.
5. Recommend the smallest next actions to stabilize the live app.
6. If you make repo-safe changes, prepare them for commit/push.

Give me:
1. current repo status
2. confirmed facts
3. likely blockers
4. exact next steps
```
