<div align="center">

<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="120" height="120">

# P00RIJÃ Cryptography Suite

**A complete, offline-first encryption workbench and end-to-end encrypted messenger — in one app, on every platform.**

[فارسی](#فارسی) · [English](#english)

![version](https://img.shields.io/badge/version-2.44.0-0ea5e9?style=for-the-badge)
![platforms](https://img.shields.io/badge/macOS%20·%20Windows%20·%20Linux%20·%20Android%20·%20iOS%20·%20PWA-1e293b?style=for-the-badge)
![crypto](https://img.shields.io/badge/AES--256--GCM%20·%20RSA--OAEP--3072%20·%20Argon2id-10b981?style=for-the-badge)
![offline](https://img.shields.io/badge/works%20fully%20offline-8b5cf6?style=for-the-badge)

[![donate](https://img.shields.io/badge/%E2%99%A5%20donate%20TON%20%C2%B7%20%D8%AD%D9%85%D8%A7%DB%8C%D8%AA-0098EA?style=for-the-badge&logo=ton&logoColor=white)](#support-this--%D8%AD%D9%85%D8%A7%DB%8C%D8%AA)

**Free, AGPL, no ads, no telemetry, no account.** That warning you saw? It is
there because nobody has paid any company anything for the right to sell your
data on. ♥
**[Support this](#support-this--%D8%AD%D9%85%D8%A7%DB%8C%D8%AA)**

<span dir="rtl">

**رایگان، AGPL، بدون تبلیغات، بدون تله‌متری، بدون حساب کاربری.** آن هشداری که
نشانت داد؟ چون کسی هیچ پولی به هیچ شرکتی برای فروش اطلاعات شما به دیگران نداده
است. ♥
**[حمایت کنید](#support-this--%D8%AD%D9%85%D8%A7%DB%8C%D8%AA)**

</span>

</div>

---

## Support this · حمایت

<div align="center">

**TON — Telegram Wallet**

</div>

```
UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf
```

[Open Telegram Wallet](https://t.me/wallet) · [Open a prefilled transfer](https://app.tonkeeper.com/transfer/UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf) · or scan the QR inside the app: **About → Support the project**

<table>
<tr><td>

**Why this asks at all.** Every friction you met installing this is a bill that
went unpaid. macOS called the app damaged because Apple notarization is $99 a
year. Windows showed SmartScreen because an EV certificate is several hundred
more. Google Play wants a developer account. The relay that carries your sealed
envelopes, and the TURN server that forwards call media it cannot decrypt, are
rented by the month.

None of that is charged to you. There is no paid tier, no telemetry, no
analytics, no account, and nothing here can read your files, your keys or your
messages — which is the whole point, and also why this cannot be funded the
usual way: there is no data to sell.

So it runs on whatever people send. If it has been useful, TON to the address
above helps. If it has not, the source is right here and it is AGPL — take it,
build it, run your own relay, and owe nobody anything. That is also a good
outcome.

</td><td>

<div dir="rtl">

**چرا اصلاً درخواست می‌شود.** هر دردسری که موقع نصب دیدی، قبضی است که پرداخت
نشده. مک گفت برنامه آسیب دیده، چون نوتاریزهٔ اپل سالی ۹۹ دلار است. ویندوز
SmartScreen نشان داد، چون گواهی EV چند صد دلار دیگر می‌خواهد. گوگل‌پلی حساب
توسعه‌دهنده می‌خواهد. رله‌ای که پاکت‌های مهرشدهٔ تو را حمل می‌کند و سرور TURN که
بستهٔ تماس را بدون توانایی رمزگشایی جابه‌جا می‌کند، ماهانه اجاره‌اند.

هیچ‌کدام از اینها از تو گرفته نمی‌شود. نه نسخهٔ پولی هست، نه تله‌متری، نه آنالیتیکس،
نه حساب کاربری، و هیچ‌چیز اینجا نمی‌تواند فایل‌ها، کلیدها یا پیام‌هایت را بخواند —
که کل هدف همین است، و دقیقاً دلیل اینکه این پروژه را نمی‌شود به روش معمول تأمین
مالی کرد: داده‌ای برای فروش وجود ندارد.

پس با هرچه مردم می‌فرستند می‌چرخد. اگر به کارت آمده، TON به آدرس بالا کمک می‌کند.
اگر نیامده، کد همین‌جاست و AGPL است — برش دار، بسازش، رلهٔ خودت را بالا بیاور، و
به هیچ‌کس بدهکار نباش. آن هم نتیجهٔ خوبی است.

</div>

</td></tr>
</table>

---

## English

### What it is

Twenty tools behind one lock. Every byte is encrypted **in your browser or on your
machine** — there is no server that can read your files, your notes, your keys or
your messages. The only things that ever talk to a server are the chat relay
(which carries sealed envelopes it cannot open) and the TURN server (which
forwards media packets it cannot decrypt).

It runs as a native desktop app, as an Android app, and as an installable web app
on any device, including iPhone. The same code, the same vault, the same keys.

### The twenty-eight tools

| | Tool | ابزار | What it does |
|---|---|---|---|
| 🔐 | **Encrypt** | رمزنگاری | Any file, any size, AES-256-GCM with an Argon2id-derived key |
| 🔓 | **Decrypt** | رمزگشایی | The other half, including bundles made on another device |
| ✍️ | **Text Encryption** | رمزنگاری نوشتاری | Encrypt a message to paste anywhere — mail, SMS, a forum |
| 💣 | **Self-Destruct Messages** | پیام‌های خودتخریب | Ciphertext with an expiry and a view limit built in |
| 🖼️ | **Steganography** | پنهان‌نگاری | Hide an encrypted message inside an ordinary image |
| 🔑 | **Passwords** | رمزهای عبور | Strength analysis, generation, and a local encrypted store |
| 🧙 | **Smart Wizard** | ویزارد هوشمند | Pick the situation; the app picks the safest settings |
| 🛡️ | **Security Center** | مرکز سلامت امنیت | One screen that audits how exposed this installation is |
| 📤 | **Secure Share** | اشتراک امن | Sealed bundles and links with expiry and view caps |
| 💬 | **Secure Chat** | چت امن | The messenger — see below |
| 📝 | **Secure Notes** | یادداشت‌های امن | Notes encrypted in the local vault |
| 🖋️ | **Digital Signatures** | امضای دیجیتال | Sign and verify, so a file proves who made it |
| 🗝️ | **Key Management** | مدیریت کلیدها | Generate, import, export, rotate, back up |
| 🖥️ | **SSH Keys** | کلیدهای SSH | Generate and manage real SSH keypairs, written to `~/.ssh` |
| 🔥 | **File Shredder** | امحای فایل | Multi-pass overwrite; the file does not come back |
| #️⃣ | **Hash Checker** | بررسی هش | SHA-256 / SHA-512 verification against a published digest |
| 📦 | **Migration** | مهاجرت | Move the whole encrypted vault to another device |
| 📁 | **File Manager** | مدیریت فایل‌ها | Everything the app has received or produced, in one encrypted place |
| 🌊 | **Voice Changer** | تغییر صدا | Alter a recording's voice before it is sent, or on its own |
| 🏷️ | **Metadata** | متادیتا | Read, edit and strip what a photo or video says about you |
| 📱 | **QR Bridge** | پل QR | Move ciphertext between devices as a sequence of QR codes |
| 📡 | **Local Link** | پیوند محلی | Two devices, one Wi-Fi, an encrypted channel and no server — see below |
| 🔢 | **Authenticator** | کدساز دومرحله‌ای | TOTP codes generated here; the secrets stay in the vault |
| 👁️ | **Character Inspector** | بازرس نویسه | Finds invisible, bidirectional and look-alike characters in text |
| 🔁 | **Convert Bench** | میز تبدیل | Ten conversions between text, base64, hex and bytes |
| ⚙️ | **Settings** | تنظیمات | 15 themes, bilingual UI, typography, biometrics, 2FA |
| ❓ | **Help** | راهنما | Built in, offline, in both languages |
| ℹ️ | **About** | درباره ما | Versions, licences, credits — and a hidden arcade behind the logo |

### Secure Chat

End-to-end encrypted messaging that keeps working when the other person is not there.

- **Peer-to-peer first.** WebRTC data channels carry messages, files and calls
  directly between devices. The relay is only a fallback and a mailbox.
- **Sealed offline delivery.** Write to someone who is offline and the message is
  encrypted to *their* public key, queued on the relay, and delivered when they
  connect. The relay stores ciphertext it has no key for.
- **Every message type survives the queue** — text, files, stickers, polls,
  location, contact cards, voice notes and secret messages.
- **Files up to 4 GB** between two people who are both online — the bytes go
  peer to peer, so the ceiling is the devices, not a server — and up to 100 MB
  queued for somebody who is away. Streamed in encrypted 64 KB chunks with
  per-chunk IVs and real backpressure; the receiver moves each finished run
  into the blob store as it arrives, so neither side ever holds the file in
  memory. Telegram-style progress read-out with speed and ETA.
- **Voice and video calls** with screen sharing, reactions, mirroring, PiP and
  device pickers. Every finished call is written into the conversation as one
  line, and that line is the redial button — tap it and the same call goes out
  again.
- **A status of your own**, carried with your presence record, shown in a pill
  at the top of your chat on the other side's screen.
- **A chat lock that takes the digits your keyboard gives it** — a PIN typed in
  Persian or Arabic digits opens a lock that was set in English ones.
- **An address book of people, not of everyone.** The relay tells every client
  who else is online — that is how discovery connects calls and sessions — but
  only someone you added, pinned, hold a session key with, or have exchanged a
  message with is written to your device. Nobody else is ever listed: there is
  no "online on the relay" directory, and a stranger enters through an explicit
  act (a shared contact card, a pasted id, a conversation), never a broadcast.
- **Groups** where the whole history — files and stickers included — syncs to a
  member's device when they come back.
- **Self-destruct timers that start when the message is read**, not when it was
  sent, so a message that waited three days in the queue still gets its full life.
- Retention: text is kept until delivered; media expires after 7 days leaving
  only a log entry, and the recipient is told what they missed.

### Quick install — server

One line on a fresh Debian, Ubuntu, Fedora or Arch machine:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/quick-install.sh | bash
```

That installs the prerequisites, clones the repository, asks for the port
(default 8585), generates a self-signed certificate and starts the containers.
With a real domain and a real certificate:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/quick-install.sh | bash -s -- --domain chat.example.com --letsencrypt --email you@example.com
```

Piping a script from the internet into a shell deserves the caution it gets.
Read [`scripts/quick-install.sh`](scripts/quick-install.sh) first, or do it by hand:

```bash
git clone https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY.git
cd P00RIJA-CRYPTOGRAPHY
bash scripts/setup.sh
```

`scripts/setup.sh` with no arguments opens the full wizard: local, domain or

### Quick install — desktop and phone

```bash
npx p00rija-cryptography@latest
```

Downloads the right native installer for your platform. With `--pwa` it serves
the web payload locally and opens it in a browser tab — no install at all.

Or take a package from the [releases](../../releases) directly. None of them is
signed with an Apple, Microsoft or Google certificate, so macOS, Windows and
Android each show one first-run warning — [INSTALL.md](INSTALL.md) walks through
all three, and through verifying the download.

### Self-signed certificates

Certificates for an **IP address** are always self-signed: public certificate
authorities (Let's Encrypt included) do not issue certificates for bare IPs —
that is a rule of the CA system, not of this installer. The wizard generates
them automatically with every LAN IP baked in. A **domain** pointed at the
server can get a free, trusted Let's Encrypt certificate through the same
wizard (option 2 under Domain setup). Self-signed installs show a one-time
browser warning; accepting it is safe on your own machine.
public-IP deployment, existing certificates or Let's Encrypt or self-signed,
plus update-in-place, container rebuild and factory reset. `--quick` runs the
same steps with no questions.

When it finishes it prints the application URL, the monitor URL and a generated
monitor password. The password exists only in `.env`.

### Manual install — server, step by step

The wizard does exactly this; run it by hand if you would rather see every step.

```bash
# 1. prerequisites: docker with the compose plugin, git, openssl
git clone https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY.git
cd P00RIJA-CRYPTOGRAPHY

# 2. a certificate. Self-signed is fine for a LAN or an IP address:
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=$(hostname -f)"
# ...or point SSL_CERT_PATH/SSL_KEY_PATH at a real one (Let's Encrypt, a CA).

# 3. the environment. Every value is read by config/docker-compose.yaml:
cat > .env <<'ENV'
DOMAIN=chat.example.com          # or the machine's IP
EXTERNAL_IP=203.0.113.10         # what clients will reach; used by coturn
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
MONITOR_PASSWORD=at-least-12-characters
TURN_PASSWORD=another-long-secret
CHAT_ALLOWED_ORIGINS=https://chat.example.com:8585
ENV

# 4. bring it up
docker compose --env-file .env -f config/docker-compose.yaml up -d --build
```

Four containers come up: the web app and relay (`poorija-cryptography`,
`chat-signal`), the TURN server (`coturn`) and the certificate renewer
(`cert-renewer`). The app is served on **:8585** over HTTPS; the monitoring
dashboard is at `/Monitor_Server` with the password from `.env`.

To check it: `curl -k https://localhost:8585/chat-health` should answer `ok`.

### Quick install — client

| Platform | File | Notes |
|---|---|---|
| macOS (Apple silicon) | `P00RIJA Cryptography_2.44.0_aarch64.dmg` | ad-hoc signed |
| macOS (Intel + Apple silicon) | `P00RIJA Cryptography_2.44.0_universal.dmg` | |
| Windows x64 / ARM64 | `..._x64-setup.exe` / `..._arm64-setup.exe` | NSIS installer |
| Debian / Ubuntu | `..._amd64.deb` / `..._arm64.deb` | |
| Fedora / RHEL | `...x86_64.rpm` / `...aarch64.rpm` | |
| Arch | `...-x86_64.pkg.tar.zst` | |
| Any Linux | `..._amd64.AppImage` | `chmod +x` and run |
| Any Linux (no install) | `...-linux-x86_64.tar.gz` | portable |
| Android | `P00RIJA-Cryptography-2.44.0-universal.apk` | built from `npm run android:build` |
| iPhone / iPad | — | install the web app from the site: Share → Add to Home Screen. A native `.ipa` needs a paid Apple Developer account; see [MOBILE_BUILD.md](MOBILE_BUILD.md) |

The desktop and Android builds ship knowing the public relay, so a fresh install
connects without typing an address. Point it anywhere else in
**Secure Chat → Settings → Connection**.

### Build it yourself

```bash
npm install
npm run native:prepare               # stage the web payload for the native shell

npm run native:build:mac:universal   # .app + .dmg, Intel and Apple silicon
npm run native:build:mac:arm64       # or just this machine's architecture
npm run native:build:linux:docker    # .deb, .rpm, .AppImage and the Arch package
npm run native:build:linux:docker:arm64
npm run native:package:linux:portable  # the no-install tarballs
npm run native:build:windows:docker    # NSIS installer, from any host
npm run android:build                  # signed .apk
npm run ios:build                      # .ipa — needs an Apple signing team

npm run export                       # collect everything into Export/
npm run verify:artifacts             # prove each bundle embeds the current source
```

Linux and Windows bundles are produced in containers, because a `.deb` needs
dpkg and an NSIS installer needs Wine — neither belongs on a Mac. Everything
else builds natively. iOS is the one target that cannot be finished here: an
`.ipa` for anyone else's device needs a paid Apple Developer account, so iOS
ships as the installable web app. [MOBILE_BUILD.md](MOBILE_BUILD.md) sets out
what a free account can and cannot do.

`bash scripts/native-build-wizard.sh` does the same behind a menu.

### What the native build adds, and what it cannot do

The desktop app is the same web payload inside a Tauri shell, so every feature
above is present — and the shell adds the four things a browser tab cannot do:
operating-system notifications, a tray icon, biometric unlock through the
platform's own local authentication, and a window that survives being closed.

**Icon profiles.** Settings offers seven appearance profiles, four of which are
deliberately unremarkable — a folder, a notes app, a terminal, a settings panel.
The point is that a glance at somebody's taskbar does not say "encryption app".

What each platform can actually do with that differs, and the app says so rather
than implying otherwise:

| platform | what changes |
|---|---|
| Windows | the window and taskbar icon, immediately |
| Linux | the window and taskbar icon, immediately |
| macOS | the tray icon only — a window there has no icon of its own, the Dock shows the bundle's, and Tauri exposes no way to replace a running app's Dock tile |

The installer's own icon always comes from the built bundle on every platform.

The artwork lives in `assets/desktop-icons/*.svg` and is rendered to the PNGs
the shell embeds by `scripts/build-icon-profiles.sh`. Those PNGs are committed,
so a build machine needs no rasteriser; run the script and commit its output
after changing any SVG.

### Building the desktop packages

```bash
npm install
npm run native:prepare               # stage the web payload for the native shell

npm run native:build:mac:universal   # .app + .dmg, Intel and Apple silicon in one
npm run native:build:linux:docker    # .deb, .rpm, .AppImage and the Arch package
npm run native:build:linux:docker:arm64
npm run native:package:linux:portable  # the no-install tarballs
npm run native:build:windows:docker    # NSIS installer, from any host

npm run export                       # collect everything built into Export/
```

`npm run export` copies rather than moves, so rebuilding one platform refreshes
just that platform. Anything not yet built is named in the summary instead of
being silently skipped — a partial export should look partial.

**About the Arch package:** Tauri produces it alongside the rpm but it is not
selectable by name — `--bundles` accepts only `deb`, `rpm` and `appimage` and
refuses `pacman`. The `.pkg.tar.zst` appears in the bundle root, which is where
the export script picks it up from.

**Signing.** The macOS build is ad-hoc signed, which is fine on the machine that
made it and will be quarantined by Gatekeeper after a download. For distribution
set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID`,
and notarize the .dmg. The Windows and Linux packages are unsigned.

**The source goes with them.** `npm run export` also writes
`Export/Source/p00rija-cryptography-<version>-source.tar.gz` and a `COMMIT.txt`
naming the commit it came from. Since none of the binaries above are signed by
anyone you can check, the archive is what makes them auditable: read the source,
rebuild it, compare. It is produced with `git archive` rather than `tar` of the
directory — that emits only what is committed, so `node_modules`, `dist/`,
`Export/` and the three things that must never leave the build machine
(`.env`, `certs/`, and `data/`, which holds the Web Push private key) cannot
end up inside it by accident. If the working tree is dirty when you export, the
`COMMIT.txt` says so, because then the archive is not what was built.

### Working with no server at all

There are two ways to keep talking when the infrastructure is gone, and they
answer different situations.

**A relay on the local network.** Someone runs the server on a laptop or a
phone and everyone else points at it. This already worked; what did not work was
reading `http://192.168.1.34:9000` aloud across a room. Secure Chat → Settings
now has **Show address as QR** on the machine that has the address, and **Read
address from QR** on every other one. Nothing leaves the local network, and the
international internet can be down the whole time.

**No server at all.** The **Local Link** tab connects devices on the same Wi-Fi
directly, with no relay, no STUN and no TURN. One device presses *Start a new
link* and shows a code; the other scans it and shows its reply; after that there
is an encrypted channel between them carrying messages and files of any type.

How it works, and why it can: WebRTC connects two peers happily over host
candidates alone. The only part that normally needs a server is the
introduction — and an introduction only needs a channel the two devices share,
which a screen and a camera are. The session descriptions come to roughly
1 550 characters, one QR code in each direction.

**No camera needed either.** Every code is also offered as text, to copy or to
save as a file. A desktop with no webcam pairs by pasting two short strings, and
the result is the same connection with the same key.

**More than two people.** A finished link is a room, and the room takes up to
sixteen. Joining costs one pairing with whoever is hosting, however many people
are already there: the host introduces the newcomer to everyone else over the
connections that already exist, and after that each pair talks directly. The
host brokers the introduction and cannot read what follows — every pair derives
its own key, which the test suite checks by handing one member's key another
member's traffic and confirming it is refused.

Inside a room: messages, stickers, polls with a live tally, reactions, files
with **no size limit**, and voice or video calls, one-to-one or with everybody.
A file large enough to matter says what it will cost the network before it goes,
rather than being refused; a video call in a crowded room says the same about
cameras. Nothing in a room is written to disk, and the transcript does not
survive into the next one.

Three properties worth knowing:

- **It cannot leave the local network.** The connection is created with no ICE
  servers, so the only candidates that exist are host candidates. This is
  enforced by construction, not by a setting, and the test suite asserts that no
  `srflx` or `relay` candidate ever appears.
- **The trust is stronger here than anywhere else in the app.** Each side's ECDH
  public key travels inside its own QR code, so the key arrives through your eyes
  and your camera rather than over a wire. Nothing in between can substitute it
  without you pointing the camera at a different screen. The six-word safety
  phrase is derived from both keys: if the two devices show different phrases,
  disconnect.
- **Traffic is sealed twice.** WebRTC's own DTLS protects the hop; an
  AES-256-GCM layer keyed by ECDH+HKDF protects the payload, and only the second
  one is bound to the key that came through the camera.

**The one thing that stops it:** most guest and public Wi-Fi networks are
configured to prevent devices from seeing each other ("client isolation"). No
browser can work around that. A personal hotspot has no such restriction.

**What is not offered, and why: Bluetooth.** Web Bluetooth can only act as a
GATT *central* — a browser cannot advertise itself as a peripheral — so two
copies of this app can never see each other over it, and Safari and iOS never
shipped the API at all. A native Bluetooth transport is possible in principle
but peripheral mode is unreliable on mobile and practical throughput is on the
order of 1–2 KB/s. Wi-Fi Direct is not exposed to browsers either. Same-network
Wi-Fi is the honest answer, so it is the one implemented.

### Locks, and what happens when somebody keeps guessing

Three things can be locked, and each is separate: **Secure Chat** as a whole,
**one conversation**, and **one group**. A lock hides a conversation on a device
that is already unlocked. It is not a second layer of encryption — the messages
are encrypted either way — and the app says so on the lock screen rather than
implying more.

**Locking on the spot.** A lock re-locks on a timer, which is right for walking
away from a desk and useless for the case it is most often wanted in: handing
somebody the phone to show them one photograph. The conversation menu has **Lock
this chat**, enabled once a PIN is set. On a phone it closes the thread and
returns to the list; on a desktop the conversation stays selected and a lock
card takes the place of the messages, because a desktop has a second panel worth
using. Either way nothing readable is left on the screen.

**Biometrics, as an option.** If the app's own biometric unlock is on, every
lock offers it too, with its own button beside the PIN — the same pairing the
app's lock screen has. The PIN always works; declining the sensor falls through
to it and does not count as a wrong answer, because saying no to a fingerprint
is not a guess. Which sensor answers depends on the build: the desktop shell
goes through the operating system's local authentication, because it implements
no WebAuthn at all; the Android and iOS shells go through the platform's own
biometric prompt, with the device PIN, pattern or passcode accepted in place of
a face or a finger; everywhere else it is a platform authenticator over
WebAuthn.

**Wrong answers cost more each time.** Three tries are free — fingers slip, and
a PIN typed on a phone in a pocket is wrong far more often than an attacker is.
From the fourth wrong answer on, each one starts a wait, and the waits grow:

| wrong answer | what happens |
|---|---|
| 1–3 | a warning, and a count of what is left |
| 4 | one minute |
| 5 | three minutes |
| 6 | six minutes |
| 7 | ten minutes |
| 8 | **the target is wiped** |

The counters are written to storage, so closing the app does not clear a wait —
a lockout a restart forgets is not a lockout, it is a suggestion.

**The wipe is scoped to what was locked.** A group takes that group and its
history. A conversation takes that conversation, its media, its drafts and **its
session key** — leaving the key behind would leave the ciphertext already sent
readable, so the test suite seeds two conversations and a group and checks that
the neighbours are untouched. Secure Chat takes everything, including the
identity, every session key, and whatever the relay is still holding for this
device.

### Forward secrecy, and what expires when

Encryption stops someone reading a message. It does not, on its own, stop them
reading it *later* — once they have the key. Every key here now has a life.

**Live conversations** derive their key instead of being handed one. Each side
generates an ephemeral ECDH (P-256) pair, sends only the public half — encrypted
to the peer's pinned identity key, which is what binds the exchange to who they
are — and throws the private half away when the session ends. The identity key
only ever carries a public value, so recovering it afterwards yields nothing:
without an ephemeral private half there is no shared secret to recompute.
Before this, every session key was wrapped to a long-term RSA key, and one
compromise of that key opened every recorded conversation.

**Messages that never arrive** cannot take part in an exchange, so every device
publishes a prekey with its presence and rotates it. A queued envelope carries
its own one-off key, sealed to whichever prekey was current. The recipient keeps
that private prekey for **15 days**; after that it is deleted and the envelope
cannot be opened by anyone, including them. The app says so in Chat → settings
rather than only here, and a message that arrives past its window leaves a note
in the conversation instead of failing silently.

**Stored session keys** are retired after 7 days and re-negotiated, and expired
prekeys are swept on every boot.

What this does *not* cover, said plainly: history already decrypted and stored
on the device. Forward secrecy protects copies recorded in transit. The master
password, the chat lock and disappearing messages are what protect the rest.

`npm run test:fs` proves the parts that matter against a real relay — that both
ends derive the same key from one exchange, that the private prekey is deleted
rather than archived, and that a queued message whose window has closed can no
longer be opened by its own recipient.

### Emergency wipe

The biohazard button on the lock screen, a double-press of Escape, and the panic
password all reach the same routine, and it leaves nothing:

| | |
|---|---|
| The relay | queued envelopes and the push subscription for this identity, asked for over the socket that owns them and waited on rather than fired blindly |
| This browser | localStorage, sessionStorage, every IndexedDB database, every Cache Storage entry, and the service worker itself |
| In memory | the master key, the chat identity, session keys, prekeys, history, contacts and call log |
| The install | the device-binding secret is regenerated, so what comes back is a new install rather than the old one recognisable |

Then the page reloads into first run: no identity, no master password, nothing
to unlock. `npm run test:wipe` checks each of those from the outside, including
reading the relay's own mailbox file to confirm the queue is gone.

### Background notifications

Off by default, and the only feature in the app that puts a third party in the
path — so it is the one thing the app asks about explicitly rather than
arranging quietly.

Web Push cannot be delivered by this server alone. The subscription endpoint is
issued by the browser's own push service — Google's for Chrome and Android,
Apple's for Safari and iPhone, Mozilla's for Firefox — and the relay sends to
that service, which wakes the device. That service can see that a device
received something, when, and the IP of the server it came from. It cannot see
what: the payload is one of three fixed lines — a new message, an incoming call,
or a missed call — with no sender, no preview and no message text, and the
message itself never travels this way at all.

Only events a person would want to be told about are pushed at all. Typing
indicators, delivery receipts and the rest of the live signalling are neither
stored nor delivered to a sleeping device: they used to be, which meant writing
one long message rang the other person's phone every few seconds and left them a
pile of "was typing" envelopes to collect on return.

What the relay keeps, and for how long:

| | |
|---|---|
| Stored | one subscription address per device, up to five devices |
| Indexed by | `HMAC-SHA256(chat fingerprint, server salt)` — never the fingerprint |
| Expires | after 30, 60, 90, 120 or 180 days, whichever the user picked |
| Removed | when the switch goes off, when the window runs out, or when the vendor reports the endpoint dead |

The VAPID pair is generated once and kept in `data/chat-signal/vapid.json`, or
supplied through `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`. It used to be
generated per process, which silently invalidated every subscription on every
restart.

On iPhone and iPad this works only when the app has been installed from the
Home Screen — Safari tabs get nothing, whatever the setting says.

`npm run test:push` covers the whole path: that connecting registers nobody,
that the disclosure appears before anything is sent, that declining registers
nothing, that the relay files the device under a hash with an expiry, and that
turning it off removes the record from the relay rather than only from Settings.

### Tests

```bash
npm run relay                   # terminal 1
PORT=8123 npm run dev           # terminal 2
npm run test:ux                 # the UI fixes, one check per report    (174)
npm run test:duress             # the two-slot vault and its decoy       (64)
npm run test:monitor            # both monitors, against a real relay     (34)
npm run test:tabsweep           # every tab opens clean, in both languages (13)
npm run test:qrkit              # QR density, decoding and the controls   (18)
npm run test:chataudit          # every path a message can take          (39)
npm run test:upgrade            # an old install becomes a new one       (38)
npm run test:files              # streaming transfers, limits, gallery   (37)
npm run test:metadata           # reading, editing and clearing metadata (32)
npm run test:groups             # group chat, membership and history     (37)
npm run test:settings           # every settings section is reachable    (32)
npm run test:push               # background push, consent to expiry     (33)
npm run test:stickers           # sticker packs and custom ringtones     (27)
npm run test:cryptocore         # XChaCha20-Poly1305 against RFC vectors (32)
npm run test:locallink          # the serverless link and LAN pairing    (29)
npm run test:csp                # the policy, proven by a real violation (24)
npm run test:security           # probes against a running relay         (23)
npm run test:stego              # the container and both codecs          (23)
npm run test:chatlab            # four browsers, calls and a group       (22)
npm run test:tools              # the QR bridge, TOTP, inspector, convert (22)
npm run test:nativeui           # the packaged UI, driven in WebKit      (19)
npm run test:smoke              # the packaged tree boots on its own     (18)
npm run audit                   # the standing audit, run end to end     (17)
npm run test:native             # the payload under the production CSP   (17)
npm run test:filemgr            # the encrypted file manager             (17)
npm run test:persist            # the vault survives a reload            (16)
npm run test:chattools          # the tools inside chat settings         (16)
npm run test:legacypurge        # the broken ciphers are gone, not hidden (16)
npm run test:stegoreal          # DCT survives a real JPEG encoder        (8)
npm run test:calls              # two real peers on a video call         (14)
npm run test:callquality        # reading call quality without leaving it (18)
npm run test:offline            # delivery to someone who is not there   (12)
npm run test:fs                 # forward secrecy and the 15-day window  (11)
npm run test:wipe               # the emergency wipe, from both doors    (11)
npm run test:contacts           # what the address book keeps             (8)
npm run test:keytrust           # pinned keys and the change warning      (6)
npm run test:retention          # what the relay keeps, and for how long  (6)
npm run test:rust               # the native shell's own unit tests       (5)
npm run test:perf               # how it behaves as the room fills up
npm run test:stress             # concurrent clients, messages and calls
```

`FT_HUGE=1 npm run test:files` adds a 450 MB transfer.

`npm run test:stress` drives the relay from several load-generator processes and
prints a capacity curve. `STRESS_WAVES=250,500,1000,2000` sets the ramp,
`STRESS_WORKERS` the number of generators, and `RELAY_URL=https://host:8585`
points it at a real server instead of one it starts itself. It reports whether a
limit it meets belongs to the relay or to the machine running the test.

567 checks across the twenty-one end-to-end suites above, plus five Rust
unit tests. The ones that matter most for
what this app claims — `test:fs`, `test:wipe`, `test:keytrust`, `test:security`
and `test:offline` — all drive a real relay and then read its files from disk,
because a security property nobody measured from the outside is a comment, not
a guarantee.

### Deploying an update

`scripts/deploy.sh` ships this working tree to your own server and rebuilds it
there. The first run asks where your server is — host, account, SSH port, key,
public URL — and writes the answers to
`${XDG_CONFIG_HOME:-~/.config}/p00rija-cryptography/deploy.conf`, owner-only and
outside this repository, so a `git add .` can never pick them up. Every run
after that just deploys.

```bash
npm run deploy:check            # what the server is serving right now
npm run deploy:dry              # what would change
npm run deploy                  # sync, rebuild the containers, verify

bash scripts/deploy.sh --help          # every option
bash scripts/deploy.sh --edit          # open the saved settings in $EDITOR
bash scripts/deploy.sh --reconfigure   # ask again
bash scripts/deploy.sh --where         # print the settings path
```

Key authentication only, deliberately: a password on a command line lands in
the process table and in shell history. It refuses to deploy into a backup or a
git checkout, snapshots the server before it overwrites anything, and verifies
what is actually being served afterwards. `data/`, `certs/` and `.env` on the
server are never touched.

Bump the cache generation in the same commit as any front-end change, or
returning web-app users keep the old files:

```bash
OLD=$(grep -o 'chat-v[0-9]*' index.html | head -1)   # read, not spelled out
NEW=chat-v$(( ${OLD#chat-v} + 1 ))
sed -i '' "s/2\.26\.95-$OLD/2.44.0-$NEW/g" index.html sw.js js/app.js
sed -i '' "s/return '$OLD';/return '$NEW';/" js/app.js   # APP_BUILD_TAG fallback
node tools/check-versions.cjs   # refuses if any of the eight declarations drift
```

### How the encryption works

| Layer | Algorithm |
|---|---|
| Master password → key | Argon2id |
| Files, notes, the vault | AES-256-GCM |
| Chat session keys | AES-256-GCM, derived per session — ECDH P-256 + HKDF-SHA-256 |
| Binding that exchange to an identity | RSA-OAEP-3072 (it carries a public value only) |
| Queued messages | one-off AES-256-GCM key, sealed to the recipient's 15-day prekey |
| Identity fingerprint | SHA-256 of the SPKI public key, pinned on first contact |
| Safety number | SHA-256 of both fingerprints — five groups and five words |
| File transfer | one AES-256-GCM key, a fresh IV per 64 KB chunk |
| Integrity | SHA-256 / SHA-512 |

Keys are generated with the platform's own CSPRNG through Web Crypto and never
leave the device. The relay sees sealed envelopes; the TURN server sees packets.

Session keys are re-negotiated on every connection and retired after 7 days;
prekeys expire after 15. What that buys is set out under *Forward secrecy*
above — including what it does not buy.

### Capacity and scaling

`npm run test:perf` measures what one instance does; [docs/SCALING.md](docs/SCALING.md)
records the results and what they mean. The short version: the relay is not in
the media path, so latency is flat from 25 peers to 1600 (p95 = 1 ms), and the
ceilings size themselves from the machine's CPU and RAM at boot. That document
also sets out exactly what would have to change to run more than one instance,
and why it is not worth doing yet.

### Repository layout

```
index.html            the whole UI
js/app.js             the twenty tools, themes, i18n, settings
js/chat/              the messenger, in ordered parts: crypto, transport, calls, groups
js/desktop-bridge.js  the one place that knows about the native shell
src-tauri/            the Rust shell — tray, notifications, shredder, SSH, vault
scripts/server.js     the relay: presence, PeerJS, mailboxes, retention
scripts/setup.sh      the server installer and deployment manager
config/               Docker Compose, nginx, Dockerfiles
tests/e2e/            end-to-end suites, each with the bug it guards
```

### Reporting a security problem

Do not open a public issue. Email **p00rija@tutamail.com**.
[SECURITY.md](SECURITY.md) says what is in scope, which versions get fixes, and
which limits — no metadata protection, no post-compromise security, unsigned
packages, no independent audit — are deliberate rather than bugs.

### Support the project

Free, AGPL, no ads, no telemetry, no account, and no data to sell — so it runs
on donations. TON, the same address the app shows under **About → Support the
project**:

```
UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf
```

[Telegram Wallet](https://t.me/wallet) · [prefilled transfer](https://app.tonkeeper.com/transfer/UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf)

Not donating is a fine answer too: the source is here, it is AGPL, and running
your own relay costs you nothing but a server.

### Licence

AGPL-3.0-only. See [LICENSE](LICENSE). Section 13 matters here: if you run a
modified relay as a service for other people, they are entitled to your source.

---

## فارسی

### این چیست

بیست ابزار پشت یک قفل. همهٔ بایت‌ها **در مرورگر یا روی دستگاه خودتان** رمز
می‌شوند — هیچ سروری وجود ندارد که بتواند فایل‌ها، یادداشت‌ها، کلیدها یا پیام‌های
شما را بخواند. تنها چیزهایی که با سرور حرف می‌زنند، رلهٔ چت است (که پاکت‌های مهر
و موم شده‌ای را حمل می‌کند که نمی‌تواند بازشان کند) و سرور TURN (که بسته‌هایی را
عبور می‌دهد که نمی‌تواند رمزگشایی کند).

به صورت اپ نیتیو دسکتاپ، اپ اندروید، و وب‌اپ نصب‌شدنی روی هر دستگاهی از جمله
آیفون اجرا می‌شود. همان کد، همان خزانه، همان کلیدها.

### بیست‌وهشت ابزار

| | ابزار | کاری که می‌کند |
|---|---|---|
| 🔐 | **رمزنگاری** | هر فایلی، با هر حجمی، AES-256-GCM با کلید مشتق‌شده از Argon2id |
| 🔓 | **رمزگشایی** | نیمهٔ دیگر، شامل بسته‌هایی که روی دستگاه دیگری ساخته شده‌اند |
| ✍️ | **رمزنگاری نوشتاری** | رمزکردن یک پیام برای چسباندن در هر جایی — ایمیل، پیامک، انجمن |
| 💣 | **پیام‌های خودتخریب** | متن رمزشده با انقضا و سقف تعداد بازدید |
| 🖼️ | **پنهان‌نگاری** | پنهان کردن یک پیام رمزشده داخل یک تصویر معمولی |
| 🔑 | **رمزهای عبور** | تحلیل قدرت، تولید، و یک انبار رمزشدهٔ محلی |
| 🧙 | **ویزارد هوشمند** | موقعیت را انتخاب کنید؛ برنامه امن‌ترین تنظیمات را انتخاب می‌کند |
| 🛡️ | **مرکز سلامت امنیت** | یک صفحه که بررسی می‌کند این نصب چقدر در معرض خطر است |
| 📤 | **اشتراک امن** | بسته‌ها و لینک‌های مهر و موم شده با انقضا و سقف بازدید |
| 💬 | **چت امن** | پیام‌رسان — پایین‌تر توضیح داده شده |
| 📝 | **یادداشت‌های امن** | یادداشت‌های رمزشده در خزانهٔ محلی |
| 🖋️ | **امضای دیجیتال** | امضا و راستی‌آزمایی، تا یک فایل ثابت کند چه کسی ساخته‌اش |
| 🗝️ | **مدیریت کلیدها** | تولید، درون‌ریزی، برون‌ریزی، چرخش، پشتیبان‌گیری |
| 🖥️ | **کلیدهای SSH** | تولید و مدیریت کلیدهای واقعی SSH، نوشته‌شده در `~/.ssh` |
| 🔥 | **امحای فایل** | بازنویسی چندمرحله‌ای؛ فایل برنمی‌گردد |
| #️⃣ | **بررسی هش** | راستی‌آزمایی SHA-256 / SHA-512 در برابر یک چکیدهٔ منتشرشده |
| 📦 | **مهاجرت** | انتقال کل خزانهٔ رمزشده به دستگاهی دیگر |
| 📁 | **مدیریت فایل‌ها** | هر چه برنامه دریافت یا تولید کرده، در یک جای رمزشده |
| 🌊 | **تغییر صدا** | تغییر صدای یک ضبط پیش از ارسال، یا به‌تنهایی |
| 🏷️ | **متادیتا** | خواندن، ویرایش و پاک‌کردن آنچه یک عکس یا ویدئو دربارهٔ شما می‌گوید |
| 📱 | **پل QR** | جابه‌جایی متن رمزشده میان دستگاه‌ها به شکل دنباله‌ای از کدهای QR |
| 📡 | **پیوند محلی** | دو دستگاه، یک وای‌فای، یک کانال رمزشده و هیچ سروری — پایین‌تر توضیح داده شده |
| 🔢 | **کدساز دومرحله‌ای** | کدهای TOTP همین‌جا ساخته می‌شوند؛ کلیدها در خزانه می‌مانند |
| 👁️ | **بازرس نویسه** | پیدا کردن نویسه‌های نامرئی، دوجهته و شبیه‌به‌هم در متن |
| 🔁 | **میز تبدیل** | ده تبدیل میان متن، base64، hex و بایت |
| ⚙️ | **تنظیمات** | ۱۵ پوسته، رابط دوزبانه، تایپوگرافی، بیومتریک، ورود دو مرحله‌ای |
| ❓ | **راهنما** | داخل برنامه، آفلاین، به هر دو زبان |
| ℹ️ | **درباره ما** | نسخه‌ها، مجوزها، اعتبارات — و یک اتاق بازی پنهان پشت لوگو |

### چت امن

پیام‌رسانی سرتاسر رمزشده که وقتی طرف مقابل نیست هم کار می‌کند.

- **اول همتا به همتا.** کانال‌های دادهٔ WebRTC پیام‌ها، فایل‌ها و تماس‌ها را
  مستقیم بین دستگاه‌ها می‌برند. رله فقط راه جایگزین و صندوق پستی است.
- **تحویل آفلاین مهر و موم شده.** برای کسی که آفلاین است بنویسید و پیام با کلید
  عمومی *او* رمز می‌شود، روی رله در صف می‌ماند، و هنگام اتصالش تحویل می‌شود.
  رله متنی رمزشده را نگه می‌دارد که هیچ کلیدی برایش ندارد.
- **هر نوع پیامی از صف جان سالم به در می‌برد** — متن، فایل، استیکر، نظرسنجی،
  موقعیت، کارت مخاطب، پیام صوتی و پیام مخفی.
- **فایل تا ۴ گیگابایت** وقتی هر دو نفر آنلاین‌اند — بایت‌ها مستقیم بین دو
  دستگاه می‌روند، پس سقف را دستگاه تعیین می‌کند نه سرور — و تا ۱۰۰ مگابایت در
  صف برای کسی که آنلاین نیست. تکه‌های رمزشدهٔ ۶۴ کیلوبایتی با IV مجزا برای هر
  تکه و کنترل فشار واقعی؛ گیرنده هر دستهٔ کامل‌شده را همان‌جا به blob store
  منتقل می‌کند، پس هیچ‌کدام از دو طرف فایل را در حافظه نگه نمی‌دارند. نمایش
  پیشرفت به سبک تلگرام همراه سرعت و زمان باقی‌مانده.
- **تماس صوتی و تصویری** با اشتراک صفحه، ری‌اکشن، آینه، تصویر در تصویر و
  انتخاب دستگاه. هر تماس تمام‌شده یک سطر در گفتگو می‌نویسد و همان سطر دکمهٔ
  تماس دوباره است — با زدنش همان تماس دوباره برقرار می‌شود.
- **وضعیت شخصی**، که همراه رکورد حضور می‌رود و در بالای چت شما روی صفحهٔ طرف
  مقابل داخل یک حباب نمایش داده می‌شود.
- **قفل چتی که ارقام کیبورد شما را می‌پذیرد** — رمزی که با اعداد فارسی یا عربی
  تایپ شود قفلی را که با اعداد انگلیسی گذاشته شده باز می‌کند.
- **دفترچه‌ای از آدم‌ها، نه از همه.** رله به هر کلاینت می‌گوید چه کسان دیگری
  آنلاین‌اند — کشف همین‌طور تماس‌ها و سشن‌ها را وصل می‌کند — ولی فقط کسی روی
  دستگاه شما نوشته می‌شود که خودتان اضافه کرده باشید، پین کرده باشید، کلید سشن
  با او داشته باشید یا پیامی رد و بدل کرده باشید. هیچ‌کس دیگر هرگز فهرست
  نمی‌شود: بخش «آنلاین‌های رله» حذف شده و غریبه فقط از راه یک act صریح وارد
  می‌شود — کارت مخاطب، شناسهٔ چسبانده‌شده، یا یک گفتگو — نه یک فهرست عمومی.
- **گروه‌ها** که کل تاریخچه — شامل فایل و استیکر — هنگام بازگشت عضو با دستگاهش
  همگام می‌شود.
- **تایمر خودتخریب از لحظهٔ خوانده شدن** شروع می‌شود نه از لحظهٔ ارسال، پس پیامی
  که سه روز در صف مانده هنوز عمر کاملش را دارد.
- نگهداری: متن تا زمان تحویل نگه داشته می‌شود؛ رسانه پس از ۷ روز منقضی می‌شود و
  فقط یک سطر گزارش می‌ماند، و به گیرنده گفته می‌شود چه چیزی را از دست داده.

### نصب سریع — سرور

یک خط، روی یک ماشین تازهٔ دبیان، اوبونتو، فدورا یا آرچ:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/quick-install.sh | bash
```

پیش‌نیازها را نصب می‌کند، مخزن را کلون می‌کند، **پورت برنامه را می‌پرسد**
(پیش‌فرض ۸۵۸۵)، گواهی خودامضا می‌سازد و کانتینرها را بالا می‌آورد. با دامنهٔ
واقعی و گواهی واقعی:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/quick-install.sh | bash -s -- --domain chat.example.com --letsencrypt --email you@example.com
```

ریختن یک اسکریپت از اینترنت داخل شل، شایستهٔ همان احتیاطی است که برمی‌انگیزد.
اول [`scripts/quick-install.sh`](scripts/quick-install.sh) را بخوانید، یا دستی انجام دهید:

```bash
git clone https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY.git
cd P00RIJA-CRYPTOGRAPHY
bash scripts/setup.sh
```

`scripts/setup.sh` بدون آرگومان، ویزارد کامل را باز می‌کند: استقرار محلی، دامنه
یا IP عمومی؛ گواهی موجود یا Let's Encrypt یا خودامضا؛ به‌علاوهٔ به‌روزرسانی درجا،
بازسازی کانتینرها و بازگردانی به تنظیمات کارخانه. `--quick` همان کارها را بدون
هیچ سؤالی انجام می‌دهد.

### نصب گواهی — IP و دامنه

- **IP عمومی**: گواهی همیشه **خودامضا** است — مراجع گواهی (از جمله Let's
  Encrypt) برای IP خالی گواهی صادر نمی‌کنند؛ قانون سیستم CA است، نه نصب‌کننده.
  ویزارد خودش گواهی را با همهٔ IPهای سرور می‌سازد؛ مرورگر یک هشدار یک‌باره
  می‌دهد که روی سرور خودتان پذیرفتنش امن است.
- **دامنه**: اگر دامنه به سرور اشاره کند، گواهی رایگان و مورد اعتماد Let's
  Encrypt از داخل همان ویزارد (گزینهٔ ۲ در بخش Domain) صادر می‌شود.

### نصب سریع — دسکتاپ و موبایل

```bash
npx p00rija-cryptography@latest
```

نصب‌کنندهٔ مخصوص سیستم شما را دانلود و مسیرش را نشان می‌دهد. با `--pwa` نسخهٔ
وب را محلی سرو می‌کند و در مرورگر باز می‌کند — بدون هیچ نصبی.

در پایان، آدرس برنامه، آدرس مانیتور و یک رمز تولیدشدهٔ مانیتور را چاپ می‌کند.
آن رمز فقط در `.env` وجود دارد.

<div dir="rtl">

یا مستقیم یک بسته از [releases](../../releases) بردار. هیچ‌کدام با گواهی اپل،
مایکروسافت یا گوگل امضا نشده‌اند، پس مک، ویندوز و اندروید هرکدام بار اول یک
هشدار نشان می‌دهند — [INSTALL.md](INSTALL.md) هر سه را قدم‌به‌قدم می‌گوید، و
اینکه چطور درستی فایل دانلودشده را بررسی کنی.

</div>

### نصب دستی — سرور، قدم به قدم

ویزارد دقیقاً همین کارها را می‌کند؛ اگر ترجیح می‌دهید همهٔ مراحل را ببینید،
دستی انجامش دهید.

```bash
# ۱. پیش‌نیازها: داکر با افزونهٔ compose، گیت، openssl
git clone https://github.com/Poorija/P00RIJA-CRYPTOGRAPHY.git
cd P00RIJA-CRYPTOGRAPHY

# ۲. یک گواهی. برای شبکهٔ محلی یا آی‌پی، خودامضا کافی است:
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -nodes -days 825 \
  -keyout certs/key.pem -out certs/cert.pem -subj "/CN=$(hostname -f)"
# ...یا SSL_CERT_PATH/SSL_KEY_PATH را به گواهی واقعی اشاره دهید.

# ۳. متغیرهای محیطی. همهٔ این‌ها را config/docker-compose.yaml می‌خواند:
cat > .env <<'ENV'
DOMAIN=chat.example.com          # یا آی‌پی ماشین
EXTERNAL_IP=203.0.113.10         # آدرسی که کلاینت‌ها می‌بینند؛ برای coturn
SSL_CERT_PATH=./certs/cert.pem
SSL_KEY_PATH=./certs/key.pem
MONITOR_PASSWORD=حداقل-۱۲-کاراکتر
TURN_PASSWORD=یک-راز-طولانی-دیگر
CHAT_ALLOWED_ORIGINS=https://chat.example.com:8585
ENV

# ۴. بالا آوردن
docker compose --env-file .env -f config/docker-compose.yaml up -d --build
```

چهار کانتینر بالا می‌آید: برنامه و رله (`poorija-cryptography` و
`chat-signal`)، سرور TURN (`coturn`) و تمدیدکنندهٔ گواهی (`cert-renewer`).
برنامه روی **پورت ۸۵۸۵** با HTTPS سرو می‌شود و داشبورد مانیتورینگ در
`/Monitor_Server` با رمزی که در `.env` گذاشته‌اید.

برای بررسی: `curl -k https://localhost:8585/chat-health` باید `ok` بدهد.

### نصب سریع — کلاینت

| سکو | فایل | توضیح |
|---|---|---|
| مک (Apple silicon) | `P00RIJA Cryptography_2.44.0_aarch64.dmg` | امضای ad-hoc |
| مک (اینتل + Apple silicon) | `P00RIJA Cryptography_2.44.0_universal.dmg` | |
| ویندوز x64 / ARM64 | `..._x64-setup.exe` / `..._arm64-setup.exe` | نصب‌کنندهٔ NSIS |
| دبیان / اوبونتو | `..._amd64.deb` / `..._arm64.deb` | |
| فدورا / RHEL | `...x86_64.rpm` / `...aarch64.rpm` | |
| آرچ | `...-x86_64.pkg.tar.zst` | |
| هر لینوکسی | `..._amd64.AppImage` | `chmod +x` و اجرا |
| هر لینوکسی (بدون نصب) | `...-linux-x86_64.tar.gz` | قابل حمل |
| اندروید | `P00RIJA-Cryptography-2.44.0-universal.apk` | با `npm run android:build` ساخته می‌شود |
| آیفون / آیپد | — | وب‌اپ را از سایت نصب کنید: Share ← Add to Home Screen. ساخت `.ipa` نیتیو به حساب پولی Apple Developer نیاز دارد؛ [MOBILE_BUILD.md](MOBILE_BUILD.md) را ببینید |

نسخه‌های دسکتاپ و اندروید با آدرس رلهٔ عمومی ساخته می‌شوند، پس نصب تازه بدون
تایپ کردن آدرس متصل می‌شود. برای هر سرور دیگری:
**چت امن ← تنظیمات ← اتصال**.

### ساخت از روی کد

```bash
npm install
npm run native:prepare               # آماده‌سازی بار وب برای پوستهٔ نیتیو

npm run native:build:mac:universal   # ‏.app و ‎.dmg برای اینتل و Apple silicon
npm run native:build:mac:arm64       # یا فقط معماری همین ماشین
npm run native:build:linux:docker    # ‏.deb و ‎.rpm و ‎.AppImage و بستهٔ آرچ
npm run native:build:linux:docker:arm64
npm run native:package:linux:portable  # آرشیوهای بدون نصب
npm run native:build:windows:docker    # نصب‌کنندهٔ NSIS، از هر میزبانی
npm run android:build                  # ‏.apk امضاشده
npm run ios:build                      # ‏.ipa — به تیم امضای اپل نیاز دارد

npm run export                       # جمع کردن همه چیز در Export/
npm run verify:artifacts             # اثبات اینکه هر بسته کد فعلی را در خود دارد
```

بسته‌های لینوکس و ویندوز داخل کانتینر ساخته می‌شوند، چون ساخت `.deb` به dpkg و
نصب‌کنندهٔ NSIS به Wine نیاز دارد و هیچ‌کدام جای‌شان روی مک نیست. بقیه به صورت
نیتیو ساخته می‌شوند. iOS تنها هدفی است که اینجا تمام نمی‌شود: ساخت `.ipa` برای
دستگاه دیگران به حساب پولی Apple Developer نیاز دارد، پس iOS به صورت وب‌اپ
نصب‌شدنی عرضه می‌شود. [MOBILE_BUILD.md](MOBILE_BUILD.md) توضیح می‌دهد یک حساب
رایگان چه کاری می‌تواند بکند و چه کاری نمی‌تواند.

`bash scripts/native-build-wizard.sh` همین کارها را پشت یک منو انجام می‌دهد.

### نسخهٔ نیتیو چه چیزی اضافه می‌کند، و چه کاری نمی‌تواند

برنامهٔ دسکتاپ همان بار وب داخل پوستهٔ Tauri است، پس همهٔ قابلیت‌های بالا در آن
هست — و پوسته چهار چیزی را اضافه می‌کند که یک تب مرورگر نمی‌تواند: اعلان‌های
سیستم‌عامل، آیکون tray، باز کردن بایومتریک از راه احراز هویت محلی خودِ پلتفرم،
و پنجره‌ای که با بستن از بین نمی‌رود.

**پروفایل‌های آیکون.** تنظیمات هفت پروفایل ظاهری دارد که چهارتای آن‌ها عمداً
بی‌نشان‌اند — یک پوشه، یک برنامهٔ یادداشت، یک ترمینال، یک پنل تنظیمات. هدف این
است که یک نگاه به تسک‌بار کسی نگوید «برنامهٔ رمزنگاری».

اینکه هر پلتفرم واقعاً چه می‌تواند بکند فرق دارد، و برنامه همین را می‌گوید
به‌جای اینکه چیز دیگری القا کند:

| پلتفرم | چه چیزی عوض می‌شود |
|---|---|
| ویندوز | آیکون پنجره و نوار وظیفه، بلافاصله |
| لینوکس | آیکون پنجره و نوار وظیفه، بلافاصله |
| مک | فقط آیکون tray — پنجره در مک آیکون جدا ندارد، Dock آیکون بسته را نشان می‌دهد، و Tauri راهی برای تعویض Dock tile یک برنامهٔ در حال اجرا نمی‌دهد |

آیکون خودِ فایل نصب در همهٔ پلتفرم‌ها از بستهٔ build‌شده می‌آید.

طرح‌ها در `assets/desktop-icons/*.svg` هستند و `scripts/build-icon-profiles.sh`
آن‌ها را به PNGهایی تبدیل می‌کند که پوسته داخل خودش جا می‌دهد. آن PNGها commit
می‌شوند تا ماشین بیلد به rasteriser نیاز نداشته باشد؛ بعد از تغییر هر SVG اسکریپت
را اجرا و خروجی‌اش را commit کنید.

### ساخت بسته‌های دسکتاپ

```bash
npm install
npm run native:prepare               # آماده‌سازی بار وب برای پوستهٔ نیتیو

npm run native:build:mac:universal   # ‏.app و .dmg، اینتل و اپل سیلیکون در یکی
npm run native:build:linux:docker    # ‏.deb، .rpm، .AppImage و بستهٔ آرچ
npm run native:build:linux:docker:arm64
npm run native:package:linux:portable  # آرشیوهای بدون‌نصب
npm run native:build:windows:docker    # نصب‌کنندهٔ NSIS، از هر میزبانی

npm run export                       # جمع کردن هرچه ساخته شده در Export/
```

`npm run export` کپی می‌کند نه انتقال، پس ساخت دوبارهٔ یک پلتفرم فقط همان را
تازه می‌کند. هرچه هنوز ساخته نشده در خلاصه نام برده می‌شود نه اینکه بی‌صدا رد
شود — یک خروجی ناقص باید ناقص به نظر برسد.

**دربارهٔ بستهٔ آرچ:** Tauri آن را همراه rpm می‌سازد ولی با نام قابل انتخاب
نیست — پرچم `--bundles` فقط `deb`، `rpm` و `appimage` را می‌پذیرد و `pacman` را
رد می‌کند. فایل `.pkg.tar.zst` در ریشهٔ پوشهٔ bundle ظاهر می‌شود، و اسکریپت
export از همان‌جا برمی‌داردش.

**امضا.** بیلد مک ad-hoc امضا شده است: روی همان دستگاهی که ساخته شده مشکلی
ندارد و بعد از دانلود توسط Gatekeeper قرنطینه می‌شود. برای توزیع،
`APPLE_SIGNING_IDENTITY`، `APPLE_ID`، `APPLE_PASSWORD` و `APPLE_TEAM_ID` را
تنظیم و ‎.dmg را notarize کنید. بسته‌های ویندوز و لینوکس امضا ندارند.

**سورس هم همراهشان می‌رود.** دستور `npm run export` فایل
`Export/Source/p00rija-cryptography-<version>-source.tar.gz` و یک `COMMIT.txt`
هم می‌نویسد که می‌گوید از کدام commit ساخته شده. چون هیچ‌کدام از باینری‌های بالا
با امضایی که بشود بررسی کرد امضا نشده‌اند، همین آرشیو است که آن‌ها را
قابل‌بازرسی می‌کند: سورس را بخوانید، دوباره بسازید، مقایسه کنید. با
`git archive` ساخته می‌شود نه با `tar` از پوشه — چون `git archive` فقط چیزی را
بیرون می‌دهد که **commit شده**، پس `node_modules`، `dist/`، `Export/` و آن سه
چیزی که هرگز نباید ماشین بیلد را ترک کنند (`.env`، `certs/` و `data/` که کلید
خصوصی Web Push در آن است) نمی‌توانند تصادفی داخلش بروند. اگر هنگام export درخت
کاری تغییرات commit‌نشده داشته باشد، همان را در `COMMIT.txt` می‌نویسد — چون
در آن حالت آرشیو همان چیزی نیست که ساخته شده.

### کار کردن بدون هیچ سروری

دو راه برای ادامهٔ ارتباط وقتی زیرساخت از دست رفته وجود دارد، و هرکدام پاسخ یک وضعیت متفاوت است.

**یک رله روی شبکهٔ محلی.** یک نفر سرور را روی لپ‌تاپ یا گوشی بالا می‌آورد و بقیه به آن اشاره می‌کنند. این از قبل کار می‌کرد؛ آنچه کار نمی‌کرد، خواندن `http://192.168.1.34:9000` با صدای بلند از آن سر اتاق بود. حالا در چت امن ← تنظیمات، روی دستگاهی که نشانی را دارد دکمهٔ **نمایش نشانی به‌صورت QR** هست و روی بقیه **خواندن نشانی از QR**. هیچ چیزی از شبکهٔ محلی بیرون نمی‌رود و اینترنت بین‌الملل می‌تواند تمام مدت قطع باشد.

**بدون هیچ سروری.** تب **پیوند محلی** دستگاه‌های روی یک وای‌فای را مستقیم به هم وصل می‌کند؛ بدون رله، بدون STUN، بدون TURN. یک دستگاه *شروع پیوند تازه* را می‌زند و یک کد نشان می‌دهد؛ دیگری آن را اسکن می‌کند و پاسخش را نشان می‌دهد؛ بعد از آن یک کانال رمزشده میان‌شان هست که پیام و فایل از هر نوعی را می‌برد.

**دوربین هم لازم نیست.** هر کد به‌صورت متن هم داده می‌شود، برای کپی یا ذخیره در فایل. یک دسکتاپ بدون وب‌کم با چسباندن دو رشتهٔ کوتاه جفت می‌شود و نتیجه همان اتصال با همان کلید است.

**بیش از دو نفر.** یک پیوند کامل‌شده یک اتاق است و اتاق تا شانزده نفر می‌گیرد. پیوستن، هر تعداد نفر که از قبل باشند، فقط یک جفت‌سازی با میزبان هزینه دارد: میزبان تازه‌وارد را روی اتصال‌های موجود به بقیه معرفی می‌کند و از آن به بعد هر جفت مستقیم حرف می‌زنند. میزبان معرفی می‌کند ولی نمی‌تواند بخواند — هر جفت کلید خودش را می‌سازد، و سوئیت تست همین را می‌آزماید: کلید یک عضو را به ترافیک عضو دیگر می‌دهد و تأیید می‌کند که رد می‌شود.

داخل اتاق: پیام، استیکر، نظرسنجی با شمارش زنده، واکنش، فایل **بدون محدودیت حجم**، و تماس صوتی یا تصویری، دونفره یا با همه. فایلی که به‌اندازهٔ کافی بزرگ باشد پیش از رفتن می‌گوید چه هزینه‌ای به شبکه تحمیل می‌کند، به‌جای اینکه رد شود؛ تماس تصویری در اتاق شلوغ هم همین را دربارهٔ دوربین‌ها می‌گوید. هیچ‌چیز اتاق روی دیسک نوشته نمی‌شود و رونوشت به اتاق بعدی نمی‌رسد.

چطور کار می‌کند و چرا ممکن است: WebRTC دو همتا را با کاندیداهای host به‌تنهایی هم به‌راحتی وصل می‌کند. تنها بخشی که معمولاً به سرور نیاز دارد، «معرفی» است — و معرفی فقط به کانالی نیاز دارد که هر دو دستگاه در آن شریک باشند، و یک صفحه‌نمایش و یک دوربین دقیقاً چنین کانالی هستند. توضیحات نشست روی‌هم حدود ۱۵۵۰ نویسه می‌شوند، یعنی یک کد QR در هر جهت.

سه ویژگی که دانستن‌شان می‌ارزد:

- **نمی‌تواند از شبکهٔ محلی بیرون برود.** اتصال بدون هیچ سرور ICE ساخته می‌شود، پس تنها کاندیداهایی که وجود دارند host هستند. این با ساختار تضمین می‌شود نه با یک تنظیم، و مجموعهٔ تست بررسی می‌کند که هرگز کاندیدای `srflx` یا `relay` ظاهر نشود.
- **اعتماد اینجا از هر جای دیگر برنامه قوی‌تر است.** کلید عمومی ECDH هر طرف داخل همان کد QR خودش سفر می‌کند، پس کلید از راه چشم و دوربین شما می‌رسد، نه از روی سیم. هیچ چیزی در میانه نمی‌تواند جایش را عوض کند مگر آنکه شما دوربین را به صفحهٔ دیگری بگیرید. عبارت امنیتی شش‌کلمه‌ای از هر دو کلید ساخته می‌شود: اگر دو دستگاه عبارت متفاوتی نشان دادند، اتصال را قطع کنید.
- **ترافیک دو بار مهر و موم می‌شود.** DTLS خودِ WebRTC از پرش محافظت می‌کند؛ یک لایهٔ AES-256-GCM با کلید ECDH+HKDF از محتوا محافظت می‌کند، و تنها دومی به کلیدی گره خورده که از راه دوربین آمده است.

**تنها چیزی که جلویش را می‌گیرد:** بیشتر وای‌فای‌های مهمان و عمومی طوری پیکربندی شده‌اند که دستگاه‌ها یکدیگر را نبینند («client isolation»). هیچ مرورگری نمی‌تواند دور این بزند. یک نقطهٔ اتصال شخصی چنین محدودیتی ندارد.

**چه چیزی ارائه نشده و چرا: بلوتوث.** Web Bluetooth فقط می‌تواند نقش GATT *central* را بازی کند — یک مرورگر نمی‌تواند خودش را به‌عنوان peripheral تبلیغ کند — پس دو نسخه از این برنامه هرگز نمی‌توانند از این راه یکدیگر را ببینند، و سافاری و iOS اصلاً این API را پیاده نکردند. یک ترابرد بلوتوثی بومی در اصل ممکن است، ولی حالت peripheral روی موبایل ناپایدار است و پهنای باند عملی در حدود ۱ تا ۲ کیلوبایت بر ثانیه است. Wi-Fi Direct هم در اختیار مرورگرها نیست. وای‌فای مشترک پاسخ صادقانه است، پس همان پیاده شده است.

### قفل‌ها، و آنچه با حدس‌های پیاپی می‌آید

سه چیز قابل قفل شدن‌اند و هر کدام جداست: **کل چت امن**، **یک گفتگو**، و **یک
گروه**. قفل، گفتگو را روی دستگاهی که از قبل باز است پنهان می‌کند. لایهٔ
رمزنگاری تازه‌ای اضافه نمی‌کند — پیام‌ها در هر صورت رمزشده‌اند — و برنامه همین
را روی صفحهٔ قفل می‌نویسد به‌جای اینکه چیز بیشتری القا کند.

**قفل کردن در همان لحظه.** قفل با تایمر برمی‌گردد، که برای دور شدن از میز درست
است و برای حالتی که بیشتر لازم می‌شود بی‌فایده: دادن گوشی به کسی برای نشان دادن
یک عکس. منوی گفتگو گزینهٔ **قفل کردن چت** دارد که با گذاشتن رمز فعال می‌شود.
روی گوشی گفتگو بسته می‌شود و به فهرست برمی‌گردید؛ روی دسکتاپ گفتگو انتخاب‌شده
می‌ماند و کارت قفل جای پیام‌ها را می‌گیرد، چون دسکتاپ پنل دومی دارد که ارزش
استفاده دارد. در هر دو حالت هیچ چیز خواندنی روی صفحه نمی‌ماند.

**بایومتریک، به‌عنوان گزینه.** اگر باز کردن بایومتریک خودِ برنامه روشن باشد، هر
قفل هم آن را ارائه می‌دهد، با دکمهٔ خودش کنار رمز — همان جفتی که صفحهٔ قفل
برنامه دارد. رمز همیشه کار می‌کند؛ رد کردن سنسور به رمز می‌افتد و **تلاش اشتباه
حساب نمی‌شود**، چون نه گفتن به اثر انگشت یک حدس نیست. روی نسخهٔ دسکتاپ این مسیر
از احراز هویت محلی سیستم‌عامل می‌رود نه WebAuthn، که پوستهٔ نیتیو پیاده‌اش
نکرده است.

**هر پاسخ غلط گران‌تر از قبلی.** سه تلاش آزاد است — انگشت می‌لغزد، و رمزی که در
جیب تایپ شود بسیار بیشتر از یک مهاجم اشتباه می‌شود. از چهارمین پاسخ غلط، هر کدام
یک انتظار شروع می‌کند و انتظارها بزرگ‌تر می‌شوند:

| پاسخ غلط | چه می‌شود |
|---|---|
| ۱ تا ۳ | هشدار، و شمارش باقی‌مانده |
| ۴ | یک دقیقه |
| ۵ | سه دقیقه |
| ۶ | شش دقیقه |
| ۷ | ده دقیقه |
| ۸ | **هدف به‌کلی پاک می‌شود** |

شمارنده‌ها روی حافظه نوشته می‌شوند، پس بستن برنامه انتظار را پاک نمی‌کند —
قفلی که با یک restart فراموش شود قفل نیست، یک پیشنهاد است.

**پاک‌سازی دقیقاً به اندازهٔ چیزی است که قفل بود.** گروه، همان گروه و تاریخچه‌اش
را می‌برد. گفتگو، همان گفتگو، رسانه‌ها، پیش‌نویس‌ها و **کلید سشنش** را — جا
گذاشتن کلید یعنی پیام‌های قبلاً فرستاده‌شده هنوز خواندنی می‌مانند، برای همین
سوئیت تست دو گفتگو و یک گروه می‌کارد و بررسی می‌کند که همسایه‌ها دست‌نخورده
بمانند. چت امن همه‌چیز را می‌برد: هویت، همهٔ کلیدهای سشن، و هرچه رله هنوز برای
این دستگاه نگه داشته است.

### محرمانگی پیشرو، و اینکه چه چیزی کی منقضی می‌شود

رمزنگاری جلوی خواندن پیام را می‌گیرد. به‌تنهایی جلوی خواندنِ **بعدی** را نمی‌گیرد —
وقتی کلید به دست کسی افتاد. حالا هر کلیدی در این برنامه عمر دارد.

**گفتگوهای زنده** کلیدشان را مشتق می‌کنند نه اینکه تحویل بگیرند. هر طرف یک جفت
ECDH موقت (P-256) می‌سازد، فقط نیمهٔ عمومی را می‌فرستد — رمزشده به کلید هویتِ
پین‌شدهٔ طرف مقابل، که همان چیزی است که تبادل را به هویت گره می‌زند — و نیمهٔ
خصوصی با پایان نشست دور ریخته می‌شود. کلید هویت فقط یک مقدار عمومی را حمل می‌کند،
پس به دست آوردنش در آینده چیزی نمی‌دهد. پیش از این، هر کلید نشست به یک کلید
بلندمدت RSA بسته می‌شد و یک بار لو رفتن آن، همهٔ گفتگوهای ضبط‌شده را باز می‌کرد.

**پیام‌هایی که هرگز نمی‌رسند** نمی‌توانند در تبادل شرکت کنند، پس هر دستگاه یک
prekey همراه حضورش منتشر می‌کند و می‌چرخاندش. هر پاکت صف‌شده کلید یک‌بارمصرف خودش
را دارد که به prekey جاری مهر شده. گیرنده آن prekey خصوصی را **۱۵ روز** نگه
می‌دارد؛ بعد از آن پاک می‌شود و پاکت دیگر برای هیچ‌کس، حتی خودش، باز نمی‌شود.
برنامه این را در تنظیمات چت می‌گوید نه فقط اینجا، و پیامی که بعد از پنجره برسد یک
یادداشت در گفتگو می‌گذارد به‌جای اینکه بی‌صدا شکست بخورد.

**کلیدهای نشست ذخیره‌شده** بعد از ۷ روز بازنشسته و دوباره مذاکره می‌شوند، و
prekeyهای منقضی در هر بوت جارو می‌شوند.

آنچه این پوشش نمی‌دهد، صریح: تاریخچه‌ای که از قبل رمزگشایی و روی دستگاه ذخیره شده.
محرمانگی پیشرو از نسخه‌های ضبط‌شده در مسیر محافظت می‌کند؛ بقیه‌اش کار رمز مستر،
قفل چت و پیام‌های خودتخریب است.

### پاک‌سازی اضطراری

دکمهٔ بیوهازارد صفحهٔ قفل، دو بار فشردن Esc، و رمز اضطراری همه به یک روال می‌رسند
و چیزی باقی نمی‌گذارد:

| | |
|---|---|
| رله | پاکت‌های صف‌شده و اشتراک پوش این هویت، از طریق همان سوکتی که مالکشان است |
| این مرورگر | localStorage، sessionStorage، همهٔ پایگاه‌های IndexedDB، همهٔ کش‌ها، و خودِ سرویس‌ورکر |
| حافظه | کلید مستر، هویت چت، کلیدهای نشست، prekeyها، تاریخچه، مخاطبان و تاریخچهٔ تماس |
| خودِ نصب | رازِ اتصال به دستگاه بازتولید می‌شود، پس آنچه برمی‌گردد یک نصب تازه است نه نصب قبلی که قابل شناسایی باشد |

بعد صفحه روی اجرای اول بارگذاری می‌شود: نه هویتی، نه رمز مستری، نه چیزی برای باز
کردن. `npm run test:wipe` هر کدام را از بیرون می‌سنجد، از جمله خواندن فایل صندوق
خودِ رله برای اطمینان از خالی شدن صف.

### اعلان در پس‌زمینه

پیش‌فرض خاموش است، و تنها قابلیتی در برنامه که یک طرف سوم را وارد مسیر می‌کند —
برای همین تنها چیزی است که برنامه صریحاً دربارهٔ آن می‌پرسد به‌جای اینکه بی‌صدا
ترتیبش را بدهد.

Web Push را این سرور به‌تنهایی نمی‌تواند تحویل دهد. نشانی اشتراک را سرویس پوشِ
خودِ مرورگر صادر می‌کند — گوگل برای کروم و اندروید، اپل برای سافاری و آیفون،
موزیلا برای فایرفاکس — و رله به آن سرویس می‌فرستد و آن است که دستگاه را بیدار
می‌کند. آن سرویس می‌بیند که دستگاهی چیزی گرفته، در چه زمانی، و از کدام IP سرور.
نمی‌بیند که چه چیزی: payload یکی از سه جملهٔ ثابت است — پیام تازه، تماس ورودی، یا
تماس بی‌پاسخ — بدون نام فرستنده، بدون پیش‌نمایش و بدون متن پیام، و خودِ پیام اصلاً
از این مسیر عبور نمی‌کند.

فقط رویدادهایی که کسی دوست دارد از آن‌ها خبردار شود پوش می‌شوند. نشانگر «در حال
نوشتن»، رسیدهای تحویل و بقیهٔ سیگنال‌های لحظه‌ای نه ذخیره می‌شوند و نه به دستگاه
خوابیده می‌رسند: قبلاً می‌رسیدند، و همین باعث می‌شد نوشتن یک پیام طولانی هر چند
ثانیه گوشی طرف مقابل را زنگ بزند و انبوهی پاکت «در حال نوشتن بود» برایش جا بماند.

رله چه چیزی و چقدر نگه می‌دارد:

| | |
|---|---|
| ذخیره | یک نشانی اشتراک برای هر دستگاه، حداکثر پنج دستگاه |
| کلید نمایه | `HMAC-SHA256(اثر انگشت چت، نمک سرور)` — نه خودِ اثر انگشت |
| انقضا | پس از ۳۰، ۶۰، ۹۰، ۱۲۰ یا ۱۸۰ روز، هرکدام که کاربر انتخاب کرده |
| حذف | با خاموش کردن کلید، با پایان آن بازه، یا وقتی سرویس مرورگر بگوید نشانی مرده است |

جفت کلید VAPID یک‌بار ساخته و در `data/chat-signal/vapid.json` نگه داشته می‌شود،
یا از `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` گرفته می‌شود. قبلاً به ازای هر
پروسه ساخته می‌شد، که یعنی هر ری‌استارت بی‌صدا همهٔ اشتراک‌ها را باطل می‌کرد.

روی آیفون و آیپد این فقط وقتی کار می‌کند که برنامه از صفحهٔ اصلی نصب شده باشد —
تب سافاری هیچ اعلانی نمی‌گیرد، تنظیمات هرچه بگوید.

`npm run test:push` کل مسیر را پوشش می‌دهد: اینکه اتصال به رله کسی را ثبت
نمی‌کند، اینکه توضیح پیش از هر ارسالی نشان داده می‌شود، اینکه «نه» گفتن چیزی ثبت
نمی‌کند، اینکه رله دستگاه را با هش و همراه انقضا ذخیره می‌کند، و اینکه خاموش کردن
کلید رکورد را از رله برمی‌دارد نه فقط از تنظیمات.

### تست‌ها

```bash
npm run relay                   # ترمینال ۱
PORT=8123 npm run dev           # ترمینال ۲
npm run test:ux                 # اصلاحات رابط، هر گزارش یک بررسی  (۱۷۴)
npm run test:files              # انتقال استریمی، سقف‌ها، گالری      (۳۷)
npm run test:metadata           # خواندن، ویرایش و پاک‌کردن متادیتا   (۳۲)
npm run test:groups             # گفت‌وگوی گروهی، عضویت و تاریخچه    (۳۷)
npm run test:settings           # همهٔ بخش‌های تنظیمات قابل رسیدن‌اند  (۳۲)
npm run test:push               # اعلان پس‌زمینه، از اجازه تا انقضا   (۳۳)
npm run test:stickers           # پک استیکر و زنگ دلخواه            (۲۷)
npm run test:security           # کاوش امنیتی روی رلهٔ در حال اجرا    (۲۳)
npm run test:nativeui           # رابط بسته‌بندی‌شده، در WebKit      (۱۹)
npm run test:smoke              # درخت بسته‌بندی‌شده خودش بالا می‌آید (۱۸)
npm run audit                   # ممیزی دائمی، سرتاسری               (۱۷)
npm run test:native             # بار برنامه زیر CSP تولید          (۱۷)
npm run test:filemgr            # مدیر فایل رمزگذاری‌شده             (۱۷)
npm run test:persist            # خزانه بعد از ریلود سر جایش می‌ماند (۱۶)
npm run test:calls              # دو کاربر واقعی روی تماس تصویری    (۱۴)
npm run test:offline            # تحویل به کسی که آنجا نیست        (۱۲)
npm run test:fs                 # محرمانگی پیشرو و پنجرهٔ ۱۵ روزه     (۱۱)
npm run test:wipe               # پاک‌سازی اضطراری، از هر دو در      (۱۱)
npm run test:contacts           # دفترچه مخاطبین چه چیزی نگه می‌دارد  (۸)
npm run test:keytrust           # پین کلید و هشدار تغییر آن           (۶)
npm run test:retention          # رله چه چیزی و چقدر نگه می‌دارد     (۶)
npm run test:rust               # تست‌های واحد پوستهٔ نیتیو           (۵)
npm run test:perf               # رفتار سرور وقتی اتاق پر می‌شود
```

`FT_HUGE=1 npm run test:files` یک انتقال ۴۵۰ مگابایتی هم اضافه می‌کند.

۵۶۷ چک در بیست‌ویک سوییت سرتاسری بالا، به‌علاوهٔ پنج تست واحد Rust. آن‌هایی که برای ادعاهای این برنامه مهم‌ترند —
`test:fs`، `test:wipe`، `test:keytrust`، `test:security` و `test:offline` — همه
یک رلهٔ واقعی را می‌رانند و بعد فایل‌های خودش را از دیسک می‌خوانند، چون ویژگی
امنیتی‌ای که کسی از بیرون اندازه‌اش نگرفته باشد یک کامنت است، نه یک تضمین.

### استقرار به‌روزرسانی

`scripts/deploy.sh` همین درخت کاری را روی سرور خودتان می‌فرستد و همان‌جا بازسازی
می‌کند. بار اول می‌پرسد سرور کجاست — میزبان، حساب، پورت SSH، کلید، نشانی عمومی —
و جواب‌ها را در
`${XDG_CONFIG_HOME:-~/.config}/p00rija-cryptography/deploy.conf` می‌نویسد؛ فقط
برای خودتان خواندنی و **بیرون از این مخزن**، تا یک `git add .` هرگز برشان ندارد.
از آن به بعد هر اجرا فقط دیپلوی می‌کند.

```bash
npm run deploy:check            # سرور همین حالا چه چیزی سرو می‌کند
npm run deploy:dry              # چه چیزی تغییر می‌کند
npm run deploy                  # همگام‌سازی، بازسازی کانتینرها، راستی‌آزمایی

bash scripts/deploy.sh --help          # همهٔ گزینه‌ها
bash scripts/deploy.sh --edit          # باز کردن تنظیمات ذخیره‌شده در $EDITOR
bash scripts/deploy.sh --reconfigure   # پرسیدن دوباره
bash scripts/deploy.sh --where         # نشانی فایل تنظیمات
```

فقط احراز هویت با کلید، عمداً: رمزی که روی خط فرمان بیاید در جدول پروسه‌ها و در
تاریخچهٔ شل می‌نشیند. اسکریپت از دیپلوی روی پشتیبان یا روی یک مخزن گیت خودداری
می‌کند، پیش از بازنویسی از سرور اسنپ‌شات می‌گیرد، و در پایان بررسی می‌کند واقعاً
چه چیزی سرو می‌شود. `data/`، `certs/` و `.env` روی سرور هرگز دست نمی‌خورند.

نسل کش را در همان کامیتِ هر تغییر فرانت‌اند بالا ببرید، وگرنه کاربران وب‌اپ که
برمی‌گردند همان فایل‌های قدیمی را می‌گیرند:

```bash
OLD=$(grep -o 'chat-v[0-9]*' index.html | head -1)   # read, not spelled out
NEW=chat-v$(( ${OLD#chat-v} + 1 ))
sed -i '' "s/2\.26\.95-$OLD/2.44.0-$NEW/g" index.html sw.js js/app.js
sed -i '' "s/return '$OLD';/return '$NEW';/" js/app.js   # APP_BUILD_TAG fallback
node tools/check-versions.cjs   # refuses if any of the eight declarations drift
```

### رمزنگاری چطور کار می‌کند

| لایه | الگوریتم |
|---|---|
| رمز اصلی ← کلید | Argon2id |
| فایل‌ها، یادداشت‌ها، خزانه | AES-256-GCM |
| کلیدهای سشن چت | AES-256-GCM، مشتق‌شده در هر نشست — ECDH P-256 + HKDF-SHA-256 |
| گره زدن آن تبادل به هویت | RSA-OAEP-3072 (فقط یک مقدار عمومی را حمل می‌کند) |
| پیام‌های صف‌شده | کلید یک‌بارمصرف AES-256-GCM، مهرشده به prekey ۱۵ روزهٔ گیرنده |
| شمارهٔ امنیتی | SHA-256 دو اثر انگشت — پنج گروه عدد و پنج کلمه |
| اثر انگشت هویت | SHA-256 از کلید عمومی SPKI |
| انتقال فایل | یک کلید AES-256-GCM، یک IV تازه برای هر تکهٔ ۶۴ کیلوبایتی |
| یکپارچگی | SHA-256 / SHA-512 |

کلیدها با CSPRNG خود سکو از طریق Web Crypto ساخته می‌شوند و هرگز از دستگاه خارج
نمی‌شوند. رله پاکت‌های مهر و موم شده می‌بیند؛ TURN بسته می‌بیند.

### ظرفیت و مقیاس

`npm run test:perf` می‌سنجد که یک نمونه چه می‌کند؛ [docs/SCALING.md](docs/SCALING.md)
نتایج و معنایشان را ثبت کرده است. خلاصه: رله در مسیر رسانه نیست، پس تأخیر از
۲۵ همتا تا ۱۶۰۰ همتا ثابت می‌ماند (p95 برابر ۱ میلی‌ثانیه)، و سقف‌ها هنگام
راه‌اندازی از CPU و RAM ماشین مشتق می‌شوند. همان سند دقیقاً می‌گوید برای اجرای
بیش از یک نمونه چه چیزی باید تغییر کند و چرا هنوز ارزشش را ندارد.

### ساختار مخزن

```
index.html            کل رابط کاربری
js/app.js             بیست ابزار، پوسته‌ها، چندزبانگی، تنظیمات
js/chat/              پیام‌رسان، در بخش‌های مرتب: رمزنگاری، انتقال، تماس، گروه
js/desktop-bridge.js  تنها جایی که از پوستهٔ نیتیو خبر دارد
src-tauri/            پوستهٔ Rust — تری، اعلان، امحاگر، SSH، خزانه
scripts/server.js     رله: حضور، PeerJS، صندوق پستی، نگهداری
scripts/setup.sh      نصب‌کنندهٔ سرور و مدیر استقرار
scripts/deploy.sh     فرستادن این درخت روی سرور خودتان (بار اول تنظیمات را می‌پرسد)
config/               Docker Compose، nginx، Dockerfile‌ها
tests/e2e/            سوییت‌های سرتاسری، هرکدام با باگی که نگهبانش است
```

### گزارش مشکل امنیتی

issue عمومی باز نکنید. به **p00rija@tutamail.com** ایمیل بزنید.
[SECURITY.md](SECURITY.md) می‌گوید چه چیزی در دامنه است، کدام نسخه‌ها اصلاح
می‌شوند، و کدام محدودیت‌ها — نبود محافظت فراداده، نبود امنیت پس از افشا،
بسته‌های بدون امضا، نبود ممیزی مستقل — عمدی‌اند نه باگ.

### حمایت از پروژه

رایگان، AGPL، بدون تبلیغات، بدون تله‌متری، بدون حساب کاربری، و بدون داده‌ای برای
فروش — پس با کمک مردم می‌چرخد. TON، همان آدرسی که خود برنامه در **دربارهٔ من ←
حمایت از پروژه** نشان می‌دهد:

```
UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf
```

[کیف پول تلگرام](https://t.me/wallet) · [انتقال آماده](https://app.tonkeeper.com/transfer/UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf)

حمایت نکردن هم جواب درستی است: کد همین‌جاست، AGPL است، و بالا آوردن رلهٔ خودت
چیزی جز یک سرور از تو نمی‌خواهد.

### مجوز

AGPL-3.0-only. [LICENSE](LICENSE) را ببینید. بند ۱۳ اینجا مهم است: اگر رلهٔ
تغییریافته‌ای را به‌عنوان سرویس برای دیگران اجرا کنید، آن‌ها حق دارند کد شما را
بگیرند.
