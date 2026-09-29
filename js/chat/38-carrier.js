/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* ============================================================================
   Sending a message through a carrier that is working but watched.
   ============================================================================

   When the relays cannot be reached, the messengers that still work are the
   ones that are permitted to work — and they are permitted because they can
   be read. During the January 2026 shutdown that was the shape of it exactly:
   some domestic apps kept running and were under full inspection.

   Tunnelling through one of those is the wrong answer. They are allowed
   precisely because they are inspectable, so building a tunnel starts a
   detection race — and when a tunnel is detected it is attributed to the
   PERSON, not to whoever wrote the software. Snowflake lost that race to TLS
   fingerprinting in 2022; the user pays for it, not the project.

   Sending something the carrier cannot read is the right answer, and it is
   what this application was built to do on its first day: encrypt to somebody
   else's public key. The only new part is the wrapping. A base64 blob in a
   chat window does not hide that you are encrypting. A photograph does — and
   everybody sends photographs, so nothing about the traffic has to be hidden.
   There is no fingerprint to find, because the traffic really is that app's
   traffic.

   WHAT THIS FILE IS, AND WHAT IT IS NOT
   -------------------------------------
   The pieces already existed: the identity keys, and js/stego.js with a DCT
   codec written specifically to survive a messenger re-encoding a photo. What
   did not exist was a way to use them without knowing they were there. The
   tool version needed eight steps and three pieces of knowledge — encrypt
   somewhere else, copy the ciphertext, pick the right codec — and somebody
   doing this in the hour it matters has none of that to spare.

   So: a contact, a message, a photograph. The key comes from the contact, the
   codec is chosen here (always DCT — the other one dies the moment a
   messenger touches it), and what comes out is a photo to send.

   HONEST LIMITS, which the UI repeats rather than hides:
     - the carrier still learns that you sent a photograph to that person. The
       social graph is not hidden, only the contents.
     - a determined analyst with a statistical model can tell something was
       embedded. They cannot read it. The goal is an automated filter, not a
       forensics lab.
     - cropping or resizing destroys it. Re-encoding does not, which is the
       one that happens by itself.
   ============================================================================ */

/* Kept deliberately tight. A small photograph holds about 3 KB through the DCT
   codec, and the wrapped key alone is 384 bytes of that, so the wire format is
   length-prefixed binary rather than base64 inside JSON — the same shape the
   compact identity card uses, and for the same reason: a third of a tight
   budget is not spare. */
const CARRIER_VERSION = 1;
const CARRIER_FINGERPRINT_BYTES = 32;

function carrierPackFields(fields) {
  let total = 1;
  fields.forEach((field) => { total += 2 + field.length; });
  const out = new Uint8Array(total);
  out[0] = CARRIER_VERSION;
  let at = 1;
  for (const field of fields) {
    out[at] = (field.length >> 8) & 0xff;
    out[at + 1] = field.length & 0xff;
    out.set(field, at + 2);
    at += 2 + field.length;
  }
  return out;
}
function carrierUnpackFields(bytes) {
  if (!bytes || bytes.length < 1 || bytes[0] !== CARRIER_VERSION) return null;
  const fields = [];
  let at = 1;
  while (at + 2 <= bytes.length) {
    const length = (bytes[at] << 8) | bytes[at + 1];
    if (at + 2 + length > bytes.length) return null;
    fields.push(bytes.subarray(at + 2, at + 2 + length));
    at += 2 + length;
  }
  return fields.length >= 4 ? fields : null;
}

/* One-off keys, not a session.
 *
 * sealSessionKeyFor needs a session that has already been negotiated over a
 * relay, and the whole premise here is that there is no relay. So a fresh
 * AES key per photograph, wrapped to the contact's identity key — the same
 * construction an offline envelope uses, minus the session. openOfflineSeal
 * unwraps it unchanged, which is why the receiving half is three lines. */
