/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the connection is told before it is asked to carry a call.
 *
 * Part of the P00RIJA end-to-end suite. See tests/e2e/README.md.
 *
 *   PORT=8123 npm run dev         # terminal 1
 *   PKG_URL=http://localhost:8123 node tests/e2e/calltuning.mjs
 *
 * peerOptions() passed iceServers and nothing else, so bundlePolicy,
 * rtcpMuxPolicy and iceCandidatePoolSize were left at whatever the engine
 * defaults to. On Chromium that happens to be what we want anyway; on WebKit —
 * macOS and iOS — it is balanced with a candidate pool of zero, so candidates
 * were gathered only once a call was already being placed.
 *
 * Tracks carried no contentHint either, so the encoder had to guess whether it
 * was looking at a face or at text. The guess is the difference between a call
 * that goes soft and one that stutters.
 *
 * Asserted against a real RTCPeerConnection's own getConfiguration(), not
 * against the object handed in: an engine that ignores a value reports what it
 * actually applied. */
import { chromium } from 'playwright';

const BASE_URL = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

console.log('\n===== the connection is configured, not defaulted =====');
const config = await page.evaluate(() => {
  if (typeof peerOptions !== 'function') return { missing: true };
  const declared = peerOptions().config;
  const pc = new RTCPeerConnection(declared);
  const applied = pc.getConfiguration();
  pc.close();
  return {
    declared: {
      bundlePolicy: declared.bundlePolicy,
      rtcpMuxPolicy: declared.rtcpMuxPolicy,
      pool: declared.iceCandidatePoolSize,
      hasIceServers: Array.isArray(declared.iceServers),
    },
    applied: {
      bundlePolicy: applied.bundlePolicy,
      rtcpMuxPolicy: applied.rtcpMuxPolicy,
      pool: applied.iceCandidatePoolSize,
    },
  };
});
check('peerOptions is reachable', !config.missing);
check('it still hands over the ICE servers', config.declared?.hasIceServers === true);
check('ONE TRANSPORT FOR THE WHOLE CALL — max-bundle',
  config.applied?.bundlePolicy === 'max-bundle', String(config.applied?.bundlePolicy));
check('RTP and RTCP share a port', config.applied?.rtcpMuxPolicy === 'require',
  String(config.applied?.rtcpMuxPolicy));
check('CANDIDATES ARE GATHERED BEFORE THE CALL IS PLACED',
  Number(config.applied?.pool) > 0,
  `iceCandidatePoolSize: ${config.applied?.pool} — zero means gathering starts when the phone is already ringing`);

console.log('\n===== the encoder is told what it is looking at =====');
const hints = await page.evaluate(() => {
  if (typeof hintTrackContent !== 'function') return { missing: true };
  /* A canvas track rather than a camera: contentHint is a plain
     MediaStreamTrack property, so this measures the same thing without needing
     a capture device the runner does not have. */
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  canvas.getContext('2d').fillRect(0, 0, 64, 64);
  const stream = canvas.captureStream(1);
  hintTrackContent(stream, 'camera');
  const camera = stream.getVideoTracks()[0]?.contentHint;
  hintTrackContent(stream, 'screen');
  const screen = stream.getVideoTracks()[0]?.contentHint;
  stream.getTracks().forEach((t) => t.stop());
  return { camera, screen, supported: 'contentHint' in MediaStreamTrack.prototype };
});
check('the engine takes content hints at all', hints.supported === true);
check('A CAMERA KEEPS MOVING RATHER THAN STAYING SHARP', hints.camera === 'motion',
  `contentHint: ${hints.camera}`);
check('a shared screen stays readable instead', hints.screen === 'detail',
  `contentHint: ${hints.screen}`);

/* Every call path has to go through it, or the one that does not is the one
   somebody uses. */
const coverage = await page.evaluate(() => {
  const sources = [
    typeof requestCallMedia === 'function' ? String(requestCallMedia) : '',
    typeof acquireGroupCallStream === 'function' ? String(acquireGroupCallStream) : '',
  ].join('\n');
  return { hinted: (sources.match(/hintTrackContent/g) || []).length, found: sources.length > 0 };
});
check('the call media paths all route through it', coverage.found && coverage.hinted >= 2,
  `${coverage.hinted} hinted acquisition(s)`);

await browser.close();
const bad = results.filter((ok) => !ok);
console.log(`\n===== ${bad.length} failed of ${results.length} =====`);
process.exit(bad.length ? 1 : 0);
