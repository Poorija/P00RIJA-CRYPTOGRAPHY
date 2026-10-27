/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* deploy.conf, edited by the panel. It is one list for the panel and for
 * scripts/deploy.sh, which sources it as shell, so every value is written
 * single-quoted (where the shell takes it literally) and a value that could
 * end the quote or the line is refused rather than escaped. Comments, other
 * servers and settings the panel does not know stay exactly as they were;
 * a server's lines are replaced in place, new ones go at the end, and every
 * write keeps a dated copy of what was there before.
 */
import fs from 'node:fs';
import path from 'node:path';

export const SERVER_KEYS = ['SSH_HOST', 'SSH_USER', 'SSH_PORT', 'SSH_KEY', 'REMOTE_DIR', 'PUBLIC_URL', 'REGION', 'GATEWAY', 'CLUSTER', 'INSIDE', 'JUMP', 'ROLE'];
export const validName = (name) => /^[a-z][a-z0-9]{0,11}$/.test(String(name || ''));
const prefix = (name) => `${String(name).toUpperCase()}_`;
const LINE = /^\s*([A-Z0-9_]+)=(?:'([^']*)'|"([^"]*)"|(\S*))\s*$/;

function quote(value) {
  const text = String(value ?? '');
  if (/['\n\r\0]/.test(text)) throw new Error(`a value cannot hold a quote or a line break (${text.slice(0, 40)})`);
  return `'${text}'`;
}

function serversOf(lines) {
  for (const line of lines) {
    const match = LINE.exec(line);
    if (match && match[1] === 'SERVERS') return String(match[2] ?? match[3] ?? match[4] ?? '').split(/\s+/).filter(Boolean);
  }
  return [];
}

function withServers(lines, names) {
  const value = `SERVERS=${quote(names.join(' '))}`;
  const at = lines.findIndex((line) => LINE.exec(line)?.[1] === 'SERVERS');
  if (at >= 0) { lines[at] = value; return lines; }
  return [value, ...lines];
}

export function readServers(text) {
  const lines = String(text || '').split('\n');
  const values = {};
  for (const line of lines) {
    const match = LINE.exec(line);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return serversOf(lines).map((name) => ({
    name,
    fields: Object.fromEntries(SERVER_KEYS.filter((key) => values[`${prefix(name)}${key}`] !== undefined).map((key) => [key, values[`${prefix(name)}${key}`]])),
  }));
}

/* The server's lines, replaced where they are; any not there yet appended. */
export function setServer(text, name, fields) {
  if (!validName(name)) throw new Error(`a server name is a lower-case letter then letters or digits, 12 at most (${name})`);
  const wanted = SERVER_KEYS.filter((key) => fields[key] !== undefined && String(fields[key]) !== '');
  const rendered = Object.fromEntries(wanted.map((key) => [key, `${prefix(name)}${key}=${quote(fields[key])}`]));
  const lines = String(text || '').replace(/\n+$/, '').split('\n');
  const placed = new Set();
  const out = [];
  for (const line of lines) {
    const key = LINE.exec(line)?.[1] || '';
    if (key.startsWith(prefix(name)) && SERVER_KEYS.includes(key.slice(prefix(name).length))) {
      const field = key.slice(prefix(name).length);
      if (rendered[field] && !placed.has(field)) { out.push(rendered[field]); placed.add(field); }
      continue;
    }
    out.push(line);
  }
  const missing = wanted.filter((key) => !placed.has(key));
  if (missing.length) out.push(...(placed.size ? [] : ['']), ...missing.map((key) => rendered[key]));
  const names = serversOf(out);
  return `${withServers(out, names.includes(name) ? names : [...names, name]).join('\n')}\n`;
}

export function removeServer(text, name) {
  const lines = String(text || '').replace(/\n+$/, '').split('\n')
    .filter((line) => { const key = LINE.exec(line)?.[1] || ''; return !(key.startsWith(prefix(name)) && SERVER_KEYS.includes(key.slice(prefix(name).length))); });
  return `${withServers(lines, serversOf(lines).filter((other) => other !== name)).join('\n')}\n`;
}

/* One field of one server; an empty value takes the line out. */
export function setField(text, name, key, value) {
  if (!SERVER_KEYS.includes(key)) throw new Error(`not a server setting: ${key}`);
  const current = readServers(text).find((server) => server.name === name);
  if (!current) throw new Error(`no server called ${name} in deploy.conf`);
  const fields = { ...current.fields, [key]: value };
  if (value === '' || value === undefined || value === null) delete fields[key];
  /* setServer only writes what it is given; a field emptied must also go. */
  const cleared = String(value ?? '') === ''
    ? String(text).split('\n').filter((line) => LINE.exec(line)?.[1] !== `${prefix(name)}${key}`).join('\n')
    : text;
  return setServer(cleared, name, fields);
}

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

/* A dated copy of what was there, then the new text in at once. */
export function writeConf(dir, text) {
  const file = path.join(dir, 'deploy.conf');
  if (fs.existsSync(file)) {
    let backup = path.join(dir, `deploy.conf.bak-${stamp()}`);
    for (let n = 1; fs.existsSync(backup); n += 1) backup = path.join(dir, `deploy.conf.bak-${stamp()}-${n}`);
    fs.copyFileSync(file, backup);
    fs.chmodSync(backup, 0o600);
  }
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, { mode: 0o600 });
  fs.renameSync(temp, file);
}
