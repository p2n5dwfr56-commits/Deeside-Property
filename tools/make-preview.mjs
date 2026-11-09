// Builds one self-contained HTML page (CSS and JS inlined) for the private claude.ai preview.
// Usage: VITE_PREVIEW=1 npx vite build --outDir dist-preview && node tools/make-preview.mjs dist-preview out.html
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, out] = process.argv.slice(2); const html = readFileSync(join(dir, 'index.html'), 'utf8');
const css = [...html.matchAll(/href="\.?\/?(assets\/[^"]+\.css)"/g)].map((m) => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
const js = [...html.matchAll(/src="\.?\/?(assets\/[^"]+\.js)"/g)].map((m) => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
if (js.includes('</script')) throw new Error('script contains </script');
writeFileSync(out, `<title>Deeside Property Watch</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<style>${css}\nbody::before{content:"";position:fixed;inset:0 0 auto;height:env(safe-area-inset-top,0px);z-index:10;background:var(--surface)}</style>\n<div id="root"></div>\n<script type="module">${js}</script>\n`);
console.log('wrote', out, Math.round((css.length + js.length) / 1024), 'KB');
