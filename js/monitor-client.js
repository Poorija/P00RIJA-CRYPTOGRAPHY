(function () {
  const state = {
    serverUrl: '',
    token: '',
    refreshTimer: null,
    latest: null,
    charts: {},
    history: {
      labels: [],
      memory: [],
      cpu: [],
      suspended: [],
      bytesIn: [],
      bytesOut: [],
      msgsIn: [],
      msgsOut: [],
      storage: [],
      queue: [],
    },
    lastTraffic: {
      bytesIn: 0,
      bytesOut: 0,
      msgsIn: 0,
      msgsOut: 0,
    },
    currentPeers: [],
    activePolicyResolve: null,
  };

  const MAX_CHART_POINTS = 60;

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
    refreshIntervalSelect: $('refreshIntervalSelect'),
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
    monitorLanguageSelect: $('monitorLanguageSelect'),
    monitorThemeSelect: $('monitorThemeSelect'),
    monitorFontSelect: $('monitorFontSelect'),
    monitorFontSizeSelect: $('monitorFontSizeSelect'),
    identityModal: $('identityModal'),
    identityCloseButton: $('identityCloseButton'),
    identityUser: $('identityUser'),
    identityClientId: $('identityClientId'),
    identityPeerId: $('identityPeerId'),
    identityFingerprint: $('identityFingerprint'),
    identityIp: $('identityIp'),
    policyModal: $('policyModal'),
    policyCloseButton: $('policyCloseButton'),
    policyCancelButton: $('policyCancelButton'),
    policySubmitButton: $('policySubmitButton'),
    policyModalTitle: $('policyModalTitle'),
    policyDays: $('policyDays'),
    policyHours: $('policyHours'),
    policyMinutes: $('policyMinutes'),
    policySeconds: $('policySeconds'),
    policyPermanentWrapper: $('policyPermanentWrapper'),
    policyPermanent: $('policyPermanent'),
  };

  const chartSpecs = {
    memoryChart: { keys: ['memory'], labels: ['RAM (MB)'], colors: ['#0ea5e9'], max: 512 },
    cpuChart: { keys: ['cpu'], labels: ['CPU (%)'], colors: ['#6366f1'], max: 100 },
    suspendedChart: { keys: ['suspended'], labels: ['Suspended Users'], colors: ['#fbbf24'], max: 10 },
    networkChart: { keys: ['bytesIn', 'bytesOut'], labels: ['Bytes In', 'Bytes Out'], colors: ['#38bdf8', '#818cf8'], max: 1024 },
    throughputChart: { keys: ['msgsIn', 'msgsOut'], labels: ['Msgs In', 'Msgs Out'], colors: ['#34d399', '#fbbf24'], max: 20 },
    storageChart: { keys: ['storage'], labels: ['Storage (%)'], colors: ['#10b981'], max: 100 },
    queueChart: { keys: ['queue'], labels: ['Queue'], colors: ['#f43f5e'], max: 50 },
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

  function applyAppearance() {
    const saved = loadAppearance();
    const theme = els.monitorThemeSelect?.value || saved.theme || 'dark';
    const font = els.monitorFontSelect?.value || saved.font || 'Vazirmatn';
    const size = els.monitorFontSizeSelect?.value || saved.size || '16px';
    const lang = els.monitorLanguageSelect?.value || saved.lang || 'fa';

    document.documentElement.classList.remove(
      'monitor-theme-dark',
      'monitor-theme-midnight',
      'monitor-theme-nord',
      'monitor-theme-dracula',
      'monitor-theme-linen'
    );
    document.documentElement.classList.add(`monitor-theme-${theme}`);
    document.documentElement.style.setProperty('--monitor-font', font);
    document.documentElement.style.setProperty('--monitor-font-size', size);
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.body.dir = lang === 'fa' ? 'rtl' : 'ltr';
    localStorage.setItem('monitor_appearance_v1', JSON.stringify({ theme, font, size, lang }));
    redrawCharts();
  }

  function loadAppearance() {
    try {
      return JSON.parse(localStorage.getItem('monitor_appearance_v1') || '{}') || {};
    } catch (_error) {
      return {};
    }
  }

  function restoreAppearance() {
    const saved = loadAppearance();
    if (els.monitorThemeSelect && saved.theme) els.monitorThemeSelect.value = saved.theme;
    if (els.monitorFontSelect && saved.font) els.monitorFontSelect.value = saved.font;
    if (els.monitorFontSizeSelect && saved.size) els.monitorFontSizeSelect.value = saved.size;
    if (els.monitorLanguageSelect && saved.lang) els.monitorLanguageSelect.value = saved.lang;
    applyAppearance();
  }

  function initCharts() {
    state.charts = Object.fromEntries(Object.entries(chartSpecs).map(([id, spec]) => [
      id,
      { canvas: $(id), spec },
    ]).filter(([, chart]) => chart.canvas));
    window.addEventListener('resize', () => redrawCharts());
  }

  function canvasColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

  function fitCanvas(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(280, Math.floor(rect.width || canvas.parentElement?.clientWidth || 320));
    const height = Math.max(160, Math.floor(rect.height || 180));
    const pixelWidth = Math.floor(width * ratio);
    const pixelHeight = Math.floor(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { ctx, width, height };
  }

  function drawChart(canvas, spec) {
    const { ctx, width, height } = fitCanvas(canvas);
    const text = canvasColor('--text', '#f8fafc');
    const muted = canvasColor('--muted', '#94a3b8');
    const line = canvasColor('--line', 'rgba(255,255,255,.12)');
    const labels = state.history.labels;
    const datasets = spec.keys.map((key, index) => ({
      values: state.history[key],
      label: spec.labels[index],
      color: spec.colors[index],
    }));
    const allValues = datasets.flatMap((dataset) => dataset.values).map(Number).filter(Number.isFinite);
    const maxValue = Math.max(spec.max || 1, allValues.length ? Math.max(...allValues) : 0, 1);
    const pad = { top: 20, right: 14, bottom: 30, left: 42 };
    const plotW = Math.max(1, width - pad.left - pad.right);
    const plotH = Math.max(1, height - pad.top - pad.bottom);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'transparent';
    ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i += 1) {
      const y = pad.top + (plotH * i / 4);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(width - pad.right, y);
      ctx.stroke();
      ctx.fillText(String(Math.round(maxValue - (maxValue * i / 4))), 4, y);
    }

    datasets.forEach((dataset) => {
      const values = dataset.values.map(Number);
      const color = dataset.color;
      if (values.length < 2) return;
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = pad.left + (values.length === 1 ? 0 : plotW * index / (values.length - 1));
        const y = pad.top + plotH - ((Number.isFinite(value) ? value : 0) / maxValue) * plotH;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
      gradient.addColorStop(0, `${color}33`);
      gradient.addColorStop(1, `${color}00`);
      ctx.lineTo(width - pad.right, height - pad.bottom);
      ctx.lineTo(pad.left, height - pad.bottom);
      ctx.closePath();
      ctx.fillStyle = gradient;
      ctx.fill();
    });

    if (labels.length) {
      ctx.fillStyle = muted;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillText(String(labels[0]), pad.left, height - 8);
      ctx.textAlign = 'right';
      ctx.fillText(String(labels[labels.length - 1]), width - pad.right, height - 8);
    } else {
      ctx.fillStyle = muted;
      ctx.textAlign = 'center';
      ctx.fillText('در انتظار داده', width / 2, height / 2);
    }

    if (datasets.length > 1) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      datasets.forEach((dataset, index) => {
        const x = pad.left + (index * 82);
        ctx.fillStyle = dataset.color;
        ctx.fillRect(x, 4, 8, 8);
        ctx.fillStyle = text;
        ctx.fillText(dataset.label, x + 12, 3);
      });
    }
  }

  function redrawCharts() {
    Object.values(state.charts).forEach(({ canvas, spec }) => drawChart(canvas, spec));
  }

  function pushBounded(key, value) {
    state.history[key].push(value);
    if (state.history[key].length > MAX_CHART_POINTS) state.history[key].shift();
  }

  function updateCharts(data) {
    const traffic = data.traffic || {};
    const memory = data.memory || {};
    const storage = data.storage || null;
    const time = new Date().toLocaleTimeString(document.documentElement.lang === 'fa' ? 'fa-IR' : 'en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const delta = (key) => {
      const current = Number(traffic[key] || 0);
      const previous = Number(state.lastTraffic[key] || 0);
      state.lastTraffic[key] = current;
      return previous > 0 ? Math.max(0, current - previous) : 0;
    };

    pushBounded('labels', time);
    pushBounded('memory', Number(memory.heapUsed || 0));
    pushBounded('cpu', Number(data.cpuLoad || 0));
    pushBounded('suspended', Array.isArray(data.suspendedUsers) ? data.suspendedUsers.length : 0);
    pushBounded('bytesIn', delta('bytesIn'));
    pushBounded('bytesOut', delta('bytesOut'));
    pushBounded('msgsIn', delta('msgsIn'));
    pushBounded('msgsOut', delta('msgsOut'));
    pushBounded('storage', storage && storage.total ? Math.round(((storage.total - storage.free) / storage.total) * 100) : 0);
    pushBounded('queue', Number(data.queuedMessages || 0));
    redrawCharts();
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
    updateCharts(data);
  }

  function renderPeers(peers) {
    state.currentPeers = peers;
    if (!peers.length) {
      els.peersTable.innerHTML = '<tr class="empty-row"><td colspan="4">کاربر آنلاینی وجود ندارد.</td></tr>';
      return;
    }
    els.peersTable.innerHTML = peers.map((peer, index) => `
      <tr>
        <td>${escapeHtml(rowIdentity(peer))}<br><small>${escapeHtml(peer.ip || '')}</small></td>
        <td>
          <button class="identity-button" type="button" data-action="identity" data-peer-index="${index}">
            <i class="fa-solid fa-id-card"></i>
            نمایش شناسه و Fingerprint
          </button>
        </td>
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

  function setIdentityText(el, value) {
    if (!el) return;
    el.textContent = value || '-';
  }

  function showIdentity(peer) {
    if (!peer || !els.identityModal) return;
    setIdentityText(els.identityUser, rowIdentity(peer));
    setIdentityText(els.identityClientId, peer.clientId || '-');
    setIdentityText(els.identityPeerId, peer.peerId || '-');
    setIdentityText(els.identityFingerprint, peer.fingerprint || '-');
    setIdentityText(els.identityIp, peer.ip || '-');
    els.identityModal.classList.remove('hidden');
  }

  function hideIdentity() {
    els.identityModal?.classList.add('hidden');
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
    const interval = Number(els.refreshIntervalSelect?.value || localStorage.getItem('poorija-monitor-refresh-ms') || 2000);
    state.refreshTimer = window.setInterval(() => {
      refresh().catch((error) => setStatus(error.message, false));
    }, Number.isFinite(interval) && interval >= 1000 ? interval : 2000);
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

  function closePolicyModal(result = null) {
    els.policyModal?.classList.add('hidden');
    const resolve = state.activePolicyResolve;
    state.activePolicyResolve = null;
    if (resolve) resolve(result);
  }

  function updatePolicyInputs() {
    const disabled = !els.policyPermanentWrapper?.classList.contains('hidden') && els.policyPermanent?.checked;
    [els.policyDays, els.policyHours, els.policyMinutes, els.policySeconds]
      .filter(Boolean)
      .forEach((input) => { input.disabled = disabled; });
  }

  function askDuration(title, allowPermanent) {
    return new Promise((resolve) => {
      if (!els.policyModal) {
        resolve(null);
        return;
      }
      if (state.activePolicyResolve) state.activePolicyResolve(null);
      state.activePolicyResolve = resolve;
      els.policyModalTitle.textContent = title;
      els.policyDays.value = '0';
      els.policyHours.value = '0';
      els.policyMinutes.value = allowPermanent ? '60' : '30';
      els.policySeconds.value = '0';
      els.policyPermanent.checked = false;
      els.policyPermanentWrapper.classList.toggle('hidden', !allowPermanent);
      updatePolicyInputs();
      els.policyModal.classList.remove('hidden');
    });
  }

  function submitPolicyModal() {
    if (!els.policyModal || els.policyModal.classList.contains('hidden')) return;
    const allowPermanent = !els.policyPermanentWrapper.classList.contains('hidden');
    if (allowPermanent && els.policyPermanent.checked) {
      closePolicyModal({ permanent: true, durationMinutes: 0, durationMs: 0 });
      return;
    }
    const days = Number(els.policyDays.value || 0);
    const hours = Number(els.policyHours.value || 0);
    const minutes = Number(els.policyMinutes.value || 0);
    const seconds = Number(els.policySeconds.value || 0);
    const durationMs = (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      window.alert('مدت زمان معتبر نیست.');
      return;
    }
    closePolicyModal({
      permanent: false,
      durationMinutes: Math.max(1, Math.ceil(durationMs / 60000)),
      durationMs,
    });
  }

  async function handleTableClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'identity') {
      showIdentity(state.currentPeers[Number(button.dataset.peerIndex)]);
      return;
    }
    button.disabled = true;
    try {
      if (action === 'suspend') {
        const duration = await askDuration('مدت تعلیق کاربر', false);
        if (!duration) return;
        await api('/admin/suspend-peer', {
          method: 'POST',
          body: JSON.stringify({
            clientId: button.dataset.clientId,
            durationMinutes: duration.durationMinutes,
            durationMs: duration.durationMs,
          }),
        });
      } else if (action === 'kick') {
        const duration = await askDuration('مدت اخراج کاربر', true);
        if (!duration) return;
        await api('/admin/kick-peer', {
          method: 'POST',
          body: JSON.stringify({
            clientId: button.dataset.clientId,
            permanent: duration.permanent,
            durationMinutes: duration.durationMinutes,
            durationMs: duration.durationMs,
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
  els.refreshIntervalSelect?.addEventListener('change', () => {
    localStorage.setItem('poorija-monitor-refresh-ms', els.refreshIntervalSelect.value);
    if (state.token) startPolling();
  });
  els.logoutButton.addEventListener('click', logout);
  els.peersTable.addEventListener('click', handleTableClick);
  els.identityCloseButton?.addEventListener('click', hideIdentity);
  els.identityModal?.addEventListener('click', (event) => {
    if (event.target === els.identityModal) hideIdentity();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideIdentity();
      closePolicyModal(null);
    }
  });
  els.policyCloseButton?.addEventListener('click', () => closePolicyModal(null));
  els.policyCancelButton?.addEventListener('click', () => closePolicyModal(null));
  els.policySubmitButton?.addEventListener('click', submitPolicyModal);
  els.policyPermanent?.addEventListener('change', updatePolicyInputs);
  els.policyModal?.addEventListener('click', (event) => {
    if (event.target === els.policyModal) closePolicyModal(null);
  });
  els.suspendedTable.addEventListener('click', handleTableClick);
  els.kickedTable.addEventListener('click', handleTableClick);
  els.broadcastForm.addEventListener('submit', broadcast);
  els.clearOfflineButton.addEventListener('click', () => maintenance('/admin/clear-offline', 'صف آفلاین پاک شد'));
  els.optimizeRamButton.addEventListener('click', () => maintenance('/admin/optimize-ram', 'RAM بررسی شد'));
  els.clearMemoryButton.addEventListener('click', () => maintenance('/admin/clear-memory', 'نشست‌های مرده پاک شد'));
  els.passwordForm.addEventListener('submit', changePassword);
  [
    els.monitorLanguageSelect,
    els.monitorThemeSelect,
    els.monitorFontSelect,
    els.monitorFontSizeSelect,
  ].filter(Boolean).forEach((el) => el.addEventListener('change', applyAppearance));
  restoreAppearance();
  if (els.refreshIntervalSelect) {
    els.refreshIntervalSelect.value = localStorage.getItem('poorija-monitor-refresh-ms') || '2000';
  }
  initCharts();
  restoreSession();
})();
