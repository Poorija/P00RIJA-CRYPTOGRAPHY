# Monitor Server v3.33 — راهنمای کامل

Version 3.33 · مستقل از نسخهٔ برنامه، فقط روی سرور

این سند راهنمای کامل داشبورد مدیریت سرور P00RIJA Cryptography است — کنسولی که ادمین رله از طریق آن کل زیرساخت را ممیزی، مدیریت و نگهداری می‌کند.

---

## دسترسی

| سرور | آدرس |
|---|---|
| اول | `https://YOUR-SERVER-1:8585/Monitor_Server` |
| دوم | `https://YOUR-SERVER-2:8585/Monitor_Server` |

- **نام کاربری**: `admin` (پیش‌فرض؛ با متغیر `MONITOR_USER` قابل تغییر)
- **رمز عبور**: همان `MONITOR_PASSWORD` در فایل `.env` سرور. اگر خالی باشد (نصب آمادهٔ Docker)، رله در اولین اجرا یک رمز تصادفی می‌سازد و یک بار نشانش می‌دهد: در `docker logs` و در `data/chat-signal/initial-monitor-password`. فقط hash آن نگه داشته می‌شود و با تغییر رمز از داشبورد، آن فایل پاک می‌شود (از 2.98.84).
- ورود با قفل سه‌مرحله‌ای: ۳ تلاش ناموفق = ۱۰ دقیقه قفل
- سشن با هر درخواست معتبر تمدید می‌شود (Sliding TTL)
- صفحهٔ ورود از نسخهٔ 2.91.22 به بعد فیلد نام کاربری دارد

## نصب‌کنندهٔ خام (Bootstrap)

```bash
curl -sSL http://SERVER:9080/install | bash -s -- http://SERVER:9080 <token> ~/poorija
```

- توکن از تب «نصب خام» داشبورد ساخته می‌شود
- بسته: برنامهٔ کامل بدون هیچ داده/هویت/راز از سرور مبدا
- استک با هویت تازه روی هر ماشین بالا می‌آید
- پورت: `CHAT_BOOTSTRAP_PORT` (پیش‌فرض 9080؛ مقدار 0 غیرفعال می‌کند)

---

## تب‌های داشبورد

### ۱. نمای کلی (Overview)

- ۶ کارت: کاربران متصل، پردازنده، **رم کانتینر** (از cgroup — مطابق سقف تنظیم‌شده)، دیسک، صف، Transit
- ۶ نمودار زنده: کاربران، CPU، حافظه، **پیام‌ها بر ثانیه**، **شبکهٔ ورودی/خروجی** (دو خط)، **مصرف دیسک**
- سلامت رله: چیپ‌های خوانا (محدودیت‌ها، میل‌باکس‌ها، سوکت‌ها، throttle)
- جدول دورریخته‌ها با علت/شمار/زمان

### ۲. صف‌های پیام (Queues)

- میل‌باکس‌های آفلاین به‌تفکیک گیرنده (تعداد/حجم/قدیمی‌ترین/جدیدترین)
- بازکردن هر میل‌باکس: آیتم‌ها با متادیتا (بدون payload)
- **حذف تک‌آیتم یا کل صندوق**
- **تحویل فوری** (flush) به متصل‌ها
- **دفتر انقضا**: چه پیامی، کِی و چرا حذف شد

### ۳. کاربران (Users)

- جدول متصل‌ها با جستجوی زنده (نام/شناسه/IP)
- **دکمهٔ کپی fingerprint** کنار هر کاربر (🫆)
- **بج «بین‌رله»**: کاربر واقعاً محتوای ≥۱KB از لینک رله‌ها فرستاده (پروب‌های کوچک حساب نیستند)
- تعلیق/اخراج با مدت یا دائمی + رفع
- Allowlist با برچسب
- **مرکز پیام سرور**: عنوان + متن + پیوست (تصویر/استیکر/صدا/فایل تا ۲MB) → به **همه** (آنلاین + آفلاین + پوش نوتیفیکیشن) یا **شخصی** (فیلد fingerprint)
- پخش زنده (فقط متصل‌ها)

### ۴. رله‌ها (Relays)

- لیست لینک‌های transit با وضعیت/نقش/ترافیک هر رله
- **افزودن/حذف در لحظه** (بدون ری‌استارت؛ بعد از ری‌استارت هم می‌ماند)
- Persistence: `data/transit-peers.json`

### ۵. ترافیک (Traffic)

