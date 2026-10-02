import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePrompt, estimateTokens } from '../src/context.js';

test('page stays in the prompt and oversized source is disclosed', async () => {
  const chat = { source: { title: 'Reference', text: 'Fact. '.repeat(8000) }, messages: [{ role: 'user', content: 'What does it say?' }] };
  const result = await preparePrompt(chat);
  assert.equal(result.sourceTruncated, true);
  assert.match(result.messages[0].content, /Reference/);
  assert.equal(result.messages.at(-1).content, 'What does it say?');
  assert.ok(estimateTokens(result.messages) <= 2048 - 512 - 32);
  assert.equal(chat.source.text.length, 48000);
});
test('oversized newest request is rejected, never dropped', async () => {
  await assert.rejects(preparePrompt({ messages: [{ role: 'user', content: 'x'.repeat(15000) }] }), /too long/);
});
test('old turns are trimmed while newest request and system remain', async () => {
  const messages = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'word '.repeat(150) }));
  messages.push({ role: 'user', content: 'Latest question' });
  const result = await preparePrompt({ messages });
  assert.ok(result.droppedMessages > 0);
  assert.equal(result.messages[0].role, 'system');
  assert.equal(result.messages[1].role, 'user');
  assert.equal(result.messages.at(-1).content, 'Latest question');
  assert.ok(estimateTokens(result.messages) <= 1504);
});
test('larger model windows retain more reference text', async () => {
  const chat = { source: { title: 'Page', text: 'text '.repeat(2000) }, messages: [{ role: 'user', content: 'Summarize' }] };
  const small = await preparePrompt(chat, { context: 2048 });
  const large = await preparePrompt(chat, { context: 8192 });
  assert.equal(small.sourceTruncated, true);
  assert.equal(large.sourceTruncated, false);
});
test('runtime token counter controls the budget, including non-English text', async () => {
  const count = (messages) => messages.reduce((n, m) => n + m.content.length + 10, 0);
  const result = await preparePrompt({ source: { title: '文', text: '文'.repeat(4000) }, messages: [{ role: 'user', content: '説明' }] }, { count });
  assert.ok(count(result.messages) <= 1504);
  assert.equal(result.messages.at(-1).content, '説明');
  assert.equal(result.sourceTruncated, true);
});
