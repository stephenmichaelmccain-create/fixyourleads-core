# Connections One-Click Rollout (Telnyx + n8n MCP)

This rollout publishes the new one-click button in Connections:

- `Connect Telnyx automatically`

It performs:

1. read client workflow MCP URL from n8n automation state
2. create/reuse Telnyx MCP server for that URL
3. create/reuse assistant
4. attach MCP server tool to assistant
5. save `telnyxAssistantId` on the client

## Required env

At minimum:

- `TELNYX_API_KEY`

And one of:

- `TELNYX_TEMPLATE_ASSISTANT_ID` (recommended)
- `TELNYX_ASSISTANT_MODEL` + `TELNYX_ASSISTANT_INSTRUCTIONS`

Optional:

- `TELNYX_MCP_SERVER_TYPE` (defaults to `http`)

## Recommended production config

Use your current working assistant as the template:

- `TELNYX_TEMPLATE_ASSISTANT_ID=<your_demo_clinic_assistant_id>`

This keeps behavior consistent and avoids prompt/model drift.

## Railway commands

After `railway login`:

```bash
railway status
railway variable set TELNYX_TEMPLATE_ASSISTANT_ID=<assistant_id>
railway variable set TELNYX_MCP_SERVER_TYPE=http
railway up
```

If variables are already correct and you only need restart:

```bash
railway redeploy
```

## Post-deploy smoke test

For one client:

1. Open Connections.
2. Step 2: click `Save and launch`.
3. Confirm MCP URL is populated.
4. Step 3: click `Connect Telnyx automatically`.
5. Confirm notice shows `Telnyx connected`.
6. Confirm Assistant ID + MCP Server ID are populated.
7. Place one real booking call and verify calendar + Gmail.

## Safe failure behavior

If prerequisites are missing, app returns `ACTION_REQUIRED` and logs a human-readable reason in telnyx setup notes.
No workflow edits are made in this step.