- مجموع‌ها (پیام/بایت ورودی/خروجی/رله‌شده)
- پرمصرف‌ترین کاربران
- ترافیک به‌تفکیک هر رله

### ۶. سرور و بکاپ (Machine)

**بکاپ‌ها:**
- ساخت بکاپ کامل (job container، retention ۱۰)
- لیست/دانلود/ری‌استور (overlay + بکاپ ایمنی خودکار = رول‌بک)/حذف

**رم و CPU:**
- رم فیزیکی سرور + هسته‌ها + نسخهٔ داکر
- جدول هر کانتینر: سقف/مصرف رم + CPU%
- **رم جدید + CPU% جدید**: رم = 0 یعنی نامحدود؛ CPU: ۱۰۰ = یک هسته، ۵۰ = نیم، ۲۰۰ = دو
- اعمال زنده بدون ری‌استارت
- پیشنهاد هوشمند: ۲ برابر مصرف فعلی (گرد به ۶۴)

**دیسک و پاکسازی:**
- مصرف دیسک + حجم ایمیج‌ها
- **لیست تگ‌های قدیمی برنامه** با چک‌باکس + «انتخاب همه» + «حذف تیک‌خورده‌ها»
- **لیست لایه‌های بی‌صاحب** با چک‌باکس + انتخاب همه + حذف
- پاک‌کردن فایل‌های موقت

**ایمیج‌های داکر:**
- لیست کامل با تگ استک
- **چک داکر هاب**: digest شما vs آخرین Hub + تاریخ انتشار + «آپدیت؟» confirm
- آپدیت (pull همان tag)
- **خروجی خام ایمیج رله** (docker save stream)

**گیت‌هاب:**
- بررسی ریلیز جدید
- دانلود و اعمال با بکاپ ایمنی + رول‌بک یک‌کلیکی
- چیپ وضعیت کنار نوار بالا (سبز = به‌روز)

### ۷. گزارش‌ها (Reports)

- تماس‌های زنده (۱:۱/گروهی با زمان شروع)
- فعالیت بین‌رله‌ای (چه کاربرانی اخیراً از لینک رده‌ها فرستاده‌اند)
- نمودار ستونی ترافیک ساعتی (۴۸ ساعت)
- **جریان رخدادها** (بکاپ/ری‌استور/حذف رله/پیام/…)
- خروجی CSV (ترافیک/صف‌ها/کاربران) + JSON (اسنپ‌شات کامل)

### ۸. نصب خام (Bootstrap)

- نمایش/ساخت توکن
- دستور curl آماده برای کپی

### ۹. سیستم (System)

- Node / هاست‌نیم / CPU مدل / load average
- TURN: on/off + آدرس‌ها
- Relay ID با دکمهٔ کپی
- **آزادسازی رم** (gc) + **پاک‌سازی حافظه** (رکوردهای مرده)
- تغییر رمز مانیتور
- گزارش‌های زنده (لاگ)

---

## امکانات عمومی

| قابلیت | توضیح |
|---|---|
| زبان | فارسی / English |
| تم | dark / light / ocean / midnight |
| رفرش | 1s 🔴 / 5s / 10s / 30s / 60s / دستی |
| شورتکات | ۱-۸ تب‌ها · R نوسازی |
| جستجو | کاربران (نام/شناسه/IP) |
| مقاوم‌سازی سشن | retry قبل از خروج + نوار قرمز (بدون reload ناگهانی) |
| throttle تب ماشین | حداکثر هر ۳۰s صرف‌نظر از تیک |

---

## معماری امنیتی

- **صفر subprocess / صفر shell**: Docker Engine API روی unix socket (JSON)
- آرشیوها با کانتینرهای کوتاه‌عمر با آرگومان ثابت
- تنها fetch خروجی: literal ثابت به ریلیز خود پروژه
- پیوست announce: ≤۲MB data URL با validation
- cleanup انتخابی: regex-validated + skip in-use
- docker.sock پشت همان رمز مانیتور؛ حذف یک خط volume = غیرفعال

## Managing all your servers from one place (from 2.98.78)

`node tools/control-panel.mjs` runs on your own computer and nowhere else. It
reads your servers from the same `deploy.conf` the deploy uses, opens an SSH
tunnel to each server's dashboard (nothing on a server is opened for it),
reads each dashboard password over SSH into memory, and opens a page on
127.0.0.1: every server at a glance (state, version, load, memory, disk,
people online, relay links, family, partners), actions for all of them at once
(check for updates, update one server at a time, back up, test alerts), and
each server's own dashboard one click away, without typing its password.

