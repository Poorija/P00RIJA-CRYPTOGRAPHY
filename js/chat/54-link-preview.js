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
   Link previews, made by the sender.
   ============================================================================

   Off until the person turns it on, and only in the desktop app, whose shell
   can fetch a page (src-tauri/src/link_preview.rs: public addresses only,
   pinned against rebinding, capped, through the proxy when one is set). A
   browser cannot fetch somebody else's page without a server in the middle,
   and a server that fetched links for people would learn every link they
   share — so the web build offers no previews rather than that.

   The person typing a link is the one who sees the preview first, above the
   composer, and can drop it. What is sent is the title, a line of text and
   a small picture, re-drawn here at 320 px, inside the encrypted message.
   The recipient's device never contacts the site: it draws the card from
   those fields, and only an http(s) link the person taps leaves the app.

   A message request (49-message-requests.js) gets no card at all until it
   is accepted, so a stranger cannot put a picture of their choosing on
   screen this way either.
   ============================================================================ */

const LINK_PREVIEW_DEBOUNCE_MS = 700;
const LINK_PREVIEW_THUMB_PX = 320;
const LINK_PREVIEW_IMAGE_MAX_CHARS = 48000;
const LINK_IN_TEXT = /\bhttps?:\/\/[^\s<>"']+/i;

function linkPreviewsAvailable() {
  return Boolean(window.PoorijaDesktop?.available) && !window.__POORIJA_NATIVE_MOBILE__;
}
/* Not behind a proxy: a page's name cannot be checked there without a DNS
   question outside the proxy (see link_preview.rs). */
function linkPreviewsEnabled() {
  return linkPreviewsAvailable() && chatState.prefs?.linkPreviews === true && !chatState.nativeProxyActive;
}

function firstLinkIn(text) {
  const match = String(text || '').match(LINK_IN_TEXT);
  if (!match) return '';
  return match[0].replace(/[.,;:!?؟،)]+$/, '');
}

/* Everything that arrives in a preview is somebody else's text: only an
   http(s) link, bounded strings and a raster data: picture survive. */
function sanitizeLinkPreview(value) {
  if (!value || typeof value !== 'object') return null;
  let url = '';
  try {
    const parsed = new URL(String(value.url || ''));
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.href.slice(0, 2048);
  } catch (_error) { url = ''; }
  if (!url) return null;
  const text = (input, max) => String(input || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  const image = String(value.image || '');
  const clean = {
    url,
    title: text(value.title, 200),
    description: text(value.description, 300),
    siteName: text(value.siteName, 80),
    image: /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length <= LINK_PREVIEW_IMAGE_MAX_CHARS + 64 ? image : '',
  };
  return clean.title || clean.description ? clean : null;
}

/* The page's picture, re-drawn small: a few kilobytes inside the message
   instead of whatever the site served, and in a format the receiver's
   sanitiser accepts. */
async function thumbnailForPreview(base64, mime) {
  if (!base64 || !/^image\/(png|jpeg|webp|gif)$/.test(mime || '')) return '';
  try {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
    for (const [side, quality] of [[LINK_PREVIEW_THUMB_PX, 0.72], [240, 0.6], [160, 0.5]]) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/webp', quality);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/jpeg', quality);
      if (data.length <= LINK_PREVIEW_IMAGE_MAX_CHARS) { bitmap.close?.(); return data; }
    }
    bitmap.close?.();
  } catch (_error) { /* no picture, then */ }
  return '';
}

/* ---- composing ------------------------------------------------------------ */

let previewTimer = null;
let previewRequestSeq = 0;
const dismissedPreviewLinks = new Set();

function renderComposerPreviewChip() {
  let chip = document.getElementById('chatLinkPreviewChip');
  const preview = chatState.composerLinkPreview;
  if (!preview) { chip?.remove(); return; }
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'chatLinkPreviewChip';
    chip.className = 'chat-link-preview-chip';
    const surface = document.querySelector('.chat-composer-surface');
    surface?.parentNode?.insertBefore(chip, surface);
    chip.addEventListener('click', (event) => {
      if (!event.target.closest('[data-link-preview-dismiss]')) return;
      if (chatState.composerLinkPreview) dismissedPreviewLinks.add(chatState.composerLinkPreview.source);
      chatState.composerLinkPreview = null;
      renderComposerPreviewChip();
    });
  }
  chip.innerHTML = `
    ${preview.image ? '<img alt="" draggable="false">' : '<i class="fas fa-link"></i>'}
    <div class="chat-link-preview-chip-text"><strong></strong><span></span></div>
    <button type="button" data-link-preview-dismiss aria-label="${app().escapeHTML(t('بدون پیش‌نمایش', 'Send without preview'))}"><i class="fas fa-xmark"></i></button>`;
  if (preview.image) chip.querySelector('img').src = preview.image;
  chip.querySelector('strong').textContent = preview.title || preview.siteName || new URL(preview.url).host;
  chip.querySelector('span').textContent = preview.description || new URL(preview.url).host;
}

