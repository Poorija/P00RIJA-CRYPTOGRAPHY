# The central panel

[فارسی](#راهنمای-فارسی)

One panel for every server you run: each section of a relay's own dashboard,
for all of them side by side, the network drawn as a graph you can change, and
your servers grouped into clusters. It is in this repository for anyone who
deploys their own servers, and it works from the same `deploy.conf` the deploy
uses.

It comes two ways:

- **In Docker, in your browser, with a login** (from 2.98.79): described here.
- **On the command line**, `node tools/control-panel.mjs` (from 2.98.78): a
  one-time link, every server at a glance, and each server's own dashboard
  through a proxy. See [MONITOR-SERVER.md](MONITOR-SERVER.md). It still works
  as it did.

## Starting it

On your own computer, with Docker Desktop (or Docker on Linux), from the
repository:

```bash
docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login
docker compose -f config/control-panel.compose.yaml up -d --build
```

The first command makes the login: a name, a password of at least 12
characters, and a secret for an authenticator app (Google Authenticator,
Aegis, 1Password, and the like), which it prints once, as text and as an
`otpauth://` link. The second starts the panel. Open
**http://127.0.0.1:8686/** and log in with the name, the password, and the
six-digit code the app shows.

What the container is given:

| | Default | |
|---|---|---|
| `/config` | `~/.config/p00rija-cryptography`, read-only | `deploy.conf`, and the operator's files if this is the operator's computer |
| `/ssh-src` | `~/.ssh`, read-only | the SSH keys `deploy.conf` names as `~/.ssh/…` |
| `/state` | a Docker volume | the login, the operator you confirmed, the graph layout, and the audit log |

Settings for the compose file, all optional: `POORIJA_CONFIG_DIR`,
`POORIJA_SSH_DIR`, `POORIJA_PANEL_PORT` (8686), and `POORIJA_CONFIG_ACCESS`
(`ro`, or `rw` on the computer with the operator key; see
[Clusters](#clusters)). Without Docker the same panel runs as
`node tools/panel/setup-login.mjs` and then `node tools/panel/server.mjs`.

Nothing is opened on any server for it: it reaches each server's dashboard
through an SSH tunnel to that server's own loopback, and reads each dashboard
password over SSH into memory. A server whose `.env` password no longer
matches asks for it in the overview, for this session only.

## Logging in

- The password is kept only as a scrypt hash, and the app secret only in
  `/state/control-panel-login.json` (mode 600).
- A code once used is spent; a code from the step before or after is taken, so
  a clock a little off still works.
- Five failed logins lock the address for 15 minutes
  (`POORIJA_PANEL_LOCK_MS`).
- A session ends after 30 minutes without anyone using the page
  (`POORIJA_PANEL_SESSION_IDLE_MS`); the page reading new numbers on its own
  does not count as using it.
- `setup-login --new-code` keeps the name and password and gives a new app
  secret; running `setup-login` again replaces the login.

## Keys in the browser

The panel holds no signing key. Each browser makes its own in the **This
browser's key** tab: an ECDSA P-256 key made with WebCrypto, its private half
not extractable, kept in that browser's IndexedDB. The tab prints the two lines
the operator runs where the operator key is:

```bash
node tools/relay-directory.mjs admin-add "office-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

Then **Check again**, and the key shows as listed. From then on the page signs
every dangerous action (users, passwords, partners, gateways, restarts,
updates, backups, a server's lock, and changes to the family list) over exactly
what it is about to send, and each relay checks the signature. A locked server
(`CHAT_REQUIRE_OPERATOR_SIGNATURE=1`) takes nothing dangerous without one.

**What a web page cannot promise.** If the computer that runs the panel were
broken into, it could not take the key away, but it could ask a page that is
open in your browser to sign. That is why the panel runs on your own computer
and answers on 127.0.0.1 by default. It can run on a server (see below), with
that in mind.

## The sections

The tabs are a relay dashboard's tabs, for every server at once: Overview,
Network, Message queues, Users, Relays, Traffic, Server and backups, Reports,
Fresh install, System, and Clusters. Each table has the server and its cluster
on every row; the bar above the tabs shows all clusters or one, and any servers
you tick.

- **On a row:** that row's server does it (kick a user, drop a mailbox, restore
  a backup, approve a partner, …).
- **Above a table:** every server shown does it, one after another, and the
  result for each is written below (send queues again, back up, test alerts,
  restart, update from GitHub one at a time, stopping at the first failure, …).
- **Ticked rows:** kick, suspend, or delete the rows you ticked, each on its
  own server.
- **Forms:** the message centre, the allowlist, manual links, partner requests,
  and the dashboard password go to the servers shown, or to the one you pick.
- CSV for users, mailboxes, and traffic, with the server on each line.

Everything a relay's own dashboard does, the panel does; the suite checks the
panel's list of actions against the dashboard's calls.

## The network

The Network tab draws your family as a graph:

- **Nodes:** each relay, in the colour of its cluster, with an orange ring and
  its number if it is a gateway, a lock if it is locked, and a dashed edge if
  it does not answer; each other operator's family as one node; a relay outside
  the family that you linked by hand.
- **Frames:** each cluster, and whether it is independent (every member linked
  to every other).
- **Edges:** family links (green up, red dashed down), manual links (purple),
  links to partners (orange), and a partner reached through another (dotted).

What you can do on it, each after a question, and signed when it must be:

- drag nodes (the layout stays on this computer, in `/state`);
- drop a relay on another cluster's frame, or pick a cluster in its details, to
  move it there;
- set its inside addresses;
- order the gateways by dragging the list, then save them on every server;
- link two relays by hand, or remove a manual link;
- approve, reject, or disconnect another operator, or look one up and ask.

## Clusters

A cluster is a named group of your family's relays, for example *Iran* and
*Outside*. Every relay still links with every other and users of one cluster
talk with users of the other as before; what a cluster adds is that its relays
reach each other first at their **inside addresses**, so a cluster cut off from
the international internet keeps working on its own. See
[RELAY-NETWORK.md, Clusters](RELAY-NETWORK.md#clusters-from-29879).

Changing a cluster or an inside address re-signs the family list, which takes
the operator key. The panel can do it only where that key is, with the config
folder writable:

```bash
POORIJA_CONFIG_ACCESS=rw docker compose -f config/control-panel.compose.yaml up -d
```

It then signs the new list (serial one higher), saves it beside your
`deploy.conf` as `relay-directory.mjs` does, and hands it to every server. A
change also needs a signature from a listed browser key, so a stolen session
alone cannot re-sign your family. Anywhere else, clusters are shown, not
changed.

## Running it on a server

Possible, with the warning above. Serve it over HTTPS with the server's
certificate (the one 3X-UI uses works), and tell it the address browsers use:

```bash
POORIJA_PANEL_HOST=0.0.0.0 POORIJA_PANEL_PORT=8686 \
POORIJA_PANEL_ORIGINS=https://panel.example.com:8686 \
POORIJA_PANEL_TLS_CERT=/root/cert/example.com/fullchain.pem \
POORIJA_PANEL_TLS_KEY=/root/cert/example.com/privkey.pem \
node tools/panel/server.mjs
```

Behind a reverse proxy instead, set `POORIJA_PANEL_SECURE_COOKIE=1` and
`POORIJA_PANEL_TRUSTED_PROXY` to the proxy's address, so failed logins lock the
address the proxy names and not everyone behind it.

## What it keeps, and what it never does

- `control-panel.log` in `/state`: who did what, on which server, and whether
  it was signed; never a password.
- It never writes a dashboard password to disk, never takes the family's
  operator from a server's word (it uses the operator key beside `deploy.conf`,
  or the operator id you confirm), and never signs for a server whose identity
  does not match the signed family list.
- The page runs no script but its own, and every value a server sends is
  escaped before it is shown.

| Variable | Default | |
|---|---|---|
| `POORIJA_PANEL_HOST` | `127.0.0.1` | `0.0.0.0` in the image |
| `POORIJA_PANEL_PORT` | `8686` | |
| `POORIJA_PANEL_ORIGINS` | `http://127.0.0.1:<port>,http://localhost:<port>` | the addresses browsers reach it at |
| `POORIJA_PANEL_STATE_DIR` | the config folder | `/state` in the image |
| `POORIJA_PANEL_SESSION_IDLE_MS` | `1800000` | |
| `POORIJA_PANEL_LOCK_MS` | `900000` | after five failed logins |
| `POORIJA_PANEL_TLS_CERT`, `POORIJA_PANEL_TLS_KEY` | | serve HTTPS |
| `POORIJA_PANEL_SECURE_COOKIE` | | `1` behind an HTTPS proxy |
| `POORIJA_PANEL_TRUSTED_PROXY` | | the proxy's address |
| `POORIJA_PANEL_OPERATOR_ID` | | the family operator, instead of confirming it in the page |
| `POORIJA_PANEL_KNOWN_HOSTS` | | an SSH known_hosts file of its own |

---

## راهنمای فارسی

یک پنل برای همهٔ سرورهایی که دارید: هر بخش پنل یک رله، برای همهٔ سرورها کنار هم؛
شبکه به صورت گرافی که می‌شود عوضش کرد؛ و سرورها در خوشه‌ها. این ابزار در همین
مخزن است تا هر کسی که روی سرورهای خودش مستقر می‌کند از آن استفاده کند، و از همان
`deploy.conf` استقرار کار می‌کند.

دو شکل دارد:

- **داکر، در مرورگر، با ورود** (از نسخهٔ 2.98.79): همین راهنما.
- **خط فرمان**، `node tools/control-panel.mjs` (از نسخهٔ 2.98.78): لینک یک‌بارمصرف،
  همهٔ سرورها در یک نگاه، و پنل هر سرور از راه پروکسی. در
  [MONITOR-SERVER.md](MONITOR-SERVER.md) آمده و مثل قبل کار می‌کند.

### راه‌اندازی

روی کامپیوتر خودتان با Docker Desktop (یا داکر روی لینوکس)، در پوشهٔ مخزن:

```bash
docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login
docker compose -f config/control-panel.compose.yaml up -d --build
```

دستور اول ورود را می‌سازد: یک نام، رمزی دست‌کم ۱۲ حرفی، و کلیدی برای برنامهٔ
کد دومرحله‌ای (Google Authenticator، Aegis، 1Password و مانند این‌ها) که فقط
همان یک بار، هم به صورت متن و هم به صورت لینک `otpauth://`، چاپ می‌شود. دستور دوم
پنل را بالا می‌آورد. **http://127.0.0.1:8686/** را باز کنید و با نام، رمز و کد
شش‌رقمی برنامه وارد شوید.

آنچه به کانتینر داده می‌شود:

| | پیش‌فرض | |
|---|---|---|
| `/config` | `~/.config/p00rija-cryptography`، فقط‌خواندنی | `deploy.conf`، و فایل‌های اپراتور اگر این کامپیوتر اپراتور است |
| `/ssh-src` | `~/.ssh`، فقط‌خواندنی | کلیدهای SSH که `deploy.conf` به شکل `~/.ssh/…` نام برده |
| `/state` | یک volume داکر | ورود، اپراتوری که تأیید کرده‌اید، چیدمان گراف، و گزارش کارها |

تنظیمات اختیاری فایل compose: `POORIJA_CONFIG_DIR`، `POORIJA_SSH_DIR`،
`POORIJA_PANEL_PORT` (۸۶۸۶)، و `POORIJA_CONFIG_ACCESS` (`ro`، یا `rw` روی کامپیوتری
که کلید اپراتور دارد؛ بخش [خوشه‌ها](#خوشهها) را ببینید). بدون داکر هم همین پنل با
`node tools/panel/setup-login.mjs` و سپس `node tools/panel/server.mjs` اجرا می‌شود.

هیچ پورتی روی سرورها برایش باز نمی‌شود: به پنل هر سرور از راه تونل SSH به
loopback خود آن سرور می‌رسد و رمز پنل هر سرور را از راه SSH فقط در حافظه نگه
می‌دارد. سروری که رمز `.env` آن دیگر درست نیست، در نمای کلی رمز را می‌پرسد، فقط برای
همین نشست.

### ورود

- رمز فقط به صورت هش scrypt نگه داشته می‌شود و کلید برنامه فقط در
  `/state/control-panel-login.json` (با دسترسی ۶۰۰).
- هر کد فقط یک بار پذیرفته می‌شود؛ کد یک قدم قبل یا بعد هم پذیرفته می‌شود تا ساعتی
  که کمی جلو یا عقب است مشکلی نسازد.
- پنج ورود ناموفق، آن نشانی را ۱۵ دقیقه قفل می‌کند (`POORIJA_PANEL_LOCK_MS`).
- نشست بعد از ۳۰ دقیقه بی‌کاری بسته می‌شود (`POORIJA_PANEL_SESSION_IDLE_MS`)؛
  خواندن خودکار عددهای تازه به‌حساب کار کردن با صفحه نمی‌آید.
- `setup-login --new-code` نام و رمز را نگه می‌دارد و کلید تازه‌ای برای برنامه
  می‌دهد؛ اجرای دوبارهٔ `setup-login` ورود را از نو می‌سازد.

### کلید در مرورگر

پنل هیچ کلید امضایی نگه نمی‌دارد. هر مرورگر در زبانهٔ **کلید این مرورگر** کلید خودش را
می‌سازد: کلید ECDSA P-256 با WebCrypto که نیمهٔ خصوصی‌اش بیرون‌بردنی نیست و در
IndexedDB همان مرورگر می‌ماند. این زبانه دو خطی را چاپ می‌کند که اپراتور روی
کامپیوتری که کلید اپراتور دارد اجرا می‌کند:

```bash
node tools/relay-directory.mjs admin-add "office-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

بعد **دوباره بررسی کن** را بزنید تا کلید «در فهرست» نشان داده شود. از آن پس صفحه هر
کار حساس (کاربران، رمزها، شریک‌ها، Gatewayها، ری‌استارت، به‌روزرسانی، پشتیبان،
قفل سرور، و تغییر فهرست خانواده) را دقیقاً روی همان چیزی که می‌فرستد امضا می‌کند و
هر رله امضا را بررسی می‌کند. سرور قفل‌شده (`CHAT_REQUIRE_OPERATOR_SIGNATURE=1`) هیچ
کار حساسی را بی‌امضا نمی‌پذیرد.

**آنچه یک صفحهٔ وب نمی‌تواند تضمین کند.** اگر کامپیوتری که پنل روی آن اجرا می‌شود
نفوذ شود، کلید را نمی‌تواند ببرد، ولی تا وقتی صفحه در مرورگر شما باز است می‌تواند از
آن امضا بخواهد. برای همین پنل به‌طور پیش‌فرض روی کامپیوتر خودتان و فقط روی 127.0.0.1
اجرا می‌شود. اجرای آن روی سرور هم شدنی است (پایین‌تر)، با در نظر داشتن همین نکته.

### بخش‌ها

زبانه‌ها همان زبانه‌های پنل رله‌اند، برای همهٔ سرورها با هم: نمای کلی، شبکه،
صف‌های پیام، کاربران، رله‌ها، ترافیک، سرور و پشتیبان، گزارش‌ها، نصب خام، سیستم و
خوشه‌ها. در هر جدول، سرور و خوشهٔ آن روی هر ردیف هست؛ نوار بالای زبانه‌ها همهٔ
خوشه‌ها یا یکی را نشان می‌دهد، و هر سروری که تیک بزنید.

- **روی هر ردیف:** سرور همان ردیف کار را انجام می‌دهد (اخراج کاربر، حذف میل‌باکس،
  بازگردانی پشتیبان، تأیید شریک، …).
- **بالای هر جدول:** همهٔ سرورهای نمایش‌داده‌شده یکی‌یکی کار را انجام می‌دهند و نتیجهٔ
  هر کدام زیر صفحه نوشته می‌شود (ارسال دوبارهٔ صف‌ها، پشتیبان‌گیری، آزمایش هشدار،
  ری‌استارت، به‌روزرسانی از گیت‌هاب یکی‌یکی که با اولین خطا می‌ایستد، …).
- **ردیف‌های تیک‌خورده:** اخراج، تعلیق یا حذف ردیف‌های انتخاب‌شده، هر کدام روی سرور خودش.
- **فرم‌ها:** مرکز پیام، اجازه‌نامه، لینک دستی، درخواست شراکت و رمز پنل به سرورهای
  نمایش‌داده‌شده یا سروری که انتخاب می‌کنید می‌روند.
- خروجی CSV کاربران، میل‌باکس‌ها و ترافیک، با نام سرور در هر خط.

هر کاری که پنل یک رله می‌کند، پنل مرکزی هم می‌کند؛ مجموعهٔ آزمایش فهرست کارهای پنل
مرکزی را با فراخوانی‌های پنل رله مقایسه می‌کند.

### شبکه

زبانهٔ شبکه خانوادهٔ شما را به صورت گراف نشان می‌دهد:

- **گره‌ها:** هر رله به رنگ خوشه‌اش، با حلقهٔ نارنجی و شمارهٔ اولویت اگر Gateway
  باشد، قفل اگر قفل باشد، و حاشیهٔ خط‌چین اگر جواب ندهد؛ خانوادهٔ هر اپراتور دیگر
  به صورت یک گره؛ و رله‌ای بیرون از خانواده که دستی لینکش کرده‌اید.
- **قاب‌ها:** هر خوشه، و اینکه مستقل است یا نه (همهٔ اعضا با هم لینک دارند).
- **یال‌ها:** لینک خانواده (سبز وصل، قرمز خط‌چین قطع)، لینک دستی (بنفش)، لینک به
  شریک (نارنجی)، و شریکی که از راه شریک دیگر به آن می‌رسید (نقطه‌چین).

کارهایی که روی گراف می‌شود کرد، هر کدام بعد از پرسیدن و در صورت نیاز با امضا:

- کشیدن گره‌ها (چیدمان فقط روی همین کامپیوتر در `/state` می‌ماند)؛
- انداختن رله روی قاب خوشهٔ دیگر، یا انتخاب خوشه در جزئیاتش، برای بردن به آن خوشه؛
- تعیین نشانی‌های داخلی آن؛
- مرتب کردن Gatewayها با کشیدن فهرست و ذخیره روی همهٔ سرورها؛
- لینک دستی بین دو رله، یا برداشتن لینک دستی؛
- تأیید، رد یا قطع ارتباط با اپراتور دیگر، یا پیدا کردن یکی و درخواست شراکت.

### خوشه‌ها

خوشه گروهی نام‌دار از رله‌های خانوادهٔ شماست، مثلاً *ایران* و *خارج*. همهٔ رله‌ها مثل
قبل با هم لینک دارند و کاربران یک خوشه مثل قبل با کاربران خوشهٔ دیگر حرف می‌زنند؛
چیزی که خوشه اضافه می‌کند این است که رله‌های یک خوشه اول با **نشانی‌های داخلی** به هم
وصل می‌شوند، پس اگر خوشه از اینترنت بین‌الملل جدا شود، به‌تنهایی کار می‌کند.
[RELAY-NETWORK.md، خوشه‌ها](RELAY-NETWORK.md#خوشهها-از-نسخهٔ-29879) را ببینید.

تغییر خوشه یا نشانی داخلی فهرست خانواده را دوباره امضا می‌کند و کلید اپراتور
می‌خواهد. پنل فقط جایی می‌تواند این کار را بکند که آن کلید هست و پوشهٔ تنظیمات
نوشتنی است:

```bash
POORIJA_CONFIG_ACCESS=rw docker compose -f config/control-panel.compose.yaml up -d
```

پنل فهرست تازه را (با شمارهٔ یکی بیشتر) امضا می‌کند، مثل `relay-directory.mjs` کنار
`deploy.conf` ذخیره می‌کند و به همهٔ سرورها می‌دهد. هر تغییر امضای یک کلید مرورگرِ
در فهرست را هم می‌خواهد، تا نشستِ دزدیده‌شده به‌تنهایی نتواند خانوادهٔ شما را دوباره
امضا کند. هر جای دیگری خوشه‌ها فقط دیدنی‌اند.

### اجرا روی سرور

شدنی است، با همان هشدار بالا. آن را با گواهی سرور روی HTTPS بالا بیاورید (همان
گواهی که 3X-UI استفاده می‌کند کار می‌کند) و نشانی‌ای را که مرورگرها باز می‌کنند به آن
بگویید:

```bash
POORIJA_PANEL_HOST=0.0.0.0 POORIJA_PANEL_PORT=8686 \
POORIJA_PANEL_ORIGINS=https://panel.example.com:8686 \
POORIJA_PANEL_TLS_CERT=/root/cert/example.com/fullchain.pem \
POORIJA_PANEL_TLS_KEY=/root/cert/example.com/privkey.pem \
node tools/panel/server.mjs
```

اگر پشت reverse proxy است، `POORIJA_PANEL_SECURE_COOKIE=1` و
`POORIJA_PANEL_TRUSTED_PROXY` را برابر نشانی پروکسی بگذارید تا ورودهای ناموفق
نشانی‌ای را قفل کنند که پروکسی نام می‌برد، نه همه را.

### آنچه نگه می‌دارد و آنچه هرگز نمی‌کند

- `control-panel.log` در `/state`: چه کسی چه کاری روی کدام سرور کرد و با امضا بود یا
  نه؛ هرگز رمز.
- رمز پنل‌ها را هرگز روی دیسک نمی‌نویسد، اپراتور خانواده را هرگز به گفتهٔ یک سرور
  نمی‌پذیرد (کلید اپراتور کنار `deploy.conf` یا شناسه‌ای که شما تأیید کرده‌اید)، و برای
  سروری که هویتش با فهرست امضاشدهٔ خانواده نمی‌خواند هرگز امضا نمی‌کند.
- صفحه هیچ اسکریپتی جز اسکریپت خودش اجرا نمی‌کند و هر مقداری که سرور می‌فرستد پیش
  از نمایش escape می‌شود.

متغیرهای محیطی همان جدول بخش انگلیسی‌اند.
