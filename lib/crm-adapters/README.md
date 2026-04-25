# CRM Adapters

CRM sync flows through one standard shape: `StandardLead`.

To add a provider:

1. Create `lib/crm-adapters/provider-name.ts`.
2. Export a `CrmAdapter` with `pushLead(credentials, fieldMapping, lead)`.
3. Never log raw credentials.
4. Return `{ success: true, externalId, response }` on success.
5. Return `{ success: false, error, response }` on failure.
6. Add the adapter to `lib/crm-router.ts`.

V1 intentionally implements only:

- `none`
- `hubspot`
- `gohighlevel`

Pipedrive, Salesforce, Boulevard, and Vagaro are stubs until a paying client needs them.
