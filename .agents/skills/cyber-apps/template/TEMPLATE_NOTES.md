# Cyber App Template Notes

This directory is a copy template, not a package. Copy it into a new React Router app and replace all `REPLACE_*` placeholders before building.

## Required replacements

- Replace `REPLACE_APP_NAME`, `REPLACE_APP_SUBTITLE`, `REPLACE_CENTER_TITLE`, and `replace-app-slug`.
- Replace `REPLACE_APP_SLUG-theme` and `REPLACE_APP_SLUG-theme-change` in `app/lib/theme.ts`.
- Copy the skill assets into the app public directory, including favicon and NI logo.
- Replace placeholder auth helpers in `app/routes/_app.tsx` and `app/routes/auth.logout.tsx`.
- Set the real Vercel project, domain, Supabase project, and environment variables.

## Guest-compatible mode

Use this when the main screen can be read anonymously.

- Set `AUTH_MODE` to `"guest-compatible"`.
- Keep loader access optional for read-only routes.
- Keep login button visible in the header.
- Require a server session in every write action, shared setting update, admin API, and sensitive data loader.
- Store local-only preferences in localStorage, but store shared configuration in Supabase.

## Login-required mode

Use this when all business data must be protected.

- Set `AUTH_MODE` to `"login-required"`.
- Make the `_app` loader call a real `requireCurrentUser(request)` helper.
- Redirect unauthenticated users to `/auth/login?returnTo=...`.
- Do not expose anonymous business UI or anonymous local-only workflow state.

## Visual rules

- Keep the header/footer/theme/user-status structure unless there is a strong product reason.
- Keep regular card radius at 8px or smaller.
- Do not build a landing page as the first screen.
- Verify desktop, mobile, light theme, dark theme, logged-in, and logged-out states.

## Security rules

- Never put service role keys, Feishu secrets, Vercel tokens, or third-party API keys in this template, front-end code, README, or handoff.
- Front-end visibility checks are hints only; server loaders/actions/APIs must enforce permissions.