**Signed dangerous actions.** The first run makes this computer's *admin key*
and asks for a passphrase that seals it. It prints one line for the operator
to run where the operator key is:

```bash
node tools/relay-directory.mjs admin-add "my-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

From then on, the panel signs the actions that can do harm (users, the
dashboard password, partners, gateways, restarts, updates, backups) and every
relay checks the signature. A lost laptop is dropped with `admin-remove`. On a
computer that does not hold the operator key, the panel first asks you to
confirm the family's operator id, which you compare with what the operator
gives you (`node tools/relay-directory.mjs show` prints it): it never takes
that from a server's word.

**Locking a server.** `CHAT_REQUIRE_OPERATOR_SIGNATURE=1` in a server's
`.env` (or the panel's Lock button, which sets it over SSH) makes that server
take its dangerous actions only signed, so a dashboard password that leaks no
longer reaches them from the web. Reading is never locked. `CHAT_CENTRAL_CONTROL=0`
takes a server out of the panel's hands altogether.

**What stays on your computer:** the admin key sealed under its passphrase
(dropped from memory after 15 minutes idle), and `control-panel.log`, which
records what was done and whether it was signed, never a password. The page
opens only with the one-time link the panel prints, and only from this
computer's browser.

**In the browser, with a login (from 2.98.79).** The same panel, much fuller —
every section of this dashboard for all your servers, the network as a graph,
and clusters — runs in Docker and opens in your browser behind a password and an
authenticator code, with each browser holding its own signing key:
[CONTROL-PANEL.md](CONTROL-PANEL.md).

## پنل مرکزی برای همهٔ سرورها (از نسخهٔ 2.98.78)

`node tools/control-panel.mjs` فقط روی کامپیوتر خود شما اجرا می‌شود. سرورها را از
همان `deploy.conf` استقرار می‌خواند، به پنل هر سرور یک تونل SSH می‌زند (هیچ پورتی
روی سرورها برایش باز نمی‌شود)، رمز پنل هر سرور را از راه SSH فقط در حافظه نگه
می‌دارد و صفحه‌ای روی 127.0.0.1 باز می‌کند: همهٔ سرورها در یک نگاه (وضعیت، نسخه،
بار، حافظه، دیسک، کاربران آنلاین، لینک رله‌ها، خانواده، شریک‌ها)، کارهای هم‌زمان
برای همه (بررسی نسخهٔ تازه، به‌روزرسانی یکی‌یکی، پشتیبان‌گیری، آزمایش هشدار)، و پنل
کامل هر سرور با یک کلیک و بدون وارد کردن رمز.

**کارهای حساس با امضا.** اولین اجرا برای این کامپیوتر یک *کلید ادمین* می‌سازد و
عبارت عبوری برای قفل کردن آن می‌پرسد، و یک خط چاپ می‌کند که اپراتور روی کامپیوتر
دارای کلید اپراتور اجرا کند:

```bash
node tools/relay-directory.mjs admin-add "my-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

از آن پس پنل کارهایی را که می‌توانند آسیب بزنند (کاربران، رمز پنل، شریک‌ها،
Gatewayها، ری‌استارت، به‌روزرسانی، پشتیبان) امضا می‌کند و هر رله امضا را بررسی
می‌کند. لپ‌تاپ گم‌شده با `admin-remove` کنار گذاشته می‌شود. روی کامپیوتری که کلید
اپراتور را ندارد، پنل اول از شما می‌خواهد شناسهٔ اپراتور خانواده را تأیید کنید و آن را
با شناسه‌ای که اپراتور به شما می‌دهد مقایسه کنید (`node tools/relay-directory.mjs show`
آن را چاپ می‌کند)؛ پنل این را هرگز به گفتهٔ یک سرور نمی‌پذیرد.

**قفل کردن سرور.** `CHAT_REQUIRE_OPERATOR_SIGNATURE=1` در `.env` سرور (یا دکمهٔ قفل در
پنل مرکزی که آن را از راه SSH می‌گذارد) باعث می‌شود کارهای حساس آن سرور فقط با
امضا انجام شوند؛ پس اگر رمز پنل لو برود، از وب به آن‌ها نمی‌رسد. خواندن هرگز قفل
نمی‌شود. `CHAT_CENTRAL_CONTROL=0` سرور را کاملاً از دسترس پنل مرکزی بیرون می‌برد.

