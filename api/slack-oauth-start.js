// Redirects the browser to Slack's OAuth authorize URL.
//
// The browser opens this endpoint in a popup with a `state` query param
// (a random nonce the client generated). We forward that state to Slack;
// Slack sends the user back to /api/slack-oauth-callback with the same
// state, and the callback verifies it before completing the exchange.
//
// Env vars this function needs (set in Vercel project settings):
//   SLACK_CLIENT_ID       — public app client ID
//   SLACK_REDIRECT_URI    — must exactly match the redirect URL registered
//                           in the Slack app config
//
// The user_scope query param encodes what we want to read on behalf of
// the *user* (not a bot). users:read gives us presence + basic profile;
// users.profile:read gives us the custom status (text/emoji/expiration).

module.exports = (req, res) => {
  const clientId    = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    res.status(500).send('Slack OAuth is not configured on the server.');
    return;
  }

  // State is a CSRF nonce chosen by the client. If none, we generate one
  // — but the browser normally sends its own so it can verify on return.
  const state = (req.query && req.query.state) || Math.random().toString(36).slice(2);
  const userScopes = ['users:read', 'users.profile:read'].join(',');

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('user_scope', userScopes);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);

  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: url.toString() });
  res.end();
};
