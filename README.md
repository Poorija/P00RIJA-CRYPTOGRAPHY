<div dir="rtl" align="center">

# P00RIJA Cryptography Suite v2.99.0

سوئیت رمزنگاری، چت امن، رله/TURN و مانیتورینگ سرور با نسخه نیتیو Tauri 2.11.1

[English](#english) | [فارسی](#فارسی)

</div>

---

<a name="english"></a>
## English

### Overview

P00RIJA Cryptography is a client-side security suite for encryption, decryption, secure sharing, secure notes, passkeys/biometric unlock, secure file shredding, and encrypted chat. The project now ships as a web/PWA app, Docker server deployment, Tauri native desktop app, and a separate native server-monitor client.

The native builds use Tauri `2.11.1` and are prepared for macOS ARM/universal, Windows, Debian-based Linux, Red Hat-based Linux, Arch-based Linux, and AppImage packaging.

### Current Capabilities

- Client-side text/file encryption and decryption with modern Web Crypto workflows.
- Secure share links and encrypted bundles with expiry and view limits.
- Passkey and desktop biometric quick unlock through platform-backed secure storage.
- Native file access, notification, dialog, tray/background behavior, and secure file shredding support.
- Encrypted secure chat with PeerJS/WebRTC, relay fallback, offline queues, Web Push, TURN discovery, voice/video call support, pinned chats, QR identity sharing, and mobile QR scanning flow.
- Relay/TURN server discovery through `/chat-health`, `/turn-config`, `/peerjs`, and `/chat-signal`.
- Monitor_Server dashboard with login lockout after 3 failed attempts, logout, online peers, relay traffic, memory/storage/system stats, system broadcast, targeted user broadcast, suspend/resume, kick/unkick, offline queue cleanup, RAM optimization, and monitor password change.
- Separate native **P00RIJA Server Monitor** client that connects to any server by URL and exposes the Monitor_Server operations without opening the browser dashboard.
- Platform setup scripts for macOS, Windows, Linux desktop builds, and Linux server-only installation.
- Docker deployment is still supported and is the default server deployment path.

### Install Dependencies

```bash
npm install
```

Platform-specific setup scripts check system updates when possible, then verify the required tooling and native dependencies. If an update server is not reachable, the scripts warn and continue to dependency checks.

```bash
npm run setup:macos
npm run setup:linux
npm run setup:windows
npm run setup:server:linux
```

The original interactive Docker/server wizard is still available:

```bash
npm run setup
```

### Run Tests

```bash
npm test
npm run test:smoke
node --check scripts/server.js
node --check scripts/prepare-tauri-web.js
node --check scripts/prepare-monitor-tauri.js
```

### Server Deployment

Use the interactive setup wizard for local, public IP, or domain deployment:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

The wizard keeps Docker support, prepares `.env`, configures nginx/SSL when selected, builds containers, starts the server stack, and prints both the main server URL and Monitor_Server URL at completion.

Important server endpoints:

- `GET /chat-health`: relay health and discovery.
- `GET /turn-config`: TURN/ICE configuration for clients.
- `GET /peerjs/peerjs/id`: PeerJS compatibility check.
- `WS /chat-signal`: encrypted chat signaling and presence.
- `POST /admin/login`: Monitor_Server login.
- `GET /healthz`: authenticated monitor status.
- `POST /admin/broadcast`: system broadcast to everyone or one user.
- `POST /admin/suspend-peer`, `POST /admin/resume-peer`: suspend/resume users.
- `POST /admin/kick-peer`, `POST /admin/unkick-peer`: timed or permanent kick/unkick users.

### Native App Builds

Prepare the desktop web assets:

```bash
npm run native:prepare
```

Build the main native application:

```bash
npm run native:build:mac:arm64
npm run native:build:mac:universal
npm run native:build:windows
npm run native:build:linux
```

Tauri output is created under `src-tauri/target/**/release/bundle`. Final deliverables should be copied into `Native App/` with these folders:

- `Native App/` for macOS DMG files.
- `Native App/Windows/` for Windows installers.
- `Native App/Linux/Debian Base/` for `.deb`.
- `Native App/Linux/Redhat Base/` for `.rpm`.
- `Native App/Linux/Arch Base/` for pacman packages when produced by the Arch builder.
- `Native App/Linux/AppImage/` for `.AppImage`.

### Native Server Monitor Client

The monitor client is a separate Tauri app using `src-tauri/tauri.monitor.conf.json`. It loads `monitor-client.html` as the first screen and asks for:

- Server URL, for example `https://example.com:8585`.
- Monitor password.

After login, it uses the same Monitor_Server API token and can:

- Poll `/healthz`.
- Show online peers, suspended users, kicked users, memory, CPU, storage, traffic, active ports, and logs.
- Render the same live monitor charts as the web Monitor_Server dashboard for memory, CPU, suspended users, network peers, throughput, storage, and queues.
- Apply the same monitor appearance controls for language direction, theme, font family, and font size.
- Suspend or resume users.
- Kick users temporarily or permanently, then unkick them.
- Send a system broadcast to everyone or a selected online user.
- Attach a file/audio payload to a system broadcast.
- Clear offline queues, optimize RAM, clear dead sessions, and change the monitor password.

Prepare and build it:

```bash
npm run monitor:prepare
npm run monitor:build:mac:arm64
npm run monitor:build:mac:universal
npm run monitor:build:windows
npm run monitor:build:linux
```

### Native Platform Notes

- macOS builds require Xcode command line tools and Rust targets for `aarch64-apple-darwin`, `x86_64-apple-darwin`, and `universal-apple-darwin`.
- Windows builds should be produced on Windows or a Windows-capable CI runner with WebView2, NSIS/MSI tooling, Rust, Node.js, and Tauri CLI.
- Linux builds should be produced on Linux with WebKitGTK 4.1, AppIndicator/Ayatana, xdg-desktop-portal, PipeWire, WirePlumber, fprintd/Polkit, rpm, and AppImage tooling.
- Arch packages are best produced on an Arch builder from the Tauri Linux binary and desktop metadata.
- Cross-building Linux/Windows bundles from macOS is limited by WebKitGTK, NSIS/MSI, and platform bundler requirements.

---

<a name="فارسی"></a>
## فارسی

### معرفی

P00RIJA Cryptography یک برنامه امنیتی سمت کاربر برای رمزنگاری، رمزگشایی، اشتراک امن، یادداشت امن، ورود بایومتریک/Passkey، امحای امن فایل و چت رمزنگاری‌شده است. پروژه علاوه بر نسخه وب و PWA، نصب سرور با Docker، اپلیکیشن نیتیو Tauri و یک کلاینت نیتیو جدا برای مانیتورینگ سرور دارد.

نسخه نیتیو با Tauri `2.11.1` آماده شده و برای macOS ARM و universal، ویندوز، لینوکس Debian Base، لینوکس Redhat Base، لینوکس Arch Base و AppImage بسته‌بندی می‌شود.

### قابلیت‌های فعلی

- رمزنگاری و رمزگشایی متن و فایل به صورت سمت کاربر.
- ساخت لینک و باندل اشتراک امن با تاریخ انقضا و محدودیت تعداد مشاهده.
- ورود سریع با Passkey و بایومتریک دسکتاپ از طریق ذخیره‌سازی امن سیستم‌عامل.
- پشتیبانی نیتیو از فایل، اعلان سیستم‌عامل، دیالوگ، Tray/Taskbar، فعالیت در بکگراند و امحای امن فایل.
- چت امن رمزنگاری‌شده با PeerJS/WebRTC، رله، صف آفلاین، Web Push، دیسکاوری TURN، تماس صوتی/تصویری، پین چت، QR هویت و مسیر اسکن QR در موبایل.
- دیسکاوری رله و TURN از طریق `/chat-health`، `/turn-config`، `/peerjs` و `/chat-signal`.
- داشبورد Monitor_Server با قفل ۱۰ دقیقه‌ای پس از ۳ رمز اشتباه، خروج واقعی، کاربران آنلاین، ترافیک رله، وضعیت RAM/CPU/Storage، اعلان سیستمی عمومی و اختصاصی، تعلیق/رفع تعلیق، اخراج زمان‌دار یا نامحدود/رفع اخراج، پاک‌سازی صف آفلاین، بهینه‌سازی RAM و تغییر رمز مانیتور.
- کلاینت نیتیو جدا به نام **P00RIJA Server Monitor** که با وارد کردن آدرس سرور به Monitor_Server متصل می‌شود و همه عملیات مانیتورینگ را بدون نیاز به مرورگر انجام می‌دهد.
- اسکریپت‌های نصب جدا برای macOS، Windows، Linux و نصب فقط سرور روی Linux.
- نصب Docker حذف نشده و همچنان مسیر اصلی نصب سرور است.

### نصب نیازمندی‌ها

```bash
npm install
```

اسکریپت‌های اختصاصی هر سیستم‌عامل ابتدا تا حد ممکن آپدیت‌های سیستم را بررسی می‌کنند، سپس نیازمندی‌های برنامه را چک می‌کنند. اگر اینترنت یا سرور آپدیت در دسترس نباشد، هشدار می‌دهند و از مرحله آپدیت عبور می‌کنند، اما بررسی نیازمندی‌ها ادامه پیدا می‌کند.

```bash
npm run setup:macos
npm run setup:linux
npm run setup:windows
npm run setup:server:linux
```

ستاپ تعاملی اصلی سرور و Docker همچنان فعال است:

```bash
npm run setup
```

### تست

```bash
npm test
npm run test:smoke
node --check scripts/server.js
node --check scripts/prepare-tauri-web.js
node --check scripts/prepare-monitor-tauri.js
```

### نصب سرور

برای نصب Local، Domain یا Public IP از ستاپ تعاملی استفاده کنید:

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

این اسکریپت Docker را نگه می‌دارد، فایل `.env` و nginx/SSL را آماده می‌کند، کانتینرها را می‌سازد و اجرا می‌کند و در پایان هم آدرس سرور اصلی و هم آدرس Monitor_Server را نمایش می‌دهد.

مسیرهای مهم سرور:

- `GET /chat-health`: سلامت و دیسکاوری رله.
- `GET /turn-config`: تنظیمات TURN/ICE.
- `GET /peerjs/peerjs/id`: بررسی سازگاری PeerJS.
- `WS /chat-signal`: سیگنالینگ و Presence چت امن.
- `POST /admin/login`: ورود مانیتور.
- `GET /healthz`: وضعیت مانیتور با احراز هویت.
- `POST /admin/broadcast`: اعلان سیستمی برای همه یا یک کاربر.
- `POST /admin/suspend-peer` و `POST /admin/resume-peer`: تعلیق و رفع تعلیق.
- `POST /admin/kick-peer` و `POST /admin/unkick-peer`: اخراج زمان‌دار/نامحدود و رفع اخراج.

### بیلد نسخه نیتیو برنامه اصلی

```bash
npm run native:prepare
npm run native:build:mac:arm64
npm run native:build:mac:universal
npm run native:build:windows
npm run native:build:linux
```

خروجی Tauri در `src-tauri/target/**/release/bundle` ساخته می‌شود و خروجی نهایی باید در پوشه `Native App/` قرار بگیرد:

- `Native App/` برای DMG مک.
- `Native App/Windows/` برای نصب‌کننده‌های ویندوز.
- `Native App/Linux/Debian Base/` برای `.deb`.
- `Native App/Linux/Redhat Base/` برای `.rpm`.
- `Native App/Linux/Arch Base/` برای پکیج Arch.
- `Native App/Linux/AppImage/` برای `.AppImage`.

### کلاینت نیتیو مانیتور سرور

کلاینت مانیتور با کانفیگ `src-tauri/tauri.monitor.conf.json` ساخته می‌شود و صفحه `monitor-client.html` را به عنوان تجربه اصلی باز می‌کند. کاربر فقط آدرس سرور و رمز مانیتور را وارد می‌کند.

```bash
npm run monitor:prepare
npm run monitor:build:mac:arm64
npm run monitor:build:mac:universal
npm run monitor:build:windows
npm run monitor:build:linux
```

قابلیت‌های کلاینت مانیتور:

- اتصال به هر سرور P00RIJA با URL.
- مشاهده کاربران آنلاین، کاربران تعلیق‌شده، کاربران اخراج‌شده، وضعیت TURN، حافظه، CPU، Storage، پورت‌ها، ترافیک و لاگ‌ها.
- نمایش نمودارهای زنده مشابه داشبورد وب Monitor_Server برای حافظه، CPU، کاربران تعلیق‌شده، شبکه، ترافیک، Storage و صف‌ها.
- اعمال کنترل‌های ظاهری مشابه نسخه وب برای جهت زبان، تم، فونت و اندازه متن.
- تعلیق زمان‌دار و رفع تعلیق.
- اخراج زمان‌دار یا نامحدود و رفع اخراج.
- ارسال اعلان سیستمی برای همه کاربران یا یک کاربر خاص.
- ارسال فایل یا صوت همراه اعلان سیستمی.
- پاک‌سازی صف آفلاین، بهینه‌سازی RAM، پاک‌سازی نشست‌های مرده و تغییر رمز مانیتور.

### نکات بیلد سیستم‌عامل‌ها

- بیلد مک به Xcode Command Line Tools و تارگت‌های Rust برای `aarch64-apple-darwin`، `x86_64-apple-darwin` و `universal-apple-darwin` نیاز دارد.
- بیلد ویندوز بهتر است روی ویندوز یا CI ویندوزی با WebView2، NSIS/MSI، Rust، Node.js و Tauri CLI انجام شود.
- بیلد لینوکس باید روی لینوکس و با WebKitGTK 4.1، AppIndicator/Ayatana، xdg-desktop-portal، PipeWire، WirePlumber، fprintd/Polkit، rpm و ابزار AppImage انجام شود.
- پکیج Arch بهتر است روی Builder آرچ ساخته شود.
- ساخت بسته‌های Linux/Windows از روی macOS به خاطر وابستگی‌های WebKitGTK و ابزارهای NSIS/MSI محدودیت دارد.
