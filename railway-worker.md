# Railway worker service

Create a second Railway service from the same repo.

## Worker start command

```bash
npm run worker
```

## Shared env vars
- DATABASE_URL
- REDIS_URL
- TELNYX_API_KEY
- TELNYX_FROM_NUMBER
- APP_BASE_URL

## App service start command
Default: `npm run start`

## First deploy steps
1. Deploy app service from repo root
2. Set env vars
3. Run `npm run db:push` once against the database
4. Create second service from same repo for workers
5. Set worker start command to `npm run worker`
