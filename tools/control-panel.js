/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The script of the central panel's page (tools/control-panel.html), served
 * by tools/control-panel.mjs at /panel.js so the page can forbid inline
 * scripts. Everything a server sends is escaped or turned into a number
 * before it is written into the page: a server is not trusted to write HTML
 * into the one place that controls every server. */

const T = {
  fa: {
    title: 'پنل مرکزی سرورها', unlock: 'باز کردن کلید', passphrase: 'عبارت عبور', servers: 'سرورها', name: 'نام', state: 'وضعیت', version: 'نسخه',
    load: 'بار', memory: 'حافظه', disk: 'دیسک', online: 'آنلاین', links: 'لینک رله‌ها', family: 'خانواده', partners: 'شریک‌ها', open: 'پنل این سرور',
    lockOn: 'قفل', lockOff: 'باز کردن قفل', locked: 'قفل', unlocked: 'باز', passwordNeeded: 'رمز پنل لازم است', fleet: 'همهٔ سرورها با هم',
    check: 'بررسی نسخهٔ تازه', update: 'به‌روزرسانی', backup: 'پشتیبان‌گیری', alertTest: 'آزمایش هشدار', tagPrompt: 'کدام نسخه؟ (مثلاً 2.98.78)',
    confirmUpdate: 'همهٔ سرورها یکی‌یکی به این نسخه به‌روز شوند؟ با اولین خطا متوقف می‌شود.', confirmBackup: 'از همهٔ سرورها پشتیبان گرفته شود؟',
    confirmLock: 'این سرور قفل شود؟ کارهای حساس آن فقط با امضا انجام می‌شود.', confirmUnlock: 'قفل این سرور باز شود؟',
    unreachable: 'در دسترس نیست', wrongPassphrase: 'عبارت عبور درست نیست', unlockFirst: 'برای کارهای حساس، کلید این کامپیوتر را باز کنید.',
    sshOnly: 'این کار فقط از راه SSH ممکن است', keyLocked: 'کلید بسته است', keyOpen: 'کلید باز است', ok: 'انجام شد',
    trustNeeded: 'پیش از هر کار حساس، شناسهٔ اپراتور خانواده را که اپراتور به شما داده تأیید کنید.', operatorIdLabel: 'شناسهٔ اپراتور',
    trust: 'تأیید اپراتور', trustRefused: 'این شناسه در هیچ فهرستی از سرورها نیست',
  },
  en: {
    title: 'Server control panel', unlock: 'Unlock key', passphrase: 'Passphrase', servers: 'Servers', name: 'Name', state: 'State', version: 'Version',
    load: 'Load', memory: 'Memory', disk: 'Disk', online: 'Online', links: 'Relay links', family: 'Family', partners: 'Partners', open: 'Open dashboard',
    lockOn: 'Lock', lockOff: 'Unlock', locked: 'locked', unlocked: 'open', passwordNeeded: 'needs its dashboard password', fleet: 'Every server at once',
    check: 'Check for updates', update: 'Update', backup: 'Back up', alertTest: 'Test alerts', tagPrompt: 'Which version? (e.g. 2.98.78)',
    confirmUpdate: 'Update every server to this version, one at a time? It stops at the first failure.', confirmBackup: 'Back up every server?',
    confirmLock: 'Lock this server? Its dangerous actions will need a signature.', confirmUnlock: 'Unlock this server?',
    unreachable: 'unreachable', wrongPassphrase: 'That passphrase is not right', unlockFirst: 'Unlock this computer’s key for dangerous actions.',
    sshOnly: 'This needs SSH', keyLocked: 'key locked', keyOpen: 'key open', ok: 'Done',
    trustNeeded: 'Before any dangerous action, confirm the family operator id the operator gave you.', operatorIdLabel: 'Operator id',
    trust: 'Confirm operator', trustRefused: 'No server’s directory carries that id',
  },
};
let LANG = (() => { try { return localStorage.getItem('panel_lang') || 'fa'; } catch (_error) { return 'fa'; } })();
const t = (key) => (T[LANG] && T[LANG][key]) || T.fa[key] || key;
const $ = (id) => document.getElementById(id);
const esc = (text) => { const div = document.createElement('div'); div.textContent = String(text ?? ''); return div.innerHTML; };
const pct = (used, total) => (total ? Math.round((used / total) * 100) + '%' : '—');

function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'fa' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-t]').forEach((node) => { node.textContent = t(node.getAttribute('data-t')); });
  document.querySelectorAll('[data-ph]').forEach((node) => { node.placeholder = t(node.getAttribute('data-ph')); });
  $('langToggle').textContent = LANG === 'fa' ? 'EN' : 'فا';
}

