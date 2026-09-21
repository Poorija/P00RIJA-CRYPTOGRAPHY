/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Real disk-backed Chromium + WebKit restarts, using production vault/chat code.
   No relay needed: this isolates local durability from message delivery. */
import { chromium, webkit } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const base = process.env.PKG_URL || 'http://localhost:8123';
const password = 'History-Restart#2026';
let checks = 0;
function check(name, result) { assert.ok(result, name); console.log(`PASS ${name}`); checks++; }
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `poorija-history-${name}-`));
  let context;
  const launch = async () => {
    context = await engine.launchPersistentContext(dir, { headless: true, ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(`${base}/index.html`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof loadPersistedChatState === 'function' && !!window.PoorijaApp);
    return page;
  };
  const unlock = async (page) => page.evaluate(async (pass) => {
    const profile = await PoorijaVault.openVault(pass);
    Object.assign(PoorijaApp.state, { activeProfile: profile, masterPassword: pass, isLocked: false });
    await migrateLegacyStorageIntoProfile(profile, pass);
    loadPersistedChatState();
    return profile.pid;
  }, password);
  try {
    let page = await launch();
    const initial = await page.evaluate(async (pass) => {
      await writeMasterPasswordRecord(pass);
      Object.assign(PoorijaApp.state, { masterPassword: pass, isLocked: false });
      loadPersistedChatState();
      const pid = PoorijaApp.state.activeProfile.pid;
      chatState.profile.autoConnect = false;
      saveEncrypted(CHAT_PROFILE_STORAGE_KEY, chatState.profile);
      // Simulate old Safari's flat v4 writes for the upgrade test.
      PoorijaVault.__native.setItem('poorija_chat_drafts', PoorijaApp.encryptStorageData({ recovered: 'old Safari draft' }));
      const entries = ['text', 'file', 'voice', 'sticker', 'poll', 'location'].map((type, i) => ({
        id: `restart-${i}`, type, text: 'متن پایدار 🔐', createdAt: new Date(Date.now() - 12 * 3600000).toISOString(),
        direction: 'out', timerSeconds: 0, expiresAt: '', name: `${type}.bin`, mime: 'application/octet-stream'
      }));
      chatState.history = { friend: entries };
      storeHistory();
      // No timer may be necessary to preserve the newly added messages.
      const saved = PoorijaApp.decryptStorageData(localStorage.getItem(CHAT_HISTORY_STORAGE_KEY));
      const bytes = new Uint8Array([0, 1, 2, 255, 128, 42]);
      for (const entry of entries.filter(isMediaEntry)) {
        if (!await persistMessageMedia('friend', entry, new Blob([bytes]))) throw new Error('media save failed');
      }
      sessionStorage.setItem('poorija_probe', 'session');
      return { pid, immediate: saved?.friend?.length === 6,
        namespaced: !!PoorijaVault.__native.getItem(`poorija_p_${pid}_chat_history`),
        flat: PoorijaVault.__native.getItem('poorija_chat_history'),
        session: sessionStorage.getItem('poorija_probe'),
        artifacts: ['getItem','setItem','removeItem'].some(k => Object.keys(localStorage).includes(k)) };
    }, password);
    check(`${name}: real profile namespacing`, initial.namespaced && initial.flat === null && !initial.artifacts);
    check(`${name}: history committed without waiting for a timer`, initial.immediate);
    check(`${name}: sessionStorage unaffected`, initial.session === 'session');
    await page.evaluate(() => { lockApp(); window.dispatchEvent(new Event('pagehide')); });
    await context.close();
    page = await launch();
    check(`${name}: same profile after browser restart`, await unlock(page) === initial.pid);
    const recovered = await page.evaluate(async () => {
      const media = [];
      for (const id of ['restart-1', 'restart-2', 'restart-3']) {
        const record = await readMessageMedia(id);
        media.push(Array.from(new Uint8Array(await record.blob.arrayBuffer())).join(','));
      }
      return { count: chatState.history.friend?.length, media,
        draft: loadEncrypted('poorija_chat_drafts', {}).recovered,
        flatDraft: PoorijaVault.__native.getItem('poorija_chat_drafts') };
    });
    check(`${name}: all six message kinds survive 12-hour age, lock and restart`, recovered.count === 6);
    check(`${name}: file, voice and sticker bytes survive restart`, recovered.media.every(x => x === '0,1,2,255,128,42'));
    check(`${name}: old Safari ciphertext migrated without loss`, recovered.draft === 'old Safari draft' && recovered.flatDraft === null);
    const failure = await page.evaluate(() => {
      const raw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      const damaged = JSON.parse(raw); damaged.ct = 'AAAA';
      const damagedRaw = JSON.stringify(damaged);
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, damagedRaw);
      loadPersistedChatState();
      storeHistory();
      window.dispatchEvent(new Event('pagehide'));
      renderMessages();
      const preserved = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) === damagedRaw;
      const notice = document.getElementById('chatMessages').textContent;
      localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, raw);
      loadPersistedChatState();
      const restored = chatState.history.friend?.length === 6;
      return { preserved, notice, restored };
    });
    check(`${name}: unreadable ciphertext cannot be overwritten by load/save/pagehide`, failure.preserved);
    check(`${name}: unreadable history displays error instead of empty-chat claim`, /History could not|تاریخچه قابل/.test(failure.notice));
    check(`${name}: valid data can be reloaded after read failure`, failure.restored);
    check(`${name}: quota write failure is reported`, await page.evaluate(() => {
      const before = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      const proto = Object.getPrototypeOf(localStorage), set = proto.setItem;
      proto.setItem = function () { throw new DOMException('Full', 'QuotaExceededError'); };
      const result = saveEncrypted(CHAT_HISTORY_STORAGE_KEY, {});
      proto.setItem = set;
      return result === false && before === localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    }));
    check(`${name}: aborted media transaction is never reported as saved`, await page.evaluate(async () => {
      try {
        await mediaTx('readwrite', (store) => {
          const request = store.put({ id: 'must-abort' });
          request.addEventListener('success', () => request.transaction.abort());
          return request;
        });
        return false;
      } catch (_) {
        return !(await mediaTx('readonly', store => store.get('must-abort')));
      }
    }));
    const isolation = await page.evaluate(async () => {
      const original = PoorijaApp.state.activeProfile;
      const raw = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
      PoorijaVault.__native.setItem('poorija_chat_history', raw);
      // A different, valid profile must not import the first profile's flat data.
      const other = { ...original, pid: 'other-profile-for-test' };
      PoorijaApp.state.activeProfile = other;
      await migrateLegacyStorageIntoProfile(other, 'unused');
      const separated = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) === null;
      flushHistoryStore();
      const notWritten = localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) === null;
      PoorijaApp.state.activeProfile = original;
      PoorijaVault.__native.removeItem('poorija_chat_history');
      return separated && notWritten && localStorage.getItem(CHAT_HISTORY_STORAGE_KEY) === raw;
    });
    check(`${name}: foreign profile cannot import or overwrite history`, isolation);
  } finally {
    await context?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
console.log(`${checks} checks passed`);
