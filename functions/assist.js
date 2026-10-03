export const ASSIST_PROTOCOL = 'pocket-assist-v2';
export async function handleAssist(request, response, { url, key, defaultModel, bonsaiModel, fetcher = fetch }) {
  response.set('Cache-Control', 'no-store');
  const route = typeof bonsaiModel === 'string' ? bonsaiModel.trim() : '';
  const configured = !!route && !/^auto(?::|$)/i.test(route);
  if (request.method === 'GET') return response.json({ protocol: ASSIST_PROTOCOL, bonsai27b: configured });
  if (request.method !== 'POST') return response.status(405).json({ error: 'Use GET or POST.' });
  const profile = request.body?.profile ?? 'default';
  if (!['default', 'bonsai-27b'].includes(profile) || Object.hasOwn(request.body || {}, 'model')) return response.status(400).json({ error: 'Unknown model profile.' });
  if (profile === 'bonsai-27b' && !configured) return response.status(503).json({ error: 'A specific Bonsai 27B route has not been configured.' });
  const input = request.body?.messages;
  if (!Array.isArray(input)) return response.status(400).json({ error: 'A chat message is required.' });
  const system = input[0]?.role === 'system' ? [input[0]] : [];
  const messages = [...system, ...input.slice(system.length).filter(m => m?.role !== 'system').slice(-15)]
    .filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .map(m => ({ role: m.role, content: m.content.slice(0, 12000) }));
  if (!messages.some(m => m.role === 'user' && m.content.trim())) return response.status(400).json({ error: 'A user message is required.' });
  try {
    const upstream = await fetcher(url(), {
      method: 'POST', signal: AbortSignal.timeout(55000),
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: profile === 'bonsai-27b' ? route : defaultModel || 'auto:smart', messages, temperature: 0.7, max_tokens: 512, stream: false }),
    });
    const result = await upstream.json().catch(() => null);
    const content = result?.choices?.[0]?.message?.content;
    if (!upstream.ok || typeof content !== 'string' || !content.trim()) return response.status(502).json({ error: 'The configured online model could not return an answer.' });
    return response.json({ content: content.trim(), profile, protocol: ASSIST_PROTOCOL });
  } catch {
    return response.status(502).json({ error: 'Online Assist could not reach the configured service.' });
  }
}