async function call(path, body) {
  const response = await fetch(path, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.json().catch(() => ({ ok: false }));
}
function show(value) { $('results').textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }

const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
function rowHtml(server) {
  const state = !server.reachable ? '<span class="tag bad">' + esc(t('unreachable')) + '</span>'
    : (server.locked ? '<span class="tag good">' + esc(t('locked')) + '</span>' : '<span class="tag">' + esc(t('unlocked')) + '</span>')
      + (server.passwordOk ? '' : ' <span class="tag warn">' + esc(t('passwordNeeded')) + '</span>');
  const memory = server.memory ? pct(num(server.memory.total) - num(server.memory.free), num(server.memory.total)) : '—';
  const disk = server.storage ? pct(num(server.storage.total) - num(server.storage.free), num(server.storage.total)) : '—';
  const links = server.links ? esc(num(server.links.up)) + '/' + esc(num(server.links.allowed)) : '—';
  const family = server.family ? esc(server.family.name) + ' #' + esc(num(server.family.serial)) : '—';
  const partners = (server.partners || []).map((entry) => esc(entry.name) + ' (' + esc(entry.state) + ')').join('، ') || '—';
  const load = Array.isArray(server.cpu) ? server.cpu.map((value) => num(value).toFixed(2)).join(' ') : '—';
  const proxy = num(server.proxy);
  return '<tr><td><strong>' + esc(server.name) + '</strong></td><td>' + state + '</td><td class="mono">' + esc(server.version || '—') + '</td>'
    + '<td class="mono">' + esc(load) + '</td><td>' + esc(memory) + '</td><td>' + esc(disk) + '</td><td>' + esc(num(server.peers)) + '</td>'
    + '<td>' + links + '</td><td>' + family + '</td><td>' + partners + '</td>'
    + '<td class="row">'
    + '<button data-open="' + esc(proxy) + '">' + esc(t('open')) + '</button>'
    + '<button data-lock="' + esc(server.name) + '" data-on="' + (server.locked ? '0' : '1') + '"' + (server.locked ? '' : ' class="acc"') + '>' + esc(t(server.locked ? 'lockOff' : 'lockOn')) + '</button>'
    + (server.passwordOk || !server.reachable ? '' : '<input type="password" data-password="' + esc(server.name) + '" placeholder="' + esc(t('passwordNeeded')) + '">')
    + '</td></tr>';
}

async function refresh() {
  const data = await call('/api/servers');
  $('keyState').textContent = data.unlocked ? t('keyOpen') : t('keyLocked');
  $('keyState').className = 'tag ' + (data.unlocked ? 'good' : 'warn');
  $('unlockBox').style.display = data.unlocked ? 'none' : '';
  const operator = data.operator || {};
  $('trustBox').style.display = operator.confirmed ? 'none' : '';
  $('operatorCandidates').textContent = (operator.candidates || []).map((candidate) => candidate.name + ' — ' + candidate.id).join('\n');
  $('serverRows').innerHTML = (data.servers || []).map(rowHtml).join('');
}

async function fleet(action, body) {
  const answer = await call('/api/fleet/' + action, { body: body || {} });
  if (answer.reason === 'unlock-needed') { $('unlockBox').style.display = ''; show(t('unlockFirst')); return; }
  show(answer);
  refresh();
}

$('langToggle').addEventListener('click', () => {
  LANG = LANG === 'fa' ? 'en' : 'fa';
  try { localStorage.setItem('panel_lang', LANG); } catch (_error) { /* a private window */ }
  applyLang();
  refresh();
});
$('unlockButton').addEventListener('click', async () => {
  const answer = await call('/api/unlock', { passphrase: $('passphrase').value });
  $('passphrase').value = '';
  show(answer.ok ? t('ok') : t('wrongPassphrase'));
  refresh();
});
$('trustButton').addEventListener('click', async () => {
  const answer = await call('/api/trust', { operatorId: $('operatorId').value.trim() });
  show(answer.ok ? t('ok') : t('trustRefused'));
  if (answer.ok) $('operatorId').value = '';
  refresh();
});
$('fleetCheck').addEventListener('click', () => fleet('check'));
$('fleetAlert').addEventListener('click', () => fleet('alert-test'));
$('fleetBackup').addEventListener('click', () => { if (confirm(t('confirmBackup'))) fleet('backup'); });
$('fleetUpdate').addEventListener('click', () => {
  const tag = (prompt(t('tagPrompt')) || '').trim();
  if (tag && confirm(t('confirmUpdate') + ' (' + tag + ')')) fleet('update', { tag });
});
$('serverRows').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open]');
  if (open) { window.open('http://127.0.0.1:' + num(open.getAttribute('data-open')) + '/Monitor_Server', '_blank', 'noopener'); return; }
  const lock = event.target.closest('[data-lock]');
  if (lock) {
    const on = lock.getAttribute('data-on') === '1';
    if (!confirm(t(on ? 'confirmLock' : 'confirmUnlock'))) return;
    const answer = await call('/api/lock', { server: lock.getAttribute('data-lock'), on });
    show(answer.reason === 'ssh-only' ? t('sshOnly') : answer);
    setTimeout(refresh, 4000);
  }
});
$('serverRows').addEventListener('change', async (event) => {
  const box = event.target.closest('[data-password]');
  if (!box) return;
  await call('/api/password', { server: box.getAttribute('data-password'), password: box.value });
  box.value = '';
  refresh();
});

applyLang();
refresh();
setInterval(refresh, 15000);
