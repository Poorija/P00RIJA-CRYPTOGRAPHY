/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* P00RIJA Cryptography — SSH Key Manager
 * Graphical manager for SSH keys: generate (Ed25519 / RSA), import,
 * store encrypted in the app vault, copy/download both parts, and
 * (with explicit permission) read/write the device ~/.ssh folder via
 * the File System Access API. Falls back to file import everywhere else.
 */
(function () {
	'use strict';

	const SSH_STORAGE_KEY = 'poorija_ssh_keys';
	const SSH_SETTINGS_KEY = 'poorija_ssh_settings';

	const state = {
		keys: [],
		generated: null,
		device: null,
		deviceEntries: [],
		deviceFolders: [],
		sshSubpath: '',
		scanning: false,
		initialized: false,
	};

	function app() {
		return window.PoorijaApp;
	}
	function appState() {
		return app()?.state;
	}
	function isUnlocked() {
		return Boolean(appState() && !appState().isLocked && appState().masterPassword);
	}
	function language() {
		return appState()?.language || 'fa';
	}
	function t(fa, en) {
		return language() === 'fa' ? fa : en;
	}
	function notify(message, type = 'info') {
		app()?.showNotification?.(message, type);
	}
	function escapeHTML(value) {
		return app()?.escapeHTML?.(String(value ?? '')) ?? String(value ?? '');
	}

	/* ------------------------------------------------------------------
	 * Binary helpers (SSH wire format)
	 * ------------------------------------------------------------------ */
	function asciiBytes(text) {
		return new TextEncoder().encode(text);
	}
	function concatBytes(chunks) {
		const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
		const out = new Uint8Array(total);
		let offset = 0;
		chunks.forEach((chunk) => {
			out.set(chunk, offset);
			offset += chunk.length;
		});
		return out;
	}
	function putUint32(bytes, value) {
		bytes.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
	}
	function sshStringBytes(payload) {
		const out = [];
		putUint32(out, payload.length);
		return concatBytes([new Uint8Array(out), payload]);
	}
	function mpint(bytes) {
		// SSH mpint: big-endian, minimal, with a leading zero when the high bit is set.
		let start = 0;
		while (start < bytes.length - 1 && bytes[start] === 0) start += 1;
		let trimmed = bytes.slice(start);
		if (trimmed.length && trimmed[0] & 0x80) {
			trimmed = concatBytes([new Uint8Array([0]), trimmed]);
		}
		return sshStringBytes(trimmed);
	}
	function toBase64(bytes) {
		return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
	}
	function fromBase64(text) {
		const clean = String(text || '').replace(/\s+/g, '');
		const binary = atob(clean);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
		return out;
	}
	function bytesToHex(bytes) {
		return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join(':');
	}

	/* ------------------------------------------------------------------
	 * Fingerprints
	 * ------------------------------------------------------------------ */
	async function sshFingerprint(blobBytes) {
		const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', blobBytes));
		return `SHA256:${toBase64(digest).replace(/=+$/, '')}`;
	}

	/* ------------------------------------------------------------------
	 * Public key parsing
	 * ------------------------------------------------------------------ */
	const KNOWN_KEY_TYPES = ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521', 'ssh-dss'];

	function reader(bytes) {
		let pos = 0;
		return {
			eof() { return pos >= bytes.length; },
			readUint32() {
				const value = ((bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]) >>> 0;
				pos += 4;
				return value;
			},
			readString() {
				const len = this.readUint32();
				const value = bytes.slice(pos, pos + len);
				pos += len;
				return value;
			},
			skip(n) { pos += n; },
		};
	}

	function parsePublicLine(line) {
		const parts = String(line || '').trim().split(/\s+/);
		if (parts.length < 2) return null;
		const [type, b64, ...rest] = parts;
		if (!KNOWN_KEY_TYPES.includes(type)) return null;
		let blob;
		try {
			blob = fromBase64(b64);
		} catch (_error) {
			return null;
		}
		const r = reader(blob);
		const innerType = new TextDecoder().decode(r.readString());
		if (innerType !== type) return null;
		return {
			type,
			blob,
			comment: rest.join(' ') || '',
		};
	}

	/* ------------------------------------------------------------------
	 * Private key parsing (openssh-key-v1 + legacy PEM)
	 * ------------------------------------------------------------------ */
	function parseOpenSSHPrivate(pem) {
		try {
			const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
			const data = fromBase64(body);
			const magic = 'openssh-key-v1\0';
			for (let i = 0; i < magic.length; i += 1) {
				if (data[i] !== magic.charCodeAt(i)) return null;
			}
			const r = reader(data);
			r.skip(magic.length);
			new TextDecoder().decode(r.readString()); // ciphername
			new TextDecoder().decode(r.readString()); // kdfname
			r.readString(); // kdfoptions
			const keyCount = r.readUint32();
			if (keyCount !== 1) return null;
			const pubBlob = r.readString();
			const privSection = r.readString();
			const pr = reader(privSection);
			pr.readUint32(); pr.readUint32(); // check ints
			const keyType = new TextDecoder().decode(pr.readString());
			if (keyType === 'ssh-ed25519') {
				pr.readString(); // pub
				pr.readString(); // priv
			} else if (keyType === 'ssh-rsa') {
				pr.readString(); pr.readString(); pr.readString(); pr.readString(); pr.readString(); pr.readString(); // n e d iqmp p q
			} else if (keyType.startsWith('ecdsa-sha2-')) {
				pr.readString(); // curve
				pr.readString(); // pub
				pr.readString(); // priv
			} else {
				return null;
			}
			const comment = new TextDecoder().decode(pr.readString());
			return { type: keyType, pubBlob, comment };
		} catch (_error) {
			return null;
		}
	}

	function parseDerLength(bytes, pos) {
		const first = bytes[pos];
		if (first & 0x80) {
			const count = first & 0x7f;
			let value = 0;
			for (let i = 0; i < count; i += 1) value = value * 256 + bytes[pos + 1 + i];
			return { value, next: pos + 1 + count };
		}
		return { value: first, next: pos + 1 };
	}
	function parseLegacyPemRsa(pem) {
		try {
			if (/Proc-Type:.*ENCRYPTED/i.test(pem)) return { encrypted: true };
			const body = fromBase64(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''));
			// Accept both PKCS#1 (RSAPrivateKey) and PKCS#8 (PRIVATE KEY) containers.
			const parse = (data) => {
				if (data[0] !== 0x30) return null;
				const seqLen = parseDerLength(data, 1);
				let pos = seqLen.next;
				const ints = [];
				let octetString = null;
				while (pos < data.length) {
					const tag = data[pos];
					const len = parseDerLength(data, pos + 1);
					const start = len.next;
					const end = start + len.value;
					if (tag === 0x02) ints.push(data.slice(start, end));
					if (tag === 0x04 && !octetString && len.value > 64) octetString = data.slice(start, end);
					pos = end;
				}
				if (ints.length >= 3) {
					// PKCS#1 RSAPrivateKey: version, n, e, d, ...
					return { n: ints[1], e: ints[2] };
				}
				if (octetString) return parse(octetString); // PKCS#8: unwrap the inner PKCS#1 blob
				return null;
			};
			const parsed = parse(body);
			if (!parsed) return null;
			const { n, e } = parsed;
			const blob = concatBytes([
				sshStringBytes(asciiBytes('ssh-rsa')),
				mpint(e),
				mpint(n),
			]);
			return { type: 'ssh-rsa', pubBlob: blob, comment: '' };
		} catch (_error) {
			return null;
		}
	}

	async function fingerprintFromBlob(blob) {
		try {
			return await sshFingerprint(blob);
		} catch (_error) {
			return '';
		}
	}

	/* ------------------------------------------------------------------
	 * Key generation
	 * ------------------------------------------------------------------ */
	function buildOpenSSHPrivatePem(pubBlob, privateCore, comment) {
		const check = crypto.getRandomValues(new Uint32Array(1))[0];
		const checkBytes = [];
		putUint32(checkBytes, check);
		const checkPart = new Uint8Array(checkBytes);
		const core = concatBytes([
			checkPart,
			checkPart,
			privateCore(comment),
		]);
		// padding 1..i mod block (block = 8 for 'none' cipher per spec: padlen starts at 1)
		let pad = 1;
		while ((core.length + pad - 1) % 8 !== 0 || pad === 1) {
			if ((core.length + pad) % 8 === 0) break;
			pad += 1;
		}
		const padding = Array.from({ length: pad }, (_, i) => (i + 1) & 0xff);
		const privSection = concatBytes([core, new Uint8Array(padding)]);
		const unencrypted = concatBytes([
			asciiBytes('openssh-key-v1\0'),
			sshStringBytes(asciiBytes('none')),
			sshStringBytes(asciiBytes('none')),
			sshStringBytes(new Uint8Array(0)),
			new Uint8Array([0, 0, 0, 1]),
			sshStringBytes(pubBlob),
			sshStringBytes(privSection),
		]);
		const b64 = toBase64(unencrypted).replace(/(.{70})/g, '$1\n');
		return `-----BEGIN OPENSSH PRIVATE KEY-----\n${b64}\n-----END OPENSSH PRIVATE KEY-----\n`;
	}

	async function generateSshKeyPair({ algorithm = 'ed25519', rsaBits = 3072, comment = '' }) {
		if (algorithm === 'ed25519') {
			const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
			const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
			const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
			const seed = pkcs8.slice(pkcs8.length - 32);
			const priv64 = concatBytes([seed, pubRaw]);
			const pubBlob = concatBytes([
				sshStringBytes(asciiBytes('ssh-ed25519')),
				sshStringBytes(pubRaw),
			]);
			const privateCore = (keyComment) => concatBytes([
				sshStringBytes(asciiBytes('ssh-ed25519')),
				sshStringBytes(pubRaw),
				sshStringBytes(priv64),
				sshStringBytes(asciiBytes(keyComment || '')),
			]);
			return {
				type: 'ssh-ed25519',
				publicKeyLine: `ssh-ed25519 ${toBase64(pubBlob)} ${comment}`.trim(),
				privateKeyPem: buildOpenSSHPrivatePem(pubBlob, privateCore, comment),
				pubBlob,
			};
		}
		if (algorithm === 'rsa') {
			const bits = [2048, 3072, 4096].includes(Number(rsaBits)) ? Number(rsaBits) : 3072;
			const pair = await crypto.subtle.generateKey(
				{ name: 'RSA-OAEP', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
				true,
				['encrypt', 'decrypt'],
			);
			const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
			const b64u = (value) => fromBase64(value.replace(/-/g, '+').replace(/_/g, '/'));
			const n = b64u(jwk.n);
			const e = b64u(jwk.e);
			const d = b64u(jwk.d);
			const p = b64u(jwk.p);
			const q = b64u(jwk.q);
			const qInv = b64u(jwk.qi);
			const pubBlob = concatBytes([
				sshStringBytes(asciiBytes('ssh-rsa')),
				mpint(e),
				mpint(n),
			]);
			const privateCore = (keyComment) => concatBytes([
				sshStringBytes(asciiBytes('ssh-rsa')),
				mpint(n),
				mpint(e),
				mpint(d),
				mpint(qInv),
				mpint(p),
				mpint(q),
				sshStringBytes(asciiBytes(keyComment || '')),
			]);
			return {
				type: `ssh-rsa (${bits})`,
				publicKeyLine: `ssh-rsa ${toBase64(pubBlob)} ${comment}`.trim(),
				privateKeyPem: buildOpenSSHPrivatePem(pubBlob, privateCore, comment),
				pubBlob,
			};
		}
		throw new Error(`Unsupported algorithm: ${algorithm}`);
	}

	/* ------------------------------------------------------------------
	 * Encrypted vault storage
	 * ------------------------------------------------------------------ */
	function loadKeys() {
		if (!isUnlocked()) return [];
		try {
			const raw = localStorage.getItem(SSH_STORAGE_KEY);
			if (!raw) return [];
			const parsed = app()?.decryptStorageData?.(raw);
			return Array.isArray(parsed) ? parsed : [];
		} catch (_error) {
			return [];
		}
	}
	function persistKeys() {
		if (!isUnlocked()) return;
		try {
			localStorage.setItem(SSH_STORAGE_KEY, app().encryptStorageData(state.keys));
		} catch (error) {
			console.error('Failed to persist SSH keys', error);
			notify(t('ذخیره‌سازی کلیدها ناموفق بود.', 'Failed to persist keys.'), 'error');
		}
	}
	function loadSettings() {
		try {
			return JSON.parse(localStorage.getItem(SSH_SETTINGS_KEY) || '{}');
		} catch (_error) {
			return {};
		}
	}
	function saveSettings(settings) {
		localStorage.setItem(SSH_SETTINGS_KEY, JSON.stringify(settings));
	}

	/* ------------------------------------------------------------------
	 * Platform / OS detection
	 * ------------------------------------------------------------------ */
	function detectPlatform() {
		const ua = navigator.userAgent || '';
		const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
		const isIpadOs = (navigator.maxTouchPoints || 0) > 1 && /MacIntel/i.test(platform);
		if (/iPad|iPhone|iPod/i.test(ua) || (/iOS/i.test(platform))) {
			return { os: 'ios', mobile: true, label: 'iOS', defaultPath: '' };
		}
		if (isIpadOs) return { os: 'ios', mobile: true, label: 'iPadOS', defaultPath: '' };
		if (/Android/i.test(ua) || /Android/i.test(platform)) {
			return { os: 'android', mobile: true, label: 'Android', defaultPath: '' };
		}
		if (/Windows/i.test(ua) || /Windows/i.test(platform)) {
			return { os: 'windows', mobile: false, label: 'Windows', defaultPath: '%USERPROFILE%\\.ssh  (معمولاً C:\\Users\\نام‌کاربری\\.ssh)' };
		}
		if (/Mac OS X|Macintosh/i.test(ua) || /Mac/i.test(platform)) {
			return { os: 'macos', mobile: false, label: 'macOS', defaultPath: '~/.ssh' };
		}
		if (/CrOS/i.test(ua)) return { os: 'chromeos', mobile: false, label: 'ChromeOS', defaultPath: '~/.ssh' };
		if (/Linux|X11/i.test(ua) || /Linux/i.test(platform)) {
			return { os: 'linux', mobile: false, label: 'Linux', defaultPath: '~/.ssh' };
		}
		return { os: 'unknown', mobile: false, label: t('نامشخص', 'Unknown'), defaultPath: '' };
	}

	/* ------------------------------------------------------------------
	 * Device ~/.ssh access — multi-browser strategy ladder:
	 *   A) Chromium (Chrome/Edge/Opera): showDirectoryPicker (read/write).
	 *      The native picker refuses hidden dot-folders, so after the user
	 *      picks ANY folder (home dir recommended) we descend into ".ssh"
	 *      programmatically via getDirectoryHandle().
	 *   B) Drag & drop of the .ssh folder onto the drop zone:
	 *      getAsFileSystemHandle() (Chromium + Safari 15.2+) or the legacy
	 *      webkitGetAsEntry() tree reader (Safari/Firefox). Read-only unless
	 *      a writable directory handle was granted.
	 *   C) <input type="file" webkitdirectory> fallback (Safari 11.1+,
	 *      Firefox 50+): user selects the folder (⌘⇧G → ~/.ssh on macOS);
	 *      files are normalized out of their relative paths. Read-only.
	 *   D) Plain multi-file import — works everywhere including mobile.
	 * ------------------------------------------------------------------ */
	function fsAccessSupported() {
		return typeof window.showDirectoryPicker === 'function';
	}
	/* Strategy 0, and the only one that actually works in the native shell:
	   neither WKWebView (macOS) nor WebKitGTK (Linux) implements the File
	   System Access API, so every branch below strategy A is dead there. The
	   Rust side reaches the real ~/.ssh directly, with no picker, no dot-folder
	   restriction and full read/write. */
	function nativeSsh() {
		const desktop = window.PoorijaDesktop;
		return desktop?.available ? desktop : null;
	}
	function deviceIsNative() {
		return state.device?.source === 'native';
	}
	function deviceHandle() {
		return state.device?.source === 'handle' ? state.device.handle : null;
	}
	function deviceReadOnly() {
		if (deviceIsNative()) return false;
		return state.device ? state.device.source !== 'handle' || Boolean(state.device.readOnly) : false;
	}
	async function ensureDirPermission(mode = 'readwrite') {
		const handle = deviceHandle();
		if (!handle) return false;
		const options = { mode };
		if (typeof handle.queryPermission === 'function') {
			if ((await handle.queryPermission(options)) === 'granted') return true;
			return (await handle.requestPermission(options)) === 'granted';
		}
		return true; /* handle pre-granted (e.g. from a drop gesture) */
	}
	async function openSshDirectory() {
		const native = nativeSsh();
		if (native) {
			state.sshSubpath = '';
			try {
				const path = await native.sshDirPath();
				state.device = { source: 'native', rootName: path || '~/.ssh', path: path || '', readOnly: false };
				await scanDeviceKeys();
				if (!state.deviceEntries.length) {
					notify(t(
						'پوشهٔ ~/.ssh هنوز فایلی ندارد — با نوشتن اولین کلید ساخته می‌شود.',
						'~/.ssh has no files yet — it is created when the first key is written.',
					), 'info');
				}
			} catch (error) {
				console.error(error);
				notify(t('دسترسی به ~/.ssh ناموفق بود: ', 'Could not access ~/.ssh: ') + String(error?.message || error), 'error');
			}
			return;
		}
		if (!fsAccessSupported()) {
			pickFolderCompat();
			return;
		}
		try {
			const picked = await window.showDirectoryPicker({ id: 'poorija-ssh-dir', mode: 'readwrite', startIn: 'home' });
			let dir = picked;
			/* Hidden dot-folders cannot be selected in the picker itself — if the
			   user picked an ancestor (e.g. home), silently descend into .ssh. */
			if (picked.name !== '.ssh') {
				try {
					dir = await picked.getDirectoryHandle('.ssh');
				} catch (_error) {
					/* No .ssh child — respect the user's explicit folder choice. */
				}
			}
			state.device = { source: 'handle', handle: dir, rootName: dir.name, readOnly: false };
			await scanDeviceKeys();
		} catch (error) {
			if (error && error.name !== 'AbortError') {
				console.error(error);
				notify(t('دسترسی به پوشه ناموفق بود.', 'Could not access the folder.'), 'error');
			}
		}
	}
	function pickFolderCompat() {
		const input = element('sshDirInput');
		if (!input) {
			notify(t('این مرورگر اجازه دسترسی مستقیم به پوشه را نمی‌دهد. از دکمه «ایمپورت از فایل» استفاده کنید.', 'This browser cannot open a device folder directly. Use "Import from file" instead.'), 'warning');
			return;
		}
		input.value = '';
		input.click();
	}
	function normalizeDevicePath(relPath) {
		const clean = String(relPath || '').replace(/\\/g, '/').replace(/^\.\//, '');
		const marker = '.ssh/';
		const idx = clean.indexOf(marker);
		if (idx >= 0) return clean.slice(idx + marker.length);
		return clean;
	}
	async function handleDirInput(event) {
		const files = Array.from(event.target.files || []);
		if (!files.length) return;
		const usable = files
			.map((file) => ({ file, name: normalizeDevicePath(file.webkitRelativePath || file.name) }))
			.filter((item) => item.name && !item.name.includes('/'));
		if (!usable.length) {
			notify(t('فایل مرتبطی در پوشه انتخاب‌شده پیدا نشد.', 'No related files found in the chosen folder.'), 'warning');
			return;
		}
		state.device = {
			source: 'files',
			files: usable.map((item) => ({ name: item.name, file: item.file })),
			rootName: (files[0].webkitRelativePath || '').split('/')[0] || '.ssh',
			readOnly: true,
		};
		await scanDeviceKeys();
	}
	function readEntryTree(dirEntry, prefix = '') {
		return new Promise((resolve) => {
			const reader = dirEntry.createReader();
			const collected = [];
			const readBatch = () => {
				reader.readEntries(async (batch) => {
					if (!batch.length) {
						resolve(collected);
						return;
					}
					for (const entryItem of batch) {
						const path = prefix ? `${prefix}/${entryItem.name}` : entryItem.name;
						if (entryItem.isDirectory) {
							collected.push(...await readEntryTree(entryItem, path));
						} else {
							await new Promise((res) => {
								entryItem.file((file) => {
									try { Object.defineProperty(file, 'webkitRelativePath', { value: path }); } catch (_error) { /* best effort */ }
									collected.push(file);
									res();
								}, () => res());
							});
						}
					}
					readBatch();
				}, () => resolve(collected));
			};
			readBatch();
		});
	}
	async function handleDeviceDrop(event) {
		event.preventDefault();
		event.currentTarget?.classList?.remove('drag-over');
		const items = Array.from(event.dataTransfer?.items || []);
		for (const item of items) {
			if (item.kind !== 'file') continue;
			try {
				if (typeof item.getAsFileSystemHandle === 'function') {
					const handle = await item.getAsFileSystemHandle();
					if (handle && handle.kind === 'directory') {
						state.device = { source: 'handle', handle, rootName: handle.name, readOnly: false };
						await scanDeviceKeys();
						return;
					}
				}
				const entryItem = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
				if (entryItem && entryItem.isDirectory) {
					const files = await readEntryTree(entryItem);
					state.device = {
						source: 'files',
						files: files
							.map((file) => ({ name: normalizeDevicePath(file.webkitRelativePath || file.name), file }))
							.filter((item2) => item2.name && !item2.name.includes('/')),
						rootName: entryItem.name || '.ssh',
						readOnly: true,
					};
					await scanDeviceKeys();
					return;
				}
			} catch (error) {
				console.error(error);
			}
		}
		const droppedFiles = Array.from(event.dataTransfer?.files || []);
		if (droppedFiles.length) {
			await importDroppedFiles(droppedFiles);
			return;
		}
		notify(t('چیزی قابل پذیرش رها نشد — پوشه یا فایل کلید را رها کنید.', 'Nothing usable was dropped — drop a folder or a key file.'), 'warning');
	}
	function classifyKeyText(text, name) {
		if (/\.pub$/i.test(name) || /^ssh-/m.test(text) || /^ecdsa-/m.test(text)) {
			const line = text.split(/\r?\n/).find((l) => /^(ssh-|ecdsa-)/.test(l.trim()));
			const parsedLine = line ? parsePublicLine(line) : null;
			if (parsedLine) return { parsed: parsedLine, kind: 'public', text };
		}
		if (/BEGIN OPENSSH PRIVATE KEY/.test(text)) {
			return { parsed: parseOpenSSHPrivate(text), kind: 'private', text };
		}
		if (/BEGIN (RSA |EC |DSA |)PRIVATE KEY/.test(text)) {
			const parsed = parseLegacyPemRsa(text);
			return { parsed, kind: parsed && parsed.encrypted ? 'private-encrypted' : 'private', text };
		}
		if (name === 'config' || name === 'known_hosts') return { parsed: null, kind: 'meta', text };
		return { parsed: null, kind: 'unknown', text };
	}
	async function scanDeviceKeys() {
		if (!state.device || state.scanning) return;
		state.scanning = true;
		renderDevicePanel();
		try {
			const entries = [];
			const folders = [];
			const pushFile = async (name, readText) => {
				if (!/^(id_[\w.-]+|authorized_keys|config|known_hosts|[\w.-]+\.(pub|pem))$/i.test(name)) return;
				try {
					const text = await readText();
					const classified = classifyKeyText(text, name);
					entries.push({ name, kind: classified.kind, parsed: classified.parsed, text });
				} catch (_error) {
					/* unreadable entry */
				}
			};
			const handle = deviceHandle();
			const native = deviceIsNative() ? nativeSsh() : null;
			if (native) {
				const listing = await native.sshList(state.sshSubpath || null);
				for (const item of listing) {
					/* Folders are navigable on the native side: one click descends
					   into them (breadcrumb goes back up). */
					if (item.is_dir || item.isDir) {
						folders.push(item.name);
						continue;
					}
					const mode = Number(item.mode || 0);
					await pushFile(item.name, () => native.sshRead(item.name, state.sshSubpath || null));
					const added = entries[entries.length - 1];
					/* Carry the permission bits through: a private key that is
					   group- or world-readable is the one thing OpenSSH will
					   refuse to use, and it is invisible in a file listing. */
					if (added && added.name === item.name) {
						added.mode = mode;
						added.size = Number(item.size || 0);
					}
				}
			} else if (handle) {
				await ensureDirPermission('readwrite');
				for await (const [name, entryHandle] of handle.entries()) {
					if (entryHandle.kind !== 'file') continue;
					await pushFile(name, async () => (await entryHandle.getFile()).text());
				}
			} else if (state.device.source === 'files' && Array.isArray(state.device.files)) {
				for (const item of state.device.files) {
					await pushFile(item.name, async () => item.file.text());
				}
			}
			entries.sort((a, b) => a.name.localeCompare(b.name));
			state.deviceEntries = entries;
			state.deviceFolders = folders.sort((a, b) => a.localeCompare(b));
			// auto-fingerprint
			for (const entry of entries) {
				if (entry.parsed && entry.parsed.pubBlob && !entry.parsed.fingerprint) {
					entry.parsed.fingerprint = await fingerprintFromBlob(entry.parsed.pubBlob);
				}
			}
		} finally {
			state.scanning = false;
			renderDevicePanel();
		}
	}
	async function readDeviceFileText(name) {
		if (deviceIsNative()) {
			const native = nativeSsh();
			if (native) return native.sshRead(name, state.sshSubpath || null);
		}
		const handle = deviceHandle();
		if (handle) {
			await ensureDirPermission('readwrite');
			const fileHandle = await handle.getFileHandle(name);
			return (await fileHandle.getFile()).text();
		}
		if (state.device?.source === 'files') {
			const item = state.device.files.find((candidate) => candidate.name === name);
			if (item) return item.file.text();
		}
		const entry = state.deviceEntries.find((candidate) => candidate.name === name);
		return entry?.text || null;
	}
	async function importDroppedFiles(files) {
		let imported = 0;
		for (const file of files) {
			const record = await buildRecordFromText(await file.text(), file.name, 'device');
			if (record) {
				addKeyRecord(record);
				imported += 1;
			}
		}
		notify(imported
			? t(`${imported} کلید ایمپورت شد.`, `${imported} key(s) imported.`)
			: t('فایل به‌عنوان کلید SSH شناخته نشد.', 'The file was not recognized as an SSH key.'), imported ? 'success' : 'warning');
	}
	async function importDeviceEntry(name) {
		const entry = state.deviceEntries.find((item) => item.name === name);
		if (!entry || !state.device) return;
		try {
			const text = await readDeviceFileText(name);
			if (!text) return;
			const record = await buildRecordFromText(text, entry.name, 'device');
			if (!record) {
				notify(t('این فایل به‌عنوان کلید SSH شناخته نشد.', 'This file was not recognized as an SSH key.'), 'warning');
				return;
			}
			addKeyRecord(record);
		} catch (error) {
			console.error(error);
			notify(t('ایمپورت از دستگاه ناموفق بود.', 'Import from device failed.'), 'error');
		}
	}
	async function writePublicKeyToDevice(record) {
		if (!state.device) {
			notify(t('ابتدا پوشه ~/.ssh دستگاه را باز کنید.', 'Open the device ~/.ssh folder first.'), 'warning');
			return;
		}
		const line = record.publicKeyLine.trim();
		const pubName = `${String(record.name || 'key').replace(/[^a-zA-Z0-9_-]+/g, '_')}.pub`;
		if (deviceIsNative()) {
			const native = nativeSsh();
			try {
				/* The dedupe-and-append happens in one Rust call: doing it as
				   read-then-write from here would race any other writer, and
				   authorized_keys is exactly the file you do not want to
				   half-write. */
				const appended = await native.sshAppendAuthorizedKey(line);
				await native.sshWrite(pubName, `${line}\n`, false);
				notify(appended
					? t(`کلید عمومی به authorized_keys اضافه و در ${pubName} نوشته شد.`, `Public key appended to authorized_keys and written to ${pubName}.`)
					: t(`این کلید از قبل در authorized_keys بود؛ فایل ${pubName} به‌روزرسانی شد.`, `That key was already in authorized_keys; ${pubName} was refreshed.`),
				'success');
				await scanDeviceKeys();
			} catch (error) {
				console.error(error);
				notify(t('نوشتن در ~/.ssh ناموفق بود: ', 'Writing to ~/.ssh failed: ') + String(error?.message || error), 'error');
			}
			return;
		}
		if (deviceReadOnly()) {
			/* Read-only mode (Safari/Firefox fallback): deliver the files as downloads
			   instead of writing them, and merge with a previously scanned authorized_keys. */
			const existing = state.deviceEntries.find((entry) => entry.name === 'authorized_keys');
			const existingLines = (existing?.text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
			const merged = existingLines.includes(line) ? existingLines : [...existingLines, line];
			downloadText(pubName, `${line}\n`);
			downloadText('authorized_keys', `${merged.join('\n')}\n`);
			notify(t(
				`این مرورگر اجازه نوشتن مستقیم نمی‌دهد — دو فایل ${pubName} و authorized_keys (ادغام‌شده) دانلود شد؛ آن‌ها را در ~/.ssh قرار دهید.`,
				`This browser cannot write directly — ${pubName} and a merged authorized_keys were downloaded; move them into ~/.ssh.`,
			), 'success');
			return;
		}
		try {
			await ensureDirPermission('readwrite');
			const handle = deviceHandle();
			let authorized = '';
			try {
				const fileHandle = await handle.getFileHandle('authorized_keys');
				authorized = await (await fileHandle.getFile()).text();
			} catch (_error) {
				/* not created yet */
			}
			if (!authorized.split(/\r?\n/).some((existing) => existing.trim() === line)) {
				const next = authorized ? `${authorized.replace(/\s*$/, '')}\n${line}\n` : `${line}\n`;
				const writable = await (await handle.getFileHandle('authorized_keys', { create: true })).createWritable();
				await writable.write(next);
				await writable.close();
			}
			const pubWritable = await (await handle.getFileHandle(pubName, { create: true })).createWritable();
			await pubWritable.write(`${line}\n`);
			await pubWritable.close();
			notify(t(`کلید عمومی در authorized_keys و فایل ${pubName} نوشته شد.`, `Public key written to authorized_keys and ${pubName}.`), 'success');
			await scanDeviceKeys();
		} catch (error) {
			console.error(error);
			notify(t('نوشتن در پوشه دستگاه ناموفق بود.', 'Writing to the device folder failed.'), 'error');
		}
	}
	async function writePrivateKeyToDevice(record) {
		if (!state.device || !record.privateKeyPem) {
			notify(t('ابتدا پوشه ~/.ssh دستگاه را باز کنید.', 'Open the device ~/.ssh folder first.'), 'warning');
			return;
		}
		const name = `id_${record.keyType.startsWith('ssh-rsa') ? 'rsa' : 'ed25519'}_poorija_${String(record.name || 'key').replace(/[^a-zA-Z0-9_-]+/g, '_')}`.slice(0, 60);
		if (deviceIsNative()) {
			const native = nativeSsh();
			try {
				/* Created 0600 by the Rust side, so there is no chmod step to
				   forget and no window in which the key sits world-readable. */
				const written = await native.sshWrite(name, record.privateKeyPem, true);
				notify(t(
					`کلید خصوصی با دسترسی 600 در ${written} نوشته شد.`,
					`Private key written to ${written} with mode 600.`,
				), 'success');
				await scanDeviceKeys();
			} catch (error) {
				console.error(error);
				notify(t('نوشتن کلید خصوصی ناموفق بود: ', 'Writing the private key failed: ') + String(error?.message || error), 'error');
			}
			return;
		}
		if (deviceReadOnly()) {
			downloadText(name, record.privateKeyPem);
			notify(t(
				`این مرورگر اجازه نوشتن مستقیم نمی‌دهد — فایل ${name} دانلود شد؛ در ~/.ssh قرار دهید و روی لینوکس/مک اجرا کنید: chmod 600 ~/.ssh/${name}`,
				`This browser cannot write directly — ${name} was downloaded; move it into ~/.ssh and run: chmod 600 ~/.ssh/${name}`,
			), 'success');
			return;
		}
		try {
			await ensureDirPermission('readwrite');
			const handle = deviceHandle();
			const writable = await (await handle.getFileHandle(name, { create: true })).createWritable();
			await writable.write(record.privateKeyPem);
			await writable.close();
			notify(t(
				`کلید خصوصی در ${name} نوشته شد. روی لینوکس/مک دسترسی را به ۶۰۰ تغییر دهید: chmod 600 ~/.ssh/${name}`,
				`Private key written to ${name}. On Linux/macOS run: chmod 600 ~/.ssh/${name}`,
			), 'success');
			await scanDeviceKeys();
		} catch (error) {
			console.error(error);
			notify(t('نوشتن کلید خصوصی ناموفق بود.', 'Writing the private key failed.'), 'error');
		}
	}

	/* ------------------------------------------------------------------
	 * Records
	 * ------------------------------------------------------------------ */
	function randomId() {
		return `ssh-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
	}
	async function buildRecordFromText(text, fileName = '', source = 'imported') {
		const trimmed = String(text || '').trim();
		const publicMatch = trimmed.split(/\r?\n/).find((line) => /^(ssh-|ecdsa-)/.test(line.trim()));
		if (publicMatch) {
			const parsed = parsePublicLine(publicMatch);
			if (parsed) {
				return {
					id: randomId(),
					name: fileName || parsed.comment || parsed.type,
					keyType: parsed.type,
					comment: parsed.comment,
					publicKeyLine: publicMatch.trim(),
					privateKeyPem: null,
					fingerprint: await fingerprintFromBlob(parsed.blob),
					createdAt: new Date().toISOString(),
					source,
				};
			}
		}
		if (/BEGIN OPENSSH PRIVATE KEY/.test(trimmed)) {
			const parsed = parseOpenSSHPrivate(trimmed);
			if (parsed) {
				return {
					id: randomId(),
					name: fileName || parsed.comment || parsed.type,
					keyType: parsed.type,
					comment: parsed.comment,
					publicKeyLine: `${parsed.type} ${toBase64(parsed.pubBlob)} ${parsed.comment}`.trim(),
					privateKeyPem: trimmed,
					fingerprint: await fingerprintFromBlob(parsed.pubBlob),
					createdAt: new Date().toISOString(),
					source,
				};
			}
		}
		if (/BEGIN (RSA |EC |DSA |)PRIVATE KEY/.test(trimmed)) {
			const parsed = parseLegacyPemRsa(trimmed);
			if (parsed && parsed.encrypted) {
				return {
					id: randomId(),
					name: fileName || t('کلید رمزشده PEM', 'Encrypted PEM key'),
					keyType: 'pem-encrypted',
					comment: '',
					publicKeyLine: '',
					privateKeyPem: trimmed,
					fingerprint: '',
					createdAt: new Date().toISOString(),
					source,
				};
			}
			if (parsed) {
				return {
					id: randomId(),
					name: fileName || 'ssh-rsa',
					keyType: parsed.type,
					comment: '',
					publicKeyLine: `ssh-rsa ${toBase64(parsed.pubBlob)}`,
					privateKeyPem: trimmed,
					fingerprint: await fingerprintFromBlob(parsed.pubBlob),
					createdAt: new Date().toISOString(),
					source,
				};
			}
		}
		return null;
	}
	function addKeyRecord(record) {
		state.keys.unshift(record);
		persistKeys();
		renderKeyList();
		notify(t('کلید به مدیریت کلیدهای SSH اضافه شد.', 'Key added to the SSH key manager.'), 'success');
	}

	/* ------------------------------------------------------------------
	 * Rendering
	 * ------------------------------------------------------------------ */
	function element(id) {
		return document.getElementById(id);
	}
	function renderStaticUi() {
		const platform = detectPlatform();
		const settings = loadSettings();
		const osInfo = element('sshOsInfo');
		if (osInfo) {
			osInfo.innerHTML = `
<div class="ssh-os-card">
<span class="ssh-os-badge"><i class="fab ${platform.os === 'ios' || platform.os === 'macos' ? 'fa-apple' : platform.os === 'windows' ? 'fa-windows' : 'fa-linux'}"></i> ${escapeHTML(platform.label)}</span>
${platform.mobile ? `<span class="text-xs text-amber-300">${t('دسترسی مستقیم به فایل‌سیستم محدود است؛ از ایمپورت/دانلود استفاده کنید.', 'Direct filesystem access is limited; use import/download.')}</span>` : ''}
${platform.defaultPath ? `<span class="text-xs text-slate-400">${t('مسیر پیش‌فرض:', 'Default path:')} <code>${escapeHTML(platform.defaultPath)}</code></span>` : ''}
</div>`;
		}
		const manualPath = element('sshManualPathInput');
		if (manualPath && document.activeElement !== manualPath) manualPath.value = settings.manualPath || '';
		const deviceBtn = element('sshOpenDeviceDirBtn');
		if (deviceBtn) deviceBtn.classList.toggle('hidden', !fsAccessSupported() && platform.mobile);
		renderKeyList();
		renderGeneratedPanel();
		renderDevicePanel();
	}
	function maskFingerprint(fp) {
		return fp ? `${fp.slice(0, 18)}…` : '—';
	}
	function renderKeyList() {
		const container = element('sshKeysList');
		if (!container) return;
		if (!state.keys.length) {
			container.innerHTML = `<div class="ssh-empty">${t('هنوز کلیدی ذخیره نشده است. یک کلید بسازید یا ایمپورت کنید.', 'No keys stored yet. Generate or import one.')}</div>`;
			return;
		}
		container.innerHTML = state.keys.map((record) => `
<details class="ssh-key-card" data-ssh-id="${escapeHTML(record.id)}">
<summary>
<div class="ssh-key-head">
<span class="ssh-key-type">${escapeHTML(record.keyType)}</span>
<span class="ssh-key-name">${escapeHTML(record.name || record.keyType)}</span>
${record.privateKeyPem ? `<span class="ssh-key-pair">${t('جفت‌کلید', 'pair')}</span>` : `<span class="ssh-key-pub">${t('فقط عمومی', 'public only')}</span>`}
</div>
<div class="ssh-key-meta">
<span class="ssh-key-fp" title="${escapeHTML(record.fingerprint)}">${escapeHTML(maskFingerprint(record.fingerprint))}</span>
<span>${escapeHTML(new Date(record.createdAt).toLocaleDateString())}</span>
<span class="ssh-key-source">${escapeHTML(record.source === 'device' ? t('از دستگاه', 'device') : record.source === 'generated' ? t('ساخته‌شده', 'generated') : t('ایمپورت', 'imported'))}</span>
</div>
</summary>
<div class="ssh-key-body">
<label>${t('کلید عمومی (برای سرور/سیستم مقصد — authorized_keys):', 'Public key (for the target system — authorized_keys):')}</label>
<div class="ssh-key-value-group">
<code class="ssh-key-value" data-ssh-public="${escapeHTML(record.id)}">${escapeHTML(record.publicKeyLine || t('—', '—'))}</code>
<div class="ssh-key-actions">
<button type="button" data-ssh-action="copy-public" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-copy"></i> ${t('کپی کلید عمومی', 'Copy public')}</button>
<button type="button" data-ssh-action="download-public" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-download"></i> ${t('دانلود ‎.pub', 'Download .pub')}</button>
${fsAccessSupported() ? `<button type="button" data-ssh-action="write-device" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-hard-drive"></i> ${t('نوشتن روی دستگاه', 'Write to device')}</button>` : ''}
</div>
</div>
${record.privateKeyPem ? `
<label>${t('کلید خصوصی (برای این دستگاه):', 'Private key (for this device):')}</label>
<div class="ssh-key-value-group">
<code class="ssh-key-value ssh-key-private masked" data-ssh-private="${escapeHTML(record.id)}">${escapeHTML(record.privateKeyPem)}</code>
<div class="ssh-key-actions">
<button type="button" data-ssh-action="toggle-private" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-eye"></i> ${t('نمایش/پنهان', 'Reveal/hide')}</button>
<button type="button" data-ssh-action="copy-private" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-copy"></i> ${t('کپی خصوصی', 'Copy private')}</button>
<button type="button" data-ssh-action="download-private" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-download"></i> ${t('دانلود خصوصی', 'Download private')}</button>
${fsAccessSupported() && record.keyType !== 'pem-encrypted' ? `<button type="button" data-ssh-action="write-private-device" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-hard-drive"></i> ${t('نوشتن روی دستگاه', 'Write to device')}</button>` : ''}
</div>
</div>` : ''}
<div class="ssh-key-actions ssh-key-footer">
<button type="button" data-ssh-action="rename" data-ssh-id="${escapeHTML(record.id)}"><i class="fas fa-pen"></i> ${t('تغییر نام', 'Rename')}</button>
<button type="button" data-ssh-action="delete" data-ssh-id="${escapeHTML(record.id)}" class="danger"><i class="fas fa-trash"></i> ${t('حذف', 'Delete')}</button>
</div>
</div>
</details>
`).join('');
	}
	function renderGeneratedPanel() {
		const panel = element('sshGeneratedPanel');
		if (!panel) return;
		if (!state.generated) {
			panel.classList.add('hidden');
			panel.innerHTML = '';
			return;
		}
		const generated = state.generated;
		panel.classList.remove('hidden');
		panel.innerHTML = `
<h4><i class="fas fa-circle-check"></i> ${t('کلید ساخته شد — دو نسخه آماده است:', 'Key created — both versions ready:')}</h4>
<div class="ssh-gen-block">
<label>${t('نسخه ۱ — کلید عمومی برای سیستم مقصد (به ‎~/.ssh/authorized_keys اضافه کنید):', 'Version 1 — public key for the target system (append to ~/.ssh/authorized_keys):')}</label>
<code>${escapeHTML(generated.publicKeyLine)}</code>
<div class="ssh-key-actions">
<button type="button" id="sshGenCopyPub"><i class="fas fa-copy"></i> ${t('کپی', 'Copy')}</button>
<button type="button" id="sshGenDownloadPub"><i class="fas fa-download"></i> ${t('دانلود ‎.pub', 'Download .pub')}</button>
</div>
</div>
<div class="ssh-gen-block">
<label>${t('نسخه ۲ — کلید خصوصی برای این دستگاه (در پوشه ‎~/.ssh نگه دارید):', 'Version 2 — private key for this device (keep in ~/.ssh):')}</label>
<code class="ssh-key-value ssh-key-private masked" id="sshGenPrivateText">${escapeHTML(generated.privateKeyPem)}</code>
<div class="ssh-key-actions">
<button type="button" id="sshGenTogglePrivate"><i class="fas fa-eye"></i> ${t('نمایش/پنهان', 'Reveal/hide')}</button>
<button type="button" id="sshGenCopyPriv"><i class="fas fa-copy"></i> ${t('کپی', 'Copy')}</button>
<button type="button" id="sshGenDownloadPriv"><i class="fas fa-download"></i> ${t('دانلود', 'Download')}</button>
</div>
</div>
<div class="ssh-key-actions ssh-key-footer">
<button type="button" id="sshGenSave" class="primary"><i class="fas fa-shield-halved"></i> ${t('ذخیره در خزانه رمزنگاری‌شده برنامه', 'Save in the encrypted vault')}</button>
<button type="button" id="sshGenDiscard" class="danger"><i class="fas fa-trash"></i> ${t('دور انداختن', 'Discard')}</button>
</div>
`;
		element('sshGenCopyPub')?.addEventListener('click', () => copyText(generated.publicKeyLine));
		element('sshGenDownloadPub')?.addEventListener('click', () => downloadText(`${generated.fileName}.pub`, `${generated.publicKeyLine}\n`));
		element('sshGenTogglePrivate')?.addEventListener('click', () => {
			element('sshGenPrivateText')?.classList.toggle('masked');
		});
		element('sshGenCopyPriv')?.addEventListener('click', () => copyText(generated.privateKeyPem));
		element('sshGenDownloadPriv')?.addEventListener('click', () => downloadText(generated.fileName, generated.privateKeyPem));
		element('sshGenSave')?.addEventListener('click', () => {
			addKeyRecord({
				id: randomId(),
				name: generated.name,
				keyType: generated.type,
				comment: generated.comment,
				publicKeyLine: generated.publicKeyLine,
				privateKeyPem: generated.privateKeyPem,
				fingerprint: generated.fingerprint,
				createdAt: new Date().toISOString(),
				source: 'generated',
			});
			state.generated = null;
			renderGeneratedPanel();
		});
		element('sshGenDiscard')?.addEventListener('click', () => {
			state.generated = null;
			renderGeneratedPanel();
		});
	}
	function updateDeviceHint() {
		const hint = element('sshDeviceHint');
		if (!hint) return;
		const openBtn = element('sshOpenDeviceDirBtn');
		const pickBtn = element('sshPickFolderBtn');
		if (nativeSsh()) {
			if (openBtn) openBtn.classList.remove('hidden');
			if (pickBtn) pickBtn.classList.add('hidden');
			hint.textContent = t(
				'نسخهٔ نیتیو مستقیماً به ~/.ssh دسترسی دارد — نیازی به انتخاب پوشه نیست. کلیدهای خصوصی با دسترسی 600 و authorized_keys با 600 نوشته می‌شوند.',
				'The native build reaches ~/.ssh directly — no folder picker involved. Private keys are written with mode 600 and authorized_keys with 600.',
			);
			return;
		}
		if (fsAccessSupported()) {
			if (openBtn) openBtn.classList.remove('hidden');
			if (pickBtn) pickBtn.classList.add('hidden');
			hint.textContent = t(
				'در پنجرهٔ بازشده پوشه خانه (Home) را انتخاب کنید تا برنامه خودش وارد پوشهٔ مخفی ‎.ssh شود؛ یا پوشهٔ ‎.ssh را از فایل‌منیجر روی ناحیهٔ بالا بکشید و رها کنید.',
				'In the dialog pick your Home folder — the app enters the hidden .ssh folder itself; or drag & drop the .ssh folder onto the zone above.',
			);
			return;
		}
		if (openBtn) openBtn.classList.add('hidden');
		const platform = detectPlatform();
		if (pickBtn) pickBtn.classList.toggle('hidden', platform.mobile);
		if (platform.mobile) {
			hint.textContent = t(
				'در موبایل دسترسی مستقیم به پوشهٔ ‎.ssh ممکن نیست — کلیدها را در رایانه بسازید و با «ایمپورت از فایل» به این دستگاه بیاورید.',
				'Direct .ssh folder access is not possible on mobile — create keys on a computer and bring them here via "Import from file".',
			);
			return;
		}
		const isApple = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
		hint.textContent = isApple
			? t(
				'این مرورگر انتخاب مستقیم پوشهٔ مخفی را نمی‌دهد: در دیالوگ «انتخاب پوشه» کلید ⌘⇧G را بزنید و مسیر ~/.ssh را تایپ کنید (یا با ⌘⇧. فایل‌های مخفی را نشان دهید). ساده‌تر: پوشهٔ ‎.ssh را از Finder روی ناحیهٔ بالا بکشید و رها کنید.',
				'This browser cannot select a hidden folder directly: in the folder dialog press ⌘⇧G and type ~/.ssh (or press ⌘⇧. to reveal hidden files). Easier: drag the .ssh folder from Finder onto the zone above.',
			)
			: t(
				'این مرورگر انتخاب مستقیم پوشهٔ مخفی را نمی‌دهد: در دیالوگ «انتخاب پوشه» با Ctrl+L مسیر ‎/home/USER/.ssh را تایپ کنید. ساده‌تر: پوشهٔ ‎.ssh را از فایل‌منیجر روی ناحیهٔ بالا بکشید و رها کنید.',
				'This browser cannot select a hidden folder directly: in the folder dialog press Ctrl+L and type /home/USER/.ssh. Easier: drag the .ssh folder from your file manager onto the zone above.',
			);
	}
	/* OpenSSH refuses a private key any other user can read. The bits are only
	   available in the native listing, so this note only ever appears there. */
	function insecureModeNote(entry) {
		const isPrivate = entry.kind === 'private' || entry.kind === 'private-encrypted';
		if (!isPrivate || !entry.mode) return '';
		if (!(entry.mode & 0o077)) return '';
		const octal = entry.mode.toString(8).padStart(3, '0');
		return ` · <span class="ssh-entry-mode-warn">${t('دسترسی ناامن', 'Unsafe mode')} ${octal}</span>`;
	}
	async function deleteDeviceEntry(name) {
		const native = nativeSsh();
		if (!native || !name) return;
		if (!await PoorijaDialogs.confirm(t(
			`فایل «${name}» با بازنویسی امن از ~/.ssh حذف شود؟ این کار برگشت‌پذیر نیست.`,
			`Securely overwrite and remove "${name}" from ~/.ssh? This cannot be undone.`,
		))) return;
		try {
			await native.sshDelete(name);
			notify(t(`«${name}» بازنویسی و حذف شد.`, `"${name}" was overwritten and removed.`), 'success');
			await scanDeviceKeys();
		} catch (error) {
			console.error(error);
			notify(t('حذف ناموفق بود: ', 'Delete failed: ') + String(error?.message || error), 'error');
		}
	}
	/* Breadcrumb for folder navigation inside ~/.ssh — always shows the root,
	   then each descended folder. */
	function renderDeviceBreadcrumb() {
		const root = state.device?.rootName || '~/.ssh';
		const parts = String(state.sshSubpath || '').split('/').filter(Boolean);
		if (!parts.length) return `<b dir="ltr">${escapeHTML(root)}</b>`;
		return `<b dir="ltr">${escapeHTML(root)} / ${parts.map((part) => escapeHTML(part)).join(' / ')}</b>`;
	}
	function renderDevicePanel() {
		const statusEl = element('sshDeviceStatus');
		const listEl = element('sshDeviceFiles');
		if (!statusEl || !listEl) return;
		updateDeviceHint();
		if (!state.device) {
			statusEl.textContent = t('پوشه‌ای باز نشده است.', 'No folder opened yet.');
			listEl.innerHTML = '';
			return;
		}
		const nativeBadge = deviceIsNative()
			? ` <span class="ssh-ro-badge" title="${t('دسترسی مستقیم بومی به ~/.ssh', 'Direct native access to ~/.ssh')}"><i class="fas fa-bolt"></i> ${t('دسترسی کامل', 'Full access')}</span>`
			: '';
		const roBadge = deviceReadOnly()
			? ` <span class="ssh-ro-badge" title="${t('این مرورگر فقط خواندن اجازه می‌دهد — نوشتن به‌صورت دانلود انجام می‌شود', 'This browser allows read-only access — writes are delivered as downloads')}"><i class="fas fa-eye"></i> ${t('فقط‌خواندنی', 'Read-only')}</span>`
			: '';
		statusEl.innerHTML = state.scanning
			? t('در حال خواندن پوشه…', 'Scanning folder…')
			: `${renderDeviceBreadcrumb()} — ${state.deviceEntries.length} ${t('فایل مرتبط', 'related files')}${nativeBadge}${roBadge}`;
		const foldersHtml = (deviceIsNative() && state.sshSubpath)
			? `<div class="ssh-device-row"><button type="button" class="ssh-device-import" data-ssh-folder-up><i class="fas fa-arrow-up"></i> ${t('پوشهٔ بالاتر (~/.ssh)', 'Parent folder (~/.ssh)')}</button></div>`
			: '';
		const folderRowsHtml = (deviceIsNative() ? (state.deviceFolders || []) : []).map((name) => `
<div class="ssh-device-row">
<div class="min-w-0">
<div class="text-sm text-white truncate"><i class="fas fa-folder"></i> ${escapeHTML(name)}</div>
<div class="text-xs text-slate-400">${t('پوشه — برای دیدن کلیدها کلیک کنید', 'Folder — click to open')}</div>
</div>
<button type="button" class="ssh-device-import" data-ssh-folder-open="${escapeHTML(name)}"><i class="fas fa-folder-open"></i> ${t('باز کردن', 'Open')}</button>
</div>`).join('');
		const knownHostsEntry = state.deviceEntries.find((entry) => entry.name === 'known_hosts');
		const knownHostsHtml = (deviceIsNative() && knownHostsEntry)
			? `<div class="ssh-device-row"><button type="button" class="ssh-device-import" data-ssh-known-hosts><i class="fas fa-server"></i> ${t('مدیریت known_hosts', 'Manage known_hosts')}</button></div><div id="sshKnownHostsPanel"></div>`
			: '';
		listEl.innerHTML = foldersHtml + folderRowsHtml + knownHostsHtml + state.deviceEntries.map((entry) => `
<div class="ssh-device-row">
<div class="min-w-0">
<div class="text-sm text-white truncate"><i class="fas ${entry.kind === 'private' || entry.kind === 'private-encrypted' ? 'fa-lock' : entry.kind === 'public' ? 'fa-key' : 'fa-file-lines'}"></i> ${escapeHTML(entry.name)}</div>
<div class="text-xs text-slate-400">${escapeHTML(entry.kind === 'public' ? t('کلید عمومی', 'Public key') : entry.kind === 'private' ? t('کلید خصوصی OpenSSH', 'OpenSSH private key') : entry.kind === 'private-encrypted' ? t('کلید خصوصی رمزشده (پسورد)', 'Encrypted private key') : entry.kind === 'meta' ? t('فایل پیکربندی', 'Config file') : t('نامشخص', 'Unknown'))}${entry.parsed && entry.parsed.fingerprint ? ` · ${escapeHTML(maskFingerprint(entry.parsed.fingerprint))}` : ''}${insecureModeNote(entry)}</div>
</div>
${entry.kind === 'public' || entry.kind === 'private' ? `<button type="button" class="ssh-device-import" data-ssh-device-import="${escapeHTML(entry.name)}"><i class="fas fa-file-import"></i> ${t('ایمپورت', 'Import')}</button>` : ''}
${deviceIsNative() ? `<button type="button" class="ssh-device-import" data-ssh-device-delete="${escapeHTML(entry.name)}"><i class="fas fa-eraser"></i> ${t('امحاء', 'Shred')}</button>` : ''}
</div>
`).join('');
		listEl.querySelectorAll('[data-ssh-device-import]').forEach((button) => {
			button.addEventListener('click', () => importDeviceEntry(button.getAttribute('data-ssh-device-import')));
		});
		listEl.querySelectorAll('[data-ssh-device-delete]').forEach((button) => {
			button.addEventListener('click', () => deleteDeviceEntry(button.getAttribute('data-ssh-device-delete')));
		});
		listEl.querySelectorAll('[data-ssh-folder-open]').forEach((button) => {
			button.addEventListener('click', () => {
				const name = button.getAttribute('data-ssh-folder-open');
				state.sshSubpath = state.sshSubpath ? `${state.sshSubpath}/${name}` : name;
				scanDeviceKeys();
			});
		});
		listEl.querySelector('[data-ssh-folder-up]')?.addEventListener('click', () => {
			const parts = String(state.sshSubpath || '').split('/').filter(Boolean);
			parts.pop();
			state.sshSubpath = parts.join('/');
			scanDeviceKeys();
		});
		listEl.querySelector('[data-ssh-known-hosts]')?.addEventListener('click', () => {
			renderKnownHostsManager().catch(console.error);
		});
	}

	/* ---------------- known_hosts manager ----------------
	 * Parses the file line by line and groups the entries per host, so a
	 * stale key can be removed or rewritten with one click. Hashed entries
	 * (|1|...) cannot be decoded without the site key — they show as hashed
	 * and are editable/deletable as whole lines. */
	function parseKnownHosts(text) {
		const lines = String(text || '').split(/\r?\n/);
		const groups = [];
		lines.forEach((line, index) => {
			if (!line.trim()) return;
			const hashed = /^\|1\|/.test(line.trim());
			let hosts = hashed ? [t('( hashed )', '(hashed)')] : [];
			let keyType = '';
			let keyBlob = '';
			let comment = '';
			if (!hashed) {
				const parts = line.trim().split(/\s+/);
				hosts = (parts[0] || '').split(',').filter(Boolean);
				keyType = parts[1] || '';
				keyBlob = parts[2] || '';
				comment = parts.slice(3).join(' ');
			} else {
				const parts = line.trim().split(/\s+/);
				keyType = parts[1] || '';
				keyBlob = parts[2] || '';
			}
			groups.push({ index, line, hosts, keyType, keyBlob, comment, hashed });
		});
		return { lines, groups };
	}
	async function renderKnownHostsManager() {
		const panel = document.getElementById('sshKnownHostsPanel');
		if (!panel) return;
		let text = '';
		try {
			text = await (deviceIsNative() ? nativeSsh().sshRead('known_hosts', state.sshSubpath || null) : Promise.resolve(''));
		} catch (_error) {
			panel.innerHTML = `<div class="ssh-device-row">${t('خواندن known_hosts ناموفق بود.', 'Could not read known_hosts.')}</div>`;
			return;
		}
		const { groups } = parseKnownHosts(text);
		const rows = groups.map((group) => {
			const hostLabel = group.hashed
				? `<span class="text-xs text-slate-400" dir="ltr">${escapeHTML(group.keyType || 'ssh')} · ${t('هش‌شده', 'hashed')}</span>`
				: `<span class="text-sm text-white" dir="ltr">${group.hosts.map((host) => escapeHTML(host)).join(', ')}</span>`;
			const keyShort = group.keyBlob ? `${escapeHTML(group.keyBlob.slice(0, 24))}…` : '';
			return `<div class="ssh-device-row" data-kh-line="${group.index}">
<div class="min-w-0">
${hostLabel}
<div class="text-xs text-slate-400" dir="ltr">${escapeHTML(group.keyType)} ${keyShort}${group.comment ? ` · ${escapeHTML(group.comment)}` : ''}</div>
</div>
<div class="flex gap-2 shrink-0">
<button type="button" class="ssh-device-import" data-kh-edit="${group.index}"><i class="fas fa-pen"></i> ${t('ویرایش', 'Edit')}</button>
<button type="button" class="ssh-device-import" data-kh-delete="${group.index}"><i class="fas fa-trash"></i> ${t('حذف', 'Delete')}</button>
</div>
</div>`;
		}).join('');
		panel.innerHTML = `
<div class="text-sm text-white font-semibold mt-3"><i class="fas fa-server"></i> ${t('known_hosts', 'known_hosts')} — ${groups.length} ${t('میزبان', 'host(s)')}</div>
<p class="text-xs text-slate-400 mb-2">${t('هر میزبان یک ردیف است؛ حذف یا ویرایش بلافاصله در فایل نوشته می‌شود.', 'Each row is one host; deleting or editing writes straight to the file.')}</p>
${rows || `<div class="ssh-device-row">${t('known_hosts خالی است.', 'known_hosts is empty.')}</div>`}`;
		const writeBack = async (lines) => {
			const body = lines.filter((line) => line.trim() !== '').join('\n') + (lines.length ? '\n' : '');
			await nativeSsh().sshWrite('known_hosts', body, false);
			const entry = state.deviceEntries.find((candidate) => candidate.name === 'known_hosts');
			if (entry) entry.text = body;
			await renderKnownHostsManager();
		};
		panel.querySelectorAll('[data-kh-delete]').forEach((button) => {
			button.addEventListener('click', async () => {
				const index = Number(button.getAttribute('data-kh-delete'));
				const { lines } = parseKnownHosts(text);
				lines[index] = '';
				await writeBack(lines);
			});
		});
		panel.querySelectorAll('[data-kh-edit]').forEach((button) => {
			button.addEventListener('click', async () => {
				const index = Number(button.getAttribute('data-kh-edit'));
				const { lines } = parseKnownHosts(text);
			 let updated = '';
			 try {
				 updated = await window.PoorijaDialogs.prompt(
					 t('خط میزبان را ویرایش کنید:', 'Edit the host line:'),
					 { defaultValue: lines[index] || '' },
				 );
			 } catch (_error) {
				 return; /* cancelled */
			 }
			 if (typeof updated !== 'string' || !updated.trim()) return;
			 lines[index] = updated.trim();
			 await writeBack(lines);
			});
		});
	}

	/* ------------------------------------------------------------------
	 * Clipboard / download helpers
	 * ------------------------------------------------------------------ */
	async function copyText(text) {
		try {
			await navigator.clipboard.writeText(text);
			notify(t('کپی شد.', 'Copied.'), 'success');
		} catch (_error) {
			notify(t('کپی ناموفق بود.', 'Copy failed.'), 'error');
		}
	}
	function downloadText(fileName, text) {
		app()?.triggerDownload?.(new Blob([text], { type: 'text/plain' }), fileName);
	}
	function defaultFileName(record) {
		return String(record.name || record.keyType || 'key').replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 48)
			+ (record.keyType.startsWith('ssh-rsa') ? '_rsa' : record.keyType.startsWith('ssh-ed25519') ? '_ed25519' : '');
	}

	/* ------------------------------------------------------------------
	 * Events
	 * ------------------------------------------------------------------ */
	/* initSshModule() runs on unlock, on load, and on EVERY switch to this tab,
	   because the key list has to be refreshed from disk each time. Binding was
	   inside it, so each visit added another delegated click listener to
	   #content-sshkeys — anonymous functions, so addEventListener could not
	   dedupe them. After three visits one press of Delete opened three
	   confirmations in a row: confirm the first and an identical one is already
	   there, which reads exactly like a dialog that refuses to close. Bind once;
	   the refresh is what has to repeat, not the wiring. */
	let domEventsBound = false;
	function bindDomEvents() {
		if (domEventsBound) return;
		domEventsBound = true;
		element('sshGenerateBtn')?.addEventListener('click', async () => {
			const algorithm = element('sshKeyTypeSelect')?.value || 'ed25519';
			const rsaBits = Number(element('sshRsaBitsSelect')?.value || 3072);
			const name = (element('sshKeyNameInput')?.value || '').trim();
			const comment = (element('sshKeyCommentInput')?.value || '').trim() || name;
			const button = element('sshGenerateBtn');
			button.disabled = true;
			try {
				const generated = await generateSshPairSafe({ algorithm, rsaBits, comment });
				generated.name = name || `${algorithm === 'rsa' ? `rsa-${rsaBits}` : 'ed25519'}-${new Date().toISOString().slice(0, 10)}`;
				generated.fileName = `id_${algorithm === 'rsa' ? `rsa_${rsaBits}` : 'ed25519'}_poorija_${String(generated.name).replace(/[^a-zA-Z0-9_-]+/g, '_')}`.slice(0, 70);
				state.generated = generated;
				renderGeneratedPanel();
				notify(t('کلید SSH ساخته شد.', 'SSH key generated.'), 'success');
			} catch (error) {
				console.error(error);
				notify(t('ساخت کلید ناموفق بود.', 'Key generation failed.'), 'error');
			} finally {
				button.disabled = false;
			}
		});
		element('sshRsaBitsWrap')?.classList.toggle('hidden', element('sshKeyTypeSelect')?.value !== 'rsa');
		element('sshKeyTypeSelect')?.addEventListener('change', (event) => {
			element('sshRsaBitsWrap')?.classList.toggle('hidden', event.target.value !== 'rsa');
		});
		element('sshImportFileInput')?.addEventListener('change', async (event) => {
			const files = Array.from(event.target.files || []);
			for (const file of files) {
				try {
					const text = await file.text();
					const record = await buildRecordFromText(text, file.name.replace(/\.(pub|pem)$/i, ''), 'imported');
					if (record) addKeyRecord(record);
					else notify(t(`فایل ${file.name} کلید SSH معتبری نیست.`, `${file.name} is not a valid SSH key.`), 'warning');
				} catch (error) {
					console.error(error);
					notify(t('خواندن فایل ناموفق بود.', 'Could not read the file.'), 'error');
				}
			}
			event.target.value = '';
		});
		element('sshImportBtn')?.addEventListener('click', () => element('sshImportFileInput')?.click());
		element('sshOpenDeviceDirBtn')?.addEventListener('click', openSshDirectory);
		element('sshPickFolderBtn')?.addEventListener('click', pickFolderCompat);
		element('sshRescanDeviceBtn')?.addEventListener('click', scanDeviceKeys);
		element('sshDirInput')?.addEventListener('change', handleDirInput);
		const dropZone = element('sshDropZone');
		dropZone?.addEventListener('dragover', (event) => {
			event.preventDefault();
			dropZone.classList.add('drag-over');
		});
		dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
		dropZone?.addEventListener('drop', handleDeviceDrop);
		element('sshManualPathSaveBtn')?.addEventListener('click', () => {
			const settings = loadSettings();
			settings.manualPath = element('sshManualPathInput')?.value?.trim() || '';
			saveSettings(settings);
			notify(t('مسیر دستی ذخیره شد.', 'Manual path saved.'), 'success');
		});
		document.getElementById('content-sshkeys')?.addEventListener('click', async (event) => {
			const actionButton = event.target.closest('[data-ssh-action]');
			if (!actionButton) return;
			const id = actionButton.getAttribute('data-ssh-id');
			const record = state.keys.find((item) => item.id === id);
			if (!record) return;
			const action = actionButton.getAttribute('data-ssh-action');
			if (action === 'copy-public') await copyText(record.publicKeyLine);
			if (action === 'copy-private') await copyText(record.privateKeyPem || '');
			if (action === 'download-public') downloadText(`${defaultFileName(record)}.pub`, `${record.publicKeyLine}\n`);
			if (action === 'download-private') downloadText(defaultFileName(record), record.privateKeyPem || '');
			if (action === 'toggle-private') {
				document.querySelector(`[data-ssh-private="${CSS.escape(id)}"]`)?.classList.toggle('masked');
			}
			if (action === 'write-device') await writePublicKeyToDevice(record);
			if (action === 'write-private-device') await writePrivateKeyToDevice(record);
			if (action === 'rename') {
				const next = await PoorijaDialogs.prompt(t('نام جدید کلید:', 'New key name:'), record.name || record.keyType);
				if (next !== null && next.trim()) {
					record.name = next.trim();
					persistKeys();
					renderKeyList();
				}
			}
			if (action === 'delete') {
				if (await PoorijaDialogs.confirm(t(`کلید «${record.name || record.keyType}» برای همیشه حذف شود؟`, `Permanently delete "${record.name || record.keyType}"?`))) {
					state.keys = state.keys.filter((item) => item.id !== id);
					persistKeys();
					renderKeyList();
					notify(t('کلید حذف شد.', 'Key deleted.'), 'info');
				}
			}
		});
	}

	async function generateSshPairSafe(options) {
		try {
			const generated = await generateSshKeyPair(options);
			return {
				...generated,
				fingerprint: await fingerprintFromBlob(generated.pubBlob),
				name: '',
				fileName: '',
				comment: options.comment || '',
			};
		} catch (error) {
			// Older Chromium builds lack WebCrypto Ed25519 — fall back to RSA-3072.
			if (options.algorithm === 'ed25519' && error && /NotSupported|not supported/i.test(String(error.message || error.name || ''))) {
				notify(t('این مرورگر Ed25519 را پشتیبانی نمی‌کند؛ به‌جای آن RSA-3072 ساخته شد.', 'This browser lacks Ed25519 support; generated RSA-3072 instead.'), 'warning');
				const generated = await generateSshKeyPair({ algorithm: 'rsa', rsaBits: 3072, comment: options.comment });
				return {
					...generated,
					fingerprint: await fingerprintFromBlob(generated.pubBlob),
					name: '',
					fileName: '',
					comment: options.comment || '',
				};
			}
			throw error;
		}
	}

	/* ------------------------------------------------------------------
	 * Init
	 * ------------------------------------------------------------------ */
	function initSshModule() {
		if (!document.getElementById('content-sshkeys')) return;
		if (!isUnlocked()) return;
		state.keys = loadKeys();
		bindDomEvents();
		renderStaticUi();
		state.initialized = true;
	}
	window.addEventListener('poorija:unlock', (event) => {
		if (!event.detail || event.detail.activeTab === 'sshkeys') initSshModule();
		else if (!state.initialized) initSshModule();
	});
	window.addEventListener('poorija:tab-switched', (event) => {
		if (event.detail && event.detail.tabName === 'sshkeys') initSshModule();
	});
	window.addEventListener('load', () => {
		const appStateRef = window.PoorijaApp?.state;
		if (appStateRef && !appStateRef.isLocked) initSshModule();
	});
})();
