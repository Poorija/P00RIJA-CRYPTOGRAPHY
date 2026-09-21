/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.

   Two different things share one module and must not be confused for each
   other: effects, which make a voice sound different, and disguise, which tries
   to make it harder to attribute. A pitch shift alone does the first and not
   the second - formants stay where they were and a speaker-identification
   system reads straight through it. These checks measure that difference
   rather than taking the labels on trust. */
import { chromium } from 'playwright';
import { settle } from './_settle.mjs';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => { results.push({ n, ok }); console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ ignoreHTTPSErrors: true })).newPage();
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'load' });
/* Not a fixed wait. The service worker reloads a fresh profile once per
   version, and any evaluate in flight when that lands dies with "Execution
   context was destroyed" — read as a crash, not a failure. Waiting for the
   page to hold still is the property actually wanted. */
await settle(page);

console.log('\n===== the module =====');
const shape = await page.evaluate(() => {
  if (!window.PoorijaVoice) return null;
  return {
    api: Object.keys(window.PoorijaVoice).sort(),
    modes: (window.PoorijaVoice.MODES || []).map((m) => ({ id: m.id, kind: m.kind })),
  };
});
console.log('  ' + JSON.stringify(shape));
check('the voice module is there', Boolean(shape), typeof shape);
check('it offers several ways to change a voice', (shape?.modes || []).length >= 4, `${shape?.modes?.length} mode(s)`);
check('and separates effects from disguise, rather than calling both protection',
  (shape?.modes || []).some((m) => m.kind === 'effect') && (shape?.modes || []).some((m) => m.kind === 'disguise'),
  JSON.stringify((shape?.modes || []).map((m) => `${m.id}:${m.kind}`)));

console.log('\n===== it actually changes the sound =====');
/* A synthetic vowel: a fundamental with two formant-like resonances, which is
   enough to tell a pitch shift from a formant shift by measuring where the
   energy ends up. */
const measured = await page.evaluate(async () => {
  if (!window.PoorijaVoice) return { missing: true };
  const rate = 16000;
  const seconds = 1;
  const ctx = new OfflineAudioContext(1, rate * seconds, rate);
  const buffer = ctx.createBuffer(1, rate * seconds, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const t = i / rate;
    data[i] = 0.4 * Math.sin(2 * Math.PI * 120 * t)
      + 0.25 * Math.sin(2 * Math.PI * 700 * t)
      + 0.2 * Math.sin(2 * Math.PI * 1800 * t);
  }
  /* Encode to WAV so the module gets the same kind of input a recorder gives. */
  const toWav = (buf) => {
    const ch = buf.getChannelData(0);
    const out = new ArrayBuffer(44 + ch.length * 2);
    const view = new DataView(out);
    const str = (at, s) => s.split('').forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
    str(0, 'RIFF'); view.setUint32(4, 36 + ch.length * 2, true); str(8, 'WAVEfmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, buf.sampleRate, true); view.setUint32(28, buf.sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, ch.length * 2, true);
    for (let i = 0; i < ch.length; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, ch[i])) * 0x7fff, true);
    return new Blob([out], { type: 'audio/wav' });
  };

  /* Where the energy sits, in coarse bands.
     Energy summed across each band, not sampled at one frequency in the middle
     of it: a single-bin probe reads zero unless a tone lands exactly on it, and
     the first version of this measured three frequencies the signal did not
     contain and reported silence. */
  const BANDS = [[80, 200], [200, 500], [500, 1000], [1000, 1500], [1500, 2400], [2400, 4000]];
  const spectrum = async (blob) => {
    const bytes = await blob.arrayBuffer();
    const ac = new OfflineAudioContext(1, 1, rate);
    const decoded = await ac.decodeAudioData(bytes);
    const src = decoded.getChannelData(0);
    const n = Math.min(src.length, rate);
    const bands = BANDS.map(([lo, hi]) => {
      let total = 0;
      for (let freq = lo; freq < hi; freq += 40) {
        let re = 0; let im = 0;
        for (let i = 0; i < n; i += 1) {
          const a = (2 * Math.PI * freq * i) / rate;
          re += src[i] * Math.cos(a); im += src[i] * Math.sin(a);
        }
        total += Math.sqrt(re * re + im * im) / n;
      }
      return total;
    });
    return { bands, seconds: decoded.duration };
  };

  const source = toWav(buffer);
  const before = await spectrum(source);
  const out = {};
  for (const mode of window.PoorijaVoice.MODES) {
    const processed = await window.PoorijaVoice.transform(source, mode.id);
    const after = await spectrum(processed.blob);
    out[mode.id] = {
      kind: mode.kind,
      changed: after.bands.some((v, i) => Math.abs(v - before.bands[i]) > before.bands[i] * 0.15 + 0.001),
      /* How far the centre of energy moved. A pitch-only effect leaves the
         upper resonances roughly where they were; a formant shift does not. */
      drift: after.bands.map((v, i) => (before.bands[i] ? v / before.bands[i] : 0)).map((v) => Number(v.toFixed(2))),
      seconds: Number(after.seconds.toFixed(2)),
      type: processed.blob.type,
    };
  }
  return { before: before.bands.map((v) => Number(v.toFixed(3))), out };
});
console.log('  before: ' + JSON.stringify(measured.before));
Object.entries(measured.out || {}).forEach(([id, r]) => console.log(`  ${id.padEnd(12)} ${r.kind.padEnd(9)} drift=${JSON.stringify(r.drift)} ${r.seconds}s`));
const outputs = Object.values(measured.out || {});
check('every mode changes the sound', outputs.length > 0 && outputs.every((r) => r.changed),
  JSON.stringify(Object.entries(measured.out || {}).filter(([, r]) => !r.changed).map(([id]) => id)));
