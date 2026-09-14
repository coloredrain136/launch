import { db, q } from './db.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

export function appUrl(req) {
  const env = process.env.APP_URL;
  if (env) return env.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

export const redirectUri = (req) => `${appUrl(req)}/api/google-callback`;

function creds() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) {
    throw Object.assign(new Error('Google is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel, then redeploy.'), { status: 500 });
  }
  return { id, secret };
}

const notConnected = (msg) => Object.assign(new Error(msg), { status: 409, code: 'NOT_CONNECTED' });

export async function isConnected() {
  const row = await q(db().from('launch_google').select('refresh_token, connected_at').eq('id', 1).maybeSingle());
  return { connected: !!row?.refresh_token, connected_at: row?.connected_at || null };
}

export async function exchangeCode(req, code) {
  const { id, secret } = creds();
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || 'Google sign-in failed.');

  const existing = await q(db().from('launch_google').select('refresh_token').eq('id', 1).maybeSingle());
  const refresh = j.refresh_token || existing?.refresh_token;
  if (!refresh) {
    throw new Error("Google didn't grant offline access. Remove Launch at myaccount.google.com/permissions, then connect again.");
  }
  await q(db().from('launch_google').upsert({
    id: 1,
    refresh_token: refresh,
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
    connected_at: new Date().toISOString(),
  }));
}

async function accessToken() {
  const row = await q(db().from('launch_google').select('*').eq('id', 1).maybeSingle());
  if (!row?.refresh_token) throw notConnected('Google Calendar is not connected yet.');
  if (row.access_token && row.expires_at && new Date(row.expires_at).getTime() - 60_000 > Date.now()) {
    return row.access_token;
  }
  const { id, secret } = creds();
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: row.refresh_token, grant_type: 'refresh_token' }),
  });
  const j = await r.json();
  if (!r.ok) {
    if (j.error === 'invalid_grant') {
      await q(db().from('launch_google').update({ refresh_token: null, access_token: null }).eq('id', 1));
      throw notConnected('Google access expired. Reconnect Google Calendar in Settings.');
    }
    throw Object.assign(new Error(j.error_description || 'Could not refresh Google access.'), { status: 502 });
  }
  await q(db().from('launch_google').update({
    access_token: j.access_token,
    expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
  }).eq('id', 1));
  return j.access_token;
}

export async function gcal(path, { method = 'GET', query, body } = {}) {
  const token = await accessToken();
  const url = new URL('https://www.googleapis.com/calendar/v3' + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const gone = r.status === 404 || r.status === 410;
    throw Object.assign(new Error(j.error?.message || `Google Calendar error ${r.status}`), { status: gone ? 404 : 502, code: 'GOOGLE' });
  }
  return j;
}