async function refreshComposerPreview() {
  const box = document.getElementById('chatComposer');
  const link = firstLinkIn(box?.value || '');
  const current = chatState.composerLinkPreview;
  if (!linkPreviewsEnabled() || !link || dismissedPreviewLinks.has(link)) {
    if (current) { chatState.composerLinkPreview = null; renderComposerPreviewChip(); }
    return;
  }
  if (current?.source === link) return;
  const seq = ++previewRequestSeq;
  let fetched = null;
  try {
    fetched = await window.PoorijaDesktop.linkPreview(link);
  } catch (error) {
    console.warn('[Preview] no preview for that link:', error?.message || error);
  }
  if (seq !== previewRequestSeq) return;
  if (!fetched) { chatState.composerLinkPreview = null; renderComposerPreviewChip(); return; }
  const image = await thumbnailForPreview(fetched.imageData, fetched.imageMime);
  if (seq !== previewRequestSeq) return;
  const preview = sanitizeLinkPreview({ url: fetched.url, title: fetched.title, description: fetched.description, siteName: fetched.siteName, image });
  /* The receiver draws a card only for the host of a link it can see; a
     preview of another host would never be shown, so it is not sent. */
  let sameHost = false;
  try { sameHost = Boolean(preview) && new URL(preview.url).host === new URL(link).host; } catch (_error) { sameHost = false; }
  chatState.composerLinkPreview = preview && sameHost ? { ...preview, source: link } : null;
  renderComposerPreviewChip();
}

/* What goes with the message being sent: the preview, if its link is still
   in the text. Taken once — the next message starts without one. */
function takeComposerPreview(text) {
  const preview = chatState.composerLinkPreview;
  chatState.composerLinkPreview = null;
  renderComposerPreviewChip();
  if (!preview || !String(text || '').includes(preview.source)) return null;
  const { source: _source, ...rest } = preview;
  return sanitizeLinkPreview(rest);
}

/* ---- reading -------------------------------------------------------------- */

/* The card belongs to the link the reader can see in the message, or to
   nothing. A sender could otherwise put a bank's title and picture on a card
   leading somewhere else, under a message whose visible link says the bank:
   so the card is drawn only when its address is on the same host as a link
   in the text, it leads to that visible link, and the host is always shown —
   the site's own name only beside it. */
function linkPreviewCardHtml(entry) {
  const preview = sanitizeLinkPreview(entry?.preview);
  if (!preview) return '';
  let previewHost = '';
  try { previewHost = new URL(preview.url).host.toLowerCase(); } catch (_error) { return ''; }
  const visible = (String(entry?.text || '').match(/\bhttps?:\/\/[^\s<>"']+/gi) || [])
    .map((link) => link.replace(/[.,;:!?؟،)]+$/, ''))
    .find((link) => { try { return new URL(link).host.toLowerCase() === previewHost; } catch (_error) { return false; } });
  if (!visible) return '';
  const host = previewHost;
  const site = preview.siteName && preview.siteName.toLowerCase() !== host ? ` · ${preview.siteName}` : '';
  return `
<a class="chat-link-preview" href="${app().escapeHTML(visible)}" target="_blank" rel="noopener noreferrer nofollow">
${preview.image ? `<img src="${preview.image}" alt="" draggable="false" loading="lazy">` : ''}
<span class="chat-link-preview-body">
<span class="chat-link-preview-site" dir="ltr">${app().escapeHTML(host)}${app().escapeHTML(site)}</span>
${preview.title ? `<strong>${app().escapeHTML(preview.title)}</strong>` : ''}
${preview.description ? `<span class="chat-link-preview-desc">${app().escapeHTML(preview.description)}</span>` : ''}
</span>
</a>`;
}

/* ---- the switch ------------------------------------------------------------ */

function syncLinkPreviewToggle() {
  const row = document.getElementById('chatLinkPreviewsRow');
  const hint = document.getElementById('chatLinkPreviewsHint');
  const toggle = document.getElementById('chatLinkPreviews');
  const available = linkPreviewsAvailable();
  row?.classList.toggle('hidden', !available);
  hint?.classList.toggle('hidden', !available);
  if (toggle) {
    toggle.checked = linkPreviewsEnabled();
    toggle.disabled = Boolean(chatState.nativeProxyActive);
  }
  if (hint && available) {
    hint.textContent = chatState.nativeProxyActive
      ? t('با پراکسی، پیش‌نمایش لینک خاموش است: نام سایت را نمی‌شود بدون پرسیدن از DNS بیرون از پراکسی بررسی کرد، و همین چیزی است که پراکسی جلویش را می‌گیرد.',
        'With a proxy set, link previews are off: a site\'s name cannot be checked without asking DNS outside the proxy, which is what the proxy prevents.')
      : t('روشن: وقتی لینکی می‌نویسید، همین دستگاه صفحه را باز می‌کند و عنوان و تصویر کوچکش رمزنگاری‌شده همراه پیام می‌رود؛ دستگاه گیرنده هرگز به آن سایت وصل نمی‌شود. سایت می‌بیند که از آدرس شما باز شده. خاموش: هیچ صفحه‌ای باز نمی‌شود.',
        'On: when you type a link, this device opens the page and its title and a small picture travel encrypted with the message; the recipient\'s device never contacts the site. The site sees it opened from your address. Off: no page is opened.');
  }
}

document.getElementById('chatComposer')?.addEventListener('input', () => {
  if (!linkPreviewsEnabled()) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => { refreshComposerPreview().catch(() => {}); }, LINK_PREVIEW_DEBOUNCE_MS);
});
document.getElementById('chatLinkPreviews')?.addEventListener('change', (event) => {
  chatState.prefs = chatState.prefs || {};
  chatState.prefs.linkPreviews = Boolean(event.target.checked) && linkPreviewsAvailable();
  saveChatPrefs();
  if (!chatState.prefs.linkPreviews) { chatState.composerLinkPreview = null; renderComposerPreviewChip(); }
  syncLinkPreviewToggle();
});
window.addEventListener('poorija:unlock', () => window.setTimeout(syncLinkPreviewToggle, 500));
window.addEventListener('poorija:language-changed', () => window.setTimeout(syncLinkPreviewToggle, 50));
window.setTimeout(syncLinkPreviewToggle, 1500);

window.sanitizeLinkPreview = sanitizeLinkPreview;
window.takeComposerPreview = takeComposerPreview;
