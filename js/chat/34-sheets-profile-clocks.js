/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Part 34 of 36 of the Secure Chat module.
   Split out of the original single-file js/chat.js — see js/chat/README.md.
   These files share one global scope and are loaded in order; the numbering is
   that order and must not be changed.

   Full-screen sheets, the profile card, and the world clocks
*/

/* ============================================================================
   Full-screen sheets, the profile card, and the world clocks
   ----------------------------------------------------------------------------
   The card used to fold, and its controls hung off a dropdown that overlaid the
   conversation list. Two things went wrong with that. The card had nothing left
   worth folding once the fields moved out, and the dropdown — invisible but
   still hit-testable, because a child of a visibility:hidden box can be made
   visible again by any rule that sets visibility on buttons — sat on top of the
   first rows of the list. Tapping a conversation pressed the Save profile
   button underneath it, which is what the stray "profile saved" toast was.

   So: the card is fixed, and each of its doors opens a full-screen sheet that
   lives on <body>, above everything, with nothing left hovering over the list.
   ========================================================================== */
const CHAT_CLOCKS_KEY = 'poorija_chat_clocks';
let clockTimer = 0;
let fullSheetReturn = null;

/* Put a borrowed node back, tolerating a stale sibling reference. */
function restoreNode(node, parent, next) {
  if (!node || !parent) return;
  if (next && next.parentElement === parent) parent.insertBefore(node, next);
  else parent.appendChild(node);
}

