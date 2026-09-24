/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* That the quality ladder listens to the encoder, not only to the link.
 *
 * Every threshold it had described the CONNECTION: round trip, packet loss,
 * the bandwidth estimate. None of them moves when the device itself is the
 * bottleneck. A machine that cannot encode what it was asked for drops frames
 * while the round trip stays low, the loss stays zero and the estimate stays
 * high — so the ladder read a flawless link, held the demand, and the picture
 * stuttered at the setting that was supposed to be the best one. Worse, it
 * would step back UP on that reading, which is the opposite of what an
 * adaptive ladder is for.
 *
 * getStats says so plainly: qualityLimitationReason is 'cpu' when the encoder
 * is what gave way. This drives the real function with readings that describe
 * each case and checks which rung it lands on, because the rule is about what
 * it DOES, not how it is written.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(ROOT, 'js', 'chat', '31-file-transfer-3.js'), 'utf8');

function extract(name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`${name} is gone`);
  let parens = 0;
  let cursor = source.indexOf('(', start);
  for (; cursor < source.length; cursor += 1) {
    if (source[cursor] === '(') parens += 1;
    else if (source[cursor] === ')') { parens -= 1; if (!parens) break; }
  }
  let depth = 0;
  for (let i = source.indexOf('{', cursor); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error(`${name} is not closed`);
}

let failures = 0;
let checks = 0;
function ok(condition, label) {
  checks += 1;
  console.log(`  ${condition ? 'ok   ' : 'FAIL '} ${label}`);
  if (!condition) failures += 1;
}

/* One video sender and the parameters it was handed, so the rung can be read
   back off the bitrate the ladder actually applied. */
function harness() {
  const applied = [];
  const encoding = {};
  const sender = {
    track: { kind: 'video', readyState: 'live', id: 'cam', contentHint: '' },
    getParameters: () => ({ encodings: [encoding] }),
    setParameters: async (params) => { applied.push({ ...params.encodings[0] }); },
  };
  const pc = { getSenders: () => [sender], signalingState: 'stable' };
  return { pc, applied };
}

/* The ladder reads two things about the device from chatState: what the
   capability probe said it can encode, and what the last call settled at.
   Supplying them is how the starting point gets tested at all. */
function ladderWith({ videoPixelCeiling = 0, callPixelStep = 0 } = {}) {
  const chatState = { videoPixelCeiling, prefs: { callPixelStep } };
  const made = new WeakMap();
  const fn = new Function('callAdaptationState', 'chatState', 'saveChatPrefs',
    `return ${extract('adaptCallSenders')}`)(made, chatState, () => {});
  return { ladder: fn, states: made, chatState };
}
const { ladder, states } = ladderWith();

/* The rung, read from the state the ladder keeps rather than inferred from
   the bitrate it applied.
   Inferring was wrong twice: the measured estimate caps the rung's ceiling,
   so a healthy link asking for the top rung applies 75% of its estimate and
   not the rung's own number — and the numbers themselves move whenever the
   ladder is retuned. The rung is what the assertions are about; the bitrate
   is a consequence of it and of the link. */
const rungOf = (pc) => states.get(pc)?.level;

const healthy = { rtt: 40, outboundLoss: 0, availableOutgoingBitrate: 8000000, mine: { rtt: 40 } };

console.log('\nCall quality ladder');

/* A good link with nothing wrong stays at the top and pins the camera. */
{
  const { pc, applied } = harness();
  await ladder(pc, { ...healthy, limitedByCpu: false });
  const last = applied[applied.length - 1];
  ok(rungOf(pc) === 2, 'a healthy link sits on the top rung');
  ok(last.maxFramerate === 30 && last.scaleResolutionDownBy === undefined,
    'and asks for 30fps while leaving the resolution free — the knob the encoder needs when the picture moves');
  ok(last.networkPriority === 'high', 'and asks the stack to put the picture first');
}

/* The reported bug, and the correction that followed it.
 *
 * Fewer bits do nothing for an encoder that cannot keep up: it still has to
 * get through every pixel of every frame. So a CPU limit moves the PIXEL
 * budget and leaves the bit budget to the link -- and the earlier version,
 * which dropped the rung instead, threw away bandwidth the link was offering
 * and then climbed back into the same wall. */
{
  const { pc, applied } = harness();
  await ladder(pc, { ...healthy, limitedByCpu: true });
  const last = applied[applied.length - 1];
  ok(rungOf(pc) === 2,
    'an encoder that cannot keep up leaves the bit budget alone — the link is flawless and still has its say');
  ok(last.scaleResolutionDownBy === 1.5,
    'and takes the pixels down a step instead, which is the cost an encoder actually pays');
  ok(last.maxBitrate >= 6000000,
    `and keeps the bitrate the link offered (${last.maxBitrate} bit/s) rather than discarding it`);
}

/* Each further sample it is still struggling takes another step, to a floor. */
{
  const { pc, applied } = harness();
  const seen = [];
  for (let i = 0; i < 5; i += 1) {
    await ladder(pc, { ...healthy, limitedByCpu: true });
    seen.push(applied[applied.length - 1].scaleResolutionDownBy);
  }
  ok(String(seen) === String([1.5, 2, 3, 3, 3]),
    `it steps down the pixel budget while the encoder keeps struggling, and stops at the floor (${seen.join(' → ')})`);
}