async function sealForCarrier(peerRecord, plainBytes) {
  const publicKeyData = peerRecord?.publicKeyData || '';
  if (!publicKeyData) throw new Error('no key for that contact');
  /* A photograph is sealed to ONE key and there is no second chance at it.
   *
   * When a contact's key has changed, the pinned one is kept and the new one is
   * held as pendingKey until somebody confirms the safety number -- which is the
   * right thing for a message, because the message can be re-sent afterwards. It
   * is the wrong thing here: the photograph leaves through a messenger and comes
   * back opened by nobody, with an error on the far side saying it was sealed to
   * someone else and nothing on this side saying why. Refuse, and say what to do
   * about it. */
  if (peerRecord?.pendingKey && peerRecord.pendingKey !== publicKeyData) {
    throw new Error(t(
      'کلید این مخاطب عوض شده و هنوز تأیید نشده. اول شمارهٔ امنیت را با او بررسی کنید؛ تا آن موقع عکسی که بسازید باز نخواهد شد.',
      "This contact's key has changed and has not been confirmed. Check the safety number with them first — until then a photograph made here will not open.",
    ));
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = app().generateSecureRandomBytes(12);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plainBytes));
  const raw = await crypto.subtle.exportKey('raw', key);
  const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' },
    await importIdentityPublicKey(publicKeyData), raw);
  return { seal: new Uint8Array(wrapped), iv, cipher };
}

/** The bytes that go into a photograph. */
async function buildCarrierPayload(peerRecord, text) {
  const mine = chatState.identity?.fingerprint || '';
  if (!/^[a-f0-9]{64}$/i.test(mine)) throw new Error('this device has no identity yet');
  const { seal, iv, cipher } = await sealForCarrier(peerRecord, new TextEncoder().encode(String(text || '')));
  return carrierPackFields([hexToBytes(mine), seal, iv, cipher]);
}

/** And the other direction. Returns who it is from and what it said, or null
    when the bytes are not one of these at all — which is not the same thing as
    a photograph this device cannot open, and the caller must say which. */
async function openCarrierPayload(bytes) {
  const fields = carrierUnpackFields(bytes);
  if (!fields) return null;
  const [fingerprint, seal, iv, cipher] = fields;
  if (fingerprint.length !== CARRIER_FINGERPRINT_BYTES) return null;
  const key = await openOfflineSeal(app().arrayBufferToBase64(seal)).catch(() => null);
  if (!key) {
    /* Who it came from is in the clear part of the payload, so the message can
       name them. "Not sealed to this device" on its own is a dead end: it does
       not say whether the sender used an old key of yours, or whether this is
       simply somebody else's photograph. */
    const from = bytesToHex(fingerprint);
    const known = (chatState.peers || []).find((record) => record.fingerprint === from);
    throw new Error(t(
      known
        ? `این عکس برای این دستگاه مهر نشده. ${known.name || known.username || 'فرستنده'} احتمالاً کلید قدیمی شما را داشته — یک کارت تازه برایش بفرستید و دوباره بسازد.`
        : 'این عکس برای این دستگاه مهر نشده، و فرستنده‌اش در مخاطبان شما نیست.',
      known
        ? `This photograph was not sealed to this device. ${known.name || known.username || 'The sender'} probably had an old key of yours — send them a fresh card and ask them to make it again.`
        : 'This photograph was not sealed to this device, and its sender is not one of your contacts.',
    ));
  }
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  return { fromFingerprint: bytesToHex(fingerprint), text: new TextDecoder().decode(plain) };
}

/* How much of a message a given photograph can carry, in characters somebody
   can read off a label. Answered before they start typing rather than after
   they finish, because a limit discovered at the end is a message retyped. */
function carrierTextRoom(width, height) {
  const stego = window.PoorijaStego;
  if (!stego) return 0;
  const capacity = stego.capacityBytes(width, height, stego.ALGO_DCT);
  /* The wrapped key is the fixed cost and it dominates a small photograph:
     384 bytes for a 3072-bit identity key, plus the nonce, the sender's
     fingerprint and four length prefixes. */
  const overhead = 384 + 12 + CARRIER_FINGERPRINT_BYTES + 1 + 8 + stego.HEADER_BYTES + 16;
  return Math.max(0, capacity - overhead);
}

/* ---- the photograph ---------------------------------------------------- */

/* A file in, an ImageData out. Kept apart from the sealing so the sealing can
   be tested without a browser canvas. */
function carrierReadImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('that file could not be read'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('that file is not an image this device can open'));
      image.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0);
        resolve({
          imageData: context.getImageData(0, 0, canvas.width, canvas.height),
          width: canvas.width,
          height: canvas.height,
          wasJpeg: /jpe?g/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || ''),
        });
      };
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* JPEG at 0.92, not PNG.
 *
 * A PNG would keep the coefficients exactly, and would also be the one thing
 * that makes the photograph stand out: nobody sends a 9 MB PNG of a cat. The
 * DCT codec was written to survive exactly this re-encode, so the output is
 * the same kind of file the carrier would have produced anyway. The quality is
 * high enough that the codec's own verification — which hide() performs before
 * returning — is not the thing under strain here; the carrier's re-encode
 * afterwards is. */
