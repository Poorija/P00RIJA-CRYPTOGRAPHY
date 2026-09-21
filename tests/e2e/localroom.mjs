/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* A room of several people on the local network, with no server anywhere.
 *
 *   PORT=8123 npm run dev ; node tests/e2e/localroom.mjs
 *
 * local-link connects two devices through a QR code or a clipboard. This is
 * what that becomes: a room with a roster, a transcript, files with no size
 * limit, stickers, polls, and calls — none of it touching a relay.
 *
 * The claims worth testing are the ones that are easy to get wrong:
 *
 *   THE THIRD PERSON. Joining costs one pairing with the host, however many
 *   people are already there. The host brokers the introduction and then the
 *   two of them talk directly — so after C joins, C and B must have their own
 *   connection that the host is not in the middle of.
 *
 *   PER-LINK KEYS. Every pair derives its own. The host must not be able to
 *   read a message between two other members, which is what makes brokering
 *   safe rather than a relay with extra steps.
 *
 *   NO CEILING ON FILES, but an honest warning. A LAN transfer has no reason
 *   to inherit a relay's disk budget; it does have a reason to say that it is
 *   about to take the room's bandwidth.
 *
 *   THE CAP. Sixteen, refused politely rather than silently.
 *
 * Every browser context here is created WITHOUT network access to a relay
 * being needed, and the mesh is built with `iceServers: []`, so a connection
 * that somehow left the machine could not come back.
 */
import { chromium } from 'playwright';

const BASE = process.env.PKG_URL || 'http://localhost:8123';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});

/* The service worker reloads a fresh context once, shortly after load. Waiting
   a fixed time only works while the reload is faster than the guess; this
   waits for the globals to stand still for five seconds, which a reload cannot
   happen inside. */
async function open(label) {
  const page = await (await browser.newContext({
    ignoreHTTPSErrors: true,
    permissions: ['microphone', 'camera'],
  })).newPage();
  page.on('pageerror', (error) => console.log(`  [${label}] ${error.message.slice(0, 150)}`));
  await page.goto(`${BASE}/index.html`, { waitUntil: 'load' });
  const ready = () => page.evaluate(
    () => typeof window.PoorijaLocalMesh?.begin === 'function'
      && typeof window.PoorijaLocalRoom?.init === 'function'
      && typeof window.PoorijaLocalLink?.makeKeys === 'function'
  ).catch(() => false);
  const deadline = Date.now() + 90000;
  let stable = 0;
  while (Date.now() < deadline) {
    if (!(await ready())) stable = 0;
    else if (!stable) stable = Date.now();
    else if (Date.now() - stable > 5000) break;
    await page.waitForTimeout(250);
  }
  return page;
}

/* One pairing with the host, exactly as a person would do with a QR code. */
async function join(host, guest) {
  const offer = await host.evaluate(() => window.PoorijaLocalMesh.createOffer());
  const answer = await guest.evaluate((o) => window.PoorijaLocalMesh.acceptOffer(o), offer);
  if (!answer) return false;
  await host.evaluate((a) => window.PoorijaLocalMesh.acceptAnswer(a), answer);
  return true;
}

const roomOf = (page) => page.evaluate(() => {
  const kit = window.PoorijaLocalMesh;
  const state = kit.snapshot();
  return {
    count: state.count,
    open: state.members.filter((m) => m.state === 'open').length,
    capacity: state.capacity,
    full: state.full,
    messages: kit.room.messages.length,
    texts: kit.room.messages.filter((m) => m.kind === 'text').map((m) => m.text),
    files: kit.room.messages.filter((m) => m.kind === 'file').map((m) => ({ name: m.name, size: m.size })),
    stickers: kit.room.messages.filter((m) => m.kind === 'sticker').map((m) => m.emoji),
  };
});

