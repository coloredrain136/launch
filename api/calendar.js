import { route, send, body, TZ } from './_lib/http.js';
import { gcal } from './_lib/google.js';
import { db, q } from './_lib/db.js';
import { cleanMeta, metaOut } from './_lib/meta.js';

function norm(e) {
  const allDay = !!e.start?.date;
  const priv = e.extendedProperties?.private || {};
  return {
    id: e.id,
    metaKey: e.recurringEventId || e.id, // repeats share one priority/prep setting
    recurring: !!e.recurringEventId,
    title: e.summary || '(No title)',
    start: allDay ? e.start.date : e.start.dateTime,
    end: allDay ? e.end.date : e.end.dateTime,
    allDay,
    colorId: e.colorId || null,
    location: e.location || '',
    notes: e.description || '',
    link: e.htmlLink || '',
    goalId: priv.launchGoal || null,
    templateId: priv.launchTemplate || null,
  };
}

// "2026-09-10T14:00" (local, from the app) or "2026-09-10" for all-day
const gtime = (s, allDay) => (allDay ? { date: s.slice(0, 10) } : { dateTime: s.length === 16 ? `${s}:00` : s, timeZone: TZ });

async function metaFor(keys) {
  if (!keys.length) return {};
  const rows = await q(db().from('launch_event_meta').select('*').in('key', keys));
  return Object.fromEntries(rows.map((m) => [m.key, m]));
}

async function saveMeta(key, meta, source) {
  await q(db().from('launch_event_meta').upsert({ key, ...cleanMeta(meta), source, updated_at: new Date().toISOString() }));
}

export default route(async (req, res) => {
  if (req.method === 'GET') {
    const { from, to } = req.query;
    if (!from || !to) return send(res, 400, { error: 'from and to are required.' });
    const items = [];
    let pageToken;
    for (let i = 0; i < 4; i++) {
      const j = await gcal('/calendars/primary/events', {
        query: { timeMin: from, timeMax: to, singleEvents: 'true', orderBy: 'startTime', maxResults: '250', pageToken },
      });
      items.push(...(j.items || []));
      pageToken = j.nextPageToken;
      if (!pageToken) break;
    }
    const events = items.filter((e) => e.status !== 'cancelled').map(norm);
    const meta = await metaFor([...new Set(events.map((e) => e.metaKey))]);
    for (const e of events) e.meta = metaOut(meta[e.metaKey]);
    return send(res, 200, { events });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  const b = body(req);

  if (b.action === 'create') {
    const ev = b.event || {};
    if (!ev.title || !ev.start || !ev.end) return send(res, 400, { error: 'Title, start, and end are required.' });
    const priv = {};
    if (ev.goalId) priv.launchGoal = String(ev.goalId);
    if (ev.templateId) priv.launchTemplate = String(ev.templateId);
    const created = await gcal('/calendars/primary/events', {
      method: 'POST',
      body: {
        summary: String(ev.title).slice(0, 200),
        location: ev.location || undefined,
        description: ev.notes || undefined,
        colorId: ev.colorId || undefined,
        start: gtime(ev.start, ev.allDay),
        end: gtime(ev.end, ev.allDay),
        extendedProperties: Object.keys(priv).length ? { private: priv } : undefined,
      },
    });
    const out = norm(created);
    if (b.meta) {
      const source = b.meta.source === 'template' ? 'template' : 'manual';
      try { await saveMeta(created.id, b.meta, source); out.meta = { ...cleanMeta(b.meta), source }; } catch (e) { console.error(e); }
    }
    let travel = null;
    if (b.travel?.start && b.travel?.end && !ev.allDay) {
      try {
        const t = await gcal('/calendars/primary/events', {
          method: 'POST',
          body: { summary: String(b.travel.title || 'Drive').slice(0, 200), colorId: '8', start: gtime(b.travel.start), end: gtime(b.travel.end) },
        });
        travel = norm(t);
        const tm = { priority: 1, prep_min: 0, travel_min: 0, prep_note: '' };
        await saveMeta(t.id, tm, 'template');
        travel.meta = { ...tm, source: 'template' };
      } catch (e) { console.error(e); }
    }
    return send(res, 200, { event: out, travel });
  }

  if (b.action === 'update') {
    const p = b.patch || {};
    const patch = {};
    if (p.title != null) patch.summary = String(p.title).slice(0, 200);
    if (p.location != null) patch.location = String(p.location);
    if (p.start && p.end) { patch.start = gtime(p.start, p.allDay); patch.end = gtime(p.end, p.allDay); }
    const updated = await gcal(`/calendars/primary/events/${encodeURIComponent(b.id)}`, { method: 'PATCH', body: patch });
    const out = norm(updated);
    out.meta = metaOut((await metaFor([out.metaKey]))[out.metaKey]);
    return send(res, 200, { event: out });
  }

  if (b.action === 'delete') {
    try {
      await gcal(`/calendars/primary/events/${encodeURIComponent(b.id)}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status !== 404) throw err;
    }
    return send(res, 200, { ok: true });
  }

  if (b.action === 'meta') {
    if (!b.key) return send(res, 400, { error: 'key is required.' });
    // Ticking a checklist box is not you overriding the AI's guess, so keep the source.
    const source = b.source === 'checklist'
      ? ((await metaFor([String(b.key)]))[String(b.key)]?.source || 'ai')
      : 'manual';
    await saveMeta(String(b.key), b.meta || {}, source);
    return send(res, 200, { meta: { ...cleanMeta(b.meta || {}), source } });
  }

  send(res, 400, { error: 'Unknown action.' });
});
