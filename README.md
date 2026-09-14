# Launch v1

Your day ranked by priority and prep, goals, reminders, and an AI morning game plan. Google Calendar is the data layer; you never open it.

## Files

```
launch/
├── index.html              the whole app (UI)
├── manifest.webmanifest    home screen install
├── icon-180.png / icon-192.png / icon-512.png
├── package.json
├── api/
│   ├── login.js            passcode → session
│   ├── google-start.js     starts Google connect
│   ├── google-callback.js  finishes Google connect
│   ├── calendar.js         read / create / edit / delete events
│   ├── data.js             reminders, goals, templates, settings
│   ├── ai.js               priority guesses + morning plan
│   └── _lib/               shared helpers (not routes)
└── supabase/schema.sql     run once in Supabase
```

## Setup (in this order)

**1. Supabase (use Loop's project)**
1. Open Loop's Supabase project → SQL Editor → New query.
2. Paste all of `supabase/schema.sql` → Run. Every table starts with `launch_`, so Loop's tables are untouched.
3. Project Settings → API Keys. Copy the **Project URL** and the **service_role** key (Legacy tab) or a **Secret key**. Both work.

**2. GitHub**
1. New repo: `coloredrain136/launch`.
2. Upload everything in this folder, keeping the `api/` and `supabase/` folders intact.

**3. Vercel (deploy first, then configure)**
1. Add New → Project → import `launch` → Deploy. It will load but won't work yet.
2. Copy the URL (e.g. `https://launch-abc.vercel.app`).

**4. Google Cloud**
1. console.cloud.google.com → pick a project (or make one called Launch).
2. APIs & Services → Library → enable **Google Calendar API**.
3. Google Auth Platform → Branding: app name `Launch`, your email as support + developer contact.
4. Audience: External. Then click **Publish app** so it says **In production**. Skip this and Google logs you out every 7 days.
5. Data Access → Add scopes → `.../auth/calendar.events`.
6. Clients → Create client → Web application.
   - Authorized redirect URI: `https://YOUR-URL.vercel.app/api/google-callback`
7. Copy the **Client ID** and **Client secret**.

**5. Gemini key**
Reuse Ping's key from aistudio.google.com (API keys). Flash models are on the free tier.

**6. Vercel environment variables** (Settings → Environment Variables)

| Name | Value |
|---|---|
| `APP_PASSCODE` | a long passphrase (you type it once per device) |
| `SESSION_SECRET` | random 32+ characters (Bitwarden generator) |
| `APP_URL` | `https://YOUR-URL.vercel.app` (no trailing slash) |
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 |
| `GOOGLE_CLIENT_ID` | from step 4 |
| `GOOGLE_CLIENT_SECRET` | from step 4 |
| `GEMINI_API_KEY` | from step 5 |
| `GEMINI_MODEL` | optional. Leave blank and the app picks the newest Flash model |

**Then Deployments → ⋯ → Redeploy.** Env changes do nothing until you redeploy.

**7. First run**
1. Open the URL in Safari (or on your PC) → enter passcode.
2. Tap **Connect Google Calendar**. You'll see "Google hasn't verified this app" → Advanced → Go to Launch → Allow. Normal for a personal app.
3. iPhone/iPad: Share → Add to Home Screen.

## Good to know

- Google connects once for the whole app. Every other device just needs the passcode.
- Changing `SESSION_SECRET` (then redeploying) signs out every device.
- Priority/prep on a repeating event applies to the whole series.
- AI guesses never overwrite anything you set yourself.
- Reads your main Google calendar only.

## Not in v1 (v2 list)

Push notifications for reminders, AI quick capture, AI study/prep slot suggestions, Loop connection. v3: SimpleFIN bank sync, Home Assistant wall display.
