# Nexa Admin — bamagram.ir/bot

A responsive, static administration console for the existing Nexa Telegram bot.

**Live address:** https://bamagram.ir/bot/  
**Backend:** Supabase Edge Function `nexa-admin` in the **existing** project.  
**Data:** Existing Postgres and Supabase Vault; no new database and no new SQL migrations.

## One-time hosting setup

1. In the hosting file manager open `public_html/bot/` (or the folder mapped to `bamagram.ir/bot`).
2. Upload **the contents** of this `admin-web/` folder, not the parent `admin-web` folder:
   `index.html`, `styles.css`, `app.js`, and `.htaccess`.
3. Confirm https://bamagram.ir/bot/ opens over HTTPS. If your host doesn't support Apache/LiteSpeed, migrate the recommended security headers from `.htaccess` into your host configuration.
4. In **@BotFather**, choose the existing Nexa bot and register `bamagram.ir` for Telegram Login. For the legacy widget: `/setdomain`; for the newer BotFather Mini App, go to *Login Widget → Allowed URLs* and allow `https://bamagram.ir`. Only one of these widget settings is necessary depending on the BotFather version.
5. Login to the page with the **same Telegram account** registered as `TELEGRAM_ADMIN_USER_ID` on your Supabase bot. Non-admin Telegram accounts are rejected by the server.

No PHP, .env, or Supabase service-role secret should be uploaded to the hosting account. There is no need to create a new database.

## Features

- Overview: users, requests, tokens, success stats, provider key availability
- Users: lookup by Telegram ID, explicit allow/block/inherit, per-user limits
- BYOK: view provider/model/status **without revealing secrets**, enable/disable, and permanently revoke personal keys
- AI settings: Gemini / OpenRouter / Custom provider, models, custom HTTPS URL, global daily limit and Gemini chat search

**Important:** Server-owned provider keys are *only* configured or rotated in **Supabase Edge Function Secrets**, not in this UI.

## Security

- Telegram Login Widget HMAC is validated **server-side** with the Telegram bot token.
- Signed, 15-minute admin bearer sessions are stored only in the current browser tab's `sessionStorage`.
- Every API request requires a verified admin session and `Origin: https://bamagram.ir`.
- Every operation is authorized against `TELEGRAM_ADMIN_USER_ID`. The client cannot choose which user is administrator.
- Service-role credentials and Vault-decrypted personal keys are never included in responses.
- User blocks override BYOK. An admin cannot block or revoke their own administrator entry through this UI.
- Hosting enables restrictive CSP, frame and content-type protections when Apache `.htaccess` is supported.

**No system is perfectly secure.** If the Telegram bot token or Supabase service-role secret leaks, rotate it immediately. Only use this page on HTTPS.

## Production deployment

The existing `.github/workflows/deploy-supabase.yml` deploys and health-checks the new `nexa-admin` Edge Function alongside the original four functions.

The deployment trigger includes `supabase/functions/nexa-admin/**` and `supabase/config.toml`. The static frontend is intentionally deployed **separately** by uploading this folder to the user's hosting. Do not upload the entire repository.

## Limits of v1

- Telegram display names are not persisted in the current user's database schema, so the list uses Telegram **Chat ID** rather than invented profile names.
- Activity metrics are based on logged metrics and can be incomplete.
- The summary fetches up to 1,000 users / 5,000 events per refresh. For a larger installation, add server-side pagination.
- Mutations use the existing Supabase tables. There is no separate persistent admin audit trail in this initial version.
- Global API secrets are never editable in the browser.
