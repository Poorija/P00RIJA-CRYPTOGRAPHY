<img src="assets/pwa-icons/icon-192.png" alt="P00RIJÃ Cryptography" width="72" align="right">

# Security Policy

[🇬🇧 English](#english) · [🇮🇷 فارسی](#فارسی)

## English

### Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Email **p00rija@tutamail.com** with:

- what the flaw lets an attacker do,
- the steps or code needed to reproduce it,
- the version you tested (the About page shows it), and
- the platform: PWA, macOS, Windows, Linux, Android or iOS.

You will get an acknowledgement. A fix ships before the details are made public,
and you will be credited in the release notes unless you ask otherwise.

### Which versions get fixes

Only the latest release. This is a single-maintainer project; there are no
backport branches.

### Scope

In scope: the browser payload (`js/`, `sw.js`, `index.html`), the relay
(`scripts/server.js`, `standalone-relay/`), the native shell (`src-tauri/`), and
the build and deployment scripts.

Out of scope: findings that need physical access to an unlocked device, attacks
that assume the user's master password is already known, and the deliberate
design limits listed below.

### What this app does not claim

These are known, documented properties, not vulnerabilities:

- **Metadata is not hidden.** The relay sees who is online, who talks to whom,
  and when — it just cannot read what they say.
- **There is no post-compromise security.** Sessions use ephemeral ECDH and keys
  expire, but there is no double ratchet. An attacker who steals a live session
  key can read that session until it rotates.
- **Queued messages expire.** A message that is never delivered stops being
  openable after 15 days, when the prekey that sealed it is destroyed.
- **History on disk is only as strong as the master password.** The vault is
  encrypted, but the key is derived from that password.
- **The packages are not notarized or Authenticode-signed.** Verify checksums.
- **No independent audit has been done.**

## فارسی

### گزارش آسیب‌پذیری

**لطفاً برای مشکل امنیتی issue عمومی باز نکنید.**

به **p00rija@tutamail.com** ایمیل بزنید و بنویسید:

- این نقص به مهاجم اجازهٔ چه کاری می‌دهد،
- مراحل یا کد لازم برای بازتولید،
- نسخه‌ای که آزمودید (در صفحهٔ «دربارهٔ من» هست)، و
- بستر: PWA، مک، ویندوز، لینوکس، اندروید یا iOS.

پاسخ دریافت می‌کنید. اصلاح پیش از عمومی شدن جزئیات منتشر می‌شود و نامتان در
یادداشت انتشار می‌آید، مگر آنکه نخواهید.

### کدام نسخه‌ها اصلاح می‌شوند

فقط آخرین نسخه. این پروژه یک نگهدارنده دارد و شاخهٔ backport ندارد.

### دامنه

داخل دامنه: بار مرورگر (`js/`، `sw.js`، `index.html`)، رله
(`scripts/server.js`، `standalone-relay/`)، پوستهٔ نیتیو (`src-tauri/`) و
اسکریپت‌های ساخت و استقرار.

بیرون از دامنه: یافته‌هایی که به دسترسی فیزیکی به دستگاه قفل‌نشده نیاز دارند،
حمله‌هایی که رمز مستر را از پیش معلوم می‌گیرند، و محدودیت‌های عمدی زیر.

### آنچه این برنامه ادعا نمی‌کند

این‌ها ویژگی‌های شناخته‌شده و مستندند، نه آسیب‌پذیری:

- **فراداده پنهان نیست.** رله می‌بیند چه کسی آنلاین است، با چه کسی و چه وقت حرف
  می‌زند — فقط نمی‌تواند بخواند چه می‌گویند.
- **امنیت پس از افشا وجود ندارد.** نشست‌ها از ECDH گذرا استفاده می‌کنند و کلیدها
  منقضی می‌شوند، ولی double ratchet نیست. مهاجمی که کلید نشست زنده را بدزدد تا
  چرخش بعدی همان نشست را می‌خواند.
- **پیام‌های صف‌شده منقضی می‌شوند.** پیامی که هرگز تحویل نشود، پس از ۱۵ روز — با
  نابودی prekeyی که آن را مهر کرده — دیگر باز نمی‌شود.
- **تاریخچهٔ روی دیسک فقط به قوت رمز مستر است.** خزانه رمزگذاری شده، ولی کلیدش
  از همان رمز مشتق می‌شود.
- **بسته‌ها notarize یا Authenticode-signed نیستند.** چک‌سام‌ها را بررسی کنید.
- **هیچ ممیزی مستقلی انجام نشده است.**
