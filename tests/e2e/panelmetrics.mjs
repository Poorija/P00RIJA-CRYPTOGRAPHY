/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's live graphs and its server preparation, without a server:
 *
 * - a reading is made of the numbers a relay's routes answer, and a server
 *   that did not answer is a reading of "down";
 * - rates come from the counters, per minute for messages and per second for
 *   bytes, and a relay that restarted (a counter going down) never gives a
 *   negative rate;
 * - the fine memory keeps two hours, the coarse one five-minute averages, saved
 *   to disk and read back by the next panel;
 * - a range longer than two hours is drawn from the coarse memory;
 * - the preparation script's answers are read, and the right Docker downloads
 *   are named for each kind of machine;
 * - the preparation script itself is valid shell.
 *
 *   node tests/e2e/panelmetrics.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const PREREQS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/lib/server-prereqs.sh');
import { readingFrom, withRates, coarsen, createMetrics } from '../../tools/panel/metrics.mjs';
import { parseFacts, archNames, newestStatic } from '../../tools/panel/provision.mjs';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const reading = readingFrom({
  health: { cpuLoad: 37, containerMem: { usageMb: 200, limitMb: 800 }, storage: { total: 1000, free: 250 }, peers: 12, activeCalls: 2 },
  traffic: { totals: { msgsIn: 10, msgsOut: 20, bytesIn: 3000, bytesOut: 4000, relays: 5 } },
  queues: { totals: { queued: 7, bytes: 900 } },
  transit: { status: { up: 3, allowed: 4 } },
});
check('a reading takes the numbers a relay answers', reading.up === 1 && reading.cpu === 37 && reading.memPct === 25 && reading.diskPct === 75 && reading.peers === 12
  && reading.calls === 2 && reading.linksUp === 3 && reading.queued === 7 && reading.relayed === 5, JSON.stringify(reading));
check('a server that did not answer is down', readingFrom({}).up === 0);
check('memory falls back to the process’s, in MB', readingFrom({ health: { memory: { rss: 120 }, memoryLimitMb: 600 } }).memMb === 120);

const rated = withRates([
  { t: 0, up: 1, msgsIn: 0, msgsOut: 0, bytesIn: 0, bytesOut: 0, relayed: 0 },
  { t: 60000, up: 1, msgsIn: 30, msgsOut: 60, bytesIn: 6000, bytesOut: 0, relayed: 0 },
  { t: 120000, up: 1, msgsIn: 5, msgsOut: 60, bytesIn: 6000, bytesOut: 0, relayed: 0 },
]);
check('messages per minute and bytes per second', rated[1].msgsInRate === 30 && rated[1].msgsOutRate === 60 && rated[1].bytesInRate === 100, JSON.stringify(rated[1]));
check('a relay that restarted gives no negative rate', rated[2].msgsInRate === 5 && rated[2].msgsOutRate === 0, JSON.stringify(rated[2]));
const averaged = coarsen([{ t: 0, cpu: 10, msgsIn: 1 }, { t: 1000, cpu: 30, msgsIn: 9 }], 300000);
check('the coarse memory averages a gauge and keeps a counter’s last value', averaged.length === 1 && averaged[0].cpu === 20 && averaged[0].msgsIn === 9, JSON.stringify(averaged));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p00rija-metrics-'));
const file = path.join(dir, 'metrics.json');
let clock = Date.parse('2026-11-01T00:00:00Z');
let cpu = 0;
const list = [{ name: 'a' }, { name: 'b' }];
const metrics = createMetrics({ servers: () => list, read: async (server) => (server.name === 'b' ? { up: 0 } : { up: 1, cpu: (cpu += 1) }), file, now: () => clock });
for (let step = 0; step < 60; step += 1) { await metrics.sample(); clock += 20000; }
const hour = metrics.series('1h');
const a = hour.servers.find((entry) => entry.name === 'a');
const b = hour.servers.find((entry) => entry.name === 'b');
check('a series for every server, readings every twenty seconds', a && b && a.points.length >= 59 && hour.step === 20000, `${a?.points.length} points`);
check('a server down is drawn as down, not left out', b.points.every((point) => point.up === 0));
metrics.save();
const again = createMetrics({ servers: () => list, read: async () => ({ up: 1 }), file, now: () => clock });
const day = again.series('24h');
check('the coarse memory is saved and read back by the next panel', day.step === 300000 && day.servers.find((entry) => entry.name === 'a').points.length >= 3, JSON.stringify(day.servers.map((entry) => entry.points.length)));
fs.rmSync(dir, { recursive: true, force: true });

const facts = parseFacts(['▶ This server', 'need=docker-static', 'need=compose', 'arch=x86_64', 'os=ubuntu 24.04']);
check('the preparation script’s answers are read', facts.arch === 'x86_64' && facts.needs.join() === 'docker-static,compose' && facts.os === 'ubuntu 24.04', JSON.stringify(facts));
check('Docker’s downloads are named for each machine', archNames('x86_64').docker === 'x86_64' && archNames('aarch64').compose === 'aarch64' && archNames('armv7l').docker === 'armhf' && archNames('mips') === null);
check('the newest static Docker is picked from a listing', newestStatic('<a>docker-27.5.1.tgz</a><a>docker-28.0.4.tgz</a><a>docker-28.0.10.tgz</a><a>docker-rootless-extras-29.0.0.tgz</a>') === 'docker-28.0.10.tgz');
const syntax = spawnSync('bash', ['-n', PREREQS], { encoding: 'utf8' });
check('the preparation script is valid shell', syntax.status === 0, syntax.stderr.trim());
const report = spawnSync('bash', [PREREQS, '--check'], { encoding: 'utf8' });
check('and reports what is there, as key=value lines, changing nothing', report.status === 0 && /^arch=/m.test(report.stdout) && /^docker=/m.test(report.stdout), report.stdout.slice(0, 200));

const failed = results.filter((ok) => !ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