const CARRIER_JPEG_QUALITY = 0.92;
function carrierToBlob(imageData) {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the photograph could not be written'))),
      'image/jpeg', CARRIER_JPEG_QUALITY);
  });
}

/** The whole outgoing half: a contact, a message, a photograph, one answer. */
async function makeCarrierPhoto(peerRecord, text, file) {
  const stego = window.PoorijaStego;
  if (!stego) throw new Error('the hiding code is not loaded');
  const { imageData, width, height } = await carrierReadImage(file);
  const room = carrierTextRoom(width, height);
  const payload = await buildCarrierPayload(peerRecord, text);
  if (payload.length > stego.capacityBytes(width, height, stego.ALGO_DCT)) {
    return { ok: false, reason: 'CAPACITY', room, needed: payload.length };
  }
  /* DCT always, never a choice offered. The other codec is destroyed the
     moment any messenger touches the photograph, which is the only situation
     this exists for — so offering it would be offering the failure. */
  const hidden = stego.hide(imageData, payload, { algo: stego.ALGO_DCT, isText: false });
  if (!hidden.ok) return { ok: false, reason: hidden.reason, room, verdict: hidden.verdict };
  return { ok: true, blob: await carrierToBlob(hidden.imageData), room, bytes: payload.length };
}

/** And the incoming half. The three answers are deliberately distinct: this is
    not one of ours, this is one of ours but not for us, and here is the
    message. A single "nothing" for all three is what the old code did. */
async function readCarrierPhoto(file) {
  const stego = window.PoorijaStego;
  if (!stego) throw new Error('the hiding code is not loaded');
  const { imageData, wasJpeg } = await carrierReadImage(file);
  const found = stego.extract(imageData, { algo: stego.ALGO_DCT, sourceType: wasJpeg ? 'jpeg' : '' });
  if (found.status !== 'ok') {
    return { ok: false, status: found.status, explain: stego.explain(found, state?.language === 'fa') };
  }
  let opened;
  try {
    opened = await openCarrierPayload(found.payload);
  } catch (error) {
    return { ok: false, status: 'not-for-you', message: error.message };
  }
  if (!opened) return { ok: false, status: 'foreign' };
  const peer = chatState.peers.find((record) => record.fingerprint === opened.fromFingerprint) || null;
  return { ok: true, ...opened, peer };
}

/* ---- the sheet --------------------------------------------------------- */

/* One screen, in the order somebody would actually do it: who it is for, what
   to say, which photograph, and a photo to send. Nothing here asks a question
   that has to be understood first — the codec is not a choice and the
   encryption is not a step. */
const carrierState = { file: null, room: 0, ready: null, opened: null };

function carrierSheet() { return document.getElementById('chatCarrierSheet'); }

function carrierVerdict(id, tone, text) {
  const box = document.getElementById(id);
  if (!box) return;
  box.className = `chat-carrier-verdict${tone ? ` is-${tone}` : ''}`;
  box.textContent = String(text || '');
  box.classList.toggle('hidden', !text);
}

/* The room a photograph has, and whether what is typed still fits. Shown
   while they type rather than when they press the button: a limit discovered
   at the end is a message retyped. */
function renderCarrierRoom() {
  const label = document.getElementById('chatCarrierRoom');
  const make = document.getElementById('chatCarrierMakeBtn');
  const text = document.getElementById('chatCarrierText')?.value || '';
  if (!label) return;
  if (!carrierState.file) {
    label.textContent = t('ابتدا یک عکس انتخاب کنید', 'Pick a photo first');
    label.classList.remove('is-over');
    if (make) make.disabled = true;
    return;
  }
  /* Bytes, not characters: one Persian letter is two bytes and one emoji is
     four, so counting characters would promise room that is not there. */
  const used = new TextEncoder().encode(text).length;
  const over = used > carrierState.room;
  label.classList.toggle('is-over', over);
  label.textContent = over
    ? t(`${used} از ${carrierState.room} بایت — این عکس جا ندارد. عکس بزرگ‌تری بردارید یا پیام را کوتاه کنید.`,
      `${used} of ${carrierState.room} bytes — this photo has no room. Use a larger photo or shorten the message.`)
    : t(`${used} از ${carrierState.room} بایت`, `${used} of ${carrierState.room} bytes`);
  if (make) make.disabled = over || !text.trim();
}

