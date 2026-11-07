/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The live graphs of the overview and the traffic section: every server read
 * every so often, and what it said kept as numbers.
 *
 * Two memories: a fine one (a reading every `fineMs`, the last two hours) and
 * a coarse one (one averaged point per five minutes, the last seven days, kept
 * on disk so a restart of the panel does not lose the week). The fine reads
 * happen only while someone has the panel open; otherwise a reading every
 * five minutes keeps the coarse memory going.
 *
 * A relay counts messages and bytes from its start; a rate is the difference
 * of two readings, and a counter that went down (the relay restarted) starts
 * again from zero instead of giving a negative rate. */

import fs from 'node:fs';

const FINE_KEEP_MS = 2 * 60 * 60 * 1000;
const COARSE_STEP_MS = 5 * 60 * 1000;
const COARSE_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const COUNTERS = ['msgsIn', 'msgsOut', 'bytesIn', 'bytesOut', 'relayed'];
export const FIELDS = ['up', 'cpu', 'memMb', 'memLimitMb', 'memPct', 'diskPct', 'peers', 'calls', 'linksUp', 'linksAllowed', 'queued', 'queuedBytes', ...COUNTERS];
const RANGES = { '15m': 15 * 60 * 1000, '1h': 60 * 60 * 1000, '2h': FINE_KEEP_MS, '6h': 6 * 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '7d': COARSE_KEEP_MS };

const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);

/* One reading of one server, from what its routes answered. */
export function readingFrom({ health, traffic, queues, transit } = {}) {
  if (!health) return { up: 0 };
  const mem = health.containerMem || {};
  const memMb = n(mem.usageMb) || n(health.memory?.rss);
  const memLimitMb = n(mem.limitMb) || n(health.memoryLimitMb);
  const total = n(health.storage?.total);
  const reading = {
    up: 1,
    cpu: Array.isArray(health.cpuLoad) ? n(health.cpuLoad[0]) : n(health.cpuLoad),
    memMb,
    memLimitMb,
    memPct: memLimitMb ? Math.round((memMb / memLimitMb) * 100) : 0,
    diskPct: total ? Math.round(((total - n(health.storage?.free)) / total) * 100) : 0,
    peers: n(typeof health.peers === 'object' ? health.peers?.length : health.peers),
    calls: n(health.activeCalls),
    linksUp: n(transit?.status?.up),
    linksAllowed: n(transit?.status?.allowed),
    queued: n(queues?.totals?.queued),
    queuedBytes: n(queues?.totals?.bytes),
  };
  for (const key of COUNTERS) reading[key] = n(traffic?.totals?.[key === 'relayed' ? 'relays' : key]);
  return reading;
}

/* Rates from counters: per minute for messages, per second for bytes. */
export function withRates(points) {
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const before = points[index - 1];
    const rates = {};
    for (const key of COUNTERS) {
      if (!before || !point.up || !before.up) { rates[`${key}Rate`] = 0; continue; }
      const seconds = Math.max(1, (point.t - before.t) / 1000);
      const delta = n(point[key]) - n(before[key]);
      const per = key.startsWith('bytes') ? seconds : seconds / 60;
      rates[`${key}Rate`] = delta >= 0 ? Math.round((delta / per) * 10) / 10 : Math.round((n(point[key]) / per) * 10) / 10;
    }
    out.push({ ...point, ...rates });
  }
  return out;
}

/* Fine points averaged into one per step (counters keep their last value). */
export function coarsen(points, step = COARSE_STEP_MS) {
  const buckets = new Map();
  for (const point of points) {
    const at = Math.floor(point.t / step) * step;
    if (!buckets.has(at)) buckets.set(at, []);
    buckets.get(at).push(point);
  }
  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, group]) => {
    const point = { t };
    for (const key of FIELDS) {
      point[key] = COUNTERS.includes(key) ? n(group[group.length - 1][key])
        : Math.round((group.reduce((sum, entry) => sum + n(entry[key]), 0) / group.length) * 10) / 10;
    }
    return point;
  });
}

/* At most `max` points: each bucket averaged (rates and gauges), a counter
   its last value — a long range is drawn with as many points as a chart has
   room for, not thousands. */
export function thin(points, max = 400) {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / max);
  const out = [];
  for (let at = 0; at < points.length; at += size) {
    const group = points.slice(at, at + size);
    const point = { t: group[group.length - 1].t };
    for (const key of Object.keys(group[0])) {
      if (key === 't') continue;
      point[key] = COUNTERS.includes(key) ? n(group[group.length - 1][key]) : Math.round((group.reduce((sum, entry) => sum + n(entry[key]), 0) / group.length) * 10) / 10;
    }
    out.push(point);
  }
  return out;
}
export const PACES = [1000, 3000, 5000, 10000, 30000, 60000];

