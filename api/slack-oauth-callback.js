// Handles Slack's redirect after the user authorizes the app.
//
// Flow:
//   1. Slack redirects the popup here with ?code=…&state=…
//   2. We POST to slack.com/api/oauth.v2.access with the code + our
//      client secret to trade for a user access token.
//   3. We return a tiny HTML page that postMessage()s the token back
//      to window.opener and then closes itself. The opener (the main
//      office tab) receives the token and stores it in localStorage.
//
// If anything fails we return an HTML page with the error and a Close
// button — the user won't be silently stranded on a blank popup.

module.exports = async (req, res) => {
  const { code, state, error } = req.query || {};
  const clientId     = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri  = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return sendResult(res, { ok: false, error: 'server_misconfigured' });
  }
  if (error) {
    // User denied, or Slack returned an error out of the gate
    return sendResult(res, { ok: false, error: String(error), state });
  }
  if (!code) {
    return sendResult(res, { ok: false, error: 'missing_code', state });
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: String(code),
      redirect_uri: redirectUri,
    });
    const slackRes = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await slackRes.json();
    if (!data.ok) {
      return sendResult(res, { ok: false, error: data.error || 'oauth_failed', state });
    }
    // v2 puts the user token under authed_user (the bot token, if any,
    // lives at data.access_token). We only care about the user token
    // since we're reading the signed-in user's own presence & status.
    const user  = data.authed_user || {};
    const token = user.access_token;
    if (!token) {
      return sendResult(res, { ok: false, error: 'no_user_token', state });
    }
    const teamName = (data.team && data.team.name)  || null;
    const teamId   = (data.team && data.team.id)    || null;
    const userId   = user.id || null;

    return sendResult(res, {
      ok: true,
      state,
      token,
      teamName,
      teamId,
      userId,
    });
  } catch (e) {
    return sendResult(res, { ok: false, error: 'exchange_threw', state, detail: String(e && e.message || e) });
  }
};

// Renders an HTML page that posts the result to window.opener and then
// closes itself. Origin matching: we accept the opener's origin (the
// browser fills in event.origin for us). The parent verifies both the
// origin and the state nonce before trusting the message.
function sendResult(res, payload) {
  const json = JSON.stringify(payload);
  const safeJson = json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Slack connect</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0a0b0e;color:#e8eaef;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{max-width:360px;padding:24px 28px;text-align:center;
        border:1px solid #2a2e3a;border-radius:14px;background:#1a1d24}
  h2{margin:0 0 8px;font-size:16px}
  p{margin:0 0 16px;color:#b8bcc8;font-size:13px;line-height:1.5}
  button{background:#00e5ff;color:#0a0b0e;border:none;padding:10px 18px;
         border-radius:8px;font-weight:600;font-size:13px;cursor:pointer}
  .err{color:#ff6b8a}
</style>
</head><body>
<div class="card">
  <h2 id="title">Connecting…</h2>
  <p id="msg">Talking to Slack.</p>
  <button onclick="window.close()">Close</button>
</div>
<script>
(function () {
  var payload = ${safeJson};
  var title = document.getElementById('title');
  var msg   = document.getElementById('msg');
  if (payload.ok) {
    title.textContent = 'Connected';
    msg.textContent = 'You can close this window.';
  } else {
    title.textContent = 'Not connected';
    msg.textContent = 'Slack returned: ' + (payload.error || 'unknown error');
    msg.className = 'err';
  }
  try {
    if (window.opener) {
      window.opener.postMessage(
        Object.assign({ __bcgSlack: true }, payload),
        '*'
      );
      setTimeout(function () { try { window.close(); } catch (e) {} }, payload.ok ? 400 : 3000);
    }
  } catch (e) {}
})();
</script>
</body></html>`;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).send(html);
}
