#!/usr/bin/env node
/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The operator's side of a relay family: the operator key, the list of the
 * operator's relays, its signature, and handing it to the relays
 * (docs/RELAY-NETWORK.md, "Relay families").
 *
 * Runs on the operator's own machine and reads the servers from the same
 * settings file scripts/deploy.sh uses, so it works the same for whoever
 * self-hosts: nothing here names anybody's servers.
 *
 *   node tools/relay-directory.mjs init --name "My relays"
 *   node tools/relay-directory.mjs add <server> [--region inside-iran|outside-iran] [--gateway N] [--origin URL]
 *   node tools/relay-directory.mjs revoke <server|id>       # never again
 *   node tools/relay-directory.mjs remove <server|id>       # out, not revoked
 *   node tools/relay-directory.mjs admin-add <name> <public key>   # a computer that may sign dashboard actions
 *   node tools/relay-directory.mjs admin-remove <name>
 *   node tools/relay-directory.mjs show
 *   node tools/relay-directory.mjs sign
 *   node tools/relay-directory.mjs publish [server…]
 *   node tools/relay-directory.mjs sync                     # what deploy.sh runs
 *
 * The private key stays in this machine's settings folder, readable by its
 * owner only. It is never sent anywhere and never printed. Losing it means
 * signing a fresh family; leaking it means anybody can add a relay to this
 * family, so it is worth a backup somewhere safe.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { canonicalJson, operatorIdFor, signDirectory } = require('../scripts/lib/relay-directory.js');

const HEX64 = /^[a-f0-9]{64}$/;
const KEY_FILE = 'operator-key.json';
const DRAFT_FILE = 'relay-directory.draft.json';
const SIGNED_FILE = 'relay-directory.json';

export const configDir = () => process.env.POORIJA_CONFIG_DIR || path.join(os.homedir(), '.config', 'p00rija-cryptography');

/* deploy.conf is plain shell: NAME='value' lines. Only those are read; it is
   never executed. */
export function parseDeployConf(text) {
  const values = {};
  for (const line of String(text || '').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)=(?:'([^']*)'|"([^"]*)"|(\S*))\s*$/.exec(line);
    if (match) values[match[1]] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  const upper = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_');
  /* A deploy.conf without a SERVERS line is the one-server format the deploy
     has always read: its keys carry no prefix. It is a family of one here,
     called "server". */
  const single = !values.SERVERS && Boolean(values.SSH_HOST);
  return {
    servers: single ? ['server'] : String(values.SERVERS || '').split(/\s+/).filter(Boolean),
    fields: (name, key) => values[`${upper(name)}_${key}`] || (single ? values[key] || '' : ''),
  };
}

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_error) { return null; } };
const writePrivate = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

export function initKey(dir, name) {
  const file = path.join(dir, KEY_FILE);
  if (fs.existsSync(file)) throw new Error(`an operator key already exists at ${file}; it is not replaced`);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const id = operatorIdFor(spki);
  writePrivate(file, {
    name: String(name || 'operator'),
    id,
    publicKey: spki,
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    createdAt: new Date().toISOString(),
  });
  return { id, file };
}

export function loadState(dir) {
  return {
    dir,
    key: readJson(path.join(dir, KEY_FILE)),
    draft: readJson(path.join(dir, DRAFT_FILE)),
    signed: readJson(path.join(dir, SIGNED_FILE)),
  };
}

/* The draft is the list, the revoked ids and the admin keys; the signature
   adds the rest. */
export function applyEdit(draft, edit) {
  const next = { relays: [...(draft?.relays || [])], revoked: [...(draft?.revoked || [])], admins: [...(draft?.admins || [])] };
  /* A computer allowed to sign dangerous dashboard actions: its public key
     and a name the admin will recognise. */
  if (edit.op === 'admin-add') {
    const key = String(edit.admin?.key || '').trim();
    try {
      crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    } catch (_error) {
      throw new Error('an admin key is a P-256 public key, SPKI base64, as tools/control-panel.mjs prints it');
    }
    const entry = { id: operatorIdFor(key), key, name: String(edit.admin?.name || '').slice(0, 64) || operatorIdFor(key).slice(0, 12) };
    next.admins = next.admins.filter((admin) => admin.id !== entry.id && admin.name !== entry.name);
    next.admins.push(entry);
    return next;
  }
  if (edit.op === 'admin-remove') {
    next.admins = next.admins.filter((admin) => admin.name !== edit.name && admin.id !== edit.name);
    return next;
  }
  if (edit.op === 'add') {
    const relay = edit.relay;
    if (!HEX64.test(String(relay?.id || ''))) throw new Error('a relay id is 64 hex characters');
    if (next.revoked.includes(relay.id)) throw new Error(`${relay.id.slice(0, 12)}… is revoked and cannot come back; it needs a new identity`);
    const entry = {
      id: relay.id,
      name: String(relay.name || ''),
      origins: (relay.origins || []).map(String).filter(Boolean),
      region: String(relay.region || ''),
      gateway: Math.max(0, Math.floor(Number(relay.gateway) || 0)),
    };
    const at = next.relays.findIndex((existing) => existing.id === entry.id || (entry.name && existing.name === entry.name));
    if (at >= 0) next.relays[at] = entry; else next.relays.push(entry);
    return next;
  }
  if (edit.op === 'revoke' || edit.op === 'remove') {
    next.relays = next.relays.filter((relay) => relay.id !== edit.id);
    if (edit.op === 'revoke' && !next.revoked.includes(edit.id)) next.revoked.push(edit.id);
    return next;
  }
  throw new Error(`unknown edit ${edit.op}`);
}

