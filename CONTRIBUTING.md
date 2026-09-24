<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="72" align="right">

# Contributing

## Ground rules

**Never commit `.env`, `certs/` or `data/`.** They hold, in order: the monitor
and TURN passwords, TLS private keys, and other people's queued ciphertext.
`.gitignore` covers all three — if you find yourself adding `-f` to `git add`,
stop.

**Bump the cache generation with any front-end change.** `index.html`, `sw.js`
and `js/app.js` share a version string, and the service worker keys its cache on
it. Without a bump, returning web-app users keep the old files and you will
debug a build that is not running:

```bash
OLD=$(grep -o 'chat-v[0-9]*' index.html | head -1)   # read, not spelled out
NEW=chat-v$(( ${OLD#chat-v} + 1 ))
SEMVER=$(node -p "require('./package.json').version")   # read, not spelled out
sed -i '' "s/[0-9.]*-$OLD/$SEMVER-$NEW/g" index.html sw.js js/app.js
sed -i '' "s/return '$OLD';/return '$NEW';/" js/app.js   # APP_BUILD_TAG fallback
node tools/check-versions.cjs   # refuses if any of the eight declarations drift
```

The old tag is read out of `index.html` rather than written into the example. Spelling it out means the next bump's own sed rewrites the instructions, and they drift behind the tree until somebody notices — which they did, three times.

Two commands, not one. `APP_BUILD_TAG` in `js/app.js` falls back to the bare
`chat-vNN` with no version in front of it, so the first sed steps straight over
it; the guard is what catches the miss. The tag has also not been `offline-vN`
for a long time, so an older form of this command silently matched nothing and
reported success — read the guard's output rather than the command's exit code.
`HANDOFF.md` carries the tag in prose rather than as a live string, so it is not
in the sed list; update it by hand when the shape of the tag changes.

**Bump it for any change to a cached file, not only to `index.html`.** The
`?v=` on each `<script>` is the whole cache key: edit `js/help-content.js` and
leave the tag alone and every installed copy keeps serving the old file from
the service worker cache, and any native build made before the edit ships the
old file too.

## Getting set up

```bash
npm install
npm run relay            # terminal 1 — the signalling and mailbox server
PORT=8123 npm run dev    # terminal 2 — static files
```

Then open http://localhost:8123.

## Before you open a pull request

```bash
npm run test:files
npm run test:offline
npm run test:retention
npm run test:keytrust          # pinned keys, and the warning when one changes
npm run test:fs                # forward secrecy and the 15-day prekey window
npm run test:wipe              # the emergency wipe, from both doors
npm run test:push              # background push, from consent to expiry
npm run native:prepare && npm run test:native
PKG_URL=http://localhost:8123 npm run test:smoke
npm run test:rust
```

If you touched anything the native shell relies on, build one desktop target
and run `npm run verify:artifacts` — it proves the bundle actually embeds your
change rather than a stale `dist/tauri`.

## House style

Every suite in `tests/e2e/` opens with the bug it was written for. Keep that
habit: a test that only says what it checks tells the next person nothing about
why it exists. The same goes for comments in the source — explain the reason,
especially where the obvious approach was tried and failed.

Match the surrounding code. `js/chat.js` and `js/app.js` are not indented inside
top-level blocks; `scripts/` and `src-tauri/` are conventionally formatted.
Follow whichever file you are in.

## Patched dependencies

`vendor/` holds third-party code we ship as-is, with one exception. Before you
replace anything in there with a fresh upstream copy, open the file and look for
a patch note at the top.

`vendor/qrcodejs/qrcode.min.js` carries one. Its UTF-8 encoder reuses a scratch
array across the character loop without ever shortening it, so after the first
multi-byte character every ASCII character is written twice; meanwhile the code
that picks the QR version measures correctly, and the two disagree by the number
of spaces in the text. The result is that any Persian sentence fails to encode
at all. Re-downloading upstream brings the bug straight back, and it will look
like a fresh regression in the QR bridge rather than a lost patch — which is
why the note is in the file and this paragraph is here.

## Reporting a security issue

Please do not open a public issue. Email **p00rija@tutamail.com** so a fix can
ship before the details are public. [SECURITY.md](SECURITY.md) says what is in
scope, what gets fixed, and which limits are deliberate rather than bugs.
