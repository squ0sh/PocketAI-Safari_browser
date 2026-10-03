import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderManual } from './manual.mjs';

test('manual navigation resolves to unique rendered headings', () => {
  const source = readFileSync(new URL('../USER-MANUAL-README.md', import.meta.url), 'utf8');
  const html = renderManual(source);
  const ids = [...html.matchAll(/id="(guide-[^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const match of html.matchAll(/href="#(guide-[^"]+)"/g)) assert.ok(ids.includes(match[1]), match[1]);
  assert.ok(ids.length >= 12);
});
test('manual rendering escapes raw HTML and rejects executable links and remote images', () => {
  const html = renderManual('<script>alert(1)</script>\n\n[x](javascript:alert%281%29)\n\n![image](https://example.com/x.png)\n\n[https](https://example.com)');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});
