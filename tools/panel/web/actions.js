/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* Everything a relay's own dashboard reads and does
 * (scripts/lib/monitor-dashboard.js), as the central panel reads and does it
 * for every server. The suite compares this list with the dashboard's calls:
 * a dashboard action missing here is a fault.
 *
 * scope: "row" acts on one row of a table (a user, a mailbox, a backup);
 * "server" on one server; "group" on every server shown at once, one after
 * another ("oneByOne" stops at the first that fails). label and confirm are
 * keys of strings.js. */

export const READS = [
  { path: '/healthz', method: 'GET' },
  { path: '/admin/allowlist', method: 'GET' },
  { path: '/Monitor_Server/queues' },
  { path: '/Monitor_Server/queue-mailbox' },
  { path: '/Monitor_Server/expiry-log' },
  { path: '/Monitor_Server/identities' },
  { path: '/Monitor_Server/transit' },
  { path: '/Monitor_Server/partners' },
  { path: '/Monitor_Server/partners/lookup' },
  { path: '/Monitor_Server/traffic' },
  { path: '/Monitor_Server/reports' },
  { path: '/Monitor_Server/ops-memory' },
  { path: '/Monitor_Server/ops-disk' },
  { path: '/Monitor_Server/ops-backup-list' },
  { path: '/Monitor_Server/ops-images' },
  { path: '/Monitor_Server/ops-github-check' },
  { path: '/Monitor_Server/ops-status' },
];

export const ACTIONS = {
  /* message queues */
  'queue-drop': { path: '/Monitor_Server/queue-drop', scope: 'row', label: 'del', confirm: 'confirmDelete' },
  'queue-drop-item': { path: '/Monitor_Server/queue-drop', scope: 'row', label: 'del' },
  'queue-flush': { path: '/Monitor_Server/queue-flush', scope: 'group', label: 'flushQueues' },
  'clear-offline': { path: '/admin/clear-offline', scope: 'group', label: 'clearOffline', confirm: 'confirmClearOffline' },
  /* users */
  'kick-peer': { path: '/admin/kick-peer', scope: 'row', label: 'kick' },
  'suspend-peer': { path: '/admin/suspend-peer', scope: 'row', label: 'suspend' },
  'resume-peer': { path: '/admin/resume-peer', scope: 'row', label: 'resume' },
  'unkick-peer': { path: '/admin/unkick-peer', scope: 'row', label: 'unkick' },
  'allowlist-mode': { path: '/admin/allowlist-mode', scope: 'server', label: 'allowlistToggle', confirm: 'confirmAllowlistMode' },
  'allowlist-add': { path: '/admin/allowlist-add', scope: 'group', label: 'allowlistAdd' },
  'allowlist-remove': { path: '/admin/allowlist-remove', scope: 'row', label: 'del', confirm: 'confirmDelete' },
  broadcast: { path: '/admin/broadcast', scope: 'group', label: 'broadcast', confirm: 'confirmBroadcast' },
  announce: { path: '/Monitor_Server/announce', scope: 'group', label: 'announce', confirm: 'confirmAnnounce' },
  /* relays */
  'transit-add': { path: '/Monitor_Server/transit-add', scope: 'server', label: 'transitAdd' },
  'transit-remove': { path: '/Monitor_Server/transit-remove', scope: 'row', label: 'del', confirm: 'confirmDelete' },
  gateways: { path: '/Monitor_Server/gateways', scope: 'group', label: 'gwSave', confirm: 'confirmGateways' },
  'gateways-reset': { path: '/Monitor_Server/gateways', scope: 'group', label: 'gwReset', confirm: 'confirmGwReset' },
  'partner-request': { path: '/Monitor_Server/partners/request', scope: 'server', label: 'sendRequest', confirm: 'confirmSend' },
  'partner-approve': { path: '/Monitor_Server/partners/approve', scope: 'row', label: 'approve', confirm: 'confirmApprove' },
  'partner-reject': { path: '/Monitor_Server/partners/reject', scope: 'row', label: 'reject', confirm: 'confirmReject' },
  'partner-remove': { path: '/Monitor_Server/partners/remove', scope: 'row', label: 'disconnect', confirm: 'confirmDisconnect' },
  'partner-carry': { path: '/Monitor_Server/partners/carry', scope: 'server', label: 'carryBetween', confirm: 'confirmCarry' },
  /* the machine */
  'ops-backup-create': { path: '/Monitor_Server/ops-backup-create', scope: 'group', label: 'backupMake', slow: true },
  'ops-backup-download': { path: '/Monitor_Server/ops-backup-download', scope: 'row', label: 'download', download: true },
  'ops-backup-restore': { path: '/Monitor_Server/ops-backup-restore', scope: 'row', label: 'restore', confirm: 'confirmRestore', slow: true },
  'ops-backup-delete': { path: '/Monitor_Server/ops-backup-delete', scope: 'row', label: 'del', confirm: 'confirmDelete' },
  'ops-memory-set': { path: '/Monitor_Server/ops-memory-set', scope: 'row', label: 'apply' },
  'ops-cleanup-temps': { path: '/Monitor_Server/ops-cleanup', scope: 'group', label: 'cleanTemps' },
  'ops-cleanup-image': { path: '/Monitor_Server/ops-cleanup', scope: 'row', label: 'del', confirm: 'confirmDelete' },
  'ops-image-check': { path: '/Monitor_Server/ops-image-check', scope: 'row', label: 'hubCheck', slow: true },
  'ops-image-update': { path: '/Monitor_Server/ops-image-update', scope: 'row', label: 'imageUpdate', confirm: 'confirmImageUpdate', slow: true },
  'ops-stack-restart': { path: '/Monitor_Server/ops-stack-restart', scope: 'group', label: 'stackRestart', confirm: 'confirmRestart', slow: true },
  'ops-image-export': { path: '/Monitor_Server/ops-image-export', scope: 'server', label: 'imageExport', download: true },
  'ops-bundle': { path: '/Monitor_Server/ops-bundle', scope: 'server', label: 'bundle', download: true },
  'ops-github-apply': { path: '/Monitor_Server/ops-github-apply', scope: 'group', label: 'ghApply', confirm: 'confirmUpdate', oneByOne: true, slow: true },
  'ops-github-rollback': { path: '/Monitor_Server/ops-github-rollback', scope: 'server', label: 'ghRollback', confirm: 'confirmRollback', slow: true },
  'bootstrap-token': { path: '/Monitor_Server/bootstrap-token', scope: 'server', label: 'showInstall' },
  /* the system */
  'change-password': { path: '/admin/change-password', scope: 'server', label: 'changePassword' },
  'optimize-ram': { path: '/admin/optimize-ram', scope: 'group', label: 'optimizeRam' },
  'clear-memory': { path: '/admin/clear-memory', scope: 'group', label: 'clearMemory', confirm: 'confirmClearMemory' },
  'alert-test': { path: '/Monitor_Server/alert-test', scope: 'group', label: 'alertTest' },
};

/* What the dashboard does that the panel has no need of, and why. */
export const NOT_NEEDED = {
  '/admin/logout': 'This ends the dashboard’s own browser session; the panel sends the dashboard password with every call and keeps no dashboard session to end.',
};