**چه چیزی روی کامپیوتر شما می‌ماند:** کلید ادمین قفل‌شده با عبارت عبور (که بعد از
۱۵ دقیقه بی‌کاری از حافظه پاک می‌شود)، و `control-panel.log` که ثبت می‌کند چه کاری
شد و با امضا بود یا نه، هرگز رمز. صفحه فقط با لینک یک‌بارمصرفی که پنل چاپ می‌کند و
فقط از مرورگر همین کامپیوتر باز می‌شود.

**در مرورگر، با ورود (از نسخهٔ 2.98.79).** همین پنل، بسیار کامل‌تر (همهٔ بخش‌های این
داشبورد برای همهٔ سرورها، شبکه به صورت گراف، و خوشه‌ها)، در داکر اجرا می‌شود و در
مرورگر پشت رمز و کد دومرحله‌ای باز می‌شود و هر مرورگر کلید امضای خودش را دارد:
[CONTROL-PANEL.md](CONTROL-PANEL.md).

## Alerts in Telegram (from 2.98.81)

One relay of the family holds the bot (`TELEGRAM_BOT_TOKEN` and
`CHAT_ALERT_TELEGRAM_CHAT_ID`); every other relay hands it its alerts over
the family's links, preferring a member that said it has the bot. Each message
is a card: how serious it is, the server named in full (its name, address,
whether it is inside or outside Iran, its cluster and gateway place, version,
build, and relay id — for a relayed card, the id its link proved), what
happened, and that server's state at the moment the card is sent: people
online, queued messages, processor, memory, the relay's own memory, disk,
relay links and how many are post-quantum, TURN, and uptime.

