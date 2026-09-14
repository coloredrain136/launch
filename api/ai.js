import { route, send, body } from './_lib/http.js';
import { db, q } from './_lib/db.js';
import { geminiJSON } from './_lib/gemini.js';
import { cleanMeta, metaOut, cleanList } from './_lib/meta.js';

const clip = (s, n) => String(s || '').trim().slice(0, n);

async function profile() {
  const row = await q(db().from('launch_settings').select('value').eq('id', 'profile').maybeSingle());
  return clip(row?.value?.text, 2000) || 'Joe, Fenton, Michigan (Eastern Time).';
}

// Routines are invisible anchors: never on the calendar, always in the AI's head.
function routineText(r) {
  if (!r) return '';
  const lines = [];
  if (r.home_address) lines.push(`Home base: ${clip(r.home_address, 120)}.`);
  for (const a of (r.anchors || []).slice(0, 12)) {
    if (!a?.label || !a?.time) continue;
    const when = a.days === 'weekdays' ? 'weekdays' : a.days === 'weekends' ? 'weekends' : 'every day';
    lines.push(`${clip(a.label, 60)} at ${a.time}, ${when}.`);
  }
  return lines.length ? `\nFixed routine (these never appear on the calendar, but they are real):\n${lines.join('\n')}` : '';
}
async function routines() {
  const row = await q(db().from('launch_settings').select('value').eq('id', 'routines').maybeSingle());
  return row?.value || null;
}

const TRIAGE = (who) => `You estimate how much each calendar event matters and how much getting ready it needs, for this person:
${who}

For each event return:
- id: copy it exactly
- priority: 1 (low: casual, optional, social), 2 (normal: routine work shifts, gym, regular commitments), 3 (high: tournaments, exams, interviews, appointments, deadlines, travel days, anything costly to miss or be late for)
- prep_min: minutes of getting ready before leaving or starting (packing gear, changing, reviewing). 0-120. Routine things are 0-15.
- travel_min: driving minutes from Fenton, Michigan. 0 if at home, virtual, or the location is unknown and the title gives no clue.
- prep_note: max 8 words, concrete (e.g. "Pack paddle, water, shoes"), or "" if nothing specific.
- prep_items: 0-5 short checklist items for what to do or bring before this. 2-5 words each, concrete objects or actions. Empty array for routine things that need no packing.

Return only JSON: {"results":[{"id":"...","priority":2,"prep_min":10,"travel_min":0,"prep_note":"","prep_items":[]}]}`;

const BRIEF = (who) => `You write the morning game plan inside Launch, a personal day planner. The person:
${who}

Voice: a sharp, practical friend. Casual, direct, specific. No fluff, no motivational filler, no emojis, no greetings.

How the day actually works — get this right, it is the whole point:
- Travel runs both ways. If an event has drive_minutes, he also needs that long to get back home afterwards. An event ending at 5:00 with a 20 minute drive means he is home around 5:20, not at 5:00.
- Between two commitments he goes home unless the timing makes that impossible. Say what happens at home (eat, change, drop stuff) at the time he is actually there, never at the time the first thing ends.
- turnaround_minutes on an event is how long he needs at home before heading back out for it. Work backwards from its get_ready_by time.
- Use his fixed routine below as real constraints. If a wake time and a leave time leave a tight window, say so.
- Never tell him to do something at a time he is driving, working, or not home yet.

Other rules:
- Use only the events, times, reminders, goals, and routine given. Never invent anything.
- Lead with what actually defines the day. Mention get-ready and leave-by times for anything that has them.
- If there is open time and a goal is behind, say which open slot to use for it. Ignore goals that have not started yet.
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
    const rows = list.filter((r) => ids.has(String(r.id))).map((r) => ({
      key: String(r.id), ...cleanMeta({ ...r, checklist: cleanList(r.prep_items) }), source: 'ai', updated_at: now,
    }));
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
    const [who, r] = await Promise.all([profile(), routines()]);
    const out = await geminiJSON(BRIEF(who + routineText(r)), user);
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
