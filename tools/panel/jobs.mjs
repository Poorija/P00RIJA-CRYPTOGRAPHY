/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Long work the panel runs for the page — installing a server, replacing
 * the operator key — as a process whose output the page reads by polling.
 * The output stays in memory for the page and is never written to the audit
 * log: an installer prints the new server's first password.
 */
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const jobs = new Map();
const KEEP_LINES = 2000;
const KEEP_JOBS = 20;

export function startJob(label, argv, { input = '', onDone } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, label, lines: [], done: false, code: null, startedAt: Date.now() };
  jobs.set(id, job);
  while (jobs.size > KEEP_JOBS) jobs.delete(jobs.keys().next().value);
  let partial = '';
  const take = (chunk) => {
    partial += String(chunk).replace(/\r/g, '\n');
    const parts = partial.split('\n');
    partial = parts.pop();
    job.lines.push(...parts.map((line) => line.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')));
    if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
  };
  const child = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  child.on('error', (error) => { job.lines.push(error.message); });
  child.on('close', (code) => {
    if (partial) job.lines.push(partial);
    job.done = true;
    job.code = code;
    onDone?.(job);
  });
  child.stdin.end(input);
  return id;
}

/* A job run in this process: a function given a line writer. */
export function startTask(label, work, { onDone } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const job = { id, label, lines: [], done: false, code: null, startedAt: Date.now() };
  jobs.set(id, job);
  while (jobs.size > KEEP_JOBS) jobs.delete(jobs.keys().next().value);
  Promise.resolve()
    .then(() => work((line) => { job.lines.push(String(line)); }))
    .then(() => { job.code = 0; }, (error) => { job.lines.push(`✗ ${error.message}`); job.code = 1; })
    .finally(() => { job.done = true; onDone?.(job); });
  return id;
}

export function jobView(id) {
  const job = jobs.get(String(id || ''));
  if (!job) return null;
  return { ok: true, id: job.id, label: job.label, done: job.done, code: job.code, lines: job.lines.slice(-KEEP_LINES) };
}