async function carrierPickImage(file) {
  if (!file) return;
  carrierVerdict('chatCarrierSendVerdict', '', '');
  try {
    const { width, height } = await carrierReadImage(file);
    carrierState.file = file;
    carrierState.room = carrierTextRoom(width, height);
    if (carrierState.room <= 0) {
      carrierState.file = null;
      carrierVerdict('chatCarrierSendVerdict', 'error', t(
        'این عکس برای حمل یک پیام رمزشده کوچک است. عکسی با ابعاد بزرگ‌تر بردارید.',
        'This photo is too small to carry an encrypted message. Use one with larger dimensions.'));
    }
  } catch (error) {
    carrierState.file = null;
    carrierVerdict('chatCarrierSendVerdict', 'error', error.message);
  }
  renderCarrierRoom();
}

async function carrierMake() {
  const peer = activeCarrierPeer();
  const text = document.getElementById('chatCarrierText')?.value || '';
  const make = document.getElementById('chatCarrierMakeBtn');
  if (!peer || !carrierState.file || !text.trim()) return;
  if (make) make.disabled = true;
  carrierVerdict('chatCarrierSendVerdict', '', t('در حال ساخت…', 'Working…'));
  try {
    const result = await makeCarrierPhoto(peer, text, carrierState.file);
    if (!result.ok) {
      carrierVerdict('chatCarrierSendVerdict', 'error', result.reason === 'CAPACITY'
        ? t(`این عکس جا ندارد: ${result.needed} بایت لازم است.`,
          `This photo has no room: ${result.needed} bytes are needed.`)
        : t('عکس ساخته شد ولی خواندنش از خودش شکست خورد؛ عکس دیگری بردارید.',
          'The photo was made but could not be read back; try another photo.'));
      return;
    }
    /* Handed over the way a photo is handed over on that platform: the share
       sheet where there is one, a download where there is not. */
    const name = `photo-${Date.now()}.jpg`;
    const file = new File([result.blob], name, { type: 'image/jpeg' });
    let shared = false;
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); shared = true; } catch (_error) { shared = false; }
    }
    if (!shared) {
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
    carrierVerdict('chatCarrierSendVerdict', 'ok', t(
      'عکس آماده است. همان‌طور که همیشه عکس می‌فرستید بفرستید.',
      'The photo is ready. Send it the way you always send photos.'));
  } catch (error) {
    carrierVerdict('chatCarrierSendVerdict', 'error', error.message);
  } finally {
    renderCarrierRoom();
  }
}

async function carrierRead(file) {
  if (!file) return;
  const output = document.getElementById('chatCarrierReadOutput');
  const keep = document.getElementById('chatCarrierKeepBtn');
  carrierState.opened = null;
  keep?.classList.add('hidden');
  if (output) output.value = '';
  carrierVerdict('chatCarrierReadVerdict', '', t('در حال خواندن…', 'Reading…'));
  try {
    const result = await readCarrierPhoto(file);
    if (!result.ok) {
      /* Three different answers, kept apart: not one of ours, one of ours but
         not for us, and one of ours that the carrier destroyed. A single
         "nothing" for all three is what the old code said. */
      if (result.status === 'not-for-you') {
        carrierVerdict('chatCarrierReadVerdict', 'error', t(
          'این عکس پیامی دارد، ولی برای این دستگاه مهر نشده است.',
          'This photo carries a message, but it was not sealed to this device.'));
      } else if (result.status === 'foreign') {
        carrierVerdict('chatCarrierReadVerdict', 'error', t(
          'این عکس پیامی از این برنامه ندارد.', 'This photo carries no message from this app.'));
      } else {
        carrierVerdict('chatCarrierReadVerdict', 'error',
          `${result.explain?.title || ''} ${result.explain?.detail || ''}`.trim());
      }
      return;
    }
    carrierState.opened = result;
    if (output) output.value = result.text;
    const who = result.peer?.name || result.peer?.username || '';
    carrierVerdict('chatCarrierReadVerdict', 'ok', who
      ? t(`از ${who}`, `From ${who}`)
      : t('فرستنده در دفترچهٔ مخاطبین نیست؛ پیام باز شد ولی نامش را نداریم.',
        'The sender is not in the address book; the message opened but there is no name for it.'));
    if (result.peer) keep?.classList.remove('hidden');
  } catch (error) {
    carrierVerdict('chatCarrierReadVerdict', 'error', error.message);
  }
}

