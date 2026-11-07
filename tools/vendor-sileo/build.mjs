/* node tools/vendor-sileo/build.mjs (after `npm ci` in this folder)
 *
 * Writes vendor/sileo/sileo.bundle.min.js and the licences of everything in
 * it. The output is committed, like every other file in vendor/: the app runs
 * offline and from a native shell, so nothing is fetched at run time, and a
 * checkout serves the page without this folder's node_modules. */
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../vendor/sileo');
await mkdir(out, { recursive: true });

await build({
  entryPoints: [path.join(here, 'entry.mjs')],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020', 'safari15'],
  /* React's development build is several times the size and warns in the
     console; the page never wants it. */
  define: { 'process.env.NODE_ENV': '"production"' },
  legalComments: 'none',
  outfile: path.join(out, 'sileo.bundle.min.js'),
  logLevel: 'info',
});

/* One file naming every package inside the bundle with its licence text, so
   the MIT notices travel with the code they cover. */
const packages = ['sileo', 'react', 'react-dom', 'scheduler', 'motion', 'framer-motion', 'motion-dom', 'motion-utils'];
const sections = [];
for (const name of packages) {
  const dir = path.join(here, 'node_modules', name);
  const meta = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  let text = '';
  for (const file of ['LICENSE', 'LICENSE.md', 'license']) {
    try { text = await readFile(path.join(dir, file), 'utf8'); break; } catch { /* next */ }
  }
  sections.push(`## ${name} ${meta.version} (${meta.license})\n\n${text.trim() || `${meta.license} licence; no licence file shipped in the package.`}\n`);
}
await writeFile(path.join(out, 'LICENSES.md'),
  `# Licences of vendor/sileo/sileo.bundle.min.js\n\nBuilt by tools/vendor-sileo/build.mjs.\n\n${sections.join('\n')}`);