export function signDraft(state) {
  if (!state.key) throw new Error('no operator key yet: run init first');
  const body = {
    v: 1,
    operator: { id: state.key.id, key: state.key.publicKey, name: state.key.name },
    serial: (state.signed?.body?.serial || 0) + 1,
    issuedAt: new Date().toISOString(),
    relays: state.draft?.relays || [],
    revoked: state.draft?.revoked || [],
    /* Only when there are any, so a family without admin keys signs exactly
       the directory it always did. */
    ...((state.draft?.admins || []).length ? { admins: state.draft.admins } : {}),
  };
  return signDirectory(body, crypto.createPrivateKey(state.key.privateKey));
}

/* ---- talking to the servers ---------------------------------------------- */

function loadDeployConf(dir) {
  const file = path.join(dir, 'deploy.conf');
  if (!fs.existsSync(file)) throw new Error(`no deployment settings at ${file}; run scripts/deploy.sh once first`);
  return parseDeployConf(fs.readFileSync(file, 'utf8'));
}

/* The script goes on stdin to `bash -s`, which works whatever the login
   shell is (fish included), and nothing secret is on a command line. */
function onServer(conf, name, script) {
  const host = conf.fields(name, 'SSH_HOST');
  if (!host) return { ok: false, out: `no ${name.toUpperCase()}_SSH_HOST in deploy.conf` };
  const args = ['-p', conf.fields(name, 'SSH_PORT') || '22', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15'];
  const key = conf.fields(name, 'SSH_KEY');
  if (key) args.push('-i', key, '-o', 'IdentitiesOnly=yes');
  args.push(`${conf.fields(name, 'SSH_USER') || os.userInfo().username}@${host}`, 'bash -s');
  const run = spawnSync('ssh', args, { input: script, encoding: 'utf8', timeout: 120000 });
  return { ok: run.status === 0, out: `${run.stdout || ''}${run.stderr || ''}`.trim() };
}
const remoteDir = (conf, name) => conf.fields(name, 'REMOTE_DIR') || '$HOME/work/pkg';

function relayIdOf(conf, name) {
  const answer = onServer(conf, name, 'curl -s -m 15 http://127.0.0.1:9000/relay-identity\n');
  const id = /"id":"([a-f0-9]{64})"/.exec(answer.out)?.[1];
  if (!id) throw new Error(`${name}: no relay identity (${answer.out.slice(0, 120) || 'no answer'})`);
  return id;
}

/* One trip per server: the operator key (and where to ask for the directory)
   into .env when missing, the relay recreated if .env changed, then the
   directory handed to its dashboard with the password from that .env. The
   password goes to curl in a file only its owner can read, never on a
   command line, where anybody on the server could read it in `ps`. */
export function deliveryScript(dirPath, doc, { sources = [] } = {}) {
  const b64 = Buffer.from(JSON.stringify(doc)).toString('base64');
  return `set -u
E="${dirPath}/.env"
[ -f "$E" ] || { echo "no .env at $E"; exit 1; }
changed=0
set_var() { if ! grep -q "^$1=$2\\$" "$E"; then cp -p "$E" "$E.bak-directory" 2>/dev/null; sed -i "/^$1=/d" "$E"; printf '%s=%s\\n' "$1" "$2" >> "$E"; changed=1; fi; }
set_var CHAT_OPERATOR_KEY '${doc.body.operator.key}'
${sources.length ? `grep -q "^CHAT_DIRECTORY_SOURCES=" "$E" || { printf 'CHAT_DIRECTORY_SOURCES=%s\\n' '${sources.join(',')}' >> "$E"; changed=1; }` : ''}
if [ "$changed" -eq 1 ]; then
  cd "${dirPath}"
  project="$(docker inspect Poorija-Cryptography_ChatSignal --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || echo config)"
  # What the deploy hands the relay on the command line, not in .env: the
  # host's install and backup paths (the dashboard's backups and jobs mount
  # them) and the version. Recreated without them, the relay loses both.
  version="$(sed -n 's/.*"version": *"\\([^"]*\\)".*/\\1/p' package.json 2>/dev/null | head -1)"
  OPS_INSTALL_DIR="$PWD" OPS_BACKUP_DIR="$PWD/backups" APP_VERSION="$version" \\
    docker compose -p "\${project:-config}" --env-file .env -f config/docker-compose.yaml up -d chat-signal >/dev/null 2>&1
  for _ in $(seq 1 30); do curl -s -m 3 http://127.0.0.1:9000/chat-health >/dev/null 2>&1 && break; sleep 1; done
  echo "relay restarted with the operator key"
fi
PW="$(sed -n 's/^MONITOR_PASSWORD=//p' "$E" | head -1 | tr -d "\\"'")"
USERNAME="$(sed -n 's/^MONITOR_USER=//p' "$E" | head -1 | tr -d "\\"'")"
PW="\${PW//\\\\/\\\\\\\\}"; PW="\${PW//\\"/\\\\\\"}"
CFG="$(umask 077; mktemp)"
chmod 600 "$CFG"
printf 'user = "%s:%s"\\n' "\${USERNAME:-admin}" "$PW" > "$CFG"
echo '${b64}' | base64 -d | curl -s -m 20 -K "$CFG" -H 'Content-Type: application/json' --data-binary @- http://127.0.0.1:9000/Monitor_Server/directory
rm -f "$CFG"
echo
`;
}

function deliver(conf, name, doc, options = {}) {
  return onServer(conf, name, deliveryScript(remoteDir(conf, name), doc, options));
}

/* ---- the commands ---------------------------------------------------------- */

function sameList(a, b) {
  const pick = (value) => ({ relays: value?.relays || [], revoked: value?.revoked || [] });
  return canonicalJson(pick(a)) === canonicalJson(pick(b));
}
const say = (line) => process.stdout.write(`${line}\n`);

function saveDraft(dir, draft) { writePrivate(path.join(dir, DRAFT_FILE), draft); }
function saveSigned(dir, doc) { writePrivate(path.join(dir, SIGNED_FILE), doc); }

export function serverEntry(conf, name, existing, flags = {}) {
  return {
    id: flags.id,
    name,
    origins: [flags.origin || conf.fields(name, 'PUBLIC_URL')].filter(Boolean),
    region: flags.region || conf.fields(name, 'REGION') || existing?.region || '',
    /* A lone server is its own gateway: without one it could never link
       with another operator's family. */
    gateway: flags.gateway ?? (conf.fields(name, 'GATEWAY') || existing?.gateway || (conf.servers.length === 1 ? 1 : 0)),
  };
}

function publishAll(dir, names, doc) {
  const conf = loadDeployConf(dir);
  let failures = 0;
  for (const name of names) {
    const others = conf.servers.filter((other) => other !== name).map((other) => conf.fields(other, 'PUBLIC_URL')).filter(Boolean);
    const result = deliver(conf, name, doc, { sources: others });
    const answer = /\{.*\}/s.exec(result.out)?.[0] || '';
    const verdict = (() => { try { return JSON.parse(answer); } catch (_error) { return null; } })();
    if (verdict?.ok) say(`  ${name}: directory ${verdict.serial} taken`);
    else if (verdict?.reason === 'stale') say(`  ${name}: already holds it`);
    else {
      failures += 1;
      say(`  ${name}: not delivered here (${verdict?.reason || result.out.split('\n').pop().slice(0, 100) || 'no answer'}); it will still arrive from the other relays`);
    }
  }
  return failures;
}

function sync(dir) {
  let state = loadState(dir);
  const conf = loadDeployConf(dir);
  if (!state.key) {
    const made = initKey(dir, process.env.POORIJA_OPERATOR_NAME || os.hostname().split('.')[0] || 'operator');
    say(`  made an operator key for this family: ${made.file}`);
    say('  Back this file up somewhere safe. Whoever holds it can add relays to your family; losing it means signing a new one.');
    state = loadState(dir);
  }
  let draft = state.draft || { relays: [], revoked: [] };
  for (const name of conf.servers) {
    let id;
    try { id = relayIdOf(conf, name); } catch (error) { say(`  ${error.message}; left out this time`); continue; }
    const existing = draft.relays.find((relay) => relay.id === id || relay.name === name);
    try { draft = applyEdit(draft, { op: 'add', relay: serverEntry(conf, name, existing, { id }) }); } catch (error) { say(`  ${name}: ${error.message}`); }
  }
  saveDraft(dir, draft);
  state = loadState(dir);
  let doc = state.signed;
  if (!doc || !sameList(state.draft, doc.body)) {
    doc = signDraft(state);
    saveSigned(dir, doc);
    say(`  signed directory ${doc.body.serial}: ${doc.body.relays.map((relay) => relay.name || relay.id.slice(0, 8)).join(', ')}`);
  } else {
    say(`  directory ${doc.body.serial} is current`);
  }
  return publishAll(dir, conf.servers, doc);
}

function main(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1]; i += 1; } else positional.push(rest[i]);
  }
  const dir = configDir();
  switch (command) {
    case 'init': {
      const made = initKey(dir, flags.name);
      say(`operator key made: ${made.file}\nid: ${made.id}\nBack this file up somewhere safe; it is never sent anywhere.`);
      return 0;
    }
    case 'add': {
      const conf = loadDeployConf(dir);
      const state = loadState(dir);
      const name = positional[0];
      if (!name) throw new Error('which server? (a name from deploy.conf)');
      const id = flags.id || relayIdOf(conf, name);
      const existing = state.draft?.relays?.find((relay) => relay.id === id || relay.name === name);
      saveDraft(dir, applyEdit(state.draft, { op: 'add', relay: serverEntry(conf, name, existing, { ...flags, id, gateway: flags.gateway }) }));
      say(`${name} (${id.slice(0, 12)}…) is in the draft; sign and publish to apply it`);
      return 0;
    }
    case 'revoke':
    case 'remove': {
      const state = loadState(dir);
      const target = positional[0];
      const relay = state.draft?.relays?.find((entry) => entry.name === target || entry.id === target);
      const id = relay?.id || (HEX64.test(String(target)) ? target : '');
      if (!id) throw new Error(`no relay called ${target} in the draft`);
      saveDraft(dir, applyEdit(state.draft, { op: command, id }));
      say(`${target}: ${command === 'revoke' ? 'revoked' : 'removed'} in the draft; sign and publish to apply it`);
      return 0;
    }
    case 'admin-add': {
      const state = loadState(dir);
      const [name, key] = positional;
      if (!name || !key) throw new Error('admin-add <name> <public key>, as tools/control-panel.mjs prints them');
      const next = applyEdit(state.draft, { op: 'admin-add', admin: { name, key } });
      saveDraft(dir, next);
      say(`admin ${name} (${next.admins.find((admin) => admin.name === name).id.slice(0, 12)}…) is in the draft; sign and publish to apply it`);
      return 0;
    }
    case 'admin-remove': {
      const state = loadState(dir);
      const name = positional[0];
      if (!name || !(state.draft?.admins || []).some((admin) => admin.name === name || admin.id === name)) throw new Error(`no admin called ${name} in the draft`);
      saveDraft(dir, applyEdit(state.draft, { op: 'admin-remove', name }));
      say(`admin ${name} removed in the draft; sign and publish to apply it`);
      return 0;
    }
    case 'show': {
      const state = loadState(dir);
      say(`operator: ${state.key ? `${state.key.name} ${state.key.id.slice(0, 16)}…` : 'none yet (run init)'}`);
      say(`signed: ${state.signed ? `serial ${state.signed.body.serial}, ${state.signed.body.issuedAt}` : 'nothing yet'}`);
      for (const relay of state.draft?.relays || []) say(`  ${relay.name.padEnd(8)} ${relay.id.slice(0, 16)}…  ${relay.region || '-'}  gateway ${relay.gateway || '-'}  ${relay.origins.join(' ') || '(dials out)'}`);
      for (const admin of state.draft?.admins || []) say(`  admin ${admin.name} ${admin.id.slice(0, 16)}…`);
      for (const id of state.draft?.revoked || []) say(`  revoked  ${id.slice(0, 16)}…`);
      if (state.signed && !sameList(state.draft, state.signed.body)) say('the draft differs from what is signed: run sign');
      return 0;
    }
    case 'sign': {
      const doc = signDraft(loadState(dir));
      saveSigned(dir, doc);
      say(`signed directory ${doc.body.serial}`);
      return 0;
    }
    case 'publish': {
      const state = loadState(dir);
      if (!state.signed) throw new Error('nothing signed yet: run sign');
      const conf = loadDeployConf(dir);
      return publishAll(dir, positional.length ? positional : conf.servers, state.signed) ? 1 : 0;
    }
    case 'sync':
      return sync(dir) ? 1 : 0;
    default:
      say('usage: node tools/relay-directory.mjs init|add|revoke|remove|show|sign|publish|sync (see the top of this file)');
      return command ? 2 : 0;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}
