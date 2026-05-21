(function () {
  const state = {
    serverUrl: '',
    token: '',
    refreshTimer: null,
    latest: null,
  };

  const $ = (id) => document.getElementById(id);

  const els = {
    loginForm: $('loginForm'),
    serverUrlInput: $('serverUrlInput'),
    passwordInput: $('passwordInput'),
    loginButton: $('loginButton'),
    connectionBadge: $('connectionBadge'),
    statusText: $('statusText'),
    dashboard: $('dashboard'),
    serverTitle: $('serverTitle'),
    serverMeta: $('serverMeta'),
    refreshButton: $('refreshButton'),
    logoutButton: $('logoutButton'),
    metricPeers: $('metricPeers'),
    metricQueue: $('metricQueue'),
    metricRelays: $('metricRelays'),
    metricTurn: $('metricTurn'),
    metricMemory: $('metricMemory'),
    metricCpu: $('metricCpu'),
    peersCount: $('peersCount'),
    peersTable: $('peersTable'),
    broadcastForm: $('broadcastForm'),
    broadcastTarget: $('broadcastTarget'),
    broadcastMessage: $('broadcastMessage'),
    broadcastFile: $('broadcastFile'),
    broadcastResult: $('broadcastResult'),
    suspendedCount: $('suspendedCount'),
    suspendedTable: $('suspendedTable'),
    kickedCount: $('kickedCount'),
    kickedTable: $('kickedTable'),
    clearOfflineButton: $('clearOfflineButton'),
    optimizeRamButton: $('optimizeRamButton'),
    clearMemoryButton: $('clearMemoryButton'),
    maintenanceResult: $('maintenanceResult'),
    passwordForm: $('passwordForm'),
    oldPasswordInput: $('oldPasswordInput'),
    newPasswordInput: $('newPasswordInput'),
    passwordResult: $('passwordResult'),
    lastUpdate: $('lastUpdate'),
    sysNode: $('sysNode'),
    sysPlatform: $('sysPlatform'),
    sysPorts: $('sysPorts'),
    sysStorage: $('sysStorage'),
    sysUptime: $('sysUptime'),
    sysTraffic: $('sysTraffic'),
    logsPanel: $('logsPanel'),
  };

  function normalizeServerUrl(value) {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) throw new Error('آدرس سرور خالی است.');
    const withScheme = /^https?:\/\//i.test(raw)
      ? raw
      : (isLocalHost(raw) ? `http://${raw}` : `https://${raw}`);
    const parsed = new URL(withScheme);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('آدرس سرور باید http یا https باشد.');
    }
    return parsed.origin;
  }

  function isLocalHost(value) {
    const host = String(value).split(/[/:?#]/)[0].replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
    return host === 'localhost'
      || host === '127.0.0.1'
      || host === '0.0.0.0'
      || host === '::1'
      || host.endsWith('.localhost');
  }

  async function api(path, options = {}) {
    if (!state.serverUrl) throw new Error('به سرور متصل نیستید.');
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');
    if (state.token) headers.set('Authorization', `Basic ${state.token}`);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const response = await fetch(`${state.serverUrl}${path}`, {
      cache: 'no-store',
      mode: 'cors',
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      const message = payload.message || payload.reason || `HTTP ${response.status}`;
      const error = new Error(message);
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function setStatus(message, online = false) {
    els.statusText.textContent = message;
    els.connectionBadge.textContent = online ? 'وصل' : 'قطع';
    els.connectionBadge.classList.toggle('offline', !online);
  }

  function showResult(el, message, ok = true) {
    el.textContent = message;
    el.style.color = ok ? 'var(--accent)' : 'var(--danger)';
    window.clearTimeout(el._clearTimer);
    el._clearTimer = window.setTimeout(() => {
      el.textContent = '';
    }, 4500);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function base64Utf8(value) {
    const bytes = new TextEncoder().encode(String(value));
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let n = value / 1024;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
  }

  function formatUptime(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days) return `${days}d ${hours}h`;
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatDate(value) {
    if (!value) return 'بدون محدودیت';
    const ms = Number(value);
    const date = Number.isFinite(ms) ? new Date(ms) : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('fa-IR');
  }

  function rowIdentity(row) {
    return row.username || row.peerId || row.fingerprint || row.clientId || row.key || 'بدون نام';
  }

  function render(data) {
    state.latest = data;
    const peers = Array.isArray(data.peersList) ? data.peersList : [];
    const suspended = Array.isArray(data.suspendedUsers) ? data.suspendedUsers : [];
    const kicked = Array.isArray(data.kickedUsers) ? data.kickedUsers : [];
    const traffic = data.traffic || {};
    const memory = data.memory || {};

    els.dashboard.classList.remove('hidden');
    els.serverTitle.textContent = state.serverUrl;
    els.serverMeta.textContent = `${data.service || 'server'} • ${data.timestamp || ''}`;
    els.metricPeers.textContent = String(data.peers ?? peers.length);
    els.metricQueue.textContent = String(data.queuedMessages || 0);
    els.metricRelays.textContent = String(traffic.relays || 0);
    els.metricTurn.textContent = data.turnEnabled ? 'روشن' : 'خاموش';
    els.metricMemory.textContent = `${memory.heapUsed || 0}/${memory.heapTotal || 0} MB`;
    els.metricCpu.textContent = `${data.cpuLoad || 0}%`;
    els.peersCount.textContent = String(peers.length);
    els.suspendedCount.textContent = String(suspended.length);
    els.kickedCount.textContent = String(kicked.length);
    els.lastUpdate.textContent = new Date().toLocaleTimeString('fa-IR');
    els.sysNode.textContent = data.nodeVersion || '-';
    els.sysPlatform.textContent = data.platform || '-';
    els.sysPorts.textContent = (data.activePorts || []).join(', ') || '-';
    els.sysStorage.textContent = data.storage ? `${data.storage.free}/${data.storage.total} MB free` : '-';
    els.sysUptime.textContent = `${formatUptime(data.uptime)} / host ${formatUptime(data.sysUptime)}`;
    els.sysTraffic.textContent = `${formatBytes(traffic.bytesIn)} in / ${formatBytes(traffic.bytesOut)} out`;
    els.logsPanel.textContent = Array.isArray(data.logs)
      ? data.logs.slice(-100).map((line) => typeof line === 'string' ? line : JSON.stringify(line)).join('\n')
      : '';

    renderPeers(peers);
    renderPolicies(suspended, els.suspendedTable, 'resume');
    renderPolicies(kicked, els.kickedTable, 'unkick');
    renderBroadcastTargets(peers);
  }

  function renderPeers(peers) {
    if (!peers.length) {
      els.peersTable.innerHTML = '<tr class="empty-row"><td colspan="5">کاربر آنلاینی وجود ندارد.</td></tr>';
      return;
    }
    els.peersTable.innerHTML = peers.map((peer) => `
      <tr>
        <td>${escapeHtml(rowIdentity(peer))}<br><small>${escapeHtml(peer.ip || '')}</small></td>
        <td class="mono">${escapeHtml(peer.clientId || peer.peerId || '-')}</td>
        <td class="mono">${escapeHtml(peer.fingerprint || '-')}</td>
        <td>${escapeHtml(formatDate(peer.lastSeenAt))}</td>
        <td>
          <div class="row-actions">
            <button class="warning" type="button" data-action="suspend" data-client-id="${escapeHtml(peer.clientId)}">
              <i class="fa-solid fa-pause"></i>
              تعلیق
            </button>
            <button class="danger" type="button" data-action="kick" data-client-id="${escapeHtml(peer.clientId)}">
              <i class="fa-solid fa-ban"></i>
              اخراج
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function renderPolicies(rows, target, action) {
    if (!rows.length) {
      target.innerHTML = '<tr class="empty-row"><td colspan="3">موردی وجود ندارد.</td></tr>';
      return;
    }
    target.innerHTML = rows.map((row) => {
      const permanent = row.permanent ? 'بدون محدودیت' : formatDate(row.expiresAt);
      const label = action === 'resume' ? 'رفع تعلیق' : 'رفع اخراج';
      return `
        <tr>
          <td>${escapeHtml(rowIdentity(row))}<br><small class="mono">${escapeHtml(row.key || '')}</small></td>
          <td>${escapeHtml(permanent)}</td>
          <td>
            <button class="secondary" type="button" data-action="${action}" data-key="${escapeHtml(row.key)}">
              <i class="fa-solid fa-unlock"></i>
              ${label}
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderBroadcastTargets(peers) {
    const current = els.broadcastTarget.value;
    els.broadcastTarget.innerHTML = '<option value="">همه کاربران آنلاین</option>' + peers.map((peer) => (
      `<option value="${escapeHtml(peer.clientId)}">${escapeHtml(rowIdentity(peer))}</option>`
    )).join('');
    if ([...els.broadcastTarget.options].some((option) => option.value === current)) {
      els.broadcastTarget.value = current;
    }
  }

  async function login(event) {
    event.preventDefault();
    const serverUrl = normalizeServerUrl(els.serverUrlInput.value);
    state.serverUrl = serverUrl;
    els.loginButton.disabled = true;
    setStatus('در حال اتصال...', false);
    try {
      const payload = await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password: els.passwordInput.value }),
      });
      state.token = payload.token;
      localStorage.setItem('poorija-monitor-server-url', state.serverUrl);
      localStorage.setItem('poorija-monitor-token', state.token);
      setStatus('اتصال برقرار شد.', true);
      await refresh();
      startPolling();
    } catch (error) {
      const remaining = error.payload?.remainingMs ? ` ${Math.ceil(error.payload.remainingMs / 60000)} دقیقه تا رفع قفل.` : '';
      setStatus(`${error.message}${remaining}`, false);
    } finally {
      els.loginButton.disabled = false;
    }
  }

  async function refresh() {
    const payload = await api(`/healthz?_t=${Date.now()}`);
    render(payload);
    setStatus('مانیتورینگ فعال است.', true);
  }

  function startPolling() {
    window.clearInterval(state.refreshTimer);
    state.refreshTimer = window.setInterval(() => {
      refresh().catch((error) => setStatus(error.message, false));
    }, 5000);
  }

  async function logout() {
    try {
      await api('/admin/logout', { method: 'POST' });
    } catch (_error) {
      // Token cleanup is local even if the remote endpoint is unreachable.
    }
    state.token = '';
    localStorage.removeItem('poorija-monitor-token');
    window.clearInterval(state.refreshTimer);
    els.dashboard.classList.add('hidden');
    setStatus('خارج شدید.', false);
  }

  function askDuration(title, allowPermanent) {
    const sample = allowPermanent
      ? 'برای اخراج بدون محدودیت عدد 0 یا permanent را وارد کنید.'
      : 'مدت زمان را به دقیقه وارد کنید.';
    const answer = window.prompt(`${title}\n${sample}`, allowPermanent ? '60' : '30');
    if (answer === null) return null;
    const normalized = answer.trim().toLowerCase();
    if (allowPermanent && ['0', 'permanent', 'always', 'forever', 'نامحدود'].includes(normalized)) {
      return { permanent: true, durationMinutes: 0 };
    }
    const minutes = Number(normalized);
    if (!Number.isFinite(minutes) || minutes < 1) {
      window.alert('مدت زمان معتبر نیست.');
      return null;
    }
    return { permanent: false, durationMinutes: Math.round(minutes) };
  }

  async function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    button.disabled = true;
    try {
      if (action === 'suspend') {
        const duration = askDuration('مدت تعلیق کاربر', false);
        if (!duration) return;
        await api('/admin/suspend-peer', {
          method: 'POST',
          body: JSON.stringify({
            clientId: button.dataset.clientId,
            durationMinutes: duration.durationMinutes,
          }),
        });
      } else if (action === 'kick') {
        const duration = askDuration('مدت اخراج کاربر', true);
        if (!duration) return;
        await api('/admin/kick-peer', {
          method: 'POST',
          body: JSON.stringify({
            clientId: button.dataset.clientId,
            permanent: duration.permanent,
            durationMinutes: duration.durationMinutes,
          }),
        });
      } else if (action === 'resume') {
        await api('/admin/resume-peer', {
          method: 'POST',
          body: JSON.stringify({ key: button.dataset.key }),
        });
      } else if (action === 'unkick') {
        await api('/admin/unkick-peer', {
          method: 'POST',
          body: JSON.stringify({ key: button.dataset.key }),
        });
      }
      await refresh();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('خواندن فایل ناموفق بود.'));
      reader.readAsDataURL(file);
    });
  }

  async function broadcast(event) {
    event.preventDefault();
    const file = els.broadcastFile.files?.[0] || null;
    const fileData = await readFileAsDataUrl(file);
    try {
      const payload = await api('/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({
          message: els.broadcastMessage.value.trim(),
          targetClientId: els.broadcastTarget.value || undefined,
          fileData,
          fileName: file?.name,
          kind: file ? (file.type.startsWith('audio/') ? 'audio' : 'file') : 'text',
        }),
      });
      showResult(els.broadcastResult, `${payload.sentTo || 0} کاربر دریافت کرد.`);
      els.broadcastMessage.value = '';
      els.broadcastFile.value = '';
    } catch (error) {
      showResult(els.broadcastResult, error.message, false);
    }
  }

  async function maintenance(path, label) {
    try {
      const payload = await api(path, { method: 'POST' });
      showResult(els.maintenanceResult, `${label}: OK`);
      await refresh();
      return payload;
    } catch (error) {
      showResult(els.maintenanceResult, error.message, false);
      return null;
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    try {
      await api('/admin/change-password', {
        method: 'POST',
        body: JSON.stringify({
          oldPassword: els.oldPasswordInput.value,
          newPassword: els.newPasswordInput.value,
        }),
      });
      state.token = base64Utf8(`admin:${els.newPasswordInput.value}`);
      localStorage.setItem('poorija-monitor-token', state.token);
      els.passwordInput.value = els.newPasswordInput.value;
      els.oldPasswordInput.value = '';
      els.newPasswordInput.value = '';
      showResult(els.passwordResult, 'رمز تغییر کرد.');
    } catch (error) {
      showResult(els.passwordResult, error.message, false);
    }
  }

  function restoreSession() {
    const serverUrl = localStorage.getItem('poorija-monitor-server-url') || '';
    const token = localStorage.getItem('poorija-monitor-token') || '';
    if (serverUrl) els.serverUrlInput.value = serverUrl;
    if (!serverUrl || !token) return;
    state.serverUrl = serverUrl;
    state.token = token;
    setStatus('در حال بازیابی نشست...', false);
    refresh()
      .then(() => startPolling())
      .catch(() => {
        state.token = '';
        localStorage.removeItem('poorija-monitor-token');
        setStatus('نشست قبلی معتبر نیست.', false);
      });
  }

  els.loginForm.addEventListener('submit', login);
  els.refreshButton.addEventListener('click', () => refresh().catch((error) => setStatus(error.message, false)));
  els.logoutButton.addEventListener('click', logout);
  els.peersTable.addEventListener('click', handleTableClick);
  els.suspendedTable.addEventListener('click', handleTableClick);
  els.kickedTable.addEventListener('click', handleTableClick);
  els.broadcastForm.addEventListener('submit', broadcast);
  els.clearOfflineButton.addEventListener('click', () => maintenance('/admin/clear-offline', 'صف آفلاین پاک شد'));
  els.optimizeRamButton.addEventListener('click', () => maintenance('/admin/optimize-ram', 'RAM بررسی شد'));
  els.clearMemoryButton.addEventListener('click', () => maintenance('/admin/clear-memory', 'نشست‌های مرده پاک شد'));
  els.passwordForm.addEventListener('submit', changePassword);
  restoreSession();
})();
