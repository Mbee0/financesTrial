# Secure Plaid Budget Dashboard (Starter)

This repository is a **security-first starter** for a simple YNAB-style dashboard that connects accounts through Plaid.

## What this app does

- Uses **Plaid Link** for account connection (users never enter banking credentials into this app)
- Exchanges Plaid `public_token` server-side
- Retrieves account balances for dashboard display
- Allows disconnecting the linked Plaid item

## Security model (important)

This starter is intentionally opinionated:

- **No Plaid secrets in frontend code**
  - `PLAID_SECRET` and `PLAID_CLIENT_ID` are read from environment variables on the server only.
- **No hardcoded or committed secrets**
  - `.env` is ignored via `.gitignore`.
- **No persistent banking data storage**
  - The app does **not** write account data, transaction data, access tokens, routing numbers, or account numbers to disk/database.
- **Encrypted token handling in memory**
  - Plaid `access_token` is encrypted in memory using AES-256-GCM and expires by session TTL.
- **Authenticated access**
  - Requires admin login before calling Plaid endpoints.
- **Defense in depth**
  - `helmet` secure headers + CSP
  - signed `httpOnly` session cookie
  - same-origin enforcement for mutating API routes
  - route rate limiting
  - `Cache-Control: no-store` on API responses

## Quick start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy environment template:

   ```bash
   cp .env.example .env
   ```

3. Generate a password hash for `ADMIN_PASSWORD_HASH`:

   ```bash
   npm run hash-password -- "replace-with-a-long-unique-password"
   ```

4. Generate a token encryption key:

   ```bash
   openssl rand -base64 32
   ```

5. Fill `.env` with your Plaid values and generated secrets.

6. Run the app:

   ```bash
   npm run dev
   ```

7. Open:

   ```text
   http://localhost:3000
   ```

## API behavior

- `GET /api/auth/session` – check session auth state
- `POST /api/auth/login` – authenticate dashboard user
- `POST /api/auth/logout` – destroy local session
- `GET /api/plaid/link-token` – mint Plaid Link token (authenticated only)
- `POST /api/plaid/exchange-public-token` – exchange `public_token` for access token (authenticated only)
- `POST /api/plaid/disconnect` – remove Plaid item and forget token (authenticated only)
- `GET /api/dashboard` – retrieve masked account balance data (authenticated only)

## Operational security checklist

Before using this beyond local development:

- Put the app behind HTTPS (reverse proxy or platform TLS)
- Store secrets in a managed secret store (not plain files)
- Enable MFA on email/GitHub/cloud accounts
- Rotate Plaid secrets immediately if exposure is suspected
- Add centralized audit logging and anomaly alerts
- Add stronger end-user auth (MFA/passkeys) if this becomes multi-user

## Constraints aligned with your requirements

- Uses Plaid OAuth/Link flow for authentication
- Never asks for raw bank credentials
- Does not directly store banking data in local persistence