export function createMetrics({ servers, read, file = '', fineMs = 20000, idleMs = COARSE_STEP_MS, activeWindowMs = 15 * 60 * 1000, heavyMs = 5000, now = () => Date.now() }) {
  const fine = new Map();
  const coarse = new Map();
  let lastWanted = 0;
  let pace = fineMs;
  let lastHeavy = 0;
  let timer = null;
  let busy = false;
  let lastSaved = 0;

  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [name, points] of Object.entries(saved.coarse || {})) if (Array.isArray(points)) coarse.set(name, points.filter((point) => Number.isFinite(point?.t)));
    } catch (_error) { /* a first start */ }
  }

  function save() {
    if (!file) return;
    try {
      fs.writeFileSync(`${file}.part`, JSON.stringify({ v: 1, coarse: Object.fromEntries(coarse) }), { mode: 0o600 });
      fs.renameSync(`${file}.part`, file);
      lastSaved = now();
    } catch (_error) { /* the next save tries again */ }
  }

  function keep(name, point) {
    const list = fine.get(name) || [];
    list.push(point);
    const cut = point.t - FINE_KEEP_MS;
    while (list.length && list[0].t < cut) list.shift();
    fine.set(name, list);
    /* The coarse memory takes every finished five minutes once. */
    const done = Math.floor(point.t / COARSE_STEP_MS) * COARSE_STEP_MS;
    const old = coarse.get(name) || [];
    const lastAt = old.length ? old[old.length - 1].t : 0;
    const finished = list.filter((entry) => entry.t >= lastAt + COARSE_STEP_MS && entry.t < done);
    if (finished.length) {
      old.push(...coarsen(finished));
      const keepFrom = point.t - COARSE_KEEP_MS;
      while (old.length && old[0].t < keepFrom) old.shift();
      coarse.set(name, old);
    } else if (!old.length && list.length === 1) {
      coarse.set(name, old);
    }
  }

  async function sample() {
    if (busy) return;
    busy = true;
    try {
      const at = now();
      const list = servers();
      /* At a fast pace only the light read every time; the heavy ones (traffic,
         queues, links) every few seconds, the server keeping the last. */
      const full = at - lastHeavy >= Math.max(heavyMs, 0) || pace >= heavyMs;
      if (full) lastHeavy = at;
      await Promise.all(list.map(async (server) => {
        let reading;
        try { reading = await read(server, { full }); } catch (_error) { reading = { up: 0 }; }
        keep(server.name, { t: at, ...Object.fromEntries(FIELDS.map((key) => [key, n(reading?.[key])])) });
      }));
      /* Servers no longer listed drop out of the fine memory; the week stays. */
      const names = new Set(list.map((server) => server.name));
      for (const name of fine.keys()) if (!names.has(name)) fine.delete(name);
      if (now() - lastSaved > COARSE_STEP_MS) save();
    } finally {
      busy = false;
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    const active = now() - lastWanted < activeWindowMs;
    if (!active) pace = fineMs;
    timer = setTimeout(async () => { await sample(); schedule(); }, active ? pace : idleMs);
    timer.unref?.();
  }

  /* Someone looked: read at the pace they chose (1 s to 1 min), for a while. */
  function wanted(asked = fineMs) {
    const wasIdle = now() - lastWanted >= activeWindowMs;
    const next = PACES.includes(Number(asked)) ? Number(asked) : fineMs;
    const faster = next < pace;
    lastWanted = now();
    pace = next;
    if (wasIdle || faster) { sample().catch(() => {}); schedule(); }
  }

  function series(rangeName = '1h', { fields = null, maxPoints = 400 } = {}) {
    const span = RANGES[rangeName] || RANGES['1h'];
    const from = now() - span;
    const useFine = span <= FINE_KEEP_MS;
    const names = new Set([...servers().map((server) => server.name)]);
    const out = [];
    for (const name of names) {
      const source = useFine ? (fine.get(name) || []) : [...(coarse.get(name) || []), ...coarsen((fine.get(name) || []).filter((point) => point.t > ((coarse.get(name) || []).slice(-1)[0]?.t || 0) + COARSE_STEP_MS))];
      let points = withRates(source.filter((point) => point.t >= from - (useFine ? fineMs : COARSE_STEP_MS))).filter((point) => point.t >= from);
      if (Array.isArray(fields) && fields.length) points = points.map((point) => Object.fromEntries([['t', point.t], ...fields.filter((key) => key in point).map((key) => [key, point[key]])]));
      out.push({ name, points: thin(points, Math.max(20, Math.min(2000, maxPoints))) });
    }
    return { ok: true, range: RANGES[rangeName] ? rangeName : '1h', step: useFine ? pace : COARSE_STEP_MS, pace, from, to: now(), servers: out };
  }

  return {
    start() { schedule(); sample().catch(() => {}); },
    stop() { if (timer) clearTimeout(timer); timer = null; save(); },
    wanted, sample, series, save,
    ranges: Object.keys(RANGES),
  };
}
