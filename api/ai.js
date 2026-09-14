import { route, send, body } from './_lib/http.js';
import { db, q } from './_lib/db.js';
import { geminiJSON } from './_lib/gemini.js';
import { cleanMeta, metaOut } from './_lib/meta.js';

const clip = (s, n) => String(s || '').trim().slice(0, n);

async function profile() {
  const row = await q(db().from('launch_settings').select('value').eq('id', 'profile').maybeSingle());
  return clip(row?.value?.text, 2000) || 'Joe, Fenton, Michigan (Eastern Time).';
}

const TRIAGE = (who) => `You estimate how much each calendar event matters and how much getting ready it needs, for this person:
${who}

For each event return:
- id: copy it exactly
- priority: 1 (low: casual, optional, social), 2 (normal: routine work shifts, gym, regular commitments), 3 (high: tournaments, exams, interviews, appointments, deadlines, travel days, anything costly to miss or be late for)
- prep_min: minutes of getting ready before leaving or starting (packing gear, changing, reviewing). 0-120. Routine things are 0-15.
- travel_min: driving minutes from Fenton, Michigan. 0 if at home, virtual, or the location is unknown and the title gives no clue.
- prep_note: max 8 words, concrete (e.g. "Pack paddle, water, shoes"), or "" if nothing specific.

Return only JSON: {"results":[{"id":"...","priority":2,"prep_min":10,"travel_min":0,"prep_note":""}]}`;

const BRIEF = (who) => `You write the morning game plan inside Launch, a personal day planner. The person:
${who}

Voice: a sharp, practical friend. Casual, direct, specific. No fluff, no motivational filler, no emojis, no greetings.
Rules:
- Use only the events, times, reminders, and goals given. Never invent anything.
- Lead with what actually defines the day. Mention get-ready and leave-by times for anything that has them.
- If there's open time and a goal is behind, say which open slot to use for it.
- If the day is light, say so plainly and point at the most useful thing to do with it.
Return only JSON:
{"headline":"max 9 words, the one thing that defines today","plan":"2-4 short sentences","focus":["up to 3 short actions, max 7 words each"]}`;

export default route(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const b = body(req);

  if (b.action === 'triage') {
    const events = (b.events || []).slice(0, 40).map((e) => ({
      id: String(e.id), title: clip(e.title, 140), when: clip(e.when, 80), category: clip(e.category, 40), location: clip(e.location, 140),
    }));
    if (!events.length) return send(res, 200, { results: {} });
    const out = await geminiJSON(TRIAGE(await profile()), JSON.stringify(events));
    const list = Array.isArray(out?.results) ? out.results : Array.isArray(out) ? out : [];
    const ids = new Set(events.map((e) => e.id));
    const now = new Date().toISOString();
    const rows = list.filter((r) => ids.has(String(r.id))).map((r) => ({ key: String(r.id), ...cleanMeta(r), source: 'ai', updated_at: now }));
    // ignoreDuplicates: an AI guess never overwrites something you set yourself
    if (rows.length) await q(db().from('launch_event_meta').upsert(rows, { onConflict: 'key', ignoreDuplicates: true }));
    const stored = await q(db().from('launch_event_meta').select('*').in('key', [...ids]));
    const results = Object.fromEntries(stored.map((m) => [m.key, metaOut(m)]));
    return send(res, 200, { results });
  }

  if (b.action === 'briefing') {
    const day = clip(b.day, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 400, { error: 'day must be YYYY-MM-DD.' });
    if (!b.force) {
      const cached = await q(db().from('launch_briefings').select('*').eq('day', day).maybeSingle());
      if (cached) return send(res, 200, { briefing: cached });
    }
    const user = `Right now: ${clip(b.now, 60)}\n\nToday:\n${JSON.stringify(b.context || {}).slice(0, 12000)}`;
    const out = await geminiJSON(BRIEF(await profile()), user);
    const row = {
      day,
      headline: clip(out.headline, 90) || 'Here is your day',
      plan: clip(out.plan, 800),
      focus: (Array.isArray(out.focus) ? out.focus : []).slice(0, 3).map((f) => clip(f, 70)).filter(Boolean),
      hash: clip(b.hash, 40),
      created_at: new Date().toISOString(),
    };
    await q(db().from('launch_briefings').upsert(row));
    return send(res, 200, { briefing: row });
  }

  send(res, 400, { error: 'Unknown action.' });
});
