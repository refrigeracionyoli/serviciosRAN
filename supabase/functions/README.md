# Edge Functions R2 - Deployment

This project uses three Supabase Edge Functions for Cloudflare R2 evidence files:

- `r2-presigned-put`
- `r2-presigned-get`
- `r2-delete`

## 1) Bootstrap Supabase CLI (if npm scripts are disabled)

If your machine has `npm config get ignore-scripts = true`, run:

```bash
npm run supabase:bootstrap
```

## 2) Authenticate CLI

Use a Supabase personal access token:

```bash
set SUPABASE_ACCESS_TOKEN=YOUR_TOKEN_HERE
```

On PowerShell:

```powershell
$env:SUPABASE_ACCESS_TOKEN = "YOUR_TOKEN_HERE"
```

## 3) Configure required secrets

Set secrets in the target project (`ybrfrixfewarnderdsqi`):

```bash
supabase secrets set --project-ref ybrfrixfewarnderdsqi R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=ran-evidencias
```

## 4) Deploy functions

```bash
npm run supabase:functions:deploy:r2
```

## 5) Verify endpoint availability

A successful preflight should return `200` (not `404`):

```bash
curl -i -X OPTIONS https://ybrfrixfewarnderdsqi.supabase.co/functions/v1/r2-presigned-put
```

A direct POST without auth should return `401/403` (this is expected once deployed).

## Notes

- Do not place R2 secrets in frontend `VITE_*` env vars.
- `R2_ACCOUNT_ID` must be the Cloudflare Account ID (32 hex chars), not the Access Key ID.
- Browser error `CORS request did not succeed` with null status can also be TLS/endpoint misconfiguration.
- If credentials were exposed in any shared channel, rotate them before production use.
