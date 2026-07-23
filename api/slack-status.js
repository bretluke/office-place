// Reads the current user's Slack presence + custom status.
//
// The browser can't call Slack's Web API directly (Slack doesn't send
// CORS headers), so this proxy runs on Vercel with the caller's user
// token forwarded through. We never store the token; we just relay.
//
// Request: POST /api/slack-status  with JSON body { token: "xoxp-..." }
// Response: { ok, presence, statusText, statusEmoji, statusExpiration,
//             displayName, userId, teamId, error? }
//
// We deliberately return a small, stable shape rather than passing
// through the raw Slack response — that lets us layer in DND / avatar
// / other signals later without churning the client contract.

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  // Vercel parses JSON bodies automatically when Content-Type is set,
  // but be defensive in case it's not.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const token = body && body.token;
  if (!token || typeof token !== 'string' || !token.startsWith('xox')) {
    return res.status(400).json({ ok: false, error: 'missing_or_bad_token' });
  }

  try {
    // Step 1: auth.test — confirms the token works and gives us the
    // user id we need for the profile lookup.
    const authRes = await slackGet('auth.test', token);
    if (!authRes.ok) {
      return res.status(401).json({ ok: false, error: authRes.error || 'auth_failed' });
    }
    const userId = authRes.user_id;
    const teamId = authRes.team_id;

    // Step 2 + 3 in parallel: presence + profile
    const [presenceRes, profileRes] = await Promise.all([
      slackGet('users.getPresence', token, { user: userId }),
      slackGet('users.profile.get', token, { user: userId }),
    ]);

    const presence = presenceRes.ok ? (presenceRes.presence || null) : null;
    const profile  = (profileRes.ok && profileRes.profile) || {};
    const statusText  = profile.status_text  || '';
    const statusEmoji = profile.status_emoji || '';
    const statusExpiration = profile.status_expiration || 0;
    const displayName = profile.display_name || profile.real_name || authRes.user || '';

    return res.status(200).json({
      ok: true,
      presence,          // 'active' | 'away' | null
      statusText,        // "back in 10" or ""
      statusEmoji,       // ":coffee:" or ""
      statusExpiration,  // unix seconds; 0 = no expiration
      displayName,
      userId,
      teamId,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'slack_call_threw', detail: String(e && e.message || e) });
  }
};

// Slack Web API helper. All methods accept the token via Authorization
// header (Bearer). Params go in the query string for GET methods; both
// endpoints we use here (auth.test, users.getPresence, users.profile.get)
// support GET. We pin the API URL to https://slack.com/api/{method}.
async function slackGet(method, token, params) {
  const url = new URL('https://slack.com/api/' + method);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const r = await fetch(url.toString(), {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  return await r.json();
}
