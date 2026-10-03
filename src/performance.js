// Local observations only; a browser/GPU profile is not a phone identity.
export const PERFORMANCE_KEY = 'pocket-ai-performance-v2';
export const JOURNAL_KEY = 'pocket-ai-load-journal-v1';
export const PROTOCOL = 'short-chat-v2';
export function median(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const n = s.length >> 1;
  return !s.length ? null : s.length % 2 ? s[n] : (s[n - 1] + s[n]) / 2;
}
export function profileFor(hw, browser) {
  return JSON.stringify({ browser, gpu: hw?.label || 'unknown', limits: hw?.limits || {}, features: [...(hw?.features || [])].sort() });
}
export function configFor(m) {
  return JSON.stringify({ id: m.id, runtime: m.runtime, version: m.runtime === 'bitgpu' ? '0.19.1' : '0.2.84', context: m.maxSeqLen || m.overrides?.context_window_size, kv: m.kvCache, generation: m.generation, overrides: m.overrides });
}
export function readMeasurements(storage = localStorage) {
  try { const v = JSON.parse(storage.getItem(PERFORMANCE_KEY)); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function recordMeasurement(row, storage = localStorage) {
  try { storage.setItem(PERFORMANCE_KEY, JSON.stringify([{ ...row, at: Date.now() }, ...readMeasurements(storage)].slice(0, 100))); return true; } catch { return false; }
}
export function recommendation(rows, profile) {
  const matching = rows.filter(r => r.profile === profile);
  const candidates = [...new Set(matching.map(r => r.config))].flatMap(config => {
    const evidence = matching.filter(r => r.config === config);
    const failure = evidence.findIndex(r => r.kind === 'failure');
    const recent = failure < 0 ? evidence : evidence.slice(0, failure);
    if (!recent.some(r => r.kind === 'load') || !recent.some(r => ['generation', 'benchmark'].includes(r.kind))) return [];
    const runs = recent.filter(r => r.kind === 'benchmark' && r.protocol === PROTOCOL && r.samples?.length === 3);
    return [{ name: recent[0].name, speed: median(runs.map(r => r.firstTextMs)) }];
  });
  candidates.sort((a, b) => (a.speed ?? Infinity) - (b.speed ?? Infinity));
  const best = candidates[0];
  return best ? `${best.name}: loaded and answered on this browser/GPU profile.${best.speed == null ? ' Run Speed test to compare models.' : ' Fastest measured first text among models with successful load and reply evidence.'} Conditions can change; this is not a memory guarantee.` : 'No model fit measured for this browser/GPU profile yet. Load a model and complete a reply.';
}
export async function measureRuns({ generate, reset, now = () => performance.now(), stopped, progress }) {
  const samples = [];
  for (let index = 0; index < 4; index++) {
    if (stopped()) throw new Error('Stopped. No benchmark saved.');
    progress(index === 0 ? 'Warming up…' : `Measured run ${index} of 3…`);
    await reset();
    let first = null;
    const start = now();
    const result = await generate(text => { if (text.trim() && first === null) first = now(); });
    const end = now();
    if (stopped() || result.finishReason === 'abort' || !result.text?.trim() || first === null) throw new Error('Interrupted or empty reply. No benchmark saved.');
    if (index) samples.push({ firstTextMs: first - start, tokens: result.tokens, tokensPerSecond: Number.isFinite(result.tokens) && end > start ? result.tokens * 1000 / (end - start) : null });
  }
  return { protocol: PROTOCOL, samples, firstTextMs: median(samples.map(r => r.firstTextMs)), tokensPerSecond: median(samples.map(r => r.tokensPerSecond)) };
}
