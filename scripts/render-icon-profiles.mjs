/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Renders assets/desktop-icons/*.svg to the PNGs the Rust side embeds.
 *
 * Replaces the ImageMagick loop in build-icon-profiles.sh: magick without the
 * librsvg delegate uses its internal SVG renderer, which silently drops every
 * gradient-filled shape — the committed PNGs were a rounded tile with a single
 * dot, and that is what the Dock/tray showed. WebKit (through the same
 * playwright the test suite uses) renders the SVGs properly.
 *
 *   node scripts/render-icon-profiles.mjs
 */
import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SVG_DIR = join(ROOT, 'assets', 'desktop-icons');
const OUT_DIR = join(ROOT, 'src-tauri', 'icons', 'profiles');

const svgs = readdirSync(SVG_DIR).filter((name) => name.endsWith('.svg'));
if (!svgs.length) {
  console.error('no SVGs found in assets/desktop-icons/');
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 512, height: 512 },
  deviceScaleFactor: 2, // 1024 physical pixels, downscaled by -resize below
});

for (const name of svgs) {
  const svg = readFileSync(join(SVG_DIR, name), 'utf8')
    .replace(/width="512" height="512"/, 'width="512" height="512" style="display:block;width:512px;height:512px"');
  await page.setContent(
    `<!doctype html><html><body style="margin:0;padding:0;background:transparent;">
       <div style="width:512px;height:512px;">${svg}</div>
     </body></html>`,
    { waitUntil: 'load' },
  );
  const png1024 = await page.screenshot({ omitBackground: true });
  /* Downsample 1024 → 512 physical pixels for a crisp, correctly-sized asset. */
  const image = await page.evaluate(async (base64) => {
    const response = await fetch(`data:image/png;base64,${base64}`);
    const bitmap = await createImageBitmap(await response.blob(), {
      resizeWidth: 512, resizeHeight: 512, resizeQuality: 'high',
    });
    const canvas = new OffscreenCanvas(512, 512);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, 512, 512);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
  }, png1024.toString('base64'));
  const out = join(OUT_DIR, name.replace(/\.svg$/, '.png'));
  writeFileSync(out, Buffer.from(image, 'base64'));
  console.log(`  ${name} -> ${out.replace(ROOT, '')} (${Math.round(image.length * 3 / 4 / 1024)} KiB, 512px)`);
}
await browser.close();
console.log(`Rendered ${svgs.length} icon profiles.`);
