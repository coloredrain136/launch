import { verify } from './_lib/http.js';
import { exchangeCode } from './_lib/google.js';

export default async function handler(req, res) {
  const back = (q) => { res.statusCode = 302; res.setHeader('Location', '/?' + q); res.end(); };
  const fail = (msg) => back('google=error&msg=' + encodeURIComponent(msg));
  try {
    const { code, state, error } = req.query;
    if (error) return fail(error === 'access_denied' ? 'Google access was declined.' : error);
    if (!verify(state, 'oauth')) return fail('That sign-in link expired. Tap Connect again.');
    if (!code) return fail('Google did not send a sign-in code.');
    await exchangeCode(req, code);
    back('google=connected');
  } catch (err) {
    console.error(err);
    fail(err.message || 'Google sign-in failed.');
  }
}