function ensureFullSheet() {
  let sheet = document.getElementById('chatFullSheet');
  if (sheet) return sheet;
  sheet = document.createElement('section');
  sheet.id = 'chatFullSheet';
  sheet.className = 'chat-fullsheet hidden';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
<header class="chat-fullsheet-head">
  <button type="button" class="chat-fullsheet-back" data-fullsheet-close>
    <i class="fas fa-arrow-right"></i>
  </button>
  <h3 class="chat-fullsheet-title"></h3>
</header>
<div class="chat-fullsheet-body"></div>`;
  /* Inside #content-chat rather than on <body>: the settings panes it carries
     are styled by rules that require #mainApp/#content-chat as an ancestor, and
     a sheet on <body> stripped every one of them — a lock section that arrived
     as a bare checkbox and a bare select. #content-chat is position:static, so
     a fixed child of it is still laid out against the viewport; what clipped
     the old sheet was .chat-shell, which is position:fixed itself and so
     becomes the containing block for anything fixed inside it. */
  (document.getElementById('content-chat') || document.body).appendChild(sheet);
  sheet.querySelector('[data-fullsheet-close]').addEventListener('click', () => closeFullSheet());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !sheet.classList.contains('hidden')) closeFullSheet();
  });
  return sheet;
}

function openFullSheet({ title, build, onClose = null }) {
  if (!vaultLockState().unlocked) { syncVaultLockUi(); return; }
  const sheet = ensureFullSheet();
  closeFullSheet({ silent: true });
  sheet.querySelector('.chat-fullsheet-title').textContent = title || '';
  const body = sheet.querySelector('.chat-fullsheet-body');
  body.innerHTML = '';
  const borrowed = [];
  /* `adopt` is how a sheet takes a live control instead of drawing a copy of
     it: the node keeps its id and every listener already bound to it, and it
     goes back where it came from when the sheet closes. */
  const adopt = (node, into = body) => {
    if (!node) return null;
    borrowed.push({ node, parent: node.parentElement, next: node.nextSibling });
    into.appendChild(node);
    return node;
  };
  build(body, adopt);
  fullSheetReturn = { borrowed, onClose };
  sheet.classList.remove('hidden');
  document.body.classList.add('chat-fullsheet-open');
  window.requestAnimationFrame(() => sheet.classList.add('is-open'));
  return sheet;
}

function closeFullSheet({ silent = false } = {}) {
  const sheet = document.getElementById('chatFullSheet');
  if (!sheet) return;
  if (fullSheetReturn) {
    fullSheetReturn.borrowed.slice().reverse().forEach(({ node, parent, next }) => {
      if (!parent) return;
      /* The sibling recorded on the way in may have been moved by something
         else while the sheet was open — the settings panes travel between the
         rail and the desktop stage — and insertBefore throws on a node that is
         no longer a child. Appending is the right answer in that case. */
      restoreNode(node, parent, next);
    });
    const done = fullSheetReturn.onClose;
    fullSheetReturn = null;
    if (!silent && typeof done === 'function') done();
  }
  sheet.classList.remove('is-open');
  sheet.classList.add('hidden');
  sheet.querySelector('.chat-fullsheet-body').innerHTML = '';
  document.body.classList.remove('chat-fullsheet-open');
}

/* ---- your chat identity ------------------------------------------------- */
function openIdentitySheet() {
  const strip = document.getElementById('chatIdentityStrip');
  openFullSheet({
    title: t('هویت شما در چت', 'Your chat identity'),
    build: (body, adopt) => {
      const hero = document.createElement('div');
      hero.className = 'chat-identity-hero';
      const name = chatState.profile?.username || chatState.profile?.name || t('کاربر P00RIJA', 'P00RIJA user');
      const avatar = chatState.profile?.avatarData;
      hero.innerHTML = `
${avatar ? `<img class="chat-identity-hero-avatar" src="${app().escapeHTML(avatar)}" alt="">`
  : `<span class="chat-identity-hero-avatar">${app().escapeHTML(String(name).trim().charAt(0).toUpperCase() || 'P')}</span>`}
<strong class="chat-identity-hero-name">${app().escapeHTML(name)}</strong>
<span class="chat-identity-hero-note">${app().escapeHTML(t(
  'این کارت را با کسی به اشتراک بگذارید تا بتواند گفتگوی امن با شما باز کند.',
  'Share this card so someone can open a secure conversation with you.'))}</span>`;
      body.appendChild(hero);
      /* The two value cards are the live ones from the settings strip, so
         whatever refreshes the peer id and the key keeps refreshing them. */
      const fields = document.createElement('div');
      fields.className = 'chat-identity-fields';
      body.appendChild(fields);
      [...(strip?.querySelectorAll('.chat-settings-body > div') || [])].forEach((node) => adopt(node, fields));
      const actions = document.createElement('div');
      actions.className = 'chat-identity-actions';
      actions.innerHTML = `
<button type="button" class="chat-primary-btn" data-identity-copy>
  <i class="fas fa-copy"></i><span>${app().escapeHTML(t('کپی کامل هویت', 'Copy full identity'))}</span>
</button>
<button type="button" class="chat-soft-btn" data-identity-qr>
  <i class="fas fa-qrcode"></i><span>${app().escapeHTML(t('نمایش QR code', 'Show QR code'))}</span>
</button>
<button type="button" class="chat-soft-btn" data-identity-profile-export>
  <i class="fas fa-id-badge"></i><span>${app().escapeHTML(t('خروجی پروفایل همراه', 'Export portable profile'))}</span>
</button>
<button type="button" class="chat-soft-btn" data-identity-profile-import>
  <i class="fas fa-id-card-clip"></i><span>${app().escapeHTML(t('ایمپورت پروفایل همراه', 'Import portable profile'))}</span>
</button>`;
      body.appendChild(actions);
      actions.querySelector('[data-identity-copy]').addEventListener('click', () => copyChatFullIdentity());
      actions.querySelector('[data-identity-qr]').addEventListener('click', () => showChatIdentityQr());
      actions.querySelector('[data-identity-profile-export]').addEventListener('click', () => exportPortableProfileFile());
      actions.querySelector('[data-identity-profile-import]').addEventListener('click', () => document.getElementById('chatProfileImportInput')?.click());
    },
  });
}

/* ---- your profile settings ---------------------------------------------- */
function openProfileSettingsSheet() {
  openFullSheet({
    title: t('تنظیمات پروفایل چت', 'Chat profile settings'),
    build: (body, adopt) => {
      const avatarRow = document.createElement('div');
      avatarRow.className = 'chat-profile-sheet-avatar';
      body.appendChild(avatarRow);
      adopt(document.querySelector('#content-chat .chat-profile-avatar-stack'), avatarRow);

      const section = (labelFa, labelEn, hintFa, hintEn) => {
        const wrap = document.createElement('div');
        wrap.className = 'chat-profile-sheet-row';
        wrap.innerHTML = `<span class="chat-profile-sheet-label">${app().escapeHTML(t(labelFa, labelEn))}</span>`;
        const slot = document.createElement('div');
        slot.className = 'chat-profile-sheet-slot';
        wrap.appendChild(slot);
        const hint = document.createElement('small');
        hint.className = 'chat-profile-sheet-hint';
        hint.textContent = t(hintFa, hintEn);
        wrap.appendChild(hint);
        body.appendChild(wrap);
        return slot;
      };

      adopt(document.getElementById('chatProfileName'),
        section('نام نمایشی', 'Display name', 'نامی که مخاطبان شما می‌بینند.', 'The name your contacts see.'));
      adopt(document.getElementById('chatSaveProfileBtn'),
        section('ذخیرهٔ پروفایل', 'Save profile', 'نام و تصویر را روی این دستگاه ذخیره می‌کند.', 'Stores the name and picture on this device.'));

      const moodSlot = section('وضعیت شما', 'Your status',
        'در چند کلمه بنویسید چه می‌کنید؛ مخاطبان آن را کنار نام شما می‌بینند.',
        'A few words on what you are doing — contacts see it beside your name.');
      const moodBtn = document.createElement('button');
      moodBtn.type = 'button';
      moodBtn.className = 'chat-soft-btn';
      const paintMood = () => {
        const mood = String(chatState.profile?.mood || '').trim();
        moodBtn.innerHTML = `<i class="fas fa-circle-half-stroke"></i><span>${app().escapeHTML(mood || t('تعیین وضعیت', 'Set a status'))}</span>`;
      };
      paintMood();
      moodBtn.addEventListener('click', async () => { await editMood(); paintMood(); });
      moodSlot.appendChild(moodBtn);

      const petSlot = section('همدم پیکسلی', 'Pixel companion',
        'شخصیت متحرک زیر آواتار. خاموش که باشد، جایش دکمهٔ کپی سریع شناسهٔ چت می‌نشیند.',
        'The animated character under your avatar. With it off, that spot becomes a quick copy of your chat id.');
      const petBtn = document.createElement('button');
      petBtn.type = 'button';
      petBtn.className = 'chat-soft-btn';
      const paintPet = () => {
        const off = petsAreOff();
        petBtn.innerHTML = `<i class="fas ${off ? 'fa-toggle-off' : 'fa-toggle-on'}"></i><span>${app().escapeHTML(
          off ? t('روشن کردن همدم', 'Turn the companion on') : t('خاموش کردن همدم', 'Turn the companion off'))}</span>`;
      };
      paintPet();
      petBtn.addEventListener('click', () => { togglePets(); paintPet(); });
      petSlot.appendChild(petBtn);

      const clockSlot = section('ساعت‌های جهانی', 'World clocks',
        'ساعت محلی همیشه نمایش داده می‌شود؛ می‌توانید شهرهای دیگری هم اضافه کنید.',
        'Your local time is always shown; you can add other cities too.');
      const clockBtn = document.createElement('button');
      clockBtn.type = 'button';
      clockBtn.className = 'chat-soft-btn';
      clockBtn.innerHTML = `<i class="fas fa-globe"></i><span>${app().escapeHTML(t('مدیریت ساعت‌ها', 'Manage clocks'))}</span>`;
      clockBtn.addEventListener('click', () => openClockSheet());
      clockSlot.appendChild(clockBtn);

      adopt(document.getElementById('chatResetIdentityBtn'),
        section('بازنشانی کلید', 'Reset key',
          'کلید هویت تازه می‌سازد؛ مخاطبان باید دوباره شما را تأیید کنند.',
          'Builds a fresh identity key — contacts have to verify you again.'));
    },
    onClose: () => { renderStaticUi(); renderProfileSummary(); },
  });
}

/* ---- world clocks ------------------------------------------------------- */
/* Two, not four: the card is a strip, and a strip with five times on it is a
   departures board. */
const CHAT_MAX_CLOCKS = 2;

function loadClocks() {
  try {
    const raw = JSON.parse(localStorage.getItem(CHAT_CLOCKS_KEY) || '[]');
    if (Array.isArray(raw)) return raw.filter((clock) => clock && typeof clock.tz === 'string').slice(0, CHAT_MAX_CLOCKS);
  } catch (error) { void error; }
  return [];
}

function saveClocks(list) {
  chatState.clocks = list.slice(0, CHAT_MAX_CLOCKS);
  try { localStorage.setItem(CHAT_CLOCKS_KEY, JSON.stringify(chatState.clocks)); } catch (error) { void error; }
  renderProfileClocks();
}

function clockLabelFor(tz) {
  return String(tz || '').split('/').pop().replace(/_/g, ' ');
}

function formatZoneTime(tz) {
  try {
    return new Intl.DateTimeFormat(t('fa-IR', 'en-GB'),
      { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }).format(new Date());
  } catch (error) { void error; return '--:--'; }
}

/* Both calendars, always: the Persian one because the interface is Persian,
   the Gregorian one because everything outside it is. */
function formatDateIn(tz, calendar, { weekday = true } = {}) {
  try {
    const locale = calendar === 'persian' ? 'fa-IR-u-ca-persian' : t('fa-IR-u-ca-gregory', 'en-GB');
    return new Intl.DateTimeFormat(locale, {
      ...(weekday ? { weekday: 'short' } : {}),
      day: 'numeric', month: 'short', timeZone: tz || undefined,
    }).format(new Date());
  } catch (error) { void error; return ''; }
}

function formatLocalDate() {
  return formatDateIn(undefined, 'persian');
}

/* How far ahead or behind a zone runs, worked out by comparing the same
   instant rendered in both zones rather than by looking up any offset table —
   which keeps daylight saving correct for free. */
function zoneOffsetLabel(tz) {
  try {
    const now = new Date();
    const asUtc = (zone) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: zone || undefined, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now).reduce((acc, part) => {
        if (part.type !== 'literal') acc[part.type] = Number(part.value);
        return acc;
      }, {});
      return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    };
    const minutes = Math.round((asUtc(tz) - asUtc(undefined)) / 60000);
    if (!minutes) return t('هم‌زمان با شما', 'same as you');
    const sign = minutes > 0 ? '+' : '−';
    const abs = Math.abs(minutes);
    const hours = Math.floor(abs / 60);
    const rest = abs % 60;
    const value = rest ? `${hours}:${String(rest).padStart(2, '0')}` : `${hours}`;
    return `${sign}${toLocaleDigits(value)}`;
  } catch (error) { void error; return ''; }
}

/* Persian digits in a Persian interface; the formatter already does this for
   dates and times, but the offset is assembled by hand. */
function toLocaleDigits(value) {
  if (t('fa', 'en') !== 'fa') return value;
  return String(value).replace(/[0-9]/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
}


/* The clock strip: your own time and date at the top, then up to two other
   cities, each with how far ahead or behind it runs and what the date is
   there. Everything is text-align:start, so it reads right-aligned in Persian
   and left-aligned in English without a second rule. */
function renderProfileClocks() {
  const box = document.getElementById('chatProfileClocks');
  if (!box) return;
  if (!Array.isArray(chatState.clocks)) chatState.clocks = loadClocks();
  const esc = (value) => app().escapeHTML(String(value ?? ''));
  const localPersian = formatDateIn(undefined, 'persian');
  /* No weekday on the second date: it is the same day of the week as the first
     one, and saying "Tuesday" twice in one line reads like a stutter. */
  const localGregory = formatDateIn(undefined, 'gregory', { weekday: false });
  const rows = [`
<span class="chat-clock-line is-local">
  <strong class="chat-clock-time">${esc(formatZoneTime())}</strong>
  <small class="chat-clock-dates">${esc(localPersian)} · ${esc(localGregory)}</small>
</span>`];
  const zones = (chatState.clocks || []).slice(0, CHAT_MAX_CLOCKS).map((clock) => {
    /* The date is only worth showing when it is not today's — which is exactly
       when you would get it wrong. */
    const there = formatDateIn(clock.tz, 'persian');
    const differs = there && there !== localPersian;
    return `
<span class="chat-clock-box${differs ? ' has-date' : ''}">
  <b class="chat-clock-box-name">${esc(clock.label || clockLabelFor(clock.tz))}</b>
  <strong class="chat-clock-box-time">${esc(formatZoneTime(clock.tz))}</strong>
  ${differs ? `<small class="chat-clock-box-date">${esc(there)}</small>` : ''}
</span>`;
  });
  if (zones.length) rows.push(`<span class="chat-clock-boxes">${zones.join('')}</span>`);
  box.innerHTML = rows.join('');
  if (!clockTimer) {
    /* Twenty seconds, so the minute never sits visibly stale. */
    clockTimer = window.setInterval(renderProfileClocks, 20000);
  }
}

function knownTimeZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') return Intl.supportedValuesOf('timeZone');
  } catch (error) { void error; }
  return ['Asia/Tehran', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Istanbul',
    'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
    'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'America/Toronto', 'UTC'];
}

function openClockSheet() {
  openFullSheet({
    title: t('ساعت‌های جهانی', 'World clocks'),
    build: (body) => {
      const current = document.createElement('div');
      current.className = 'chat-clock-list';
      body.appendChild(current);
      const search = document.createElement('input');
      search.type = 'search';
      search.className = 'chat-clock-search';
      search.placeholder = t('جستجوی شهر یا منطقهٔ زمانی', 'Search a city or time zone');
      body.appendChild(search);
      const results = document.createElement('div');
      results.className = 'chat-clock-results';
      body.appendChild(results);

      const zones = knownTimeZones();
      const drawCurrent = () => {
        current.innerHTML = `
<div class="chat-clock-row is-local">
  <span class="chat-clock-row-name">${app().escapeHTML(t('ساعت محلی', 'Local time'))}</span>
  <span class="chat-clock-row-time">${app().escapeHTML(formatZoneTime())}</span>
</div>` + (chatState.clocks || []).map((clock) => `
<div class="chat-clock-row">
  <span class="chat-clock-row-name">${app().escapeHTML(clock.label || clockLabelFor(clock.tz))}<small>${app().escapeHTML(zoneOffsetLabel(clock.tz))}</small></span>
  <span class="chat-clock-row-time">${app().escapeHTML(formatZoneTime(clock.tz))}</span>
  <button type="button" class="chat-clock-remove" data-clock-remove="${app().escapeHTML(clock.tz)}" title="${app().escapeHTML(t('حذف', 'Remove'))}"><i class="fas fa-xmark"></i></button>
</div>`).join('');
        current.querySelectorAll('[data-clock-remove]').forEach((button) => {
          button.addEventListener('click', () => {
            saveClocks((chatState.clocks || []).filter((clock) => clock.tz !== button.dataset.clockRemove));
            drawCurrent();
          });
        });
      };

      const drawResults = () => {
        const query = search.value.trim().toLowerCase();
        if (!query) { results.innerHTML = ''; return; }
        const matches = zones.filter((tz) => tz.toLowerCase().includes(query)).slice(0, 40);
        results.innerHTML = matches.length
          ? matches.map((tz) => `
<button type="button" class="chat-clock-option" data-clock-add="${app().escapeHTML(tz)}">
  <span>${app().escapeHTML(clockLabelFor(tz))}</span>
  <small>${app().escapeHTML(tz)}</small>
  <strong>${app().escapeHTML(formatZoneTime(tz))}</strong>
</button>`).join('')
          : `<div class="chat-empty-state">${app().escapeHTML(t('چیزی پیدا نشد.', 'Nothing found.'))}</div>`;
        results.querySelectorAll('[data-clock-add]').forEach((button) => {
          button.addEventListener('click', () => {
            const tz = button.dataset.clockAdd;
            if ((chatState.clocks || []).some((clock) => clock.tz === tz)) return;
            if ((chatState.clocks || []).length >= CHAT_MAX_CLOCKS) {
              notify(t(`حداکثر ${CHAT_MAX_CLOCKS} ساعت می‌توانید اضافه کنید.`, `${CHAT_MAX_CLOCKS} clocks is the maximum.`), 'warning');
              return;
            }
            saveClocks([...(chatState.clocks || []), { tz, label: clockLabelFor(tz) }]);
            search.value = '';
            results.innerHTML = '';
            drawCurrent();
          });
        });
      };

      search.addEventListener('input', drawResults);
      drawCurrent();
    },
  });
}

/* ---- the card itself ---------------------------------------------------- */
function renderProfileSummary() {
  const nameEl = document.getElementById('chatProfileSummaryName');
  const statusEl = document.getElementById('chatProfileSummaryStatus');
  if (nameEl) {
    nameEl.textContent = chatState.profile?.username || chatState.profile?.name
      || t('کاربر P00RIJA', 'P00RIJA user');
  }
  if (statusEl) {
    const source = document.getElementById('chatConnectionStatus');
    const label = source?.textContent?.trim() || t('عدم اتصال', 'Disconnected');
    /* setConnectionState already decided which of the three states we are in,
       so the card reads that rather than sniffing the pill's classes. */
    statusEl.dataset.tone = chatState.connectionState || 'offline';
    statusEl.innerHTML = `<i class="chat-summary-dot"></i><span>${app().escapeHTML(label)}</span>`;
  }
  renderProfileClocks();
}

/* The conversation's actions, behind one gear.
   Same mechanics as the composer's + sheet — a class toggle, a tap outside to
   close, Escape to close — only anchored under the button instead of above
   it. Each row keeps its own id, so the code that enables, disables and hides
   these buttons per conversation is untouched. */
function bindThreadMenu() {
  const button = document.getElementById('chatThreadMenuBtn');
  const menu = document.getElementById('chatThreadMenu');
  if (!button || !menu || button.dataset.menuBound) return;
  button.dataset.menuBound = '1';

  const close = () => {
    if (menu.classList.contains('hidden')) return;
    menu.classList.add('is-closing');
    button.classList.remove('is-open');
    button.setAttribute('aria-expanded', 'false');
    window.setTimeout(() => {
      menu.classList.add('hidden');
      menu.classList.remove('is-closing');
    }, 150);
  };
  const open = () => {
    menu.classList.remove('hidden', 'is-closing');
    button.classList.add('is-open');
    button.setAttribute('aria-expanded', 'true');
  };

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (menu.classList.contains('hidden')) open(); else close();
  });
  /* Choosing an action closes the menu — except a disabled one, which did
     nothing and should not look like it did. */
  menu.addEventListener('click', (event) => {
    const row = event.target.closest('.chat-action-row');
    if (row && !row.disabled) close();
  });
  document.addEventListener('click', (event) => {
    if (menu.classList.contains('hidden')) return;
    if (event.target.closest('#chatThreadMenu, #chatThreadMenuBtn')) return;
    close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
}

/* ---- your status, in your own words ------------------------------------ */
const MOOD_PRESETS = [
  { fa: 'در دسترس', en: 'Available' },
  { fa: 'مشغول', en: 'Busy' },
  { fa: 'سر کار', en: 'At work' },
  { fa: 'در جلسه', en: 'In a meeting' },
  { fa: 'مزاحم نشوید', en: 'Do not disturb' },
  { fa: 'به‌زودی برمی‌گردم', en: 'Back shortly' },
];

function renderMoodChip() {
  const chip = document.getElementById('chatMoodChip');
  const label = document.getElementById('chatMoodChipText');
  if (!chip || !label) return;
  const mood = String(chatState.profile?.mood || '').trim();
  label.textContent = mood || t('وضعیت', 'Status');
  chip.classList.toggle('is-set', Boolean(mood));
  chip.title = mood || t('وضعیت شما', 'Your status');
}

async function editMood() {
  const current = String(chatState.profile?.mood || '');
  const presets = MOOD_PRESETS.map((preset) => t(preset.fa, preset.en)).join(' · ');
  const next = await PoorijaDialogs.prompt(
    t(`وضعیت خود را بنویسید. نمونه‌ها: ${presets}`, `Write your status. For example: ${presets}`),
    { defaultValue: current, placeholder: t('مثلاً: سر کار', 'e.g. At work') },
  );
  if (next === null) return;
  chatState.profile = { ...chatState.profile, mood: String(next).trim().slice(0, 40) };
  saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
  renderMoodChip();
  /* Contacts learn about it the same way they learn your name. */
  broadcastHello();
  notify(t('وضعیت شما به‌روزرسانی شد.', 'Your status is updated.'), 'success');
}

function bindProfileCard() {
  const gear = document.getElementById('chatProfileMenuBtn');
  if (gear && !gear.dataset.sheetBound) {
    gear.dataset.sheetBound = '1';
    gear.addEventListener('click', () => openProfileSettingsSheet());
  }
  const clocks = document.getElementById('chatProfileClocks');
  if (clocks && !clocks.dataset.sheetBound) {
    clocks.dataset.sheetBound = '1';
    clocks.addEventListener('click', () => openClockSheet());
  }
  const mood = document.getElementById('chatMoodChip');
  if (mood && !mood.dataset.sheetBound) {
    mood.dataset.sheetBound = '1';
    mood.addEventListener('click', () => editMood());
  }
  const pet = document.getElementById('chatPet');
  if (pet && !pet.dataset.sheetBound) {
    pet.dataset.sheetBound = '1';
    pet.addEventListener('click', () => cyclePet());
  }
  renderProfileSummary();
  renderMoodChip();
  renderPet();
}

/* ---- the pixel companion ------------------------------------------------
   Real frame animation, not a transform on a still: each character is drawn as
   two or three 12x12 frames and the frames are swapped on a steps() timeline,
   which is how sprite animation has always worked. Frames are written as rows
   of characters against a small palette — far easier to read and to edit than
   a list of rectangles — and turned into <rect>s at render time, merging each
   horizontal run so a frame costs a handful of nodes rather than 144.
   ----------------------------------------------------------------------- */
const CHAT_PET_KEY = 'poorija_chat_pet';

/* One frame: rows of palette keys, '.' for nothing. Runs of the same colour
   become a single rect. */
function petFrameSvg(rows, palette) {
  const parts = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const key = row[x];
      if (key === '.') { x += 1; continue; }
      let run = 1;
      while (x + run < row.length && row[x + run] === key) run += 1;
      parts.push(`<rect x="${x}" y="${y}" width="${run}" height="1" fill="${palette[key]}"/>`);
      x += run;
    }
  });
  return parts.join('');
}

const CHAT_PETS = [
  {
id: 'cat', fa: 'گربه', en: 'Cat',
    palette: { o: '#f4a261', d: '#e08c3f', k: '#20232b', p: '#e76f51', w: '#fff7ed' },
    /* sits still, squints, and flicks its tail from one side to the other */
    frames: [
      ['............',
       '.oo......oo.',
       '.oooo..oooo.',
       '.oooooooooo.',
       '.okkooookko.',
       '.ooopppoooo.',
       '..oooooooo..',
       '..oooooooo.d',
       '..oooooooo.d',
       '..oooooooo..',
       '..ww....ww..',
       '............'],
      ['............',
       '.oo......oo.',
       '.oooo..oooo.',
       '.oooooooooo.',
       '.ok.oooo.ko.',
       '.ooopppoooo.',
       '..oooooooo..',
       '..oooooooodd',
       '..oooooooo..',
       '..oooooooo..',
       '..ww....ww..',
       '............'],
      ['............',
       '.oo......oo.',
       '.oooo..oooo.',
       '.oooooooooo.',
       '.okkooookko.',
       '.ooopppoooo.',
       '..oooooooo..',
       'd.oooooooo..',
       'd.oooooooo..',
       '..oooooooo..',
       '..ww....ww..',
       '............'],
    ],
  },
  {
    id: 'duck', fa: 'اردک', en: 'Duck',
    palette: { y: '#fcd34d', g: '#fbbf24', k: '#1f2937', o: '#f97316', w: '#fff7ed' },
    /* waddles: the feet swap and the wing lifts */
    frames: [
      ['............',
       '....yyyy....',
       '...yyyyyy...',
       '..oykyyyy...',
       '..ooyyyyy...',
       '....yyyy....',
       '..yyyyyyyy..',
       '.yyyggyyyyy.',
       '.yyyyyyyyyy.',
       '..yyyyyyyy..',
       '...oo..oo...',
       '...o....o...'],
      ['............',
       '....yyyy....',
       '...yyyyyy...',
       '..oykyyyy...',
       '..ooyyyyy...',
       '....yyyy....',
       '..yyyyyyyy..',
       '.yyggyyyyyy.',
       '.yyyyyyyyyy.',
       '..yyyyyyyy..',
       '..oo....oo..',
       '..o......o..'],
    ],
  },
  {
    id: 'frog', fa: 'قورباغه', en: 'Frog',
    palette: { g: '#4ade80', d: '#22c55e', k: '#111827', m: '#166534', w: '#ffffff' },
    /* crouches, then hops clear of the ground */
    frames: [
      ['............',
       '............',
       '..gg....gg..',
       '.gwwg..gwwg.',
       '.gkkg..gkkg.',
       '..gggggggg..',
       '.gggggggggg.',
       '.gggmmmmggg.',
       '.gggggggggg.',
       'dd.gggggg.dd',
       'ddd......ddd',
       '............'],
      ['..gg....gg..',
       '.gwwg..gwwg.',
       '.gkkg..gkkg.',
       '..gggggggg..',
       '.gggggggggg.',
       '.gggmmmmggg.',
       '.gggggggggg.',
       'd..gggggg..d',
       'dd........dd',
       '............',
       '............',
       '............'],
    ],
  },
  {
    id: 'ghost', fa: 'روح', en: 'Ghost',
    palette: { w: '#e0e7ff', b: '#4338ca', s: '#a5b4fc' },
    /* floats, and its hem ripples */
    frames: [
      ['............',
       '...wwwwww...',
       '..wwwwwwww..',
       '.wwwwwwwwww.',
       '.wbbwwwwbbw.',
       '.wbbwwwwbbw.',
       '.wwwwwwwwww.',
       '.wwwssswwww.',
       '.wwwwwwwwww.',
       '.wwwwwwwwww.',
       '.w.ww.ww.ww.',
       '............'],
      ['............',
       '............',
       '...wwwwww...',
       '..wwwwwwww..',
       '.wwwwwwwwww.',
       '.wbbwwwwbbw.',
       '.wbbwwwwbbw.',
       '.wwwssswwww.',
       '.wwwwwwwwww.',
       '.wwwwwwwwww.',
       '.ww.ww.ww.w.',
       '............'],
    ],
  },
  {
    id: 'slime', fa: 'اسلایم', en: 'Slime',
    palette: { c: '#38bdf8', d: '#0ea5e9', k: '#0f172a', w: '#e0f2fe' },
    /* squash and stretch, the oldest trick in the book */
    frames: [
      ['............',
       '............',
       '....cccc....',
       '...cccccc...',
       '..cccccccc..',
       '..ckcccckc..',
       '.cccccccccc.',
       '.cccwwwwccc.',
       '.dddddddddd.',
       '............',
       '............',
       '............'],
      ['............',
       '............',
       '............',
       '...cccccc...',
       '..cccccccc..',
       '.ckcccccckc.',
       '.cccccccccc.',
       'cccccwwccccc',
       'cddddddddddc',
       'dd........dd',
       '............',
       '............'],
    ],
  },
  {
    id: 'crab', fa: 'خرچنگ', en: 'Crab',
    palette: { r: '#f87171', d: '#ef4444', k: '#111827', m: '#7f1d1d' },
    /* claws open and shut, legs scuttle */
    frames: [
      ['............',
       '.dd......dd.',
       'd..d....d..d',
       '.dd..rr..dd.',
       '..rrrrrrrr..',
       '.rkrrrrrrkr.',
       '.rrrrrrrrrr.',
       '.rrmmmmmmrr.',
       '..rrrrrrrr..',
       '.d.d....d.d.',
       'd...d..d...d',
       '............'],
      ['.dd......dd.',
       'd..d....d..d',
       '.ddd....ddd.',
       '.....rr.....',
       '..rrrrrrrr..',
       '.rkrrrrrrkr.',
       '.rrrrrrrrrr.',
       '.rrmmmmmmrr.',
       '..rrrrrrrr..',
       '..d.d..d.d..',
       '.d...dd...d.',
       '............'],
    ],
  },
  {
    id: 'robot', fa: 'ربات', en: 'Robot',
    palette: { s: '#cbd5e1', g: '#94a3b8', b: '#38bdf8', k: '#0f172a', y: '#facc15' },
    /* antenna blinks, arms rise */
    frames: [
      ['.....y......',
       '.....g......',
       '..ssssssss..',
       '..sbbssbbs..',
       '..ssssssss..',
       '..sskkkkss..',
       '..ssssssss..',
       'g.gggggggg.g',
       'g.gbbbbbbg.g',
       '..gggggggg..',
       '..gg....gg..',
       '..gg....gg..'],
      ['.....b......',
       '.....g......',
       '..ssssssss..',
       '..sbbssbbs..',
       '..ssssssss..',
       '..sskkkkss..',
       '..ssssssss..',
       '..gggggggg..',
       'g.gbbbbbbg.g',
       'g.gggggggg.g',
       '..gg....gg..',
       '..gg....gg..'],
    ],
  },
  {
    id: 'flower', fa: 'گل', en: 'Flower',
    palette: { p: '#f472b6', r: '#fb7185', y: '#fde047', g: '#22c55e', l: '#4ade80' },
    /* opens, closes, and leans in the breeze */
    frames: [
      ['............',
       '....pppp....',
       '...prrrrp...',
       '..prryyrrp..',
       '..prryyrrp..',
       '...prrrrp...',
       '....pppp....',
       '.....gg.....',
       '..ll.gg.....',
       '.....gg.ll..',
       '.....gg.....',
       '...gggggg...'],
      ['............',
       '.....pp.....',
       '....prrp....',
       '...prryyp...',
       '...pyyrrp...',
       '....prrp....',
       '.....pp.....',
       '.....gg.....',
       '...ll.gg....',
       '......gg.ll.',
       '......gg....',
       '....gggggg..'],
    ],
  },
];

/* 'off' is a real stop on the same carousel: tap past the last character and
   the companion goes away, and the slot becomes the quick copy for your chat
   identity — which is what most people want that corner for anyway. */
const PET_OFF = 'off';

function currentPetId() {
  let saved = '';
  try { saved = localStorage.getItem(CHAT_PET_KEY) || ''; } catch (error) { void error; }
  if (saved === PET_OFF) return PET_OFF;
  return CHAT_PETS.some((pet) => pet.id === saved) ? saved : CHAT_PETS[0].id;
}

function petsAreOff() {
  return currentPetId() === PET_OFF;
}

function setPet(id) {
  try { localStorage.setItem(CHAT_PET_KEY, id); } catch (error) { void error; }
  renderPet();
  const host = document.getElementById('chatPet');
  /* A little pop on the swap, so the tap visibly does something. */
  host?.classList.remove('is-swapping');
  void host?.offsetWidth;
  host?.classList.add('is-swapping');
}

function shortSelfId() {
  const value = String(chatState.peerId || chatState.profile?.stablePeerId || '');
  return value ? `…${value.slice(-6)}` : '—';
}

function renderPet() {
  const host = document.getElementById('chatPet');
  if (!host) return;
  if (petsAreOff()) {
    /* The identity chip, in the companion's place. */
    host.dataset.frames = '0';
    host.classList.add('is-identity');
    host.title = t('کپی شناسهٔ چت شما', 'Copy your chat id');
    host.setAttribute('aria-label', t('کپی شناسهٔ چت شما', 'Copy your chat id'));
    host.innerHTML = `
<span class="chat-pet-id">
  <i class="fas fa-hashtag" aria-hidden="true"></i>
  <b>${app().escapeHTML(shortSelfId())}</b>
  <small>${app().escapeHTML(t('کپی هویت', 'Copy id'))}</small>
</span>`;
    return;
  }
  const pet = CHAT_PETS.find((entry) => entry.id === currentPetId()) || CHAT_PETS[0];
  host.classList.remove('is-identity');
  host.dataset.frames = String(pet.frames.length);
  host.title = `${t(pet.fa, pet.en)} — ${t('برای بعدی بزنید', 'tap for the next')}`;
  host.setAttribute('aria-label', t(pet.fa, pet.en));
  host.innerHTML = `
<svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
  ${pet.frames.map((rows) => `<g class="pet-frame">${petFrameSvg(rows, pet.palette)}</g>`).join('')}
</svg>`;
}

/* Tapping the slot: another character, then off, then round again. While it is
   off the tap copies your id instead — turning the companion back on is done
   from the profile settings sheet, where the switch for it lives. */
function cyclePet() {
  if (petsAreOff()) {
    copySelfId();
    return;
  }
  const at = CHAT_PETS.findIndex((pet) => pet.id === currentPetId());
  const next = at + 1 >= CHAT_PETS.length ? PET_OFF : CHAT_PETS[at + 1].id;
  setPet(next);
  if (next === PET_OFF) {
    notify(t('همدم پیکسلی خاموش شد. از تنظیمات پروفایل دوباره روشنش کنید.',
      'The companion is off. Turn it back on from profile settings.'), 'info');
  }
}

function copySelfId() {
  const value = chatState.peerId || chatState.profile?.stablePeerId || '';
  if (!value) return;
  navigator.clipboard.writeText(value)
    .then(() => notify(t('شناسهٔ شما کپی شد.', 'Your id is copied.'), 'success'))
    .catch(() => notify(t('کپی ناموفق بود.', 'Copy failed.'), 'error'));
}

function togglePets() {
  setPet(petsAreOff() ? CHAT_PETS[0].id : PET_OFF);
}

const RAIL_CONDENSE_AT = 96;
const RAIL_EXPAND_AT = 24;
function bindRailCondense() {
  const rail = document.querySelector('#content-chat .chat-rail');
  if (!rail || rail.dataset.condenseBound) return;
  rail.dataset.condenseBound = '1';
  /* The rail no longer scrolls: it is a fixed chrome plus one scrolling panel,
     and which panel that is depends on the view. Watch all of them. */
  const scrollers = ['#chatPeerList', '#chatConnectionPanel', '#chatCallsPanel']
    .map((selector) => rail.querySelector(selector))
    .filter(Boolean);
  let ticking = false;
  const syncStickyOffsets = () => syncRailChrome();
  /* How tall the content was last time this ran. Closing a call run, or any
     other fold, removes content; the browser then clamps scrollTop, and a
     scroll position that fell because the page got shorter is indistinguishable
     from one the reader scrolled back to - unless the height is remembered.
     Without this, folding one contact's calls away un-condensed the header,
     the profile card sprang back to its full size, and the list it had just
     made room in became a strip two rows deep. */
  let lastScrollHeight = 0;

  const apply = () => {
    ticking = false;
    const top = Math.max(...scrollers.map((node) => node.scrollTop || 0), 0);
    const height = Math.max(...scrollers.map((node) => node.scrollHeight || 0), 0);
    const shrank = height < lastScrollHeight;
    lastScrollHeight = height;
    const condensed = rail.classList.contains('is-condensed');
    if (!condensed && top > RAIL_CONDENSE_AT) rail.classList.add('is-condensed');
    else if (condensed && top < RAIL_EXPAND_AT && !shrank) {
      rail.classList.remove('is-condensed');
      closeRailSearch();
    }
    syncStickyOffsets();
  };

  syncStickyOffsets();
  /* Re-measure when the header actually changes size rather than on a timer:
     the fold animates, so a single measurement taken at the start is wrong for
     most of it. */
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => syncStickyOffsets());
    /* The settings panel is in here too: switching to that view resizes it
       from nothing to its real height over a frame or two, and a single
       measurement taken on the first frame sees zero and skips the sizing —
       which left Settings as an uncroppable window over its own content. */
    ['.chat-profile-card', '.chat-nav-bar', '#chatConnectionPanel', '.chat-rail']
      .map((selector) => (selector === '.chat-rail' ? rail : rail.querySelector(selector)))
      .filter(Boolean)
      .forEach((node) => observer.observe(node));
  }
  scrollers.forEach((node) => node.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(apply);
  }, { passive: true }));
  /* Folding a call run is a content change, not a scroll, and the browser
     fires no scroll event for it - so the height baseline has to be refreshed
     here or the next real scroll would compare against a stale one. */
  rail.addEventListener('toggle', () => {
    lastScrollHeight = Math.max(...scrollers.map((node) => node.scrollHeight || 0), 0);
  }, true);
  /* Your own peer id and fingerprint are what you hand somebody to start a
     conversation, so they were needed constantly and lived four taps away
     inside Settings. This opens the same panel — the same element, the same
     ids, the same copy button — as a sheet over whichever view is showing. */
  /* Your own peer id and key are what you hand somebody to start a
     conversation. The card opens as a full-screen sheet rather than the
     accordion it used to be — an accordion inside a fixed card had nowhere to
     expand into. */
  document.getElementById('chatQuickIdentityBtn')?.addEventListener('click', () => openIdentitySheet());
    /* The round key button became the one-tap conversation lock; its handler and
     state sync live with the other lock wiring in part 35. */
}
/* The sheet has to leave the chat shell to be seen at all.
 *
 * position:fixed is viewport-relative only while no ancestor establishes a
 * containing block. .chat-shell is `position: fixed; overflow: hidden`, so the
 * panel was laid out inside it and then clipped away — measured as
 * offsetParent: null and a zero-area rect, which is why tapping the button
 * appeared to do nothing at all.
 *
 * So it is moved to <body> while open and put back exactly where it was on
 * close. Moving rather than cloning keeps every id, listener and the copy
 * button working, which is the whole reason for reusing this panel. */
/* The rail's own search bar is gone (search lives in the loupe popup, part
   08); the rail never carries the search-open state anymore, so these two
   are quiet no-ops kept only for the scroll-condense caller above. */
function toggleRailSearch() { /* retired with the rail search bar */ }
function closeRailSearch() { toggleRailSearch(false); }

/* Unread counts on the tab icons, the way a phone shows them.
   Counted through the same helpers the lists themselves use, so a badge can
   never disagree with the row it is summarising. */
function renderChatNavBadges() {
  const counts = { chats: 0, calls: 0, groups: 0 };
  chatState.peers.forEach((peer) => {
    if (!peer || isSelfPeerRecord(peer)) return;
    counts.chats += unreadConversationCount(getConversationKey(peer));
  });
  (chatState.spaces?.groups || []).forEach((space) => {
    counts.groups += unreadConversationCount(space.conversationId);
  });
  counts.calls = (chatState.calls || []).filter((call) => isMissedCallStatus(call?.status) && call?.unread !== false).length;
  document.querySelectorAll('#content-chat .chat-nav-bar .chat-nav-item').forEach((item) => {
    const view = item.getAttribute('data-chat-view');
    const total = counts[view] || 0;
    let badge = item.querySelector('.chat-nav-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'chat-nav-badge hidden';
      item.appendChild(badge);
    }
    /* Emptied, not just hidden: a hidden node still contributes its text to the
       parent's textContent, so every tab read "تنظیمات0" to anything asking
       what the button says — screen readers and tests alike. */
    badge.textContent = total > 0 ? (total > 99 ? '99+' : String(total)) : '';
    badge.classList.toggle('hidden', total <= 0);
  });
}

function setChatView(view) {
/* The chrome has to be re-measured for the view being shown: Settings needs an
   explicit body height and nothing scrolls when you switch to it, so the
   scroll handler would never fire. */
document.querySelector('#content-chat .chat-rail')?.setAttribute('data-view', view || 'chats');
window.requestAnimationFrame(() => syncRailChrome());
if (view === 'channels') view = 'groups';
chatState.activeView = view;
/* The heading button changes meaning with the list under it, and only the
   calls renderer used to say so - which left it offering "start a chat" above
   a list of groups. */
syncCallsHeading();
/* CSS needs to know which rail view is live: the chats list must stretch to the
   bottom of the rail, while the connection form has to keep the rail scrollable
   because it is taller than the viewport. */
const chatShellRoot = document.getElementById('content-chat');
if (chatShellRoot) chatShellRoot.dataset.chatActiveView = view;
/* The facing panel has to belong to the list beside it. Only calls and
   settings used to clear it, so switching between Chats and Groups left the
   previous thread sitting there - a person's conversation open next to a list
   of groups, and no way to tell which list it came from. A thread survives the
   switch only when it belongs to the view being opened. */
const activeBelongsToView = (() => {
  const key = chatState.activeConversationId;
  if (!key) return false;
  /* Ask the group list rather than the shape of the id: a thread is a group's
     when a group record claims it, whatever the id happens to look like. */
  const isGroup = [...chatState.spaces.groups, ...chatState.spaces.channels]
    .some((space) => space.conversationId === key);
  if (view === 'chats') return !isGroup;
  if (view === 'groups') return isGroup;
  return false;
})();
if (!activeBelongsToView) {
chatState.activePeerClientId = '';
chatState.activeConversationId = '';
/* Repaint, or the panel keeps the markup of the thread that just left. */
window.requestAnimationFrame(() => { renderActivePeer(); renderMessages(); });
}
/* Coming back to the chats list with a live search session reopens it with
   the same results — the person jumped into one hit and is usually halfway
   through a list of them. The ✕ in the popup is what actually ends the
   search; until then the results follow them back. */
if (view === 'chats' && typeof FSEARCH_STATE !== 'undefined'
&& FSEARCH_STATE.live && FSEARCH_STATE.hiddenByJump
&& !FSEARCH_STATE.jumpNavigating && FSEARCH_STATE.results.length) {
window.requestAnimationFrame(() => { try { openFullSearch(); } catch (_error) { /* part 08 not ready */ } });
}
updateChatShellMode();
document.querySelectorAll('[data-chat-view]').forEach((button) => {
button.classList.toggle('active', button.getAttribute('data-chat-view') === view);
});
document.getElementById('chatSpaceMembersPanel')?.classList.toggle('hidden', view !== 'groups');
document.getElementById('chatConnectionPanel')?.classList.toggle('hidden', view !== 'connection');
/* Left alone while it is open as a sheet — otherwise switching view behind it
   would blank the panel the user is reading. */
/* The identity card used to be a section of Settings. It is reached from the
   card at the top of the rail now — as a centred popup on a desktop and a
   sheet on a phone — so Settings no longer shows a second copy of it. */
const identityStrip = document.getElementById('chatIdentityStrip');
if (identityStrip && !identityStrip.classList.contains('is-sheet')) {
identityStrip.classList.add('hidden');
}
document.getElementById('chatMessages')?.classList.toggle('hidden', view === 'calls' || view === 'connection');
document.getElementById('chatCallsPanel')?.classList.toggle('hidden', view !== 'calls');
if (view !== 'calls') document.getElementById('chatStartChatBtn')?.classList.remove('hidden');
/* Entering Settings on a wide window opens a section straight away rather than
   facing the user with an empty panel and a sentence. */
if (view === 'connection' && document.querySelector('.chat-settings-menu')) openDefaultSettingsPane();
/* Leaving Settings has to take its section off the facing panel with it, or
   the relay form stays on screen under the conversation you just opened. */
if (view !== 'connection' && chatState.settingsPane) closeChatSettingsPane();
if (view === 'calls') window.setTimeout(markCallsRead, 0);
/* Coming back out of Calls, the avatar the header hid has to return before
   renderActivePeer fills it in again. */
if (view !== 'calls') document.getElementById('chatActiveAvatar')?.classList.remove('hidden');
document.querySelector('.chat-composer-bar')?.classList.toggle('hidden', view === 'calls' || view === 'connection');
renderPeers();
renderActivePeer();
/* After renderActivePeer, not before: it writes the same three nodes. */
applyCallsThreadHeader();
refreshComposerFocusFlag();
}
/* The group maker. Name, picture, description, who is in it and what they may
 * do, decided together and applied at creation - rather than a name field that
 * makes a group and four other places that repair it afterwards. */
let groupMakerAvatar = '';
function groupMakerDefaults() {
  return SPACE_PERMISSIONS.reduce((acc, key) => { acc[key] = true; return acc; }, {});
}
function renderGroupMakerPerms(current) {
  const box = document.getElementById('chatGroupMakerPerms');
  if (!box) return;
  box.innerHTML = SPACE_PERMISSIONS.map((key) => `
    <label class="chat-group-maker-perm">
      <input type="checkbox" data-group-maker-perm="${key}" ${current[key] === false ? '' : 'checked'}>
      <span>${app().escapeHTML(t(...(SPACE_PERMISSION_LABELS[key] || [key, key])))}</span>
    </label>`).join('');
}
function openGroupMaker() {
  const box = document.getElementById('chatGroupMaker');
  if (!box) return;
  groupMakerAvatar = '';
  const img = document.getElementById('chatGroupMakerAvatarImg');
  if (img) { img.hidden = true; img.removeAttribute('src'); }
  const name = document.getElementById('chatGroupNameInput');
  if (name) name.value = '';
  const about = document.getElementById('chatGroupMakerAbout');
  if (about) about.value = '';
  renderSpaceMemberPickers();
  renderGroupMakerPerms(groupMakerDefaults());
  box.classList.remove('hidden');
  window.setTimeout(() => name?.focus(), 50);
}
function closeGroupMaker() {
  document.getElementById('chatGroupMaker')?.classList.add('hidden');
}
function groupMakerPermissions() {
  const chosen = {};
  document.querySelectorAll('[data-group-maker-perm]').forEach((box) => {
    chosen[box.getAttribute('data-group-maker-perm')] = box.checked;
  });
  return SPACE_PERMISSIONS.reduce((acc, key) => {
    acc[key] = chosen[key] !== false;
    return acc;
  }, {});
}

function createSpace(type) {
if (type !== 'group') return;
const input = document.getElementById('chatGroupNameInput');
const name = input?.value.trim();
if (!name) return;
const members = normalizeSpaceMembers(selectedSpaceMembers('group'));
if (!members.length) {
notify(t('برای ساخت گروه حداقل یک عضو انتخاب کنید.', 'Select at least one group member.'), 'warning');
return;
}
const space = {
type: 'group',
name,
description: String(document.getElementById('chatGroupMakerAbout')?.value || '').trim().slice(0, 400),
avatarData: groupMakerAvatar || '',
permissions: groupMakerPermissions(),
conversationId: `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
members,
createdAt: new Date().toISOString(),
ownerPeerId: chatState.peerId || '',
ownerClientId: chatState.clientId || '',
ownerFingerprint: chatState.identity?.fingerprint || '',
};
upsertSharedSpace(space);
broadcastSpaceRecord(space);
input.value = '';
groupMakerAvatar = '';
closeGroupMaker();
chatState.activeConversationId = space.conversationId;
chatState.activePeerClientId = '';
updateChatShellMode();
setChatView('groups');
}
async function updateProfileAvatar(file) {
/* The type check used to be the gate, and it turned people away for the
   wrong reason: a DNG often arrives with an empty type from the picker, and
   one that arrives as image/x-adobe-dng passed the check and then failed
   silently at new Image(). What decides is whether a picture can be got out
   of the file, which is the question asked below. */
if (!file) return;
if (file.size > MAX_PROFILE_AVATAR_BYTES) {
notify(t('تصویر پروفایل باید کمتر از 5 مگابایت باشد', 'Profile image must be under 5 MB'), 'warning');
return;
}
/* An iPhone shoots HEIC and a camera in raw mode writes DNG. Most engines
   draw neither, and the old path waited for an onload that never came, so
   the picture was chosen and nothing happened. */
try {
const { dataUrl } = await window.PoorijaImageFormats.toDrawableDataUrl(file);
openAvatarEditor(dataUrl, { prepareOriginalForSave: true });
} catch (error) {
notify(describeImageFailure(error), 'error');
}
}

