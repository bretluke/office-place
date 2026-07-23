# Slack integration setup

The office now supports pulling each user's Slack presence + custom status
and showing it on their avatar + roster entry. Each user connects their own
Slack account via OAuth; the token lives in their browser only.

This adds three Vercel serverless functions under `/api/` and requires a
Slack app + two env vars.

## 1. Create the Slack app

1. Go to <https://api.slack.com/apps> and click **Create New App** → **From
   scratch**. Name it something like "BCG Office Status", pick your workspace.
2. In the sidebar, **OAuth & Permissions** →
   - **Redirect URLs** → Add `https://YOUR-VERCEL-DEPLOY.vercel.app/api/slack-oauth-callback`
     (replace with your actual Vercel URL — it must match exactly, including
     protocol, no trailing slash).
   - **User Token Scopes** → Add `users:read` and `users.profile:read`.
     Do NOT add these to Bot Token Scopes — we need user tokens, not bot ones.
3. Save. Under **Basic Information** you'll see the **Client ID** and
   **Client Secret**. Copy both.

Since this is for internal BCG use only, leave the app in Development
mode — no need to submit for distribution.

## 2. Configure Vercel env vars

In your Vercel project settings → **Environment Variables**, add:

| Name | Value | Environments |
| --- | --- | --- |
| `SLACK_CLIENT_ID` | (from step 1) | Production, Preview, Development |
| `SLACK_CLIENT_SECRET` | (from step 1) | Production, Preview, Development |
| `SLACK_REDIRECT_URI` | `https://YOUR-VERCEL-DEPLOY.vercel.app/api/slack-oauth-callback` | Production, Preview, Development |

The redirect URI must be identical to what you registered in the Slack app.

Redeploy after adding env vars — Vercel won't auto-restart functions on
env changes.

## 3. Users connect their accounts

Once deployed, each teammate opens the office, taps the settings gear
(bottom-right), and clicks **Connect Slack** in the new Slack section.
A popup takes them to Slack, they authorize the app, and their status
starts flowing to the mesh within ~60 seconds.

Tokens are stored in each user's browser localStorage only. Disconnecting
removes the token from the browser (Slack's token is still valid at that
point but no longer used — users can revoke it from
<https://myaccount.slack.com/> under Apps if they want).

## Files touched by this integration

- `api/slack-oauth-start.js` — redirects the browser to Slack's OAuth authorize URL
- `api/slack-oauth-callback.js` — exchanges the code for a token, posts it back to the office tab, closes the popup
- `api/slack-status.js` — proxy for `auth.test` + `users.getPresence` + `users.profile.get` (Slack doesn't send CORS headers so browser can't call directly)
- `index.html` — Slack section in the settings modal, polling loop, mesh broadcast, roster + avatar rendering
