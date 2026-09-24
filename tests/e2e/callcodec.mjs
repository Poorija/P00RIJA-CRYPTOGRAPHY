/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* What the call asks Opus for, and what it leaves alone.
 *
 * The SDP transform runs on both the offer and the answer of every call, on
 * whatever an engine happened to write, and a session description is not a
 * thing that reports its own mistakes: a malformed fmtp line does not raise,
 * it negotiates something other than what was meant, and the call simply
 * sounds worse than it should. So the cases that matter are the shapes engines
 * actually produce -- a line already carrying parameters, a payload type with
 * no fmtp line at all -- and the rule that nothing already stated is
 * overwritten, because the engine that wrote it knows its own encoder.
 *
 * The transform is a pure function over a string, so it is taken from the
 * source and exercised directly rather than through a browser.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'chat', '31-file-transfer-3.js'), 'utf8');

/* Lifts one top-level function out of the bundle by matching its braces. */
function extract(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`${name} is not in the source any more`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (!depth) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

/* The transform reads the codec order the device probe settled on. Supplying
   it here rather than letting it fall back means the ordering under test is
   the one being asserted, not whatever the fallback happens to be. */
function transformWith(videoCodecOrder) {
  const scope = {};
  // eslint-disable-next-line no-new-func
  new Function('scope', 'chatState', `${extract('tuneOpus')}\n${extract('preferCallCodecs')}\n`
    + 'scope.preferCallCodecs = preferCallCodecs;')(scope, { videoCodecOrder });
  return scope.preferCallCodecs;
}

/* What a device with no hardware AV1 gets, which is nearly all of them. */
const preferCallCodecs = transformWith(['VP9', 'H264', 'VP8']);

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

const fmtp = (sdp, payloadType) => (preferCallCodecs(sdp).split('\r\n')
  .find((line) => line.startsWith(`a=fmtp:${payloadType} `)) || '');

console.log('\nCall codec negotiation');

/* Chrome writes minptime and its own useinbandfec; both must survive. */
const chromeLike = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111 63 9\r\n'
  + 'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 minptime=10;useinbandfec=1\r\na=rtpmap:9 G722/8000\r\n';
const chromeOut = fmtp(chromeLike, 111);
ok(chromeOut.includes('minptime=10'), 'a parameter the engine set is kept');
ok(chromeOut.includes('useinbandfec=1'), 'in-band FEC is asked for');
ok(chromeOut.includes('maxaveragebitrate=128000'), 'the bitrate ceiling is stated in the SDP too');

/* No fmtp line at all: one has to be written, and in the right place. */
const bare = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\na=rtcp-fb:111 transport-cc\r\n';
const bareLines = preferCallCodecs(bare).split('\r\n');
const bareFmtp = bareLines.findIndex((line) => line.startsWith('a=fmtp:111 '));
const bareRtpmap = bareLines.findIndex((line) => line.startsWith('a=rtpmap:111 '));
ok(bareFmtp === bareRtpmap + 1, 'a missing fmtp line is written directly after its rtpmap');
ok(bareLines[bareFmtp].includes('useinbandfec=1'), 'and carries what was asked for');

/* A value the engine already chose is not second-guessed. */
const opinionated = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'
  + 'a=rtpmap:111 opus/48000/2\r\na=fmtp:111 useinbandfec=0;maxaveragebitrate=24000\r\n';
const opinionatedOut = fmtp(opinionated, 111);
ok(opinionatedOut.includes('useinbandfec=0') && !opinionatedOut.includes('useinbandfec=1'),
  'an engine that turned FEC off keeps it off');
ok(opinionatedOut.includes('maxaveragebitrate=24000'),
  'and keeps its own ceiling');

/* Video is another codec's business. */
const video = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 98\r\n'
  + 'a=rtpmap:96 VP8/90000\r\na=rtpmap:98 H264/90000\r\na=fmtp:98 profile-level-id=42e01f\r\n';
ok(fmtp(video, 98) === 'a=fmtp:98 profile-level-id=42e01f', 'a video section is left as it was');
ok(preferCallCodecs(video).includes('m=video 9 UDP/TLS/RTP/SAVPF 98 96'),
  'though its codec order still moves H264 in front');

/* The order is the device's, not a literal. Both shapes have to work. */
const videoOffer = 'v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96 98 100 102\r\n'
  + 'a=rtpmap:96 VP8/90000\r\na=rtpmap:98 H264/90000\r\n'
  + 'a=rtpmap:100 VP9/90000\r\na=rtpmap:102 AV1/90000\r\n';
ok(preferCallCodecs(videoOffer).includes('m=video 9 UDP/TLS/RTP/SAVPF 100 98 96 102'),
  'without hardware AV1 the order is VP9, H264, VP8 — and AV1 is still offered, last');
ok(transformWith(['AV1', 'VP9', 'H264', 'VP8'])(videoOffer)
  .includes('m=video 9 UDP/TLS/RTP/SAVPF 102 100 98 96'),
  'with hardware AV1 it goes first');

/* Both sides of a call run this, and a renegotiation runs it again. */
ok(preferCallCodecs(preferCallCodecs(chromeLike)) === preferCallCodecs(chromeLike),
  'running it twice changes nothing the second time');
ok(preferCallCodecs(null) === null, 'something that is not a session description passes through');

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