/* Putting it where the rest of the conversation is, so a message that came the
   long way is not a message that lives in a text box. */
function carrierKeep() {
  const opened = carrierState.opened;
  if (!opened?.peer) return;
  const conversationId = getConversationKey(opened.peer);
  if (!conversationId) return;
  appendHistory(conversationId, {
    id: `carrier-${Date.now()}`,
    type: 'text',
    direction: 'in',
    body: opened.text,
    createdAt: new Date().toISOString(),
    /* Marked, because how a message arrived is part of what it is: this one
       was not delivered by a relay and has no delivery state to speak of. */
    viaCarrier: true,
  });
  renderPeers();
  renderMessages();
  closeCarrierSheet();
  notify(t('پیام به گفتگو اضافه شد.', 'The message was added to the conversation.'), 'success');
}

function activeCarrierPeer() {
  const active = getActiveConversation();
  return active && !active.type ? active : null;
}

function openCarrierSheet() {
  const peer = activeCarrierPeer();
  if (!peer) {
    notify(t('ابتدا یک گفتگوی یک‌به‌یک را باز کنید.', 'Open a one-to-one conversation first.'), 'warning');
    return;
  }
  if (!peer.publicKeyData) {
    notify(t('برای این مخاطب کلیدی نداریم، پس نمی‌توان چیزی برایش رمز کرد.',
      'There is no key for this contact, so nothing can be encrypted to them.'), 'warning');
    return;
  }
  carrierState.file = null;
  carrierState.room = 0;
  carrierState.opened = null;
  const name = document.getElementById('chatCarrierPeerName');
  if (name) name.textContent = peer.name || peer.username || peer.peerId;
  carrierVerdict('chatCarrierSendVerdict', '', '');
  carrierVerdict('chatCarrierReadVerdict', '', '');
  const text = document.getElementById('chatCarrierText');
  if (text) text.value = '';
  const output = document.getElementById('chatCarrierReadOutput');
  if (output) output.value = '';
  document.getElementById('chatCarrierKeepBtn')?.classList.add('hidden');
  carrierShowPane('send');
  renderCarrierRoom();
  carrierSheet()?.classList.remove('hidden');
}
function closeCarrierSheet() { carrierSheet()?.classList.add('hidden'); }

function carrierShowPane(which) {
  const sending = which === 'send';
  document.getElementById('chatCarrierSendPane')?.classList.toggle('hidden', !sending);
  document.getElementById('chatCarrierReadPane')?.classList.toggle('hidden', sending);
  document.getElementById('chatCarrierSendTab')?.classList.toggle('is-active', sending);
  document.getElementById('chatCarrierReadTab')?.classList.toggle('is-active', !sending);
}

document.getElementById('chatCarrierBtn')?.addEventListener('click', () => {
  document.getElementById('chatComposerActions')?.classList.add('hidden');
  openCarrierSheet();
});
document.getElementById('chatCarrierCloseBtn')?.addEventListener('click', closeCarrierSheet);
carrierSheet()?.addEventListener('click', (event) => {
  if (event.target === carrierSheet()) closeCarrierSheet();
});
document.getElementById('chatCarrierSendTab')?.addEventListener('click', () => carrierShowPane('send'));
document.getElementById('chatCarrierReadTab')?.addEventListener('click', () => carrierShowPane('read'));
document.getElementById('chatCarrierText')?.addEventListener('input', renderCarrierRoom);
document.getElementById('chatCarrierPickBtn')?.addEventListener('click', () => {
  document.getElementById('chatCarrierImageInput')?.click();
});
document.getElementById('chatCarrierImageInput')?.addEventListener('change', (event) => {
  carrierPickImage(event.target.files?.[0]).catch(console.error);
  event.target.value = '';
});
document.getElementById('chatCarrierMakeBtn')?.addEventListener('click', () => {
  carrierMake().catch(console.error);
});
document.getElementById('chatCarrierReadPickBtn')?.addEventListener('click', () => {
  document.getElementById('chatCarrierReadInput')?.click();
});
document.getElementById('chatCarrierReadInput')?.addEventListener('change', (event) => {
  carrierRead(event.target.files?.[0]).catch(console.error);
  event.target.value = '';
});
document.getElementById('chatCarrierKeepBtn')?.addEventListener('click', carrierKeep);