let pages = [];
try {
  const [host, second, third] = pages = await Promise.all(
    ['host', 'second', 'third'].map((label) => open(label)));

  await host.evaluate(() => window.PoorijaLocalMesh.begin({ host: true }));

  /* ===== the room forms ================================================ */

  console.log('\n===== three people, two pairings =====');

  check('the second person joins', await join(host, second));
  await host.waitForTimeout(2500);
  check('the third person joins the HOST, not everybody', await join(host, third));
  await host.waitForTimeout(5000);

  const rooms = await Promise.all(pages.map(roomOf));
  rooms.forEach((r, i) => console.log(`  ${['host', 'second', 'third'][i]}: ${JSON.stringify({ count: r.count, open: r.open })}`));

  check('everyone agrees the room has three people',
    rooms.every((r) => r.count === 3), JSON.stringify(rooms.map((r) => r.count)));
  /* The point of the broker: two links each, so the second and third are
     talking directly rather than through the host. */
  check('and everyone holds a direct link to everyone else',
    rooms.every((r) => r.open === 2), JSON.stringify(rooms.map((r) => r.open)));

  /* ===== per-link keys ================================================== */

  console.log('\n===== what the host can and cannot read =====');

  const keys = await Promise.all(pages.map((page) => page.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return Array.from(kit.room.members.values()).map((m) => ({ id: m.id, hasKey: Boolean(m.key), safety: m.safety }));
  })));
  check('every link has a key of its own',
    keys.every((list) => list.length === 2 && list.every((k) => k.hasKey)),
    JSON.stringify(keys.map((l) => l.length)));

  /* A message from the second to the third is sealed with THEIR key. The host
     holds a different key for each of them, so it cannot open it — this is the
     property that makes brokering an introduction safe. */
  const hostCanRead = await host.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    const [a, b] = Array.from(kit.room.members.values());
    if (!a?.key || !b?.key) return 'no keys';
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, a.key,
      new TextEncoder().encode('between the other two'));
    try {
      await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, b.key, sealed);
      return 'OPENED IT';
    } catch (error) { return 'refused'; }
  });
  check('one member’s key cannot open another member’s traffic',
    hostCanRead === 'refused', hostCanRead);

  /* ===== messages ======================================================= */

  console.log('\n===== talking =====');

  await second.evaluate(() => window.PoorijaLocalMesh.sendText('from the second'));
  await host.waitForTimeout(1500);
  const afterText = await Promise.all(pages.map(roomOf));
  check('a message reaches everybody, once',
    afterText.every((r) => r.texts.filter((x) => x === 'from the second').length === 1),
    JSON.stringify(afterText.map((r) => r.texts.length)));

  await third.evaluate(() => window.PoorijaLocalMesh.sendSticker({ emoji: '🎉' }));
  await host.waitForTimeout(1200);
  const afterSticker = await Promise.all(pages.map(roomOf));
  check('so does a sticker',
    afterSticker.every((r) => r.stickers.includes('🎉')),
    JSON.stringify(afterSticker.map((r) => r.stickers)));

  /* ===== polls ========================================================== */

  console.log('\n===== a poll everybody can see =====');

  await host.evaluate(() => window.PoorijaLocalMesh.sendPoll('Tea or coffee?', ['Tea', 'Coffee']));
  await host.waitForTimeout(1500);
  const pollId = await third.evaluate(() => {
    const found = window.PoorijaLocalMesh.room.messages.find((m) => m.kind === 'rich');
    return found ? found.id : '';
  });
  check('the poll reaches the other side', Boolean(pollId), pollId || 'not received');

  if (pollId) {
    await third.evaluate((id) => window.PoorijaLocalMesh.vote(id, 1), pollId);
    await second.evaluate((id) => window.PoorijaLocalMesh.vote(id, 0), pollId);
    await host.waitForTimeout(1500);
    const tallies = await Promise.all(pages.map((page) => page.evaluate((id) => {
      const poll = window.PoorijaLocalMesh.room.polls.get(id);
      return poll ? Object.values(poll.votes).sort().join(',') : 'missing';
    }, pollId)));
    console.log(`  tallies: ${JSON.stringify(tallies)}`);
    check('and every device counts the same votes',
      new Set(tallies).size === 1 && tallies[0] !== 'missing', JSON.stringify(tallies));
  } else {
    check('and every device counts the same votes', false, 'no poll');
  }

  /* ===== files ========================================================== */

  console.log('\n===== a file, with no ceiling =====');

  const advice = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    const small = kit.describeFileCost({ size: 2 * 1024 * 1024, name: 's' });
    const large = kit.describeFileCost({ size: 400 * 1024 * 1024, name: 'l' });
    return { small, large: large ? { bytes: large.bytes, peers: large.peers, en: large.en } : null };
  });
  check('a small file is sent without comment', advice.small === null, String(advice.small));
  check('a large one warns about the room’s bandwidth rather than refusing',
    Boolean(advice.large) && /take most of the local network/.test(advice.large.en),
    advice.large ? advice.large.en.slice(0, 72) : 'no warning');

  const sent = await host.evaluate(async () => {
    const size = 3 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 37 + (i >> 9)) & 0xff;
    const file = new File([bytes], 'room.bin', { type: 'application/octet-stream' });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const started = performance.now();
    await window.PoorijaLocalMesh.sendFile(file);
    return {
      ms: Math.round(performance.now() - started),
      size,
      sha: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''),
    };
  });
  console.log(`  3 MB to two people in ${sent.ms} ms`);

  await Promise.all([second, third].map((page) => page.waitForFunction(
    () => window.PoorijaLocalMesh.room.messages.some((m) => m.kind === 'file' && m.url),
    null, { timeout: 60000 }).catch(() => {})));

  const received = await Promise.all([second, third].map((page) => page.evaluate(async () => {
    const found = window.PoorijaLocalMesh.room.messages.filter((m) => m.kind === 'file' && m.url).pop();
    if (!found) return null;
    const buffer = await (await fetch(found.url)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return {
      name: found.name,
      size: buffer.byteLength,
      sha: Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''),
    };
  })));
  check('the file reaches BOTH other people, byte-exact',
    received.every((r) => r && r.size === sent.size && r.sha === sent.sha),
    JSON.stringify(received.map((r) => (r ? `${r.size}b ${r.sha.slice(0, 10)}` : 'nothing'))));

  /* The sender watches a counter; the receiver used to watch nothing between
     "a file is coming" and the file arriving, which with no size limit is
     minutes of a line that does not move. */
  /* The listener goes on a RECEIVING device: the sender already knows how far
     along it is, because it is the one counting. */
  await third.evaluate(() => {
    window.__seen = [];
    window.PoorijaLocalMesh.on((event, detail) => {
      if (event === 'transfer') window.__seen.push(detail.received);
    });
  });
  await second.evaluate(() => window.PoorijaLocalMesh
    .sendFile(new File([new Uint8Array(3 * 1024 * 1024)], 'watch.bin')));
  await host.waitForTimeout(4000);
  const watched = await third.evaluate(() => ({
    updates: window.__seen.length,
    rising: window.__seen.length > 1 && window.__seen[window.__seen.length - 1] > window.__seen[0],
  }));
  console.log(`  ${JSON.stringify(watched)}`);
  check('and the receiving side is told how far along it is',
    watched.updates > 1 && watched.rising, JSON.stringify(watched));

  /* ===== calls ========================================================== */

  console.log('\n===== a call across the room =====');

  const advised = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return { audio: kit.callAdvice(false), video: kit.callAdvice(true) };
  });
  check('audio is never warned about', advised.audio === null, String(advised.audio));
  check('a small video call is not warned about either',
    advised.video === null, advised.video ? advised.video.en.slice(0, 50) : 'none');

  /* A room with nobody reachable in it is not a call, and starting one anyway
     used to leave room.call set and the microphone live while the room told the
     user the microphone was unavailable — the light on and the message saying
     the opposite. */
  const alone = await third.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    const saved = new Map(kit.room.members);
    kit.room.members.clear();
    const result = await kit.startCall({ video: false });
    const held = kit.room.call;
    saved.forEach((value, key) => kit.room.members.set(key, value));
    return { result, held };
  });
  check('a call with nobody to call does not hold the microphone open',
    alone.result === null && alone.held === null, JSON.stringify(alone));

  const started = await host.evaluate(async () => {
    try {
      await window.PoorijaLocalMesh.startCall({ video: false });
      return { ok: true, tracks: window.PoorijaLocalMesh.room.call.stream.getTracks().length };
    } catch (error) { return { ok: false, error: String(error).slice(0, 80) }; }
  });
  check('a call starts and captures audio', started.ok && started.tracks > 0, JSON.stringify(started));

  if (started.ok) {
    await host.waitForTimeout(6000);
    const heard = await Promise.all([second, third].map((page) => page.evaluate(() => {
      const kit = window.PoorijaLocalMesh;
      return Array.from(kit.room.members.values())
        .filter((m) => m.stream && m.stream.getAudioTracks().length > 0).length;
    })));
    console.log(`  members receiving audio: ${JSON.stringify(heard)}`);
    check('the other people receive the audio',
      heard.every((n) => n >= 1), JSON.stringify(heard));

    await host.evaluate(() => window.PoorijaLocalMesh.endCall());
    await host.waitForTimeout(1200);
    const ended = await host.evaluate(() => {
      const kit = window.PoorijaLocalMesh;
      return {
        call: kit.room.call,
        /* Hanging up used to remove our own senders and stop there, so this
           device kept every incoming stream and the roster kept their cameras
           lit after the call was over. */
        holding: Array.from(kit.room.members.values()).filter((m) => m.stream).length,
        lit: kit.snapshot().members.filter((m) => m.video || m.audio).length,
      };
    });
    check('and ending it releases the microphone', ended.call === null, JSON.stringify(ended));
    check('and lets go of everybody else’s media too',
      ended.holding === 0 && ended.lit === 0, JSON.stringify(ended));
  } else {
    check('the other people receive the audio', false, 'call never started');
    check('and ending it releases the microphone', false, 'call never started');
    check('and lets go of everybody else’s media too', false, 'call never started');
  }

  /* Video is added to connections that are already carrying data, which means
     renegotiating an open link rather than building a new one — the step most
     likely to break, and invisible in an audio-only test. */
  const video = await second.evaluate(async () => {
    try {
      await window.PoorijaLocalMesh.startCall({ video: true });
      return window.PoorijaLocalMesh.room.call.stream.getVideoTracks().length;
    } catch (error) { return String(error).slice(0, 80); }
  });
  check('a video call starts from somebody who is not the host', video === 1, String(video));

  if (video === 1) {
    await host.waitForTimeout(8000);
    const seen = await Promise.all([host, third].map((page) => page.evaluate(() => {
      const kit = window.PoorijaLocalMesh;
      return Array.from(kit.room.members.values())
        .filter((m) => m.stream && m.stream.getVideoTracks().length > 0).length;
    })));
    console.log(`  members receiving video: ${JSON.stringify(seen)}`);
    check('the picture arrives on both other devices',
      seen.every((n) => n >= 1), JSON.stringify(seen));
    await second.evaluate(() => window.PoorijaLocalMesh.endCall());
    await host.waitForTimeout(1500);
  } else {
    check('the picture arrives on both other devices', false, 'video call never started');
  }

  /* ===== inviting somebody else ========================================== */

  console.log('\n===== a third pairing while two people are already talking =====');

  /* "Invite" reopens the pairing card, which starts a fresh link — and starting
     one resets local-link, whose first act was to close its own channel. That
     channel had been handed to the room, and closing a channel removes that
     member from it, so inviting a third person hung up on the second. */
  const held = await host.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    const before = kit.snapshot().count;
    await window.PoorijaLocalLink?.startAsHost?.();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return { before, after: kit.snapshot().count };
  });
  console.log(`  ${JSON.stringify(held)}`);
  check('starting another pairing does not hang up on the people already here',
    held.after >= held.before, JSON.stringify(held));

  /* ===== the cap ======================================================== */

  console.log('\n===== the sixteen-person ceiling =====');

  const cap = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    const before = kit.snapshot().count;
    /* Fill the roster to the cap without opening real connections: the ceiling
       is a rule about the room, and testing it with sixteen browsers would
       measure the harness instead. */
    for (let i = kit.room.members.size; i < kit.MAX_MEMBERS - 1; i += 1) {
      kit.room.members.set(`filler-${i}`, { id: `filler-${i}`, name: 'x', state: 'open', incoming: new Map() });
    }
    return { before, now: kit.snapshot().count, full: kit.snapshot().full, cap: kit.MAX_MEMBERS };
  });
  console.log(`  ${JSON.stringify(cap)}`);
  check('the room reports itself full at the cap',
    cap.full && cap.now === cap.cap, JSON.stringify(cap));

  /* A full mesh of cameras is n(n-1) encoders. Sixteen people is a warning,
     not a refusal — the room is on a LAN and it is their bandwidth to spend. */
  const crowded = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return { audio: kit.callAdvice(false), video: kit.callAdvice(true) };
  });
  check('a video call in a full room warns about the number of cameras',
    Boolean(crowded.video) && /camera/i.test(crowded.video.en),
    crowded.video ? crowded.video.en.slice(0, 70) : 'no warning');
  check('but audio in a full room still says nothing',
    crowded.audio === null, String(crowded.audio));

  const refused = await host.evaluate(async () => {
    const answer = await window.PoorijaLocalMesh.acceptOffer({
      v: 1, role: 'offer', room: 'one-too-many', name: 'late', key: '', sdp: '',
    });
    return answer === null;
  });
  check('and a seventeenth person is refused rather than half-joined', refused, String(refused));

  /* ===== what one member can do to everybody else ======================= */

  /* A room member is somebody you paired with by holding a phone up to a
     screen, which is a good reason to trust their intent and no reason at all
     to trust their bytes. These are the ceilings that keep one device — hostile
     or merely broken — from taking the others down with it. */

  console.log('\n===== ceilings =====');

  const limits = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return {
      transcript: kit.MAX_TRANSCRIPT,
      incoming: kit.MAX_INCOMING_PER_MEMBER,
      chunk: kit.CHUNK_BYTES,
      text: kit.MAX_TEXT,
    };
  });
  check('the transcript, the transfers and the chunks all have declared limits',
    limits.transcript > 0 && limits.incoming > 0 && limits.chunk > 0 && limits.text > 0,
    JSON.stringify(limits));

  /* The transcript is rebuilt whole on every arrival, so an unbounded one gets
     slower with each message until the room stops responding. */
  const flooded = await second.evaluate(async (cap) => {
    const kit = window.PoorijaLocalMesh;
    const before = kit.room.messages.length;
    for (let i = 0; i < cap + 120; i += 1) await kit.sendText(`flood ${i}`);
    return { before, after: kit.room.messages.length, cap };
  }, limits.transcript);
  console.log(`  ${JSON.stringify(flooded)}`);
  check('a flood of messages does not grow the transcript without end',
    flooded.after <= limits.transcript, JSON.stringify(flooded));
  check('and the newest messages are the ones kept',
    await second.evaluate((cap) => {
      const messages = window.PoorijaLocalMesh.room.messages;
      return messages[messages.length - 1]?.text === `flood ${cap + 119}`;
    }, limits.transcript));

  /* A data channel is not a file transfer, and a paste big enough to exceed
     one browser's message limit stops the channel rather than raising an
     error anyone sees. */
  const long = await second.evaluate(async (cap) => {
    const kit = window.PoorijaLocalMesh;
    const record = await kit.sendText('x'.repeat(cap * 3));
    return { cap, sent: record ? record.text.length : 0 };
  }, limits.text);
  check('a message far too long for one frame is trimmed, not sent whole',
    long.sent === long.cap, JSON.stringify(long));

  /* A sticker travels as a URL. Ours are local; anything else is a request to
     somebody's server made from inside a room whose whole point is that nothing
     leaves the network. */
  const sticker = await second.evaluate(async () => {
    const kit = window.PoorijaLocalMesh;
    const bad = await kit.sendSticker({ emoji: '🙂', url: 'http://example.invalid/track.png' });
    const good = await kit.sendSticker({ emoji: '🙂', url: 'data:image/png;base64,iVBORw0KGgo=' });
    return { bad: bad.url, good: good.url };
  });
  check('a sticker pointing off the network is stripped, a local one is kept',
    sticker.bad === '' && sticker.good.startsWith('data:image/'), JSON.stringify(sticker));

  /* A reaction tally is this device's own bookkeeping. Arriving pre-filled from
     the wire is never anything but somebody writing into it. */
  const tally = await second.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    const messages = kit.room.messages;
    return messages[messages.length - 1]?.reactions;
  });
  check('a message starts with an empty reaction tally',
    tally && Object.keys(tally).length === 0, JSON.stringify(tally));

  /* ===== leaving ======================================================== */

  console.log('\n===== leaving =====');

  await third.evaluate(() => window.PoorijaLocalMesh.leave());
  await host.waitForTimeout(2000);
  const afterLeave = await second.evaluate(() => window.PoorijaLocalMesh.snapshot().count);
  check('the room notices somebody left', afterLeave < 3, `${afterLeave} left in the room`);

  /* The polite case above is the easy one. Most departures on a real network
     are a lid closing or a phone walking out of range: no goodbye, just a
     channel that stops. Handled as a state change and nothing more, that left a
     member in the roster with its connection open, holding a camera track and a
     place among the sixteen — so a room nobody was in would refuse new people. */
  const beforeDrop = await host.evaluate(() => window.PoorijaLocalMesh.snapshot().count);
  await second.evaluate(() => {
    /* No leave(), no bye: the link simply dies, the way it does when a laptop
       is shut. */
    window.PoorijaLocalMesh.room.members.forEach((m) => { try { m.channel.close(); } catch (e) {} });
  });
  await host.waitForTimeout(3000);
  const afterDrop = await host.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return {
      count: kit.snapshot().count,
      connections: Array.from(kit.room.members.values())
        .filter((m) => m.pc && m.pc.connectionState !== 'closed').length,
    };
  });
  console.log(`  roster ${beforeDrop} then ${afterDrop.count}, `
    + `${afterDrop.connections} connection(s) still open`);
  check('a member who vanishes without a goodbye is dropped too',
    afterDrop.count < beforeDrop, JSON.stringify(afterDrop));
  check('and their connection is closed rather than left holding the camera',
    afterDrop.connections === 0, `${afterDrop.connections} still open`);

  const cleaned = await third.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    return { members: kit.room.members.size, messages: kit.room.messages.length, active: kit.room.active };
  });
  check('and the person who left keeps nothing',
    cleaned.members === 0 && cleaned.messages === 0 && cleaned.active === false,
    JSON.stringify(cleaned));

  /* The next room is a different room. Pairing again used to open on the last
     conversation still on screen — nothing had gone anywhere, the transcript
     never leaves the device, but a tool that promises a room leaves nothing
     behind should not be the thing holding the previous one. */
  const reopened = await second.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    kit.leave();
    kit.begin({ host: true });
    return { messages: kit.room.messages.length, polls: kit.room.polls.size, call: kit.room.call };
  });
  check('starting a fresh room does not inherit the last one',
    reopened.messages === 0 && reopened.polls === 0 && reopened.call === null,
    JSON.stringify(reopened));

  /* Nor its name. A guest holds whatever the host told them, and carrying that
     forward would put the last room's name on somebody else's. */
  const renamed = await second.evaluate(() => {
    const kit = window.PoorijaLocalMesh;
    kit.room.name = 'somewhere else';
    kit.room.face = '🎪';
    kit.leave();
    kit.begin({ host: false });
    const state = kit.snapshot();
    return { name: state.name, face: state.face };
  });
  check('and does not inherit its name either',
    !renamed.name && !renamed.face, JSON.stringify(renamed));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('failed:');
  failed.forEach((r) => console.log(`  - ${r.name}`));
  process.exit(1);
}
