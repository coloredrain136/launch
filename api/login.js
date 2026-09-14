import { sign, safeEqual, send, body } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  try {
    const pass = process.env.APP_PASSCODE;
    if (!pass) return send(res, 500, { error: 'APP_PASSCODE is not set in Vercel.' });
    const { passcode } = body(req);
    if (!passcode || !safeEqual(passcode, pass)) {
      await new Promise((r) => setTimeout(r, 700)); // slows down guessing
      return send(res, 403, { error: "That passcode didn't match." });
    }
    const token = sign({ kind: 'session', iat: Date.now(), exp: Date.now() + 365 * 864e5 });
    send(res, 200, { token });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
}
