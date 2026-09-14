import { route, send, body } from './_lib/http.js';
import { db, q } from './_lib/db.js';
import { isConnected } from './_lib/google.js';

const TABLES = {
  templates: { t: 'launch_templates', cols: ['id', 'name', 'color_id', 'duration_min', 'default_start', 'priority', 'prep_min', 'prep_note', 'travel_min', 'add_travel', 'goal_id', 'sort'] },
  reminders: { t: 'launch_reminders', cols: ['id', 'title', 'notes', 'due_date', 'due_time', 'priority', 'done', 'done_at'] },
  goals: { t: 'launch_goals', cols: ['id', 'title', 'category', 'type', 'frequency', 'per_week', 'target', 'current', 'start_value', 'unit', 'step', 'deadline', 'archived', 'sort'] },
  logs: { t: 'launch_goal_logs', cols: ['id', 'goal_id', 'day', 'value', 'note'] },
  milestones: { t: 'launch_milestones', cols: ['id', 'goal_id', 'title', 'done', 'sort'] },
  settings: { t: 'launch_settings', cols: ['id', 'value'] },
};

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();

export default route(async (req, res) => {
  const d = db();

  if (req.method === 'GET') {
    const [templates, openRem, doneRem, goals, logs, milestones, settings, google] = await Promise.all([
      q(d.from('launch_templates').select('*').order('sort').order('name')),
      q(d.from('launch_reminders').select('*').eq('done', false).order('due_date', { nullsFirst: false })),
      q(d.from('launch_reminders').select('*').eq('done', true).gte('done_at', daysAgo(7)).order('done_at', { ascending: false })),
      q(d.from('launch_goals').select('*').eq('archived', false).order('sort').order('created_at')),
      q(d.from('launch_goal_logs').select('*').gte('day', daysAgo(400).slice(0, 10)).order('day')),
      q(d.from('launch_milestones').select('*').order('sort').order('created_at')),
      q(d.from('launch_settings').select('*')),
      isConnected(),
    ]);
    return send(res, 200, { templates, reminders: [...openRem, ...doneRem], goals, logs, milestones, settings, google });
  }

  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  const b = body(req);
  const spec = TABLES[b.table];
  if (!spec) return send(res, 400, { error: 'Unknown table.' });

  if (b.action === 'upsert') {
    const row = {};
    for (const c of spec.cols) if (b.row && c in b.row) row[c] = b.row[c] === '' ? null : b.row[c];
    if (!row.id) return send(res, 400, { error: 'Row id is required.' });
    const saved = await q(d.from(spec.t).upsert(row).select().single());
    return send(res, 200, { row: saved });
  }

  if (b.action === 'delete') {
    if (!b.id) return send(res, 400, { error: 'id is required.' });
    await q(d.from(spec.t).delete().eq('id', b.id));
    return send(res, 200, { ok: true });
  }

  send(res, 400, { error: 'Unknown action.' });
});