check('and every one returns playable audio',
  outputs.length > 0 && outputs.every((r) => r.seconds > 0.2 && /audio\//.test(r.type)),
  JSON.stringify(Object.values(measured.out || {}).map((r) => r.seconds)));

console.log('\n===== disguise does more than sound different =====');
const disguise = Object.entries(measured.out || {}).filter(([, r]) => r.kind === 'disguise');
check('a disguise mode moves the upper resonances, not only the pitch',
  disguise.length > 0 && disguise.every(([, r]) => Math.abs(r.drift[3] - 1) > 0.2 || Math.abs(r.drift[4] - 1) > 0.2),
  JSON.stringify(disguise.map(([id, r]) => `${id}:${r.drift.slice(3).join('/')}`)));

console.log('\n===== and it says what it is =====');
const wording = await page.evaluate(() => (window.PoorijaVoice?.MODES || []).map((m) => ({
  id: m.id, kind: m.kind, fa: m.fa, en: m.en, note: Boolean(m.caveat),
})));
check('every mode is named in both languages', wording.length > 0 && wording.every((m) => m.fa && m.en), JSON.stringify(wording.map((m) => m.id)));
const disguiseModes = wording.filter((m) => m.kind === 'disguise');
check('and a disguise mode carries the limit of what it can promise',
  disguiseModes.length > 0 && disguiseModes.every((m) => m.note),
  JSON.stringify(wording.filter((m) => m.kind === 'disguise').map((m) => `${m.id}:${m.note}`)));

console.log('\n===== the section, and the button in a conversation =====');
const ui = await page.evaluate(async () => {
  window.switchTab?.('voice');
  await new Promise((r) => setTimeout(r, 900));
  const panel = document.getElementById('content-voice');
  const open = Boolean(panel) && !panel.classList.contains('hidden');
  const modes = [...document.querySelectorAll('[data-voice-mode]')];
  /* Selecting a disguise must bring its caveat on screen; selecting an effect
     must not, or the sentence stops meaning anything. */
  /* Re-query between clicks: selecting a mode rebuilds the list, so a reference
     taken beforehand is a node that is no longer in the document, and clicking
     it does nothing at all. */
  const pick = (kind) => document.querySelector(`[data-voice-mode].is-${kind}`);
  pick('disguise')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const afterDisguise = !document.getElementById('voiceCaveat')?.classList.contains('hidden');
  pick('effect')?.click();
  await new Promise((r) => setTimeout(r, 500));
  const afterEffect = !document.getElementById('voiceCaveat')?.classList.contains('hidden');
  return {
    open, modes: modes.length,
    hasRecord: Boolean(document.getElementById('voiceRecordBtn')),
    hasSave: Boolean(document.getElementById('voiceSaveBtn')),
    caveatOnDisguise: afterDisguise, caveatOnEffect: afterEffect,
    chatButton: Boolean(document.getElementById('chatVoiceDisguiseBtn')),
  };
});
console.log('  ' + JSON.stringify(ui));
check('the voice section opens', ui.open === true, String(ui.open));
check('it offers every mode, with a way to record and to save',
  ui.modes >= 5 && ui.hasRecord && ui.hasSave, JSON.stringify(ui));
check('choosing a disguise shows what it cannot promise', ui.caveatOnDisguise === true, String(ui.caveatOnDisguise));
check('choosing a mere effect does not pretend to promise it', ui.caveatOnEffect === false, String(ui.caveatOnEffect));
check('and a conversation has its own button for a changed voice', ui.chatButton === true, String(ui.chatButton));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
