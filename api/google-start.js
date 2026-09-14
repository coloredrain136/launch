import crypto from 'node:crypto';
import { route, send, sign } from './_lib/http.js';
import { SCOPES, redirectUri } from './_lib/google.js';

// Returns the Google consent URL. The app navigates there itself, so the
// session token never ends up in a URL.
export default route(async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return send(res, 500, { error: 'GOOGLE_CLIENT_ID is not set in Vercel.' });
  const state = sign({ kind: 'oauth', exp: Date.now() + 15 * 60_000, n: crypto.randomBytes(8).toString('hex') });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri(req));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  send(res, 200, { url: url.toString() });
});