/** Says which format could not be opened, rather than "that did not work". */
function describeImageFailure(error) {
const reason = String(error?.message || error);
if (reason.includes('DNG-no-preview')) {
return t('این فایل DNG پیش‌نمایشی درون خود ندارد. از برنامهٔ دوربین یک JPEG بگیرید.',
  'This DNG carries no embedded preview. Export a JPEG from your camera app.');
}
if (reason.includes('HEIC-no-preview')) {
return t('این فایل HEIC پیش‌نمایشی درون خود ندارد. از برنامهٔ عکس یک JPEG بگیرید.',
  'This HEIC carries no embedded preview. Export a JPEG from your photos app.');
}
return t('این تصویر باز نشد.', 'That image could not be opened.');
}
function setAvatarEditorVisible(visible) {
const chooser = document.getElementById('chatAvatarChooser');
chooser?.classList.toggle('chat-avatar-editing', Boolean(visible));
document.getElementById('chatAvatarEditor')?.classList.toggle('hidden', !visible);
}
function openAvatarEditor(dataUrl, options = {}) {
const image = new Image();
image.onload = () => {
if (options.prepareOriginalForSave) {
setPendingAvatarData(dataUrl);
}
chatState.avatarEditor = {
image,
rotation: 0,
zoom: 1,
offsetX: 0,
offsetY: 0,
scaleX: 1,
scaleY: 1,
filter: 'none',
};
[
['chatAvatarZoomInput', '1'],
['chatAvatarOffsetXInput', '0'],
['chatAvatarOffsetYInput', '0'],
['chatAvatarScaleXInput', '1'],
['chatAvatarScaleYInput', '1'],
['chatAvatarFilterSelect', 'none'],
].forEach(([id, value]) => {
const input = document.getElementById(id);
if (input) input.value = value;
});
setAvatarEditorVisible(true);
drawAvatarEditor();
};
image.onerror = () => notify(t('تصویر انتخابی قابل خواندن نیست.', 'Selected image could not be read.'), 'error');
image.src = dataUrl;
}
function drawAvatarEditor() {
const editor = chatState.avatarEditor;
const canvas = document.getElementById('chatAvatarEditorCanvas');
const ctx = canvas?.getContext('2d');
if (!editor || !canvas || !ctx) return;
const size = canvas.width;
ctx.clearRect(0, 0, size, size);
ctx.save();
ctx.fillStyle = '#020617';
ctx.fillRect(0, 0, size, size);
ctx.translate(size / 2, size / 2);
ctx.rotate((editor.rotation * Math.PI) / 180);
ctx.filter = editor.filter || 'none';
const rotated = Math.abs(editor.rotation % 180) === 90;
const imageWidth = rotated ? editor.image.height : editor.image.width;
const imageHeight = rotated ? editor.image.width : editor.image.height;
const baseScale = size / Math.min(imageWidth, imageHeight);
const scale = baseScale * editor.zoom;
ctx.drawImage(
editor.image,
(-editor.image.width * scale * editor.scaleX / 2) + editor.offsetX,
(-editor.image.height * scale * editor.scaleY / 2) + editor.offsetY,
editor.image.width * scale * editor.scaleX,
editor.image.height * scale * editor.scaleY
);
ctx.restore();
}
function canvasToAvatarDataUrl(canvas) {
try {
return canvas.toDataURL('image/png');
} catch (error) {
console.warn('Avatar canvas export failed:', error);
return '';
}
}
function setPendingAvatarData(avatarData = '') {
chatState.pendingAvatarData = String(avatarData || '');
renderStaticUi();
const saveBtn = document.getElementById('chatAvatarSaveBtn');
if (saveBtn) saveBtn.disabled = !chatState.pendingAvatarData;
if (chatState.pendingAvatarData) {
notify(t('تغییرات آواتار آماده است؛ برای اعمال نهایی ذخیره را بزنید.', 'Avatar changes are ready; press Save to apply them.'), 'info');
}
}
function savePendingAvatar() {
if (!chatState.pendingAvatarData) return;
setProfileAvatarData(chatState.pendingAvatarData);
chatState.pendingAvatarData = '';
renderStaticUi();
toggleAvatarChooser(false);
notify(t('آواتار پروفایل ذخیره شد.', 'Profile avatar saved.'), 'success');
}
function rotateAvatarEditor(delta) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.rotation = (chatState.avatarEditor.rotation + delta + 360) % 360;
drawAvatarEditor();
}
function setAvatarEditorZoom(value) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.zoom = Math.max(1, Math.min(2.6, Number(value) || 1));
drawAvatarEditor();
}
function setAvatarEditorAxis(axis, value) {
if (!chatState.avatarEditor) return;
const numeric = Number(value);
if (axis === 'offsetX') chatState.avatarEditor.offsetX = Math.max(-120, Math.min(120, Number.isFinite(numeric) ? numeric : 0));
if (axis === 'offsetY') chatState.avatarEditor.offsetY = Math.max(-120, Math.min(120, Number.isFinite(numeric) ? numeric : 0));
if (axis === 'scaleX') chatState.avatarEditor.scaleX = Math.max(0.65, Math.min(1.8, Number.isFinite(numeric) ? numeric : 1));
if (axis === 'scaleY') chatState.avatarEditor.scaleY = Math.max(0.65, Math.min(1.8, Number.isFinite(numeric) ? numeric : 1));
drawAvatarEditor();
}
function setAvatarEditorFilter(value) {
if (!chatState.avatarEditor) return;
chatState.avatarEditor.filter = String(value || 'none');
drawAvatarEditor();
}
function applyAvatarEditor() {
const canvas = document.getElementById('chatAvatarEditorCanvas');
if (!chatState.avatarEditor || !canvas) return;
drawAvatarEditor();
const dataUrl = canvasToAvatarDataUrl(canvas);
if (!dataUrl) {
notify(t('اعمال کراپ تصویر ناموفق بود.', 'Could not apply the profile image crop.'), 'error');
return;
}
setPendingAvatarData(dataUrl);
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
notify(t('کراپ اعمال شد؛ برای ست شدن روی پروفایل ذخیره را بزنید.', 'Crop applied; press Save to set it on your profile.'), 'success');
}
function cancelAvatarEditor() {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
}
function setProfileAvatarData(avatarData = '') {
chatState.profile = {
...chatState.profile,
...buildProfileDraft(),
avatarData,
};
saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
renderStaticUi();
broadcastHello();
}
async function updateGroupAvatar(file) {
const space = getActiveConversation();
/* No type gate: see updateProfileAvatar. A camera container is judged by
   whether a picture can be got out of it, not by what the picker called it. */
if (!space || space.type !== 'group' || !file) return;
if (file.size > 2 * 1024 * 1024) {
notify(t('تصویر گروه باید کمتر از 2 مگابایت باشد', 'Group image must be under 2 MB'), 'warning');
return;
}
let dataUrl;
try {
({ dataUrl } = await window.PoorijaImageFormats.toDrawableDataUrl(file));
} catch (error) {
notify(describeImageFailure(error), 'error');
return;
}
{
space.avatarData = dataUrl;
space.members = normalizeSpaceMembers(space.members);
saveSpaces();
broadcastSpaceRecord(space);
renderPeers();
renderActivePeer();
renderSpaceMemberManager();
notify(t('عکس گروه ذخیره شد.', 'Group picture saved.'), 'success');
}
}
function toggleAvatarChooser(force) {
mountChatPortals();
const chooser = document.getElementById('chatAvatarChooser');
if (!chooser) return;
const open = typeof force === 'boolean' ? force : chooser.classList.contains('hidden');
chooser.classList.toggle('hidden', !open);
document.documentElement.classList.toggle('chat-avatar-chooser-open', open);
if (!open) {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
if (chatState.pendingAvatarData) {
chatState.pendingAvatarData = '';
renderStaticUi();
}
}
}
async function selectPresetAvatar(url) {
if (!url) return;
try {
const response = await fetch(url, { cache: 'force-cache' });
if (!response.ok) throw new Error('Avatar preset not found');
const blob = await response.blob();
const reader = new FileReader();
reader.onloadend = () => {
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(String(reader.result || ''));
};
reader.readAsDataURL(blob);
} catch (error) {
console.warn('Failed to load avatar preset:', error);
chatState.avatarEditor = null;
setAvatarEditorVisible(false);
setPendingAvatarData(url);
}
}
function generatedAvatarData(seed = 'cyan', label = '') {
const palettes = {
cyan: ['#0ea5e9', '#14b8a6'],
violet: ['#7c3aed', '#0ea5e9'],
emerald: ['#059669', '#22c55e'],
amber: ['#f59e0b', '#ef4444'],
rose: ['#e11d48', '#fb7185'],
indigo: ['#4f46e5', '#06b6d4'],
slate: ['#334155', '#64748b'],
teal: ['#0f766e', '#2dd4bf'],
};
const [a, b] = palettes[seed] || palettes.cyan;
const initial = String(label || seed || 'P').trim().slice(0, 1).toUpperCase() || 'P';
const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="128" height="128" rx="38" fill="url(#g)"/>
<circle cx="92" cy="34" r="26" fill="rgba(255,255,255,.16)"/>
<circle cx="36" cy="96" r="34" fill="rgba(2,6,23,.18)"/>
<text x="64" y="78" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="900" fill="white">${app().escapeHTML(initial)}</text>
</svg>
`;
return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}
function supportedAudioMimeType() {
if (!window.MediaRecorder) return '';
const candidates = [
'audio/webm;codecs=opus',
'audio/webm',
'audio/mp4',
'audio/ogg;codecs=opus',
];
return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}
function setRecordingOverlayVisible(visible) {
const overlay = document.getElementById('chatRecordingOverlay');
const surface = document.querySelector('.chat-composer-surface');
const sendBtn = document.getElementById('chatSendMessageBtn');
if (!overlay) return;
overlay.classList.toggle('hidden', !visible);
// Toggle main surface to prevent sholooghi (clutter)
const liveUI = document.getElementById('chatRecordingLive');
if (surface) surface.classList.toggle('hidden', visible);
if (sendBtn) {
// Send button should be visible in preview mode
const isLive = visible && liveUI && !liveUI.classList.contains('hidden');
sendBtn.classList.toggle('hidden', isLive);
}
if (!visible) {
stopRecordingTimer();
stopVoicePlayback();
if (surface) surface.classList.remove('hidden');
if (sendBtn) sendBtn.classList.remove('hidden');
}
}
function startRecordingTimer() {
chatState.recordingStartTime = Date.now();
chatState.recordingPaused = false;
chatState.recordingInterval = setInterval(() => {
if (chatState.mediaRecorder?.state === 'recording' && !chatState.recordingPaused) {
const now = Date.now();
chatState.recordingElapsed += (now - chatState.recordingStartTime);
chatState.recordingStartTime = now;
const seconds = Math.floor(chatState.recordingElapsed / 1000);
const timerEl = document.getElementById('chatRecordingTimer');
if (timerEl) {
const m = Math.floor(seconds / 60).toString().padStart(2, '0');
const s = (seconds % 60).toString().padStart(2, '0');
timerEl.textContent = `${m}:${s}`;
}
}
}, 100);
}
