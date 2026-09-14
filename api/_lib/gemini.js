// Gemini Flash for the AI bits. Model names change often, so if the default
// alias 404s and GEMINI_MODEL isn't set, we ask the API which Flash models
// exist and use the newest one.
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
let discovered = null;

async function discover(key) {
  const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  const j = await r.json().catch(() => ({}));
  const names = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && /flash/.test(n) && !/(image|tts|live|audio|embed|exp)/.test(n));
  const ver = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const score = (n) => ver(n) * 10 - (/preview/.test(n) ? 5 : 0);
  names.sort((a, b) => score(b) - score(a));
  if (!names.length) throw Object.assign(new Error('No Gemini Flash model is available for this API key.'), { status: 502, code: 'AI' });
  return names[0];
}

function parseJSON(text) {
  const s = String(text || '').replace(/```json|```/g, '').trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw Object.assign(new Error('The AI sent back something unreadable. Try again.'), { status: 502, code: 'AI' });
}

export async function geminiJSON(system, user) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw Object.assign(new Error('AI is off. Add GEMINI_API_KEY in Vercel, then redeploy.'), { status: 503, code: 'NO_AI' });

  const call = (model) => fetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
  });

  let model = process.env.GEMINI_MODEL || discovered || 'gemini-flash-lite-latest';
  let r = await call(model);
  if (r.status === 404 && !process.env.GEMINI_MODEL) {
    discovered = await discover(key);
    r = await call(discovered);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = r.status === 429 ? 'The AI is rate-limited right now. Try again in a minute.' : (j.error?.message || `Gemini error ${r.status}`);
    throw Object.assign(new Error(msg), { status: 502, code: 'AI' });
  }
  const text = (j.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
  return parseJSON(text);
}
