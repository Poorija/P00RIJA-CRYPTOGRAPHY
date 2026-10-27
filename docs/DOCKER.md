# Ready-made Docker images

[English](#english) · [فارسی](#فارسی)

## English

Everything P00RIJA runs is published on Docker Hub, so a server or the central
panel can be set up with Docker alone: nothing to clone, nothing to build.

| Image | What it is |
|---|---|
| `poorija/p00rija-app` | the app, served over HTTPS (nginx) |
| `poorija/p00rija-relay` | the relay: messages, calls, the monitoring dashboard |
| `poorija/p00rija-cert-renewer` | keeps the TLS certificate (Let's Encrypt or self-signed) |
| `poorija/p00rija-panel` | the central panel for all your servers, on your own computer |

Each image is tagged with its version (for example `2.98.84`) and `latest`, for
`linux/amd64` and `linux/arm64`. The TURN server is the upstream
`coturn/coturn` image.

### A server in one line

On a Linux server with Docker (the installer offers to install it if it is
missing):

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/docker-install.sh | bash
```

It asks three things, each with a default you accept with Enter:

- **Domain.** Leave it empty to use the server's public IP with a self-signed
  certificate. Give a domain to get a Let's Encrypt certificate.
- **Email for Let's Encrypt**, asked only when you gave a domain.
- **The app's port**, 8585 by default.

Then it does the rest:

1. Writes `.env` with random TURN secrets.
2. Makes the first certificate.
3. Starts the stack.
4. Prints the app address, the dashboard address, the user name and the
   password.

The same, without questions:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/docker-install.sh | bash -s -- --yes --domain chat.example.com --email you@example.com
```

| Option | Meaning |
|---|---|
| `--dir DIR` | install folder (default `/opt/p00rija` as root, else `~/p00rija`) |
| `--domain NAME` | domain or IP (default: the public IP) |
| `--email ADDRESS` | for Let's Encrypt |
| `--app-port N` | the app's HTTPS port (default 8585) |
| `--registry HOST` | pull through a registry mirror (see below) |
| `--version V` | run this release instead of `latest` |
| `--yes` | take every default |

**Default ports.** Open these in the server's (or the provider's) firewall:

- 8585/tcp: the app and the dashboard;
- 3478/udp and 3478/tcp: TURN;
- 5349/tcp: TURN over TLS;
- 49152–50152/udp: TURN relay ports;
- 80/tcp: only for the Let's Encrypt check.

**The dashboard login.**

- The address is `https://<domain>:8585/Monitor_Server`.
- The user is `admin`.
- The password is random. The relay makes it on its first start and shows it
  once: the installer prints it, and it is in `docker logs
  Poorija-Cryptography_ChatSignal`.
- Only its hash is stored. Change it from the dashboard; the first password
  stops working, and the file that held it (`data/chat-signal/initial-monitor-password`)
  is removed.
- No server is ever up with a password anyone else knows.

**Updating.** Run the installer again. It pulls the new images and recreates
the containers, and keeps `.env` and your data.

**Backups.** The install folder holds everything that matters:

- `.env` (secrets);
- `data/` (the relay's state and queued messages);
- `certs/` and `letsencrypt/`.

**Where Docker Hub is blocked or slow** (Iran, for example), pull through a
registry mirror:

```bash
curl -fsSL .../docker-install.sh | bash -s -- --registry docker.example-mirror.ir
```

Every image, coturn included, is then pulled as
`<mirror>/poorija/...` and `<mirror>/coturn/...`.

**By hand.** `docker/compose.yaml` is the compose file the installer uses. Put
it in a folder with a `.env` (at least `DOMAIN`, `EXTERNAL_IP`, `TURN_USER`,
`TURN_PASSWORD`, `TURN_SECRET`), then:

```bash
docker compose run --rm --no-deps cert-renewer --once
docker compose up -d
```

### The central panel on your own computer

```bash
bash scripts/panel.sh
```

It works the same on macOS and Linux:

- **Docker.** If Docker is not running, it starts it: OrbStack or Docker
  Desktop on a Mac, `systemctl` on Linux.
- **Questions, the first time:**
  - the port (8686);
  - whether to listen on this computer only (`127.0.0.1`) or on the LAN;
  - whether the panel should **start by itself whenever Docker starts**;
  - where your `deploy.conf` and SSH keys are.
- **Remembered answers.** They are kept in
  `~/.config/p00rija-cryptography/panel.env`: settings only, never a password.
  `--reconfigure` asks again.
- **Login.** The first start makes the login inside the container. You choose
  your own name and password, then add the secret it prints to an authenticator
  app (TOTP): type it in, or open the `otpauth://` link it prints on the phone.
  The script never sees them.
- **The LAN.** On the LAN, give it a certificate (`--tls-cert FILE --tls-key
  FILE`) so the login is sent over HTTPS. Without one it warns, every time,
  that the login crosses the network unencrypted.
- **Other commands:** `stop`, `status`, `logs`, `update` (new image,
  same settings), and `login` (a new login, or `--new-code` for a new app code).

The script pulls `poorija/p00rija-panel`. Run from a checkout whose version is
not on Docker Hub yet, or with `--build`, it builds the same image from source.
The script is a single file, so it can also be downloaded on its own:

```bash
curl -fsSLO https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/panel.sh && bash panel.sh
```

What the panel does is in [CONTROL-PANEL.md](CONTROL-PANEL.md).

### Publishing the images (maintainers)

```bash
bash scripts/dockerhub-release.sh          # build for this machine, check, keep locally
docker login
bash scripts/dockerhub-release.sh --push   # build amd64 + arm64, check, push
```

**The check, before anything is pushed.** It reads every layer of every image,
and the image config with its build history: a file deleted in a later layer
is still pushed. It looks for the strings that must not leave the maintainer's
machine, which come from files that are never committed:

- every host, IP and user in `~/.config/p00rija-cryptography/deploy.conf`;
- the first column of `tools/private-strings.txt`.

Any hit stops the run and names the file. The Docker Hub page text is in
`docker/README.dockerhub.md`.

---

## فارسی

همهٔ اجزای P00RIJA روی Docker Hub منتشر شده‌اند. پس یک سرور یا پنل مرکزی را
فقط با Docker می‌شود راه انداخت؛ نه کلون لازم است، نه build.

| ایمیج | چیست |
|---|---|
| `poorija/p00rija-app` | خود برنامه، روی HTTPS (nginx) |
| `poorija/p00rija-relay` | رله: پیام، تماس و داشبورد مانیتورینگ |
| `poorija/p00rija-cert-renewer` | نگه‌دارندهٔ گواهی TLS (Let's Encrypt یا خودامضا) |
| `poorija/p00rija-panel` | پنل مرکزی همهٔ سرورهای شما، روی کامپیوتر خودتان |

هر ایمیج با نسخه‌اش (مثلاً `2.98.84`) و با `latest` تگ می‌خورد و برای
`linux/amd64` و `linux/arm64` ساخته می‌شود. سرور TURN همان ایمیج رسمی
`coturn/coturn` است.

### یک سرور با یک خط

روی یک سرور لینوکسی که Docker دارد (اگر نداشته باشد، نصب‌کننده پیشنهاد نصبش را
می‌دهد):

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/docker-install.sh | bash
```

سه چیز می‌پرسد. هر کدام یک پیش‌فرض دارد که با Enter پذیرفته می‌شود:

- **دامنه.** اگر خالی بماند، IP عمومی سرور با گواهی خودامضا به کار می‌رود. اگر
  دامنه بدهید، گواهی Let's Encrypt می‌گیرد.
- **ایمیل برای Let's Encrypt**، فقط وقتی دامنه داده باشید.
- **پورت برنامه**، پیش‌فرض ۸۵۸۵.

بقیه را خودش انجام می‌دهد:

1. ‏`.env` را با رمزهای تصادفی TURN می‌نویسد.
2. اولین گواهی را می‌سازد.
3. کانتینرها را بالا می‌آورد.
4. نشانی برنامه، نشانی داشبورد، نام کاربری و رمز را نشان می‌دهد.

همین کار، بدون سؤال:

```bash
curl -fsSL https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/docker-install.sh | bash -s -- --yes --domain chat.example.com --email you@example.com
```

| گزینه | معنی |
|---|---|
| `--dir DIR` | پوشهٔ نصب (پیش‌فرض `/opt/p00rija` برای root، وگرنه `~/p00rija`) |
| `--domain NAME` | دامنه یا IP (پیش‌فرض: IP عمومی) |
| `--email ADDRESS` | برای Let's Encrypt |
| `--app-port N` | پورت HTTPS برنامه (پیش‌فرض ۸۵۸۵) |
| `--registry HOST` | کشیدن ایمیج‌ها از راه یک mirror (پایین‌تر) |
| `--version V` | اجرای این نسخه به جای `latest` |
| `--yes` | پذیرفتن همهٔ پیش‌فرض‌ها |

**پورت‌های پیش‌فرض.** این‌ها را در فایروال سرور (یا فایروال ارائه‌دهنده) باز
کنید:

- ‏8585/tcp: برنامه و داشبورد؛
- ‏3478/udp و 3478/tcp: سرور TURN؛
- ‏5349/tcp: سرور TURN روی TLS؛
- ‏49152 تا 50152/udp: پورت‌های رلهٔ TURN؛
- ‏80/tcp: فقط برای بررسی Let's Encrypt.

**ورود به داشبورد.**

- نشانی `https://<domain>:8585/Monitor_Server` است.
- نام کاربری `admin` است.
- رمز تصادفی است. رله آن را در اولین اجرا می‌سازد و یک بار نشان می‌دهد:
  نصب‌کننده چاپش می‌کند و در `docker logs Poorija-Cryptography_ChatSignal` هم
  هست.
- فقط hash آن ذخیره می‌شود. از داشبورد عوضش کنید؛ رمز اول دیگر کار نمی‌کند و
  فایلی که آن را نگه می‌داشت (`data/chat-signal/initial-monitor-password`) پاک
  می‌شود.
- هیچ سروری هیچ‌وقت با رمزی که دیگران می‌دانند بالا نیست.

**به‌روزرسانی.** نصب‌کننده را دوباره اجرا کنید. ایمیج‌های تازه را می‌کشد و
کانتینرها را از نو می‌سازد، و `.env` و داده‌ها را نگه می‌دارد.

**پشتیبان.** هرچه مهم است در پوشهٔ نصب است:

- ‏`.env` (رمزها)؛
- ‏`data/` (وضعیت رله و پیام‌های در صف)؛
- ‏`certs/` و `letsencrypt/`.

**جایی که Docker Hub بسته یا کند است** (مثلاً در ایران)، ایمیج‌ها را از راه یک
mirror بکشید:

```bash
curl -fsSL .../docker-install.sh | bash -s -- --registry docker.example-mirror.ir
```

در این حالت همهٔ ایمیج‌ها، coturn هم، به شکل `<mirror>/poorija/...` و
`<mirror>/coturn/...` کشیده می‌شوند.

**دستی.** فایل `docker/compose.yaml` همان فایل compose نصب‌کننده است. آن را با
یک `.env` در یک پوشه بگذارید (دست‌کم `DOMAIN`، `EXTERNAL_IP`، `TURN_USER`،
`TURN_PASSWORD` و `TURN_SECRET`) و بعد:

```bash
docker compose run --rm --no-deps cert-renewer --once
docker compose up -d
```

### پنل مرکزی روی کامپیوتر خودتان

```bash
bash scripts/panel.sh
```

روی macOS و لینوکس یکسان کار می‌کند:

- **Docker.** اگر Docker روشن نباشد، روشنش می‌کند: OrbStack یا Docker Desktop
  روی مک، و `systemctl` روی لینوکس.
- **سؤال‌های بار اول:**
  - پورت (۸۶۸۶)؛
  - اینکه فقط روی همین کامپیوتر (`127.0.0.1`) باز باشد یا روی شبکهٔ محلی؛
  - اینکه **با روشن شدن Docker خودش بالا بیاید** یا نه؛
  - جای `deploy.conf` و کلیدهای SSH.
- **جواب‌ها.** در `~/.config/p00rija-cryptography/panel.env` می‌مانند؛ فقط
  تنظیمات، هرگز رمز. `--reconfigure` دوباره می‌پرسد.
- **ورود.** بار اول، ورود پنل داخل کانتینر ساخته می‌شود. نام و رمز را خودتان
  انتخاب می‌کنید، بعد کلیدی را که چاپ می‌کند به یک برنامهٔ احراز هویت (TOTP)
  اضافه می‌کنید: تایپش کنید، یا لینک `otpauth://` را روی گوشی باز کنید. اسکریپت
  آن‌ها را هرگز نمی‌بیند.
- **شبکهٔ محلی.** روی شبکهٔ محلی به آن گواهی بدهید (`--tls-cert FILE --tls-key
  FILE`) تا ورود روی HTTPS فرستاده شود. بدون گواهی، هر بار هشدار می‌دهد که ورود
  بدون رمزنگاری از شبکه می‌گذرد.
- **فرمان‌های دیگر:** `stop`، `status`، `logs`، `update` (ایمیج تازه با همان
  تنظیمات) و `login` (ورود تازه، یا `--new-code` برای کد تازهٔ برنامه).

اسکریپت `poorija/p00rija-panel` را می‌کشد. اگر از نسخه‌ای از مخزن اجرا شود که
هنوز روی Docker Hub نیست، یا با `--build`، همان ایمیج را از سورس می‌سازد.
اسکریپت یک فایل تنهاست، پس جدا هم دانلود می‌شود:

```bash
curl -fsSLO https://raw.githubusercontent.com/Poorija/P00RIJA-CRYPTOGRAPHY/main/scripts/panel.sh && bash panel.sh
```

کار پنل در [CONTROL-PANEL.md](CONTROL-PANEL.md) آمده است.

### انتشار ایمیج‌ها (برای نگه‌دارندگان)

```bash
bash scripts/dockerhub-release.sh          # ساخت برای همین ماشین، بررسی، نگه‌داشتن محلی
docker login
bash scripts/dockerhub-release.sh --push   # ساخت amd64 و arm64، بررسی، push
```

**بررسی پیش از هر push.** همهٔ لایه‌های هر ایمیج و تنظیمات ایمیج با تاریخچهٔ
build را می‌خواند؛ فایلی که در لایهٔ بعدی پاک شده، باز هم push می‌شود. دنبال
رشته‌هایی می‌گردد که نباید از ماشین نگه‌دارنده بیرون بروند. این رشته‌ها از
فایل‌هایی می‌آیند که هرگز کامیت نمی‌شوند:

- هر میزبان، IP و کاربر در `~/.config/p00rija-cryptography/deploy.conf`؛
- ستون اول `tools/private-strings.txt`.

با هر مورد پیدا شده کار متوقف می‌شود و نام فایل گفته می‌شود. متن صفحهٔ Docker
Hub در `docker/README.dockerhub.md` است.