/* Coming back takes six clear samples, not three: a device that has just been
   overloaded is usually still warm, and asking early restarts the cycle. */
{
  const { pc, applied } = harness();
  await ladder(pc, { ...healthy, limitedByCpu: true });
  for (let i = 0; i < 5; i += 1) await ladder(pc, { ...healthy, limitedByCpu: false });
  const afterFive = applied[applied.length - 1].scaleResolutionDownBy;
  await ladder(pc, { ...healthy, limitedByCpu: false });
  const afterSix = applied[applied.length - 1].scaleResolutionDownBy;
  ok(afterFive === 1.5 && afterSix === undefined,
    'five clear samples are not enough to take the pixels back; the sixth is');
}

/* The link's own thresholds still work, and a bad link plus a struggling
   encoder cannot fall below the bottom rung.

   Not read through rungOf: on a link this poor the measured estimate is
   lower than the rung, and the estimate is meant to win -- 100 kbit/s of
   headroom gets 75, not the rung's 180. What is asserted is that it stopped
   at the bottom and stayed above the floor that keeps a call alive. */
{
  const { pc, applied } = harness();
  await ladder(pc, { rtt: 900, outboundLoss: 20, availableOutgoingBitrate: 100000, mine: { rtt: 900 }, limitedByCpu: true });
  const last = applied[applied.length - 1];
  ok(last.maxBitrate <= 1500000 && last.maxBitrate >= 64000,
    `a failing link lands at what the estimate allows (${last.maxBitrate} bit/s), floored rather than cut to nothing`);
  ok(last.maxFramerate === undefined,
    'and leaves the frame rate to the engine there too');
  ok(last.scaleResolutionDownBy === 1.5,
    'while the struggling encoder still gets its pixel step — the two budgets are independent');
}

/* Nothing to go on is not a reason to act. */
{
  const { pc, applied } = harness();
  await ladder(pc, { rtt: null, outboundLoss: null, availableOutgoingBitrate: null, mine: {}, limitedByCpu: false });
  ok(applied.length === 0, 'a reading that says nothing changes nothing');
}

/* ---- starting from what is known, rather than from the ceiling -------- */

/* A device the probe says cannot manage 1080p should not open by asking for
   it. One step below what it reported, so there is somewhere to climb. */
{
  const { ladder: l, states: st } = ladderWith({ videoPixelCeiling: 2 });
  const { pc, applied } = harness();
  await l(pc, { ...healthy, limitedByCpu: false });
  ok(st.get(pc).scale === 1,
    'a device that reported 540p as its limit starts at 720p — one step inside it, with room to climb');
  ok(applied[applied.length - 1].scaleResolutionDownBy === 1.5,
    'and that is what the encoder is actually handed');
}

/* Nothing known is not a reason to be timid: with no probe answer and nothing
   remembered it starts at full size and reacts, exactly as before. */
{
  const { ladder: l, states: st } = ladderWith();
  const { pc } = harness();
  await l(pc, { ...healthy, limitedByCpu: false });
  ok(st.get(pc).scale === 0,
    'with nothing known it still opens at full size and lets the ladder find out');
}

/* What the last call settled at counts too, and the more cautious of the two
   wins so neither source can make it over-ambitious. */
{
  const { ladder: l, states: st } = ladderWith({ videoPixelCeiling: 0, callPixelStep: 3 });
  const { pc } = harness();
  await l(pc, { ...healthy, limitedByCpu: false });
  ok(st.get(pc).scale === 2,
    'a remembered 360p starts the next call at 540p, even where the probe was optimistic');
}

/* And it writes down what held — once it has held, not the moment it is tried.
 *
 * A device that keeps reporting CPU pressure settles at a reduced step, and
 * that is the number worth keeping: the next call opens near it instead of
 * asking for full size and walking back down. */
{
  const { ladder: l, chatState, states: st } = ladderWith({ videoPixelCeiling: 0 });
  const { pc } = harness();
  /* Struggling, so it walks down and nothing is steady yet. */
  for (let i = 0; i < 3; i += 1) await l(pc, { ...healthy, limitedByCpu: true });
  const whileStruggling = chatState.prefs.callPixelStep;
  /* Then it holds. Eight clear samples is the stretch; the easing at six takes
     one step back first, which is the ladder deciding it has room again. */
  for (let i = 0; i < 8; i += 1) await l(pc, { ...healthy, limitedByCpu: false });
  ok(whileStruggling === 0,
    'nothing is remembered while the ladder is still moving');
  ok(chatState.prefs.callPixelStep === st.get(pc).scale,
    `and what gets remembered is where it actually settled (step ${st.get(pc).scale})`);
}

/* Starting cautious is not the same as staying there: a device given room
   climbs to full size and remembers THAT, so a phone is not held to a bad
   afternoon forever. */
{
  const { ladder: l, chatState, states: st } = ladderWith({ videoPixelCeiling: 2 });
  const { pc } = harness();
  const started = (await l(pc, { ...healthy, limitedByCpu: false }), st.get(pc).scale);
  for (let i = 0; i < 9; i += 1) await l(pc, { ...healthy, limitedByCpu: false });
  ok(started === 1 && st.get(pc).scale === 0 && chatState.prefs.callPixelStep === 0,
    'a cautious start climbs to full size when the room is there, and that is what is kept');
}

console.log(`\n${failures ? `${failures} of ${checks} checks failed` : `${checks} checks passed`}\n`);
process.exit(failures ? 1 : 0);
