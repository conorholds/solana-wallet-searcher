import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const check = process.argv.includes('--check');
const result = await build({
  entryPoints: ['javascript/vendor-entry.js'], bundle: true, minify: true,
  platform: 'browser', target: ['es2022'], format: 'iife',
  outfile: 'assets/vendor.js', write: false, legalComments: 'linked',
  define: { 'process.env.NODE_ENV': '"production"' },
});
await mkdir('assets', { recursive: true });
for (const file of result.outputFiles) {
  if (check) {
    const existing = await readFile(file.path).catch(() => null);
    if (!existing || !existing.equals(Buffer.from(file.contents))) throw new Error('Browser dependencies are stale. Run npm run build.');
  } else await writeFile(file.path, file.contents);
}
let html = await readFile('index.html', 'utf8');
const sources = ['assets/vendor.js', 'javascript/theme.js', 'javascript/network.js', 'javascript/rpc.js', 'javascript/token.js', 'javascript/nft.js', 'javascript/main.js', 'css/style.css'];
for (const source of sources) {
  const data = await readFile(source);
  const hash = createHash('sha256').update(data).digest('hex').slice(0, 12);
  const pattern = new RegExp(`((?:src|href)="${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:\\?[^"\\s]*)?"`, 'g');
  html = html.replace(pattern, `$1?v=${hash}"`);
}
if (check) {
  if (html !== await readFile('index.html', 'utf8')) throw new Error('Asset versions are stale. Run npm run build.');
} else await writeFile('index.html', html);
console.log(check ? 'Local browser assets and content hashes are current.' : 'Built local browser assets and updated content hashes.');
