/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's account, from the page: change the password, re-add the
 * authenticator (the old one keeps working until a code from the new one is
 * entered), sign out the other sessions, see the sign-ins. Every change asks
 * for a current code, single-use: the code that just signed in cannot also
 * authorise a change. Sessions survive a restart of the panel.
 *
 *   node tests/e2e/panelaccount.mjs
 */
import { startPanel, login, PASSWORD } from './_panel-run.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const panel = await startPanel();
try {
  const first = await panel.signIn();
  check('sign in', first.status === 200 && first.cookie, JSON.stringify(first.json));
  const second = await panel.signIn();
  check('and a second session', second.status === 200 && second.cookie && second.cookie !== first.cookie);
  const a = first.cookie;
  const b = second.cookie;

  const account = await panel.request('/api/account', { cookie: a });
  check('the account shows the user, the sessions and the sign-ins',
    account.json?.user === 'op' && account.json?.sessions?.length === 2 && account.json?.history?.some((entry) => /login op ok/.test(entry.line)), JSON.stringify(account.json || {}).slice(0, 200));

  /* The code that signed in is spent; the same one cannot authorise a change. */
  const step = Math.floor((Date.now() + Number((await import('node:fs')).readFileSync(panel.clockFile, 'utf8'))) / 30000);
  const spent = login.totp(panel.record.totp, step);
  const reused = await panel.request('/api/account/sessions/revoke', { method: 'POST', body: { code: spent }, cookie: a });
  check('a code already used to sign in cannot authorise a change', reused.status === 403 && reused.json?.reason === 'code-used', `${reused.status} ${JSON.stringify(reused.json)}`);

  const wrongCurrent = await panel.request('/api/account/password', { method: 'POST', body: { current: 'not-the-password-12', next: 'A-new-password-for-op-1', code: panel.code() }, cookie: a });
  check('a password change with the wrong current password is refused', wrongCurrent.status === 403, String(wrongCurrent.status));
  const tooShort = await panel.request('/api/account/password', { method: 'POST', body: { current: PASSWORD, next: 'short-11ch', code: panel.code() }, cookie: a });
  check('and with a new one under 12 characters', tooShort.status === 400, String(tooShort.status));
  const changed = await panel.request('/api/account/password', { method: 'POST', body: { current: PASSWORD, next: 'A-new-password-for-op-1', code: panel.code() }, cookie: a });
  check('the password changes', changed.status === 200, `${changed.status} ${JSON.stringify(changed.json)}`);
  check('and every other session is signed out', (await panel.request('/api/session', { cookie: b })).status === 401);
  check('while this one stays', (await panel.request('/api/session', { cookie: a })).status === 200);
  check('the old password no longer signs in', (await panel.signIn(PASSWORD)).status === 401);
  const withNew = await panel.signIn('A-new-password-for-op-1');
  check('the new one does', withNew.status === 200);

  /* A new authenticator, confirmed before it replaces the old one. */
  const begin = await panel.request('/api/account/totp/begin', { method: 'POST', body: { password: 'A-new-password-for-op-1', code: panel.code() }, cookie: a });
  const fresh = begin.json?.secret || '';
  check('a new authenticator gives a secret, its link and a QR code', begin.status === 200 && /^[A-Z2-7]{32}$/.test(fresh) && /^otpauth:\/\//.test(begin.json?.uri || '') && String(begin.json?.svg || '').startsWith('<svg'), `${begin.status} ${JSON.stringify(begin.json || {}).slice(0, 120)}`);
  check('until it is confirmed, the old one still signs in', (await panel.signIn('A-new-password-for-op-1')).status === 200);
  const wrongConfirm = await panel.request('/api/account/totp/confirm', { method: 'POST', body: { code: '000000' }, cookie: a });
  check('a wrong confirming code is refused', wrongConfirm.status === 400, String(wrongConfirm.status));
  const confirmed = await panel.request('/api/account/totp/confirm', { method: 'POST', body: { code: panel.code(fresh) }, cookie: a });
  check('a code from the new secret confirms it', confirmed.status === 200, `${confirmed.status} ${JSON.stringify(confirmed.json)}`);
  check('then the old secret no longer signs in', (await panel.signIn('A-new-password-for-op-1')).status === 401);
  const withFresh = await panel.signIn('A-new-password-for-op-1', fresh);
  check('and the new one does', withFresh.status === 200);

  /* Sign out the others. */
  const revoked = await panel.request('/api/account/sessions/revoke', { method: 'POST', body: { code: panel.code(fresh) }, cookie: a });
  check('the other sessions can be signed out', revoked.status === 200 && (await panel.request('/api/session', { cookie: withFresh.cookie })).status === 401 && (await panel.request('/api/session', { cookie: a })).status === 200);

  /* A restart keeps the session. */
  await panel.stop();
  await panel.start();
  check('a session survives a restart of the panel', (await panel.request('/api/session', { cookie: a })).status === 200);

  /* A locked address learns nothing more: not even whether a password is right. */
  for (let i = 0; i < 6; i += 1) await panel.request('/api/account/totp/begin', { method: 'POST', body: { password: 'wrong-password-123', code: '000000' }, cookie: a });
  const lockedRight = await panel.request('/api/account/totp/begin', { method: 'POST', body: { password: 'A-new-password-for-op-1', code: panel.code(fresh) }, cookie: a });
  const lockedWrong = await panel.request('/api/account/totp/begin', { method: 'POST', body: { password: 'wrong-password-123', code: '000000' }, cookie: a });
  check('once the address is locked, a right and a wrong password get the same answer', lockedRight.status === 429 && lockedWrong.status === 429, `${lockedRight.status} ${lockedWrong.status}`);

  const audit = panel.audit();
  check('the audit log holds no password and no secret', !audit.includes(PASSWORD) && !audit.includes('A-new-password-for-op-1') && !audit.includes(fresh) && !audit.includes(panel.record.totp));
  check('every change is in it', /password changed/.test(audit) && /authenticator replaced/.test(audit) && /signed out \d+ other session/.test(audit), audit.split('\n').slice(-6).join(' | ').slice(0, 300));
} catch (error) {
  check('the suite ran to the end', false, error?.stack || String(error));
} finally {
  await panel.cleanup();
}
const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