The bot also answers, in the operator's chat only: `/status` (every server's
state right now, grouped by cluster, the ones with a problem marked, the ones
that did not answer by name), `/servers` (each server's full name and place),
and `/help`. Once a day at `CHAT_STATUS_REPORT_AT` (09:00 Tehran time) the same
summary arrives on its own. If the bot has a webhook, or something else reads
its updates, the commands are left to that.

## هشدار در تلگرام (از نسخهٔ 2.98.81)

یکی از رله‌های خانواده ربات را دارد (`TELEGRAM_BOT_TOKEN` و
`CHAT_ALERT_TELEGRAM_CHAT_ID`) و بقیه هشدارهایشان را از لینک‌های خانواده به آن
می‌دهند، اول به عضوی که گفته ربات دارد. هر پیام یک کارت است: شدت آن، نام کامل سرور
(نام، نشانی، داخل یا خارج ایران، خوشه و جایگاه Gateway، نسخه، build و شناسهٔ رله؛ در
کارتی که از رلهٔ دیگری رسیده، شناسه‌ای که لینک آن را تأیید کرده)، چه اتفاقی افتاده، و
وضعیت همان سرور در لحظهٔ فرستادن کارت: کاربران آنلاین، پیام‌های صف، پردازنده، حافظه،
حافظهٔ خود رله، دیسک، لینک رله‌ها و تعداد post-quantum، TURN و مدت روشن بودن.

ربات فقط در چت اپراتور جواب هم می‌دهد: `/status` (وضعیت همهٔ سرورها همین لحظه،
گروه‌بندی‌شده بر اساس خوشه، با علامت سرورهای مشکل‌دار و نام سرورهایی که جواب ندادند)،
`/servers` (نام و جای کامل هر سرور) و `/help`. هر روز ساعت `CHAT_STATUS_REPORT_AT`
(۹ صبح به وقت تهران) همین خلاصه خودش می‌آید. اگر ربات webhook داشته باشد یا چیز دیگری
پیام‌هایش را بخواند، دستورها به همان سپرده می‌شوند.

## متغیرهای محیطی

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| `MONITOR_PASSWORD` | — | رمز ورود (≥۱۲). اگر خالی باشد، اولین اجرا رمزی تصادفی می‌سازد |
| `CHAT_ENV_FILE` | `.env` کنار مخزن | فایل `.env` اجرای بدون Docker؛ `none` یعنی هیچ فایلی |
| `MONITOR_USER` | admin | نام کاربری |
| `OPS_INSTALL_DIR` | — | مسیر نصب روی host (برای bind mounts) |
| `OPS_BACKUP_DIR` | `$INSTALL/backups` | محل بکاپ‌ها |
| `OPS_JOB_IMAGE` | node:26.12.1-alpine | ایمیج job containerها |
| `OPS_DOCKER_SOCKET` | /var/run/docker.sock | سوکت داکر |
| `CHAT_BOOTSTRAP_PORT` | 9080 | پورت نصب‌کنندهٔ خام |
| `OPS_HUB_MIRROR` | https://hub.docker.com | میرور داکر هاب (برای ایران) |
| `MONITOR_SESSION_TTL_MS` | 12h | TTL سشن (سلسله‌ای) |
| `APP_VERSION` | — | نسخهٔ جاری (برای تشخیص تگ stale) |
| `OPS_DATA_DIR` | `$INSTALL/data/chat-signal` | دادهٔ رله روی host (تحویل فایل دانلود پشتیبان و bundle) |
| `CHAT_ALERT_TELEGRAM_CHAT_ID` | — | چت تلگرامی که هشدارها به آن می‌رود (با `TELEGRAM_BOT_TOKEN`)؛ رلهٔ بدون این دو، هشدار را از لینک transit به رلهٔ دیگر می‌دهد |
| `CHAT_ALERT_PEERS` | — | شناسهٔ رله‌هایی که هشدار به آن‌ها فرستاده یا از آن‌ها پذیرفته می‌شود (با کاما)؛ خالی یعنی همهٔ اعضای خانوادهٔ امضاشده |
| `CHAT_ALERT_LABEL` | نام میزبان | نام این رله روی کارت‌های تلگرام (کنار نشانی، خوشه، نسخه و شناسهٔ آن) |
| `CHAT_STATUS_REPORT_AT` | 09:00 | ساعت گزارش روزانهٔ همهٔ سرورها به وقت تهران؛ `off` برای خاموش |
| `CHAT_TELEGRAM_COMMANDS` | 1 | `0`: ربات به دستورهای `/status`، `/servers` و `/help` جواب نمی‌دهد |
| `CHAT_FAMILY_LINKS_MS` | 60000 | هر چند وقت رله به اعضای خانواده می‌گوید با کدام اعضا لینک دارد |
| `CHAT_GATEWAY_STABLE_MS` | 60000 | مدتی که لینک یک Gateway باید پایدار بماند تا دوباره ترافیک ببرد |
| `CHAT_GATEWAY_HANDOFF_MS` | 120000 | مدتی که Gateway کنارگذاشته‌شده لینک‌های شریک‌ها را تا بالا آمدن Gateway تازه نگه می‌دارد |
| `CHAT_JOIN_PER_HOUR` | 10 | سقف درخواست اتصال از هر نشانی در ساعت |
| `CHAT_JOIN_WAITING_MAX` | 20 | سقف درخواست‌های در انتظار تأیید |
| `CHAT_REQUIRE_OPERATOR_SIGNATURE` | 0 | `1`: کارهای حساس پنل فقط با امضای کلید اپراتور یا کلید ادمین (قفل) |
| `CHAT_CENTRAL_CONTROL` | 1 | `0`: درخواست‌های امضاشدهٔ پنل مرکزی پذیرفته نمی‌شوند |
| `CHAT_ALERT_DISK_FREE_PCT` / `_GB` | 10 / 2 | هشدار دیسک زیر این درصد یا گیگابایت آزاد |
| `CHAT_ALERT_MEMORY_FREE_PCT` | 10 | هشدار حافظهٔ سرور زیر این درصد آزاد |
| `CHAT_ALERT_TURN_PCT` | 80 | هشدار وقتی این درصد از پورت‌های رلهٔ coturn گرفته شده باشد |
| `CHAT_ALERT_LINK_MBPS` | 0 | سرعت لینک سرور (مگابیت)؛ ۰ یعنی هشدار پهنای باند خاموش |
| `CHAT_ALERT_REMIND_HOURS` | 6 | فاصلهٔ یادآوری تا وقتی مشکل ادامه دارد |
| `TURN_MIN_PORT` / `TURN_MAX_PORT` | 49152 / 50152 | بازهٔ پورت رلهٔ coturn (در `.env`) |

---

## عیب‌یابی

| علامت | علت / راه‌حل |
|---|---|
| `docker-socket-not-mounted` | volume سوکت در compose حذف/کامنت شده |
| `ops-paths-not-configured` | `OPS_INSTALL_DIR` ست نشده (deploy خودش ست می‌کند) |
| `list-failed` در بکاپ‌ها | دایرکتوری backups وجود ندارد؛ دکمهٔ ساخت بکاپ می‌سازدش |
| نوتیف دوبار | لاگ `Announce → fp (awake/push)` را ببینید؛ کلاینت باید 2.91.28+ باشد |
| بج بین‌رله بی‌جا | پروب‌های presence زیر ۱KB حساب نمی‌شوند؛ فقط محتوای واقعی |

---

AGPL-3.0-only · P00RIJA · p00rija@tutamail.com
