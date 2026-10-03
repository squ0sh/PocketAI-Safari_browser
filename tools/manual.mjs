import { Marked } from 'marked';
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
export function renderManual(source) {
  const parser = new Marked();
  const ids = new Map();
  parser.use({ renderer: {
    html: text => escape(text),
    heading(text, level, raw) {
      const base = raw.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
      const count = ids.get(base) || 0; ids.set(base, count + 1);
      return `<h${level} id="guide-${base}${count ? '-' + count : ''}" tabindex="-1">${text}</h${level}>`;
    },
    link(href, title, text) {
      if (href?.startsWith('#')) return `<a href="#guide-${escape(href.slice(1))}">${text}</a>`;
      if (!/^https:\/\//i.test(href || '')) return text;
      return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    image(href, title, text) { return escape(text); },
  } });
  return parser.parse(source);
}
export function manualPlugin() {
  const id = '\0virtual:user-manual';
  return {
    name: 'pocket-user-manual',
    resolveId(source) { if (source === 'virtual:user-manual') return id; },
    async load(source) {
      if (source !== id) return;
      const { readFile } = await import('node:fs/promises');
      const path = new URL('../USER-MANUAL-README.md', import.meta.url);
      this.addWatchFile(path.pathname);
      return `export default ${JSON.stringify(renderManual(await readFile(path, 'utf8')))};`;
    },
  };
}
