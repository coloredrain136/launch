// Priority / prep / travel for one event (or a whole repeating series).
export function cleanMeta(m = {}) {
  const n = (v, lo, hi, d) => {
    const x = Math.round(Number(v));
    return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d;
  };
  return {
    priority: n(m.priority, 1, 3, 2),
    prep_min: n(m.prep_min, 0, 240, 0),
    travel_min: n(m.travel_min, 0, 240, 0),
    prep_note: String(m.prep_note || '').trim().slice(0, 120),
  };
}

export function metaOut(m) {
  if (!m) return null;
  return {
    priority: m.priority,
    prep_min: m.prep_min,
    travel_min: m.travel_min,
    prep_note: m.prep_note || '',
    source: m.source,
  };
}
