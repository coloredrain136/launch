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
- Use only the events, times, reminders, goals, and routine given. Never invent anything. Never name a goal, class, or certification that is not in the goals list, even if the profile mentions one.
- Lead with what actually defines the day. Mention get-ready and leave-by times for anything that has them.
- If there is open time and a goal is behind, say which open slot to use for it. Ignore goals that have not started yet.
- If the day is light, say so plainly and point at the most useful thing to do with it.
Return only JSON:
{"headline":"max 9 words, the one thing that defines today","plan":"2-4 short sentences","focus":["up to 3 short actions, max 7 words each"]}`;

const SLOT = (who) => `You find a realistic time for a task in someone's week. The person:
${who}

You get the task and a list of genuinely open windows. Pick ONE window and a start time inside it.
Rules:
- Only use the windows given. Never invent time.
- Match the task to the right kind of window: phone calls and errands need business hours on a weekday, quiet work suits evenings, anything long needs a wide window.
- Leave breathing room. Don't start a task at the very end of a window.
- Prefer sooner, but not at the cost of a bad fit.
- duration_min: your estimate of how long it actually takes, 15 to 180.
- why: max 12 words, plain, why this slot works.
If nothing fits, return {"none":true,"why":"short reason"}.
Return only JSON: {"day":"YYYY-MM-DD","start":"HH:MM","duration_min":30,"why":"..."}`;

const WEEKLY = (who) => `You write a short Sunday check-in inside Launch, reviewing the week that just ended and setting up the next one. The person:
${who}

Voice: a sharp, practical friend. Casual, direct, specific. No fluff, no motivational filler, no emojis.
Rules:
- Use only the goals, progress, open time, and events given. Never invent anything.
- If the goals list is empty, say exactly that there are no goals set up yet and keep it to one or two sentences. Never name a goal, subject, certification, or project that is not in the list, even if the profile above mentions one. The profile is background for tone only, never a source of goals.
- Be honest about what slipped. Don't soften it, don't pile on.
- Ignore goals that haven't started yet. Mention them only if one starts this coming week.
- For each goal that needs attention, name a real open window from next week where the work fits.
- Suggestions: max 3, each tied to one goal.
Return only JSON:
{"headline":"max 9 words on the week","review":"2-4 short sentences","suggestions":[{"goal":"goal title","text":"max 16 words, names a real day and time"}]}`;

const GOALQ = (who) => `You help set up one goal, one question at a time, inside a personal planner. The person:
${who}

You get what they've answered so far. Decide the single best next question, in their words, about their actual goal. Never ask something they already answered.

The flow you are steering toward: what the goal is, roughly what area of life it's in, how it should be tracked, the number or checklist that defines "done", and when.

Tracking types:
- "number": anything that counts up to a target (money saved, pounds lost, chapters read, miles ridden).
- "streak": doing a thing repeatedly with no finish line (gym 4x a week, reading daily).
- "milestone": a list of steps that get checked off (launch a thing, plan an event).

Ask the question the way a friend would, about their specific goal. For a savings goal ask what they're saving toward or how much they want to have. For a streak ask how many days a week feels realistic. Never ask a generic "what is your target value".

Return only JSON:
{"field":"title|category|type|unit|target|current|rate|per_week|steps|deadline|start_date|done",
 "question":"max 14 words, conversational, about their goal specifically",
 "hint":"max 12 words of help, or empty",
 "suggest":"your best guess at the answer, or empty",
 "options":["only for category or type: the allowed values"],
 "input":"text|number|date|choice"}

Allowed category values: fitness, study, money, habits, work, other.
When everything needed is answered, return field "done" with a question that is a one-line summary of the goal.`;

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

  if (b.action === 'goalq') {
    const answers = {};
    for (const [k, v] of Object.entries(b.answers || {})) answers[clip(k, 20)] = clip(String(v), 120);
    const out = await geminiJSON(GOALQ(await profile()), JSON.stringify({ answered: answers, today: clip(b.today, 10) }));
    return send(res, 200, {
      field: clip(out.field, 20) || 'done',
      question: clip(out.question, 140),
      hint: clip(out.hint, 100),
      suggest: clip(out.suggest, 80),
      options: (Array.isArray(out.options) ? out.options : []).slice(0, 6).map((x) => clip(x, 30)),
      input: ['text', 'number', 'date', 'choice'].includes(out.input) ? out.input : 'text',
    });
  }

  if (b.action === 'slot') {
    const task = clip(b.task, 200);
    if (!task) return send(res, 400, { error: 'task is required.' });
    const windows = (b.windows || []).slice(0, 40).map((x) => clip(x, 60));
    if (!windows.length) return send(res, 200, { none: true, why: 'No open time in the next week.' });
    const out = await geminiJSON(SLOT(await profile()), JSON.stringify({ task, note: clip(b.note, 200), today: clip(b.today, 10), open_windows: windows }));
    if (out?.none) return send(res, 200, { none: true, why: clip(out.why, 120) });
    const day = clip(out.day, 10), start = clip(out.start, 5);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(start)) {
      return send(res, 200, { none: true, why: 'Could not find a clean slot. Pick a time yourself.' });
    }
    const dur = Math.min(180, Math.max(15, Math.round(Number(out.duration_min) || 30)));
    return send(res, 200, { day, start, duration_min: dur, why: clip(out.why, 120) });
  }

  if (b.action === 'weekly') {
    const week = clip(b.week_start, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) return send(res, 400, { error: 'week_start must be YYYY-MM-DD.' });
    if (!b.force) {
      const cached = await q(db().from('launch_checkins').select('*').eq('week_start', week).maybeSingle());
      if (cached) return send(res, 200, { checkin: cached });
    }
    const out = await geminiJSON(WEEKLY(await profile()), JSON.stringify(b.context || {}).slice(0, 12000));
    const row = {
      week_start: week,
      headline: clip(out.headline, 90) || 'Week in review',
      review: clip(out.review, 800),
      suggestions: (Array.isArray(out.suggestions) ? out.suggestions : []).slice(0, 3)
        .map((x) => ({ goal: clip(x.goal, 80), text: clip(x.text, 140) })).filter((x) => x.text),
      hash: clip(b.hash, 40),
      created_at: new Date().toISOString(),
    };
    await q(db().from('launch_checkins').upsert(row));
    return send(res, 200, { checkin: row });
  }

  send(res, 400, { error: 'Unknown action.' });
});
