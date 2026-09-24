/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

const APP_VERSION = '2.26';
const APP_VERSION_SEMVER = '2.44.6';
/* Same-number patch rounds are invisible to the user otherwise — the About
   page prints the build tag so any device can say which round it is on.
 *
 * READ FROM THIS FILE'S OWN URL rather than kept as a literal. The asset tag
 * lives in four places that a release bumps together — index.html, sw.js, the
 * ?v= on every script tag, and this — and a literal here was the one
 * tools/check-versions.cjs never looked at. It drifted: a build served as
 * 2.26.90-chat-v16 introduced itself on the About page as chat-v11, so the one
 * screen a person is told to read when reporting a bug named the wrong build.
 * index.html loads this script as js/app.js?v=<semver>-<tag>, so the tag is
 * already here; the literal below is only the answer for a context that has no
 * script URL at all (a bundler, a test importing the file directly). */
const APP_BUILD_TAG = (() => {
  try {
    const src = String(document.currentScript?.src || '');
    const found = /[?&]v=\d+\.\d+\.\d+-([A-Za-z0-9._-]+)/.exec(src);
    if (found) return found[1];
  } catch (_error) { /* no document, or no currentScript */ }
  return 'chat-v75';
})();
/* The About page prints the version. Reading it from here rather than from a
   literal in the markup is what keeps the two from drifting apart again —
   provided this actually runs, which is the part that was wrong.
 *
 * It was registered on DOMContentLoaded alone. This file is deferred, so on a
 * plain load it runs before that event and the listener fires; but on the
 * deployed site, where a service worker serves the shell and the app reloads
 * itself once when it sees a new worker, the script can execute after
 * DOMContentLoaded has already gone by — and then nothing ever overwrote the
 * markup. The live site introduced itself as "Version 2.99.90" while serving
 * 2.26.95, which is exactly the drift tools/check-versions.cjs exists to stop,
 * happening on the one screen a person is asked to read.
 *
 * Written immediately now, with the listener kept only for the case where the
 * element genuinely is not parsed yet. */
/** Shows the row on the native builds and reflects the stored choice. */
function syncUpdateCheckUi() {
const row = document.getElementById('aboutUpdateRow');
const auto = document.getElementById('aboutUpdateAuto');
const updater = window.PoorijaUpdate;
if (!row || !updater) return;
row.classList.toggle('hidden', !updater.eligible());
if (auto) auto.checked = updater.enabled();
}

function setUpdateAutoCheck(on) {
window.PoorijaUpdate?.setEnabled(Boolean(on));
syncUpdateCheckUi();
}

/* Offers a newer release, and opens the right file for this machine.
 *
 * Nothing is installed here and nothing is fetched into the app's own memory:
 * accepting opens the asset in the system browser, which downloads it where
 * that person's downloads go, and they install it themselves. Neither phone
 * platform lets an app replace itself, and on the desktop a self-updater that
 * downloads and runs a binary is a remote code execution channel into a
 * cryptography app -- which is a poor trade for saving one click.
 */
async function offerUpdate(latest) {
const updater = window.PoorijaUpdate;
if (!updater || !latest || latest.error || latest.upToDate) return;
const notes = latest.notes
? `\n\n${latest.notes.slice(0, 1200)}`
: `\n\n${state.language === 'fa' ? 'یادداشت انتشاری ثبت نشده است.' : 'This release carries no notes.'}`;
const heading = state.language === 'fa'
? `نسخهٔ ${latest.version} منتشر شده است. نسخهٔ فعلی شما ${APP_VERSION_SEMVER} است.`
: `Version ${latest.version} is out. You are running ${APP_VERSION_SEMVER}.`;
/* No asset for this platform means iOS, or a release that shipped without
   this machine's artefact. Sending them to the page is the honest answer;
   offering a download that does not exist is not. */
const hasFile = Boolean(latest.asset);
const okLabel = hasFile
? (state.language === 'fa' ? 'دانلود' : 'Download')
: (state.language === 'fa' ? 'باز کردن صفحه' : 'Open the page');
const accepted = await PoorijaDialogs.confirm(heading + notes, {
title: state.language === 'fa' ? 'به‌روزرسانی در دسترس است' : 'An update is available',
okLabel,
cancelLabel: state.language === 'fa' ? 'بعداً' : 'Not now',
});
if (!accepted) return;
const target = hasFile ? latest.asset.url : latest.page;
try {
/* The native shells hand https links to the operating system; the browser
   build opens a tab. Both end with the file in that person's downloads. */
if (window.PoorijaDesktop?.available) await window.PoorijaDesktop.openExternal(target);
else window.open(target, '_blank', 'noopener');
showNotification(hasFile
? (state.language === 'fa'
? `دانلود ${latest.asset.name} آغاز شد. پس از پایان، خودتان نصبش کنید.`
: `Downloading ${latest.asset.name}. Install it yourself once it lands.`)
: (state.language === 'fa' ? 'صفحهٔ انتشار باز شد.' : 'The releases page is open.'),
'info');
} catch (error) {
showNotification(state.language === 'fa' ? 'باز کردن لینک ناموفق بود' : 'The link would not open', 'error');
}
}

/** The About page's button: says something whatever the answer is. */
async function checkForUpdatesNow() {
const updater = window.PoorijaUpdate;
if (!updater) return;
const button = document.getElementById('aboutUpdateBtn');
if (button) button.disabled = true;
try {
const latest = await updater.check(true);
if (!latest || latest.error) {
showNotification(state.language === 'fa'
? 'دسترسی به گیت‌هاب ممکن نشد. اتصال یا محدودیت نرخ.'
: 'GitHub could not be reached — connection, or a rate limit.', 'warning');
return;
}
if (latest.upToDate) {
showNotification(state.language === 'fa'
? `به‌روز هستید (${latest.version}).`
: `You are up to date (${latest.version}).`, 'success');
return;
}
await offerUpdate(latest);
} finally {
if (button) button.disabled = false;
}
}

/* One quiet check after launch, on the native builds only.
 *
 * Delayed rather than immediate: the first seconds after launch belong to
 * unlocking and to the relay, and an update dialog that lands on top of the
 * password field is an interruption, not a service. */
function scheduleUpdateCheck() {
const updater = window.PoorijaUpdate;
if (!updater?.eligible() || !updater.enabled()) return;
setTimeout(async () => {
try {
const latest = await updater.check(false);
if (latest) await offerUpdate(latest);
} catch (_error) { /* a failed check is not worth reporting unprompted */ }
}, 12000);
}

function paintAboutVersion() {
  const el = document.getElementById('aboutVersion');
  if (!el) return false;
  el.textContent = `Version ${APP_VERSION_SEMVER} · build ${APP_BUILD_TAG}`;
  return true;
}
if (!paintAboutVersion()) {
  document.addEventListener('DOMContentLoaded', paintAboutVersion);
}
/* The row and the launch check both need PoorijaUpdate, which is a separate
   deferred script -- so they wait for the document rather than running at
   parse time, where the load order is not guaranteed either way. */
document.addEventListener('DOMContentLoaded', () => {
  syncUpdateCheckUi();
  scheduleUpdateCheck();
});
const INSTALLATION_SECRET_STORAGE_KEY = 'poorija_installation_secret';
const INSTALLATION_BINDING_NAMESPACE = 'poorija-installation-binding-v1';
// ==================== Translations ====================
const translations = {
fa: {
appSubtitle: 'سوئیت پیشرفته رمزنگاری',
selectLanguage: 'انتخاب زبان',
persian: 'فارسی',
english: 'انگلیسی',
englishSubtitle: 'English',
installPwaVersion: 'نسخه PWA را نصب کنید',
pwaBenefitDesc: 'برای تجربه بهتر، اجرای آفلاین، ظاهر شبیه اپلیکیشن و دسترسی راحت‌تر به قابلیت‌های دستگاه، این برنامه را به صورت PWA نصب کنید.',
installOrGuide: 'نصب / راهنمای نصب',
continueInBrowser: 'ادامه در مرورگر',
generateRandomKey: 'تولید کلید تصادفی',
panicPasswordPlaceholder: 'رمز عبور اضطراری جدید',
play: 'پخش',
oneMinute: '1 دقیقه',
fiveMinutes: '5 دقیقه',
fifteenMinutes: '15 دقیقه',
thirtyMinutes: '30 دقیقه',
customAutoLockPlaceholder: 'مدت زمان (دقیقه)',
regenerate: 'تولید مجدد',
masterPassword: 'رمز عبور مستر',
confirmPassword: 'تکرار رمز عبور',
passwordStrength: 'قدرت رمز عبور',
weak: 'ضعیف',
medium: 'متوسط',
strong: 'قوی',
veryStrong: 'بسیار قوی',
reqLength: 'حداقل ۸ کاراکتر',
reqUpper: 'حروف بزرگ و کوچک',
reqNumber: 'اعداد (0-9)',
reqSpecial: 'علائم خاص (!@#$%^&*)',
enable2FA: 'فعالسازی تایید دو مرحله‌ای',
scanQR: 'کد QR را با اپلیکیشن Authenticator اسکن کنید',
twoFA_prompt: 'برای امنیت بیشتر و جلوگیری از سؤ استفاده احتمالی از برنامه، لطفاً نسبت به فعال سازی ورود دو مرحله‌ای (2FA)، از بخش تنظیمات، تایید دو مرحله‌ای اقدام نمایید.',
securityQuestions: 'سوالات امنیتی (برای بازیابی)',
securityQuestionsDesc: 'لطفاً ۳ سوال را انتخاب و پاسخ دهید. این تنها راه برای بازیابی رمز عبور در صورت فراموشی خواهد بود.',
changeSecurityQuestions: 'تغییر سوالات امنیتی',
changeSecurityQuestionsDesc: 'برای جایگزینی سوالات بازیابی، رمز فعلی را وارد کنید و سه سوال و پاسخ جدید بسازید.',
saveSecurityQuestions: 'ذخیره سوالات امنیتی',
masterPasswordSetupTitle: 'ستون رمز مستر',
masterPasswordSetupDesc: 'یک رمز عبور مستر قوی بسازید. این رمز کلید اصلی دسترسی به تمام داده‌های محلی شما خواهد بود.',
termsTitle: 'شرایط استفاده',
termsIntro: 'با استفاده از این برنامه تأیید می‌کنید که مسئول حفاظت از رمز مستر، کلیدها، بکاپ‌ها و استفاده‌ی قانونی از ابزار هستید.',
termsBullet1: 'تمام داده‌ها سمت کاربر نگهداری می‌شوند و در صورت از دست رفتن رمز یا کلید، بازیابی ممکن است غیرممکن باشد.',
termsBullet2: 'این برنامه برای حفاظت شخصی و حرفه‌ای طراحی شده و نباید برای استفاده‌ی غیرقانونی یا مخفی‌سازی سوءاستفاده شود.',
termsBullet3: 'پروفایل‌های آیکون و حالت‌های disguise فقط تغییر بصری هستند و به‌تنهایی مرز امنیتی واقعی ایجاد نمی‌کنند.',
viewLicense: 'مشاهده لایسنس AGPL v3.0',
viewDisclaimer: 'مشاهده صلب مسئولیت',
disclaimerTitle: 'صلب مسئولیت',
disclaimerBody1: 'این نرم‌افزار بدون هیچ‌گونه تضمین صریح یا ضمنی ارائه می‌شود. تصمیم‌گیری نهایی برای نگهداری، اشتراک‌گذاری و حذف داده‌های حساس با خود کاربر است.',
disclaimerBody2: 'پیش از استفاده روی داده‌های مهم، از بکاپ سالم، تست بازیابی و تنظیم صحیح روش رمزنگاری مطمئن شوید.',
acceptTermsLabel: 'شرایط استفاده، لایسنس و صلب مسئولیت را خوانده‌ام و می‌پذیرم.',
enter2FACode: 'کد ۶ رقمی را وارد کنید',
verify: 'تایید',
activateLock: 'فعالسازی قفل امنیتی',
enterMasterPassword: 'رمز عبور مستر را وارد کنید',
unlock: 'باز کردن قفل',
wrongPassword: 'رمز عبور اشتباه است!',
appLocked: 'برنامه قفل شده است',
forgotPassword: 'رمز عبور را فراموش کردید؟',
answerSecQuestions: 'پاسخ سوالات امنیتی خود را برای بازیابی رمز عبور وارد کنید',
verifyQuestions: 'بررسی پاسخ‌ها',
saveNewPassword: 'ذخیره رمز جدید',
advancedEncryption: 'سوئیت پیشرفته رمزنگاری',
encrypt: 'رمزنگاری',
decrypt: 'رمزگشایی',
	keyManagement: 'مدیریت کلیدها',
	sshKeyManager: 'کلیدهای SSH',
	sshKeyManagerTitle: 'مدیریت کلیدهای SSH',
	sshKeyManagerSub: 'ساخت، ایمپورت و مدیریت کلیدهای SSH — به‌صورت کامل گرافیکی و رمزنگاری‌شده در خزانه برنامه',
	sshGenerateTitle: 'ساخت کلید جدید',
	sshKeyType: 'نوع کلید',
	sshRsaBits: 'طول RSA',
	sshKeyName: 'نام کلید (اختیاری)',
	sshComment: 'کامنت / شناسه (اختیاری)',
	sshGenerate: 'ساخت کلید',
	sshStoredTitle: 'کلیدهای ذخیره‌شده',
	sshDeviceTitle: 'کلیدهای دستگاه (‎~/.ssh)',
	sshDeviceDesc: 'با اجازه شما، برنامه می‌تواند کلیدهای پوشه پیش‌فرض SSH دستگاه را بخواند، ایمپورت کند و کلیدهای جدید را همان‌جا بنویسد.',
	sshOpenDir: 'باز کردن پوشه SSH دستگاه',
	sshPickFolder: 'انتخاب پوشه SSH (Safari/Firefox)',
	sshDropTitle: 'پوشهٔ ‎.ssh را اینجا بکشید و رها کنید',
	sshDropSub: 'Drag & drop your .ssh folder here',
	mtbFiles: 'فایل‌ها',
	mtbChat: 'چت امن',
	mtbSsh: 'کلید SSH',
	mtbPasswords: 'رمزها',
	mtbSettings: 'تنظیمات',
	sshRescan: 'بازخوانی',
	sshImportFile: 'ایمپورت از فایل',
	sshManualPath: 'مسیر دستی پوشه SSH (اختیاری — برای راهنمایی/مستندسازی):',
	passwords: 'رمزهای عبور',
settings: 'تنظیمات',
help: 'راهنما',
dashboardHub: 'هاب داشبورد',
dashboardHint: 'بین گردش‌کارهای امن، ابزارها و تنظیمات برنامه سریع جابه‌جا شوید.',
appNameDisplay: 'P00RIJÃ Cryptography',
selectFile: 'انتخاب فایل',
dropFile: 'فایل را اینجا رها کنید یا کلیک کنید',
noLimit: 'بدون محدودیت حجم',
createSelfDestruct: 'ایجاد پیام خودتخریب',
createSelfDestructDesc: 'پیغامی ایجاد کنید که پس از گذشت زمان معین یا تعداد دفعات مشاهده مشخص، از بین برود.',
sdTimeLimit: 'محدودیت زمان',
days: 'روز (0-29)',
hours: 'ساعت (0-23)',
minutes: 'دقیقه (0-59)',
seconds: 'ثانیه (0-59)',
encryptionSettings: 'تنظیمات رمزنگاری',
algorithm: 'الگوریتم',
keyMethod: 'روش کلید',
password: 'رمز عبور',
publicKey: 'کلید عمومی',
encryptionPassword: 'رمز عبور رمزنگاری',
operation: 'عملیات',
startEncryption: 'شروع رمزنگاری',
decryptPoorija: 'رمزگشایی فایل P00RIJÃ',
selectPoorija: 'فایل .poorija را انتخاب کنید',
file: 'فایل:',
decryptAndSave: 'رمزگشایی و ذخیره',
keyLibrary: 'کتابخانه کلیدها',
newKey: 'کلید جدید',
noKeys: 'هنوز کلیدی ایجاد نشده',
generatedPasswords: 'رمزهای عبور تولید شده',
passwordsDescription: 'این رمزها با ابزار تولید رمز عبور ساخته شده‌اند',
noPasswords: 'هنوز رمز عبوری تولید نشده',
defaultAlgorithm: 'الگوریتم پیش‌فرض',
defaultKeyMethod: 'روش کلید پیش‌فرض',
defaultKdfIterations: 'تعداد تکرار پیش‌فرض PBKDF2',
defaultKdfHash: 'هش پیش‌فرض PBKDF2',
defaultSaltLength: 'طول پیش‌فرض Salt',
defaultGcmTagLength: 'طول پیش‌فرض GCM Tag',
defaultCtrCounterLength: 'طول پیش‌فرض شمارنده CTR',
defaultAadContext: 'رشته پیش‌فرض AAD / Context',
defaultRsaLabel: 'برچسب پیش‌فرض RSA-OAEP',
chunkSize: 'اندازه چانک',
namingPattern: 'الگوی نامگذاری',
encryptionDefaultsHint: 'این گزینه‌ها به‌عنوان پیش‌فرض برای رمزنگاری فایل، متن، پیام خودتخریب و Secure Share اعمال می‌شوند. برای هر عملیات می‌توانید در همان تب override کنید.',
securitySettings: 'تنظیمات امنیتی',
duressPanicMode: 'وضعیت اضطراری (Panic Mode)',
panicDesc: 'یک رمز عبور اضطراری تعریف کنید. اگر در صفحه ورود این رمز را وارد کنید، تمام داده‌های محلی بلافاصله پاک شده و برنامه قفل می‌شود.',
savePanicPassword: 'ذخیره رمز اضطراری',
autoLock: 'قفل خودکار',
autoLockDesc: 'قفل خودکار پس از دوره عدم فعالیت',
lockAfter: 'قفل پس از',
changeMasterPassword: 'تغییر رمز عبور مستر',
currentPassword: 'رمز فعلی',
newPassword: 'رمز جدید',
confirmNewPassword: 'تکرار رمز جدید',
updatePassword: 'بروزرسانی رمز',
twoFactorAuth: 'تایید دو مرحله‌ای (2FA)',
disabled: 'غیرفعال',
enabled: 'فعال',
enable: 'فعالسازی',
disable: 'غیرفعالسازی',
appearance: 'ظاهر',
theme: 'تم',
light: 'روشن',
dark: 'تاریک',
notifications: 'اعلانات',
keyChangedTitle: 'کلید امنیتی این مخاطب عوض شده است',
keyChangedBody: 'این یا به‌خاطر نصب دوبارهٔ برنامه توسط اوست، یا نشانهٔ آن است که کسی میان شما نشسته. تا وقتی شمارهٔ امنیتی را با خودش رودررو یا با تماس صوتی مقایسه نکرده‌اید، پیام حساس نفرستید.',
compareSafetyNumber: 'مقایسهٔ شمارهٔ امنیتی',
acceptNewKey: 'کلید تازه را می‌پذیرم',
keepOldKey: 'کلید قبلی بماند',
autoDownloadLimit: 'دانلود خودکار تا حجم',
autoDownload1m: '۱ مگابایت',
autoDownload5m: '۵ مگابایت',
autoDownload10m: '۱۰ مگابایت',
autoDownload25m: '۲۵ مگابایت',
autoDownload50m: '۵۰ مگابایت',
autoDownload100m: '۱۰۰ مگابایت',
autoDownloadNever: 'هرگز — همیشه بپرس',
lockThisChatNow: 'قفل فوری این گفتگو',
lockSecureChatNow: 'قفل فوری چت امن',
secureChatLocked: 'چت امن قفل است',
autoDownloadNote: 'فایل و رسانه تا این حجم، وقتی آنلاین هستید، خودکار دانلود و در همین حافظهٔ رمزنگاری‌شده ذخیره می‌شود؛ بزرگ‌تر از آن با یک تأیید دانلود می‌شود و پس از کامل‌شدن، باز هم خودکار همین‌جا ذخیره می‌شود. پس از دانلود کامل، نسخهٔ رله پاک می‌شود — حالت ابری وجود ندارد.',
pushBackground: 'اعلان در پس‌زمینه (برنامهٔ بسته)',
fsTitle: 'محرمانگی پیشرو',
fsBody: 'هر پیامی که به دست گیرنده نرسد، حداکثر ۱۵ روز در صف می‌ماند و پس از آن کلیدش روی دستگاه گیرنده پاک می‌شود؛ از آن لحظه دیگر برای هیچ‌کس — حتی خودِ گیرنده — قابل باز کردن نیست. گفتگوهای زنده کلیدشان را با تبادل موقت می‌سازند و کلید موقت با پایان نشست دور ریخته می‌شود، پس ضبطِ امروز با کلیدِ فردا باز نمی‌شود.',
fsHistoryNote: 'این از نسخه‌های ضبط‌شده در مسیر محافظت می‌کند، نه از تاریخچه‌ای که روی همین دستگاه ذخیره شده — آن را رمز مستر، قفل چت و پیام‌های خودتخریب نگه می‌دارند.',
offByDefault: 'پیش‌فرض خاموش',
pushBackgroundDesc: 'برای رسیدن اعلان وقتی برنامه بسته است، سرویس پوشِ مرورگر شما وارد مسیر می‌شود و رله یک نشانی برای دستگاهتان نگه می‌دارد. متن پیام، نام فرستنده و هیچ محتوایی فرستاده نمی‌شود و رمزنگاری سرتاسری دست‌نخورده می‌ماند.',
pushTtl: 'پاک‌سازی خودکار اشتراک پس از',
pushDays: 'روز',
pushHintOff: 'خاموش است. هیچ نشانی‌ای از این دستگاه روی رله نگه داشته نمی‌شود.',
pushHintLost: 'اشتراک این دستگاه دیگر معتبر نیست، پس پیامی اعلان نمی‌شود. یک بار کلید را روشن کنید تا دوباره ثبت شود — این کار به لمس خودتان نیاز دارد.',
pushHintOn: 'روشن است. اشتراک این دستگاه پس از {days} روز بی‌استفاده خودبه‌خود پاک می‌شود.',
pushUnsupported: 'این مرورگر اعلان پس‌زمینه را پشتیبانی نمی‌کند. روی آیفون، برنامه باید از صفحهٔ اصلی نصب شده باشد.',
pushNativeNote: 'در نسخهٔ نیتیو، اعلان‌ها از خود سیستم‌عامل می‌آیند و تا وقتی برنامه در حال اجراست (حتی در نوار وظیفه) کار می‌کنند. اعلان پس‌زمینه با برنامهٔ کاملاً بسته، فقط در نسخهٔ وب/PWA در دسترس است.',
pushPermissionDenied: 'اجازهٔ اعلان داده نشد، پس خاموش ماند.',
pushPermissionRetry: 'پنجرهٔ اجازه باز نشد. یک‌بار دیگر روی کلید بزنید.',
pushFailed: 'ثبت اشتراک اعلان ناموفق بود.',
pushOn: 'اعلان پس‌زمینه روشن شد.',
pushOff: 'اعلان پس‌زمینه خاموش شد و اشتراک از رله حذف شد.',
showNotifications: 'نمایش اعلانات',
desktopNotificationsUnsupported: 'اعلانات سیستمی در این نسخه دسکتاپ در دسترس نیست.',
desktopNotificationsPrompt: 'برای دریافت اعلان‌های سیستمی، این گزینه را روشن کنید تا برنامه از سیستم اجازه بگیرد.',
desktopNotificationsGranted: 'اعلان‌های سیستمی مجاز هستند و در صورت روشن بودن این گزینه نمایش داده می‌شوند.',
desktopNotificationsDenied: 'دسترسی اعلان‌های سیستمی رد شده است. برای فعال‌سازی دوباره باید از تنظیمات سیستم اجازه بدهید.',
publicStun: 'STUN عمومی (گوگل/توییلیو)',
desktopShell: 'رفتار برنامهٔ دسکتاپ',
desktopShellDesc: 'این بخش فقط در نسخهٔ نیتیو مک و لینوکس دیده می‌شود و رفتار برنامه را هنگام بستن پنجره و ورود به سیستم تعیین می‌کند.',
desktopKeepRunning: 'ادامهٔ اجرا در پس‌زمینه پس از بستن پنجره',
mobileKeepRunningHint: 'برنامه را در حافظه نگه می‌دارد تا اندروید آن را نبندد: با بازگشت، فوراً و با همان وضعیت باز می‌شود و پیام‌های صف‌شدهٔ رله را می‌گیرد. اندروید برای این کار یک اعلان دائمی می‌خواهد. توجه: تا وقتی برنامه در پس‌زمینه است پیام تازه نمی‌رسد — اندروید موتور وب را منجمد می‌کند و هیچ برنامه‌ای نمی‌تواند جلویش را بگیرد.',
desktopNoTray: 'این محیط دسکتاپ آیکون tray ندارد، پس بستن پنجره برنامه را کاملاً می‌بندد. روی گنوم معمولاً نصب افزونهٔ «AppIndicator and KStatusNotifierItem Support» این را حل می‌کند.',
desktopKeepRunningHint: 'با روشن بودن این گزینه، بستن پنجره فقط آن را پنهان می‌کند و برنامه در نوار وظیفه (tray) زنده می‌ماند تا پیام و تماس را از دست ندهید. با خاموش کردن آن، بستن پنجره برنامه را کاملاً می‌بندد.',
desktopStartMinimized: 'اجرای پنهان هنگام ورود خودکار',
desktopStartMinimizedHint: 'فقط وقتی برنامه با ورود به سیستم اجرا می‌شود اعمال می‌گردد؛ اجرای دستی همیشه پنجره را نشان می‌دهد.',
desktopAutostart: 'اجرای خودکار هنگام ورود به سیستم',
desktopAutostartHint: 'برنامه را به فهرست ورود سیستم‌عامل اضافه می‌کند (LaunchAgent در مک، autostart در لینوکس).',
desktopVaultSyncTitle: 'نسخهٔ خزانه روی سیستم',
desktopVaultSync: 'نگهداری یک نسخهٔ رمزشده از خزانه روی این سیستم',
desktopVaultSyncHint: 'کل خزانه (کلیدها، یادداشت‌ها، تاریخچهٔ چت، پیوست‌ها) با رمز اصلی شما و Argon2id رمز می‌شود و بعد روی دیسک نوشته می‌شود. رمزگشایی هرگز خارج از همین دستگاه انجام نمی‌شود و هیچ چیزی به سرور نمی‌رود.',
desktopVaultPathLabel: 'مسیر روی دیسک',
desktopVaultSyncNow: 'ذخیرهٔ همین حالا',
desktopVaultNever: 'هنوز ذخیره نشده است.',
desktopVaultLocked: 'برای ذخیره‌سازی باید ابتدا برنامه را باز کنید.',
desktopVaultSaving: 'در حال رمزنگاری و ذخیره…',
desktopVaultFailed: 'ذخیرهٔ نسخهٔ خزانه ناموفق بود.',
desktopVaultDelete: 'حذف امن نسخهٔ روی دیسک',
desktopVaultDeleted: 'نسخهٔ روی دیسک با بازنویسی امن حذف شد.',
webPushNotificationsUnsupported: 'اعلان‌های Push در این مرورگر یا این اتصال امن در دسترس نیست.',
webPushNotificationsPrompt: 'برای دریافت پیام و تماس آفلاین، اعلان‌های سیستم‌عامل را فعال کنید.',
webPushNotificationsGranted: 'اعلان‌های Push فعال است و پیام/تماس آفلاین را از رله رمزنگاری‌شده دریافت می‌کنید.',
webPushNotificationsDenied: 'دسترسی اعلان رد شده است. برای فعال‌سازی دوباره باید از تنظیمات مرورگر اجازه بدهید.',
dangerZone: 'منطقه خطر',
resetToDefault: 'بازگشت به حالت پیش‌فرض',
helpIntro: 'راهنمای کامل استفاده از داشبورد رمزنگاری نسخه 2.99',
howToEncrypt: 'نحوه رمزنگاری فایل',
encStep1: 'به تب "رمزنگاری" بروید',
encStep2: 'فایل مورد نظر را انتخاب کنید (بدون محدودیت حجم)',
encStep3: 'الگوریتم رمزنگاری را انتخاب کنید (AES-256-GCM توصیه می‌شود)',
encStep4: 'روش کلید را مشخص کنید (رمز عبور یا کلید عمومی)',
encStep5: 'دکمه شروع را بزنید و منتظر تکمیل عملیات بمانید',
encStep6: 'فایل .poorija را دانلود کنید',
howToDecrypt: 'نحوه رمزگشایی',
decStep1: 'به تب "رمزگشایی" بروید',
decStep2: 'فایل .poorija را انتخاب کنید',
decStep3: 'رمز عبور یا کلید خصوصی مربوطه را وارد کنید',
decStep4: 'فایل اصلی بازیابی می‌شود',
algorithmsTitle: 'الگوریتم‌های رمزنگاری',
aesDesc: 'انتخاب اصلی برای رمزنگاری authenticated در وب کلاینت‌ساید.',
chachaDesc: 'حالت استریم استاندارد Web Crypto برای سناریوهای خاص و داده‌های پیوسته.',
rsaDesc: 'رمزنگاری هیبریدی سازگار: RSA برای wrap کردن کلید نشست AES.',
eccDesc: 'نسخه ۴۰۹۶ بیتی برای زمانی که امنیت بالاتر از هزینه‌ی پردازش مهم‌تر است.',
securityTips: 'نکات امنیتی',
tip1: 'پروتکل امنیتی: در صورت 3 بار وارد کردن اشتباه پاسخ سوالات امنیتی، تمامی داده‌های شما پاک خواهد شد.',
tip2: 'از رمز عبور قوی با حداقل ۱۲ کاراکتر استفاده کنید',
tip3: 'کلیدهای خصوصی را در جای امن نگهداری کنید',
tip4: 'تایید دو مرحله‌ای را برای امنیت بیشتر فعال کنید',
success: 'موفق',
fileReady: 'فایل آماده دانلود:',
download: 'دانلود',
close: 'بستن',
madeWith: 'ساخته شده با',
in: 'در',
allRightsReserved: 'تمامی حقوق محفوظ است',
back: 'بازگشت',
advancedSettings: 'تنظیمات پیشرفته',
iterations: 'تعداد تکرار (Iterations)',
kdfHash: 'هش KDF',
saltLength: 'طول Salt',
gcmTagLength: 'طول GCM Tag',
ctrCounterLength: 'طول شمارنده CTR',
aadContext: 'رشته AAD / Context',
aadContextPlaceholder: 'metadata / tenant / purpose',
rsaOaepLabel: 'برچسب RSA-OAEP',
rsaOaepLabelPlaceholder: 'recipient-context',
advancedSettingsHint: 'در حالت رمز عبور می‌توانید KDF را دقیق‌تر تنظیم کنید، در AES-GCM مقدار AAD/Tag را کنترل کنید، در AES-CTR طول شمارنده را تعیین کنید، و در RSA-OAEP برچسب context را برای گیرنده بفرستید.',
selectKey: 'انتخاب کلید',
hashChecker: 'بررسی هش',
qrBridge: 'پل QR',
authenticator: 'کدساز دومرحله‌ای',
inspector: 'بازرس نویسه',
converter: 'میز تبدیل',
qrBridgeTitle: 'پل QR — انتقال بدون شبکه',
qrBridgeIntro: 'متن یا داده را به دنبالهٔ کدهای QR تبدیل می‌کند تا با دوربین دستگاه دیگر خوانده شود. بدون اینترنت، بدون بلوتوث، بدون هیچ سروری.',
qrBridgeInputLabel: 'آنچه می‌خواهید بفرستید',
qrBridgeInputPlaceholder: 'متن رمزشده را اینجا بگذارید…',
qrBridgeBuildBtn: 'ساخت کدها',
qrBridgePlayBtn: 'پخش خودکار',
qrBridgeReceive: 'دریافت با دوربین',
qrBridgeReceiveHint: 'دوربین را روبه‌روی صفحهٔ دستگاه فرستنده بگیرید. قاب‌ها به هر ترتیبی خوانده می‌شوند و برنامه می‌گوید کدام‌ها مانده.',
qrBridgeScanBtn: 'شروع دوربین',
qrBridgeScanStopBtn: 'توقف',
qrBridgeResetBtn: 'شروع دوباره',
qrBridgeOutputLabel: 'آنچه بازسازی شد',
localLink: 'پیوند محلی',
localLinkTab: 'پیوند محلی',
callQualityTitle: 'کیفیت اتصال — برای جزئیات بزنید',
qrBoost: 'بزرگ و پرنور',
linkNoCamera: 'بدون دوربین: با متن یا فایل',
linkRoomTitle: 'اتاق محلی',
cancel: 'انصراف',
linkInvite: 'دعوت نفر تازه',
linkVoiceCall: 'تماس صوتی',
linkVideoCall: 'تماس تصویری',
linkLeave: 'خروج از اتاق',
linkSendFile: 'ارسال فایل',
linkSticker: 'استیکر',
linkPoll: 'نظرسنجی',
linkPollQuestion: 'سؤال نظرسنجی',
linkPollOptions: 'هر گزینه در یک خط',
linkPollSend: 'ارسال نظرسنجی',
linkNoCameraHint: 'همان چیزی که در کد QR است، به‌شکل متن. آن را کپی کنید و از هر راهی که دارید به دستگاه دیگر برسانید — ایمیل، حافظهٔ USB، پوشهٔ مشترک، یا هر پیام‌رسانی. محتوایش رمزنگاری را ضعیف نمی‌کند: کلید عمومی است، نه خصوصی.',
linkMineLabel: 'کد این دستگاه',
linkTheirLabel: 'کد دستگاه دیگر',
linkTheirPlaceholder: 'کد دستگاه دیگر را اینجا بچسبانید…',
linkCopy: 'کپی',
linkSaveFile: 'ذخیره به فایل',
linkPaste: 'چسباندن از کلیپ‌بورد',
linkOpenFile: 'باز کردن فایل',
linkUseText: 'استفاده از این کد',
qrSwitchCamera: 'دوربین بعدی',
qrTorch: 'چراغ',
/* Added after an audit found these forty keys carried by data-i18n
   attributes with no entry in either table. applyTranslations skips a key it
   cannot find, so the hard-coded Persian in the markup stayed on screen in
   English too — forty labels that never translated. */
save: 'ذخیره',
setStatus: 'وضعیت',
setYourStatus: 'وضعیت شما',
changeCompanion: 'همدم بعدی',
worldClocks: 'ساعت‌های جهانی',
profileSettings: 'تنظیمات پروفایل چت',
exportChats: 'برون‌ریزی گفتگوها',
importChats: 'درون‌ریزی گفتگوها',
clearAllHistory: 'پاک‌سازی کل تاریخچه',
chatRailResize: 'تغییر عرض ستون گفتگوها',
conversationActions: 'گزینه‌های گفتگو',
deleteMessage: 'حذف',
stripMetadataOnSend: 'حذف متادیتا هنگام ارسال فایل',
stripMetadataHint: 'روشن: هر فایلی پیش از رمزنگاری از مکان، مدل دوربین، تاریخ و نام نرم‌افزار پاک می‌شود. خاموش: فایل همان‌طور که هست می‌رود و اگر مکان یا نامی داشته باشد یک بار به شما هشدار داده می‌شود.',
convertHeicHint: 'متادیتای HEIC قابل حذف نیست، چون تصویر با آدرس‌های بایتی پیدا می‌شود و جابه‌جا کردن هر چیزی فایل را خراب می‌کند. تبدیل به JPEG تصویر را دوباره کدگذاری می‌کند و هیچ متادیتایی همراهش نمی‌آید. خاموش: فایل بدون سؤال همان‌طور که هست فرستاده می‌شود.',
newGroupTitle: 'گروه جدید',
groupMembers: 'اعضای گروه',
groupAboutPlaceholder: 'توضیح کوتاه دربارهٔ گروه (اختیاری)',
memberPermissions: 'اعضا چه کاری می‌توانند بکنند',
perMemberLater: 'پس از ساخت گروه می‌توانید همین‌ها را برای یک عضو خاص هم محدود کنید.',
createGroup: 'ساخت گروه',
screenshot: 'عکس',
mirror: 'آینه',
swap: 'سوئیچ',
pip: 'PiP',
fullscreen: 'تمام‌صفحه',
devices: 'دستگاه‌ها',
stegoModeRobust: 'مقاوم — از فشرده‌سازی پیام‌رسان جان سالم به در می‌برد',
stegoModeRobustHint: 'می‌توانید تصویر را به‌صورت «عکس» بفرستید. ظرفیت کمتر (چند کیلوبایت).',
stegoModeCapacity: 'ظرفیت بالا — فقط اگر به‌صورت «فایل» بفرستید',
stegoModeCapacityHint: 'صدها کیلوبایت جا دارد، ولی اگر به‌صورت «عکس» ارسال شود پیام کاملاً از بین می‌رود.',
vaultIntro: 'هرچه برنامه نگه می‌دارد، یک‌جا: پیوست پیام‌ها، پیام‌های صوتی، استیکرها و فایل‌های رمزگذاری‌شده.',
vaultLockNote: 'فایل‌ها با رمز اصلی برنامه رمزنگاری شده‌اند. قفل مشترک، دسترسی به مدیریت فایل‌ها، چت امن و تنظیمات را روی همین دستگاه محدود می‌کند.',
voicePickFile: 'انتخاب فایل صوتی',
voiceStop: 'پایان',
mtabSettingsTitle: 'شخصی‌سازی نوار دسترسی سریع (موبایل)',
mtabSettingsDesc: 'تب‌هایی را که در نوار پایین گوشی می‌خواهید انتخاب کنید (حداکثر ۵ مورد) و ترتیب‌شان را تغییر دهید.',
mtabDiagTitle: 'اطلاعات نمایش صفحه',
helpOlderNotes: 'یادداشت‌های قدیمی‌تر و جزئیات نسخه',
helpSearchPlaceholder: 'در راهنما بگردید…',
callQualityHeading: 'کیفیت اتصال',
localLinkTitle: 'پیوند محلی — بدون هیچ سروری',
localLinkIntro: 'دو دستگاه روی یک وای‌فای، از راه دوربین به هم معرفی می‌شوند و بعد مستقیم و رمزشده با هم حرف می‌زنند. نه رله‌ای در کار است، نه اینترنتی، نه هیچ سروری.',
localLinkCaveat: 'اگر اتصال برقرار نشد: بیشتر وای‌فای‌های مهمان و عمومی اجازه نمی‌دهند دستگاه‌ها یکدیگر را ببینند. یک نقطهٔ اتصال شخصی (هات‌اسپات گوشی) این محدودیت را ندارد. عبارت امنیتی باید روی هر دو دستگاه یکسان باشد؛ اگر نبود، اتصال را قطع کنید.',
linkHostBtn: 'شروع پیوند تازه',
linkScanBtn: 'اسکن کد طرف مقابل',
linkScanStopBtn: 'توقف دوربین',
linkResetBtn: 'قطع و شروع دوباره',
linkComposerPlaceholder: 'پیام…',
linkRoomBack: 'بازگشت',
linkRoomPeople: 'افراد اتاق',
linkRoomIdentity: 'نام و تصویر',
linkYourName: 'نام شما در اتاق',
linkRoomNameLabel: 'نام اتاق',
linkDissolveRoom: 'انحلال کامل اتاق',
linkBackToRoom: 'بازگشت به اتاق',
linkBackToCall: 'بازگشت به تماس',
linkCallToChat: 'بازگشت به چت',
linkCallVoice: 'تماس صوتی',
linkMoreActions: 'گزینه‌های بیشتر',
linkCallJoin: 'پیوستن',
linkCallDecline: 'رد',
linkCallEnd: 'پایان تماس',
linkCallMute: 'بی‌صدا',
linkCallCamera: 'دوربین',
linkVoiceSend: 'ارسال',
lanPairShow: 'نمایش نشانی به‌صورت QR',
lanPairScan: 'خواندن نشانی از QR',
lanPairScanStop: 'توقف دوربین',
lanPairHide: 'بستن',
lanPairHint: 'دستگاه دیگر این کد را با دکمهٔ «خواندن نشانی از QR» بخواند. برای شبکهٔ محلی کافی است؛ اینترنت لازم نیست.',
authTitle: 'کدساز دومرحله‌ای',
authIntro: 'کدهای TOTP روی همین دستگاه ساخته می‌شوند و کلیدها در انبار رمزشدهٔ برنامه می‌مانند. هیچ چیزی به بیرون فرستاده نمی‌شود.',
authIssuerPlaceholder: 'سرویس (مثلاً GitHub)',
authLabelPlaceholder: 'حساب (مثلاً ایمیل شما)',
authSecretPlaceholder: 'کلید مشترک base32',
authAddBtn: 'افزودن حساب',
authUriLabel: 'یا لینک otpauth:// را بگذارید',
authImportBtn: 'وارد کردن',
inspectorTitle: 'بازرس نویسه‌های پنهان',
inspectorIntro: 'نویسه‌های نامرئی می‌توانند هر نسخه از یک متن را یکتا کنند تا نشت آن قابل ردیابی شود. حروف گمراه‌کننده هم باعث می‌شوند یک نشانی چیز دیگری به‌نظر برسد. این ابزار هر دو را پیدا و پاک می‌کند.',
inspectorInputLabel: 'متنی که می‌خواهید بررسی شود',
inspectorAuto: 'بررسی هنگام تایپ',
inspectorRunBtn: 'بررسی',
inspectorCleanBtn: 'پاک‌سازی متن',
convertTitle: 'میز تبدیل',
convertIntro: 'Base64، هگز، URL، دودویی — در هر دو جهت، با شمارش بایت. برای وقتی که با متن رمزشده دستی کار می‌کنید.',
convertInputPlaceholder: 'ورودی…',
convertRunBtn: 'تبدیل',
convertSwap: 'جابه‌جایی',
/* The arrow points the way the language reads: in Persian the source is on
   the right, so "متن ← Base64" means text becomes Base64. Writing the same
   glyph into the English list would say the opposite, which is why these are
   two lists rather than one list with a shared separator. */
convertTextBase64: 'متن ← Base64',
convertBase64Text: 'Base64 ← متن',
convertTextHex: 'متن ← هگز',
convertHexText: 'هگز ← متن',
convertTextUrl: 'متن ← URL',
convertUrlText: 'URL ← متن',
convertTextBinary: 'متن ← دودویی',
convertBinaryText: 'دودویی ← متن',
convertBase64Hex: 'Base64 ← هگز',
convertHexBase64: 'هگز ← Base64',
sshKeyEd25519: 'Ed25519 (پیشنهادی — سریع و امن)',
sshKeyRsa: 'RSA (برای سرورهای قدیمی)',
sshRsa2048: '۲۰۴۸ بیت',
sshRsa3072: '۳۰۷۲ بیت',
sshRsa4096: '۴۰۹۶ بیت',
chatLockMin1: '۱ دقیقه',
chatLockMin5: '۵ دقیقه',
chatLockMin15: '۱۵ دقیقه',
chatLockMin60: '۶۰ دقیقه',
hashCheckerTitle: 'بررسی و مقایسه هش فایل',
selectFileHash: 'فایل را برای بررسی هش انتخاب کنید',
calculatedHash: 'هش محاسبه شده (SHA-256)',
expectedHash: 'هش مورد انتظار (برای مقایسه)',
deleteOriginal: 'حذف فایل اصلی',
deleteOriginalDesc: 'پاک کردن خودکار فایل از برنامه پس از پردازش موفق',
encryptHistory: 'تاریخچه رمزنگاری',
decryptHistory: 'تاریخچه رمزگشایی',
historySearchPlaceholder: 'جستجو بر اساس نام یا الگوریتم...',
allAlgorithms: 'همه الگوریتم‌ها',
sortDateDesc: 'جدیدترین اول',
sortDateAsc: 'قدیمی‌ترین اول',
sortSizeDesc: 'بزرگ‌ترین اول',
sortSizeAsc: 'کوچک‌ترین اول',
sortNameAsc: 'نام: الف تا ی',
sortNameDesc: 'نام: ی تا الف',
date: 'تاریخ',
size: 'حجم',
name: 'نام',
noItemsFound: 'موردی یافت نشد',
tagLabel: 'تگ / نام',
tagPersonal: 'شخصی',
tagWork: 'کاری',
tagSecret: 'محرمانه',
tagFinancial: 'مالی',
descriptionOptional: 'توضیحات (اختیاری)',
keyDetails: 'جزئیات کلید',
privateKeyHashed: 'کلید خصوصی (هش شده / ذخیره شده)',
downloadFormat: 'دانلود کلید خصوصی / عمومی',
bothFormats: 'دانلود همه کلیدها (ZIP)',
downloadKey: 'دانلود کلید',
importPublicKey: 'وارد کردن کلید عمومی',
tagLabelCustom: 'تگ (نام دلخواه)',
publicKeyString: 'رشته کلید عمومی (Base64 / PEM)',
saveKey: 'ذخیره کلید',
algGCMOption: 'AES-256-GCM (پیشنهادی)',
algChaChaOption: 'AES-192-GCM',
algCBCOption: 'AES-256-CBC (سازگاری قدیمی)',
algCTROption: 'AES-256-CTR (استریم)',
algWarningStars: 'الگوریتم‌های legacy فقط برای باز کردن داده‌های قدیمی نگه داشته شده‌اند.',
importKeyButton: 'وارد کردن کلید',
algGCM: 'AES-256-GCM (پیشنهادی)',
algCBC: 'AES-256-CBC (سازگاری قدیمی)',
algDesc1: 'AES-256-GCM امن‌ترین و مناسب‌ترین گزینه‌ی پیش‌فرض برای اکثر کاربردهای برنامه است',
algWarningStarsHeavy: 'الگوریتم‌های legacy از مسیرهای جدید حذف شده‌اند و فقط برای سازگاری با داده‌های قدیمی باقی مانده‌اند.',
chunk1mb: '1 MB (پیش‌فرض - تعادل سرعت و حافظه)',
chunk512kb: '512 KB (حافظه کم)',
chunk5mb: '5 MB (فایل‌های بزرگ)',
chunk10mb: '10 MB (حداکثر سرعت)',
chunkDesc: 'چانک‌های بزرگ‌تر سرعت بیشتر اما مصرف حافظه بالاتر',
nameOriginal: 'نام اصلی + .poorija',
nameTimestamp: 'تاریخ و زمان',
nameRandom: 'شناسه تصادفی',
nameCustom: 'سفارشی (پیشوند دلخواه)',
customPrefixPlaceholder: 'پیشوند سفارشی...',
customMinute: 'دلخواه...',
customTheme: 'کاستوم تم',
installApp: 'نصب برنامه',
installReady: 'تجربه قابل نصب',
installHint: 'برنامه را نصب کنید تا پنجره خلوت‌تر، میانبرهای سریع و دسترسی آفلاین پایه داشته باشید.',
launchWebApp: 'اپ وب',
installUnavailable: 'نصب برنامه در این مرورگر یا این حالت در دسترس نیست.',
appInstalled: 'برنامه با موفقیت نصب شد.',
openMenu: 'باز کردن منو',
closeMenu: 'بستن منو',
customThemeSettings: 'تنظیمات تم کاستوم',
bgColor: 'رنگ پس‌زمینه (Background)',
cardColor: 'رنگ کارت‌ها (Cards)',
textColor: 'رنگ متن (Text)',
primaryColor: 'رنگ اصلی (Primary/Brand)',
iconColor: 'رنگ آیکون‌ها',
desktopIconProfile: 'پروفایل آیکون دسکتاپ',
desktopIconProfileDesc: 'برای نسخه دسکتاپ می‌توانید بین آیکون اصلی، تم‌های جایگزین و چند پروفایل بصری کم‌جلب‌توجه جابه‌جا شوید.',
iconProfileDefault: 'سپر اصلی P00RIJA',
iconProfileMidnight: 'سپر Midnight',
iconProfileLinen: 'سپر Linen',
iconProfileFolder: 'پوشه سیستم',
iconProfileNotes: 'یادداشت سیستم',
iconProfileTerminal: 'ترمینال سیستم',
iconProfileSettings: 'تنظیمات سیستم',
desktopIconProfileHint: 'روی ویندوز و لینوکس، آیکون پنجره و نوار وظیفه بلافاصله عوض می‌شود. روی مک پنجره آیکون جدا ندارد و Dock آیکون بسته را نشان می‌دهد، پس آنجا فقط آیکون tray عوض می‌شود. آیکون فایل نصب در هر صورت مربوط به بستهٔ build‌شده است.',
tabOrder: 'ترتیب تب‌ها',
tabOrderDesc: 'ترتیب آیتم‌های منوی کناری را نسبت به نیاز خودتان جابه‌جا کنید.',
tabOrderDragHint: 'برای تغییر سریع‌تر، هر ردیف را بگیرید و بکشید. دکمه‌های بالا/پایین همچنان در دسترس هستند.',
resetTabOrder: 'بازنشانی ترتیب پیش‌فرض',
moveUp: 'انتقال به بالا',
moveDown: 'انتقال به پایین',
typographySettings: 'تنظیمات تایپوگرافی (فونت و اندازه)',
fontFamilyFa: 'فونت فارسی',
fontFamilyEn: 'فونت انگلیسی',
textSize: 'اندازه نوشتار',
sizeSmall: 'کوچک',
sizeNormal: 'متوسط (پیش‌فرض)',
sizeLarge: 'بزرگ',
adhocVoiceCall: 'تماس گروهی صوتی',
adhocVideoCall: 'تماس گروهی تصویری',
addToCall: 'افزودن نفر به تماس',
pickCallPeople: 'چه کسانی به تماس اضافه شوند؟',
startTheCall: 'شروع تماس',
convertHeicOnSend: 'پیشنهاد تبدیل عکس‌های HEIC به JPEG',
vaultTab: 'مدیریت فایل‌ها',
vaultOpenTab: 'مدیریت فایل‌ها',
vaultTitle: 'مدیریت فایل‌ها',
vaultSetLock: 'گذاشتن قفل',
vaultOpen: 'باز کردن',
vaultRemoveLock: 'برداشتن قفل',
vaultPassphrase: 'عبارت عبور (حداقل ۸ نویسه)',
voiceTab: 'تغییر صدا',
voiceTitle: 'تغییر صدا',
voiceIntro: 'یک فایل صوتی بدهید یا همین‌جا ضبط کنید، حالت را انتخاب کنید و نتیجه را بشنوید و ذخیره کنید. همه‌چیز روی همین دستگاه انجام می‌شود.',
voiceRecord: 'ضبط',
voiceSave: 'ذخیرهٔ فایل',
sendDisguised: 'ارسال با صدای تغییریافته',
metadataTab: 'متادیتا',
metadataTitle: 'متادیتای فایل',
metadataIntro: 'ببینید فایل چه چیزی دربارهٔ شما می‌گوید، تغییرش دهید یا کاملاً پاکش کنید. فایل اصلی دست نمی‌خورد؛ خروجی یک کپی است.',
metadataStripAll: 'پاک‌کردن همه',
metadataSave: 'ذخیرهٔ کپی',
metadataLimits: 'حذف متادیتا الگوی نویز حسگر دوربین، اثرانگشت انکودر و نشانه‌های مشابه را برنمی‌دارد.',
about: 'درباره من',
githubProfile: 'پروفایل گیت‌هاب',
donateTitle: 'حمایت از پروژه',
donateHint: 'اگر این ابزار برایتان مفید بود، می‌توانید با TON از طریق کیف پول تلگرام حمایت کنید.',
copyAddress: 'کپی آدرس',
addressCopied: 'آدرس کیف پول کپی شد.',
openInWallet: 'باز کردن در کیف پول',
showQr: 'نمایش QR',
hideQr: 'بستن QR',
emailAddress: 'آدرس ایمیل',
aboutProject: 'درباره پروژه',
aboutProjectDesc: 'این سوئیت رمزنگاری با هدف ارائه یک محیط کاملا امن، مبتنی بر مرورگر و سمت کلاینت (Client-Side) برای محافظت از داده‌های شخصی توسعه یافته است. هیچ یک از کلیدها یا داده‌های شما به هیچ سروری ارسال نمی‌شوند.',
textEncryption: 'رمزنگاری نوشتاری',
migration: 'مهاجرت',
steganography: 'پنهان‌نگاری',
fileShredder: 'امحای فایل',
selfDestruct: 'پیام‌های خودتخریب',
textEncryptionTitle: 'رمزنگاری زنده متن',
textDecryptionTitle: 'رمزگشایی زنده متن',
passwordOrKey: 'کلید رمزنگاری',
enterTextKey: 'کلید را وارد کنید...',
selectFromKeys: '-- انتخاب از کلیدهای موجود --',
plainText: 'متن اصلی',
plainTextPlaceholder: 'متن خود را اینجا بنویسید...',
encryptedText: 'متن رمزنگاری شده',
textEncHelp: 'این بخش متن را به‌صورت زنده رمزنگاری می‌کند. هر الگوریتم موجود اصالت‌سنجی دارد: AES-GCM از Web Crypto و XChaCha20-Poly1305 از هستهٔ نرم‌افزاری. الگوریتم شکسته‌ای در فهرست نیست.',
exportData: 'خروجی گرفتن از اطلاعات',
exportDesc: 'از این بخش میتوانید برای زمانی که قصد تغییر سیستم خود را دارید استفاده کنید. تمامی کلیدهای خصوصی و عمومی، رمزهای عبور تولید شده و تنظیمات برنامه به همراه کلید مستر خروجی گرفته میشود.',
migrationPassword: 'رمز عبور فایل خروجی',
exportBtn: 'خروجی گرفتن (.poorija-backup)',
importData: 'وارد کردن اطلاعات',
importDesc: 'فایل پشتیبان (.poorija-backup) را وارد کنید. توجه داشته باشید که این کار اطلاعات فعلی برنامه را بازنویسی میکند و به رمز عبوری که در هنگام خروجی گرفتن ثبت کردید نیاز دارد.',
migrationPasswordInput: 'رمز عبور فایل بکاپ',
importBtn: 'وارد کردن و جایگزینی',
stegoHideTitle: 'پنهان کردن متن در تصویر',
stegoHideDesc: 'متن دلخواه (یا متن رمزنگاری شده) خود را درون یک تصویر پنهان کنید. تصویر خروجی بدون تغییر ظاهری خواهد بود.',
stegoExtractTitle: 'استخراج متن از تصویر',
fileShredderTitle: 'امحای امن فایل (File Shredder)',
fileShredderDesc: 'این ابزار با استفاده از File System Access API محتوای فایل اصلی را با صفر بازنویسی می‌کند تا امحای فایل امن‌تر و قابل‌اعتمادتر باشد.',
fileShredderDescDesktop: 'در نسخه دسکتاپ، این ابزار با دیالوگ فایل بومی سیستم کار می‌کند، فایل انتخاب‌شده را بازنویسی می‌کند و سپس آن را حذف می‌کند.',
readSelfDestruct: 'بازکردن پیام خودتخریب',
sdViewLimit: 'محدودیت دفعات مشاهده',
sdOutput: 'خروجی پیغام (ارسال برای دیگران)',
shredBtn: 'شروع امحای فایل',
advGeneratorBtn: 'تولید رمز عبور پیشرفته',
gplLicense: 'تحت لایسنس AGPL v3.0',
gplLicenseNote: 'برنامه تحت لایسنس AGPL v3.0 است. اگر آن را به‌عنوان سرویس روی شبکه اجرا کنید — از جمله رلهٔ آن — باید سورس کد همان نسخه را در اختیار کاربران آن سرویس بگذارید (بند ۱۳).',
copyText: 'کپی',
encryptedTextPlaceholder: 'نتیجه در اینجا نمایش داده میشود...',
shredderSelectFile: 'برای انتخاب فایلی که می‌خواهید برای همیشه از روی هارد پاک شود کلیک کنید...',
shredderSelectFileDesktop: 'برای انتخاب فایلی که می‌خواهید به‌صورت بومی و دائمی امحا شود کلیک کنید...',
stegoHideBtn: 'پنهان‌سازی و دانلود تصویر',
stegoExtractSelect: 'تصویر حاوی متن پنهان (PNG) را انتخاب کنید...',
stegoExtractedText: 'متن استخراج شده',
stegoTextToHide: 'متن برای پنهان شدن',
stegoImageSelect: 'یک تصویر (PNG/JPG) انتخاب کنید...',
advGeneratorTitle: 'تولید رمز عبور پیشرفته',
advPassLength: 'طول رمز عبور',
advUpperChars: 'حروف بزرگ (A-Z)',
advLowerChars: 'حروف کوچک (a-z)',
advNumbersChars: 'اعداد (0-9)',
advSymbolsChars: 'نمادها (!@#$)',
advPlacementRules: 'قوانین جایگذاری کاراکتر (اختیاری)',
advStartWith: 'شروع با:',
advMiddleWith: 'میانه (حدود وسط):',
advEndWith: 'پایان با:',
advAnyChar: 'هر کاراکتری',
advOnlyLetters: 'فقط حروف',
advOnlyNumbers: 'فقط اعداد',
advOnlySymbols: 'فقط نمادها',
advSaveToList: 'ذخیره در لیست',
fontFamilyFa: 'فونت فارسی',
fontFamilyEn: 'فونت انگلیسی',
textSize: 'اندازه نوشتار',
sizeSmall: 'کوچک',
sizeNormal: 'متوسط (پیش‌فرض)',
sizeLarge: 'بزرگ',
typographySettings: 'تنظیمات تایپوگرافی (فونت و اندازه)',
decryptionKey: 'کلید رمزگشایی',
answerPlaceholder: 'پاسخ...',
strongPasswordPlaceholder: 'یک رمز عبور قوی وارد کنید...',
backupSelectFile: 'فایل بکاپ را انتخاب کنید...',
enterBackupPassword: 'رمز عبور را وارد کنید...',
dayShort: 'روز',
hourShort: 'ساعت',
minuteShort: 'دقیقه',
secondShort: 'ثانیه',
zeroForUnlimited: '0 برای نامحدود',
sdNoTimeLimitHint: 'مقدار 0 برای همه یعنی بدون محدودیت زمانی.',
sdViewHint: 'هر بار بازگشایی پیغام، یک بار محاسبه می‌شود. عدد 0 یعنی بدون محدودیت دفعات.',
sdBindToDevice: 'فقط روی همین نصب قابل باز شدن باشد',
sdBindToDeviceHint: 'اگر کلید به‌تنهایی لو برود، این payload روی یک نصب دیگر برنامه باز نمی‌شود. برای پیام‌های قابل‌اشتراک بین دستگاه‌های مختلف، این گزینه را خاموش کنید.',
sdUseServerSync: 'همگام‌سازی محدودیت‌ها با سرور',
sdUseServerSyncHint: 'کلید و متن به سرور ارسال نمی‌شود؛ فقط زمان اعتبار و دفعات مشاهده روی سرور ثبت می‌شود.',
sdServerUrl: 'آدرس سرور کنترل پیام',
sdServerUrlPlaceholder: 'https://host.example.com',
sdServerFallbackHint: 'اگر خالی باشد، برنامه از آدرس سرور چت امن استفاده می‌کند.',
sdReadServerUrl: 'سرور کنترل پیام',
sdReadServerUrlPlaceholder: 'در صورت وجود، از payload پر می‌شود',
sdReadServerHint: 'برای پیام‌های server-sync می‌توانید آدرس را دستی تغییر دهید؛ کلید همچنان فقط روی همین کلاینت استفاده می‌شود.',
enterSecureKeyPlaceholder: 'یک کلید امن وارد کنید...',
sensitiveTextPlaceholder: 'متن حساس خود را اینجا بنویسید...',
selfDestructOutputPlaceholder: 'خروجی رمزنگاری‌شده در اینجا قرار می‌گیرد...',
selfDestructPayload: 'رشته پیغام خودتخریب',
receivedPayloadPlaceholder: 'رشته دریافتی را اینجا قرار دهید...',
decryptKeyPlaceholder: 'کلید رمزگشایی را وارد کنید...',
openSelfDestructBtn: 'باز کردن پیام',
originalContent: 'محتوای اصلی',
createSelfDestructBtn: 'ایجاد پیام خودتخریب',
privateSymmetricKeys: 'کلیدهای خصوصی / متقارن (Private / Symmetric)',
publicKeysTitle: 'کلیدهای عمومی (Public Keys)',
noPublicKeys: 'هنوز کلید عمومی دریافت نشده',
keyNamePlaceholder: 'نام کلید',
tagNamePlaceholder: 'نام تگ',
importKeyDataPlaceholder: '...',
secureFileGuideTitle: 'راهنمای File System Access API:',
shredderChromeGuideHtml: '<b>Google Chrome / Edge:</b> این قابلیت به صورت پیش‌فرض فعال است. اگر کار نکرد، به <code>chrome://flags</code> یا <code>edge://flags</code> بروید و <b>File System Access API</b> را فعال (Enable) کنید.',
shredderFirefoxGuideHtml: '<b>Firefox / Safari:</b> این مرورگرها هنوز پشتیبانی کاملی از این API ندارند.',
shredderWarningHtml: 'توجه بسیار مهم: پس از پایان عملیات صفرنویسی (Shredding)، فایل شما خالی می‌شود اما از روی هارد حذف نمی‌شود. برای امحای نهایی، شما باید فایل خالی شده را به صورت دستی (Shift+Delete) از روی هارد پاک کنید.',
shredderDesktopSuccess: 'فایل در نسخه دسکتاپ بازنویسی و از روی دیسک حذف شد.',
recentUpdatesTitle: 'قابلیت‌های جدید نسخه 2.99',
updatePasskeyHtml: '<b>Passkey / Biometric Unlock:</b> باز کردن سریع برنامه با WebAuthn و passkey روی دستگاه‌های پشتیبانی‌شده.',
updateSecureShareHtml: '<b>Secure Share:</b> ساخت لینک یا باندل امن برای متن، یادداشت، فایل کوچک و کلید عمومی با انقضا و محدودیت مشاهده.',
updateSignaturesHtml: '<b>Digital Signatures:</b> امضا و راستی‌آزمایی متن و فایل با ECDSA و RSA-PSS.',
updateSecurityCenterHtml: '<b>Security Center:</b> پایش سلامت امنیتی برای passkey، 2FA، بکاپ، رمزهای ضعیف و کلیدهای legacy.',
updateWizardHtml: '<b>Smart Wizard & Secure Notes:</b> سناریوهای آماده برای کارهای رایج به‌همراه یادداشت‌های امن قابل اشتراک.',
updateSecureChatHtml: '<b>Secure Chat:</b> چت امن با طراحی موبایل‌محور، رله رمزنگاری‌شده، TURN، Web Push، پیام صوتی، پیام زمان‌دار، تیک‌ها و تماس صوتی/تصویری.',
updateDesktopHtml: '<b>PWA:</b> نصب‌پذیری وب، service worker و داشبورد واکنش‌گرا.',
secureChatGuideTitle: 'راهنمای چت امن',
chatGuideConnectHtml: '<b>اتصال:</b> Server URL همان دامنه HTTPS برنامه است. اگر Docker با profile TURN اجرا شده باشد، برنامه TURN URL/User/Password را از /turn-config می‌گیرد.',
chatGuideSessionHtml: '<b>ارسال پیام:</b> هنگام اولین ارسال، برنامه سشن RSA -> AES-GCM را خودکار می‌سازد؛ دیگر لازم نیست کاربر جداگانه دکمه کلید را بزند.',
chatGuideOfflineHtml: '<b>آفلاین:</b> رله فقط payload رمزنگاری‌شده و اعلان عمومی Push را نگه می‌دارد؛ متن پیام روی سرور قابل خواندن نیست.',
chatGuideCallsHtml: '<b>تماس‌ها:</b> برای اینترنت واقعی TURN را با دامنه/IP عمومی تنظیم کنید. قطع لحظه‌ای ICE فوراً تماس را نمی‌بندد و فقط در حالت failed/closed پایان می‌دهد.',
recommendedWorkflowsTitle: 'گردش‌کارهای پیشنهادی',
workflowEncryptSelfHtml: '<b>برای خودم رمزنگاری می‌کنم:</b> از Wizard گزینه Encrypt for Myself را بزنید تا AES-256-GCM و password mode آماده شود.',
workflowShareHtml: '<b>برای شخص دیگر می‌فرستم:</b> از Secure Share یا File Encrypt با RSA-OAEP-3072/4096 و کلید عمومی گیرنده استفاده کنید.',
workflowSignHtml: '<b>اصالت محتوا مهم است:</b> در تب Digital Signatures امضای متن/فایل بسازید و سمت گیرنده verify کنید.',
workflowHealthHtml: '<b>می‌خواهم ریسک‌ها را ببینم:</b> تب Security Center را باز کنید تا وضعیت passkey، 2FA، بکاپ و legacy records را یک‌جا ببینید.',
importKeyDropHtml: '<span class="font-semibold">انتخاب فایل</span> یا کشیدن و رها کردن',
jsonFileLabel: 'JSON',
saveTag: 'ذخیره تگ',
downloadPublicKeyJson: 'دانلود کلید عمومی (JSON)',
downloadPrivateKeyJson: 'دانلود کلید خصوصی (JSON)',
fontFaDefaultOption: 'Vazirmatn (پیش‌فرض)',
fontEnDefaultOption: 'Inter (پیش‌فرض)',
tagFriends: 'دوستان',
unlockWithPasskey: 'ورود با Passkey / Biometric',
smartWizard: 'ویزارد هوشمند',
wizardDesc: 'به‌جای درگیر شدن با تنظیمات خام، سناریوی موردنیاز را انتخاب کنید تا برنامه بهترین مسیر را آماده کند.',
wizardHint: 'هر کارت، تب درست و تنظیمات مناسب آن سناریو را برای شما فعال می‌کند.',
scenarioEncryptSelf: 'رمزنگاری فایل برای خودم',
scenarioEncryptSelfDesc: 'AES-GCM و رمز عبور را به‌عنوان مسیر پیش‌فرض شخصی آماده می‌کند.',
scenarioEncryptShare: 'ارسال برای فرد دیگر',
scenarioEncryptShareDesc: 'RSA هیبریدی و انتخاب کلید عمومی را برای اشتراک امن آماده می‌کند.',
scenarioShareLink: 'ساخت لینک امن',
scenarioShareLinkDesc: 'برای متن، فایل کوچک، کلید عمومی یا یادداشت، لینک/باندل امن می‌سازد.',
scenarioSignVerify: 'امضا و راستی‌آزمایی',
scenarioSignVerifyDesc: 'برای تأیید اصالت متن و فایل، شما را به تب امضای دیجیتال می‌برد.',
scenarioSecureNote: 'یادداشت امن',
scenarioSecureNoteDesc: 'ساخت یادداشت خصوصی رمزنگاری‌شده با امکان باندل و خروجی اشتراک امن.',
scenarioSelfDestruct: 'پیام خودتخریب',
scenarioSelfDestructDesc: 'برای ساخت یا باز کردن پیغام موقتی و حساس، فرم مناسب را آماده می‌کند.',
securityCenter: 'مرکز سلامت امنیت',
securityCenterDesc: 'وضعیت فعلی برنامه، کلیدها، گذرواژه‌ها، بکاپ، 2FA و Passkey را یک‌جا بررسی می‌کند.',
refreshHealth: 'بازخوانی سلامت',
secureShare: 'اشتراک امن',
secureChat: 'چت امن',
disconnected: 'عدم اتصال',
searchInChats: 'جستجو در چت‌ها و پیام‌ها',
searchEverywhere: 'جستجو در همه‌جا',
searchInThisChat: 'جستجو در این گفتگو',
deleteConversation: 'حذف گفتگو',
lockThisChat: 'قفل کردن گفتگو',
unlockWithBiometric: 'بایومتریک',
chatLockedNow: 'این گفتگو قفل شد.',
chatLockNeedsPin: 'اول برای این گفتگو رمز بگذارید.',
createSecureSession: 'ساخت سشن امن',
voiceCall: 'تماس صوتی',
endCall: 'پایان تماس',
backToChat: 'بازگشت به چت / حالت شناور',
activeCall: 'تماس فعال',
connecting: 'در حال اتصال...',
secureShareDesc: 'برای متن، یادداشت، فایل کوچک یا کلید عمومی، لینک یا باندل رمزنگاری‌شده بسازید.',
shareType: 'نوع محتوا',
shareTypeText: 'متن',
shareTypeNote: 'یادداشت امن',
shareTypeFile: 'فایل',
shareTypePublicKey: 'کلید عمومی',
shareContent: 'محتوا',
shareContentPlaceholder: 'محتوای حساس را اینجا وارد کنید...',
selectNote: 'انتخاب یادداشت',
shareFileSelect: 'فایل را برای ساخت باندل یا لینک امن انتخاب کنید...',
selectPublicKeyToShare: 'کلید عمومی برای اشتراک',
sharePassword: 'رمز عبور اشتراک',
sharePasswordPlaceholder: 'یک رمز امن وارد کنید',
expiryHours: 'انقضا (ساعت)',
maxViews: 'حداکثر مشاهده',
shareRecipientKey: 'کلید عمومی گیرنده',
generateSecureShare: 'ساخت لینک / باندل امن',
generatePasswordShort: 'تولید رمز',
shareClientOnlyHint: 'چون این برنامه کاملاً سمت‌کاربر است، محدودیت مشاهده و revoke به‌صورت گیرنده‌محور/مرورگرمحور اعمال می‌شود، نه از طریق سرور مرکزی.',
shareOutput: 'خروجی اشتراک امن',
downloadBundle: 'دانلود باندل',
openSecureShare: 'باز کردن لینک / باندل امن',
secureShareInputPlaceholder: 'لینک یا باندل را اینجا وارد کنید...',
shareOpenPrivateKey: 'کلید خصوصی RSA برای بازکردن',
openSecureShareBtn: 'باز کردن',
secureNotes: 'یادداشت‌های امن',
previewNote: 'پیش‌نمایش',
newNote: 'یادداشت جدید',
noteTitle: 'عنوان',
noteBody: 'محتوا',
noteAttachmentOptional: 'پیوست متنی / باندل (اختیاری)',
noteAttachmentPlaceholder: 'می‌توانید متن اضافه، JSON یا باندل کوچک ذخیره کنید...',
saveSecureNote: 'ذخیره یادداشت امن',
shareThisNote: 'اشتراک این یادداشت',
digitalSignatures: 'امضای دیجیتال',
signatureDesc: 'برای متن و فایل، اصالت و تمامیت محتوا را با کلیدهای امضایی تأیید کنید.',
newSignatureKey: 'کلید امضای جدید',
signContent: 'امضا کردن',
signatureMode: 'حالت',
selectSigningKey: 'کلید امضا',
signatureFileSelect: 'فایل را برای امضا انتخاب کنید...',
signatureTextPlaceholder: 'متنی که باید امضا شود را اینجا وارد کنید...',
createSignature: 'ساخت امضا',
verifySignatureTitle: 'راستی‌آزمایی امضا',
selectVerificationKey: 'کلید راستی‌آزمایی',
signatureVerifyFileSelect: 'فایل اصلی را برای راستی‌آزمایی انتخاب کنید...',
signatureBundlePlaceholder: 'امضا یا باندل امضا را اینجا قرار دهید...',
verifySignatureBtn: 'بررسی امضا',
signatureKeysTitle: 'کلیدهای امضای دیجیتال',
noSignatureKeys: 'هنوز کلید امضایی ایجاد نشده',
passkeyQuickUnlock: 'Passkey / Biometric Quick Unlock',
passkeyDisabled: 'هنوز فعال نشده',
setupPasskey: 'راه‌اندازی',
passkeyHint: 'در وب از Passkey و WebAuthn استفاده می‌شود و در نسخه دسکتاپ، احراز هویت محلی دستگاه برای بازکردن سریع برنامه به‌کار می‌رود.',
passkeyHintDesktop: 'در نسخه دسکتاپ، این بخش از احراز هویت محلی سیستم‌عامل و secure store دستگاه استفاده می‌کند؛ اگر دستگاه شما Touch ID، Windows Hello یا روش مشابه داشته باشد، برای بازکردن سریع برنامه استفاده می‌شود.',
passkeyHintMobile: 'روی اندروید رمز اصلی زیر کلیدی می‌نشیند که داخل Android Keystore ساخته می‌شود و روی iOS داخل Keychain؛ هیچ‌کدام بدون اثر انگشت یا چهره آن را پس نمی‌دهند. ثبت اثر انگشت یا چهرهٔ جدید، ذخیره‌شده را باطل می‌کند و باید یک بار رمز را دوباره وارد کنید.',
updateCheckNow: 'بررسی به‌روزرسانی',
updateCheckAuto: 'بررسی خودکار هنگام اجرا',
updateCheckNote: 'این تنها درخواستی است که برنامه بدون خواست شما به اینترنت می‌زند. فقط شمارهٔ آخرین نسخه را از گیت‌هاب می‌پرسد و هیچ چیزی دربارهٔ شما نمی‌فرستد.',
upTitle: 'اعلان بدون گوگل (UnifiedPush)',
upDesc: 'یک اپ توزیع‌کننده که خودتان نصب و انتخاب می‌کنید سوکت را نگه می‌دارد و رله به آدرسی که آن می‌دهد پیام می‌فرستد. گوگل در مسیر نیست.',
upConnect: 'اتصال',
upDisconnect: 'قطع اتصال',
upConnected: 'متصل',
upNotConnected: 'متصل نیست',
upConnectedNow: 'متصل شد. از این پس پیام‌ها گوشی را بیدار می‌کنند.',
upDisconnected: 'اتصال قطع شد.',
upNoDistributor: 'هیچ اپ توزیع‌کننده‌ای روی این گوشی نصب نیست. ntfy را از F-Droid یا Play نصب کنید و دوباره همین‌جا برگردید.',
upNoEndpoint: 'توزیع‌کننده هنوز آدرسی نداده است. اتصال اینترنت آن اپ را بررسی کنید و دوباره تلاش کنید.',
upFailed: 'اتصال به توزیع‌کننده ناموفق بود',
pushRelayTooOld: 'این رله از اعلان پشتیبانی نمی‌کند. سرور را به نسخهٔ ۲.۴۴.۰ یا بالاتر به‌روز کنید.',
pushRelayRefused: 'رله درخواست اعلان را رد کرد',
pushNotARelay: 'این آدرس پاسخ رله نمی‌دهد. آدرس سرور را در تنظیمات چت بررسی کنید.',
pushRelayUnreadable: 'پاسخ رله خوانا نبود',
upPollDesc: 'اگر توزیع‌کننده ندارید: هر ۱۵ دقیقه یک بار سر بزن. کندتر است، باتری می‌برد و یک الگوی ترافیکی می‌سازد که قبلاً نبود.',
upWhatIsNtfy: 'ntfy یک اپ کوچک و متن‌باز است که فقط یک کار می‌کند: یک اتصال باز نگه می‌دارد و وقتی چیزی رسید به برنامه خبر می‌دهد. محتوای پیام‌های شما را نمی‌بیند — رله چیزی جز «چیزی رسید» نمی‌فرستد.',
upNtfyNoAccount: 'نصبش کافی است. نه حساب می‌خواهد، نه تنظیمات.',
stickerPacks: 'پک‌های استیکر',
managePacks: 'مدیریت پک‌ها',
stickerPacksHint: 'نام و ترتیب پک‌ها را عوض کنید، یا چندتا را با هم انتخاب و حذف کنید. ترتیب همان است که در پنل استیکر می‌بینید.',
desktopBiometricPromptTitle: 'فعال‌سازی ورود سریع بیومتریک',
desktopBiometricPromptSubtitle: 'در صورت پشتیبانی دستگاه، می‌توانید مثل پیام‌رسان‌های دسکتاپ با تایید محلی سریع‌تر وارد شوید.',
desktopBiometricPromptBody: 'اگر نسخه دسکتاپ و دستگاه شما از احراز هویت محلی پشتیبانی کنند، برنامه می‌تواند master password را در storage امن سیستم نگه دارد و با Touch ID یا تایید محلی آن را سریع‌تر باز کند. آیا مایل هستید همین حالا آن را فعال کنید؟',
desktopBiometricEnableNow: 'همین حالا فعال شود',
desktopBiometricLater: 'بعداً',
desktopBiometricChecking: 'در حال بررسی...',
desktopBiometricAvailable: 'روی این دستگاه در دسترس است',
desktopBiometricUnavailable: 'در این runtime دسکتاپ در دسترس نیست',
desktopBiometricEnabled: 'فعال و آماده استفاده',
desktopBiometricWebOnly: 'Runtime icon switching is available only in the desktop build',
yourChatIdentity: 'هویت شما در چت',
peerIdLabel: 'شناسه Peer',
securityKeyLabel: 'کلید امنیتی',
copyFullIdentity: 'کپی کامل هویت',
showQrCode: 'نمایش QR code',
startChat: 'شروع چت',
profilePicture: 'تصویر پروفایل',
changeProfilePicture: 'تغییر تصویر پروفایل',
defaultAvatar: 'آواتار پیش‌فرض',
selectFromGallery: 'انتخاب از گالری / فایل',
rotateLeft: 'چرخش چپ',
rotateRight: 'چرخش راست',
zoom: 'بزرگ‌نمایی',
avatarMoveX: 'جابجایی افقی',
avatarMoveY: 'جابجایی عمودی',
avatarWidth: 'عرض تصویر',
avatarHeight: 'ارتفاع تصویر',
avatarFilter: 'فیلتر',
filterNone: 'بدون فیلتر',
filterMono: 'سیاه و سفید',
filterWarm: 'گرم',
filterVivid: 'زنده',
filterNoir: 'کنتراست',
applyCrop: 'اعمال کراپ',
cancelEdit: 'لغو ادیت',
saveAvatar: 'ذخیره',
displayName: 'نام نمایشی',
saveProfile: 'ذخیره پروفایل',
resetKey: 'بازنشانی کلید',
connectionSettingsTitle: 'تنظیمات اتصال و TURN',
relayServerUrl: 'آدرس سرور رله',
secureChatSwitch: 'چت امن',
secureChatOffNotice: 'چت امن خاموش است. برای اتصال، آدرس سرور را وارد و ذخیره کنید، فایل کانفیگ را ایمپورت کنید یا نشانی را با QR بخوانید.',
exportRelayConfig: 'خروجی کانفیگ اتصال',
importRelayConfig: 'ایمپورت فایل کانفیگ',
exportPortableProfile: 'خروجی پروفایل همراه',
importPortableProfile: 'ایمپورت پروفایل همراه',
linuxCallsNotice: 'به دلیل محدودیت لینوکس و پشتیبانی ناپایدار WebKitGTK از WebRTC، تماس صوتی و تصویری و تماس گروهی در این نسخه در دسترس نیست. برای تماس از نسخهٔ PWA استفاده کنید: با «پروفایل همراه» هویتتان را به PWA ببرید و از مرورگر با همان هویت تماس بگیرید.',
openPwaForCalls: 'باز کردن نسخهٔ PWA در مرورگر (برای تماس)',
autoConnect: 'اتصال خودکار',
videoCall: 'تماس تصویری',
localDiscovery: 'دیسکاوری محلی',
suspensionCountdown: 'شمارش معکوس تعلیق',
callRingtone: 'زنگ تماس',
messageSound: 'صدای پیام',
turnServerUrl: 'آدرس TURN',
turnUsername: 'نام کاربری TURN',
turnCredential: 'رمز TURN',
turnHelpNote: 'نام کاربری و رمز TURN همان `TURN_USER` و `TURN_PASSWORD` داخل فایل `.env` یا `docker-compose.env.example` هستند. برای کاربران بیرون از شبکه، Server URL و TURN باید دامنه/IP قابل دسترس عمومی باشند.',
connect: 'اتصال',
reconnect: 'اتصال مجدد',
discoverLocal: 'کشف محلی',
testRingtone: 'تست زنگ',
testMessageTone: 'تست پیام',
chats: 'چت‌ها',
calls: 'تماس‌ها',
groups: 'گروه‌ها',
connection: 'اتصال',
newGroupName: 'نام گروه جدید',
ringtoneClassic: 'کلاسیک',
ringtonePulse: 'پالس آرام',
ringtoneSignal: 'سیگنال سریع',
ringtoneSoft: 'زنگ نرم',
toneChime: 'چایم کوتاه',
tonePop: 'پاپ نرم',
tonePing: 'پینگ سریع',
toneBell: 'بل آرام',
toneSilent: 'بی‌صدا',
online: 'آنلاین',
noPeersFound: 'هنوز کاربری پیدا نشده است.',
backToChatList: 'بازگشت به لیست گفتگوها',
selectAConversation: 'یک گفتگو را انتخاب کنید',
secure: 'امن',
chatStartHint: 'برای شروع، یک کاربر آنلاین یا فضای محلی را انتخاب کنید.',
activeCallInProgress: 'تماس فعال در حال برگزاری است',
returnToCall: 'بازگشت به تماس',
chatMessagesHint: 'بعد از شروع سشن امن، پیام‌ها اینجا نمایش داده می‌شوند.',
ready: 'آماده',
recording: 'در حال ضبط...',
pause: 'توقف موقت',
finish: 'پایان ضبط',
deleteRecording: 'حذف ضبط',
discardDraft: 'حذف پیش‌نویس',
send: 'ارسال',
sendFile: 'ارسال فایل',
sendFromGallery: 'عکس و ویدیو از گالری',
callBackdrop: 'پس‌زمینهٔ تصویر',
callBackdropBlur: 'تصویر محو',
callBackdropDark: 'مشکی ساده — بدون حرکت (پیش‌فرض)',
voiceMessage: 'پیام صوتی',
chatPlaceholder: 'پیام امن شما…',
selfDestructMessage: 'پیام خودتخریب',
hiddenMessage: 'پیام مخفی',
stickers: 'استیکرها',
createPoll: 'نظرسنجی',
selectedCount: 'انتخاب‌شده',
copy: 'کپی',
forward: 'هدایت',
vaultBackupTitle: 'پشتیبان کامل خزانه',
vaultBackupDesc: 'یک فایل که همه‌چیز را می‌برد: کلیدها، رمزها، یادداشت‌ها، تنظیمات، گفتگوها و مخاطبین، پک‌های استیکر، صداهای دلخواه، و همهٔ فایل‌ها و پیام‌های صوتی ذخیره‌شده. با Argon2id و AES-256-GCM قفل می‌شود و روی هر دستگاه دیگری قابل بازگردانی است.',
vaultBackupMake: 'ساخت پشتیبان',
vaultBackupPass: 'رمز فایل پشتیبان (حداقل ۸ کاراکتر)',
vaultBackupPass2: 'تکرار رمز',
vaultBackupBtn: 'ساخت فایل پشتیبان',
vaultRestoreTitle: 'بازگردانی',
vaultRestorePass: 'رمز فایل پشتیبان',
vaultRestoreBtn: 'بازگردانی از پشتیبان',
chatPreviewName: 'نمونه',
chatPreviewState: 'آنلاین',
chatPreviewIn1: 'سلام! این یک پیش‌نمایش زنده است.',
chatPreviewOut1: 'هر تغییری بدهید، همین‌جا می‌بینید.',
chatPreviewOut2: 'رسید، ولی هنوز باز نشده.',
chatPreviewIn2: 'حالا خواندمش.',
chatPreviewOut3: 'و این یکی خوانده شد.',
chatThemeLabel: 'تم چت',
chatBubbleSection: 'حباب پیام',
chatBubbleMine: 'حباب خودم',
chatBubbleTheirs: 'حباب طرف مقابل',
chatBubbleAlpha: 'شفافیت حباب',
chatBubbleRadius: 'گردی گوشه‌ها',
chatZoom: 'بزرگ‌نمایی متن چت',
chatBackgroundSection: 'پس‌زمینهٔ چت',
chatBackgroundBlur: 'محو کردن پس‌زمینه',
chatBackgroundUpload: 'تصویر دلخواه',
chatBackgroundClear: 'حذف تصویر',
chatBackgroundNote: 'تصویر دلخواه فقط روی همین دستگاه و داخل همین پروفایل می‌ماند و هرگز فرستاده نمی‌شود.',
chatTickSection: 'تیک‌های پیام',
chatAppearanceReset: 'بازنشانی کل ظاهر',
chatAppearanceTitle: 'ظاهر چت',
chatAppearanceProfile: 'پروفایل ظاهر',
chatTickSent: 'ارسال‌شده (یک تیک)',
chatTickDelivered: 'رسیده (دو تیک)',
chatTickSeen: 'خوانده‌شده',
chatTickReset: 'بازگشت به رنگ تم',
chatTickPreviewText: 'نمونهٔ پیام',
chatTickNote: 'رنگ‌ها روی حباب پیام خودتان دیده می‌شوند. نسبت کنتراست هر رنگ در کنار دکمه نوشته می‌شود؛ زیر ۳:۱ یعنی تیک روی این تم به‌سختی خوانده می‌شود.',
chatLockTitle: 'قفل مشترک بخش‌های حساس',
chatLockEnable: 'قفل مشترک فایل‌ها، چت امن و تنظیمات',
chatLockAuto: 'قفل خودکار پس از',
chatLockNever: 'هرگز',
chatLockNote: 'این قفل با مدیریت فایل‌ها و تنظیمات مشترک است. با ترک بخش‌های محافظت‌شده دوباره قفل می‌شود.',
chatLockedTitle: 'چت قفل است',
chatLockedBody: 'برای دیدن گفتگوها رمز چت را وارد کنید.',
chatPin: 'رمز چت',
chatPinWrong: 'رمز اشتباه است.',
unlock: 'باز کردن',
verifyKey: 'تأیید کلید',
groupInfo: 'اطلاعات گروه',
joinByInvite: 'پیوستن با کد دعوت',
shareLocation: 'ارسال موقعیت',
shareContact: 'کارت مخاطب',
pollQuestion: 'سؤال نظرسنجی…',
pollAddOption: 'گزینه',
pollMulti: 'چند گزینه‌ای',
pollSend: 'ارسال نظرسنجی',
moreOptions: 'گزینه‌های بیشتر',
more: 'بیشتر',
e2eeCall: 'رمزنگاری سرتاسری',
sssTitle: 'تقسیم راز — Shamir Secret Sharing',
sssIntro: 'یک راز (کلید، عبارت بازیابی، رمز اصلی) را به چند سهم تقسیم کنید. برای بازسازی، تنها به تعداد آستانه سهم نیاز است و کمتر از آن هیچ اطلاعاتی لو نمی‌دهد. همه‌چیز روی همین دستگاه محاسبه می‌شود.',
sssSplitTitle: '۱) تقسیم',
sssSecretLabel: 'راز',
sssSecretPlaceholder: 'عبارت بازیابی یا کلید…',
sssThreshold: 'آستانه (K)',
sssTotal: 'تعداد سهم (N)',
sssSplitBtn: 'تقسیم کن',
sssCombineTitle: '۲) بازسازی',
sssSharesLabel: 'سهم‌ها (هر کدام در یک خط)',
sssCombineBtn: 'بازسازی کن',
sssRecovered: 'راز بازسازی‌شده',
argon2Title: 'Argon2id — هش و کلیدسازی از رمز',
argon2Intro: 'برندهٔ مسابقهٔ Password Hashing؛ برخلاف PBKDF2 به حافظه هم نیاز دارد، پس حمله با GPU گران می‌شود. کاملاً روی همین دستگاه اجرا می‌شود.',
argon2Password: 'رمز عبور',
argon2Preset: 'سطح سختی',
argon2Interactive: 'تعاملی — ۱۹ مگابایت، ۲ دور',
argon2Moderate: 'متوسط — ۶۴ مگابایت، ۳ دور',
argon2Sensitive: 'حساس — ۲۵۶ مگابایت، ۴ دور',
argon2HashBtn: 'محاسبهٔ هش',
argon2Output: 'خروجی (قالب استاندارد PHC)',
argon2VerifyLabel: 'راستی‌آزمایی: هش موجود را اینجا بگذارید',
argon2VerifyBtn: 'تطبیق با رمز بالا',
importStickers: 'وارد کردن استیکر',
localVaultTitle: 'حافظهٔ محلی رمزنگاری‌شده',
localVaultNote: 'فایل‌ها، پیام‌های صوتی و استیکرها با AES-256-GCM روی همین دستگاه رمز و ذخیره می‌شوند تا پس از رفرش هم در دسترس بمانند. کلید رمزگذاری با رمز اصلی شما محافظت می‌شود و هرگز از دستگاه خارج نمی‌شود.',
clearOldMedia: 'پاک‌سازی قدیمی‌تر از ۳۰ روز',
clearAllMedia: 'پاک‌سازی همهٔ رسانه‌ها',
clearAllStickers: 'حذف همهٔ پک‌ها',
refresh: 'بازخوانی',
manageStickers: 'مدیریت پک‌ها',
importSound: 'صدای دلخواه',
removeSound: 'حذف صدای دلخواه',
chatDiagTitle: 'گزارش وضعیت چت',
pruneContacts: 'پاک‌سازی مخاطبین بی‌استفاده',
composerActions: 'گزینه‌های پیام',
timerOff: 'بدون تایمر',
timer10s: '۱۰ ثانیه',
timer30s: '۳۰ ثانیه',
timer1m: '۱ دقیقه',
timer5m: '۵ دقیقه',
timer30m: '۳۰ دقیقه',
timer1h: '۱ ساعت',
timer10h: '۱۰ ساعت',
secureSession: 'سشن امن',
waitingForSecureSession: 'منتظر سشن امن',
remoteKey: 'کلید مقصد',
speaker: 'اسپیکر',
hold: 'هولد',
mute: 'بی‌صدا',
flip: 'چرخش',
video: 'ویدیو',
screenShare: 'پرزنت',
present: 'پرزنت',
reactions: 'واکنش',
raiseHand: 'بالا بردن دست',
callLayout: 'چیدمان',
secureChatSettings: 'تنظیمات',
fileManagerTitle: 'مدیریت فایل‌های محلی',
end: 'پایان',
pwaWarningTitle: 'توجه',
pwaWarningContent: 'اخطار:\nبا توجه به ماهیت ذاتی برنامه که تمامی رمزنگاری و رمز گشایی متن ها، فایل ها، ساختن سشن های Peer to Peer برای چت ها و پروسه رمزنگاری و رمزگشایی آنها در سمت کلاینت انجام می‌شود، توصیه میشود که از نسخه PWA دسکتاپ یا نسخه های بومی متناسب با سیستم عامل خود استفاده کنید. بدیعی است که به خاطر ماهیت امنیتی و حساسیت بر حفظ محرمانگی اطلاعات این تصمیم اتخاذ شده است.\nدر خصوص دیوایس های همراه، به خصوص دیوایس های قدیمی احتمال بروز مشکلاتی خواهد بود، اعم از گرم شدن بیش از حد دیوایس، تخلیه سریع باتری و گاهاً تاخییر در پاسخگویی دیوایس. این اخطار به منزله پذیرفتن ریسک این شرایط برای دیوایس های همراه برای استفاده از برنامه می‌باشد.'
},
en: {
appSubtitle: 'Advanced Encryption Suite',
selectLanguage: 'Select Language',
persian: 'Persian',
english: 'English',
englishSubtitle: 'English',
installPwaVersion: 'Install the PWA version',
pwaBenefitDesc: 'Install this app as a PWA for a better experience, offline use, an app-like interface, and easier access to device capabilities.',
installOrGuide: 'Install / Setup Guide',
continueInBrowser: 'Continue in Browser',
generateRandomKey: 'Generate random key',
panicPasswordPlaceholder: 'New panic password',
play: 'Play',
oneMinute: '1 minute',
fiveMinutes: '5 minutes',
fifteenMinutes: '15 minutes',
thirtyMinutes: '30 minutes',
customAutoLockPlaceholder: 'Duration (minutes)',
regenerate: 'Regenerate',
masterPassword: 'Master Password',
confirmPassword: 'Confirm Password',
passwordStrength: 'Password Strength',
weak: 'Weak',
medium: 'Medium',
strong: 'Strong',
veryStrong: 'Very Strong',
reqLength: 'At least 8 characters',
reqUpper: 'Upper & lowercase letters',
reqNumber: 'Numbers (0-9)',
reqSpecial: 'Special chars (!@#$%^&*)',
enable2FA: 'Enable Two-Factor Auth',
scanQR: 'Scan QR with Authenticator app',
twoFA_prompt: 'For added security and to prevent unauthorized access, please enable Two-Factor Authentication (2FA) from Settings -> Two-Factor Authentication.',
securityQuestions: 'Security Questions (For Recovery)',
securityQuestionsDesc: 'Please select and answer 3 questions. These will be the only way to recover your password if forgotten.',
changeSecurityQuestions: 'Change Security Questions',
changeSecurityQuestionsDesc: 'Enter your current password, then choose three new recovery questions and answers.',
saveSecurityQuestions: 'Save Security Questions',
masterPasswordSetupTitle: 'Master Password Panel',
masterPasswordSetupDesc: 'Create a strong master password. It becomes the main key for access to your local encrypted data.',
termsTitle: 'Terms of Service',
termsIntro: 'By using this application you acknowledge that you are responsible for protecting your master password, keys, backups, and lawful use of the tool.',
termsBullet1: 'All data stays client-side, and losing the master password or keys may make recovery impossible.',
termsBullet2: 'This app is designed for legitimate personal and professional protection workflows and must not be used for unlawful activity or abusive concealment.',
termsBullet3: 'Icon profiles and disguise modes are visual changes only and do not create a real security boundary by themselves.',
viewLicense: 'View the AGPL v3.0 licence',
viewDisclaimer: 'View disclaimer',
disclaimerTitle: 'Disclaimer',
disclaimerBody1: 'This software is provided without any express or implied warranty. Final responsibility for storing, sharing, and deleting sensitive data remains with the user.',
disclaimerBody2: 'Before using the app with important data, make sure you have a healthy backup, a tested recovery path, and the correct encryption workflow selected.',
acceptTermsLabel: 'I have read and accept the terms, license, and disclaimer.',
enter2FACode: 'Enter 6-digit code',
verify: 'Verify',
activateLock: 'Activate Security Lock',
enterMasterPassword: 'Enter master password',
unlock: 'Unlock',
wrongPassword: 'Wrong password!',
appLocked: 'Application is locked',
forgotPassword: 'Forgot your password?',
answerSecQuestions: 'Answer your security questions to recover your password',
verifyQuestions: 'Verify Answers',
saveNewPassword: 'Save New Password',
advancedEncryption: 'Advanced Encryption Suite',
encrypt: 'Encrypt',
decrypt: 'Decrypt',
keyManagement: 'Key Management',
sshKeyManager: 'SSH Keys',
sshKeyManagerTitle: 'SSH Key Manager',
sshKeyManagerSub: 'Generate, import, and manage SSH keys — fully graphical, stored encrypted in the app vault',
sshGenerateTitle: 'Generate a new key',
sshKeyType: 'Key type',
sshRsaBits: 'RSA size',
sshKeyName: 'Key name (optional)',
sshComment: 'Comment / identifier (optional)',
sshGenerate: 'Generate key',
sshStoredTitle: 'Stored keys',
sshDeviceTitle: 'Device keys (~/.ssh)',
sshDeviceDesc: 'With your permission, the app can read keys from the device default SSH folder, import them, and write new keys there.',
sshOpenDir: 'Open the device SSH folder',
sshPickFolder: 'Select the SSH folder (Safari/Firefox)',
sshDropTitle: 'Drag & drop your .ssh folder here',
sshDropSub: 'Works in every desktop browser',
mtbFiles: 'Files',
mtbChat: 'Secure Chat',
mtbSsh: 'SSH Keys',
mtbPasswords: 'Passwords',
mtbSettings: 'Settings',
sshRescan: 'Rescan',
sshImportFile: 'Import from file',
sshManualPath: 'Manual SSH folder path (optional — for guidance/documentation):',
passwords: 'Passwords',
settings: 'Settings',
help: 'Help',
dashboardHub: 'Dashboard Hub',
dashboardHint: 'Quickly move between secure workflows, utilities, and app settings.',
appNameDisplay: 'P00RIJÃ Cryptography',
selectFile: 'Select File',
dropFile: 'Drop file here or click',
noLimit: 'No size limit',
createSelfDestruct: 'Create Self-Destruct Message',
createSelfDestructDesc: 'Create a message that will be destroyed after a certain time or number of views.',
sdTimeLimit: 'Time Limit',
days: 'Days (0-29)',
hours: 'Hours (0-23)',
minutes: 'Minutes (0-59)',
seconds: 'Seconds (0-59)',
encryptionSettings: 'Encryption Settings',
algorithm: 'Algorithm',
keyMethod: 'Key Method',
password: 'Password',
publicKey: 'Public Key',
encryptionPassword: 'Encryption Password',
operation: 'Operation',
startEncryption: 'Start Encryption',
decryptPoorija: 'Decrypt P00RIJÃ File',
selectPoorija: 'Select .poorija file',
file: 'File:',
decryptAndSave: 'Decrypt & Save',
keyLibrary: 'Key Library',
newKey: 'New Key',
noKeys: 'No keys created yet',
generatedPasswords: 'Generated Passwords',
passwordsDescription: 'Passwords generated by the password tool',
noPasswords: 'No passwords generated yet',
defaultAlgorithm: 'Default Algorithm',
defaultKeyMethod: 'Default Key Method',
defaultKdfIterations: 'Default PBKDF2 Iterations',
defaultKdfHash: 'Default PBKDF2 Hash',
defaultSaltLength: 'Default Salt Length',
defaultGcmTagLength: 'Default GCM Tag Length',
defaultCtrCounterLength: 'Default CTR Counter Length',
defaultAadContext: 'Default AAD / Context',
defaultRsaLabel: 'Default RSA-OAEP Label',
chunkSize: 'Chunk Size',
namingPattern: 'Naming Pattern',
encryptionDefaultsHint: 'These defaults are applied to file encryption, live text encryption, self-destruct messages, and Secure Share. Each workflow can still override them locally.',
securitySettings: 'Security Settings',
duressPanicMode: 'Duress Panic Mode',
panicDesc: 'Set an emergency password. If this password is entered on the login screen, all local data is wiped immediately and the app is locked.',
savePanicPassword: 'Save Panic Password',
autoLock: 'Auto Lock',
autoLockDesc: 'Auto lock after inactivity',
lockAfter: 'Lock after',
changeMasterPassword: 'Change Master Password',
currentPassword: 'Current Password',
newPassword: 'New Password',
confirmNewPassword: 'Confirm New Password',
updatePassword: 'Update Password',
twoFactorAuth: 'Two-Factor Auth (2FA)',
disabled: 'Disabled',
enabled: 'Enabled',
enable: 'Enable',
disable: 'Disable',
appearance: 'Appearance',
theme: 'Theme',
light: 'Light',
dark: 'Dark',
notifications: 'Notifications',
keyChangedTitle: "This contact's security key has changed",
keyChangedBody: 'Either they reinstalled the app, or somebody has placed themselves between you. Do not send anything sensitive until you have compared the safety number with them in person or over a call.',
compareSafetyNumber: 'Compare safety number',
acceptNewKey: 'Accept the new key',
keepOldKey: 'Keep the old key',
autoDownloadLimit: 'Auto-download up to',
autoDownload1m: '1 MB',
autoDownload5m: '5 MB',
autoDownload10m: '10 MB',
autoDownload25m: '25 MB',
autoDownload50m: '50 MB',
autoDownload100m: '100 MB',
autoDownloadNever: 'Never — always ask',
lockThisChatNow: 'Lock this chat now',
lockSecureChatNow: 'Lock the secure chat now',
secureChatLocked: 'Secure chat is locked',
autoDownloadNote: 'While you are online, files and media up to this size download on their own and land in this encrypted storage; anything larger downloads with one confirmation and is saved here automatically once complete. After a download completes, the relay copy is dropped — there is no cloud mode.',
pushBackground: 'Background notifications (app closed)',
fsTitle: 'Forward secrecy',
fsBody: 'A message that never reaches its recipient waits at most 15 days. After that its key is deleted from the recipient\'s device and it can no longer be opened by anyone — including them. Live conversations derive their key from an exchange whose ephemeral halves are thrown away when the session ends, so today\'s recording cannot be opened with tomorrow\'s key.',
fsHistoryNote: 'This protects copies recorded in transit, not the history stored on this device — that is what the master password, the chat lock and disappearing messages are for.',
offByDefault: 'off by default',
pushBackgroundDesc: "To reach you while the app is closed, your browser's push service enters the path and the relay keeps one address for your device. No message text, no sender name and no content is sent, and end-to-end encryption is untouched.",
pushTtl: 'Delete the subscription after',
pushDays: 'days',
pushHintOff: 'Off. The relay keeps no address for this device.',
pushHintLost: 'This device\u2019s subscription is no longer valid, so nothing will be announced. Switch it on once to register again \u2014 that needs a tap of yours.',
pushHintOn: 'On. This device\'s subscription is deleted after {days} unused days.',
pushUnsupported: 'This browser cannot do background notifications. On iPhone the app has to be installed from the Home Screen.',
pushNativeNote: 'In the native app notifications come from the operating system and work whenever the app is running, including from the tray. Waking a fully closed app is a web/PWA feature only.',
pushPermissionDenied: 'Notification permission was refused, so it stayed off.',
pushPermissionRetry: 'The permission prompt did not open. Tap the switch once more.',
pushFailed: 'Could not register the notification subscription.',
pushOn: 'Background notifications are on.',
pushOff: 'Background notifications are off and the subscription was removed from the relay.',
showNotifications: 'Show Notifications',
desktopNotificationsUnsupported: 'System notifications are unavailable in this desktop build.',
desktopNotificationsPrompt: 'Turn this on to let the app request system-notification permission from the OS.',
desktopNotificationsGranted: 'System notifications are allowed and will be shown while this setting stays enabled.',
desktopNotificationsDenied: 'System-notification permission was denied. Re-enable it from the operating system settings to use desktop alerts again.',
publicStun: 'Public STUN (Google/Twilio)',
desktopShell: 'Desktop behaviour',
desktopShellDesc: 'Only shown in the native macOS and Linux build. It controls what happens when the window is closed and whether the app starts with your session.',
desktopKeepRunning: 'Keep running in the background after the window is closed',
mobileKeepRunningHint: 'Keeps the app in memory so Android does not close it: it reopens instantly with its state and collects whatever the relay queued. Android requires a permanent notification for that. Note that new messages do not arrive while the app is in the background — Android freezes the web engine, and no app can prevent it.',
desktopNoTray: 'This desktop has no tray icon, so closing the window quits the app. On GNOME, installing the "AppIndicator and KStatusNotifierItem Support" extension usually fixes it.',
desktopKeepRunningHint: 'While this is on, closing the window only hides it and the app stays alive in the tray so messages and calls still reach you. Turn it off and closing the window quits the app for real.',
desktopStartMinimized: 'Start hidden when launched at login',
desktopStartMinimizedHint: 'Applies only to the automatic launch at login; starting the app yourself always shows the window.',
desktopAutostart: 'Launch at login',
desktopAutostartHint: 'Registers the app with the operating system login items (LaunchAgent on macOS, autostart entry on Linux).',
desktopVaultSyncTitle: 'On-system vault copy',
desktopVaultSync: 'Keep an encrypted copy of the vault on this system',
desktopVaultSyncHint: 'The whole vault — keys, notes, chat history, attachments — is sealed with your master password through Argon2id before it touches the disk. Nothing is ever decrypted off this device and nothing is sent to a server.',
desktopVaultPathLabel: 'Path on disk',
desktopVaultSyncNow: 'Save now',
desktopVaultNever: 'Not saved yet.',
desktopVaultLocked: 'Unlock the app first to write the on-system copy.',
desktopVaultSaving: 'Encrypting and writing…',
desktopVaultFailed: 'Writing the on-system vault copy failed.',
desktopVaultDelete: 'Securely delete the on-disk copy',
desktopVaultDeleted: 'The on-disk copy was overwritten and removed.',
webPushNotificationsUnsupported: 'Web Push notifications are unavailable in this browser or secure context.',
webPushNotificationsPrompt: 'Enable OS notifications to receive offline encrypted message and call alerts.',
webPushNotificationsGranted: 'Web Push is enabled for encrypted relay message and call alerts.',
webPushNotificationsDenied: 'Notification permission was denied. Re-enable it from browser settings to use push alerts.',
dangerZone: 'Danger Zone',
resetToDefault: 'Reset to Default',
helpIntro: 'Complete guide to the version 2.99 cryptography dashboard',
howToEncrypt: 'How to Encrypt Files',
encStep1: 'Go to "Encrypt" tab',
encStep2: 'Select your file (no size limit)',
encStep3: 'Choose encryption algorithm (AES-256-GCM recommended)',
encStep4: 'Specify key method (password or public key)',
encStep5: 'Click start and wait for completion',
encStep6: 'Download the .poorija file',
howToDecrypt: 'How to Decrypt',
decStep1: 'Go to "Decrypt" tab',
decStep2: 'Select the .poorija file',
decStep3: 'Enter the password or private key',
decStep4: 'Original file will be restored',
algorithmsTitle: 'Encryption Algorithms',
aesDesc: 'The primary authenticated-encryption choice for client-side web use.',
chachaDesc: 'The standard Web Crypto streaming mode for niche and sequential-data cases.',
rsaDesc: 'Hybrid encryption: RSA wraps an AES session key for broad browser compatibility.',
eccDesc: 'The 4096-bit option for cases where stronger margins outweigh extra CPU cost.',
securityTips: 'Security Tips',
tip1: 'Security Protocol: If you enter incorrect security question answers 3 times, ALL your data will be wiped.',
tip2: 'Use a strong password with at least 12 characters',
tip3: 'Store private keys in a secure location',
tip4: 'Enable two-factor authentication for extra security',
success: 'Success',
fileReady: 'File ready for download:',
download: 'Download',
close: 'Close',
madeWith: 'Made with',
in: 'in',
allRightsReserved: 'All Rights Reserved',
back: 'Back',
advancedSettings: 'Advanced Settings',
iterations: 'Iterations',
kdfHash: 'KDF Hash',
saltLength: 'Salt Length',
gcmTagLength: 'GCM Tag Length',
ctrCounterLength: 'CTR Counter Length',
aadContext: 'AAD / Context',
aadContextPlaceholder: 'metadata / tenant / purpose',
rsaOaepLabel: 'RSA-OAEP Label',
rsaOaepLabelPlaceholder: 'recipient-context',
advancedSettingsHint: 'Use these controls to tune password-based KDF settings, AES-GCM AAD/tag behavior, AES-CTR counter length, and RSA-OAEP recipient context labels.',
selectKey: 'Select Key',
hashChecker: 'Hash Checker',
qrBridge: 'QR Bridge',
authenticator: 'Authenticator',
inspector: 'Character Inspector',
converter: 'Convert Bench',
qrBridgeTitle: 'QR Bridge — transfer with no network',
qrBridgeIntro: 'Turns text or data into a sequence of QR codes for another device to read with its camera. No internet, no Bluetooth, no server.',
qrBridgeInputLabel: 'What you want to send',
qrBridgeInputPlaceholder: 'Paste the encrypted text here…',
qrBridgeBuildBtn: 'Build the codes',
qrBridgePlayBtn: 'Auto-play',
qrBridgeReceive: 'Receive with the camera',
qrBridgeReceiveHint: 'Point the camera at the sending screen. Frames may be read in any order, and the app says which are still missing.',
qrBridgeScanBtn: 'Start camera',
qrBridgeScanStopBtn: 'Stop',
qrBridgeResetBtn: 'Start over',
qrBridgeOutputLabel: 'What was reassembled',
localLink: 'Local Link',
localLinkTab: 'Local Link',
callQualityTitle: 'Connection quality \u2014 tap for detail',
qrBoost: 'Big and bright',
linkNoCamera: 'No camera: use text or a file',
linkRoomTitle: 'Local room',
cancel: 'Cancel',
linkInvite: 'Invite somebody',
linkVoiceCall: 'Voice call',
linkVideoCall: 'Video call',
linkLeave: 'Leave the room',
linkSendFile: 'Send a file',
linkSticker: 'Sticker',
linkPoll: 'Poll',
linkPollQuestion: 'Poll question',
linkPollOptions: 'One option per line',
linkPollSend: 'Send the poll',
linkNoCameraHint: 'Exactly what the QR code carries, as text. Copy it and get it to the other device however you can \u2014 email, a USB stick, a shared folder, any messenger. Nothing about this weakens the encryption: the payload holds a public key, not a private one.',
linkMineLabel: 'This device\u2019s code',
linkTheirLabel: 'The other device\u2019s code',
linkTheirPlaceholder: 'Paste the other device\u2019s code here\u2026',
linkCopy: 'Copy',
linkSaveFile: 'Save to a file',
linkPaste: 'Paste from clipboard',
linkOpenFile: 'Open a file',
linkUseText: 'Use this code',
qrSwitchCamera: 'Next camera',
qrTorch: 'Torch',
save: 'Save',
setStatus: 'Status',
setYourStatus: 'Your status',
changeCompanion: 'Next companion',
worldClocks: 'World clocks',
profileSettings: 'Chat profile settings',
exportChats: 'Export conversations',
importChats: 'Import conversations',
clearAllHistory: 'Clear all history',
chatRailResize: 'Resize the conversation column',
conversationActions: 'Conversation actions',
deleteMessage: 'Delete',
stripMetadataOnSend: 'Strip metadata when sending a file',
stripMetadataHint: 'On: every file is cleared of location, camera model, date and software name before it is encrypted. Off: the file goes as it is, and you are warned once if it carries a location or a name.',
convertHeicHint: 'HEIC metadata cannot be stripped: the image is located by byte offsets, so moving anything corrupts the file. Converting to JPEG re-encodes the picture and no metadata comes with it. Off: the file is sent as it is, without asking.',
newGroupTitle: 'New group',
groupMembers: 'Group members',
groupAboutPlaceholder: 'A short description of the group (optional)',
memberPermissions: 'What members are allowed to do',
perMemberLater: 'Once the group exists you can restrict these for one particular member too.',
createGroup: 'Create group',
screenshot: 'Snapshot',
mirror: 'Mirror',
swap: 'Swap',
pip: 'PiP',
fullscreen: 'Full screen',
devices: 'Devices',
stegoModeRobust: 'Robust — survives a messenger recompressing the picture',
stegoModeRobustHint: 'You can send the image as a photo. Smaller capacity (a few kilobytes).',
stegoModeCapacity: 'High capacity — only if you send it as a file',
stegoModeCapacityHint: 'Room for hundreds of kilobytes, but sending it as a photo destroys the message completely.',
vaultIntro: 'Everything the app keeps, in one place: message attachments, voice messages, stickers and encrypted files.',
vaultLockNote: 'Files are encrypted with your master password. The shared lock restricts access to Files, Secure Chat and Settings on this device.',
voicePickFile: 'Choose an audio file',
voiceStop: 'Stop',
mtabSettingsTitle: 'Customise the quick access bar (mobile)',
mtabSettingsDesc: 'Choose which tabs appear in the bar at the bottom of the phone (up to 5) and reorder them.',
mtabDiagTitle: 'Display information',
helpOlderNotes: 'Older notes and release detail',
helpSearchPlaceholder: 'Search the help\\u2026',
callQualityHeading: 'Connection quality',
localLinkTitle: 'Local Link — with no server at all',
localLinkIntro: 'Two devices on the same Wi-Fi introduce themselves through a camera, then talk to each other directly and encrypted. No relay, no internet, no server of any kind.',
localLinkCaveat: 'If it will not connect: most guest and public Wi-Fi networks stop devices from seeing each other. A personal hotspot has no such restriction. The safety phrase must read the same on both devices \u2014 if it does not, disconnect.',
linkHostBtn: 'Start a new link',
linkScanBtn: 'Scan their code',
linkScanStopBtn: 'Stop camera',
linkResetBtn: 'Disconnect and start over',
linkComposerPlaceholder: 'Message\u2026',
linkRoomBack: 'Back',
linkRoomPeople: 'People in the room',
linkRoomIdentity: 'Name and picture',
linkYourName: 'Your name in the room',
linkRoomNameLabel: 'Room name',
linkDissolveRoom: 'Dissolve the room',
linkBackToRoom: 'Back to the room',
linkBackToCall: 'Back to the call',
linkCallToChat: 'Back to the chat',
linkCallVoice: 'Voice call',
linkMoreActions: 'More actions',
linkCallJoin: 'Join',
linkCallDecline: 'Decline',
linkCallEnd: 'End call',
linkCallMute: 'Mute',
linkCallCamera: 'Camera',
linkVoiceSend: 'Send',
lanPairShow: 'Show address as QR',
lanPairScan: 'Read address from QR',
lanPairScanStop: 'Stop camera',
lanPairHide: 'Close',
lanPairHint: 'Have the other device read this with \u201cRead address from QR\u201d. Enough for the local network; no internet needed.',
authTitle: 'Two-factor code generator',
authIntro: 'TOTP codes are produced on this device and the secrets stay in the app\u2019s encrypted vault. Nothing is sent anywhere.',
authIssuerPlaceholder: 'Service (e.g. GitHub)',
authLabelPlaceholder: 'Account (e.g. your email)',
authSecretPlaceholder: 'base32 shared secret',
authAddBtn: 'Add account',
authUriLabel: 'Or paste an otpauth:// link',
authImportBtn: 'Import',
inspectorTitle: 'Hidden-character inspector',
inspectorIntro: 'Invisible characters can make every copy of a text unique, so a leak points back to whoever received it. Confusable letters make an address look like something it is not. This finds and removes both.',
inspectorInputLabel: 'Text to examine',
inspectorAuto: 'Check while typing',
inspectorRunBtn: 'Examine',
inspectorCleanBtn: 'Clean the text',
convertTitle: 'Convert bench',
convertIntro: 'Base64, hex, URL, binary — both directions, with the byte count. For when you are handling ciphertext by hand.',
convertInputPlaceholder: 'Input…',
convertRunBtn: 'Convert',
convertSwap: 'Swap direction',
convertTextBase64: 'Text → Base64',
convertBase64Text: 'Base64 → Text',
convertTextHex: 'Text → Hex',
convertHexText: 'Hex → Text',
convertTextUrl: 'Text → URL',
convertUrlText: 'URL → Text',
convertTextBinary: 'Text → Binary',
convertBinaryText: 'Binary → Text',
convertBase64Hex: 'Base64 → Hex',
convertHexBase64: 'Hex → Base64',
sshKeyEd25519: 'Ed25519 (recommended — fast and secure)',
sshKeyRsa: 'RSA (for older servers)',
sshRsa2048: '2048 bits',
sshRsa3072: '3072 bits',
sshRsa4096: '4096 bits',
chatLockMin1: '1 minute',
chatLockMin5: '5 minutes',
chatLockMin15: '15 minutes',
chatLockMin60: '60 minutes',
hashCheckerTitle: 'Check & Compare File Hash',
selectFileHash: 'Select file to check hash',
calculatedHash: 'Calculated Hash (SHA-256)',
expectedHash: 'Expected Hash (for comparison)',
deleteOriginal: 'Delete Original File',
deleteOriginalDesc: 'Auto remove file from app after successful processing',
encryptHistory: 'Encryption History',
decryptHistory: 'Decryption History',
historySearchPlaceholder: 'Search by name or algorithm...',
allAlgorithms: 'All algorithms',
sortDateDesc: 'Newest first',
sortDateAsc: 'Oldest first',
sortSizeDesc: 'Largest first',
sortSizeAsc: 'Smallest first',
sortNameAsc: 'Name: A to Z',
sortNameDesc: 'Name: Z to A',
date: 'Date',
size: 'Size',
name: 'Name',
noItemsFound: 'No items found',
tagLabel: 'Tag / Name',
tagPersonal: 'Personal',
tagWork: 'Work',
tagSecret: 'Secret',
tagFinancial: 'Financial',
descriptionOptional: 'Description (Optional)',
keyDetails: 'Key Details',
privateKeyHashed: 'Private Key (Hashed/Stored)',
downloadFormat: 'Download Private / Public Key',
bothFormats: 'Download all keys (ZIP)',
downloadKey: 'Download Key',
importPublicKey: 'Import Public Key',
tagLabelCustom: 'Tag (Custom Name)',
publicKeyString: 'Public Key String (Base64 / PEM)',
saveKey: 'Save Key',
algGCMOption: 'AES-256-GCM (Recommended)',
algChaChaOption: 'AES-192-GCM',
algCBCOption: 'AES-256-CBC (Legacy compatibility)',
algCTROption: 'AES-256-CTR (Streaming)',
algWarningStars: 'Legacy algorithms are kept only for opening older data.',
importKeyButton: 'Import Key',
algGCM: 'AES-256-GCM (Recommended)',
algCBC: 'AES-256-CBC (Legacy compatibility)',
algDesc1: 'AES-256-GCM is the safest and most appropriate default for most app workflows',
algWarningStarsHeavy: 'Legacy algorithms are removed from new workflows and remain only for backward compatibility.',
chunk1mb: '1 MB (Default - Speed/Memory balance)',
chunk512kb: '512 KB (Low memory)',
chunk5mb: '5 MB (Large files)',
chunk10mb: '10 MB (Max speed)',
chunkDesc: 'Larger chunks mean faster speed but higher memory usage',
nameOriginal: 'Original name + .poorija',
nameTimestamp: 'Date and Time',
nameRandom: 'Random ID',
nameCustom: 'Custom (Your prefix)',
customPrefixPlaceholder: 'Custom prefix...',
customMinute: 'Custom...',
customTheme: 'Custom Theme',
installApp: 'Install App',
installReady: 'Installable experience',
installHint: 'Install the app for a cleaner window, quick shortcuts, and offline-ready access.',
launchWebApp: 'Web App',
installUnavailable: 'App install is not available in this browser or context.',
appInstalled: 'App installed successfully.',
openMenu: 'Open menu',
closeMenu: 'Close menu',
customThemeSettings: 'Custom Theme Settings',
bgColor: 'Background Color',
cardColor: 'Cards Color',
textColor: 'Text Color',
primaryColor: 'Primary/Brand Color',
iconColor: 'Icon Color',
desktopIconProfile: 'Desktop Icon Profile',
desktopIconProfileDesc: 'On desktop builds you can switch between the main app icon, alternate themes, and a few low-attention visual profiles.',
iconProfileDefault: 'P00RIJA Shield',
iconProfileMidnight: 'Midnight Shield',
iconProfileLinen: 'Linen Shield',
iconProfileFolder: 'System-style Folder',
iconProfileNotes: 'System-style Notes',
iconProfileTerminal: 'System-style Terminal',
iconProfileSettings: 'System-style Settings',
desktopIconProfileHint: 'On Windows and Linux the window and taskbar icon change immediately. On macOS a window has no icon of its own and the Dock shows the bundle icon, so only the tray icon changes there. The installer icon always comes from the built bundle.',
tabOrder: 'Tab Order',
tabOrderDesc: 'Rearrange the sidebar tabs to match the workflow you use most.',
tabOrderDragHint: 'Drag any row to reorder faster. The up/down buttons are still available.',
resetTabOrder: 'Reset Default Order',
moveUp: 'Move Up',
moveDown: 'Move Down',
typographySettings: 'Typography Settings (Font & Size)',
fontFamilyFa: 'Persian Font',
fontFamilyEn: 'English Font',
textSize: 'Text Size',
sizeSmall: 'Small',
sizeNormal: 'Normal (Default)',
sizeLarge: 'Large',
adhocVoiceCall: 'Group voice call',
adhocVideoCall: 'Group video call',
addToCall: 'Add someone to the call',
pickCallPeople: 'Who should be on this call?',
startTheCall: 'Start the call',
convertHeicOnSend: 'Offer to convert HEIC photographs to JPEG',
vaultTab: 'File manager',
vaultOpenTab: 'Open the file manager',
vaultTitle: 'File manager',
vaultSetLock: 'Set a lock',
vaultOpen: 'Unlock',
vaultRemoveLock: 'Remove the lock',
vaultPassphrase: 'Passphrase (at least 8 characters)',
voiceTab: 'Voice changer',
voiceTitle: 'Voice changer',
voiceIntro: 'Give it an audio file or record here, pick a mode, then listen to the result and save it. All of it happens on this device.',
voiceRecord: 'Record',
voiceSave: 'Save the file',
sendDisguised: 'Send with the voice changed',
metadataTab: 'Metadata',
metadataTitle: 'File metadata',
metadataIntro: 'See what a file says about you, change it, or take it out entirely. The original is never written to; what you get is a copy.',
metadataStripAll: 'Clear everything',
metadataSave: 'Save a copy',
metadataLimits: 'Removing metadata does not remove sensor noise patterns, encoder fingerprints or similar traces.',
about: 'About Me',
githubProfile: 'GitHub Profile',
donateTitle: 'Support the project',
donateHint: 'If this has been useful, you can send TON from Telegram Wallet.',
copyAddress: 'Copy address',
addressCopied: 'Wallet address copied.',
openInWallet: 'Open in wallet',
showQr: 'Show QR',
hideQr: 'Hide QR',
emailAddress: 'Email Address',
aboutProject: 'About Project',
aboutProjectDesc: 'This cryptography suite is developed to provide a fully secure, client-side, browser-based environment for protecting personal data. None of your keys or data are ever sent to any server.',
textEncryption: 'Text Encryption',
migration: 'Migration',
steganography: 'Steganography',
fileShredder: 'File Shredder',
selfDestruct: 'Self-Destruct Messages',
textEncryptionTitle: 'Live Text Encryption',
textDecryptionTitle: 'Live Text Decryption',
passwordOrKey: 'Encryption Key',
enterTextKey: 'Enter the key...',
selectFromKeys: '-- Select from existing keys --',
plainText: 'Plain Text',
plainTextPlaceholder: 'Write your text here...',
encryptedText: 'Encrypted Text',
textEncHelp: 'This section encrypts text live. Every algorithm offered is authenticated: AES-GCM through Web Crypto, XChaCha20-Poly1305 in software. Nothing broken is on the list.',
exportData: 'Export Data',
exportDesc: 'Use this section when you plan to change your system. All public and private keys, generated passwords, and app settings along with the master key are exported.',
migrationPassword: 'Export File Password',
exportBtn: 'Export (.poorija-backup)',
importData: 'Import Data',
importDesc: 'Import your backup file (.poorija-backup). Note that this will overwrite the current app data and requires the password you set during export.',
migrationPasswordInput: 'Backup File Password',
importBtn: 'Import and Overwrite',
stegoHideTitle: 'Hide Text in Image',
stegoHideDesc: 'Hide your text (or encrypted text) within an image. The output image will look visually unchanged.',
stegoExtractTitle: 'Extract Text from Image',
fileShredderTitle: 'Secure File Shredder',
fileShredderDesc: 'This tool uses the File System Access API to overwrite the original file contents with zeroes so secure shredding is more reliable.',
fileShredderDescDesktop: 'On desktop builds this tool uses the native file picker, overwrites the chosen file, and then removes it from disk.',
readSelfDestruct: 'Open Self-Destruct Message',
sdViewLimit: 'View Limit',
sdOutput: 'Message Output (shareable)',
shredBtn: 'Start File Shredding',
advGeneratorBtn: 'Advanced Password Generator',
gplLicense: 'Licensed under AGPL v3.0',
gplLicenseNote: 'This application is licensed under AGPL v3.0. If you run it as a network service - its relay included - you must offer that same version\u2019s source to the people using it (section 13).',
copyText: 'Copy',
encryptedTextPlaceholder: 'Result will be displayed here...',
shredderSelectFile: 'Click to select the file you want to permanently erase from disk...',
shredderSelectFileDesktop: 'Click to choose the file you want to shred natively on this desktop device...',
stegoHideBtn: 'Hide and Download Image',
stegoExtractSelect: 'Select image with hidden text (PNG)...',
stegoExtractedText: 'Extracted Text',
stegoTextToHide: 'Text to hide',
stegoImageSelect: 'Select an image (PNG/JPG)...',
advGeneratorTitle: 'Advanced Password Generator',
advPassLength: 'Password Length',
advUpperChars: 'Uppercase (A-Z)',
advLowerChars: 'Lowercase (a-z)',
advNumbersChars: 'Numbers (0-9)',
advSymbolsChars: 'Symbols (!@#$)',
advPlacementRules: 'Character Placement Rules (Optional)',
advStartWith: 'Start with:',
advMiddleWith: 'Middle:',
advEndWith: 'End with:',
advAnyChar: 'Any character',
advOnlyLetters: 'Letters only',
advOnlyNumbers: 'Numbers only',
advOnlySymbols: 'Symbols only',
advSaveToList: 'Save to List',
fontFamilyFa: 'Persian Font',
fontFamilyEn: 'English Font',
textSize: 'Text Size',
sizeSmall: 'Small',
sizeNormal: 'Normal (Default)',
sizeLarge: 'Large',
typographySettings: 'Typography Settings (Font & Size)',
decryptionKey: 'Decryption Key',
answerPlaceholder: 'Answer...',
strongPasswordPlaceholder: 'Enter a strong password...',
backupSelectFile: 'Select the backup file...',
enterBackupPassword: 'Enter the password...',
dayShort: 'Day',
hourShort: 'Hour',
minuteShort: 'Minute',
secondShort: 'Second',
zeroForUnlimited: '0 for unlimited',
sdNoTimeLimitHint: 'A value of 0 for all fields means there is no time limit.',
sdViewHint: 'Each successful open counts as one view. Use 0 for unlimited views.',
sdBindToDevice: 'Open only on this installation',
sdBindToDeviceHint: 'If the key leaks by itself, the payload will not open on another installation. Turn this off only when you intentionally want cross-device opening.',
sdUseServerSync: 'Sync limits with server',
sdUseServerSyncHint: 'The key and text are never sent to the server; only expiry and view counters are stored there.',
sdServerUrl: 'Message control server',
sdServerUrlPlaceholder: 'https://host.example.com',
sdServerFallbackHint: 'If empty, the Secure Chat server URL will be used.',
sdReadServerUrl: 'Message control server',
sdReadServerUrlPlaceholder: 'Filled from the payload when available',
sdReadServerHint: 'For server-sync messages you can override the server manually; the key still stays on this client.',
enterSecureKeyPlaceholder: 'Enter a secure key...',
sensitiveTextPlaceholder: 'Write your sensitive text here...',
selfDestructOutputPlaceholder: 'Encrypted output will appear here...',
selfDestructPayload: 'Self-destruct message payload',
receivedPayloadPlaceholder: 'Paste the received payload here...',
decryptKeyPlaceholder: 'Enter the decryption key...',
openSelfDestructBtn: 'Open Message',
originalContent: 'Original Content',
createSelfDestructBtn: 'Create Self-Destruct Message',
privateSymmetricKeys: 'Private / Symmetric Keys',
publicKeysTitle: 'Public Keys',
noPublicKeys: 'No public keys received yet',
keyNamePlaceholder: 'Key Name',
tagNamePlaceholder: 'Tag Name',
importKeyDataPlaceholder: '...',
secureFileGuideTitle: 'File System Access API Guide:',
shredderChromeGuideHtml: '<b>Google Chrome / Edge:</b> This capability is enabled by default. If it does not work, visit <code>chrome://flags</code> or <code>edge://flags</code> and enable <b>File System Access API</b>.',
shredderFirefoxGuideHtml: '<b>Firefox / Safari:</b> These browsers still do not fully support this API.',
shredderWarningHtml: 'Important: after shredding finishes, the file becomes empty but is not removed from disk. For final removal, delete the emptied file manually (Shift+Delete).',
shredderDesktopSuccess: 'The file was overwritten and removed from disk by the desktop runtime.',
recentUpdatesTitle: 'What is New in Version 2.99',
updatePasskeyHtml: '<b>Passkey / Biometric Unlock:</b> Faster app unlock with WebAuthn passkeys on supported devices and browsers.',
updateSecureShareHtml: '<b>Secure Share:</b> Create encrypted links or bundles for text, secure notes, small files, and public keys with expiry and view limits.',
updateSignaturesHtml: '<b>Digital Signatures:</b> Sign and verify text or files with ECDSA and RSA-PSS.',
updateSecurityCenterHtml: '<b>Security Center:</b> Review passkey, 2FA, backups, weak passwords, and legacy-key hygiene in one place.',
updateWizardHtml: '<b>Smart Wizard & Secure Notes:</b> Guided scenarios for common tasks plus secure notes that can be shared as encrypted bundles.',
updateSecureChatHtml: '<b>Secure Chat:</b> Mobile-first encrypted chat with relay queues, TURN, Web Push, voice messages, timed messages, ticks, and voice/video calls.',
updateDesktopHtml: '<b>PWA:</b> Installable web app support, service worker caching, and responsive dashboard navigation.',
secureChatGuideTitle: 'Secure Chat Guide',
chatGuideConnectHtml: '<b>Connection:</b> Server URL is the same HTTPS origin that serves the app. When Docker runs with the TURN profile, the app can read TURN URL/User/Password from /turn-config.',
chatGuideSessionHtml: '<b>Sending:</b> The first message automatically creates the RSA -> AES-GCM secure session; users do not need to press the key button first.',
chatGuideOfflineHtml: '<b>Offline:</b> The relay stores only encrypted payloads and generic Push alerts; message text is not readable by the server.',
chatGuideCallsHtml: '<b>Calls:</b> For real internet use, configure TURN with a public domain/IP. Temporary ICE disconnects no longer end calls immediately; only failed/closed states do.',
recommendedWorkflowsTitle: 'Recommended Workflows',
workflowEncryptSelfHtml: '<b>Encrypting for yourself:</b> Use the Wizard card for Encrypt for Myself to preconfigure AES-256-GCM with password mode.',
workflowShareHtml: '<b>Sending to someone else:</b> Use Secure Share or File Encrypt with RSA-OAEP-3072/4096 and the recipient public key.',
workflowSignHtml: '<b>Need authenticity:</b> Create a text/file signature in Digital Signatures, then verify it on the receiving side.',
workflowHealthHtml: '<b>Need a quick risk review:</b> Open Security Center to inspect passkey, 2FA, backups, and legacy records at a glance.',
importKeyDropHtml: '<span class="font-semibold">Choose file</span> or drag and drop',
jsonFileLabel: 'JSON',
saveTag: 'Save Tag',
downloadPublicKeyJson: 'Download Public Key (JSON)',
downloadPrivateKeyJson: 'Download Private Key (JSON)',
fontFaDefaultOption: 'Vazirmatn (Default)',
fontEnDefaultOption: 'Inter (Default)',
tagFriends: 'Friends',
unlockWithPasskey: 'Unlock with Passkey / Biometric',
smartWizard: 'Smart Wizard',
wizardDesc: 'Choose the real-world scenario and let the app prepare the safest flow instead of configuring raw settings manually.',
wizardHint: 'Each card opens the right workspace and preloads the most sensible defaults for that task.',
scenarioEncryptSelf: 'Encrypt for myself',
scenarioEncryptSelfDesc: 'Prepares AES-GCM and password protection as the default personal flow.',
scenarioEncryptShare: 'Send to someone else',
scenarioEncryptShareDesc: 'Prepares hybrid RSA and public-key selection for secure delivery.',
scenarioShareLink: 'Create secure link',
scenarioShareLinkDesc: 'Builds an encrypted link or bundle for text, small files, public keys, or notes.',
scenarioSignVerify: 'Sign and verify',
scenarioSignVerifyDesc: 'Takes you to the digital-signature workspace for authenticity checks.',
scenarioSecureNote: 'Secure note',
scenarioSecureNoteDesc: 'Create an encrypted private note with bundle-ready content for safe sharing.',
scenarioSelfDestruct: 'Self-destruct message',
scenarioSelfDestructDesc: 'Prepares the temporary-message flow for sensitive or short-lived content.',
securityCenter: 'Security Center',
securityCenterDesc: 'Review the current health of the app, keys, passwords, backups, 2FA, and passkey setup in one place.',
refreshHealth: 'Refresh health',
secureShare: 'Secure Share',
secureChat: 'Secure Chat',
disconnected: 'Disconnected',
searchInChats: 'Search chats and messages',
searchEverywhere: 'Search everywhere',
searchInThisChat: 'Search in this chat',
deleteConversation: 'Delete conversation',
lockThisChat: 'Lock this chat',
unlockWithBiometric: 'Biometric',
chatLockedNow: 'This conversation is locked.',
chatLockNeedsPin: 'Set a PIN for this conversation first.',
createSecureSession: 'Create secure session',
voiceCall: 'Voice call',
endCall: 'End call',
backToChat: 'Back to chat / floating mode',
activeCall: 'Active call',
connecting: 'Connecting...',
secureShareDesc: 'Create encrypted links or bundles for text, notes, small files, or public keys.',
shareType: 'Content type',
shareTypeText: 'Text',
shareTypeNote: 'Secure note',
shareTypeFile: 'File',
shareTypePublicKey: 'Public key',
shareContent: 'Content',
shareContentPlaceholder: 'Enter the sensitive content here...',
selectNote: 'Select note',
shareFileSelect: 'Select a file to build a secure bundle or link...',
selectPublicKeyToShare: 'Public key to share',
sharePassword: 'Share password',
sharePasswordPlaceholder: 'Enter a secure password',
expiryHours: 'Expiry (hours)',
maxViews: 'Maximum views',
shareRecipientKey: 'Recipient public key',
generateSecureShare: 'Generate secure link / bundle',
generatePasswordShort: 'Generate password',
shareClientOnlyHint: 'Because this app is fully client-side, view limits and revoke behave as recipient-side/browser-side controls, not server-enforced ones.',
shareOutput: 'Secure share output',
downloadBundle: 'Download bundle',
openSecureShare: 'Open secure link / bundle',
secureShareInputPlaceholder: 'Paste the secure link or bundle here...',
shareOpenPrivateKey: 'RSA private key for opening',
openSecureShareBtn: 'Open',
secureNotes: 'Secure Notes',
previewNote: 'Preview',
newNote: 'New note',
noteTitle: 'Title',
noteBody: 'Body',
noteAttachmentOptional: 'Text/bundle attachment (optional)',
noteAttachmentPlaceholder: 'You can store extra text, JSON, or a small bundle here...',
saveSecureNote: 'Save secure note',
shareThisNote: 'Share this note',
digitalSignatures: 'Digital Signatures',
signatureDesc: 'Sign and verify text or files so recipients can confirm origin and integrity.',
newSignatureKey: 'New signature key',
signContent: 'Sign content',
signatureMode: 'Mode',
selectSigningKey: 'Signing key',
signatureFileSelect: 'Select a file to sign...',
signatureTextPlaceholder: 'Enter the text that should be signed...',
createSignature: 'Create signature',
verifySignatureTitle: 'Verify signature',
selectVerificationKey: 'Verification key',
signatureVerifyFileSelect: 'Select the original file for verification...',
signatureBundlePlaceholder: 'Paste the signature or signature bundle here...',
verifySignatureBtn: 'Verify signature',
signatureKeysTitle: 'Digital signature keys',
noSignatureKeys: 'No signature keys created yet',
passkeyQuickUnlock: 'Passkey / Biometric Quick Unlock',
passkeyDisabled: 'Not enabled yet',
setupPasskey: 'Set up',
passkeyHint: 'On the web this feature uses Passkeys and WebAuthn, while desktop builds use the device\'s native local authentication for quick unlock.',
passkeyHintDesktop: 'On desktop this section uses the operating system\'s local authentication flow and secure store; if your device supports Touch ID, Windows Hello, or an equivalent method, it can be used for quick unlock.',
passkeyHintMobile: 'On Android the master password sits under a key created inside the Android Keystore, and on iOS inside the Keychain; neither hands it back without a fingerprint or a face. Enrolling a new finger or face invalidates what was stored, and the password has to be entered once more.',
updateCheckNow: 'Check for updates',
updateCheckAuto: 'Check automatically at launch',
updateCheckNote: 'This is the only request the app makes without you asking. It asks GitHub for the latest version number and sends nothing about you.',
upTitle: 'Notifications without Google (UnifiedPush)',
upDesc: 'A distributor app you install and choose holds the socket, and the relay posts to the address it hands out. Google is not in the path.',
upConnect: 'Connect',
upDisconnect: 'Disconnect',
upConnected: 'connected',
upNotConnected: 'not connected',
upConnectedNow: 'Connected. Messages will wake the phone from now on.',
upDisconnected: 'Disconnected.',
upNoDistributor: 'No distributor app is installed on this phone. Install ntfy from F-Droid or Play, then come back here.',
upNoEndpoint: 'The distributor has not handed out an address yet. Check that app can reach the internet and try again.',
upFailed: 'Could not reach the distributor',
pushRelayTooOld: 'This relay has no push support. Update the server to 2.44.0 or newer.',
pushRelayRefused: 'The relay refused the push request',
pushNotARelay: 'That address does not answer as a relay. Check the server address in Chat settings.',
pushRelayUnreadable: 'The relay\'s answer could not be read',
upPollDesc: 'If you will not install a distributor: look every fifteen minutes instead. It is slower, it costs battery, and it makes a traffic pattern where there was none.',
upWhatIsNtfy: 'ntfy is a small open-source app that does one thing: it holds a connection open and tells this app when something arrives. It never sees your messages — the relay sends nothing but the fact that something came.',
upNtfyNoAccount: 'Installing it is enough. No account, nothing to configure.',
stickerPacks: 'Sticker packs',
managePacks: 'Manage packs',
stickerPacksHint: 'Rename packs, put them in the order you want, or select several and clear them out together. That order is the one the sticker panel shows.',
desktopBiometricPromptTitle: 'Enable biometric quick unlock',
desktopBiometricPromptSubtitle: 'If your device supports it, you can unlock faster with local verification similar to desktop messengers.',
desktopBiometricPromptBody: 'If this desktop runtime and device support local authentication, the app can store your master password in the system secure store and unlock it faster with Touch ID or local verification. Do you want to enable it now?',
desktopBiometricEnableNow: 'Enable now',
desktopBiometricLater: 'Later',
desktopBiometricChecking: 'Checking availability...',
desktopBiometricAvailable: 'Available on this device',
desktopBiometricUnavailable: 'Unavailable in this desktop runtime',
desktopBiometricEnabled: 'Enabled and ready',
desktopBiometricWebOnly: 'Runtime icon switching is available only in the desktop build',
yourChatIdentity: 'Your Identity in Chat',
peerIdLabel: 'Peer ID',
securityKeyLabel: 'Security Key',
copyFullIdentity: 'Copy Full Identity',
showQrCode: 'Show QR code',
startChat: 'Start Chat',
profilePicture: 'Profile Picture',
changeProfilePicture: 'Change profile picture',
defaultAvatar: 'Default avatar',
selectFromGallery: 'Select from gallery / file',
rotateLeft: 'Rotate left',
rotateRight: 'Rotate right',
zoom: 'Zoom',
avatarMoveX: 'Move horizontally',
avatarMoveY: 'Move vertically',
avatarWidth: 'Image width',
avatarHeight: 'Image height',
avatarFilter: 'Filter',
filterNone: 'No filter',
filterMono: 'Black and white',
filterWarm: 'Warm',
filterVivid: 'Vivid',
filterNoir: 'Contrast',
applyCrop: 'Apply crop',
cancelEdit: 'Cancel edit',
saveAvatar: 'Save',
displayName: 'Display name',
saveProfile: 'Save Profile',
resetKey: 'Reset Key',
connectionSettingsTitle: 'Connection & TURN Settings',
relayServerUrl: 'Relay Server URL',
secureChatSwitch: 'Secure Chat',
secureChatOffNotice: 'Secure chat is off. To connect, enter and save a server address, import a config file, or read the address from a QR code.',
exportRelayConfig: 'Export Connection Config',
importRelayConfig: 'Import Config File',
exportPortableProfile: 'Export Portable Profile',
importPortableProfile: 'Import Portable Profile',
linuxCallsNotice: 'Due to a Linux limitation — WebKitGTK\'s unstable WebRTC support — audio, video and group calls are unavailable in this build. Use the PWA for calls: carry your identity over with the Portable Profile and call from your browser as the same person.',
openPwaForCalls: 'Open the PWA in your browser (for calls)',
autoConnect: 'Auto Connect',
videoCall: 'Video Call',
localDiscovery: 'Local Discovery',
suspensionCountdown: 'Suspension Countdown',
callRingtone: 'Call Ringtone',
messageSound: 'Message Sound',
turnServerUrl: 'TURN Address',
turnUsername: 'TURN Username',
turnCredential: 'TURN Password',
turnHelpNote: 'TURN username and password are the same as `TURN_USER` and `TURN_PASSWORD` in your `.env` or `docker-compose.env.example`. For users outside the network, Server URL and TURN must be public accessible domains/IPs.',
connect: 'Connect',
reconnect: 'Reconnect',
discoverLocal: 'Discover Local',
testRingtone: 'Test Ringtone',
testMessageTone: 'Test Message Tone',
chats: 'Chats',
calls: 'Calls',
groups: 'Groups',
connection: 'Connection',
newGroupName: 'New group name',
ringtoneClassic: 'Classic',
ringtonePulse: 'Soft pulse',
ringtoneSignal: 'Quick signal',
ringtoneSoft: 'Gentle chime',
toneChime: 'Short chime',
tonePop: 'Soft pop',
tonePing: 'Quick ping',
toneBell: 'Gentle bell',
toneSilent: 'Silent',
online: 'Online',
noPeersFound: 'No users found yet.',
backToChatList: 'Back to chat list',
selectAConversation: 'Select a conversation',
secure: 'Secure',
chatStartHint: 'Select an online user or local space to start.',
activeCallInProgress: 'Active call in progress',
returnToCall: 'Return to call',
chatMessagesHint: 'Messages will appear here after starting a secure session.',
ready: 'Ready',
recording: 'Recording...',
pause: 'Pause',
finish: 'Finish',
deleteRecording: 'Delete recording',
discardDraft: 'Discard draft',
send: 'Send',
sendFile: 'Send file',
sendFromGallery: 'Photos & videos',
callBackdrop: 'Video backdrop',
callBackdropBlur: 'Blurred frame',
callBackdropDark: 'Flat black — no motion (default)',
voiceMessage: 'Voice message',
chatPlaceholder: 'Your secure message...',
selfDestructMessage: 'Self-destruct message',
hiddenMessage: 'Hidden message',
stickers: 'Stickers',
createPoll: 'Poll',
selectedCount: 'selected',
copy: 'Copy',
forward: 'Forward',
vaultBackupTitle: 'Full vault backup',
vaultBackupDesc: 'One file that takes everything: keys, passwords, notes, settings, conversations and contacts, sticker packs, custom sounds, and every stored file and voice message. Sealed with Argon2id and AES-256-GCM, and restorable onto any other device.',
vaultBackupMake: 'Create a backup',
vaultBackupPass: 'Backup file password (at least 8 characters)',
vaultBackupPass2: 'Repeat the password',
vaultBackupBtn: 'Create backup file',
vaultRestoreTitle: 'Restore',
vaultRestorePass: 'Backup file password',
vaultRestoreBtn: 'Restore from backup',
chatPreviewName: 'Preview',
chatPreviewState: 'online',
chatPreviewIn1: 'Hello! This is a live preview.',
chatPreviewOut1: 'Change anything and you see it here.',
chatPreviewOut2: 'Delivered, not opened yet.',
chatPreviewIn2: 'Read it now.',
chatPreviewOut3: 'And this one has been read.',
chatThemeLabel: 'Chat theme',
chatBubbleSection: 'Message bubble',
chatBubbleMine: 'My bubble',
chatBubbleTheirs: 'Their bubble',
chatBubbleAlpha: 'Bubble opacity',
chatBubbleRadius: 'Corner rounding',
chatZoom: 'Chat text size',
chatBackgroundSection: 'Chat background',
chatBackgroundBlur: 'Background blur',
chatBackgroundUpload: 'Your own picture',
chatBackgroundClear: 'Remove picture',
chatBackgroundNote: 'Your own picture stays on this device inside this profile and is never sent anywhere.',
chatTickSection: 'Message ticks',
chatAppearanceReset: 'Reset the whole appearance',
chatAppearanceTitle: 'Chat appearance',
chatAppearanceProfile: 'Appearance profile',
chatTickSent: 'Sent (one tick)',
chatTickDelivered: 'Delivered (two ticks)',
chatTickSeen: 'Read',
chatTickReset: 'Back to theme colours',
chatTickPreviewText: 'Sample message',
chatTickNote: 'The colours are shown on your own message bubble. The contrast each one achieves is printed beside the button; below 3:1 the tick is hard to read on this theme.',
chatLockTitle: 'Shared section lock',
chatLockEnable: 'Shared lock for Files, Secure Chat and Settings',
chatLockAuto: 'Auto-lock after',
chatLockNever: 'Never',
chatLockNote: 'This lock is shared with Files and Settings. Leaving protected sections locks them again.',
chatLockedTitle: 'Chat is locked',
chatLockedBody: 'Enter your chat PIN to see your conversations.',
chatPin: 'Chat PIN',
chatPinWrong: 'Wrong PIN.',
unlock: 'Unlock',
verifyKey: 'Verify key',
groupInfo: 'Group info',
joinByInvite: 'Join with an invite code',
shareLocation: 'Share location',
shareContact: 'Contact card',
pollQuestion: 'Poll question…',
pollAddOption: 'Option',
pollMulti: 'Multiple choice',
pollSend: 'Send poll',
moreOptions: 'More options',
more: 'More',
e2eeCall: 'End-to-end encrypted',
sssTitle: 'Shamir Secret Sharing',
sssIntro: 'Split a secret (a key, a recovery phrase, a master password) into several shares. Any number of them up to the threshold reveals nothing; the threshold rebuilds it exactly. Everything is computed on this device.',
sssSplitTitle: '1) Split',
sssSecretLabel: 'Secret',
sssSecretPlaceholder: 'Recovery phrase or key…',
sssThreshold: 'Threshold (K)',
sssTotal: 'Shares (N)',
sssSplitBtn: 'Split',
sssCombineTitle: '2) Rebuild',
sssSharesLabel: 'Shares (one per line)',
sssCombineBtn: 'Rebuild',
sssRecovered: 'Recovered secret',
argon2Title: 'Argon2id — password hashing and key derivation',
argon2Intro: 'The Password Hashing Competition winner. Unlike PBKDF2 it also demands memory, which is what makes GPU cracking expensive. Runs entirely on this device.',
argon2Password: 'Password',
argon2Preset: 'Cost level',
argon2Interactive: 'Interactive — 19 MB, 2 passes',
argon2Moderate: 'Moderate — 64 MB, 3 passes',
argon2Sensitive: 'Sensitive — 256 MB, 4 passes',
argon2HashBtn: 'Compute hash',
argon2Output: 'Output (standard PHC encoding)',
argon2VerifyLabel: 'Verify: paste an existing hash here',
argon2VerifyBtn: 'Check against the password above',
importStickers: 'Import stickers',
localVaultTitle: 'Encrypted local vault',
localVaultNote: 'Files, voice messages and stickers are encrypted with AES-256-GCM and stored on this device so they still open after a refresh. The vault key is protected by your master password and never leaves the device.',
clearOldMedia: 'Clear older than 30 days',
clearAllMedia: 'Clear all media',
clearAllStickers: 'Delete all packs',
refresh: 'Refresh',
manageStickers: 'Manage packs',
importSound: 'Custom sound',
removeSound: 'Remove custom sound',
chatDiagTitle: 'Chat status report',
pruneContacts: 'Remove unused contacts',
composerActions: 'Message options',
timerOff: 'No timer',
timer10s: '10s',
timer30s: '30s',
timer1m: '1m',
timer5m: '5m',
timer30m: '30m',
timer1h: '1h',
timer10h: '10h',
secureSession: 'Secure session',
waitingForSecureSession: 'Waiting for secure session',
remoteKey: 'Remote key',
speaker: 'Speaker',
hold: 'Hold',
mute: 'Mute',
flip: 'Flip',
video: 'Video',
screenShare: 'Present',
present: 'Present',
reactions: 'React',
raiseHand: 'Raise hand',
callLayout: 'Layout',
secureChatSettings: 'Settings',
fileManagerTitle: 'Local file manager',
end: 'End',
pwaWarningTitle: 'Attention',
pwaWarningContent: 'Warning:\nDue to the nature of this application, all encryption and decryption of texts and files, as well as the creation and processing of Peer-to-Peer chat sessions, are performed entirely client-side. Therefore, it is highly recommended to use the Desktop PWA version or native versions suitable for your operating system. This decision has been made due to the security nature and sensitivity of maintaining information confidentiality.\nRegarding mobile devices, especially older ones, there is a possibility of issues such as overheating, rapid battery drain, and occasional responsiveness delays. This warning serves as an acceptance of these risks when using the application on mobile devices.'
}
};
function getTranslatedText(key, fallback = '') {
return translations[state.language]?.[key] || fallback || key;
}
const PASSKEY_STORAGE_KEY = 'poorija_passkey_quick_unlock';
/* The 'presence' fallback strategy seals the master password with this local
   key — same device, same browser profile, nothing transmitted. */
const PASSKEY_LOCAL_WRAP_KEY = 'poorija_passkey_local_wrap';
const DESKTOP_BIOMETRIC_PROMPT_KEY = 'poorija_desktop_biometric_prompted';
const DESKTOP_RUNTIME_CLASS = 'desktop-runtime';
const NOTES_STORAGE_KEY = 'poorija_secure_notes';
const SHARE_HISTORY_STORAGE_KEY = 'poorija_share_history';
const SIGNATURE_HISTORY_STORAGE_KEY = 'poorija_signature_history';
const STORAGE_KEY_SALT_STORAGE_KEY = 'poorija_storage_key_salt_v3';
const SHARE_TARGET_CACHE_KEY = './__share_target__/latest';
const PASSKEY_PRF_SALT = new Uint8Array([80, 48, 48, 82, 73, 74, 65, 45, 80, 82, 70, 45, 83, 65, 76, 84]);
const PASSKEY_LARGE_BLOB_VERSION = 1;
const SIGNATURE_ALGORITHMS = {
'ECDSA-P256': {
id: 'ECDSA-P256',
purpose: 'signature',
displayName: 'ECDSA P-256',
generateParams: { name: 'ECDSA', namedCurve: 'P-256' },
usages: ['sign', 'verify'],
publicFormat: 'spki',
privateFormat: 'pkcs8',
verifyParams: { name: 'ECDSA', hash: 'SHA-256' },
signParams: { name: 'ECDSA', hash: 'SHA-256' }
},
'ECDSA-P384': {
id: 'ECDSA-P384',
purpose: 'signature',
displayName: 'ECDSA P-384',
generateParams: { name: 'ECDSA', namedCurve: 'P-384' },
usages: ['sign', 'verify'],
publicFormat: 'spki',
privateFormat: 'pkcs8',
verifyParams: { name: 'ECDSA', hash: 'SHA-384' },
signParams: { name: 'ECDSA', hash: 'SHA-384' }
},
'RSA-PSS-3072': {
id: 'RSA-PSS-3072',
purpose: 'signature',
displayName: 'RSA-PSS 3072',
generateParams: {
name: 'RSA-PSS',
modulusLength: 3072,
publicExponent: new Uint8Array([1, 0, 1]),
hash: 'SHA-256'
},
usages: ['sign', 'verify'],
publicFormat: 'spki',
privateFormat: 'pkcs8',
verifyParams: { name: 'RSA-PSS', saltLength: 32 },
signParams: { name: 'RSA-PSS', saltLength: 32 }
}
};
const DESKTOP_ICON_PROFILES = {
'poorija-default': {
previewPath: 'assets/desktop-icons/poorija-default.svg'
},
'poorija-midnight': {
previewPath: 'assets/desktop-icons/poorija-midnight.svg'
},
'poorija-linen': {
previewPath: 'assets/desktop-icons/poorija-linen.svg'
},
'system-folder': {
previewPath: 'assets/desktop-icons/system-folder.svg'
},
'system-notes': {
previewPath: 'assets/desktop-icons/system-notes.svg'
},
'system-terminal': {
previewPath: 'assets/desktop-icons/system-terminal.svg'
},
'system-settings': {
previewPath: 'assets/desktop-icons/system-settings.svg'
}
};
const SIDEBAR_TAB_DEFINITIONS = [
{ id: 'encrypt', labelKey: 'encrypt' },
{ id: 'decrypt', labelKey: 'decrypt' },
{ id: 'chat', labelKey: 'secureChat' },
{ id: 'selfdestruct', labelKey: 'selfDestruct' },
{ id: 'keys', labelKey: 'keyManagement' },
{ id: 'passwords', labelKey: 'passwords' },
{ id: 'sshkeys', labelKey: 'sshKeyManager' },
{ id: 'stego', labelKey: 'steganography' },
{ id: 'textencrypt', labelKey: 'textEncryption' },
{ id: 'share', labelKey: 'secureShare' },
{ id: 'notes', labelKey: 'secureNotes' },
{ id: 'signatures', labelKey: 'digitalSignatures' },
{ id: 'locallink', labelKey: 'localLinkTab' },
{ id: 'qrbridge', labelKey: 'qrBridge' },
{ id: 'authenticator', labelKey: 'authenticator' },
{ id: 'hash', labelKey: 'hashChecker' },
{ id: 'inspector', labelKey: 'inspector' },
{ id: 'convert', labelKey: 'converter' },
{ id: 'metadata', labelKey: 'metadataTab' },
{ id: 'voice', labelKey: 'voiceTab' },
{ id: 'shredder', labelKey: 'fileShredder' },
{ id: 'vault', labelKey: 'vaultTab' },
{ id: 'settings', labelKey: 'settings' },
{ id: 'migration', labelKey: 'migration' },
{ id: 'wizard', labelKey: 'smartWizard' },
{ id: 'securitycenter', labelKey: 'securityCenter' },
{ id: 'help', labelKey: 'help' },
{ id: 'about', labelKey: 'about' }
];
/* The hardcoded list above silently missed `sshkeys`, so that tab could not be
   reordered and did not even appear in the customiser. The sidebar itself is
   the source of truth for what tabs exist, so read it: anything added to the
   nav in future shows up here without a second edit. The static list stays as
   the preferred ordering and as a fallback before the DOM is ready. */
function discoverSidebarTabs() {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return SIDEBAR_TAB_DEFINITIONS.slice();
  const found = [];
  nav.querySelectorAll('button[id^="tab-"]').forEach((button) => {
    const id = button.id.replace(/^tab-/, '');
    if (!id || found.some((tab) => tab.id === id)) return;
    const known = SIDEBAR_TAB_DEFINITIONS.find((tab) => tab.id === id);
    found.push(known || {
      id,
      labelKey: button.querySelector('[data-i18n]')?.getAttribute('data-i18n') || id,
      icon: button.querySelector('i')?.className || '',
    });
  });
  if (!found.length) return SIDEBAR_TAB_DEFINITIONS.slice();
  /* Keep the curated order for tabs we know about, then append any newcomer in
     the order the markup lists it. */
  const curated = SIDEBAR_TAB_DEFINITIONS.filter((tab) => found.some((item) => item.id === tab.id));
  const extras = found.filter((item) => !curated.some((tab) => tab.id === item.id));
  return curated.concat(extras);
}
function sidebarTabDefinitions() {
  return discoverSidebarTabs();
}
function getDefaultTabOrder() {
return sidebarTabDefinitions().map((tab) => tab.id);
}
function normalizeTabOrder(order) {
const ordered = Array.isArray(order) ? order.filter((id) => getDefaultTabOrder().includes(id)) : [];
const deduped = [...new Set(ordered)];
getDefaultTabOrder().forEach((id) => {
if (!deduped.includes(id)) {
deduped.push(id);
}
});
return deduped;
}
const ALLOWED_KEY_METHODS = ['password', 'publicKey'];
const ALLOWED_PBKDF2_HASHES = ['SHA-256', 'SHA-384', 'SHA-512'];
const ALLOWED_SALT_LENGTHS = [16, 24, 32];
const ALLOWED_GCM_TAG_LENGTHS = [128, 120, 112, 96];
const ALLOWED_CTR_COUNTER_LENGTHS = [64, 96, 128];
function normalizeIntegerSetting(value, fallback, allowedValues = []) {
const parsed = parseInt(value, 10);
if (allowedValues.length > 0) {
return allowedValues.includes(parsed) ? parsed : fallback;
}
return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function normalizeHashSetting(value, fallback = 'SHA-256') {
return ALLOWED_PBKDF2_HASHES.includes(value) ? value : fallback;
}
function normalizeKeyMethodSetting(value, fallback = 'password') {
return ALLOWED_KEY_METHODS.includes(value) ? value : fallback;
}
function normalizeEncryptionPreferences(record = {}) {
return {
defaultKeyMethod: normalizeKeyMethodSetting(record.defaultKeyMethod, 'password'),
pbkdf2Iterations: normalizeIntegerSetting(record.pbkdf2Iterations, 600000),
pbkdf2Hash: normalizeHashSetting(record.pbkdf2Hash, 'SHA-256'),
saltLength: normalizeIntegerSetting(record.saltLength, 16, ALLOWED_SALT_LENGTHS),
gcmTagLength: normalizeIntegerSetting(record.gcmTagLength, 128, ALLOWED_GCM_TAG_LENGTHS),
ctrCounterLength: normalizeIntegerSetting(record.ctrCounterLength, 64, ALLOWED_CTR_COUNTER_LENGTHS),
aadContext: String(record.aadContext || '').trim(),
rsaOaepLabel: String(record.rsaOaepLabel || '').trim()
};
}
function getSettingsEncryptionPreferences() {
return normalizeEncryptionPreferences(state.settings);
}
function getEncryptTabEncryptionPreferences() {
const defaults = getSettingsEncryptionPreferences();
return normalizeEncryptionPreferences({
defaultKeyMethod: document.getElementById('keyMethod')?.value || defaults.defaultKeyMethod,
pbkdf2Iterations: document.getElementById('encIterations')?.value || defaults.pbkdf2Iterations,
pbkdf2Hash: document.getElementById('encKdfHash')?.value || defaults.pbkdf2Hash,
saltLength: document.getElementById('encSaltLength')?.value || defaults.saltLength,
gcmTagLength: document.getElementById('encGcmTagLength')?.value || defaults.gcmTagLength,
ctrCounterLength: document.getElementById('encCtrCounterLength')?.value || defaults.ctrCounterLength,
aadContext: document.getElementById('encAadContext')?.value || defaults.aadContext,
rsaOaepLabel: document.getElementById('encRsaLabel')?.value || defaults.rsaOaepLabel
});
}
function getEnvelopeEncryptionPreferences(envelope = {}) {
const defaults = getSettingsEncryptionPreferences();
const saltBytes = envelope.salt || envelope.s;
return normalizeEncryptionPreferences({
defaultKeyMethod: envelope.keyProtection === 'rsa-wrapped' ? 'publicKey' : defaults.defaultKeyMethod,
pbkdf2Iterations: envelope.iterations || envelope.it || defaults.pbkdf2Iterations,
pbkdf2Hash: envelope.kdfHash || defaults.pbkdf2Hash,
saltLength: Array.isArray(saltBytes) ? saltBytes.length : defaults.saltLength,
gcmTagLength: envelope.tagLength || defaults.gcmTagLength,
ctrCounterLength: envelope.ctrCounterLength || defaults.ctrCounterLength,
aadContext: envelope.aad || defaults.aadContext,
rsaOaepLabel: envelope.oaepLabel || defaults.rsaOaepLabel
});
}
function encodeAadContext(aadContext) {
const normalized = String(aadContext || '').trim();
return normalized ? new TextEncoder().encode(normalized) : null;
}
function isSignatureAlgorithmId(id) {
return Boolean(SIGNATURE_ALGORITHMS[id]);
}
function getSignatureConfig(id) {
return SIGNATURE_ALGORITHMS[id] || SIGNATURE_ALGORITHMS['ECDSA-P256'];
}
function arrayBufferToBase64Url(buffer) {
return arrayBufferToBase64(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlToArrayBuffer(base64url) {
const normalized = String(base64url || '').replace(/-/g, '+').replace(/_/g, '/');
const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
return base64ToArrayBuffer(normalized + padding);
}
function uint8ArrayToHex(bytes) {
return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function evaluatePasswordStrengthScore(password) {
return Object.values({
length: password.length >= 8,
upper: /[a-z]/.test(password) && /[A-Z]/.test(password),
number: /[0-9]/.test(password),
special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
}).filter(Boolean).length;
}
function getPasskeyRecord() {
try {
return JSON.parse(localStorage.getItem(PASSKEY_STORAGE_KEY) || 'null');
} catch (error) {
return null;
}
}
function setPasskeyRecord(record) {
localStorage.setItem(PASSKEY_STORAGE_KEY, JSON.stringify(record));
}
function detectBrowserFamily() {
const ua = navigator.userAgent || '';
if (/Edg\//.test(ua)) return 'edge';
if (/OPR\//.test(ua)) return 'opera';
if (/Firefox\//.test(ua)) return 'firefox';
if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return 'chromium';
if (/Safari\//.test(ua)) return 'safari';
return 'unknown';
}
window.addEventListener('resize', () => window.updateViewportHeight?.());
window.visualViewport?.addEventListener('resize', () => window.updateViewportHeight?.());
window.updateViewportHeight?.();
function isNativeMobileShell() {
return Boolean(window.__POORIJA_NATIVE_MOBILE__);
}
function isMobileBrowserContext() {
// Layout question, not a device question: this feeds the mobile-browser-context
// class, whose ~900 rules all assume a single-column phone screen. Answer it
// with the same 1024px breakpoint the stylesheet uses. isTouchDevice() below
// covers the cases that really are about the hardware. The phone shell is
// always the answer yes: its webview can report a wide layout viewport, and
// a phone running the desktop layout was exactly what the screenshots showed.
return isNativeMobileShell() || window.innerWidth < 1024;
}
function isTouchDevice() {
const isIpadOs = (navigator.maxTouchPoints || 0) > 1 && /MacIntel/i.test(navigator.platform || '');
return isIpadOs || (navigator.maxTouchPoints || 0) > 0
|| /Android|webOS|iPhone|iPad|iPod|Mobile|CriOS/i.test(navigator.userAgent || '');
}
function isStandaloneWebApp() {
/* The phone shells are installed apps in every way that matters: they live
   outside a browser, they keep the safe-area insets, and every
   pwa-standalone-keyed rule in the stylesheet describes exactly them.
   An installed-home-screen PWA and the native phone build must look alike —
   the user compared the two side by side and they did not. */
if (isNativeMobileShell()) return true;
return window.matchMedia('(display-mode: standalone)').matches
|| window.navigator.standalone === true
|| document.referrer.includes('android-app://')
|| window.matchMedia('(display-mode: window-controls-overlay)').matches;
}
function isFirefoxWindowsInstallable() {
return detectBrowserFamily() === 'firefox' && /Windows/i.test(navigator.userAgent || '');
}
function syncPwaRuntimeState() {
state.pwa = {
secureContext: Boolean(window.isSecureContext),
standalone: isStandaloneWebApp(),
mobile: isMobileBrowserContext(),
touch: isTouchDevice(),
browser: detectBrowserFamily(),
swReady: state.pwa?.swReady || false,
fileHandling: 'launchQueue' in window,
badgeApi: typeof navigator.setAppBadge === 'function' || typeof navigator.clearAppBadge === 'function',
windowControlsOverlay: Boolean(
window.matchMedia?.('(display-mode: window-controls-overlay)')?.matches
|| navigator.windowControlsOverlay?.visible
)
};
document.documentElement.classList.toggle('pwa-standalone', Boolean(state.pwa.standalone));
document.documentElement.classList.toggle('mobile-browser-context', Boolean(state.pwa.mobile));
document.documentElement.classList.toggle('pwa-installed-runtime', Boolean(state.pwa.standalone || state.appInstalled));
}
function syncWindowControlsOverlayUi() {
syncPwaRuntimeState();
document.documentElement.classList.toggle('window-controls-overlay', Boolean(state.pwa.windowControlsOverlay));
const badge = document.getElementById('desktopPwaBadge');
if (badge) {
const visible = state.pwa.standalone && state.pwa.windowControlsOverlay && !state.pwa.mobile;
badge.classList.toggle('hidden', !visible);
badge.textContent = state.language === 'fa' ? 'PWA Desktop' : 'Desktop PWA';
}
}
function computeBadgeCount() {
const sharedPayloadPending = state.pendingSharedPayload ? 1 : 0;
const launchQueuePending = Array.isArray(state.pendingLaunchFiles) ? state.pendingLaunchFiles.length : 0;
const secureSharePending = state.pendingIncomingShare ? 1 : 0;
/* Two counts of the same thing, never added together. unreadChatCount is what
   this page saw arrive while it was running; backgroundNoticeCount is what the
   service worker is holding in the notification tray, which is the only tally
   that exists while the app is shut. A message that arrives on a backgrounded
   but living page can be in both, so the larger of the two is the count — a
   sum would show two for one message. */
const chatUnread = Math.max(state.unreadChatCount || 0, state.backgroundNoticeCount || 0);
return Math.min(99, chatUnread + sharedPayloadPending + launchQueuePending + secureSharePending);
}
async function syncAppBadge() {
syncPwaRuntimeState();
state.pwa.badgeCount = computeBadgeCount();
const badgeValue = state.pwa.badgeCount;
const badgeText = document.getElementById('desktopPwaBadgeCount');
if (badgeText) {
badgeText.textContent = badgeValue > 0 ? String(badgeValue) : '';
badgeText.classList.toggle('hidden', badgeValue < 1);
}
if (isDesktopAppRuntime()) {
/* The native shell owns the Dock / launcher badge; navigator.setAppBadge
   does nothing inside WKWebView and WebKitGTK. */
try {
await window.PoorijaDesktop?.setBadgeCount(badgeValue);
} catch (error) {
// A desktop environment without a badge protocol is not an error.
}
return;
}
if (!state.pwa.badgeApi) return;
try {
if (badgeValue > 0 && typeof navigator.setAppBadge === 'function') {
await navigator.setAppBadge(badgeValue);
} else if (badgeValue < 1 && typeof navigator.clearAppBadge === 'function') {
await navigator.clearAppBadge();
}
} catch (error) {
// Ignore badge failures on unsupported engines.
}
}
function getInstallGuideContent() {
syncPwaRuntimeState();
const browser = state.pwa.browser;
// install instructions depend on the hardware, not on how wide the window is
const mobile = state.pwa.touch;
const secureContext = state.pwa.secureContext;
const hasPrompt = Boolean(state.deferredInstallPrompt);
const isFa = state.language === 'fa';
const content = {
title: isFa ? 'راهنمای نصب PWA' : 'PWA install guide',
summary: secureContext
? (isFa
? 'این نسخه وب برای اجرا به صورت اپلیکیشن تحت وب آماده است. اگر مرورگر شما prompt بومی را پشتیبانی کند، دکمه نصب همان را باز می‌کند؛ در غیر این صورت، مراحل درست همان مرورگر به شما نمایش داده می‌شود.'
: 'This web build is ready to run as an installable app. If your browser supports a native install prompt, the install button triggers it; otherwise, the app shows the correct browser-specific steps.')
: (isFa
? 'نصب PWA و Passkey فقط در secure context کار می‌کنند. اگر گواهی TLS شما در مرورگر trusted نباشد، حتی با HTTPS هم نصب و بایومتریک غیرفعال می‌مانند.'
: 'PWA install and passkeys only work in a secure context. If the TLS certificate is not trusted by the browser, installation and biometrics remain unavailable even over HTTPS.'),
browserLabel: '',
steps: [],
fallback: ''
};
if (mobile && /iPhone|iPad|iPod/i.test(navigator.userAgent || '')) {
content.browserLabel = 'Safari on iPhone / iPad';
content.steps = isFa
? [
'در Safari صفحه را باز کنید.',
'روی دکمه Share بزنید.',
'گزینه Add to Home Screen را انتخاب کنید.',
'پس از نصب، برنامه را از Home Screen اجرا کنید تا حالت تمام‌صفحه و PWA فعال شود.'
]
: [
'Open the page in Safari.',
'Tap the Share button.',
'Choose Add to Home Screen.',
'Launch the app from the Home Screen to use the standalone PWA experience.'
];
} else if (mobile) {
content.browserLabel = isFa ? 'Android browsers' : 'Android browsers';
content.steps = hasPrompt
? (isFa
? [
'روی دکمه نصب بزنید تا prompt بومی مرورگر باز شود.',
'در صورت ظاهر نشدن prompt، منوی مرورگر را باز کنید.',
'Install app یا Add to Home screen را انتخاب کنید.',
'برنامه را از آیکون نصب‌شده اجرا کنید.'
]
: [
'Tap the install button to open the native browser prompt.',
'If no prompt appears, open the browser menu.',
'Choose Install app or Add to Home screen.',
'Launch the installed icon for the full PWA experience.'
])
: (isFa
? [
'منوی مرورگر را باز کنید.',
'Install app یا Add to Home screen را انتخاب کنید.',
'اگر مرورگر شما این گزینه را ندارد، Chrome یا Edge را امتحان کنید.',
'پس از نصب، برنامه را از آیکون تازه اجرا کنید.'
]
: [
'Open the browser menu.',
'Choose Install app or Add to Home screen.',
'If the option is missing, try Chrome or Edge.',
'Launch the newly installed icon afterwards.'
]);
} else if (hasPrompt || browser === 'chromium' || browser === 'edge' || browser === 'opera') {
content.browserLabel = browser === 'edge' ? 'Microsoft Edge' : browser === 'opera' ? 'Opera' : 'Chromium browsers';
content.steps = isFa
? [
'روی دکمه Install App در هدر بزنید. اگر prompt آماده باشد، بلافاصله باز می‌شود.',
'اگر prompt ظاهر نشد، آیکون نصب کنار نوار آدرس یا منوی مرورگر را بررسی کنید.',
'بعد از نصب، برنامه را در پنجره مستقل اجرا کنید تا UI سبک‌تر و تجربه دسکتاپ کامل داشته باشید.'
]
: [
'Use the Install App button in the header. When the browser has a prompt ready, it opens immediately.',
'If no prompt appears, check the install icon in the address bar or the browser menu.',
'Launch the installed app in its standalone window for the cleaner desktop experience.'
];
} else if (browser === 'safari') {
content.browserLabel = 'Safari on macOS';
content.steps = isFa
? [
'در Safari صفحه را با گواهی trusted باز کنید.',
'از منوی Safari یا File گزینه Add to Dock را انتخاب کنید.',
'اپ وب ساخته‌شده را از Dock یا Applications اجرا کنید.',
'اگر این گزینه را نمی‌بینید، ابتدا مطمئن شوید صفحه واقعاً secure context است و مانيفست درست لود شده است.'
]
: [
'Open the site in Safari with a trusted certificate.',
'Use Safari or the File menu and choose Add to Dock.',
'Launch the resulting web app from the Dock or Applications.',
'If the option is missing, confirm that the page is a real secure context and that the manifest loads correctly.'
];
} else if (browser === 'firefox') {
content.browserLabel = isFirefoxWindowsInstallable() ? 'Firefox on Windows' : 'Firefox';
content.steps = isFirefoxWindowsInstallable()
? (isFa
? [
'در Firefox for Windows صفحه را باز کنید.',
'آیکون نصب وب‌اپ را در نوار آدرس یا Page Actions بررسی کنید.',
'پس از نصب، وب‌اپ را از shortcut ایجادشده اجرا کنید.'
]
: [
'Open the site in Firefox for Windows.',
'Use the web-app install control from the address bar or page actions.',
'Launch the resulting shortcut after installation.'
])
: (isFa
? [
'نسخه فعلی Firefox روی این سیستم install flow کامل PWA را مثل Chromium/Safari ارائه نمی‌دهد.',
'برای نصب دسکتاپ از Chrome/Edge یا Safari استفاده کنید.',
'Firefox همچنان می‌تواند نسخه وب معمولی را اجرا کند.'
]
: [
'This Firefox setup does not offer the same desktop PWA install flow as Chromium or Safari.',
'Use Chrome, Edge, or Safari for desktop installation.',
'Firefox can still run the normal web version.'
]);
} else {
content.browserLabel = isFa ? 'مرورگر فعلی' : 'Current browser';
content.steps = isFa
? [
'این مرورگر prompt استاندارد نصب را در اختیار برنامه قرار نمی‌دهد.',
'اگر گزینه نصب در منوی مرورگر دیده می‌شود، همان را استفاده کنید.',
'در غیر این صورت از Chrome/Edge یا Safari برای نصب استفاده کنید.'
]
: [
'This browser does not expose a standard in-app install prompt.',
'If the browser offers its own install UI, use it from the browser menu.',
'Otherwise use Chrome, Edge, or Safari for installation.'
];
}
if (!secureContext) {
content.fallback = isFa
? 'برای فعال شدن نصب و Passkey، دامنه یا hostname باید با گواهی TLS شما match باشد و certificate هم داخل سیستم یا مرورگر trusted شود. روی localhost هم secure context معتبر است.'
: 'To enable install and passkeys, your domain or hostname must match the TLS certificate and the certificate must be trusted by the OS or browser. Localhost is also treated as a secure context.';
}
return content;
}
function setPresetKeyTag(tagInputId, colorInputId, translationKey, color) {
const tagInput = document.getElementById(tagInputId);
const colorInput = document.getElementById(colorInputId);
if (tagInput) {
tagInput.value = getTranslatedText(translationKey);
}
if (colorInput) {
colorInput.value = color;
}
}
// ==================== Helpers ====================
const CryptoConfig = window.PoorijaCryptoConfig;
const SAFE_ALGORITHM_SELECT_IDS = ['defaultAlgorithm', 'encAlgorithm', 'textAlgorithm', 'textDecAlgorithm', 'sdAlgorithm', 'keyAlgorithm'];
function populateAlgorithmSelects() {
const markup = CryptoConfig.buildAlgorithmOptionMarkup(state.language || 'fa');
SAFE_ALGORITHM_SELECT_IDS.forEach((id) => {
const select = document.getElementById(id);
if (!select) return;
const currentValue = select.value;
select.innerHTML = markup;
const safeAlgorithms = CryptoConfig.getSafeAlgorithms();
const nextValue = safeAlgorithms.some((algorithm) => algorithm.id === currentValue)
? currentValue
: (state.settings && state.settings.algorithm) || 'AES-256-GCM';
select.value = nextValue;
});
}
function getKeySpecsForAlgorithm(alg) {
const config = CryptoConfig.getAlgorithmConfig(alg);
if (CryptoConfig.isSymmetricAlgorithm(config.id)) {
return {
type: 'secret',
length: config.keyLengthBits / 8,
format: 'raw'
};
}
return {
type: 'keypair',
modulusLength: config.keyLengthBits,
publicFormat: 'spki',
privateFormat: 'pkcs8'
};
}
function generateSecureRandomString(length, chars) {
const randomValues = new Uint32Array(length);
window.crypto.getRandomValues(randomValues);
let result = '';
for (let i = 0; i < length; i++) {
result += chars[randomValues[i] % chars.length];
}
return result;
}
function generateSecureRandomBytes(length) {
const bytes = new Uint8Array(length);
window.crypto.getRandomValues(bytes);
return bytes;
}
function computeKeyMaterialMeta(material) {
const meta = { keyKind: material.keyKind };
if (material.keyKind === 'secret') {
meta.secretFormat = 'raw';
meta.secretLengthBytes = material.secretLengthBytes;
return meta;
}
meta.publicFormat = 'spki';
meta.privateFormat = 'pkcs8';
meta.publicLengthBytes = material.publicLengthBytes;
meta.privateLengthBytes = material.privateLengthBytes;
meta.modulusLength = material.modulusLength;
return meta;
}
function decodeBase64Bytes(base64) {
return new Uint8Array(base64ToArrayBuffer(base64));
}
function encodeBytesToBase64(bytes) {
return arrayBufferToBase64(bytes.buffer);
}
function getKeyDisplayLabel(key) {
if (key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm)) {
return state.language === 'fa' ? 'کلید راستی‌آزمایی' : 'Verification key';
}
const keyKind = (key.keyMeta && key.keyMeta.keyKind) || (key.privateKeyData ? 'keypair' : 'secret');
return keyKind === 'secret'
? (state.language === 'fa' ? 'کلید متقارن' : 'Secret key')
: (state.language === 'fa' ? 'کلید عمومی' : 'Public key');
}
function getPrivateKeyDisplayLabel(key) {
if (key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm)) {
return state.language === 'fa' ? 'کلید امضا' : 'Signing key';
}
return state.language === 'fa' ? 'کلید خصوصی' : 'Private key';
}
function detectSecretKeyBase64(keyText, algorithmId) {
const expectedLength = CryptoConfig.getSymmetricKeyLengthBytes(algorithmId);
if (!expectedLength || !keyText) return null;
try {
const bytes = decodeBase64Bytes(keyText.trim());
if (bytes.byteLength === expectedLength) {
return bytes;
}
} catch (error) {
return null;
}
return null;
}
function getBase64ByteLengthOrNull(value) {
try {
return decodeBase64Bytes(value).byteLength;
} catch (error) {
return null;
}
}
function normalizeAlgorithmId(algorithmId, fallbackId) {
const nextFallback = fallbackId || 'AES-256-GCM';
if (!algorithmId) return nextFallback;
const normalizedId = String(algorithmId).trim();
if (!normalizedId) return nextFallback;
if (isSignatureAlgorithmId(normalizedId)) {
return normalizedId;
}
if (CryptoConfig.getAlgorithmOptionList({ includeLegacy: true }).some((algorithm) => algorithm.id === normalizedId)) {
return normalizedId;
}
if (normalizedId === 'AES' || normalizedId === 'AES-256') {
return 'AES-256-GCM';
}
if (normalizedId === 'RSA-OAEP-2048') {
return 'RSA-OAEP';
}
return nextFallback;
}
function normalizeSettingsRecord(settings) {
const normalizedSettings = { ...(settings || {}) };
normalizedSettings.algorithm = normalizeAlgorithmId(normalizedSettings.algorithm, 'AES-256-GCM');
if (normalizedSettings.algorithm === 'RSA-OAEP') {
normalizedSettings.algorithm = 'RSA-OAEP-3072';
}
const safeAlgorithmIds = CryptoConfig.getSafeAlgorithms().map((algorithm) => algorithm.id);
if (!safeAlgorithmIds.includes(normalizedSettings.algorithm)) {
normalizedSettings.algorithm = 'AES-256-GCM';
}
normalizedSettings.typography = {
fontFa: normalizedSettings.typography?.fontFa || "'Vazirmatn', sans-serif",
fontEn: normalizedSettings.typography?.fontEn || "'Inter', sans-serif",
fontSize: normalizedSettings.typography?.fontSize || '16px',
iconColor: normalizedSettings.typography?.iconColor || ''
};
normalizedSettings.desktopIconProfile = DESKTOP_ICON_PROFILES[normalizedSettings.desktopIconProfile]
? normalizedSettings.desktopIconProfile
: 'poorija-default';
normalizedSettings.desktopVaultSync = normalizedSettings.desktopVaultSync !== false;
normalizedSettings.selfDestructBindToDevice = normalizedSettings.selfDestructBindToDevice !== false;
normalizedSettings.tabOrder = normalizeTabOrder(normalizedSettings.tabOrder);
Object.assign(normalizedSettings, normalizeEncryptionPreferences(normalizedSettings));
return normalizedSettings;
}
function normalizeKeyRecord(key) {
const normalizedKey = { ...key };
normalizedKey.algorithm = normalizeAlgorithmId(normalizedKey.algorithm, 'AES-256-GCM');
if (isSignatureAlgorithmId(normalizedKey.algorithm) || normalizedKey.purpose === 'signature') {
normalizedKey.purpose = 'signature';
if (!normalizedKey.keyMeta) {
normalizedKey.keyMeta = {
keyKind: 'keypair',
purpose: 'signature',
publicFormat: 'spki',
privateFormat: 'pkcs8',
publicLengthBytes: getBase64ByteLengthOrNull(normalizedKey.publicKeyData || '') || 0,
privateLengthBytes: getBase64ByteLengthOrNull(normalizedKey.privateKeyData || '') || 0
};
}
return normalizedKey;
}
const keyKind = getStoredKeyKind(normalizedKey);
if (!normalizedKey.keyMeta) {
if (keyKind === 'secret') {
const secretMaterial = normalizedKey.publicKeyData || normalizedKey.privateKeyData || '';
normalizedKey.keyMeta = {
keyKind: 'secret',
secretFormat: 'raw',
secretLengthBytes: getBase64ByteLengthOrNull(secretMaterial) || secretMaterial.length
};
} else {
normalizedKey.keyMeta = {
keyKind: 'keypair',
publicFormat: 'spki',
privateFormat: 'pkcs8',
publicLengthBytes: getBase64ByteLengthOrNull(normalizedKey.publicKeyData || '') || 0,
privateLengthBytes: getBase64ByteLengthOrNull(normalizedKey.privateKeyData || '') || 0
};
}
}
if (keyKind === 'secret' && normalizedKey.algorithm === 'RSA-OAEP') {
normalizedKey.algorithm = 'AES-256-GCM';
}
if (keyKind === 'keypair' && normalizedKey.algorithm === 'RSA-OAEP') {
normalizedKey.migratedFromAlgorithm = normalizedKey.migratedFromAlgorithm || 'RSA-OAEP';
normalizedKey.algorithm = 'RSA-OAEP-3072';
}
return normalizedKey;
}
function normalizeKeyCollection(keys) {
if (!Array.isArray(keys)) return [];
return keys.map(normalizeKeyRecord);
}
function normalizePayloadAlgorithm(algorithmId, payload, fallbackId) {
const normalizedAlgorithm = normalizeAlgorithmId(algorithmId, fallbackId || 'AES-256-GCM');
if (normalizedAlgorithm === 'RSA-OAEP' && payload && (payload.keyProtection === 'rsa-wrapped' || payload.wk || payload.wrappedKey)) {
return 'RSA-OAEP-3072';
}
return normalizedAlgorithm;
}
function normalizeFilePayloadRecord(payload) {
const normalizedPayload = { ...(payload || {}) };
normalizedPayload.algorithm = normalizePayloadAlgorithm(normalizedPayload.algorithm, normalizedPayload, 'AES-256-GCM');
if (normalizedPayload.wk && !normalizedPayload.wrappedKey) {
normalizedPayload.wrappedKey = normalizedPayload.wk;
}
if (normalizedPayload.s && !normalizedPayload.salt) {
normalizedPayload.salt = normalizedPayload.s;
}
if (normalizedPayload.it && !normalizedPayload.iterations) {
normalizedPayload.iterations = normalizedPayload.it;
}
if (normalizedPayload.keyProtection === 'rsa-wrapped' && !normalizedPayload.contentAlgorithm) {
normalizedPayload.contentAlgorithm = 'AES-256-GCM';
}
if (Array.isArray(normalizedPayload.chunks)) {
normalizedPayload.chunks = normalizedPayload.chunks.map((chunk) => {
if (typeof chunk === 'string') return chunk;
return {
...chunk,
iv: Array.isArray(chunk.iv) ? chunk.iv : Array.from(chunk.iv || [])
};
});
}
return normalizedPayload;
}
function normalizeTextEnvelopeRecord(envelope) {
const normalizedEnvelope = { ...(envelope || {}) };
normalizedEnvelope.alg = normalizePayloadAlgorithm(normalizedEnvelope.alg, normalizedEnvelope, 'AES-256-GCM');
if (!normalizedEnvelope.v && normalizedEnvelope.d) {
normalizedEnvelope.v = 1;
}
if (normalizedEnvelope.wrappedKey && !normalizedEnvelope.wk) {
normalizedEnvelope.wk = normalizedEnvelope.wrappedKey;
}
if (normalizedEnvelope.iv && !normalizedEnvelope.i) {
normalizedEnvelope.i = normalizedEnvelope.iv;
}
if (normalizedEnvelope.salt && !normalizedEnvelope.s) {
normalizedEnvelope.s = normalizedEnvelope.salt;
}
if (normalizedEnvelope.iterations && !normalizedEnvelope.it) {
normalizedEnvelope.it = normalizedEnvelope.iterations;
}
if (normalizedEnvelope.keyProtection === 'rsa-wrapped' && !normalizedEnvelope.contentAlgorithm) {
normalizedEnvelope.contentAlgorithm = 'AES-256-GCM';
}
return normalizedEnvelope;
}
function normalizeSelfDestructEnvelopeRecord(envelope) {
const normalizedEnvelope = { ...(envelope || {}) };
normalizedEnvelope.alg = normalizePayloadAlgorithm(normalizedEnvelope.alg, normalizedEnvelope, 'AES-256-GCM');
if (normalizedEnvelope.wk && !normalizedEnvelope.wrappedKey) {
normalizedEnvelope.wrappedKey = normalizedEnvelope.wk;
}
if (normalizedEnvelope.keyProtection === 'rsa-wrapped' && !normalizedEnvelope.contentAlgorithm) {
normalizedEnvelope.contentAlgorithm = 'AES-256-GCM';
}
if (normalizedEnvelope.s && !normalizedEnvelope.salt) {
normalizedEnvelope.salt = normalizedEnvelope.s;
}
if (normalizedEnvelope.i && !normalizedEnvelope.iv) {
normalizedEnvelope.iv = normalizedEnvelope.i;
}
if (normalizedEnvelope.it && !normalizedEnvelope.iterations) {
normalizedEnvelope.iterations = normalizedEnvelope.it;
}
return normalizedEnvelope;
}
function normalizeServerOrigin(raw = '', fallbackOrigin = '') {
const trimmed = String(raw || '').trim();
if (!trimmed) return String(fallbackOrigin || '').trim();
try {
const hostish = trimmed.split(/[/?#]/)[0].toLowerCase();
const host = hostish.startsWith('[') ? hostish.slice(1).split(']')[0] : hostish.split(':')[0];
const isLocal = ['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(host) || host.endsWith('.localhost') || /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `${isLocal ? 'http' : 'https'}://${trimmed}`;
const parsed = new URL(withScheme);
if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
return parsed.origin;
} catch (_error) {
return '';
}
}
function getSecureChatServerUrl() {
const inputValue = document.getElementById('chatServerUrl')?.value || '';
if (inputValue) return inputValue;
try {
const raw = localStorage.getItem('poorija_chat_profile');
if (!raw) return '';
const decrypted = typeof decryptStorageData === 'function' ? decryptStorageData(raw) : null;
const profile = decrypted || JSON.parse(raw);
return profile?.serverUrl || '';
} catch (_error) {
return '';
}
}
function resolveSelfDestructServerOrigin(inputValue = '') {
return normalizeServerOrigin(inputValue, '')
|| normalizeServerOrigin(getSecureChatServerUrl(), '')
|| '';
}
function toggleSelfDestructServerSync() {
const toggle = document.getElementById('sdUseServerSync');
const box = document.getElementById('sdServerSyncBox');
if (!toggle || !box) return;
box.classList.toggle('hidden', !toggle.checked);
if (toggle.checked) {
const input = document.getElementById('sdServerUrl');
if (input && !input.value.trim()) {
input.value = normalizeServerOrigin(getSecureChatServerUrl(), '') || '';
}
}
}
function setSelfDestructReadServerFromEnvelope(envelope) {
const input = document.getElementById('sdReadServerUrl');
if (!input || !envelope?.serverSync) return;
const origin = normalizeServerOrigin(envelope.serverSync.serverOrigin || envelope.serverSync.origin || '', '');
if (origin && !input.value.trim()) input.value = origin;
}
function syncSelfDestructReadServerFromInput() {
const raw = document.getElementById('sdInputToRead')?.value.trim();
if (!raw) return;
try {
const envelope = normalizeSelfDestructEnvelopeRecord(JSON.parse(atob(raw)));
setSelfDestructReadServerFromEnvelope(envelope);
} catch (_error) {
// Ignore partial paste/input until a complete payload is available.
}
}
async function createSelfDestructServerRecord({ serverOrigin, payloadId, timeLimitMs, maxViews, createdAt }) {
const response = await fetch(new URL('/self-destruct/records', serverOrigin), {
method: 'POST',
headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
body: JSON.stringify({ payloadId, timeLimitMs, maxViews, createdAt })
});
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.ok || !body.id) {
throw new Error(body.reason || 'self-destruct-server-create-failed');
}
return body;
}
async function openSelfDestructServerRecord({ serverOrigin, recordId, payloadId }) {
const response = await fetch(new URL(`/self-destruct/records/${encodeURIComponent(recordId)}/open`, serverOrigin), {
method: 'POST',
headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
body: JSON.stringify({ payloadId })
});
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.ok) {
const reason = body.reason || 'self-destruct-server-open-failed';
const error = new Error(reason);
error.serverBody = body;
throw error;
}
return body;
}
async function generateAlgorithmKeyMaterial(alg) {
const specs = getKeySpecsForAlgorithm(alg);
if (specs.type === 'secret') {
const secretBytes = generateSecureRandomBytes(specs.length);
const secretKeyData = encodeBytesToBase64(secretBytes);
return {
algorithm: alg,
keyKind: 'secret',
publicKeyData: secretKeyData,
privateKeyData: secretKeyData,
secretLengthBytes: secretBytes.byteLength,
keyMeta: computeKeyMaterialMeta({
keyKind: 'secret',
secretLengthBytes: secretBytes.byteLength
})
};
}
const config = CryptoConfig.getAlgorithmConfig(alg);
const keyPair = await window.crypto.subtle.generateKey(
{
name: 'RSA-OAEP',
modulusLength: config.keyLengthBits,
publicExponent: new Uint8Array([1, 0, 1]),
hash: config.hash || 'SHA-256'
},
true,
['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
);
const exportedPublicKey = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
const exportedPrivateKey = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
const publicKeyData = arrayBufferToBase64(exportedPublicKey);
const privateKeyData = arrayBufferToBase64(exportedPrivateKey);
return {
algorithm: alg,
keyKind: 'keypair',
publicKeyData: publicKeyData,
privateKeyData: privateKeyData,
keyMeta: computeKeyMaterialMeta({
keyKind: 'keypair',
modulusLength: config.keyLengthBits,
publicLengthBytes: decodeBase64Bytes(publicKeyData).byteLength,
privateLengthBytes: decodeBase64Bytes(privateKeyData).byteLength
})
};
}
// ==================== Steganography Functions ====================
function previewStegoImage(input) {
const file = input.files[0];
if (file) {
document.getElementById('stegoImageName').textContent = file.name;
const reader = new FileReader();
reader.onload = function(e) {
const img = new Image();
img.onload = function() {
const canvas = document.getElementById('stegoCanvas');
canvas.width = img.width;
canvas.height = img.height;
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);
};
img.src = e.target.result;
};
reader.readAsDataURL(file);
}
}
/* Both halves of this now go through js/stego.js, which owns the container
   format, the two codecs and the diagnosis. What is left here is the browser
   plumbing: canvases, blobs, and telling the user what happened. */

function stegoSelectedMode() {
  const picked = document.querySelector('input[name="stegoMode"]:checked');
  return picked && picked.value === 'lsb'
    ? window.PoorijaStego.ALGO_LSB
    : window.PoorijaStego.ALGO_DCT;
}

function showStegoVerdict(elementId, tone, title, detail) {
  const box = document.getElementById(elementId);
  if (!box) return;
  const palette = {
    success: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700',
    error: 'bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200 border border-red-300 dark:border-red-700',
    warning: 'bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700',
    info: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-600'
  };
  box.className = `mb-3 p-3 rounded-xl text-sm leading-relaxed ${palette[tone] || palette.info}`;
  box.innerHTML = `<div class="font-semibold mb-1">${escapeHTML(title)}</div><div class="opacity-90">${escapeHTML(detail)}</div>`;
  box.classList.remove('hidden');
}

function hideTextInImage() {
  const canvas = document.getElementById('stegoCanvas');
  const text = document.getElementById('stegoTextInput').value;
  const fileName = document.getElementById('stegoImageName').textContent;
  const fa = state.language === 'fa';
  const stego = window.PoorijaStego;

  if (!text || /انتخاب کنید|Select a/.test(fileName)) {
    showNotification(fa ? 'لطفا هم تصویر و هم متن را وارد کنید' : 'Please provide both image and text', 'error');
    return;
  }

  const algo = stegoSelectedMode();
  const ctx = canvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const payload = new TextEncoder().encode(text);

  const result = stego.hide(imageData, payload, { algo, isText: true });

  if (!result.ok && result.reason === 'CAPACITY') {
    showStegoVerdict('stegoHideVerdict', 'error',
      fa ? 'متن برای این تصویر بلند است' : 'The text is too long for this image',
      fa ? `این تصویر در این حالت ${result.capacity} بایت جا دارد و متن شما ${result.needed} بایت است. تصویر بزرگ‌تری بردارید، متن را کوتاه کنید، یا حالت «ظرفیت بالا» را انتخاب کنید.`
         : `In this mode the image holds ${result.capacity} bytes and your text needs ${result.needed}. Use a larger image, a shorter text, or the high-capacity mode.`);
    return;
  }

  /* The old code downloaded whatever came out of the canvas. If the embedding
     had not worked the failure surfaced on the recipient's phone, days later,
     as a file that simply contained nothing. */
  if (!result.ok) {
    showStegoVerdict('stegoHideVerdict', 'error',
      fa ? 'ساخت تصویر ناموفق بود' : 'The image could not be made',
      fa ? 'پیام نوشته شد ولی هنگام بازخوانی بازیابی نشد، پس فایلی ساخته نشد. تصویر دیگری امتحان کنید.'
         : 'The message was written but did not read back, so no file was produced. Try a different image.');
    return;
  }

  ctx.putImageData(result.imageData, 0, 0);

  /* PNG for LSB — a lossy container would destroy it on the way out the door.
     JPEG at 0.95 for DCT, because the codec is built to survive exactly this
     and a JPEG is what an ordinary photograph looks like. */
  const asJpeg = algo === stego.ALGO_DCT;
  const type = asJpeg ? 'image/jpeg' : 'image/png';
  const extension = asJpeg ? 'jpg' : 'png';

  canvas.toBlob(function (blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stego_${fileName.split('.')[0]}.${extension}`;
    a.click();
    URL.revokeObjectURL(url);

    showStegoVerdict('stegoHideVerdict', 'success',
      fa ? 'تصویر ساخته شد' : 'Image created',
      asJpeg
        ? (fa ? 'حالت مقاوم. می‌توانید این تصویر را به‌صورت «عکس» بفرستید — فشرده‌سازی مجدد پیام‌رسان آن را از بین نمی‌برد.'
              : 'Resilient mode. You can send this as a photo; the messenger\'s re-compression will not destroy it.')
        : (fa ? 'حالت ظرفیت بالا. این تصویر را حتماً به‌صورت «فایل» بفرستید، نه «عکس» — اگر به‌صورت عکس بفرستید پیام کاملاً از بین می‌رود.'
              : 'High-capacity mode. Send this as a FILE, not as a photo — sending it as a photo destroys the message completely.'));
  }, type, asJpeg ? 0.95 : undefined);
}

function extractTextFromImage(input) {
  const file = input.files[0];
  if (!file) return;
  document.getElementById('stegoExtractName').textContent = file.name;
  const fa = state.language === 'fa';
  const stego = window.PoorijaStego;

  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const verdict = stego.extract(ctx.getImageData(0, 0, canvas.width, canvas.height));
      const explained = stego.explain(verdict, file.type || '', state.language);
      showStegoVerdict('stegoExtractVerdict', explained.tone, explained.title, explained.detail);

      const output = document.getElementById('stegoExtractedOutput');
      if (verdict.status === 'ok') {
        output.value = verdict.isText
          ? new TextDecoder().decode(verdict.payload)
          : window.PoorijaCryptoCore.toBase64(verdict.payload);
        showNotification(fa ? 'پیام استخراج شد' : 'Message extracted', 'success');
      } else {
        output.value = '';
        showNotification(explained.title, explained.tone === 'error' ? 'error' : 'warning');
      }
    };
    img.onerror = function () {
      showStegoVerdict('stegoExtractVerdict', 'error',
        fa ? 'تصویر باز نشد' : 'The image could not be opened',
        fa ? 'این فایل یک تصویر قابل‌خواندن برای مرورگر نیست.'
           : 'The browser could not read this file as an image.');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ==================== File Shredder Functions ====================
let fileHandleToShred = null;
async function handleShredderFileAPI() {
if (isDesktopAppRuntime()) {
const dialogApi = getDesktopDialogApi();
if (!dialogApi?.open) {
showNotification(state.language === 'fa' ? 'دیالوگ فایل بومی دسکتاپ در دسترس نیست' : 'Native desktop file dialog is unavailable', 'error');
return;
}
try {
const result = await dialogApi.open({
multiple: false,
directory: false,
title: state.language === 'fa' ? 'انتخاب فایل برای امحای امن' : 'Select a file to shred'
});
const selectedPath = Array.isArray(result) ? result[0] : result;
if (!selectedPath) return;
fileHandleToShred = {
desktopPath: String(selectedPath),
name: getPathBaseName(selectedPath)
};
document.getElementById('shredderFileName').textContent = fileHandleToShred.name;
document.getElementById('shredBtn').disabled = false;
document.getElementById('shredderProgress').classList.add('hidden');
document.getElementById('shredderProgressBar').style.width = '0%';
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'خطا در انتخاب فایل' : 'Error selecting file', 'error');
}
return;
}
if (!('showOpenFilePicker' in window)) {
showNotification(state.language === 'fa' ? 'مرورگر شما از File System Access API پشتیبانی نمی‌کند.' : 'Browser does not support File System Access API.', 'error');
return;
}
try {
const [fileHandle] = await window.showOpenFilePicker();
fileHandleToShred = fileHandle;
const file = await fileHandle.getFile();
document.getElementById('shredderFileName').textContent = file.name;
document.getElementById('shredBtn').disabled = false;
document.getElementById('shredderProgress').classList.add('hidden');
document.getElementById('shredderProgressBar').style.width = '0%';
} catch (error) {
if (error.name !== 'AbortError') {
showNotification(state.language === 'fa' ? 'خطا در انتخاب فایل' : 'Error selecting file', 'error');
}
}
}
async function shredFile() {
if (!fileHandleToShred) return;
const btn = document.getElementById('shredBtn');
const progressContainer = document.getElementById('shredderProgress');
const progressBar = document.getElementById('shredderProgressBar');
if (!await PoorijaDialogs.confirm(state.language === 'fa' ? 'آیا مطمئن هستید؟ این عملیات فایل اصلی روی هارد شما را به صورت ایمن حذف می‌کند و غیر قابل بازگشت است!' : 'Are you sure? This will securely delete the original file on your drive and cannot be undone!')) {
return;
}
btn.disabled = true;
progressContainer.classList.remove('hidden');
try {
if (fileHandleToShred.desktopPath) {
progressBar.style.width = '24%';
await invokeDesktopCommand('desktop_shred_file', {
path: fileHandleToShred.desktopPath,
removeAfterShred: true
});
progressBar.style.width = '100%';
showNotification(getTranslatedText('shredderDesktopSuccess'), 'success');
resetShredderSelection();
return;
}
const file = await fileHandleToShred.getFile();
const fileSize = file.size;
const writable = await fileHandleToShred.createWritable();
const chunkSize = 1024 * 1024 * 5; // 5MB chunks
const totalChunks = Math.ceil(fileSize / chunkSize);
// Write zeros
for(let i=0; i<totalChunks; i++) {
const size = Math.min(chunkSize, fileSize - (i * chunkSize));
const zeroBuffer = new Uint8Array(size).fill(0);
await writable.write(zeroBuffer);
const percent = Math.round(((i + 1) / totalChunks) * 100);
progressBar.style.width = `${percent}%`;
}
// Truncate to 0 bytes
await writable.truncate(0);
await writable.close();
showNotification(state.language === 'fa' ? 'فایل به صورت ایمن روی هارد بازنویسی و محتوای آن پاک شد.' : 'File securely overwritten and emptied on disk.', 'success');
// Reset
resetShredderSelection();
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'خطا در دسترسی یا بازنویسی فایل' : 'Error accessing or overwriting file', 'error');
btn.disabled = false;
}
}
// ==================== Migration Functions ====================
async function exportMigrationData() {
const password = document.getElementById('exportPassword').value;
if (!password) {
showNotification(state.language === 'fa' ? 'رمز عبور را برای خروجی گرفتن وارد کنید' : 'Please enter a password for export', 'error');
return;
}
const migrationData = {
keys: normalizeKeyCollection(state.keys),
passwords: localStorage.getItem('poorija_passwords') || '[]',
secureNotes: localStorage.getItem(NOTES_STORAGE_KEY) || '[]',
shareHistory: localStorage.getItem(SHARE_HISTORY_STORAGE_KEY) || '[]',
signatureHistory: localStorage.getItem(SIGNATURE_HISTORY_STORAGE_KEY) || '[]',
settings: JSON.stringify(normalizeSettingsRecord(state.settings)),
/* No credential travels in the bundle.

   This used to carry poorija_master_hash, and the import side wrote it back.
   Both halves are wrong now: there is no stored password record any more —
   removing it is the whole point of the two-slot vault — and putting one into
   an exported file would hand an offline guessing target to anyone who ever
   picked the file up. A migration bundle carries data; the receiving device
   keeps its own password. */
twoFA: localStorage.getItem('poorija_2fa') || '{}',
history: localStorage.getItem('poorija_history') || '[]',
version: APP_VERSION,
timestamp: new Date().toISOString()
};
const dataString = JSON.stringify(migrationData);
const encryptedData = await encryptMigrationBackup(dataString, password);
const blob = new Blob([encryptedData], { type: 'application/poorija-backup' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `Poorija_Backup_${new Date().toISOString().split('T')[0]}.poorija-backup`;
a.click();
URL.revokeObjectURL(url);
localStorage.setItem('poorija_last_backup_at', new Date().toISOString());
showNotification(state.language === 'fa' ? 'فایل خروجی با موفقیت ایجاد شد' : 'Export file created successfully', 'success');
document.getElementById('exportPassword').value = '';
}
async function importMigrationData() {
const fileInput = document.getElementById('importMigrationFile');
const password = document.getElementById('importPassword').value;
if (!fileInput.files.length || !password) {
showNotification(state.language === 'fa' ? 'فایل و رمز عبور را وارد کنید' : 'Please provide file and password', 'error');
return;
}
const file = fileInput.files[0];
const text = await file.text();
try {
const decryptedData = await decryptMigrationBackup(text, password);
if (!decryptedData) throw new Error('Decryption failed');
const migrationData = JSON.parse(decryptedData);
if (await PoorijaDialogs.confirm(state.language === 'fa' ? 'اطلاعات فعلی شما پاک شده و با اطلاعات جدید جایگزین خواهد شد. آیا مطمئن هستید؟' : 'Current data will be overwritten. Are you sure?')) {
let importedKeys = null;
if (Array.isArray(migrationData.keys)) {
importedKeys = normalizeKeyCollection(migrationData.keys);
} else if (typeof migrationData.keys === 'string') {
const trimmedKeys = migrationData.keys.trim();
if (trimmedKeys.startsWith('[')) {
importedKeys = normalizeKeyCollection(JSON.parse(trimmedKeys));
} else {
const decryptedKeys = decryptStorageData(migrationData.keys);
if (Array.isArray(decryptedKeys)) {
importedKeys = normalizeKeyCollection(decryptedKeys);
}
}
}
if (importedKeys) {
localStorage.setItem('poorija_keys', JSON.stringify(importedKeys));
} else {
localStorage.setItem('poorija_keys', migrationData.keys || '[]');
}
localStorage.setItem('poorija_passwords', migrationData.passwords);
if (migrationData.secureNotes) {
localStorage.setItem(NOTES_STORAGE_KEY, migrationData.secureNotes);
}
if (migrationData.shareHistory) {
localStorage.setItem(SHARE_HISTORY_STORAGE_KEY, migrationData.shareHistory);
}
if (migrationData.signatureHistory) {
localStorage.setItem(SIGNATURE_HISTORY_STORAGE_KEY, migrationData.signatureHistory);
}
const importedSettings = normalizeSettingsRecord(JSON.parse(migrationData.settings || '{}'));
localStorage.setItem('poorija_settings', JSON.stringify(importedSettings));
/* Deliberately NOT restoring a master hash. An imported bundle must not be
   able to put a password record back on a device that has none — an observer
   finding poorija_master_hash after an import would learn exactly what the
   vault design exists to hide. Older bundles still carry the field; it is
   ignored, and any stale record is swept. */
window.PoorijaVault.__native.removeItem('poorija_master_hash');
window.PoorijaVault.__native.removeItem('poorija_panic_hash');
localStorage.setItem('poorija_2fa', migrationData.twoFA);
localStorage.setItem('poorija_history', migrationData.history);
showNotification(state.language === 'fa' ? 'اطلاعات با موفقیت جایگزین شد. برنامه مجدداً بارگذاری می‌شود...' : 'Data imported successfully. Reloading...', 'success');
setTimeout(() => {
window.location.reload();
}, 2000);
}
} catch (error) {
showNotification(state.language === 'fa' ? 'خطا در وارد کردن اطلاعات (رمز عبور اشتباه است یا فایل خراب است)' : 'Import error: wrong password or corrupt file', 'error');
}
}
// ==================== State Management ====================
const state = {
language: localStorage.getItem('poorija_lang') || 'fa',
masterPassword: null,
/* The open vault profile. Everything stored under poorija_* is redirected
   into its namespace while it is set — see js/vault-profiles.js. */
activeProfile: null,
isLocked: true,
activeTab: 'encrypt',
keys: [],
generatedPasswords: [],
secureNotes: [],
shareHistory: [],
signatureHistory: [],
history: [],
currentFile: null,
secureShareFile: null,
signatureSourceFile: null,
verifySignatureSourceFile: null,
outputData: null,
outputName: null,
secureShareBundle: null,
secureShareBundleName: null,
pendingIncomingShare: null,
pendingSharedPayload: null,
pendingLaunchFiles: [],
unreadChatCount: 0,
backgroundNoticeCount: 0,
deferredInstallPrompt: null,
appInstalled: false,
installGateDismissed: false,
pwa: {
secureContext: false,
standalone: false,
mobile: false,
browser: 'unknown',
swReady: false,
fileHandling: false,
badgeApi: false,
windowControlsOverlay: false,
badgeCount: 0
},
passkeyCapabilities: {
checked: false,
secureContext: false,
basicApi: false,
platformAuthenticator: false
},
desktopAuth: {
supported: false,
enabled: false,
checked: false,
platform: 'web'
},
storageKeyCache: {
password: '',
salt: '',
keys: null
},
desktopNotifications: {
supported: false,
permission: 'default',
checked: false
},
webPush: {
supported: false,
permission: 'default',
subscribed: false,
endpoint: ''
},
settings: {
algorithm: 'AES-256-GCM',
defaultKeyMethod: 'password',
pbkdf2Iterations: 600000,
pbkdf2Hash: 'SHA-256',
saltLength: 16,
gcmTagLength: 128,
ctrCounterLength: 64,
aadContext: '',
rsaOaepLabel: '',
chunkSize: '1MB',
namingPattern: 'original',
autoLock: false,
autoLockTime: 5,
theme: 'dark',
notifications: true,
/* Web Push is the one part of this app that puts a third party in the path:
   the endpoint belongs to the browser vendor's push service, and the relay has
   to keep a record to reach it. So it is off until the user is told exactly
   that and says yes, and it expires on a window they choose. */
push: { enabled: false, ttlDays: 30, asked: false },
deleteOriginal: false,
desktopIconProfile: 'poorija-default',
desktopVaultSync: true,
selfDestructBindToDevice: true,
tabOrder: getDefaultTabOrder()
},
twoFA: {
enabled: false,
secret: null
},
currentDecryptContext: null,
inactivityTimer: null
};
// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
ensureInstallationIdentity();
syncDesktopRuntimeClass();
syncPwaRuntimeState();
syncWindowControlsOverlayUi();
populateAlgorithmSelects();
initializeTheme();
initializeNavigationShell();
initializeInstallExperience();
initializePwaCapabilityHooks();
/* Before loadSettings(), which applies the saved face. This used to sit inside
   registerServiceWorker() behind its `'serviceWorker' in navigator` guard — and
   prepare-tauri-web.js deletes Navigator.prototype.serviceWorker for the native
   shell, so in every native desktop build the guard returned first and not one
   optional @font-face was ever injected. Choosing a font in Settings then did
   nothing at all, however many times the window was reloaded. */
window.loadDeferredFonts?.();
registerServiceWorker();
loadSettings();
hydrateIncomingShareFromLocation();
checkFirstVisit();
['encAlgorithm', 'textAlgorithm', 'textDecAlgorithm', 'sdAlgorithm'].forEach((id) => {
const element = document.getElementById(id);
if (element) {
element.addEventListener('change', () => {
renderKeysDropdown();
if (id === 'encAlgorithm') {
syncEncryptAdvancedSettingsState();
}
});
}
});
const shareAlgorithmSelect = document.getElementById('shareAlgorithm');
if (shareAlgorithmSelect) {
shareAlgorithmSelect.addEventListener('change', () => {
toggleSharePayloadType();
renderKeysDropdown();
});
}
applyTabFromLocation();
toggleSharePayloadType();
syncSecureShareOpenUi();
toggleSignatureMode();
toggleVerifySignatureMode();
initializeSetupInteractions();
refreshPasskeyCapabilities();
refreshDesktopAuthStatus();
refreshDesktopNotificationStatus();
syncLockScreenLayout();
syncShredderDesktopUi();
syncEncryptAdvancedSettingsState();
toggleSelfDestructServerSync();
document.getElementById('sdInputToRead')?.addEventListener('input', syncSelfDestructReadServerFromInput);
refreshPasskeyUi();
scheduleDesktopRuntimeRefresh();
document.getElementById('installGuideModal')?.addEventListener('click', (event) => {
if (event.target?.id === 'installGuideModal') {
closeInstallGuideModal();
}
});
syncAppBadge();
});
function initializeNavigationShell() {
const navToggle = document.getElementById('mobileNavToggle');
const overlay = document.getElementById('sidebarOverlay');
if (navToggle) {
navToggle.addEventListener('click', () => toggleSidebar());
}
if (overlay) {
overlay.addEventListener('click', () => toggleSidebar(false));
}
window.addEventListener('resize', syncResponsiveShell);
window.visualViewport?.addEventListener('resize', syncResponsiveShell);
window.addEventListener('hashchange', applyTabFromLocation);
syncResponsiveShell();
}
/* The About page: a copy button that says it worked, a QR drawn only when it
   is asked for, and a shield that leans toward the pointer. Everything here is
   idempotent — the tab can be opened any number of times. */
const ABOUT_WALLET = 'UQCEgGxRZ5A101w6RBNLwHhnva5EdK3kyDsFQcxni35DlCJf';
/* The guide.
 *
 * Rendered from js/help-content.js rather than written into the markup: the
 * entries are the same list in both languages, so they can be filtered by
 * category, searched, and asked for by tab - which is what makes a "help for
 * this screen" button possible at all. Everything is escaped on the way in;
 * the entries are plain text by design. */
let helpFilter = { cat: 'all', query: '', tab: '' };

function helpLang() {
  return state.language === 'en' ? 'en' : 'fa';
}
function helpEntryText(entry) {
  const side = entry[helpLang()] || entry.fa;
  return { title: side.t || '', body: side.b || '', steps: side.steps || [] };
}
function renderHelpCategories() {
  const box = document.getElementById('helpCategories');
  const data = window.PoorijaHelp;
  if (!box || !data) return;
  const lang = helpLang();
  const all = lang === 'en' ? 'Everything' : 'همه';
  const chips = [{ id: 'all', label: all }]
    .concat(data.CATEGORIES.map((c) => ({ id: c.id, label: lang === 'en' ? c.en : c.fa })));
  box.innerHTML = chips.map((c) => `
    <button type="button" class="poorija-help-cat ${helpFilter.cat === c.id ? 'is-on' : ''}" data-help-cat="${escapeHTML(c.id)}">
      ${escapeHTML(c.label)}
    </button>`).join('');
}
function renderHelpResults() {
  const box = document.getElementById('helpResults');
  const data = window.PoorijaHelp;
  if (!box || !data) return;
  const lang = helpLang();
  const needle = String(helpFilter.query || '').trim().toLowerCase();
  const rows = data.ENTRIES.filter((entry) => {
    if (helpFilter.tab && entry.tab !== helpFilter.tab) return false;
    if (helpFilter.cat !== 'all' && entry.cat !== helpFilter.cat) return false;
    if (!needle) return true;
    const side = helpEntryText(entry);
    return `${side.title} ${side.body} ${side.steps.join(' ')}`.toLowerCase().includes(needle);
  });
  if (!rows.length) {
    box.innerHTML = `<div class="poorija-help-empty">${escapeHTML(lang === 'en' ? 'Nothing here matches that.' : 'چیزی با این عبارت پیدا نشد.')}</div>`;
    return;
  }
  box.innerHTML = rows.map((entry) => {
    const side = helpEntryText(entry);
    const cat = data.CATEGORIES.find((c) => c.id === entry.cat);
    return `
    <details class="poorija-help-entry">
      <summary>
        <span class="poorija-help-title">${escapeHTML(side.title)}</span>
        <span class="poorija-help-tag">${escapeHTML(cat ? (lang === 'en' ? cat.en : cat.fa) : '')}</span>
      </summary>
      <div class="poorija-help-body">
        <p>${escapeHTML(side.body)}</p>
        ${side.steps.length ? `<ol>${side.steps.map((step) => `<li>${escapeHTML(step)}</li>`).join('')}</ol>` : ''}
      </div>
    </details>`;
  }).join('');
}
function renderHelp() {
  renderHelpCategories();
  renderHelpResults();
}
/* Opens the guide already narrowed to the screen the reader came from. */
function openHelpForTab(tab) {
  helpFilter = { cat: 'all', query: '', tab: tab || '' };
  const search = document.getElementById('helpSearch');
  if (search) search.value = '';
  switchTab('help');
  renderHelp();
}
window.openHelpForTab = openHelpForTab;
function initHelpPage() {
  const search = document.getElementById('helpSearch');
  if (search && !search.dataset.bound) {
    search.dataset.bound = '1';
    search.addEventListener('input', () => { helpFilter.query = search.value; helpFilter.tab = ''; renderHelpResults(); });
  }
  const cats = document.getElementById('helpCategories');
  if (cats && !cats.dataset.bound) {
    cats.dataset.bound = '1';
    cats.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-help-cat]');
      if (!chip) return;
      helpFilter.cat = chip.getAttribute('data-help-cat');
      helpFilter.tab = '';
      renderHelp();
    });
  }
  renderHelp();
}
window.initHelpPage = initHelpPage;

/* The metadata tab. The module does the reading; this shows it, marks the lines
 * that would give somebody away, and hands back a copy. The original file is
 * never written to - a tool that edits your only copy of a photograph in place
 * is a tool that eventually loses one. */
let metadataFile = null;
let metadataRead = null;
let metadataStrippedSize = 0;

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function metadataRiskLabel(risk) {
  const fa = { location: 'مکان', device: 'دستگاه', identity: 'هویت', time: 'زمان', other: 'سایر' };
  const en = { location: 'location', device: 'device', identity: 'identity', time: 'time', other: 'other' };
  return (state.language === 'en' ? en : fa)[risk] || risk;
}

function renderMetadataFields() {
  const box = document.getElementById('metadataFields');
  const summary = document.getElementById('metadataSummary');
  if (!box) return;
  if (!metadataRead) { box.innerHTML = ''; if (summary) summary.textContent = ''; return; }
  if (summary) {
    /* The size beside the original's is the plainest evidence that something
       was actually removed - plainer than any wording. */
    const sizeLine = metadataStrippedSize
      ? (state.language === 'en'
        ? ` — ${metadataFile.size} bytes → ${metadataStrippedSize} bytes`
        : ` — ${metadataFile.size} بایت ← ${metadataStrippedSize} بایت`)
      : '';
    summary.textContent = (metadataRead.supported
      ? (state.language === 'en'
        ? `${String(metadataRead.format).toUpperCase()} — ${metadataRead.fields.length} field(s)`
        : `${String(metadataRead.format).toUpperCase()} — ${metadataRead.fields.length} فیلد`)
      : (state.language === 'en'
        ? 'This format is not recognised. Nothing was read and nothing would be removed.'
        : 'این فرمت شناخته نشد. چیزی خوانده نشد و چیزی هم حذف نمی‌شود.')) + sizeLine;
  }
  box.innerHTML = metadataRead.fields.map((field) => `
    <div class="poorija-meta-row is-risk-${escapeHTML(field.risk)}" data-metadata-field="${escapeHTML(field.id)}">
      <span class="poorija-meta-label">${escapeHTML(field.label)}</span>
      <input class="poorija-meta-value" value="${escapeHTML(String(field.value))}" data-metadata-input="${escapeHTML(field.id)}">
      <span class="poorija-meta-risk">${escapeHTML(metadataRiskLabel(field.risk))}</span>
      <button type="button" class="poorija-meta-clear" data-metadata-clear="${escapeHTML(field.id)}" title="${escapeHTML(state.language === 'en' ? 'Clear this field' : 'پاک‌کردن این فیلد')}"><i class="fas fa-xmark"></i></button>
    </div>`).join('');
}

async function reloadMetadataFile() {
  metadataStrippedSize = 0;
  metadataRead = metadataFile ? await window.PoorijaMetadata.readMetadata(metadataFile) : null;
  renderMetadataFields();
}

document.getElementById('chatStripMetadataToggle')?.addEventListener('change', (event) => {
  state.settings.metadata = { ...(state.settings.metadata || {}), stripOnSend: Boolean(event.target.checked) };
  localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
  showNotification(event.target.checked
    ? (state.language === 'en' ? 'Files will be cleaned before they are sent.' : 'فایل‌ها پیش از ارسال تمیز می‌شوند.')
    : (state.language === 'en' ? 'Files will be sent exactly as they are.' : 'فایل‌ها دقیقاً همان‌طور که هستند فرستاده می‌شوند.'),
    event.target.checked ? 'success' : 'warning');
});

document.getElementById('chatConvertHeicToggle')?.addEventListener('change', (event) => {
  state.settings.metadata = { ...(state.settings.metadata || {}), offerHeicConvert: Boolean(event.target.checked) };
  localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
  showNotification(event.target.checked
    ? (state.language === 'en' ? 'You will be asked before a HEIC photograph is sent.' : 'پیش از ارسال عکس HEIC از شما پرسیده می‌شود.')
    : (state.language === 'en' ? 'HEIC photographs go as they are, with their metadata.' : 'عکس‌های HEIC با متادیتای خودشان فرستاده می‌شوند.'),
    event.target.checked ? 'success' : 'warning');
});

/* Both switches have to show what is actually stored, or a reader who turned
   one off last week sees it on again and believes it. */
function syncMetadataToggles() {
  const strip = document.getElementById('chatStripMetadataToggle');
  const convert = document.getElementById('chatConvertHeicToggle');
  const settings = metadataSettings();
  if (strip) strip.checked = settings.stripOnSend;
  if (convert) convert.checked = settings.offerHeicConvert;
}
window.addEventListener('poorija:tab-switched', (event) => {
  if (event.detail?.tabName === 'chat') syncMetadataToggles();
});
window.addEventListener('poorija:unlock', () => syncMetadataToggles());

/* The voice section. The module does the work; this offers the modes, plays
 * the result back, and - for the disguise modes - keeps the sentence about what
 * they cannot promise on screen while one is selected. */
let voiceSource = null;
let voiceResult = null;
let voiceMode = '';
let voiceRecorder = null;
let voiceChunks = [];

function renderVoiceModes() {
  const box = document.getElementById('voiceModes');
  const caveat = document.getElementById('voiceCaveat');
  if (!box || !window.PoorijaVoice) return;
  const fa = state.language !== 'en';
  /* Two groups under two headings, because the difference between them is the
     whole point: one changes how you sound, the other tries to make you harder
     to identify. Sixteen buttons in one undifferentiated grid would bury that. */
  const group = (kind, title, note) => {
    const rows = window.PoorijaVoice.MODES.filter((mode) => mode.kind === kind);
    if (!rows.length) return '';
    return `
      <div class="poorija-voice-group">
        <div class="poorija-voice-group-head">
          <strong>${escapeHTML(title)}</strong>
          <span>${escapeHTML(note)}</span>
        </div>
        <div class="poorija-voice-grid">
          ${rows.map((mode) => `
            <button type="button" class="poorija-voice-mode ${voiceMode === mode.id ? 'is-on' : ''} is-${escapeHTML(mode.kind)}" data-voice-mode="${escapeHTML(mode.id)}">
              <span>${escapeHTML(fa ? mode.fa : mode.en)}</span>
            </button>`).join('')}
        </div>
      </div>`;
  };
  box.innerHTML = group('effect',
      fa ? 'افکت‌ها' : 'Effects',
      fa ? 'صدا عوض می‌شود؛ کسی که شما را می‌شناسد باز هم می‌شناسد.'
         : 'Changes how you sound. Anyone who knows your voice still will.')
    + group('disguise',
      fa ? 'پنهان‌سازی هویت' : 'Disguise',
      fa ? 'زیروبمی و فرمانت‌ها با هم جابه‌جا می‌شوند، ریتم شل و باند باریک می‌شود.'
         : 'Moves pitch and formants together, loosens timing, narrows the band.');
  const selected = window.PoorijaVoice.MODES.find((m) => m.id === voiceMode);
  if (caveat) {
    const show = Boolean(selected?.caveat);
    caveat.classList.toggle('hidden', !show);
    caveat.textContent = show ? (fa ? window.PoorijaVoice.CAVEAT.fa : window.PoorijaVoice.CAVEAT.en) : '';
  }
}

async function applyVoiceMode() {
  const status = document.getElementById('voiceStatus');
  const audio = document.getElementById('voicePreview');
  if (!voiceSource || !voiceMode) return;
  if (status) status.textContent = state.language === 'en' ? 'Working…' : 'در حال پردازش…';
  try {
    voiceResult = await window.PoorijaVoice.transform(voiceSource, voiceMode);
    if (audio) audio.src = URL.createObjectURL(voiceResult.blob);
    if (status) {
      status.textContent = state.language === 'en'
        ? `Done — ${voiceResult.seconds.toFixed(1)}s`
        : `انجام شد — ${voiceResult.seconds.toFixed(1)} ثانیه`;
    }
  } catch (error) {
    voiceResult = null;
    if (status) status.textContent = state.language === 'en' ? 'That audio could not be processed.' : 'این فایل صوتی پردازش نشد.';
  }
}

/* The device's files, in one place, behind an optional passphrase.
 * The listing comes from Secure Chat's own vault reader - one source of truth
 * for what is stored, rather than a second one that could disagree with it. */
async function renderVaultFiles() {
  const curtain = document.getElementById('vaultFileList');
  const manager = document.getElementById('vaultFileManager');
  const status = document.getElementById('vaultStatus');
  if (!curtain || !manager) return;
  const lock = window.PoorijaChat?.vaultLock?.()?.state?.() || { enabled: true, unlocked: false };
  if (lock.enabled && !lock.unlocked) {
    manager.classList.add('hidden');
    manager.innerHTML = '';
    curtain.classList.remove('hidden');
    curtain.innerHTML = `<div class="poorija-vault-empty"><i class="fas fa-lock"></i><br>${escapeHTML(state.language === 'en'
      ? 'Locked. Enter the password to see what is stored.'
      : 'قفل است. برای دیدن فهرست، رمز عبور را وارد کنید.')}</div>`;
    if (status) status.textContent = '';
    return;
  }
  curtain.classList.add('hidden');
  manager.classList.remove('hidden');
  /* Secure Chat owns the index; this tab borrows its renderer rather than
     keeping a second one that could disagree about what is on the device. */
  await window.PoorijaChat?.renderFileManager?.();
  if (status) {
    const files = (await window.PoorijaChat?.listVaultFiles?.()) || [];
    if (!window.PoorijaChat?.vaultLock?.().state().unlocked) { status.textContent = ''; return; }
    const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
    status.textContent = state.language === 'en'
      ? `${files.length} file(s), ${formatBytes(bytes)} on this device`
      : `${files.length} فایل، ${formatBytes(bytes)} روی این دستگاه`;
  }
}

const sharedLockDisplayState = new WeakMap();
/* The three the shared lock can never let go of. Files holds the encrypted
   storage, Secure Chat holds the messages and Settings holds the lock's own
   controls — a lock whose own switch sits outside it is a door with the key
   taped to the frame. The picker shows them ticked and refuses to untick them,
   and says why. */
const SHARED_LOCK_TABS = ['vault', 'chat', 'settings'];
/* Those three plus whatever else the user put behind the same password. */
function sharedLockTabs() {
  const extra = (() => {
    try { return window.PoorijaChat?.vaultLock?.().extraTabs?.() || []; }
    catch (_error) { return []; }
  })();
  return SHARED_LOCK_TABS.concat(extra.filter((id) => !SHARED_LOCK_TABS.includes(id)));
}
const sharedLockText = (fa, en) => state.language === 'fa' ? fa : en;
const sharedLockWarning = () => sharedLockText(
  'این رمز بین مدیریت فایل‌ها، چت امن، تنظیمات، حافظهٔ رمزنگاری‌شده و مدیریت فایل‌های محلی مشترک است. پس از ۳ بار ورود پیاپی رمز اشتباه، تمام داده‌های ذخیره‌شدهٔ برنامه روی این دستگاه، شامل همهٔ پروفایل‌ها، پیام‌ها و فایل‌ها پاک می‌شود. این کار قابل بازگشت نیست. بایومتریک تنظیم‌شدهٔ دستگاه نیز می‌تواند قفل را باز کند.',
  'This password is shared by Files, Secure Chat, Settings, encrypted storage and local file management. After 3 consecutive wrong passwords, ALL app data on this device, including every profile, message and file, is erased irreversibly. Configured device biometrics can also unlock it.');
async function configureSharedLock() {
  const profile = state.activeProfile;
  const password = await PoorijaDialogs.prompt(sharedLockWarning(), {
    title: sharedLockText('گذاشتن قفل مشترک', 'Set shared lock'), password: true, confirmPassword: true,
    placeholder: sharedLockText('رمز عبور (حداقل ۸ نویسه)', 'Password (at least 8 characters)'),
    okLabel: sharedLockText('پذیرش و گذاشتن قفل', 'Accept and lock'), danger: true,
    validate: value => value.length < 8 ? sharedLockText('رمز عبور باید حداقل ۸ نویسه باشد.', 'Use at least 8 characters.') : '',
  });
  if (password === null || state.isLocked || state.activeProfile !== profile) return;
  if (!await window.PoorijaChat?.vaultLock().enable(password)) showNotification(sharedLockText('قفل فعال نشد.', 'The lock could not be enabled.'), 'error');
  syncVaultLockUi();
}
async function removeSharedLock() {
  const profile = state.activeProfile;
  const password = await PoorijaDialogs.prompt(sharedLockText('برای برداشتن قفل مشترک، رمز عبور قفل را دوباره وارد کنید.', 'Enter the shared-lock password again to remove it.'), {
    title: sharedLockText('برداشتن قفل', 'Remove lock'), password: true,
    placeholder: sharedLockText('رمز عبور', 'Password'),
  });
  if (password === null || state.isLocked || state.activeProfile !== profile) return;
  if (!await window.PoorijaChat?.vaultLock().disable(password)) showSharedLockError();
  syncVaultLockUi();
}
async function activateSharedLockPolicy() {
  const profile = state.activeProfile;
  const password = await PoorijaDialogs.prompt(sharedLockWarning(), {
    title: sharedLockText('فعال‌سازی پاک‌سازی پس از سه خطا', 'Enable erasure after three failures'),
    password: true, danger: true, placeholder: sharedLockText('رمز عبور فعلی قفل', 'Current lock password'),
    okLabel: sharedLockText('پذیرش و فعال‌سازی', 'Accept and enable'),
  });
  if (password === null || state.isLocked || state.activeProfile !== profile) return;
  if (!await window.PoorijaChat.vaultLock().activatePolicy(password)) showSharedLockError();
  syncVaultLockUi();
}
function showSharedLockError() {
  const lock = window.PoorijaChat?.vaultLock().state();
  if (lock?.unreadable) return showNotification(sharedLockText('اطلاعات قفل قابل خواندن نیست؛ داده‌ها حفظ شدند.', 'Lock data cannot be read; existing data was preserved.'), 'error');
  const remaining = Math.max(0, 3 - (lock?.attempts || 0));
  showNotification(sharedLockText('رمز عبور درست نیست.', 'Incorrect password.') + (lock?.wipeAfterThree
    ? sharedLockText(` ${remaining} تلاش تا پاک‌سازی کامل باقی مانده.`, ` ${remaining} attempts remain before all app data is erased.`) : ''), 'warning');
}
/* ---------------------------------------------------------------------------
   Choosing what else the one lock covers.

   The same password already stands in front of Files, Secure Chat and Settings.
   Anything else a person keeps here — passwords, notes, SSH keys — is exactly
   as worth a second door, and asking them to remember a second password for it
   would be the reason they turn it off. So the picker adds tabs to the lock
   that already exists rather than inventing another one.

   One overlay, two shapes. On a phone it fills the screen with a back arrow,
   the way Secure Chat's own settings open a screen of their own; on a desktop
   the same element is a centred modal over a backdrop. Building it twice would
   mean two lists that could disagree about what is ticked.

   A tick applies immediately — there is no Save. The lock is live: with it
   enabled and open, ticking a tab puts the gate on that tab while the person
   is looking at it, which is the only feedback that actually proves the
   setting took. --------------------------------------------------------- */
function sharedLockPickerElement() {
  let root = document.getElementById('sharedLockTabPicker');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'sharedLockTabPicker';
  root.className = 'slock-picker hidden';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `<div class="slock-picker-backdrop" data-slock-close></div>
    <section class="slock-picker-card">
      <div class="slock-picker-head">
        <button type="button" class="slock-picker-back" data-slock-close><i class="fas fa-arrow-right"></i></button>
        <h3 data-slock-title></h3>
      </div>
      <div class="slock-picker-body">
        <p class="slock-picker-note" data-slock-note></p>
        <div class="slock-picker-list" data-slock-list></div>
        <p class="slock-picker-fixed" data-slock-fixed></p>
      </div>
      <div class="slock-picker-foot">
        <button type="button" class="slock-picker-done" data-slock-close></button>
      </div>
    </section>`;
  document.body.append(root);
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-slock-close]')) closeSharedLockTabPicker();
  });
  root.addEventListener('change', (event) => {
    const box = event.target.closest('input[data-slock-tab]');
    if (box) applySharedLockTabChoice(box.dataset.slockTab, box.checked);
  });
  return root;
}
function applySharedLockTabChoice(id, wanted) {
  const api = window.PoorijaChat?.vaultLock?.();
  if (!api?.setExtraTabs || SHARED_LOCK_TABS.includes(id)) return;
  const current = api.extraTabs?.() || [];
  const next = wanted ? [...new Set([...current, id])] : current.filter((tab) => tab !== id);
  if (!api.setExtraTabs(next)) {
    showNotification(sharedLockText('تنظیم ذخیره نشد.', 'The setting could not be saved.'), 'error');
  }
  renderSharedLockTabPicker();
  syncVaultLockUi();
}
function renderSharedLockTabPicker() {
  const root = document.getElementById('sharedLockTabPicker');
  if (!root || root.classList.contains('hidden')) return;
  const chosen = sharedLockTabs();
  root.querySelector('[data-slock-title]').textContent =
    sharedLockText('تب\u200cهایی که با این قفل بسته می\u200cشوند', 'Tabs this lock closes');
  root.querySelector('[data-slock-note]').textContent = sharedLockText(
    'هر تبی که اینجا تیک بخورد، پشت همین رمز مشترک می\u200cرود. رمز تازه\u200cای لازم نیست.',
    'Every tab ticked here goes behind this same shared password. No second password is needed.');
  root.querySelector('[data-slock-fixed]').textContent = sharedLockText(
    'مدیریت فایل\u200cها، چت امن و تنظیمات همیشه انتخاب\u200cشده\u200cاند و نمی\u200cشود برداشتشان: کنترل\u200cهای خود قفل، حافظهٔ رمزنگاری\u200cشده و فایل\u200cها در همین سه تب هستند، و به قول استاد سخن: \u201c قفل باید قفل باشد، قفلی که کلیدش بیرونش بماند قفل نیست! \u201d \ud83d\ude05',
    'Files, Secure Chat and Settings are always selected and cannot be removed: the lock\u2019s own controls, the encrypted storage and the files live in those three tabs \u2014 and as the master of words put it: \u201c a lock must be a lock; a lock whose key stays outside it is not a lock! \u201d \ud83d\ude05');
  root.querySelector('.slock-picker-done').textContent = sharedLockText('انجام شد', 'Done');
  root.querySelector('.slock-picker-back i').className =
    document.documentElement.getAttribute('dir') === 'ltr' ? 'fas fa-arrow-left' : 'fas fa-arrow-right';
  const english = state.language !== 'fa';
  root.querySelector('[data-slock-list]').innerHTML = sidebarTabDefinitions().map((tab) => {
    const fixed = SHARED_LOCK_TABS.includes(tab.id);
    const on = chosen.includes(tab.id);
    const label = getTranslatedText(tab.labelKey, tab.id);
    return `<label class="slock-row${on ? ' on' : ''}${fixed ? ' is-fixed' : ''}">
      <span class="slock-row-label">${escapeHtml(label)}</span>
      <span class="slock-row-tail">${fixed ? `<span class="slock-row-pill">${escapeHtml(english ? 'always' : '\u0647\u0645\u06cc\u0634\u0647')}</span>` : ''}
      <input type="checkbox" data-slock-tab="${escapeHtml(tab.id)}" ${on ? 'checked' : ''} ${fixed ? 'disabled' : ''}></span>
    </label>`;
  }).join('');
}
function openSharedLockTabPicker() {
  const root = sharedLockPickerElement();
  root.classList.remove('hidden');
  document.documentElement.classList.add('slock-picker-open');
  renderSharedLockTabPicker();
  root.querySelector('.slock-picker-card')?.scrollTo?.(0, 0);
}
function closeSharedLockTabPicker() {
  document.getElementById('sharedLockTabPicker')?.classList.add('hidden');
  document.documentElement.classList.remove('slock-picker-open');
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.documentElement.classList.contains('slock-picker-open')) closeSharedLockTabPicker();
});
window.addEventListener('poorija:language-changed', renderSharedLockTabPicker);

/* A tab that is no longer covered has to be given back: its gate removed, its
   own content shown again and its keyboard access restored. Without this,
   unticking a tab left it displaying an entry frame for a lock that no longer
   applied to it, with everything else on the tab still display:none. */
function releaseUncoveredSharedGates(covered) {
  document.querySelectorAll('[id^="sharedSectionGate-"]').forEach((gate) => {
    const tab = gate.id.replace('sharedSectionGate-', '');
    if (covered.includes(tab)) return;
    const pane = document.getElementById('content-' + tab);
    if (pane) {
      for (const child of pane.children) {
        if (child === gate) continue;
        child.inert = false;
        if (sharedLockDisplayState.has(child)) {
          const [value, priority] = sharedLockDisplayState.get(child);
          if (value) child.style.setProperty('display', value, priority); else child.style.removeProperty('display');
          sharedLockDisplayState.delete(child);
        }
      }
      pane.classList.remove('shared-section-locked');
    }
    gate.remove();
  });
}
function syncVaultLockUi() {
  const api = window.PoorijaChat?.vaultLock?.();
  if (!api || state.isLocked) return;
  const lock = api.state();
  if (lock.wipeAfterThree && lock.attempts >= 3 && !lock.wiping) { startSharedLockWipe(); return; }
  if (typeof chatState !== 'undefined') chatState.chatUnlocked = lock.unlocked;
  const locked = lock.enabled && !lock.unlocked;
  /* The three defaults carry the lock's own card whether it is open or shut —
     that card is where the lock is set, removed and configured. A tab the user
     added is only ever a locked door: when the lock is open it is just that
     tab again, with no management furniture bolted to the top of it. */
  const covered = locked ? sharedLockTabs() : SHARED_LOCK_TABS;
  releaseUncoveredSharedGates(covered);
  for (const tab of covered) {
    const pane = document.getElementById('content-' + tab);
    if (!pane) continue;
    let gate = document.getElementById('sharedSectionGate-' + tab);
    if (!gate) {
      gate = document.createElement('section'); gate.className = 'shared-section-lock'; gate.id = 'sharedSectionGate-' + tab;
      gate.innerHTML = `<h3 data-lock-heading></h3><p data-lock-note></p>
        <div class="shared-lock-input-row"><label><span data-lock-label></span>
        <span class="shared-password-wrap password-control"><input id="sharedPassword-${tab}" type="password" autocomplete="current-password" data-shared-password>
        <span class="password-control-tools"><button type="button" data-shared-keyboard aria-label="Virtual keyboard"><i class="fas fa-keyboard"></i></button><button type="button" data-shared-eye aria-pressed="false"><i class="fas fa-eye"></i></button></span></span></label></div>
        <div class="shared-lock-actions"><button type="button" data-shared-set></button><button type="button" data-shared-open></button>
        <button type="button" data-shared-bio><i class="fas fa-fingerprint"></i> <span></span></button>
        <button type="button" data-shared-now></button><button type="button" data-shared-remove></button><button type="button" data-shared-policy></button>
        <button type="button" data-shared-tabs></button></div><p data-lock-bio-note></p>`;
      pane.prepend(gate);
      const input = gate.querySelector('input');
      gate.querySelector('[data-shared-keyboard]').onclick = () => window.toggleVirtualKeyboard(input.id);
      gate.querySelector('[data-shared-eye]').onclick = event => {
        const show = input.type === 'password'; togglePasswordVisibility(input.id, event.currentTarget);
        event.currentTarget.setAttribute('aria-pressed', String(show));
        event.currentTarget.setAttribute('aria-label', sharedLockText(show ? 'پنهان کردن رمز' : 'نمایش رمز', show ? 'Hide password' : 'Show password'));
      };
      gate.querySelector('[data-shared-set]').onclick = configureSharedLock;
      gate.querySelector('[data-shared-remove]').onclick = removeSharedLock;
      gate.querySelector('[data-shared-policy]').onclick = activateSharedLockPolicy;
      gate.querySelector('[data-shared-tabs]').onclick = openSharedLockTabPicker;
      gate.querySelector('[data-shared-now]').onclick = () => api.lock();
      gate.querySelector('[data-shared-open]').onclick = async () => {
        const password = input.value; input.value = ''; input.type = 'password';
        gate.querySelector('[data-shared-eye] i').className = 'fas fa-eye';
        gate.querySelector('[data-shared-eye]').setAttribute('aria-pressed', 'false');
        if (window.currentVkTargetId === input.id) document.getElementById('virtualKeyboardContainer')?.classList.add('hidden');
        if (!await api.tryUnlock(password)) showSharedLockError();
        syncVaultLockUi();
      };
      input.onkeydown = event => { if (event.key === 'Enter') gate.querySelector('[data-shared-open]').click(); };
      gate.querySelector('[data-shared-bio]').onclick = async () => {
        if (!await api.biometric()) showNotification(sharedLockText('بایومتریک تأیید نشد؛ رمز عبور را وارد کنید.', 'Biometrics were not accepted; enter the password.'), 'info');
        syncVaultLockUi();
      };
    }
    // The unlocked chat uses its existing Settings > Lock card, so the
    // fixed-height conversation shell keeps its full composer viewport.
    if (tab === 'chat' && !locked) {
      const card = document.getElementById('chatLockToggle')?.closest('.chat-storage-card');
      if (card && gate.parentElement !== card) card.append(gate);
    } else if (gate.parentElement !== pane) pane.prepend(gate);
    pane.classList.toggle('shared-section-locked', locked);
    for (const child of pane.children) {
      if (child === gate) continue;
      child.inert = locked;
      if (locked) {
        if (!sharedLockDisplayState.has(child)) sharedLockDisplayState.set(child, [child.style.getPropertyValue('display'), child.style.getPropertyPriority('display')]);
        child.style.setProperty('display', 'none', 'important');
      } else if (sharedLockDisplayState.has(child)) {
        const [value, priority] = sharedLockDisplayState.get(child);
        if (value) child.style.setProperty('display', value, priority); else child.style.removeProperty('display');
        sharedLockDisplayState.delete(child);
      }
    }
    const label = sharedLockText('رمز عبور', 'Password');
    gate.querySelector('[data-lock-heading]').textContent = sharedLockText(locked ? 'بخش‌های محافظت‌شده قفل هستند' : 'قفل مشترک بخش‌های حساس', locked ? 'Protected sections are locked' : 'Shared section lock');
    gate.querySelector('[data-lock-note]').textContent = lock.wipeAfterThree
      ? sharedLockText(`پس از ۳ رمز اشتباه پیاپی، تمام داده‌های برنامه پاک می‌شود. تلاش باقی‌مانده: ${Math.max(0, 3-lock.attempts)}`, `Three consecutive wrong passwords erase all app data. Attempts remaining: ${Math.max(0, 3-lock.attempts)}`)
      : sharedLockText('یک قفل برای مدیریت فایل‌ها، چت امن و تنظیمات. برای قفل‌های قبلی، پاک‌سازی پس از سه خطا با دکمهٔ فعال‌سازی و پذیرش هشدار فعال می‌شود.', 'One lock for Files, Secure Chat and Settings. For existing locks, enable three-failure erasure with the activation button and accept its warning.');
    gate.querySelector('[data-lock-label]').textContent = label;
    const input = gate.querySelector('input'); input.placeholder = label;
    input.setAttribute('aria-label', label);
    if (!locked) {
      input.value = ''; input.type = 'password';
      gate.querySelector('[data-shared-eye] i').className = 'fas fa-eye';
      gate.querySelector('[data-shared-eye]').setAttribute('aria-pressed', 'false');
      if (window.currentVkTargetId === input.id) document.getElementById('virtualKeyboardContainer')?.classList.add('hidden');
    }
    gate.querySelector('.shared-lock-input-row').classList.toggle('hidden', !locked);
    const names = { set:['گذاشتن قفل','Set lock'],open:['باز کردن','Unlock'],now:['قفل کردن','Lock now'],remove:['برداشتن قفل','Remove lock'] };
    for (const [action, nameset] of Object.entries(names)) {
      const button = gate.querySelector('[data-shared-'+action+']'); button.textContent = sharedLockText(...nameset);
      button.classList.toggle('hidden', action === 'set' ? lock.enabled : action === 'open' ? !locked : !lock.enabled || locked);
    }
    /* Offered before the lock exists too: choosing the tabs first and then
       setting one password is the order that makes sense to do it in. */
    const tabs = gate.querySelector('[data-shared-tabs]');
    const extraCount = Math.max(0, sharedLockTabs().length - SHARED_LOCK_TABS.length);
    tabs.textContent = extraCount
      ? sharedLockText(`\u062a\u0628\u200c\u0647\u0627\u06cc \u0642\u0641\u0644 (${extraCount}+3)`, `Locked tabs (${extraCount}+3)`)
      : sharedLockText('\u0627\u0646\u062a\u062e\u0627\u0628 \u062a\u0628\u200c\u0647\u0627', 'Choose tabs');
    tabs.classList.toggle('hidden', locked);
    const policy = gate.querySelector('[data-shared-policy]');
    policy.textContent = sharedLockText('فعال‌سازی پاک‌سازی پس از ۳ خطا', 'Enable erasure after 3 failures');
    policy.classList.toggle('hidden', !lock.enabled || locked || lock.wipeAfterThree);
    const bio = gate.querySelector('[data-shared-bio]'); bio.classList.toggle('hidden', !locked);
    bio.querySelector('span').textContent = sharedLockText('بایومتریک','Biometrics');
    bio.disabled = true;
    gate.querySelector('[data-shared-eye]').setAttribute('aria-label', sharedLockText('نمایش رمز', 'Show password'));
    api.biometricAvailable().then(available => {
      bio.disabled = !available;
      gate.querySelector('[data-lock-bio-note]').textContent = locked && !available ? sharedLockText('برای استفاده از بایومتریک، ابتدا ورود بایومتریک دستگاه را هنگام باز بودن قفل در تنظیمات فعال کنید.', 'To use biometrics, first enable device biometric quick unlock in Settings while unlocked.') : '';
    });
  }
  /* The three locked entry frames are kept identical by ONE stylesheet rule
     that names all three panes, not by measuring one and moving another.
   *
   * Measuring was the previous answer and it could not work: the reference it
   * measured was #sharedSectionGate-vault, which lives inside the Files pane,
   * and the Files pane is display:none whenever Settings is the open tab. A
   * rect taken through a display:none ancestor is all zeros, so the alignment
   * it computed was translateX(0 - settingsLeft) — it pinned the Settings gate
   * to viewport x=0 at every width, in both directions, and the inline
   * transform then leaked to phone widths where it pushed the gate, and its
   * keyboard button, off screen entirely.
   *
   * Nothing replaces it, and nothing has to undo it either: Files, Secure Chat
   * and Settings are the same .tab-content inside the same .max-w-7xl inside
   * the same <main>, so the shared
   * :is(#content-vault, #content-chat, #content-settings) rule already gives
   * all three the same box, and the inline geometry the old code wrote lived
   * on elements this function builds fresh on every page load. */
  document.documentElement.classList.toggle('shared-sections-locked', locked);
  if (typeof syncChatLockUi === 'function') syncChatLockUi();
  if (state.activeTab === 'vault') void renderVaultFiles();
}
async function initVaultPage() { syncVaultLockUi(); await renderVaultFiles(); }
window.addEventListener('poorija:section-lock', syncVaultLockUi);
window.addEventListener('poorija:language-changed', syncVaultLockUi);
window.addEventListener('poorija:unlock', syncVaultLockUi);
window.addEventListener('poorija:tab-switched', syncVaultLockUi);
window.initVaultPage = initVaultPage;
/* One door into the file manager, wherever a file is picked, produced or
   stripped. Delegated so panels rendered later get it for free. */
document.addEventListener('click', (event) => {
  if (!event.target.closest?.('[data-open-vault]')) return;
  event.preventDefault();
  document.getElementById('chatComposerActions')?.classList.add('hidden');
  switchTab('vault');
});

/* What the microphone is actually hearing, drawn while it records.
 *
 * A recorder that shows only a timer cannot tell "you are being recorded" from
 * "the microphone is muted and this will be four seconds of silence" - both
 * count up identically. An analyser reading the live stream can: a flat line
 * means no sound is arriving. It is also the cheapest possible answer, since
 * the analyser reads the stream the recorder is already consuming. */
let voiceMeterRaf = 0;
let voiceMeterCtx = null;
let voiceRecStartedAt = 0;
let voiceRecTimer = 0;

function stopVoiceMeter() {
  if (voiceMeterRaf) cancelAnimationFrame(voiceMeterRaf);
  voiceMeterRaf = 0;
  if (voiceRecTimer) clearInterval(voiceRecTimer);
  voiceRecTimer = 0;
  try { voiceMeterCtx?.close(); } catch (_error) { /* already closed */ }
  voiceMeterCtx = null;
  document.getElementById('voiceRecorder')?.classList.add('hidden');
  const record = document.getElementById('voiceRecordBtn');
  if (record) record.classList.remove('is-recording');
}

function runVoiceMeter(stream) {
  const canvas = document.getElementById('voiceMeter');
  const panel = document.getElementById('voiceRecorder');
  const clock = document.getElementById('voiceRecTime');
  if (!canvas || !panel) return;
  panel.classList.remove('hidden');
  document.getElementById('voiceRecordBtn')?.classList.add('is-recording');
  voiceRecStartedAt = Date.now();
  const tick = () => {
    if (!clock) return;
    const secs = Math.floor((Date.now() - voiceRecStartedAt) / 1000);
    clock.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  };
  tick();
  voiceRecTimer = setInterval(tick, 500);

  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) return;
  voiceMeterCtx = new AudioCtor();
  const source = voiceMeterCtx.createMediaStreamSource(stream);
  const analyser = voiceMeterCtx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Uint8Array(analyser.fftSize);
  const paint = canvas.getContext('2d');
  /* A scrolling history rather than a single bar: a bar tells you the level
     now, a history tells you whether it has been alive for the whole take. */
  const history = new Array(120).fill(0);

  const draw = () => {
    voiceMeterRaf = requestAnimationFrame(draw);
    analyser.getByteTimeDomainData(samples);
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i] - 128) / 128);
    }
    history.push(peak);
    history.shift();
    const width = canvas.width;
    const height = canvas.height;
    paint.clearRect(0, 0, width, height);
    const barWidth = width / history.length;
    history.forEach((value, index) => {
      const tall = Math.max(2, value * (height - 6));
      /* Amber near the ceiling: clipping is worth seeing before the take ends. */
      paint.fillStyle = value > 0.92 ? '#f59e0b' : '#22c55e';
      paint.fillRect(index * barWidth, (height - tall) / 2, Math.max(1, barWidth - 1), tall);
    });
    paint.strokeStyle = 'rgba(148,163,184,.35)';
    paint.beginPath();
    paint.moveTo(0, height / 2);
    paint.lineTo(width, height / 2);
    paint.stroke();
  };
  draw();
}

async function startVoiceRecording() {
  if (voiceRecorder && voiceRecorder.state === 'recording') {
    voiceRecorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    showNotification(state.language === 'en' ? 'Microphone access was denied.' : 'دسترسی به میکروفون داده نشد.', 'warning');
    return;
  }
  voiceChunks = [];
  voiceRecorder = new MediaRecorder(stream);
  voiceRecorder.ondataavailable = (event) => { if (event.data.size) voiceChunks.push(event.data); };
  voiceRecorder.onstop = async () => {
    stopVoiceMeter();
    stream.getTracks().forEach((track) => track.stop());
    voiceSource = new Blob(voiceChunks, { type: voiceRecorder.mimeType || 'audio/webm' });
    setVoiceSourceName(state.language === 'en' ? 'Your recording' : 'ضبط شما');
    await applyVoiceMode();
  };
  voiceRecorder.start();
  runVoiceMeter(stream);
}

function setVoiceSourceName(name) {
  const node = document.getElementById('voiceSourceName');
  if (node) node.textContent = name || '';
}

function initVoicePage() {
  renderVoiceModes();
  const modes = document.getElementById('voiceModes');
  if (modes && !modes.dataset.bound) {
    modes.dataset.bound = '1';
    modes.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-voice-mode]');
      if (!button) return;
      voiceMode = button.getAttribute('data-voice-mode');
      renderVoiceModes();
      await applyVoiceMode();
    });
  }
  const input = document.getElementById('voiceFileInput');
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      voiceSource = input.files?.[0] || null;
      setVoiceSourceName(voiceSource?.name || '');
      await applyVoiceMode();
    });
  }
  const record = document.getElementById('voiceRecordBtn');
  if (record && !record.dataset.bound) {
    record.dataset.bound = '1';
    record.addEventListener('click', () => startVoiceRecording());
  }
  const stop = document.getElementById('voiceStopBtn');
  if (stop && !stop.dataset.bound) {
    stop.dataset.bound = '1';
    stop.addEventListener('click', () => { try { voiceRecorder?.stop(); } catch (_e) { /* already stopped */ } });
  }
  const save = document.getElementById('voiceSaveBtn');
  if (save && !save.dataset.bound) {
    save.dataset.bound = '1';
    save.addEventListener('click', () => {
      if (!voiceResult) {
        showNotification(state.language === 'en' ? 'Nothing has been processed yet.' : 'هنوز چیزی پردازش نشده است.', 'info');
        return;
      }
      downloadBlob(voiceResult.blob, `voice-${voiceResult.mode}.wav`);
    });
  }
}
window.initVoicePage = initVoicePage;

function initMetadataPage() {
  const input = document.getElementById('metadataFileInput');
  if (input && !input.dataset.bound) {
    input.dataset.bound = '1';
    input.addEventListener('change', async () => {
      metadataFile = input.files?.[0] || null;
      await reloadMetadataFile();
    });
  }
  const fields = document.getElementById('metadataFields');
  if (fields && !fields.dataset.bound) {
    fields.dataset.bound = '1';
    fields.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-metadata-clear]');
      if (!button || !metadataFile) return;
      const out = await window.PoorijaMetadata.clearField(metadataFile, button.getAttribute('data-metadata-clear'));
      if (!out.cleared) {
        showNotification(state.language === 'en'
          ? 'That field could not be cleared in this format.'
          : 'این فیلد در این فرمت پاک نشد.', 'warning');
        return;
      }
      /* Work on the result, so several fields can be cleared one after another
         before anything is saved. */
      metadataFile = new File([out.blob], metadataFile.name, { type: metadataFile.type });
      await reloadMetadataFile();
      downloadBlob(metadataFile, metadataFile.name.replace(/(\.[^.]+)?$/, '-edited$1'));
    });
  }
  const strip = document.getElementById('metadataStripBtn');
  if (strip && !strip.dataset.bound) {
    strip.dataset.bound = '1';
    strip.addEventListener('click', async () => {
      if (!metadataFile) return;
      const out = await window.PoorijaMetadata.stripMetadata(metadataFile);
      if (!out.supported) {
        showNotification(state.language === 'en'
          ? 'That format is not recognised, so nothing was removed.'
          : 'این فرمت شناخته نشد، پس چیزی حذف نشد.', 'warning');
        return;
      }
      metadataStrippedSize = out.blob.size;
      renderMetadataFields();
      downloadBlob(out.blob, metadataFile.name.replace(/(\.[^.]+)?$/, '-clean$1'));
    });
  }
  const save = document.getElementById('metadataSaveBtn');
  if (save && !save.dataset.bound) {
    save.dataset.bound = '1';
    save.addEventListener('click', async () => {
      if (!metadataFile || !metadataRead) return;
      const changes = {};
      document.querySelectorAll('[data-metadata-input]').forEach((el) => {
        const id = el.getAttribute('data-metadata-input');
        const before = metadataRead.fields.find((f) => f.id === id);
        if (before && String(before.value) !== el.value) changes[id] = el.value;
      });
      if (!Object.keys(changes).length) {
        showNotification(state.language === 'en' ? 'Nothing was changed.' : 'چیزی تغییر نکرده است.', 'info');
        return;
      }
      const out = await window.PoorijaMetadata.writeMetadata(metadataFile, changes);
      if (out.skipped.length) {
        showNotification(state.language === 'en'
          ? `${out.skipped.length} field(s) cannot be rewritten in this format — clear them instead.`
          : `${out.skipped.length} فیلد در این فرمت قابل بازنویسی نیست — به‌جایش پاکشان کنید.`, 'warning');
      }
      if (out.applied.length) downloadBlob(out.blob, metadataFile.name.replace(/(\.[^.]+)?$/, '-edited$1'));
    });
  }
  renderMetadataFields();
}
window.initMetadataPage = initMetadataPage;

function initAboutPage() {
  const card = document.getElementById('aboutCard');
  if (!card || card.dataset.aboutBound === '1') return;
  card.dataset.aboutBound = '1';

  const copyBtn = document.getElementById('aboutDonateAddress');
  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ABOUT_WALLET);
    } catch (error) {
      /* Clipboard permission can be refused; select the text instead so the
         address is still one keystroke away. */
      const range = document.createRange();
      const code = copyBtn.querySelector('code');
      if (code) { range.selectNodeContents(code); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(range); }
    }
    copyBtn.classList.add('is-copied');
    showNotification(getTranslatedText('addressCopied'), 'success');
    setTimeout(() => copyBtn.classList.remove('is-copied'), 1600);
  });

  const qrBtn = document.getElementById('aboutDonateQrBtn');
  const qrBox = document.getElementById('aboutDonateQr');
  qrBtn?.addEventListener('click', () => {
    if (!qrBox) return;
    const opening = qrBox.classList.contains('hidden');
    qrBox.classList.toggle('hidden', !opening);
    qrBox.setAttribute('aria-hidden', String(!opening));
    const label = qrBtn.querySelector('span');
    if (label) label.textContent = opening ? getTranslatedText('hideQr') : getTranslatedText('showQr');
    if (opening && !qrBox.dataset.drawn) {
      try {
        if (window.PoorijaQR) {
          /* Through the kit so this code gets the quiet zone every other code
             in the app gets. Drawn straight into the box it had none, and a
             reader that cannot find the border often will not even try. */
          window.PoorijaQR.render(qrBox, `ton://transfer/${ABOUT_WALLET}`,
            { preset: 'classic', px: 220, quiet: 4 });
          qrBox.dataset.drawn = '1';
        } else if (typeof QRCode !== 'undefined') {
          new QRCode(qrBox, { text: `ton://transfer/${ABOUT_WALLET}`, width: 190, height: 190,
            correctLevel: QRCode.CorrectLevel.M });
          qrBox.dataset.drawn = '1';
        } else {
          qrBox.textContent = ABOUT_WALLET;
        }
      } catch (error) {
        qrBox.textContent = ABOUT_WALLET;
      }
    }
  });

  /* A shield that leans toward the pointer. Pointer-driven, so it costs
     nothing when nobody is hovering, and it is skipped outright for anyone who
     asked for less motion. */
  const shield = card.querySelector('.w-32.h-32');
  const still = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (shield && !still.matches && window.matchMedia('(hover: hover)').matches) {
    const lean = (event) => {
      const box = shield.getBoundingClientRect();
      const x = (event.clientX - (box.left + box.width / 2)) / box.width;
      const y = (event.clientY - (box.top + box.height / 2)) / box.height;
      shield.style.setProperty('--lean-x', `${Math.max(-1, Math.min(1, x)) * 12}deg`);
      shield.style.setProperty('--lean-y', `${Math.max(-1, Math.min(1, y)) * -12}deg`);
    };
    card.addEventListener('pointermove', lean);
    card.addEventListener('pointerleave', () => {
      shield.style.setProperty('--lean-x', '0deg');
      shield.style.setProperty('--lean-y', '0deg');
    });
  }
}
window.addEventListener('poorija:tab-switched', (event) => {
  if (event.detail?.tabName === 'about') initAboutPage();
  if (event.detail?.tabName === 'help') initHelpPage();
  if (event.detail?.tabName === 'metadata') initMetadataPage();
  if (event.detail?.tabName === 'voice') initVoicePage();
  if (event.detail?.tabName === 'vault') initVaultPage();
});

function initializePwaCapabilityHooks() {
if (window.matchMedia) {
['(display-mode: standalone)', '(display-mode: window-controls-overlay)'].forEach((query) => {
const mediaQuery = window.matchMedia(query);
if (mediaQuery?.addEventListener) {
mediaQuery.addEventListener('change', () => {
syncPwaRuntimeState();
syncWindowControlsOverlayUi();
setInstallButtonsVisibility();
syncAppBadge();
});
}
});
}
if (navigator.windowControlsOverlay?.addEventListener) {
navigator.windowControlsOverlay.addEventListener('geometrychange', () => {
syncWindowControlsOverlayUi();
});
}
if (navigator.serviceWorker) {
navigator.serviceWorker.addEventListener('message', (event) => {
if (event.data?.type === 'share-target-ready') {
consumeShareTargetPayloadFromCache();
}
});
}
if ('launchQueue' in window && typeof window.launchQueue.setConsumer === 'function') {
window.launchQueue.setConsumer(async (launchParams) => {
const files = [];
for (const handle of launchParams?.files || []) {
try {
files.push(await handle.getFile());
} catch (error) {
console.error(error);
}
}
if (files.length) {
state.pendingLaunchFiles = files;
syncAppBadge();
if (!state.isLocked) {
await consumePendingLaunchFiles();
}
}
});
}
document.addEventListener('visibilitychange', () => {
if (!document.hidden && state.activeTab === 'chat') {
clearUnreadChatCount();
}
});
window.addEventListener('focus', () => {
if (state.activeTab === 'chat') {
clearUnreadChatCount();
}
});
window.addEventListener('poorija:chat-unread', (event) => {
state.unreadChatCount += Math.max(1, Number(event.detail?.count || 1));
syncAppBadge();
});
window.addEventListener('poorija:chat-read', (event) => {
state.unreadChatCount = Math.max(0, state.unreadChatCount - Math.max(1, Number(event.detail?.count || 1)));
syncAppBadge();
});
watchBackgroundNoticeCount();
}
function isDesktopViewport() {
return window.matchMedia('(min-width: 1024px)').matches;
}
function toggleSidebar(forceState) {
const sidebar = document.getElementById('appSidebar');
const overlay = document.getElementById('sidebarOverlay');
const toggleBtn = document.getElementById('mobileNavToggle');
if (!sidebar || !overlay) return;
const shouldOpen = typeof forceState === 'boolean'
? forceState
: !sidebar.classList.contains('open');
if (isDesktopViewport()) {
sidebar.classList.remove('open');
overlay.classList.add('hidden');
return;
}
sidebar.classList.toggle('open', shouldOpen);
overlay.classList.toggle('hidden', !shouldOpen);
document.documentElement.classList.toggle('mobile-sidebar-open', shouldOpen);
const label = translations[state.language][shouldOpen ? 'closeMenu' : 'openMenu'];
if (toggleBtn) {
toggleBtn.setAttribute('aria-label', label);
toggleBtn.setAttribute('title', label);
toggleBtn.innerHTML = `<i class="fas fa-${shouldOpen ? 'xmark' : 'bars'} text-lg"></i>`;
}
}
function syncResponsiveShell() {
/* The layout class the stylesheet keys off — mobile-browser-context, and the
   ~900 rules behind it — was decided once at startup by syncPwaRuntimeState()
   and never revisited. A browser tab is usually opened at the size it stays
   at, so the web build got away with it; a native window is dragged around,
   and it kept whichever layout it happened to start in. isMobileBrowserContext
   is already a width question, so the answer simply has to be asked again
   every time the width changes, which is what this function is for. */
syncPwaRuntimeState();
const overlay = document.getElementById('sidebarOverlay');
const sidebar = document.getElementById('appSidebar');
const header = document.getElementById('appHeader');
const toggleBtn = document.getElementById('mobileNavToggle');
if (!overlay || !sidebar) return;
window.updateViewportHeight?.();
const visualViewport = window.visualViewport;
const viewportHeight = Math.round(visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0);
const viewportOffsetTop = Math.max(0, Math.round(visualViewport?.offsetTop || 0));
const isMobileRuntime = isMobileBrowserContext();
const windowHeight = window.innerHeight;
// More precise keyboard detection for iOS/Android PWA
const keyboardInset = Math.max(0, Math.round(windowHeight - viewportHeight - viewportOffsetTop));
/* An inset alone does not mean a keyboard. In a mobile browser the collapsing
   URL bar and the bottom toolbar move visualViewport.height by 60-120px as the
   page scrolls, and on the taller chrome that crossed the old flat 110px line:
   the tab bar (hidden while the keyboard is up) blinked out and back on every
   scroll. Two conditions separate the two cases — a keyboard needs something
   editable to be focused, and it takes far more of the window than a toolbar
   does — plus hysteresis, so an inset hovering at the threshold cannot flap. */
const editableFocused = isEditableTarget(document.activeElement);
const keyboardWasOpen = document.documentElement.classList.contains('keyboard-open');
const keyboardThreshold = keyboardWasOpen
? Math.max(80, windowHeight * 0.12)
: Math.max(140, windowHeight * 0.2);
const keyboardOpen = isMobileRuntime && editableFocused && keyboardInset > keyboardThreshold;
const isStandalone = isStandaloneWebApp();
// On iOS PWA, offsetTop often represents the status bar height
const safeTopInset = isStandalone ? viewportOffsetTop : 0;
const headerRectHeight = header ? Math.round(header.getBoundingClientRect().height || header.offsetHeight || 0) : 0;
const headerHeight = Math.max(header?.offsetHeight || 0, headerRectHeight);
/* There is no footer element in this layout — the chat runs to the bottom of
   the viewport — so the height it would occupy is zero. Kept as a named value
   rather than dropped because the CSS still subtracts it, and a reader deserves
   to see the zero rather than wonder where the variable went. */
const footerHeight = 0;
// Keyboard closed → let the pure-CSS 100dvh rules own the layout (no stale px letterbox).
if (keyboardOpen) {
document.documentElement.style.setProperty('--app-height', `${Math.max(320, windowHeight)}px`);
document.documentElement.style.setProperty('--app-window-height', `${Math.max(320, windowHeight)}px`);
document.documentElement.style.setProperty('--app-viewport-height', `${Math.max(320, viewportHeight)}px`);
document.documentElement.style.setProperty('--app-visual-height', `${Math.max(320, viewportHeight)}px`);
} else {
['--app-height', '--app-window-height', '--app-viewport-height']
.forEach((prop) => document.documentElement.style.removeProperty(prop));
}
/* Always, keyboard or not, and under a name nothing else touches.
   --app-visual-height is deliberately forced to 100dvh by the full-bleed rules
   while no keyboard is up (see "Full-bleed PWA layer" in styles.css), so a
   layer that has to end exactly where the keyboard begins cannot read it: with
   the keys up it is right, and the rest of the time it is the window. This one
   is only ever the measured visible height. */
document.documentElement.style.setProperty('--app-live-height', `${Math.max(320, viewportHeight)}px`);
document.documentElement.style.setProperty('--app-visual-offset-top', `${viewportOffsetTop}px`);
document.documentElement.style.setProperty('--app-keyboard-inset', `${keyboardInset}px`);
document.documentElement.style.setProperty('--mobile-keyboard-bottom', `${keyboardOpen ? keyboardInset : 0}px`);
document.documentElement.style.setProperty('--app-header-height', `${headerHeight}px`);
document.documentElement.style.setProperty('--app-footer-height', `${footerHeight}px`);
const chatAvailableHeight = viewportHeight - headerHeight - footerHeight;
document.documentElement.style.setProperty('--app-chat-available-height', `${Math.max(300, chatAvailableHeight)}px`);
document.documentElement.classList.toggle('keyboard-open', keyboardOpen);
document.documentElement.classList.toggle('pwa-standalone', isStandalone);
if (isDesktopViewport()) {
overlay.classList.add('hidden');
sidebar.classList.remove('open');
document.documentElement.classList.remove('mobile-sidebar-open');
}
if (toggleBtn) {
toggleBtn.classList.toggle('hidden', isDesktopViewport());
}
setInstallButtonsVisibility();
}
function getHashTabName() {
const candidate = window.location.hash.replace('#', '').trim().toLowerCase();
const validTabs = getDefaultTabOrder();
return validTabs.includes(candidate) ? candidate : null;
}
function applyTabFromLocation() {
const nextTab = getHashTabName() || state.activeTab || 'encrypt';
switchTab(nextTab, { updateHash: false });
}
function getDesktopInvoke() {
return window.__POORIJA_DESKTOP_INVOKE__ || null;
}
function isDesktopAppRuntime() {
return Boolean(window.__POORIJA_DESKTOP__);
}
function syncDesktopRuntimeClass() {
document.documentElement.classList.toggle(DESKTOP_RUNTIME_CLASS, isDesktopAppRuntime());
}
async function invokeDesktopCommand(command, payload = {}) {
const invoke = getDesktopInvoke();
if (!invoke) {
throw new Error('Desktop runtime command bridge is unavailable');
}
return invoke(command, payload);
}
function getDesktopDialogApi() {
return window.__POORIJA_DESKTOP_DIALOG__ || null;
}
function getDesktopNotificationApi() {
return window.__POORIJA_DESKTOP_NOTIFICATION__ || null;
}
function getBrowserPushSupport() {
const supported = Boolean(
!isDesktopAppRuntime()
&& window.isSecureContext
&& 'serviceWorker' in navigator
&& 'PushManager' in window
&& 'Notification' in window
);
return {
supported,
permission: supported ? Notification.permission : 'default'
};
}
/* What stopped the subscription, in words the reader can act on.
 *
 * "Push failed" is true and useless. Every browser that refuses one refuses it
 * for its own reason, and most of those reasons are a setting the reader can
 * change in ten seconds - if somebody tells them which. */
let lastPushFailure = '';
async function isBraveBrowser() {
  try { return Boolean(await navigator.brave?.isBrave?.()); } catch (_error) { return false; }
}
/* Whether this is an iPhone or an iPad, however the page is being displayed.
   iPadOS reports itself as a Mac, so the touch-point count is what separates
   an iPad from a desktop Safari. */
function isAppleMobile() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return /Mac/i.test(navigator.platform || '') && (navigator.maxTouchPoints || 0) > 1;
}

function browserFamily() {
  const ua = navigator.userAgent || '';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Vivaldi/.test(ua)) return 'vivaldi';
  if (/OPR\//.test(ua)) return 'opera';
  if (/Edg\//.test(ua)) return 'edge';
  if (/CriOS|Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  /* An iOS web app launched from the Home Screen drops `Safari/` and
     `Version/` from its user agent, so every check above missed and an iPhone
     — the one platform with genuinely iOS-specific push rules — was handed the
     generic "this browser refused it" advice. Every engine on iOS is WebKit
     anyway, so the platform is the honest answer here, not the brand. */
  if (isAppleMobile()) return 'safari';
  return 'other';
}
const PUSH_FIXES = {
  brave: [
    'Brave سرویس پوشی را که این قابلیت به آن نیاز دارد به‌صورت پیش‌فرض خاموش می‌کند. در brave://settings/privacy گزینهٔ «Use Google services for push messaging» را روشن کنید، Brave را ببندید و باز کنید، بعد پوش را یک بار خاموش و روشن کنید.',
    'Brave switches off the push service this needs. Open brave://settings/privacy, turn on "Use Google services for push messaging", restart Brave, then switch push off and on again.',
  ],
  vivaldi: [
    'در Vivaldi بررسی کنید که در vivaldi://settings/privacy سرویس پوش گوگل خاموش نشده باشد، و اعلان برای این سایت مسدود نباشد.',
    'In Vivaldi, check that the Google push service is not switched off in vivaldi://settings/privacy, and that notifications are not blocked for this site.',
  ],
  opera: [
    'در Opera بررسی کنید که اعلان برای این سایت مسدود نباشد: opera://settings/content/notifications',
    'In Opera, check that notifications are not blocked for this site: opera://settings/content/notifications',
  ],
  edge: [
    'در Edge بررسی کنید که اعلان برای این سایت مجاز باشد: edge://settings/content/notifications — و حالت «عدم مزاحمت» ویندوز خاموش باشد.',
    'In Edge, check that notifications are allowed for this site: edge://settings/content/notifications — and that Windows Focus Assist is off.',
  ],
  chrome: [
    'در Chrome بررسی کنید که اعلان برای این سایت مجاز باشد: chrome://settings/content/notifications',
    'In Chrome, check that notifications are allowed for this site: chrome://settings/content/notifications',
  ],
  firefox: [
    'فایرفاکس سرویس پوش خودش را دارد و باید کار کند. بررسی کنید که در about:preferences#privacy اعلان برای این سایت مسدود نباشد و dom.push.enabled در about:config روشن باشد. توجه: فایرفاکسِ دسکتاپ نصب برنامه به شکل PWA را پشتیبانی نمی‌کند — اعلان در تب معمولی کار می‌کند.',
    'Firefox has its own push service and this should work. Check that notifications are not blocked for this site in about:preferences#privacy, and that dom.push.enabled is true in about:config. Note that Firefox on the desktop cannot install this as an app - notifications work in an ordinary tab.',
  ],
  safari: [
    'در سافاری، اعلان پس‌زمینه فقط وقتی کار می‌کند که برنامه از «افزودن به صفحهٔ اصلی» نصب شده باشد و اعلان‌ها در تنظیمات سیستم برایش مجاز باشد.',
    'In Safari, background notifications only work when the app was installed with "Add to Home Screen" and notifications are allowed for it in system settings.',
  ],
  other: [
    'سرویس پوش این مرورگر اشتراک را نپذیرفت. تنظیمات حریم خصوصی و اعلانِ خود مرورگر را بررسی کنید.',
    'This browser\'s push service refused the subscription. Check the browser\'s own privacy and notification settings.',
  ],
};
async function describePushFailure(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  const serviceRefused = /push service|AbortError|NotAllowedError|Registration failed|not permitted|permission denied/i.test(text);
  if (!serviceRefused) return String(error?.message || '').slice(0, 160);
  const family = await isBraveBrowser() ? 'brave' : browserFamily();
  const pair = PUSH_FIXES[family] || PUSH_FIXES.other;
  return state.language === 'en' ? pair[1] : pair[0];
}
window.__pushFailureProbe = () => lastPushFailure;
/* Lets a harness ask for each browser's advice without pretending to be that
   browser: the mapping is the thing worth pinning, not the sniffing. */
window.__pushAdviceProbe = (family) => {
  const pair = PUSH_FIXES[family] || PUSH_FIXES.other;
  return state.language === 'en' ? pair[1] : pair[0];
};

function base64UrlToUint8Array(value) {
const padding = '='.repeat((4 - (value.length % 4)) % 4);
const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
const raw = window.atob(base64);
const output = new Uint8Array(raw.length);
for (let index = 0; index < raw.length; index += 1) {
output[index] = raw.charCodeAt(index);
}
return output;
}
async function fetchVapidPublicKey(serverOrigin = window.location.origin) {
const response = await fetch(new URL('/push/vapid-public-key', serverOrigin), {
headers: { accept: 'application/json' },
cache: 'no-store'
});
if (!response.ok) throw new Error('VAPID public key is unavailable');
const payload = await response.json();
if (!payload?.enabled || !payload?.publicKey) throw new Error('Web Push is disabled on this relay');
return payload.publicKey;
}
async function ensureWebPushPermission(promptForAccess = false) {
const support = getBrowserPushSupport();
if (!support.supported) {
state.webPush = {
supported: false,
permission: 'default',
subscribed: false,
endpoint: ''
};
syncDesktopNotificationUi();
return { supported: false, granted: false, permission: 'default' };
}
let permission = Notification.permission;
if (permission === 'default' && promptForAccess) {
permission = await Notification.requestPermission();
}
state.webPush = {
...state.webPush,
supported: true,
permission,
};
syncDesktopNotificationUi();
return {
supported: true,
granted: permission === 'granted',
permission
};
}
/* On unless somebody turns it off. A person sending a photograph from their
   phone should not have to know what EXIF is to avoid sending their home
   address with it - the safe reading of an absent setting is the safe one. */
function metadataSettings() {
  const stored = state.settings.metadata || {};
  return {
    stripOnSend: stored.stripOnSend !== false,
    /* Offered, not automatic: re-encoding a photograph is lossy and changes
       the file, which is not a decision to make on somebody's behalf. */
    offerHeicConvert: stored.offerHeicConvert !== false,
  };
}

function pushSettings() {
  const stored = state.settings.push || {};
  return {
    enabled: Boolean(stored.enabled),
    ttlDays: PUSH_TTL_CHOICES.includes(Number(stored.ttlDays)) ? Number(stored.ttlDays) : 30,
    asked: Boolean(stored.asked),
  };
}
const PUSH_TTL_CHOICES = [30, 60, 90, 120, 180];

/* Which step of the registration failed, in a sentence, plus the technical
   detail written where a report can find it.
 *
 * Four things can fail here — the relay's key, the browser's push service, the
 * relay's acceptance, and the permission — and until now only ONE of them
 * (the push service) produced anything but "could not register the
 * subscription". The other three collapsed into that one sentence with nothing
 * to tell them apart, which is why an iPhone reporting it could not be
 * diagnosed at all. The reader still gets one line; the rest goes to
 * poorija_push_last_error. */
const PUSH_STEP_TEXT = {
  key: ['رلهٔ انتخابی کلید اعلان را نداد. آدرس سرور را بررسی کنید یا کمی بعد دوباره امتحان کنید.',
        'The relay did not hand over its notification key. Check the server address, or try again shortly.'],
  worker: ['سرویس‌ورکر این نصب آماده نشد. برنامه را ببندید و از آیکون صفحهٔ اصلی دوباره باز کنید.',
           'This install\'s service worker never became ready. Close the app and reopen it from the Home Screen icon.'],
  relay: ['رله اشتراک را نپذیرفت. کمی بعد دوباره امتحان کنید.',
          'The relay refused the subscription. Try again shortly.'],
  iosTab: ['اعلان پس‌زمینه در iOS فقط برای برنامه‌ای کار می‌کند که با «افزودن به صفحهٔ اصلی» نصب شده و از همان آیکون باز شود.',
           'On iOS, background notifications only work for an app installed with "Add to Home Screen" and opened from that icon.'],
  /* The one nobody planned for. It still names itself, because a failure with
     no name is what made the iOS report impossible to act on. */
  unknown: ['ثبت اشتراک در جایی غیرمنتظره متوقف شد. جزئیاتش ثبت شد.',
            'Registration stopped somewhere unexpected. The detail has been recorded.'],
  identity: ['هویت چت امن هنوز روی این دستگاه آماده نیست. یک بار تب «چت امن» را باز کنید و دوباره امتحان کنید.',
             'This device has no Secure Chat identity yet. Open the Secure Chat tab once, then try again.'],
  gesture: ['یک بار دیگر روی همین کلید بزنید — مرورگر اجازه را گرفت ولی مهلت لمس تمام شده بود.',
            'Tap the switch once more — permission was granted but the tap had expired by the time the browser was asked.'],
};

function notePushFailure(step, error) {
  const pair = PUSH_STEP_TEXT[step];
  if (pair) lastPushFailure = state.language === 'en' ? pair[1] : pair[0];
  try {
    localStorage.setItem('poorija_push_last_error', JSON.stringify({
      at: new Date().toISOString(),
      step,
      name: error?.name || '',
      message: String(error?.message || error || '').slice(0, 200),
      standalone: Boolean(state.pwa?.standalone),
      appleMobile: isAppleMobile(),
      family: browserFamily(),
      permission: (typeof Notification !== 'undefined' && Notification.permission) || 'unknown',
      relay: String(serverOriginForReport || ''),
    }));
  } catch (_e) { /* reporting must never throw */ }
}
let serverOriginForReport = '';

/* The service worker and the relay's key, fetched before they are needed.
 *
 * WebKit gives a page about five seconds of "transient activation" after a
 * tap, and both requestPermission() and — on iOS — subscribe() want to happen
 * inside it. The registration used to spend that window on two awaits and a
 * NETWORK ROUND TRIP to the relay for the VAPID key, all of it between the
 * permission being granted and the subscribe call. On a phone on mobile data
 * that is easily five seconds, and subscribe() then fails with NotAllowedError
 * and no explanation, which is exactly the shape of the iOS report.
 *
 * So both are warmed ahead of time — when the settings panel renders, and
 * again before the consent dialog goes up, while the person is reading it.
 * By the time permission is granted, subscribe() is the very next thing. */
const PUSH_PRIME_TTL_MS = 60000;
let pushPrimed = { at: 0, origin: '', registration: null, publicKey: '' };

async function primePushPrerequisites(serverOrigin = window.location.origin) {
  const origin = String(serverOrigin || '');
  if (pushPrimed.origin === origin && Date.now() - pushPrimed.at < PUSH_PRIME_TTL_MS
      && pushPrimed.registration && pushPrimed.publicKey) {
    return pushPrimed;
  }
  const next = { at: Date.now(), origin, registration: null, publicKey: '' };
  try {
    if ('serviceWorker' in navigator) next.registration = await navigator.serviceWorker.ready;
  } catch (_error) { /* the caller reports it with its own step */ }
  try {
    next.publicKey = await fetchVapidPublicKey(origin);
  } catch (_error) { /* same */ }
  if (next.registration && next.publicKey) pushPrimed = next;
  return next;
}
window.primePushPrerequisites = primePushPrerequisites;

/* The application server key this device subscribed with, kept beside the
   endpoint it belongs to. Device-level, not per-profile: push is a property of
   the installation, and the lock screen's own re-registration reads it. */
const PUSH_KEY_MEMO = 'poorija_push_server_key';

function rememberPushKey(endpoint, key) {
  if (!endpoint || !key?.length) return;
  try {
    localStorage.setItem(PUSH_KEY_MEMO, JSON.stringify({
      endpoint: String(endpoint).slice(0, 2048),
      key: arrayBufferToBase64(key),
    }));
  } catch (_error) { /* private mode: the comparison falls back to "keep it" */ }
}

function rememberedPushKey(endpoint) {
  try {
    const stored = JSON.parse(localStorage.getItem(PUSH_KEY_MEMO) || 'null');
    if (!stored || stored.endpoint !== String(endpoint)) return null;
    return new Uint8Array(base64ToArrayBuffer(stored.key));
  } catch (_error) {
    return null;
  }
}

async function registerWebPushSubscription(fingerprint, serverOrigin = window.location.origin, promptForAccess = false) {
serverOriginForReport = String(serverOrigin || '');
/* A message from the last attempt is not a report on this one. */
lastPushFailure = '';
try {
  return await runWebPushRegistration(fingerprint, serverOrigin, promptForAccess);
} catch (error) {
  /* Every step above sets its own; anything that got here without one is a
     path nobody instrumented, and it gets named rather than silently falling
     back to "could not register the subscription" — which is the exact toast
     an iPhone showed while telling nobody anything. */
  if (!lastPushFailure) notePushFailure('unknown', error);
  throw error;
}
}

async function runWebPushRegistration(fingerprint, serverOrigin, promptForAccess) {
/* Two switches have to be on: notifications in general, and background push in
   particular. The second is the one that involves anybody else. */
if (!state.settings.notifications) return { ok: false, reason: 'disabled' };
if (!pushSettings().enabled) return { ok: false, reason: 'push-off' };
const permission = await ensureWebPushPermission(promptForAccess);
if (!permission.granted) return { ok: false, reason: permission.permission };
/* iOS grants Web Push only to a web app installed on the Home Screen and
   opened from that icon. In a Safari tab the APIs are absent and this never
   gets here; in a webview that reports them but is not standalone, subscribe()
   fails with nothing to explain it. Say so instead. */
if (isAppleMobile() && !isStandaloneWebApp()) {
  notePushFailure('iosTab', new Error('not a Home Screen web app'));
  throw new Error('push needs a Home Screen web app on iOS');
}
/* Warm if primePushPrerequisites() has already run for this relay; otherwise
   fetched here, which is the slow path this exists to avoid. */
const warm = (pushPrimed.origin === String(serverOrigin || '')
  && Date.now() - pushPrimed.at < PUSH_PRIME_TTL_MS) ? pushPrimed : null;
let registration = warm?.registration || null;
if (!registration) {
  try {
    registration = await navigator.serviceWorker.ready;
  } catch (error) {
    notePushFailure('worker', error);
    throw error;
  }
}
let publicKey = warm?.publicKey || '';
if (!publicKey) {
  try {
    publicKey = await fetchVapidPublicKey(serverOrigin);
  } catch (error) {
    notePushFailure('key', error);
    throw error;
  }
}
/* A subscription is bound to the server key it was made with. The relay's
   VAPID pair used to be regenerated on every restart, so devices are carrying
   subscriptions signed for a key that no longer exists — the push service
   rejects those and nothing arrives, silently. Reuse an existing subscription
   only when it was made for the key the relay is using now. */
const wantedKey = base64UrlToUint8Array(publicKey);
const existing = await registration.pushManager.getSubscription();
let reusable = null;
if (existing) {
  /* Which key this subscription was made with.
   *
   * `PushSubscription.options` is a Chromium and Firefox convenience; WebKit
   * does not hand it back, so on iOS the comparison below read an EMPTY key,
   * decided it did not match, and unsubscribed and re-subscribed on EVERY
   * call — including the one that runs on every reconnect. That is endpoint
   * churn on the one platform whose push service is least forgiving of it.
   *
   * So the key is also remembered here, under the endpoint it belongs to. When
   * the engine offers `options` that still wins; when it does not, our own note
   * answers instead of a blank. */
  const remembered = rememberedPushKey(existing.endpoint);
  const fromEngine = existing.options?.applicationServerKey;
  const current = fromEngine
    ? new Uint8Array(fromEngine)
    : (remembered || null);
  const matches = current
    ? current.length === wantedKey.length && current.every((byte, index) => byte === wantedKey[index])
    /* Neither source could say. Re-subscribing on a guess is the expensive
       wrong answer, so keep what exists and let the relay's own key rotation
       notice be what forces a new one. */
    : true;
  if (matches) {
    reusable = existing;
  } else {
    console.info('[Push] the relay signs with a different key now; re-subscribing.');
    /* Tell the relay too. Dropping it only on this device leaves the old row
       on the server, and the next message wakes the phone once per row — which
       is what turned one message into several notifications. */
    await fetch(new URL('/push/unsubscribe', serverOrigin), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fingerprint, endpoint: existing.endpoint }),
    }).catch(() => {});
    await existing.unsubscribe().catch(() => {});
  }
}
let subscription = reusable;
if (!subscription) {
  /* Two things WebKit does that the other engines do not.
   *
   * It wants transient activation for subscribe(), and it will not take a new
   * subscription in the same turn as the unsubscribe that freed the slot. Both
   * answer with a rejection that says nothing useful, so both get one patient
   * retry before this is called a failure — and if the second try still says
   * NotAllowed, the tap really is gone and the person is told to tap again,
   * which is one short sentence and actually works. */
  const trySubscribe = () => registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: wantedKey,
  });
  try {
    try {
      subscription = await trySubscribe();
    } catch (first) {
      const name = String(first?.name || '');
      if (!/NotAllowedError|InvalidStateError|AbortError/.test(name)) throw first;
      await new Promise((resolve) => setTimeout(resolve, 600));
      subscription = await trySubscribe();
    }
    rememberPushKey(subscription.endpoint, wantedKey);
  } catch (error) {
    /* Chromium delivers web push through the browser's own push service, and
       Brave ships with that service switched off as a privacy default. The
       subscribe call then fails with a push-service error and the reader is
       told only that push "failed" - which is true and useless, because the
       cause is one setting they can change. */
    if (/NotAllowedError/.test(String(error?.name || '')) && Notification.permission === 'granted') {
      /* Permission is granted and the browser still refused: on WebKit that
         means the tap had expired by the time we asked. Not a setting to
         change — just a thing to do again. */
      notePushFailure('gesture', error);
      throw error;
    }
    notePushFailure('service', error);
    /* The per-engine advice is better than the generic line for this step, so
       it wins — but the record above is written either way, which is what the
       other three steps do too. */
    lastPushFailure = await describePushFailure(error);
    throw error;
  }
}
/* The relay files the subscription under the chat identity, so it is needed
   HERE and not a moment earlier — subscribe() has already happened, so waiting
   for it now costs nothing that WebKit is counting.
 *
 * It used to be read at the top of this function from a cache that is only
 * filled once the messenger has started, and an empty one returned
 * `{ ok:false, reason:'disabled' }` — a silent early return, no message, no
 * record. Somebody who unlocked the app, went straight to Settings and turned
 * background notifications on therefore got "could not register the
 * subscription" and nothing else, which is exactly what was reported from an
 * iPhone. The caller now hands over a promise that prepares the identity. */
const readyFingerprint = String((await Promise.resolve(fingerprint).catch(() => '')) || '');
if (!readyFingerprint) {
  const missing = new Error('no Secure Chat identity on this device');
  notePushFailure('identity', missing);
  throw missing;
}

/* The POST can fail as an exception rather than a status: a network that
   dropped, a relay address with no scheme (new URL throws), a TLS the phone
   will not accept. None of those were caught, so they escaped past every step
   above and arrived at the caller as a bare "could not register" — which is
   precisely the message this whole exercise exists to stop producing. */
/* The relay will not take a fingerprint's word for a subscription, and it
   should not: without proof, anybody who could reach it could register THEIR
   endpoint against SOMEBODY ELSE'S fingerprint and be told every time that
   person received a message. So ask for a challenge, open it with the private
   half of this identity, and hand the answer back with the subscription. */
let proof = null;
try {
  const identity = await window.PoorijaChat?.identityProof?.();
  if (!identity) throw new Error('no Secure Chat identity to prove');
  const challenge = await fetch(new URL('/push/challenge', serverOrigin), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }),
  }).then((r) => readRelayJson(r, 'challenge'));
  if (!challenge?.ok) throw new Error(`relay refused a push challenge: ${challenge?.reason || 'unknown'}`);
  proof = { challengeId: challenge.challengeId, nonce: await identity.solve(challenge.cipher) };
} catch (error) {
  notePushFailure('identity', error);
  throw error;
}

let response;
try {
response = await fetch(new URL('/push/subscribe', serverOrigin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({
fingerprint: readyFingerprint,
challengeId: proof.challengeId,
nonce: proof.nonce,
subscription: subscription.toJSON(),
/* The relay drops the record when this runs out. */
ttlDays: pushSettings().ttlDays,
/* Which language the notification should arrive in. The relay cannot know —
   it has never seen this person — and until it was told, a Persian reader got
   an English line on their lock screen while every other string in the product
   was translated. Two values, and neither says anything about who they are. */
lang: state.language === 'fa' ? 'fa' : 'en',
/* One row per device rather than one per endpoint. A device that
   re-subscribes gets a NEW endpoint, and keying on the endpoint alone left
   the old ones in place — every stale row then woke the same phone again for
   the same message. This is a hash of the installation secret: the relay
   already holds the endpoint, which identifies the device far more
   precisely, so it reveals nothing new. */
deviceId: await getInstallationBindingHash().catch(() => ''),
}),
});
} catch (error) {
  notePushFailure('relay', error);
  throw error;
}
if (!response.ok) {
  const failure = new Error(`relay answered ${response.status}`);
  notePushFailure('relay', failure);
  throw failure;
}
state.webPush = {
supported: true,
permission: Notification.permission,
subscribed: true,
endpoint: subscription.endpoint || '',
};
syncDesktopNotificationUi();
return { ok: true };
}
/* Turning it off means the record goes from the relay too, not just from this
   device's settings. */
async function unregisterWebPushSubscription(fingerprint, serverOrigin = window.location.origin) {
  try {
    if (!('serviceWorker' in navigator)) return { ok: false, reason: 'unsupported' };
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      if (fingerprint) {
        await fetch(new URL('/push/unsubscribe', serverOrigin), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ fingerprint, endpoint: subscription.endpoint }),
        }).catch(() => {});
      }
      await subscription.unsubscribe().catch(() => {});
    }
    state.webPush = { ...state.webPush, subscribed: false, endpoint: '' };
    syncDesktopNotificationUi();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error?.message || 'failed' };
  }
}

/* The disclosure. It is deliberately specific: what leaves the device, who
   else is in the path, and what stays sealed. Declining is the default answer
   and the dialog says so before it asks. */
async function askForPushConsent() {
  const fa = state.language === 'fa';
  const message = fa
    ? [
      'اعلان در پس‌زمینه پیش‌فرض خاموش است و تا وقتی شما اجازه ندهید روشن نمی‌شود.',
      '',
      'اگر روشنش کنید:',
      '• سرویس پوشِ مرورگر شما (گوگل برای کروم و اندروید، اپل برای سافاری و آیفون، موزیلا برای فایرفاکس) وارد مسیر می‌شود و می‌بیند که این دستگاه در چه زمانی چیزی گرفته و از کدام IP سرور.',
      '• رلهٔ برنامه یک نشانی اشتراک برای دستگاه شما نگه می‌دارد تا بتواند بیدارتان کند. این نشانی با هشِ شناسه ذخیره می‌شود، نه با خودِ آن، و بعد از مدتی که خودتان انتخاب می‌کنید پاک می‌شود.',
      '',
      'آنچه هرگز فرستاده نمی‌شود: متن پیام، نام فرستنده، پیش‌نمایش و هیچ محتوایی. اعلان یکی از سه جملهٔ ثابت است — پیام تازه، تماس ورودی، یا تماس بی‌پاسخ — و بس. رمزنگاری سرتاسری پیام‌ها دست‌نخورده می‌ماند و هیچ‌کس — نه سرویس پوش و نه رله — نمی‌تواند چیزی از گفتگو بخواند.',
      '',
      'روشن شود؟',
    ].join('\n')
    : [
      'Background notifications are off by default and stay off unless you turn them on.',
      '',
      'If you turn them on:',
      "• Your browser's push service (Google for Chrome and Android, Apple for Safari and iPhone, Mozilla for Firefox) enters the path. It can see that this device received something, when, and the server IP it came from.",
      '• The relay keeps one subscription address for your device so it can wake it. It is stored under a hash of your identity rather than the identity itself, and it is deleted after a period you choose.',
      '',
      'What is never sent: message text, sender name, previews, any content at all. The notification is one of three fixed lines — a new message, an incoming call, or a missed call — and nothing more. End-to-end encryption is untouched — neither the push service nor the relay can read anything from a conversation.',
      '',
      'Turn it on?',
    ].join('\n');
  const ok = await PoorijaDialogs.confirm(message, {
    title: fa ? 'اعلان در پس‌زمینه' : 'Background notifications',
    okLabel: fa ? 'روشن کن' : 'Turn on',
    cancelLabel: fa ? 'خاموش بماند' : 'Keep it off',
  });
  /* Remembered so a second attempt does not read the same page twice — see the
     iOS note in handlePushToggleChange. */
  state.settings.push = { ...pushSettings(), asked: true, consented: Boolean(ok) };
  saveSettings();
  return Boolean(ok);
}

/* The chat identity the relay files a subscription under.
 *
 * identityFingerprint() reads a cache that only the messenger fills, so it is
 * empty for anybody who unlocked the app and walked straight into Settings.
 * ensureIdentityFingerprint() loads the stored one, or mints it if the vault
 * is open. Returned as a PROMISE on purpose: minting is an RSA keypair, and
 * awaiting it before the permission sheet would spend the tap's activation
 * window on arithmetic. It is awaited at the POST instead, long after
 * subscribe() has had its turn. */
function chatIdentityFingerprintReady() {
  const cached = window.PoorijaChat?.identityFingerprint?.() || '';
  if (cached) return Promise.resolve(cached);
  const ensure = window.PoorijaChat?.ensureIdentityFingerprint;
  return typeof ensure === 'function' ? ensure().catch(() => '') : Promise.resolve('');
}

window.handlePushToggleChange = async function handlePushToggleChange() {
  const toggle = document.getElementById('pushBackgroundToggle');
  if (!toggle) return;
  const fingerprint = window.PoorijaChat?.identityFingerprint?.() || '';
  if (toggle.checked) {
    /* Safari on iOS only honours Notification.requestPermission() inside a
       gesture, and the gesture does not always survive the round trip through
       a modal. So the explanation is read once; if the permission prompt did
       not appear, the next tap goes straight to it. */
    const alreadyConsented = pushSettings().consented && Notification.permission === 'default';
    const consented = alreadyConsented ? true : await askForPushConsent();
    if (!consented) {
      toggle.checked = false;
      state.settings.push = { ...pushSettings(), enabled: false };
      saveSettings();
      syncPushSettingsUi();
      return;
    }
    /* Consent is given; now fetch the worker handle and the relay's key while
       the system permission sheet is on screen. NOT awaited, so the sheet goes
       up on this tap rather than after a network round trip — and by the time
       somebody has read it and pressed Allow, the slow half is done and
       subscribe() can follow the grant immediately. That gap is what WebKit
       measures: it gives a page about five seconds of activation, and the
       registration used to spend them on this fetch. */
    primePushPrerequisites(chatRelayOriginForPush()).catch(() => {});
    /* Started here, awaited at the POST. Same reasoning as the priming above:
       everything slow happens while the system sheet is on screen. */
    const identityReady = chatIdentityFingerprintReady();
    const permission = await ensureWebPushPermission(true);
    if (!permission.granted) {
      toggle.checked = false;
      state.settings.push = { ...pushSettings(), enabled: false };
      saveSettings();
      syncPushSettingsUi();
      /* 'default' means the prompt never appeared — on iOS that is the lost
         gesture, and tapping again works. 'denied' is an answer. */
      showNotification(getTranslatedText(
        permission.permission === 'denied' ? 'pushPermissionDenied' : 'pushPermissionRetry',
      ), 'warning');
      return;
    }
    state.settings.push = { ...pushSettings(), enabled: true };
    saveSettings();
    const result = await registerWebPushSubscription(identityReady, chatRelayOriginForPush(), false)
      .catch((error) => ({ ok: false, reason: error?.message }));
    if (!result?.ok) {
      state.settings.push = { ...pushSettings(), enabled: false };
      toggle.checked = false;
      saveSettings();
      /* The build tag rides along with THIS one message, and only this one.
         An installed iOS web app can keep running an older shell for a launch
         or two after a deploy, and without the tag there is no way to tell a
         fix that did not work from a fix that has not arrived — which is how
         an afternoon gets spent on the wrong question. */
      showNotification(
        `${lastPushFailure || getTranslatedText('pushFailed')} (${APP_BUILD_TAG})`,
        'error');
      const hint = document.getElementById('notificationPermissionHint');
      if (hint && lastPushFailure) hint.textContent = lastPushFailure;
    } else {
      showNotification(getTranslatedText('pushOn'), 'success');
    }
  } else {
    state.settings.push = { ...pushSettings(), enabled: false };
    saveSettings();
    await unregisterWebPushSubscription(fingerprint, chatRelayOriginForPush());
    showNotification(getTranslatedText('pushOff'), 'info');
  }
  syncPushSettingsUi();
};

window.handlePushTtlChange = async function handlePushTtlChange() {
  const select = document.getElementById('pushTtlSelect');
  if (!select) return;
  const days = PUSH_TTL_CHOICES.includes(Number(select.value)) ? Number(select.value) : 30;
  state.settings.push = { ...pushSettings(), ttlDays: days };
  saveSettings();
  /* Re-register so the relay writes the new window against the same device
     rather than waiting for the old one to run out. */
  if (pushSettings().enabled) {
    const fingerprint = window.PoorijaChat?.identityFingerprint?.() || '';
    await registerWebPushSubscription(fingerprint, chatRelayOriginForPush(), false).catch(() => {});
  }
  syncPushSettingsUi();
};

/* Push has to go to the relay the chat actually uses, which is not always this
   page's origin — a desktop build serves itself from tauri://. */
/* A relay answer, read as JSON only once it is established that it IS JSON.
 *
 * Every push call used to be `.then((r) => r.json())` with nothing between.
 * When the relay answered with something that was not JSON, the parser was
 * the first thing to notice, and what reached the user was
 * "SyntaxError: Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON".
 *
 * That is Express's own 404 page, which is what a relay older than 2.44.0
 * returns for /push/challenge because the route did not exist yet -- and
 * "upgrade the relay" is not a thing anybody could read out of that sentence.
 * The same message came back for a reverse proxy that does not forward
 * /push/, and for an address that is not a relay at all: three different
 * problems, one meaningless error, and no way to tell them apart.
 *
 * The status and the content type are both known before anything is parsed,
 * so the answer names what actually happened. */
async function readRelayJson(response, what) {
  const type = String(response.headers.get('content-type') || '');
  const isJson = /\bjson\b/i.test(type);

  if (response.status === 404 || response.status === 405) {
    throw new Error(getTranslatedText('pushRelayTooOld'));
  }
  if (!response.ok && !isJson) {
    throw new Error(`${getTranslatedText('pushRelayRefused')} (${response.status})`);
  }
  if (!isJson) {
    throw new Error(getTranslatedText('pushNotARelay'));
  }
  try {
    return await response.json();
  } catch (_error) {
    /* JSON by its own account and not parseable: a proxy or a captive portal
       writing its own body over the answer. */
    throw new Error(`${getTranslatedText('pushRelayUnreadable')} (${what})`);
  }
}

function chatRelayOriginForPush() {
  return window.PoorijaChat?.serverOrigin?.() || window.location.origin;
}

/* ---- UnifiedPush, the Android route -------------------------------------
 *
 * The switch above this in the settings reaches the browser's Push API, which
 * Android's WebView does not expose to its service workers -- so inside the
 * native Android shell it reaches nothing at all. This is the route that
 * works: a distributor app the person installed holds the socket, and the
 * relay posts to the URL it hands out.
 *
 * The endpoint does not arrive from the register call. The distributor has to
 * talk to its own server first and answers by broadcast, which Kotlin stores;
 * this side reads it afterwards. So registering and subscribing are two
 * separate moments, and the second one polls briefly for the first to land.
 */
function unifiedPushApi() {
return isNativeMobileShell() && /Android/i.test(navigator.userAgent || '')
? window.PoorijaDesktop
: null;
}

async function unifiedPushStatus() {
try {
return await unifiedPushApi()?.invoke('unifiedpush_status') || null;
} catch (_error) {
return null;
}
}

async function syncUnifiedPushUi() {
const card = document.getElementById('unifiedPushCard');
if (!card) return;
const status = await unifiedPushStatus();
card.classList.toggle('hidden', !status?.supported);
if (!status?.supported) return;

const select = document.getElementById('upDistributor');
const none = document.getElementById('upNone');
const row = document.getElementById('upDistributorRow');
const disconnect = document.getElementById('upDisconnect');
const state = document.getElementById('upState');
const polling = document.getElementById('upPolling');

const has = status.distributors.length > 0;
if (none) none.classList.toggle('hidden', has);
if (row) row.classList.toggle('hidden', !has);
if (select && has) {
select.innerHTML = status.distributors
.map((name) => `<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
if (status.distributor) select.value = status.distributor;
}
const connected = Boolean(status.endpoint);
if (disconnect) disconnect.classList.toggle('hidden', !connected);
if (state) {
state.textContent = connected
? (state.language === 'fa' ? 'متصل' : 'connected')
: getTranslatedText(connected ? 'upConnected' : 'upNotConnected');
}
if (polling) polling.checked = Boolean(status.polling);
}

/** Asks the chosen distributor for an endpoint, then registers it with the relay. */
async function connectUnifiedPush() {
const api = unifiedPushApi();
const select = document.getElementById('upDistributor');
if (!api) return;
const button = document.getElementById('upConnect');
if (button) button.disabled = true;
try {
const reached = await api.invoke('unifiedpush_register', { distributor: select?.value || '' });
if (!reached) {
showNotification(getTranslatedText('upNoDistributor'), 'warning');
return;
}
/* The distributor answers by broadcast after talking to its own server.
   Nothing here can hurry that, so wait for the endpoint to appear rather
   than reporting success on a request that has not been answered. */
let endpoint = '';
for (let attempt = 0; attempt < 20 && !endpoint; attempt += 1) {
await new Promise((resolve) => setTimeout(resolve, 500));
endpoint = (await unifiedPushStatus())?.endpoint || '';
}
if (!endpoint) {
showNotification(getTranslatedText('upNoEndpoint'), 'warning');
return;
}
await registerUnifiedPushEndpoint(endpoint);
showNotification(getTranslatedText('upConnectedNow'), 'success');
} catch (error) {
showNotification(`${getTranslatedText('upFailed')} — ${error}`, 'error');
} finally {
if (button) button.disabled = false;
await syncUnifiedPushUi();
}
}

/* The relay will not take a fingerprint's word for a subscription, so this
   runs the same challenge the browser path runs -- see the note there. */
async function registerUnifiedPushEndpoint(endpoint) {
const origin = chatRelayOriginForPush();
if (!origin) throw new Error('no relay configured');
const identity = await window.PoorijaChat?.identityProof?.();
if (!identity) throw new Error('no Secure Chat identity to prove');
const challenge = await fetch(new URL('/push/challenge', origin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }),
}).then((r) => readRelayJson(r, 'challenge'));
if (!challenge?.ok) throw new Error(challenge?.reason || 'the relay refused a challenge');
const answer = await fetch(new URL('/push/subscribe', origin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({
fingerprint: identity.fingerprint,
challengeId: challenge.challengeId,
nonce: await identity.solve(challenge.cipher),
subscription: { type: 'unifiedpush', endpoint, lang: state.language },
}),
}).then((r) => readRelayJson(r, 'subscribe'));
if (!answer?.ok) throw new Error(answer?.reason || 'the relay refused the subscription');
}

async function disconnectUnifiedPush() {
try {
await unifiedPushApi()?.invoke('unifiedpush_unregister');
showNotification(getTranslatedText('upDisconnected'), 'info');
} catch (error) {
showNotification(String(error), 'error');
} finally {
await syncUnifiedPushUi();
}
}

/** The fifteen-minute fallback. Needs a token, so it proves identity too. */
async function toggleMailPolling(on) {
const api = unifiedPushApi();
if (!api) return;
try {
if (!on) {
await api.invoke('unifiedpush_poll_disable');
} else {
const origin = chatRelayOriginForPush();
if (!origin) throw new Error('no relay configured');
const identity = await window.PoorijaChat?.identityProof?.();
if (!identity) throw new Error('no Secure Chat identity to prove');
const challenge = await fetch(new URL('/push/challenge', origin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({ fingerprint: identity.fingerprint, publicKeyData: identity.publicKeyData }),
}).then((r) => readRelayJson(r, 'challenge'));
if (!challenge?.ok) throw new Error(challenge?.reason || 'the relay refused a challenge');
const issued = await fetch(new URL('/push/poll-token', origin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({
fingerprint: identity.fingerprint,
challengeId: challenge.challengeId,
nonce: await identity.solve(challenge.cipher),
}),
}).then((r) => readRelayJson(r, 'poll-token'));
if (!issued?.ok) throw new Error(issued?.reason || 'the relay refused a poll token');
await api.invoke('unifiedpush_poll_enable', { origin: String(origin).replace(/\/$/, ''), token: issued.token });
}
} catch (error) {
showNotification(String(error?.message || error), 'error');
} finally {
await syncUnifiedPushUi();
}
}

function syncPushSettingsUi() {
  /* Deliberately NOT priming here.
   *
   * Warming the relay's key when the panel merely renders means touching the
   * relay's push endpoint before the person has agreed to background
   * notifications at all, and "nothing push-related happens before consent" is
   * a rule this product keeps and its suite checks. The warming happens one
   * step later instead — after the disclosure is accepted, while the system
   * permission sheet is up — which is early enough to matter and late enough
   * to be honest. */
  const settings = pushSettings();
  const toggle = document.getElementById('pushBackgroundToggle');
  const select = document.getElementById('pushTtlSelect');
  const row = document.getElementById('pushTtlRow');
  const status = document.getElementById('pushStatusHint');
  const support = getBrowserPushSupport();
  /* The switch answers "will this ring?", not "did somebody once turn it on".
     Those came apart the moment an endpoint was rotated or pruned: the stored
     flag stayed true, the relay had nothing to push to, and the panel went on
     showing a switch in the on position with nothing behind it. When the last
     reconcile found the subscription gone, it reads off — and the hint below
     says what to do, because the person has to supply the tap that WebKit
     will not let the app fake. */
  const lost = settings.enabled && state.webPush?.needsGesture === true;
  if (toggle) {
    toggle.checked = settings.enabled && !lost;
    toggle.disabled = !support.supported;
  }
  if (select) select.value = String(settings.ttlDays);
  if (row) row.classList.toggle('opacity-40', !settings.enabled);
  if (status) {
    /* The native shell has no Push API at all — wry does not implement it and
       there is no push service behind it. What it has instead is the system
       notification while the app is running, and it can be kept running in the
       tray, so the honest line there is different from a browser's. */
    if (isDesktopAppRuntime()) status.textContent = getTranslatedText('pushNativeNote');
    else if (!support.supported) status.textContent = getTranslatedText('pushUnsupported');
    else if (!settings.enabled) status.textContent = getTranslatedText('pushHintOff');
    else if (lost) status.textContent = getTranslatedText('pushHintLost');
    else status.textContent = getTranslatedText('pushHintOn').replace('{days}', String(settings.ttlDays));
  }
}
window.syncPushSettingsUi = syncPushSettingsUi;

/* Does the switch still mean anything?
 *
 * registerWebPushSubscription() used to be reachable from exactly two places:
 * the background-notifications switch and the retention dropdown beside it.
 * Nothing ran it when the app started — so the subscription was written once,
 * when the person turned it on, and never looked at again.
 *
 * A push endpoint does not last forever. The browser rotates it, and the relay
 * drops it for good the moment a vendor answers 404 or 410. Either way the
 * relay ends up with no row to push to, and Settings went on showing a switch
 * in the "on" position with nothing behind it. The only way back was to turn it
 * off and on again, which nobody can be expected to guess.
 *
 * So it is reconciled: on unlock, and when the app comes back to the front
 * after having been away. The cheap case is also the common one — the engine
 * still holds a subscription, registerWebPushSubscription() reuses it rather
 * than calling subscribe(), and all that happens is one POST that hands the
 * relay back a row it may have pruned. No tap needed, which matters because
 * WebKit will not subscribe() without one. */
const PUSH_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PUSH_RECONCILE_DEBOUNCE_MS = 30 * 1000;
let pushReconcileAt = 0;
let pushReconcileInFlight = null;

/* What the last reconcile found, so the panel can stop asserting things it has
   no evidence for. `live` is the only honest answer to "will this ring?": it is
   true when the relay has been handed a subscription this session. */
state.webPush = { ...(state.webPush || {}), live: false, needsGesture: false };

async function reconcileWebPushSubscription(options = {}) {
  const { reason = 'startup', force = false, allowSubscribe = false } = options;
  /* One at a time. Unlock and a visibility change can land together, and two
     registrations racing produce two endpoints, which is how one message
     became several notifications the last time this went wrong. */
  if (pushReconcileInFlight) return pushReconcileInFlight;
  const now = Date.now();
  if (!force && now - pushReconcileAt < PUSH_RECONCILE_DEBOUNCE_MS) {
    return { ok: Boolean(state.webPush?.live), reason: 'debounced' };
  }
  if (!state.settings.notifications) return { ok: false, reason: 'notifications-off' };
  if (!pushSettings().enabled) return { ok: false, reason: 'push-off' };
  if (!getBrowserPushSupport().supported) return { ok: false, reason: 'unsupported' };
  /* Never prompts: a reconcile is housekeeping and must not put a permission
     sheet in front of somebody who only opened the app. */
  if (Notification.permission !== 'granted') {
    state.webPush = { ...state.webPush, live: false, needsGesture: true };
    syncPushSettingsUi();
    return { ok: false, reason: 'permission' };
  }

  pushReconcileAt = now;
  pushReconcileInFlight = (async () => {
    try {
      const fingerprint = window.PoorijaChat?.identityFingerprint?.() || '';
      if (!fingerprint) return { ok: false, reason: 'no-identity' };
      const result = await registerWebPushSubscription(fingerprint, chatRelayOriginForPush(), false);
      if (result?.ok) {
        state.webPush = { ...state.webPush, live: true, needsGesture: false };
        return { ok: true, reason };
      }
      /* It did not take. The engine would not hand over a subscription without
         a tap, or the relay refused the one it was given. Either way the switch
         has stopped being true, and saying so is the whole point of this. */
      state.webPush = { ...state.webPush, live: false, needsGesture: true };
      return { ok: false, reason: result?.reason || 'failed' };
    } catch (error) {
      /* NotAllowedError with permission already granted is WebKit asking for a
         gesture, which a startup pass does not have. It is not a fault and not
         worth a toast — but it IS worth the switch telling the truth. */
      state.webPush = { ...state.webPush, live: false, needsGesture: true };
      console.info('[Push] could not renew the subscription in the background:', error?.name || error);
      return { ok: false, reason: 'error', error: String(error?.name || error) };
    } finally {
      pushReconcileInFlight = null;
      syncPushSettingsUi();
    }
  })();
  return pushReconcileInFlight;
}
window.reconcileWebPushSubscription = reconcileWebPushSubscription;

/* Unlock is the one moment the chat identity is certainly available, which the
   relay needs in order to file the subscription under anybody. */
window.addEventListener('poorija:unlock', () => {
  reconcileWebPushSubscription({ reason: 'unlock', force: true }).catch(() => {});
});
/* And on the way back from a long spell in the background, which is exactly
   when an endpoint is most likely to have been rotated out from under us. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - pushReconcileAt < PUSH_RECONCILE_INTERVAL_MS) return;
  reconcileWebPushSubscription({ reason: 'foreground' }).catch(() => {});
});

function getPathBaseName(filePath) {
return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || String(filePath || '');
}
function syncPasskeyHintCard() {
const hintCard = document.getElementById('passkeyHintCard');
if (!hintCard) return;
/* Three different runtimes, three different truths -- and the phones are
   Tauri runtimes, so isDesktopAppRuntime() alone handed them the desktop's
   story about Touch ID and Windows Hello on a handset that has neither. */
hintCard.textContent = isNativeMobileShell()
? getTranslatedText('passkeyHintMobile')
: isDesktopAppRuntime()
? getTranslatedText('passkeyHintDesktop')
: getTranslatedText('passkeyHint');
}
function setControlDisabledState(ids, disabled) {
ids.forEach((id) => {
const element = document.getElementById(id);
if (!element) return;
element.disabled = disabled;
element.classList.toggle('opacity-60', disabled);
element.classList.toggle('cursor-not-allowed', disabled);
});
}
function syncEncryptAdvancedSettingsState() {
const algorithmId = document.getElementById('encAlgorithm')?.value || state.settings.algorithm || 'AES-256-GCM';
const algorithmInfo = getEncryptionAlgorithmInfo(algorithmId);
const methodSelect = document.getElementById('keyMethod');
if (!methodSelect) return;
if (algorithmInfo.type === 'hybrid-rsa' && methodSelect.value !== 'publicKey') {
methodSelect.value = 'publicKey';
}
const selectedMethod = methodSelect.value;
const usesPasswordKdf = selectedMethod === 'password' && algorithmInfo.type !== 'hybrid-rsa';
const usesGcm = algorithmInfo.type === 'hybrid-rsa' || algorithmInfo.webCryptoAlgorithm === 'AES-GCM';
const usesCtr = algorithmInfo.webCryptoAlgorithm === 'AES-CTR';
const usesRsa = algorithmInfo.type === 'hybrid-rsa';
setControlDisabledState(['encIterations', 'encKdfHash', 'encSaltLength'], !usesPasswordKdf);
setControlDisabledState(['encGcmTagLength', 'encAadContext'], !usesGcm);
setControlDisabledState(['encCtrCounterLength'], !usesCtr);
setControlDisabledState(['encRsaLabel'], !usesRsa);
}
function getShredderDefaultPromptText() {
return isDesktopAppRuntime()
? getTranslatedText('shredderSelectFileDesktop')
: getTranslatedText('shredderSelectFile');
}
function resetShredderSelection() {
fileHandleToShred = null;
const fileNameLabel = document.getElementById('shredderFileName');
const shredButton = document.getElementById('shredBtn');
const progressContainer = document.getElementById('shredderProgress');
const progressBar = document.getElementById('shredderProgressBar');
if (fileNameLabel) {
fileNameLabel.textContent = getShredderDefaultPromptText();
}
if (shredButton) {
shredButton.disabled = true;
}
if (progressContainer) {
progressContainer.classList.add('hidden');
}
if (progressBar) {
progressBar.style.width = '0%';
}
}
function syncShredderDesktopUi() {
const desc = document.getElementById('shredderDescText');
const guideCard = document.getElementById('shredderGuideCard');
const fileNameLabel = document.getElementById('shredderFileName');
if (desc) {
desc.textContent = isDesktopAppRuntime()
? getTranslatedText('fileShredderDescDesktop')
: getTranslatedText('fileShredderDesc');
}
if (guideCard) {
guideCard.classList.toggle('hidden', isDesktopAppRuntime());
}
if (fileNameLabel && !fileHandleToShred) {
fileNameLabel.textContent = getShredderDefaultPromptText();
}
}
function syncDesktopNotificationUi() {
const toggle = document.getElementById('notificationsToggle');
const hint = document.getElementById('notificationPermissionHint');
const notificationApi = getDesktopNotificationApi();
const isDesktop = isDesktopAppRuntime();
if (!toggle || !hint) return;
if (!isDesktop) {
const support = getBrowserPushSupport();
toggle.disabled = !support.supported;
if (!support.supported) {
hint.textContent = getTranslatedText('webPushNotificationsUnsupported');
} else if (state.webPush.permission === 'granted' || Notification.permission === 'granted') {
hint.textContent = state.webPush.subscribed
? getTranslatedText('webPushNotificationsGranted')
: getTranslatedText('webPushNotificationsPrompt');
} else if (state.webPush.permission === 'denied' || Notification.permission === 'denied') {
hint.textContent = getTranslatedText('webPushNotificationsDenied');
} else {
hint.textContent = getTranslatedText('webPushNotificationsPrompt');
}
return;
}
if (!notificationApi) {
toggle.checked = false;
toggle.disabled = true;
hint.textContent = getTranslatedText('desktopNotificationsUnsupported');
return;
}
toggle.disabled = false;
if (state.desktopNotifications.permission === 'granted') {
hint.textContent = getTranslatedText('desktopNotificationsGranted');
} else if (state.desktopNotifications.permission === 'denied') {
hint.textContent = getTranslatedText('desktopNotificationsDenied');
} else {
hint.textContent = getTranslatedText('desktopNotificationsPrompt');
}
}
async function refreshDesktopNotificationStatus() {
const notificationApi = getDesktopNotificationApi();
if (!isDesktopAppRuntime()) {
const support = getBrowserPushSupport();
state.desktopNotifications = {
supported: false,
permission: 'default',
checked: true
};
state.webPush = {
...state.webPush,
supported: support.supported,
permission: support.permission
};
if (support.supported) {
try {
const registration = await navigator.serviceWorker.ready;
const subscription = await registration.pushManager.getSubscription();
state.webPush.subscribed = Boolean(subscription);
state.webPush.endpoint = subscription?.endpoint || '';
} catch (_error) {
state.webPush.subscribed = false;
state.webPush.endpoint = '';
}
}
syncDesktopNotificationUi();
return;
}
if (!notificationApi) {
state.desktopNotifications = {
supported: false,
permission: 'default',
checked: false
};
syncDesktopNotificationUi();
return;
}
try {
const granted = await notificationApi.isPermissionGranted();
state.desktopNotifications = {
supported: true,
permission: granted ? 'granted' : 'default',
checked: true
};
} catch (error) {
console.error(error);
state.desktopNotifications = {
supported: true,
permission: 'default',
checked: true
};
}
syncDesktopNotificationUi();
}
async function ensureDesktopNotificationPermission(promptForAccess = false) {
const notificationApi = getDesktopNotificationApi();
if (!isDesktopAppRuntime() || !notificationApi) {
return { supported: false, granted: false, permission: 'default' };
}
try {
let granted = await notificationApi.isPermissionGranted();
let permission = granted ? 'granted' : 'default';
if (!granted && promptForAccess) {
permission = await notificationApi.requestPermission();
granted = permission === 'granted';
}
state.desktopNotifications = {
supported: true,
permission: granted ? 'granted' : permission,
checked: true
};
} catch (error) {
console.error(error);
state.desktopNotifications = {
supported: true,
permission: 'default',
checked: true
};
}
syncDesktopNotificationUi();
return {
supported: state.desktopNotifications.supported,
granted: state.desktopNotifications.permission === 'granted',
permission: state.desktopNotifications.permission
};
}
async function sendDesktopSystemNotification(message, type = 'info') {
if (!isDesktopAppRuntime() || !state.settings.notifications) return;
const notificationApi = getDesktopNotificationApi();
if (!notificationApi) return;
const permission = await ensureDesktopNotificationPermission(false);
if (!permission.granted) return;
const title = type === 'error'
? 'P00RIJA Cryptography'
: 'P00RIJA Cryptography';
try {
await notificationApi.sendNotification({
title,
body: String(message || '').trim()
});
} catch (error) {
console.error(error);
}
}
async function refreshDesktopAuthStatus() {
if (!isDesktopAppRuntime()) {
state.desktopAuth = {
supported: false,
enabled: false,
checked: true,
platform: 'web'
};
syncDesktopRuntimeClass();
refreshPasskeyUi();
return;
}
if (!getDesktopInvoke()) {
state.desktopAuth = {
supported: false,
enabled: false,
checked: false,
platform: 'desktop'
};
syncDesktopRuntimeClass();
refreshPasskeyUi();
return;
}
try {
const status = await invokeDesktopCommand('desktop_auth_status');
state.desktopAuth = {
supported: Boolean(status?.supported),
enabled: Boolean(status?.enabled),
checked: true,
platform: status?.platform || 'desktop'
};
} catch (error) {
console.error(error);
state.desktopAuth = {
supported: false,
enabled: false,
checked: true,
platform: 'desktop'
};
}
syncDesktopRuntimeClass();
refreshPasskeyUi();
if (!state.isLocked) {
showDesktopBiometricPromptIfNeeded();
}
}
function scheduleDesktopRuntimeRefresh(attempt = 0) {
if (!isDesktopAppRuntime() || attempt > 6) return;
const delay = 350 + (attempt * 250);
window.setTimeout(async () => {
await refreshDesktopAuthStatus();
await refreshDesktopNotificationStatus();
syncShredderDesktopUi();
if (!state.desktopAuth.checked || !state.desktopNotifications.checked) {
scheduleDesktopRuntimeRefresh(attempt + 1);
}
}, delay);
}
function getDesktopIconProfile(profileId) {
return DESKTOP_ICON_PROFILES[profileId] || DESKTOP_ICON_PROFILES['poorija-default'];
}
function syncLockScreenLayout() {
const container = document.getElementById('lockScreenContainer');
const initialSetup = document.getElementById('initialSetup');
if (!container || !initialSetup) return;
const setupVisible = !initialSetup.classList.contains('hidden');
container.classList.toggle('compact-mode', !setupVisible);
}
function initializeSetupInteractions() {
const setup = document.getElementById('initialSetup');
setup?.querySelectorAll('input, select, textarea').forEach((control) => {
control.addEventListener('input', updateSetupButtonState);
control.addEventListener('change', updateSetupButtonState);
});
updateSetupButtonState();
}
function toggleSetupLegalDisclosure() {
const panel = document.getElementById('setupLegalDisclosure');
if (!panel) return;
panel.classList.toggle('hidden');
}
function isSetupFormReady() {
const pass = document.getElementById('setupPassword')?.value || '';
const confirm = document.getElementById('confirmPassword')?.value || '';
const acceptedTerms = Boolean(document.getElementById('acceptTermsCheckbox')?.checked);
const questionValues = ['secQ1', 'secQ2', 'secQ3'].map((id) => document.getElementById(id)?.value || '');
const answersReady = ['secA1', 'secA2', 'secA3'].every((id) => Boolean(document.getElementById(id)?.value.trim()));
return evaluatePasswordStrengthScore(pass) === 4
&& Boolean(pass)
&& pass === confirm
&& questionValues.every(Boolean)
&& new Set(questionValues).size === 3
&& answersReady
&& acceptedTerms;
}
function updateSetupButtonState() {
const setupBtn = document.getElementById('setupBtn');
if (setupBtn) {
setupBtn.disabled = !isSetupFormReady();
}
}
function hasHandledDesktopBiometricPrompt() {
return localStorage.getItem(DESKTOP_BIOMETRIC_PROMPT_KEY) === '1';
}
function markDesktopBiometricPromptHandled() {
localStorage.setItem(DESKTOP_BIOMETRIC_PROMPT_KEY, '1');
}
function setDesktopBiometricPromptVisibility(isVisible) {
const modal = document.getElementById('desktopBiometricPromptModal');
if (!modal) return;
modal.classList.toggle('hidden', !isVisible);
modal.classList.toggle('flex', isVisible);
}
function isDesktopBiometricCapable() {
return isDesktopAppRuntime() && Boolean(state.desktopAuth.supported);
}
function showDesktopBiometricPromptIfNeeded() {
if (!state.desktopAuth.checked || !isDesktopBiometricCapable() || state.desktopAuth.enabled || hasHandledDesktopBiometricPrompt()) {
return;
}
setDesktopBiometricPromptVisibility(true);
}
async function enableDesktopBiometricFromPrompt() {
markDesktopBiometricPromptHandled();
setDesktopBiometricPromptVisibility(false);
await togglePasskeyQuickUnlock();
}
function dismissDesktopBiometricPrompt() {
markDesktopBiometricPromptHandled();
setDesktopBiometricPromptVisibility(false);
refreshPasskeyUi();
}
async function applyDesktopIconProfileToRuntime(profileId) {
if (!isDesktopAppRuntime()) return;
try {
await invokeDesktopCommand('set_window_icon', { profile: profileId });
} catch (error) {
console.error(error);
}
}
function syncDesktopAppearanceUi() {
const section = document.getElementById('desktopAppearanceSection');
const select = document.getElementById('settingDesktopIconProfile');
const preview = document.getElementById('desktopIconPreview');
if (!section || !select || !preview) return;
/* isDesktopAppRuntime() is true on the phones as well -- they are Tauri
   runtimes -- so this panel used to appear on Android and iOS, where the
   launcher icon is fixed at install time and set_window_icon is a documented
   no-op. The control changed the dropdown and nothing else, which is the worst
   kind of setting: one that answers. Its own description says "on desktop
   builds", so ask the question that sentence is actually asking. */
const isDesktop = isDesktopAppRuntime() && !isNativeMobileShell();
section.classList.toggle('hidden', !isDesktop);
if (!isDesktop) return;
const selectedProfileId = state.settings.desktopIconProfile || 'poorija-default';
const profile = getDesktopIconProfile(selectedProfileId);
select.value = selectedProfileId;
preview.src = profile.previewPath;
}
async function applyDesktopIconProfileSelection() {
const select = document.getElementById('settingDesktopIconProfile');
if (!select) return;
state.settings.desktopIconProfile = DESKTOP_ICON_PROFILES[select.value]
? select.value
: 'poorija-default';
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
syncDesktopAppearanceUi();
await applyDesktopIconProfileToRuntime(state.settings.desktopIconProfile);
}
let tabFillResizeTimer = 0;
window.addEventListener('resize', () => {
  window.clearTimeout(tabFillResizeTimer);
  tabFillResizeTimer = window.setTimeout(() => applyTabFill(state.activeTab), 180);
});
function applySidebarTabOrder() {
const nav = document.getElementById('sidebarNav');
if (!nav) return;
normalizeTabOrder(state.settings.tabOrder).forEach((tabId) => {
const button = document.getElementById(`tab-${tabId}`);
if (button) {
nav.appendChild(button);
}
});
}
let activeTabOrderDragId = null;
function renderTabOrderCustomizer() {
const container = document.getElementById('tabOrderList');
if (!container) return;
const tabOrder = normalizeTabOrder(state.settings.tabOrder);
container.innerHTML = tabOrder.map((tabId, index) => {
const definition = sidebarTabDefinitions().find((tab) => tab.id === tabId);
const label = definition ? getTranslatedText(definition.labelKey, tabId) : tabId;
return `
<div class="tab-order-row" draggable="true" ondragstart="handleTabOrderDragStart(event, '${tabId}')" ondragover="handleTabOrderDragOver(event)" ondragleave="handleTabOrderDragLeave(event)" ondrop="handleTabOrderDrop(event, '${tabId}')" ondragend="handleTabOrderDragEnd()">
<div class="flex items-center gap-3 min-w-0">
<span class="tab-order-handle" aria-hidden="true"><i class="fas fa-grip-lines"></i></span>
<span class="text-sm font-semibold text-slate-700 dark:text-slate-100">${escapeHtml(label)}</span>
</div>
<div class="tab-order-actions">
<button type="button" onclick="moveTabOrder('${tabId}', -1)" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors" title="${escapeHtml(getTranslatedText('moveUp'))}" ${index === 0 ? 'disabled' : ''}>
<i class="fas fa-arrow-up"></i>
</button>
<button type="button" onclick="moveTabOrder('${tabId}', 1)" class="px-3 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors" title="${escapeHtml(getTranslatedText('moveDown'))}" ${index === tabOrder.length - 1 ? 'disabled' : ''}>
<i class="fas fa-arrow-down"></i>
</button>
</div>
</div>
`;
}).join('');
}
function reorderTabOrder(sourceTabId, targetTabId) {
const currentOrder = normalizeTabOrder(state.settings.tabOrder);
const sourceIndex = currentOrder.indexOf(sourceTabId);
const targetIndex = currentOrder.indexOf(targetTabId);
if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return;
const [movedItem] = currentOrder.splice(sourceIndex, 1);
currentOrder.splice(targetIndex, 0, movedItem);
state.settings.tabOrder = currentOrder;
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
applySidebarTabOrder();
renderTabOrderCustomizer();
}
function handleTabOrderDragStart(event, tabId) {
activeTabOrderDragId = tabId;
event.dataTransfer.effectAllowed = 'move';
event.dataTransfer.setData('text/plain', tabId);
event.currentTarget.classList.add('is-dragging');
}
function handleTabOrderDragOver(event) {
event.preventDefault();
event.dataTransfer.dropEffect = 'move';
const row = event.currentTarget.closest('.tab-order-row');
if (row && !row.classList.contains('is-dragging')) {
row.classList.add('is-drop-target');
}
}
function handleTabOrderDragLeave(event) {
const row = event.currentTarget.closest('.tab-order-row');
if (row) {
row.classList.remove('is-drop-target');
}
}
function handleTabOrderDrop(event, targetTabId) {
event.preventDefault();
const sourceTabId = activeTabOrderDragId || event.dataTransfer.getData('text/plain');
handleTabOrderDragEnd();
if (!sourceTabId || sourceTabId === targetTabId) return;
reorderTabOrder(sourceTabId, targetTabId);
}
function handleTabOrderDragEnd() {
activeTabOrderDragId = null;
document.querySelectorAll('.tab-order-row').forEach((row) => {
row.classList.remove('is-dragging', 'is-drop-target');
});
}
function moveTabOrder(tabId, direction) {
const currentOrder = normalizeTabOrder(state.settings.tabOrder);
const currentIndex = currentOrder.indexOf(tabId);
if (currentIndex === -1) return;
const targetIndex = currentIndex + direction;
if (targetIndex < 0 || targetIndex >= currentOrder.length) return;
[currentOrder[currentIndex], currentOrder[targetIndex]] = [currentOrder[targetIndex], currentOrder[currentIndex]];
state.settings.tabOrder = currentOrder;
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
applySidebarTabOrder();
renderTabOrderCustomizer();
}
function resetTabOrder() {
handleTabOrderDragEnd();
state.settings.tabOrder = getDefaultTabOrder();
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
applySidebarTabOrder();
renderTabOrderCustomizer();
}
function initializeInstallExperience() {
syncDesktopRuntimeClass();
syncPwaRuntimeState();
syncWindowControlsOverlayUi();
setInstallButtonsVisibility();
window.addEventListener('beforeinstallprompt', (event) => {
event.preventDefault();
state.deferredInstallPrompt = event;
setInstallButtonsVisibility();
});
window.addEventListener('appinstalled', () => {
state.deferredInstallPrompt = null;
state.appInstalled = true;
state.installGateDismissed = true;
syncPwaRuntimeState();
syncWindowControlsOverlayUi();
setInstallButtonsVisibility();
closeInstallGuideModal();
checkFirstVisit();
showNotification(translations[state.language].appInstalled, 'success');
});
const standaloneMedia = window.matchMedia('(display-mode: standalone)');
if (standaloneMedia?.addEventListener) {
standaloneMedia.addEventListener('change', () => {
syncPwaRuntimeState();
syncWindowControlsOverlayUi();
setInstallButtonsVisibility();
checkFirstVisit();
});
}
}
function setInstallButtonsVisibility() {
syncDesktopRuntimeClass();
syncPwaRuntimeState();
const standalone = isStandaloneWebApp() || state.appInstalled;
const shouldShow = !isDesktopAppRuntime() && !standalone;
['installAppBtn', 'sidebarInstallBtn', 'mobileInstallGateBtn'].forEach((id) => {
const button = document.getElementById(id);
if (!button) return;
const hideOnDesktopHeader = id === 'installAppBtn' && state.pwa.touch;
button.classList.toggle('hidden', !shouldShow || hideOnDesktopHeader);
button.dataset.installMode = state.deferredInstallPrompt ? 'prompt' : 'guide';
});
}
async function promptInstallApp() {
if (!state.deferredInstallPrompt) {
openInstallGuideModal();
return;
}
state.deferredInstallPrompt.prompt();
await state.deferredInstallPrompt.userChoice.catch(() => null);
state.deferredInstallPrompt = null;
setInstallButtonsVisibility();
}
function getInstallDiagnostics() {
return [
{
label: 'Secure context',
value: state.pwa.secureContext
? (state.language === 'fa' ? 'فعال و معتبر' : 'Active and trusted')
: (state.language === 'fa' ? 'غیرفعال یا گواهی trusted نیست' : 'Inactive or certificate not trusted'),
tone: state.pwa.secureContext ? 'good' : 'bad'
},
{
label: 'Install prompt',
value: state.deferredInstallPrompt
? (state.language === 'fa' ? 'آماده در این مرورگر' : 'Ready in this browser')
: (state.language === 'fa' ? 'به راهنمای مرورگر متکی است' : 'Falls back to browser guidance'),
tone: state.deferredInstallPrompt ? 'good' : 'warn'
},
{
label: 'Service worker',
value: state.pwa.swReady
? (state.language === 'fa' ? 'ثبت شده' : 'Registered')
: (state.language === 'fa' ? 'هنوز آماده نیست' : 'Not ready yet'),
tone: state.pwa.swReady ? 'good' : 'warn'
},
{
label: 'Launch / file handling',
value: state.pwa.fileHandling
? (state.language === 'fa' ? 'پشتیبانی‌شده در این runtime' : 'Supported in this runtime')
: (state.language === 'fa' ? 'فقط drag-and-drop / انتخاب فایل' : 'Falls back to drag-and-drop / file picker'),
tone: state.pwa.fileHandling ? 'good' : 'warn'
},
{
label: 'App badge',
value: state.pwa.badgeApi
? (state.language === 'fa' ? 'قابل استفاده' : 'Available')
: (state.language === 'fa' ? 'وابسته به مرورگر' : 'Browser-dependent'),
tone: state.pwa.badgeApi ? 'good' : 'warn'
},
{
label: 'Passkey / biometrics',
value: supportsPasskeyQuickUnlock()
? (state.language === 'fa' ? 'قابل استفاده در این context' : 'Available in this context')
: (state.language === 'fa' ? 'نیازمند secure context و WebAuthn' : 'Requires secure context and WebAuthn'),
tone: supportsPasskeyQuickUnlock() ? 'good' : 'bad'
}
];
}
function renderInstallGuideModal() {
const content = getInstallGuideContent();
const title = document.getElementById('installGuideTitle');
const summary = document.getElementById('installGuideSummary');
const browserLabel = document.getElementById('installGuideBrowserLabel');
const steps = document.getElementById('installGuideSteps');
const diagnostics = document.getElementById('installGuideDiagnostics');
const fallback = document.getElementById('installGuideFallback');
if (title) title.textContent = content.title;
if (summary) summary.textContent = content.summary;
if (browserLabel) browserLabel.textContent = content.browserLabel;
if (steps) {
steps.innerHTML = content.steps.map((step, index) => `<li class="flex items-start gap-3"><span class="mt-1 h-6 w-6 shrink-0 rounded-full bg-sky-500/15 text-sky-300 flex items-center justify-center text-xs font-bold">${index + 1}</span><span>${step}</span></li>`).join('');
}
if (diagnostics) {
diagnostics.innerHTML = getInstallDiagnostics().map((item) => `
<div class="install-guide-diag-row ${item.tone}">
<strong>${item.label}</strong>
<span>${item.value}</span>
</div>
`).join('');
}
if (fallback) {
fallback.textContent = content.fallback;
fallback.classList.toggle('hidden', !content.fallback);
}
}
function openInstallGuideModal() {
renderInstallGuideModal();
const modal = document.getElementById('installGuideModal');
if (!modal) return;
modal.classList.remove('hidden');
modal.classList.add('flex');
}
function closeInstallGuideModal() {
const modal = document.getElementById('installGuideModal');
if (!modal) return;
modal.classList.add('hidden');
modal.classList.remove('flex');
}
function registerServiceWorker() {
if (!('serviceWorker' in navigator)) return;
let pwaReloadedForUpdate = false;
/* Live update enforcement: check for a new worker every 90s and on
   visibility change, so an installed PWA never stays on a stale build
   (iOS separates PWA storage from Safari — cold-launch checks alone
   are not reliable there). */
const checkForUpdate = async () => {
try {
const regs = await navigator.serviceWorker.getRegistrations();
for (const reg of regs) {
await reg.update?.();
if (reg.waiting) {
reg.waiting.postMessage?.({ type: 'SKIP_WAITING' });
}
}
} catch (error) { /* offline or unsupported */ }
};
setInterval(checkForUpdate, 90000);
document.addEventListener('visibilitychange', () => {
if (!document.hidden) checkForUpdate();
});
navigator.serviceWorker.addEventListener('controllerchange', () => {
const reloadKey = 'poorija-sw-reload-2.44.6-chat-v75';
if (pwaReloadedForUpdate || sessionStorage.getItem(reloadKey) === '1') return;
pwaReloadedForUpdate = true;
sessionStorage.setItem(reloadKey, '1');
window.location.reload();
});
window.addEventListener('load', () => {
/* The worker's own URL carries the release tag, which is what makes a new
   release a new worker rather than a byte-diff the browser has to notice.
   This one said 2.104.0-chat-v3 for every release since — the registration
   URL had stopped changing, and tools/check-versions.cjs could not see it
   because it only asked whether this file mentions the tag anywhere, which
   the reload key above already satisfied. It is checked by itself now. */
navigator.serviceWorker.register('./sw.js?v=2.44.6-chat-v75', { scope: './' }).then((registration) => {
state.pwa.swReady = true;
registration.update?.();
setInstallButtonsVisibility();
consumeShareTargetPayloadFromCache();
}).catch(() => {
state.pwa.swReady = false;
});
});
}
function hydrateIncomingShareFromLocation() {
const url = new URL(window.location.href);
const shareParam = url.searchParams.get('share');
const shareHash = window.location.hash.startsWith('#share:') ? window.location.hash.slice(7) : '';
state.pendingIncomingShare = shareParam || shareHash || null;
if (url.searchParams.get('share-target') === '1') {
consumeShareTargetPayloadFromCache();
}
syncAppBadge();
}
function base64ToFile(base64, name, type = 'application/octet-stream', lastModified = Date.now()) {
const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
return new File([bytes], name, { type, lastModified });
}
function assignFileToInput(inputId, file) {
const input = document.getElementById(inputId);
if (!input || !file) return null;
if (typeof DataTransfer === 'undefined') {
return input;
}
const transfer = new DataTransfer();
transfer.items.add(file);
input.files = transfer.files;
return input;
}
/* Reading the chat settles the bubble on the installed icon as well as the
   tally in here. The early return used to cover both: a phone that collected
   five notices while the app was shut opens with unreadChatCount at 0 — the
   page was never running to count them — so the counter the service worker put
   on the icon was left sitting there after the user had read everything. The
   notices themselves are what the bubble is derived from, so they are the
   thing that has to be dismissed. */
function clearUnreadChatCount() {
dismissBackgroundChatNotices();
if (!state.unreadChatCount) return;
state.unreadChatCount = 0;
syncAppBadge();
}
function tellServiceWorker(message) {
try {
navigator.serviceWorker?.ready
.then((registration) => registration.active?.postMessage(message))
.catch(() => { /* no worker on this platform */ });
} catch (error) {
// Service workers are absent in the native shell and in private windows.
}
}
function dismissBackgroundChatNotices() {
state.backgroundNoticeCount = 0;
tellServiceWorker({ type: 'poorija-clear-notifications' });
}
/* The worker counts what the tray is holding but must not paint it: calling
   the Badging API from a service worker kills the renderer, so it sends the
   number here and this is where it lands. See the note in sw.js. */
function watchBackgroundNoticeCount() {
if (!navigator.serviceWorker) return;
navigator.serviceWorker.addEventListener('message', (event) => {
if (event.data?.type !== 'poorija-badge') return;
state.backgroundNoticeCount = Math.max(0, Number(event.data.count) || 0);
syncAppBadge();
});
/* Opening onto a pile of notices that arrived while the app was shut: nothing
   in this page counted them, so it has to ask. */
tellServiceWorker({ type: 'poorija-badge-query' });
}
async function consumeShareTargetPayloadFromCache() {
if (!('caches' in window)) return null;
try {
const cacheKeys = await caches.keys();
const cacheName = cacheKeys.find((key) => key.startsWith('poorija-cryptography-v')) || cacheKeys[0];
if (!cacheName) return null;
const cache = await caches.open(cacheName);
const response = await cache.match(SHARE_TARGET_CACHE_KEY);
if (!response) return null;
const payload = await response.json();
state.pendingSharedPayload = payload;
syncAppBadge();
if (!state.isLocked) {
await consumePendingSharedPayload();
}
/* Deleted only now, after parsing and consumption survived. The delete used
   to come first, so anything that threw on the way into the Share tab took
   the only copy of the shared content with it. */
await cache.delete(SHARE_TARGET_CACHE_KEY);
return payload;
} catch (error) {
console.error(error);
return null;
}
}
async function consumePendingSharedPayload() {
const payload = state.pendingSharedPayload;
if (!payload) return;
state.pendingSharedPayload = null;
switchTab('share');
const sharedFiles = Array.isArray(payload.files) ? payload.files : [];
if (sharedFiles.length) {
/* sw.js writes the bytes as `content`; the field was read as `base64`, so
   every file arriving through the OS share sheet came through empty. Accept
   both spellings — old caches may still hold the previous one. */
const primary = sharedFiles[0];
const primaryFile = base64ToFile(
primary.base64 || primary.content || '',
primary.name,
primary.type,
primary.lastModified
);
const shareTypeSelect = document.getElementById('sharePayloadType');
if (shareTypeSelect) {
shareTypeSelect.value = 'file';
}
toggleSharePayloadType();
const input = assignFileToInput('shareFileInput', primaryFile);
if (input && input.files?.length) {
handleSecureShareFile({ target: input });
} else {
state.secureShareFile = primaryFile;
document.getElementById('shareFileName').textContent = primaryFile.name;
}
} else {
const shareTypeSelect = document.getElementById('sharePayloadType');
if (shareTypeSelect) {
shareTypeSelect.value = 'text';
}
toggleSharePayloadType();
const textParts = [payload.title, payload.text, payload.url].filter(Boolean);
const shareTextInput = document.getElementById('shareTextInput');
if (shareTextInput) {
shareTextInput.value = textParts.join('\n\n').trim();
}
}
showNotification(
state.language === 'fa'
? 'محتوای ارسال‌شده به تب اشتراک امن منتقل شد'
: 'Shared content was loaded into Secure Share',
'success'
);
syncAppBadge();
}
async function routeLaunchFile(file) {
if (!file) return;
const normalizedName = String(file.name || '').toLowerCase();
if (normalizedName.endsWith('.poorija')) {
switchTab('decrypt');
const input = assignFileToInput('decryptInput', file);
if (input && input.files?.length) {
handleDecryptFile({ target: input });
} else {
state.currentFile = file;
document.getElementById('decryptForm').classList.remove('hidden');
document.getElementById('decryptFileName').textContent = file.name;
try {
const data = normalizeFilePayloadRecord(JSON.parse(await file.text()));
state.currentDecryptContext = data;
document.getElementById('decryptMeta').textContent = `Algorithm: ${data.algorithm} | Chunks: ${data.chunks?.length || 0}`;
} catch (error) {
state.currentDecryptContext = null;
document.getElementById('decryptMeta').textContent = 'Invalid format';
}
}
showNotification(state.language === 'fa' ? 'فایل رمزنگاری‌شده برای رمزگشایی بارگذاری شد' : 'Encrypted file loaded for decryption', 'success');
return;
}
if (normalizedName.endsWith('.poorija-backup')) {
switchTab('migration');
const input = assignFileToInput('importMigrationFile', file);
if (input && input.files?.length) {
const label = document.getElementById('importFileName');
if (label) label.textContent = file.name;
} else {
const label = document.getElementById('importFileName');
if (label) label.textContent = file.name;
}
showNotification(state.language === 'fa' ? 'فایل بکاپ برای بازیابی آماده شد' : 'Backup file is ready for restore', 'success');
return;
}
if (normalizedName.endsWith('.poorija-share')) {
switchTab('share');
const secureShareInput = document.getElementById('secureShareInput');
if (secureShareInput) {
secureShareInput.value = await file.text();
syncSecureShareOpenUi();
}
showNotification(state.language === 'fa' ? 'باندل امن برای بازکردن بارگذاری شد' : 'Secure bundle loaded for opening', 'success');
return;
}
switchTab('share');
const shareTypeSelect = document.getElementById('sharePayloadType');
if (shareTypeSelect) {
shareTypeSelect.value = 'file';
}
toggleSharePayloadType();
const input = assignFileToInput('shareFileInput', file);
if (input && input.files?.length) {
handleSecureShareFile({ target: input });
} else {
state.secureShareFile = file;
document.getElementById('shareFileName').textContent = file.name;
}
showNotification(state.language === 'fa' ? 'فایل برای اشتراک امن آماده شد' : 'File is ready for secure sharing', 'success');
}
async function consumePendingLaunchFiles() {
if (!Array.isArray(state.pendingLaunchFiles) || !state.pendingLaunchFiles.length) return;
const files = [...state.pendingLaunchFiles];
state.pendingLaunchFiles = [];
for (const file of files) {
await routeLaunchFile(file);
}
syncAppBadge();
}
async function refreshPasskeyCapabilities() {
const capabilities = {
checked: true,
secureContext: Boolean(window.isSecureContext),
basicApi: Boolean(
window.PublicKeyCredential
&& navigator.credentials
&& typeof navigator.credentials.create === 'function'
&& typeof navigator.credentials.get === 'function'
),
platformAuthenticator: false
};
if (capabilities.basicApi && PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
try {
capabilities.platformAuthenticator = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
} catch (error) {
capabilities.platformAuthenticator = false;
}
}
state.passkeyCapabilities = capabilities;
refreshPasskeyUi();
return capabilities;
}
function supportsPasskeyQuickUnlock() {
return Boolean(
state.passkeyCapabilities.secureContext
&& state.passkeyCapabilities.basicApi
);
}
function getPasskeyUnavailableReason() {
if (!state.passkeyCapabilities.secureContext) {
return state.language === 'fa'
? 'Passkey و بایومتریک فقط در secure context کار می‌کنند. certificate باید trusted باشد یا از localhost استفاده کنید.'
: 'Passkeys and biometrics only work in a secure context. Trust the certificate or use localhost.';
}
return state.language === 'fa'
? 'این مرورگر یا این context از WebAuthn/passkey موردنیاز پشتیبانی نمی‌کند.'
: 'This browser or context does not provide the required WebAuthn/passkey support.';
}
function getExplicitPasskeyRpId() {
const host = String(window.location.hostname || '').trim();
if (!host) return null;
if (host === 'localhost') return host;
if (host === '127.0.0.1' || host === '[::1]') return null;
if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
return host;
}
/* Opens the window in which the phone will hand the master password back.
 *
 * The two platforms need opposite things here. Android's Keystore key is
 * authentication-bound: decrypting fails outside the few seconds that a
 * satisfied prompt opens, so the prompt has to be raised HERE, before the
 * command that reads the secret. iOS is the other way round -- the Keychain
 * item carries its own access control and raises Face ID as it is read, so
 * prompting here as well would ask the same person twice for one unlock.
 *
 * Returns false when the person declined, which every caller treats as "ask
 * for the password instead" rather than as a wrong answer.
 */
async function openMobileBiometricWindow() {
if (!isNativeMobileShell()) return true;
if (!/Android/i.test(navigator.userAgent || '')) return true;
const api = window.__TAURI__?.biometric;
if (!api?.authenticate) return false;
try {
await api.authenticate(
state.language === 'fa' ? 'برای باز کردن برنامه هویت خود را تأیید کنید' : 'Confirm it is you to open the app',
{ allowDeviceCredential: true,
  title: state.language === 'fa' ? 'باز کردن برنامه' : 'Open the app',
  cancelTitle: state.language === 'fa' ? 'استفاده از رمز عبور' : 'Use the password' },
);
return true;
} catch (error) {
return false;
}
}
function refreshPasskeyUi() {
/* The phones take the native path, the same as the desktop, because they now
   have what that path needs: a store the operating system guards -- Android
   keeps the key inside the Keystore, iOS keeps the item in the Keychain, and
   neither releases it without a face or a finger. See mobile_secure_store.rs.

   Unlocking a conversation lock does not come through here at all: that is a
   presence check, it goes through the platform biometric plugin, and it needs
   no stored secret. */
const isDesktop = isDesktopAppRuntime();
const passkeyRecord = isDesktop
? (state.desktopAuth.enabled ? { desktop: true } : null)
: getPasskeyRecord();
const toggleBtn = document.getElementById('passkeyToggleBtn');
const statusText = document.getElementById('passkeyStatusText');
const unlockBtn = document.getElementById('passkeyUnlockBtn');
const unsupported = isDesktop
? !state.desktopAuth.supported
: !supportsPasskeyQuickUnlock();
const checkingDesktop = isDesktop && !state.desktopAuth.checked;
if (statusText) {
if (!isDesktop && passkeyEnrollUiBusy) {
statusText.textContent = state.language === 'fa' ? 'در حال راه‌اندازی — منتظر تأیید بیومتریک دستگاه…' : 'Setting up — waiting for the device biometric confirmation…';
} else if (checkingDesktop) {
statusText.textContent = getTranslatedText('desktopBiometricChecking');
} else if (unsupported) {
statusText.textContent = isDesktop
? getTranslatedText('desktopBiometricUnavailable')
: getPasskeyUnavailableReason();
} else if (passkeyRecord) {
statusText.textContent = isDesktop
? getTranslatedText('desktopBiometricEnabled')
: passkeyRecord.strategy === 'largeBlob'
? (state.language === 'fa' ? 'فعال با fallback سازگار برای مرورگرهای بدون PRF' : 'Enabled with a PRF-free compatible fallback')
: (state.language === 'fa' ? 'فعال و آماده استفاده' : 'Enabled and ready');
} else {
statusText.textContent = isDesktop
? getTranslatedText('desktopBiometricAvailable')
: getTranslatedText('passkeyDisabled');
}
}
if (toggleBtn) {
const busy = !isDesktop && passkeyEnrollUiBusy;
const disabled = unsupported || checkingDesktop || busy;
toggleBtn.disabled = disabled;
toggleBtn.classList.toggle('opacity-50', disabled);
toggleBtn.classList.toggle('cursor-not-allowed', disabled);
toggleBtn.innerHTML = unsupported
? `<span>${state.language === 'fa' ? 'پشتیبانی نمی‌شود' : 'Unsupported'}</span>`
: (!isDesktop && passkeyEnrollUiBusy)
? `<span>${state.language === 'fa' ? 'در حال راه‌اندازی…' : 'Setting up…'}</span>`
: checkingDesktop
? `<span>${getTranslatedText('desktopBiometricChecking')}</span>`
: `<span>${passkeyRecord ? (state.language === 'fa' ? 'حذف' : 'Remove') : getTranslatedText('setupPasskey')}</span>`;
}
if (unlockBtn) {
unlockBtn.classList.toggle('hidden', !passkeyRecord || unsupported || checkingDesktop);
}
syncPasskeyHintCard();
syncDesktopAppearanceUi();
}
async function importAesKeyFromSeed(seedBytes, usages) {
const normalizedSeed = seedBytes instanceof Uint8Array ? seedBytes : new Uint8Array(seedBytes);
return crypto.subtle.importKey('raw', normalizedSeed.slice(0, 32), { name: 'AES-GCM' }, false, usages);
}
async function encryptPasskeyPayload(plainText, seedBytes) {
const iv = generateSecureRandomBytes(12);
const key = await importAesKeyFromSeed(seedBytes, ['encrypt']);
const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plainText));
return {
iv: Array.from(iv),
cipher: arrayBufferToBase64(encrypted)
};
}
async function decryptPasskeyPayload(record, seedBytes) {
const key = await importAesKeyFromSeed(seedBytes, ['decrypt']);
const decrypted = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv: new Uint8Array(record.iv || []) },
key,
base64ToArrayBuffer(record.cipher)
);
return new TextDecoder().decode(decrypted);
}
/* The allowCredentials entry every ceremony asserts against.
 *
 * `transports` is the part that was missing, and on Android it is the whole
 * difference between a fingerprint sheet and a QR code. WebAuthn L2 §5.10.3
 * asks relying parties to keep what getTransports() returned at registration
 * and hand it back on every assertion; with the field absent the client has to
 * assume EVERY transport is possible, so Chrome on Android opens the full
 * "use a passkey" chooser — phone, security key, another device — instead of
 * going straight to the platform authenticator sitting in the phone. People
 * read that as "the fingerprint never comes up".
 *
 * Old records have no transports. 'internal' is the honest default for them:
 * this app only ever enrolls the platform authenticator. */
function passkeyAllowList(record) {
  const id = typeof record === 'string'
    ? base64UrlToArrayBuffer(record)
    : base64UrlToArrayBuffer(record?.credentialId);
  const stored = Array.isArray(record?.transports) ? record.transports.filter(Boolean) : [];
  const transports = stored.length ? stored : ['internal'];
  return [{ id, type: 'public-key', transports }];
}

/* What the authenticator said it can be reached over, if it said anything. */
function readCredentialTransports(credential) {
  try {
    const list = credential?.response?.getTransports?.();
    return Array.isArray(list) ? list.filter((value) => typeof value === 'string') : [];
  } catch (_error) {
    return [];
  }
}

/* The presence strategy's local wrap key.
 *
 * It now lives INSIDE the record. Two separate localStorage entries bought
 * nothing — the same page reads both, so anything that can steal one steals
 * the other — while adding a failure mode with no recovery from the user's
 * side: the record survives, the wrap key does not, and quick unlock dies
 * immediately after a fingerprint that WORKED, saying "local wrap key is
 * missing". One entry cannot half-survive.
 *
 * The standalone key is still read, for installs enrolled before this, and is
 * folded into the record the first time it is used. */
function getPasskeyWrapKey(record) {
  const current = record || getPasskeyRecord();
  if (current && typeof current.wrap === 'string' && current.wrap) return current.wrap;
  let value = localStorage.getItem(PASSKEY_LOCAL_WRAP_KEY);
  if (!value) {
    try {
      /* Enrollments from before the key joined the device-level set were
         written under the open profile's namespace, where the lock screen
         cannot see them. */
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && key !== PASSKEY_LOCAL_WRAP_KEY && /_passkey_local_wrap$/.test(key)) {
          value = localStorage.getItem(key);
          if (value) break;
        }
      }
    } catch (_error) { /* storage iteration unavailable */ }
  }
  if (value && current) {
    try { setPasskeyRecord({ ...current, wrap: value }); } catch (_error) { /* quota */ }
  }
  return value || null;
}

/* Write the wrap key where the record is, and keep the legacy entry in step so
   a downgrade to an older build still finds it. */
function setPasskeyWrapKey(record, wrapB64) {
  const next = { ...record, wrap: wrapB64 };
  try { localStorage.setItem(PASSKEY_LOCAL_WRAP_KEY, wrapB64); } catch (_error) { /* quota */ }
  return next;
}

/* Everything a failing device can be asked about, in one line.
 *
 * "Biometric unlock does not work on my phone" is not a bug report anyone can
 * act on, and the four things that decide it — secure context, the WebAuthn
 * API, a platform authenticator, and which strategy was enrolled — are all
 * invisible from outside. Collected here so the lock screen's error line and
 * the persisted last-error record both carry them. */
function describePasskeyEnvironment() {
  const record = getPasskeyRecord();
  const caps = state.passkeyCapabilities || {};
  return {
    secureContext: Boolean(window.isSecureContext),
    standalone: Boolean(state.pwa?.standalone),
    engine: detectBrowserFamily(),
    api: Boolean(caps.basicApi),
    platformAuthenticator: caps.platformAuthenticator === true,
    rpId: getExplicitPasskeyRpId() || '(origin default)',
    strategy: record?.strategy || null,
    transports: record?.transports || null,
    wrapKey: record?.strategy === 'presence' ? Boolean(getPasskeyWrapKey(record)) : null,
  };
}


async function refreshStoredPasskeyUnlockSecret() {
if (isDesktopAppRuntime()) {
if (!state.desktopAuth.enabled || !state.masterPassword) return;
try {
/* The phone's key is time-bound, so it is unusable in either direction
   until a prompt has been satisfied -- storing needs one as much as reading
   does. Asking here also proves the sensor works before anything starts
   depending on it. Desktop returns true without prompting. */
if (!await openMobileBiometricWindow()) return;
await invokeDesktopCommand('desktop_store_quick_unlock', {
masterPassword: state.masterPassword
});
await refreshDesktopAuthStatus();
} catch (error) {
console.error(error);
showNotification(
state.language === 'fa'
? 'به‌روزرسانی ورود سریع دسکتاپ کامل نشد'
: 'Desktop quick unlock could not be refreshed',
'warning'
);
}
renderSecurityCenter();
return;
}
const passkeyRecord = getPasskeyRecord();
if (!passkeyRecord || !supportsPasskeyQuickUnlock() || !state.masterPassword) return;
try {
if (passkeyRecord.strategy === 'largeBlob') {
await writePasskeyLargeBlob(base64UrlToArrayBuffer(passkeyRecord.credentialId), state.masterPassword);
setPasskeyRecord({
...passkeyRecord,
updatedAt: new Date().toISOString()
});
} else if (passkeyRecord.strategy === 'presence') {
/* Presence records seal the master password with a FRESH local wrap
   key — never with the PRF seed. Re-seal here exactly like enrollment
   does, or the next locked unlock decrypts garbage and fails. */
const wrapBytes = generateSecureRandomBytes(32);
const wrapped = await encryptPasskeyPayload(state.masterPassword, wrapBytes);
setPasskeyRecord(setPasskeyWrapKey({
...passkeyRecord,
cipher: wrapped.cipher,
iv: wrapped.iv,
updatedAt: new Date().toISOString()
}, arrayBufferToBase64(wrapBytes)));
} else {
const seed = await derivePasskeyPrfSeed(base64UrlToArrayBuffer(passkeyRecord.credentialId));
const wrapped = await encryptPasskeyPayload(state.masterPassword, seed);
setPasskeyRecord({
...passkeyRecord,
cipher: wrapped.cipher,
iv: wrapped.iv,
updatedAt: new Date().toISOString()
});
}
} catch (error) {
console.error(error);
localStorage.removeItem(PASSKEY_STORAGE_KEY);
showNotification(
state.language === 'fa'
? 'Passkey quick unlock نیاز به راه‌اندازی دوباره دارد'
: 'Passkey quick unlock needs to be set up again',
'warning'
);
}
refreshPasskeyUi();
renderSecurityCenter();
}
async function derivePasskeyPrfSeed(credentialIdBuffer) {
const rpId = getExplicitPasskeyRpId();
const assertion = await navigator.credentials.get({
publicKey: {
challenge: generateSecureRandomBytes(32),
...(rpId ? { rpId } : {}),
allowCredentials: passkeyAllowList(getPasskeyRecord() || { credentialId: arrayBufferToBase64Url(credentialIdBuffer) }),
userVerification: 'required',
timeout: 60000,
extensions: {
prf: {
eval: { first: PASSKEY_PRF_SALT.buffer }
}
}
}
});
if (!assertion) {
throw new Error('No assertion returned');
}
const extensionResults = assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
const prfResults = extensionResults.prf || {};
const seedBuffer = prfResults.results?.first || prfResults.first || prfResults.result || null;
if (!seedBuffer) {
throw new Error('PRF result unavailable');
}
return new Uint8Array(seedBuffer);
}
function serializeLargeBlobPayload(masterPassword) {
return new TextEncoder().encode(JSON.stringify({
version: PASSKEY_LARGE_BLOB_VERSION,
masterPassword,
updatedAt: new Date().toISOString()
}));
}
function parseLargeBlobPayload(buffer) {
const payload = JSON.parse(new TextDecoder().decode(buffer));
if (!payload || typeof payload.masterPassword !== 'string') {
throw new Error('Large blob payload is invalid');
}
return payload;
}
async function writePasskeyLargeBlob(credentialIdBuffer, masterPassword) {
const rpId = getExplicitPasskeyRpId();
const assertion = await navigator.credentials.get({
publicKey: {
challenge: generateSecureRandomBytes(32),
...(rpId ? { rpId } : {}),
allowCredentials: passkeyAllowList(getPasskeyRecord() || { credentialId: arrayBufferToBase64Url(credentialIdBuffer) }),
userVerification: 'required',
timeout: 60000,
extensions: {
largeBlob: {
write: serializeLargeBlobPayload(masterPassword)
}
}
}
});
const extensionResults = assertion?.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
if (!extensionResults.largeBlob?.written) {
throw new Error('Large blob write failed');
}
}
async function readPasskeyLargeBlob(credentialIdBuffer) {
const rpId = getExplicitPasskeyRpId();
const assertion = await navigator.credentials.get({
publicKey: {
challenge: generateSecureRandomBytes(32),
...(rpId ? { rpId } : {}),
allowCredentials: passkeyAllowList(getPasskeyRecord() || { credentialId: arrayBufferToBase64Url(credentialIdBuffer) }),
userVerification: 'required',
timeout: 60000,
extensions: {
largeBlob: {
read: true
}
}
}
});
const extensionResults = assertion?.getClientExtensionResults ? assertion.getClientExtensionResults() : {};
const blob = extensionResults.largeBlob?.blob;
if (!blob) {
throw new Error('Large blob read failed');
}
return parseLargeBlobPayload(blob);
}
let passkeyEnrollInFlight = false;
let passkeyEnrollUiBusy = false;
/* Phones and tablets report a coarse pointer; Android browsers live here. */
function isCoarsePointerDevice() {
try {
return Boolean(window.matchMedia?.('(pointer: coarse)').matches)
|| /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
} catch (_error) {
return false;
}
}
/* Some engines (Brave on Android through Google Play services) complete the
   biometric ceremony and then never settle the WebAuthn promise, wedging the
   engine's single request slot until a page reload. Race every ceremony
   against a watchdog so OUR guards release and the user gets told to reload
   instead of waiting forever on a promise that will never answer. */
function webauthnWithWatchdog(startCeremony, fallbackMs = 75000) {
const watchdogMs = Math.max(5000, Number(window.__POORIJA_WEBAUTHN_WATCHDOG_MS) || fallbackMs);
return Promise.race([
startCeremony(),
new Promise((_resolve, reject) => {
setTimeout(() => {
const wedged = new Error('engine did not answer after the biometric ceremony (watchdog)');
wedged.name = 'PoorigaWebauthnWedged';
reject(wedged);
}, watchdogMs);
})
]);
}
/* The presence strategy's ceremony: assert THE configured credential, no
   extensions — extension-bearing requests are what wedge some Android
   engines even when the fingerprint sheet itself succeeds. */
async function runPasskeyPresenceCeremony(credentialIdB64Url, watchdogMs = 75000) {
const rpId = getExplicitPasskeyRpId();
const assertion = await webauthnWithWatchdog(() => navigator.credentials.get({
publicKey: {
challenge: generateSecureRandomBytes(32),
...(rpId ? { rpId } : {}),
allowCredentials: passkeyAllowList(getPasskeyRecord() || { credentialId: credentialIdB64Url }),
userVerification: 'required',
timeout: 60000
}
}));
if (!assertion) throw new Error('No assertion returned');
return assertion;
}
/* Read the presence strategy's local wrap key, healing the v8-and-earlier
   placement first: before the key joined the device-level GLOBAL_KEYS set it
   was written under the open profile's namespace, which the lock screen
   cannot see — biometric unlock then died right after a successful
   fingerprint with "local wrap key is missing". *//* The lock screen keeps the last passkey-unlock failure VISIBLE — toasts
   vanish in three seconds and a failing device then reports "no message". */
function showPasskeyUnlockError(text) {
const el = document.getElementById('passkeyUnlockError');
if (!el) return;
el.textContent = text;
el.classList.remove('hidden');
}
function clearPasskeyUnlockError() {
document.getElementById('passkeyUnlockError')?.classList.add('hidden');
}
/* Self-heal: whatever broke the presence record (the pre-v10 refresh bug,
   a lost wrap key, an interrupted enrollment) is repaired the moment the
   user next signs in with the password — the one moment the correct master
   password is in hand. No manual remove/re-enroll needed. */
async function healPasskeyRecordAfterUnlock() {
if (isDesktopAppRuntime() || !state.masterPassword) return;
try {
const record = getPasskeyRecord();
if (!record || record.strategy !== 'presence') return;
const wrapB64 = getPasskeyWrapKey(record);
let healthy = false;
if (wrapB64) {
try {
healthy = Boolean(await decryptPasskeyPayload(record, base64ToArrayBuffer(wrapB64)));
} catch (_error) { healthy = false; }
}
if (healthy) return;
const wrapBytes = generateSecureRandomBytes(32);
const wrapped = await encryptPasskeyPayload(state.masterPassword, wrapBytes);
setPasskeyRecord(setPasskeyWrapKey(
{ ...record, cipher: wrapped.cipher, iv: wrapped.iv, healedAt: new Date().toISOString() },
arrayBufferToBase64(wrapBytes)));
localStorage.removeItem('poorija_passkey_last_error');
clearPasskeyUnlockError();
console.info('[passkey] presence record re-sealed (self-heal after password sign-in)');
} catch (error) {
console.warn('[passkey] self-heal skipped:', error?.message || error);
}
}
/* Engine-specific advice for WebAuthn failures, shared by every passkey
   flow. Empty string when the error is none of the known engine traps. */
function describePasskeyError(error) {
const name = String(error?.name || '');
const message = String(error?.message || '');
if (name === 'PoorigaWebauthnWedged') {
return state.language === 'fa'
? 'مرورگر پس از تأیید بیومتریک پاسخ نداد (باگ موتور مرورگر). صفحه را یک بار رفرش کنید و دوباره امتحان کنید — رفرش، جای درخواست قفل‌شده در موتور را آزاد می‌کند.'
: 'The browser never answered after the biometric confirmation (an engine bug). Reload the page once and try again — reloading frees the engine\'s stuck request slot.';
}
if (/already pending/i.test(`${name} ${message}`)) {
return state.language === 'fa'
? 'یک درخواست قبلی هنوز بسته نشده؛ چند ثانیه صبر کنید. اگر تکرار شد، صفحه را یک بار رفرش کنید.'
: 'A previous request is still open; wait a few seconds. If it keeps happening, reload the page once.';
}
return '';
}
async function togglePasskeyQuickUnlock() {
if (isDesktopAppRuntime()) {
if (!state.desktopAuth.checked) {
await refreshDesktopAuthStatus();
}
if (state.desktopAuth.enabled) {
try {
await invokeDesktopCommand('desktop_clear_quick_unlock');
state.desktopAuth.enabled = false;
refreshPasskeyUi();
renderSecurityCenter();
showNotification(
state.language === 'fa' ? 'ورود سریع بیومتریک دسکتاپ حذف شد' : 'Desktop biometric quick unlock removed',
'success'
);
} catch (error) {
console.error(error);
showNotification(
state.language === 'fa' ? 'حذف ورود سریع دسکتاپ ناموفق بود' : 'Failed to remove desktop quick unlock',
'error'
);
}
return;
}
if (!state.desktopAuth.supported) {
showNotification(
state.language === 'fa' ? 'احراز هویت محلی در این نسخه دسکتاپ در دسترس نیست' : 'Local device authentication is unavailable in this desktop build',
'error'
);
return;
}
if (!state.masterPassword) {
showNotification(
state.language === 'fa' ? 'برای فعال‌سازی ابتدا با رمز عبور وارد شوید' : 'Unlock with your password first before enabling quick unlock',
'warning'
);
return;
}
try {
/* The phone's key is time-bound, so it is unusable in either direction
   until a prompt has been satisfied -- storing needs one as much as reading
   does. Asking here also proves the sensor works before anything starts
   depending on it. Desktop returns true without prompting. */
if (!await openMobileBiometricWindow()) return;
await invokeDesktopCommand('desktop_store_quick_unlock', {
masterPassword: state.masterPassword
});
markDesktopBiometricPromptHandled();
await refreshDesktopAuthStatus();
renderSecurityCenter();
showNotification(
state.language === 'fa' ? 'ورود سریع بیومتریک دسکتاپ فعال شد' : 'Desktop biometric quick unlock enabled',
'success'
);
} catch (error) {
console.error(error);
showNotification(
state.language === 'fa' ? 'فعالسازی ورود سریع دسکتاپ کامل نشد' : 'Failed to enable desktop quick unlock',
'error'
);
}
return;
}
const existingRecord = getPasskeyRecord();
if (existingRecord) {
localStorage.removeItem(PASSKEY_STORAGE_KEY);
localStorage.removeItem(PASSKEY_LOCAL_WRAP_KEY);
refreshPasskeyUi();
renderSecurityCenter();
showNotification(state.language === 'fa' ? 'Quick unlock با Passkey حذف شد' : 'Passkey quick unlock removed', 'success');
return;
}
if (!supportsPasskeyQuickUnlock()) {
showNotification(getPasskeyUnavailableReason(), 'error');
return;
}
if (!state.masterPassword) {
showNotification(state.language === 'fa' ? 'برای فعال‌سازی Passkey ابتدا با رمز عبور وارد شوید' : 'Unlock with your password first to enroll a passkey', 'warning');
return;
}
/* One WebAuthn ceremony at a time: a second tap while the biometric sheet is
   still up gets OperationError "A request is already pending" from the engine. */
if (passkeyEnrollInFlight) {
showNotification(
state.language === 'fa'
? 'یک درخواست Passkey هنوز باز است؛ تا بسته شود چند لحظه صبر کنید.'
: 'A passkey request is still open; wait a moment for it to close.',
'warning'
);
return;
}
passkeyEnrollInFlight = true;
passkeyEnrollUiBusy = true;
refreshPasskeyUi();
try {
try {
const rpId = getExplicitPasskeyRpId();
/* Enrollment ladder: engines differ in what they accept (Brave on Android,
   older Chromium forks, managed profiles). Try the strictest, best ceremony
   first and relax one constraint per failure — a working browser never
   notices; a picky one still gets a credential. */
const baseRequest = () => ({
challenge: generateSecureRandomBytes(32),
rp: rpId
? { name: 'P00RIJA Cryptography', id: rpId }
: { name: 'P00RIJA Cryptography' },
user: {
id: generateSecureRandomBytes(16),
name: 'poorija-user',
displayName: 'P00RIJA User'
},
pubKeyCredParams: [
{ type: 'public-key', alg: -7 },
{ type: 'public-key', alg: -257 }
],
timeout: 60000,
attestation: 'none',
extensions: {
credProps: true,
prf: {},
largeBlob: {
support: 'preferred'
}
}
});
/* Order matters twice over on phones. (1) The attachment-free shape is the
   one that works on the FIDO2 path Google Play services serves on Android —
   a platform-attachment hint can make some engines complete the fingerprint
   sheet and then never settle the promise. (2) Some Android engines wedge
   the SAME way when the request carries prf/largeBlob extensions the
   platform authenticator cannot honor, so the first phone attempt is bare:
   no extensions at all. Desktop browsers negotiate extensions cleanly and
   keep the full-strength first attempt. */
const bareRequest = () => { const request = baseRequest(); delete request.extensions; return request; };
const attempts = isCoarsePointerDevice()
? [
() => ({ ...bareRequest(), authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } }),
() => ({ ...baseRequest(), authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } }),
() => ({ ...bareRequest(), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } })
]
: [
() => ({ ...baseRequest(), authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' } }),
() => ({ ...baseRequest(), authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' } }),
() => ({ ...baseRequest(), authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' } })
];
let credential = null;
let lastError = null;
/* Engines keep ONE pending WebAuthn request slot. When a sheet is dismissed
   the slot frees asynchronously, so a follow-up create() fired in the same
   tick rejects with OperationError "A request is already pending" — pace
   every retry and give the slot explicit drain time. And when an engine
   wedges the slot for good (ceremony done, promise never settles),
   webauthnWithWatchdog at least frees OUR guard and tells the user to
   reload. */
let pendingRetries = 0;
for (let i = 0; i < attempts.length; i++) {
try {
credential = await webauthnWithWatchdog(() => navigator.credentials.create({ publicKey: attempts[i]() }));
break;
} catch (error) {
lastError = error;
if (String(error?.name || '') === 'PoorigaWebauthnWedged') {
/* The ceremony finished on the device but the engine never settled:
   its slot stays wedged until a page reload, so stop — further
   attempts would only pile up "already pending" rejections. */
break;
}
const name = String(error?.name || '');
const message = String(error?.message || '');
const slotBusy = /OperationError/i.test(name) && /already pending/i.test(message);
if (slotBusy && pendingRetries < 2) {
/* Same shape, wait out the previous request's teardown. */
pendingRetries += 1;
await new Promise((resolve) => setTimeout(resolve, 700));
i -= 1;
continue;
}
if (/NotAllowed|Abort/i.test(name) && i + 1 < attempts.length) {
/* A dismissed sheet (or an engine refusal phrased as NotAllowed) — the
   slot needs a beat before the relaxed request goes out. */
await new Promise((resolve) => setTimeout(resolve, 450));
continue;
}
if (/NotSupported/i.test(name) && i + 1 < attempts.length) continue;
/* Anything else (e.g. SecurityError from a bad RP ID) fails fast. */
break;
}
}
if (!credential) {
const reason = lastError ? `${lastError.name || 'Error'}: ${lastError.message || lastError}` : 'credential creation returned nothing';
throw new Error(reason);
}
const credentialId = arrayBufferToBase64Url(credential.rawId);
/* Kept so every later assertion can name them. Without this the client has to
   assume all transports and, on Android, offers the cross-device chooser
   instead of the fingerprint. */
const transports = readCredentialTransports(credential);
const extensionResults = credential.getClientExtensionResults ? credential.getClientExtensionResults() : {};
const prfEnabled = Boolean(extensionResults.prf?.enabled || extensionResults.prf?.results?.first);
const largeBlobSupported = Boolean(extensionResults.largeBlob?.supported);
let record;
if (prfEnabled) {
const seed = await derivePasskeyPrfSeed(credential.rawId);
const wrapped = await encryptPasskeyPayload(state.masterPassword, seed);
record = {
credentialId,
transports,
createdAt: new Date().toISOString(),
strategy: 'prf',
cipher: wrapped.cipher,
iv: wrapped.iv
};
} else if (largeBlobSupported) {
await writePasskeyLargeBlob(credential.rawId, state.masterPassword);
record = {
credentialId,
transports,
createdAt: new Date().toISOString(),
strategy: 'largeBlob'
};
} else {
/* No PRF, no largeBlob (Brave on Android and friends). The passkey stays
   the user-presence ceremony that gates quick unlock; the master password
   is sealed with a random key kept in this browser's own storage. Weaker
   than PRF — wrap key and blob share a device — but the secret never
   leaves the machine and every passkey-capable browser can play. */
const wrapBytes = generateSecureRandomBytes(32);
const wrapped = await encryptPasskeyPayload(state.masterPassword, wrapBytes);
record = setPasskeyWrapKey({
credentialId,
transports,
createdAt: new Date().toISOString(),
strategy: 'presence',
cipher: wrapped.cipher,
iv: wrapped.iv
}, arrayBufferToBase64(wrapBytes));
}
setPasskeyRecord(record);
refreshPasskeyUi();
renderSecurityCenter();
showNotification(
prfEnabled
? (state.language === 'fa' ? 'Passkey quick unlock با موفقیت فعال شد' : 'Passkey quick unlock enabled')
: (state.language === 'fa' ? 'Passkey quick unlock با fallback سازگار این مرورگر فعال شد' : 'Passkey quick unlock enabled with a browser-compatible fallback'),
'success'
);
} catch (error) {
console.error('[passkey-enroll]', error);
const cancelled = /NotAllowed|cancel|aborted/i.test(`${error?.name || ''} ${error?.message || ''}`);
/* Everything the engine said, written down where a report can reach it and
   nowhere a person has to read it. Same record the unlock path writes. */
try {
localStorage.setItem('poorija_passkey_last_error', JSON.stringify({
at: new Date().toISOString(),
where: 'enroll',
name: error?.name || 'Error',
message: String(error?.message || '').slice(0, 200),
advice: describePasskeyError(error) || '',
env: describePasskeyEnvironment(),
}));
} catch (_e) { /* reporting must never throw */ }
/* The engine's raw refusal used to be pasted into this toast. Same reasoning
   as the lock screen: recorded, not displayed. Whether the person cancelled is
   the one distinction they can act on, so it is the one that survives. */
showNotification(
cancelled
? (state.language === 'fa' ? 'فعال‌سازی بایومتریک لغو شد.' : 'Biometric setup was cancelled.')
: (state.language === 'fa' ? 'فعال‌سازی بایومتریک انجام نشد.' : 'Biometric setup did not go through.'),
'error'
);
}
} finally {
passkeyEnrollInFlight = false;
passkeyEnrollUiBusy = false;
refreshPasskeyUi();
}
}
let passkeyUnlockInFlight = false;
async function unlockWithPasskey() {
const unlockBtn = document.getElementById('passkeyUnlockBtn');
if (passkeyUnlockInFlight) {
/* NEVER a silent return: on engines that wedge (no sheet, no settle) the
   second tap is the moment the user tells us "nothing is happening". */
showPasskeyUnlockError(
state.language === 'fa'
? 'یک درخواست Passkey در جریان است. اگر پنجرهٔ اثر انگشت نیامده است، صفحه را یک بار رفرش کنید و دوباره بزنید.'
: 'A passkey request is already running. If no fingerprint window appeared, reload the page once and try again.'
);
return;
}
passkeyUnlockInFlight = true;
const busyLabel = state.language === 'fa' ? 'در حال احراز هویت…' : 'Authenticating…';
const busyHtml = `<i class="fas fa-fingerprint ml-2 animate-pulse"></i><span>${busyLabel}</span>`;
const previousHtml = unlockBtn ? unlockBtn.innerHTML : '';
if (unlockBtn) {
unlockBtn.disabled = true;
unlockBtn.innerHTML = busyHtml;
unlockBtn.classList.add('opacity-70', 'cursor-wait');
}
try {
return await runPasskeyUnlock();
} finally {
passkeyUnlockInFlight = false;
if (unlockBtn) {
unlockBtn.disabled = false;
unlockBtn.innerHTML = previousHtml;
unlockBtn.classList.remove('opacity-70', 'cursor-wait');
}
}
}
async function runPasskeyUnlock() {
if (isDesktopAppRuntime()) {
if (!state.desktopAuth.enabled) {
showNotification(
state.language === 'fa' ? 'ورود سریع بیومتریک برای این دستگاه فعال نشده است' : 'Desktop biometric quick unlock is not enabled on this device',
'warning'
);
return;
}
try {
if (!await openMobileBiometricWindow()) return;
const recovered = await invokeDesktopCommand('desktop_unlock_with_biometric');
if (!await adoptFromPassword(recovered)) {
  showNotification(
    state.language === 'fa' ? 'باز کردن انبار ناموفق بود' : 'The vault did not open',
    'error');
  return;
}
unlockUI();
showNotification(
state.language === 'fa' ? 'برنامه با احراز هویت محلی باز شد' : 'Unlocked with local device authentication',
'success'
);
} catch (error) {
console.error(error);
showNotification(
state.language === 'fa' ? 'باز کردن با احراز هویت محلی ناموفق بود' : 'Local device authentication failed',
'error'
);
}
return;
}
const passkeyRecord = getPasskeyRecord();
if (!passkeyRecord) {
showNotification(state.language === 'fa' ? 'Passkey برای این دستگاه تنظیم نشده است' : 'No passkey is configured for this device', 'warning');
return;
}
/* The passkey replaces the password, nothing else: the temporary lockout
   and the 2FA code the password path enforces apply here too. */
const lockUntil = parseInt(localStorage.getItem('poorija_lock_until') || '0');
if (Date.now() < lockUntil) {
showLockTimer(lockUntil);
return;
}
if (!verifySecondFactor()) return;
try {
if (passkeyRecord.strategy === 'largeBlob') {
const payload = await webauthnWithWatchdog(() => readPasskeyLargeBlob(base64UrlToArrayBuffer(passkeyRecord.credentialId)));
if (!await adoptFromPassword(payload.masterPassword)) {
  throw new Error('the recovered password did not open the vault');
}
} else if (passkeyRecord.strategy === 'presence') {
/* Presence fallback: the user-verification ceremony MUST run before the
   local unwrap — without it the stored wrap key alone would open the
   vault, no biometrics ever asked. */
await runPasskeyPresenceCeremony(passkeyRecord.credentialId);
const wrapB64 = getPasskeyWrapKey(passkeyRecord);
if (!wrapB64) {
const missing = new Error('local wrap key is missing — quick unlock must be set up again');
missing.name = 'PoorigaPasskeyStale';
throw missing;
}
const master = await decryptPasskeyPayload(passkeyRecord, base64ToArrayBuffer(wrapB64));
if (!await adoptFromPassword(master)) {
  throw new Error('the recovered password did not open the vault');
}
} else {
const seed = await webauthnWithWatchdog(() => derivePasskeyPrfSeed(base64UrlToArrayBuffer(passkeyRecord.credentialId)));
if (!await adoptFromPassword(await decryptPasskeyPayload(passkeyRecord, seed))) {
  throw new Error('the recovered password did not open the vault');
}
}
unlockUI();
localStorage.removeItem('poorija_passkey_last_error');
clearPasskeyUnlockError();
showNotification(state.language === 'fa' ? 'برنامه با Passkey باز شد' : 'Unlocked with passkey', 'success');
} catch (error) {
console.error('[passkey-unlock]', error);
/* unlockUI() is the last line of the try, so anything that throws leaves the
   lock screen up — but adoptFromPassword() may already have opened the vault
   before the throw. Put it back rather than leaving the master password in
   memory behind a screen that says "locked". */
if (state.isLocked && state.activeProfile) abandonOpenedProfile();
try {
localStorage.setItem('poorija_passkey_last_error', JSON.stringify({
at: new Date().toISOString(),
where: 'unlock',
name: error?.name || 'Error',
message: String(error?.message || '').slice(0, 200),
/* The engine-specific advice and the capability snapshot: the four things
   that decide whether any of this can work, none of which is visible from
   outside the device. Read with
   JSON.parse(localStorage.getItem('poorija_passkey_last_error'))
   when somebody reports that the fingerprint does not open the app. */
advice: describePasskeyError(error) || '',
env: describePasskeyEnvironment(),
}));
} catch (_e) { /* reporting must never throw */ }
/* One sentence, and it says what to do next — not what went wrong.
 *
 * This line used to carry the engine's own error name, a per-engine
 * explanation, and a diagnostic of the device's WebAuthn capabilities. All of
 * that is worth having and none of it belongs on a lock screen: somebody whose
 * fingerprint was not accepted wants to know they can type their password, not
 * to read `NotAllowedError` beside a list of capability flags. The detail is
 * still collected — console.error above, and poorija_passkey_last_error below
 * with the same capability snapshot — so a report is one localStorage read
 * away. It is simply not shown. */
showPasskeyUnlockError(state.language === 'fa'
? 'باز کردن با بایومتریک انجام نشد. با رمز عبور وارد شوید.'
: 'Biometric unlock did not go through. Sign in with your password.');
}
}
/* Editable for keyboard purposes: the elements a soft keyboard opens for. */
function isEditableTarget(node) {
if (!node || node.nodeType !== 1) return false;
const tag = node.tagName;
if (tag === 'TEXTAREA') return true;
if (node.isContentEditable) return true;
if (tag !== 'INPUT') return false;
/* Buttons, checkboxes and the like are inputs that no keyboard follows. */
return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image']
.includes(String(node.type || 'text').toLowerCase());
}

/* Storage redirection goes in before anything can read or write. Every
   poorija_* name other than the device-level ones is rewritten into the open
   profile's namespace; with no profile open, names pass through unchanged so
   the lock screen still finds the language and the lockout counters. */
window.PoorijaVault.installNamespacing(() => state.activeProfile);

function checkFirstVisit() {
const hasSetup = window.PoorijaVault.hasVault() || window.PoorijaVault.hasLegacyVault();
const hasLang = localStorage.getItem('poorija_lang');
const mobileInstallGate = document.getElementById('mobileInstallGate');
const langScreen = document.getElementById('langScreen');
const lockScreen = document.getElementById('lockScreen');
syncPwaRuntimeState();
if (mobileInstallGate) {
const shouldShowGate = state.pwa.touch && !state.pwa.standalone && !state.installGateDismissed && !isDesktopAppRuntime();
mobileInstallGate.classList.toggle('hidden', !shouldShowGate);
if (shouldShowGate) {
if (langScreen) langScreen.classList.add('hidden');
if (lockScreen) lockScreen.classList.add('hidden');
renderMobileInstallGate();
return;
}
}
if (!hasLang) {
// Show language selection first
document.getElementById('langScreen').classList.remove('hidden');
document.getElementById('lockScreen').classList.add('hidden');
} else if (!hasSetup) {
// Language selected but no master password - show setup
document.getElementById('langScreen').classList.add('hidden');
document.getElementById('lockScreen').classList.remove('hidden');
document.getElementById('initialSetup').classList.remove('hidden');
document.getElementById('loginSection').classList.add('hidden');
updateLanguage();
if (typeof initSecQuestionsUI === 'function') {
initSecQuestionsUI();
}
} else {
// Fully setup - show login
document.getElementById('langScreen').classList.add('hidden');
document.getElementById('lockScreen').classList.remove('hidden');
document.getElementById('initialSetup').classList.add('hidden');
document.getElementById('loginSection').classList.remove('hidden');
// Check if 2FA enabled
const has2FA = localStorage.getItem('poorija_2fa');
if (has2FA) {
state.twoFA = JSON.parse(has2FA);
if (state.twoFA.enabled) {
document.getElementById('login2FASection').classList.remove('hidden');
}
}
updateLanguage();
}
syncLockScreenLayout();
refreshPasskeyUi();
}
function renderMobileInstallGate() {
const gate = document.getElementById('mobileInstallGate');
if (!gate) return;
const isFa = state.language === 'fa';
const androidSteps = [
isFa ? 'Chrome یا Edge را باز کنید.' : 'Open Chrome or Edge.',
isFa ? 'منوی مرورگر را باز کنید.' : 'Open the browser menu.',
isFa ? 'Install app یا Add to Home screen را انتخاب کنید.' : 'Choose Install app or Add to Home screen.',
isFa ? 'پس از نصب، برنامه را از آیکون تازه اجرا کنید.' : 'Launch the installed icon afterwards.'
];
const iosSteps = [
isFa ? 'صفحه را در Safari باز کنید.' : 'Open the page in Safari.',
isFa ? 'روی Share بزنید.' : 'Tap Share.',
isFa ? 'Add to Home Screen را انتخاب کنید.' : 'Choose Add to Home Screen.',
isFa ? 'برنامه را از Home Screen اجرا کنید تا حالت PWA فعال شود.' : 'Launch the app from the Home Screen to enable the full PWA mode.'
];
document.getElementById('mobileInstallGateTitle').textContent = isFa ? 'نسخه PWA را نصب کنید' : 'Install the PWA version';
document.getElementById('mobileInstallGateBody').textContent = isFa
? 'برای تجربه روان‌تر، آفلاین، نوارهای کمتر، و دسترسی بهتر به قابلیت‌های امنیتی دستگاه، این برنامه را به شکل PWA نصب کنید.'
: 'Install this app as a PWA for a smoother full-screen experience, offline readiness, and better access to supported device security features.';
document.getElementById('mobileInstallGateBtn').textContent = isFa ? 'نصب / راهنمای نصب' : 'Install / open guide';
document.getElementById('mobileInstallGateAndroidSteps').innerHTML = androidSteps.map((step) => `<li>${step}</li>`).join('');
document.getElementById('mobileInstallGateIosSteps').innerHTML = iosSteps.map((step) => `<li>${step}</li>`).join('');
}
function continueInBrowserExperience() {
state.installGateDismissed = true;
checkFirstVisit();
}
function selectLanguage(lang) {
state.language = lang;
localStorage.setItem('poorija_lang', lang);
document.documentElement.lang = lang;
document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
// Check if we need setup or login
const hasSetup = window.PoorijaVault.hasVault() || window.PoorijaVault.hasLegacyVault();
document.getElementById('langScreen').classList.add('hidden');
document.getElementById('lockScreen').classList.remove('hidden');
if (!hasSetup) {
document.getElementById('initialSetup').classList.remove('hidden');
document.getElementById('loginSection').classList.add('hidden');
if (typeof initSecQuestionsUI === 'function') {
initSecQuestionsUI();
}
} else {
document.getElementById('initialSetup').classList.add('hidden');
document.getElementById('loginSection').classList.remove('hidden');
}
updateLanguage();
syncLockScreenLayout();
refreshPasskeyUi();
}
function goBackToLang() {
document.getElementById('lockScreen').classList.add('hidden');
document.getElementById('langScreen').classList.remove('hidden');
syncLockScreenLayout();
}
function switchLanguage() {
state.language = state.language === 'fa' ? 'en' : 'fa';
localStorage.setItem('poorija_lang', state.language);
updateLanguage();
}
function updateLanguage() {
const texts = translations[state.language];
/* The lang and dir attributes belong here, not in switchLanguage.
   index.html ships lang="fa" dir="rtl", and only switchLanguage ever changed
   them — so somebody whose saved language was English loaded the app into an
   English interface that the document still described as Persian and
   right-to-left, until they toggled the button and came back. A screen reader
   read English text with Persian pronunciation rules, and any rule keyed on
   [lang] or [dir] chose the wrong branch. Setting them here means the document
   says what it is from the first paint, however the language was arrived at. */
document.documentElement.lang = state.language;
document.documentElement.dir = state.language === 'fa' ? 'rtl' : 'ltr';
populateAlgorithmSelects();
// Update all elements with data-i18n
document.querySelectorAll('[data-i18n]').forEach(el => {
const key = el.getAttribute('data-i18n');
if (texts[key]) {
el.textContent = texts[key];
}
});
document.querySelectorAll('[data-i18n-html]').forEach(el => {
const key = el.getAttribute('data-i18n-html');
if (texts[key]) {
el.innerHTML = texts[key];
}
});
// Update placeholders
document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
const key = el.getAttribute('data-i18n-placeholder');
if (texts[key]) {
el.placeholder = texts[key];
}
});
document.querySelectorAll('[data-i18n-title]').forEach(el => {
const key = el.getAttribute('data-i18n-title');
if (texts[key]) {
el.title = texts[key];
}
});
document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
const key = el.getAttribute('data-i18n-aria-label');
if (texts[key]) {
el.setAttribute('aria-label', texts[key]);
}
});
// Update button
document.getElementById('langBtn').textContent = state.language === 'fa' ? 'FA / EN' : 'EN / FA';
// Update 2FA status
const fa2Status = document.getElementById('2faStatus');
if (fa2Status) {
fa2Status.textContent = state.twoFA.enabled ? texts.enabled : texts.disabled;
}
const btn = document.getElementById('2faToggleBtn');
if (btn) {
btn.classList.toggle('bg-red-500', state.twoFA.enabled);
btn.classList.toggle('bg-brand-500', !state.twoFA.enabled);
btn.classList.toggle('hover:bg-red-600', state.twoFA.enabled);
btn.classList.toggle('hover:bg-brand-600', !state.twoFA.enabled);
btn.textContent = state.twoFA.enabled ? texts.disable : texts.enable;
}
const mobileNavToggle = document.getElementById('mobileNavToggle');
if (mobileNavToggle) {
const label = document.getElementById('appSidebar')?.classList.contains('open')
? texts.closeMenu
: texts.openMenu;
mobileNavToggle.setAttribute('aria-label', label);
mobileNavToggle.setAttribute('title', label);
}
const setupPasswordInput = document.getElementById('setupPassword');
if (setupPasswordInput) {
checkPasswordStrength(setupPasswordInput.value);
}
const encryptionPasswordInput = document.getElementById('encPassword');
if (encryptionPasswordInput) {
checkPasswordStrength(encryptionPasswordInput.value, 'enc');
}
renderKeysDropdown();
renderKeysList();
renderPasswords();
renderSecureNotes();
renderSecurityCenter();
renderHistory('encrypt');
renderHistory('decrypt');
window.dispatchEvent(new CustomEvent('poorija:language-changed', { detail: { language: state.language } }));
refreshPasskeyUi();
if (typeof window.initSecQuestionsUI === 'function') {
window.initSecQuestionsUI();
}
updateSetupButtonState();
syncDesktopAppearanceUi();
syncDesktopNotificationUi();
syncUnifiedPushUi();
/* The line under the background-notification switch is written with
   textContent, not carried by data-i18n, because which of the five sentences
   it shows depends on the subscription's state rather than on any key. Nothing
   called this on a language change, so the label above it turned English while
   the sentence below stayed in the language it was born in. */
syncPushSettingsUi();
syncShredderDesktopUi();
renderTabOrderCustomizer();
/* The bottom bar on a phone builds its labels from state.language in
   renderMobileTabBar, but nothing called it here — only syncMobileTabBar did,
   and that runs on a tab change. So switching language left the five buttons
   along the bottom of the screen in the old language until the user happened
   to move to another tab, which is exactly what was reported. The settings
   list that configures those buttons shows the same labels and had the same
   gap. */
renderMobileTabBar();
renderMobileTabBarSettings();
}
// ==================== Password Visibility ====================
function togglePasswordVisibility(inputId, btn) {
const input = document.getElementById(inputId);
const icon = btn.querySelector('i');
if (input.type === 'password') {
input.type = 'text';
icon.classList.remove('fa-eye');
icon.classList.add('fa-eye-slash');
} else {
input.type = 'password';
icon.classList.remove('fa-eye-slash');
icon.classList.add('fa-eye');
}
}
// ==================== Password Strength ====================
function checkPasswordStrength(password, prefix = '') {
const checks = {
length: password.length >= 8,
upper: /[a-z]/.test(password) && /[A-Z]/.test(password),
number: /[0-9]/.test(password),
special: /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)
};
// Update UI
const reqLength = document.getElementById(prefix ? `${prefix}-req-length` : 'req-length');
const reqUpper = document.getElementById(prefix ? `${prefix}-req-upper` : 'req-upper');
const reqNumber = document.getElementById(prefix ? `${prefix}-req-number` : 'req-number');
const reqSpecial = document.getElementById(prefix ? `${prefix}-req-special` : 'req-special');
if (reqLength) {
reqLength.classList.toggle('valid', checks.length);
reqLength.classList.toggle('invalid', !checks.length);
}
if (reqUpper) {
reqUpper.classList.toggle('valid', checks.upper);
reqUpper.classList.toggle('invalid', !checks.upper);
}
if (reqNumber) {
reqNumber.classList.toggle('valid', checks.number);
reqNumber.classList.toggle('invalid', !checks.number);
}
if (reqSpecial) {
reqSpecial.classList.toggle('valid', checks.special);
reqSpecial.classList.toggle('invalid', !checks.special);
}
// Calculate strength
const score = Object.values(checks).filter(Boolean).length;
const bar = document.getElementById(prefix ? `${prefix}-strengthBar` : 'strengthBar');
const text = document.getElementById(prefix ? `${prefix}-strengthText` : 'strengthText');
if (bar && text) {
const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500'];
const widths = ['25%', '50%', '75%', '100%'];
const labels = state.language === 'fa' ? ['ضعیف', 'متوسط', 'قوی', 'بسیار قوی'] : ['Weak', 'Medium', 'Strong', 'Very Strong'];
bar.className = `h-full transition-all duration-500 ${colors[score - 1] || 'bg-gray-300'}`;
bar.style.width = widths[score - 1] || '0%';
text.textContent = labels[score - 1] || '-';
text.className = score === 4 ? 'text-green-500 font-bold' : 'text-gray-500';
}
updateSetupButtonState();
return score === 4;
}
// Setup password listener
document.getElementById('setupPassword')?.addEventListener('input', (e) => {
checkPasswordStrength(e.target.value);
});
/* ==================== 2FA ====================
   The setup trio that used to sit here — toggle2FASetup, generate2FASecret and
   verify2FASetup — was removed by an audit. It had no callers anywhere in the
   project, and it read four elements (enable2FAToggle, setup2FASection, qrcode,
   secretKey, verify2FACode) that exist in no markup, WITHOUT null guards. So it
   could only ever throw, and it sat directly above the working implementation
   under a heading that made it look like the live one.
   The 2FA that is actually wired is toggle2FA(), further down and reached from
   the #2faToggleBtn button in Settings. */
// ==================== Lock Screen ====================
async function setupMasterPassword() {
const pass = document.getElementById('setupPassword').value;
const confirm = document.getElementById('confirmPassword').value;
const acceptedTerms = document.getElementById('acceptTermsCheckbox')?.checked;
if (!checkPasswordStrength(pass)) {
showNotification(state.language === 'fa' ? 'رمز عبور باید تمام شرایط را داشته باشد' : 'Password must meet all requirements', 'error');
return;
}
if (pass !== confirm) {
showNotification(state.language === 'fa' ? 'رمزها مطابقت ندارند' : 'Passwords do not match', 'error');
return;
}
// Verify Security Questions
const q1 = document.getElementById('secQ1').value;
const q2 = document.getElementById('secQ2').value;
const q3 = document.getElementById('secQ3').value;
const a1 = document.getElementById('secA1').value;
const a2 = document.getElementById('secA2').value;
const a3 = document.getElementById('secA3').value;
if (!q1 || !q2 || !q3 || !a1 || !a2 || !a3) {
showNotification(state.language === 'fa' ? 'لطفا ۳ سوال امنیتی را انتخاب و پاسخ دهید' : 'Please select and answer 3 security questions', 'error');
return;
}
if (!acceptedTerms) {
showNotification(state.language === 'fa' ? 'برای ادامه باید شرایط استفاده را بپذیرید' : 'You must accept the terms before continuing', 'error');
return;
}
const hash = await hashPassword(pass);
// Save Security Questions
const sqData = {
q1: parseInt(q1), a1: await hashAnswer(a1),
q2: parseInt(q2), a2: await hashAnswer(a2),
q3: parseInt(q3), a3: await hashAnswer(a3)
};
localStorage.setItem('poorija_sq', JSON.stringify(sqData));
await writeMasterPasswordRecord(pass);
state.masterPassword = pass;
unlockUI();
}
let lockTimerInterval;
function showLockTimer(unlockTime) {
document.getElementById('loginInputsSection').classList.add('hidden');
const timerSection = document.getElementById('loginLockTimerSection');
timerSection.classList.remove('hidden');
const timerDisplay = document.getElementById('loginCountdownTimer');
clearInterval(lockTimerInterval);
function update() {
const remain = Math.ceil((unlockTime - Date.now()) / 1000);
if (remain <= 0) {
clearInterval(lockTimerInterval);
timerSection.classList.add('hidden');
document.getElementById('loginInputsSection').classList.remove('hidden');
return;
}
const m = Math.floor(remain / 60);
const s = remain % 60;
timerDisplay.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
update();
lockTimerInterval = setInterval(update, 1000);
}
/* Setting the duress password does not create a second vault — one has existed
   since setup, furnished and aged. This only chooses which password reaches it.

   Note what is deliberately absent: there is no way to ask the app whether a
   duress password is configured. Any such flag would be a place an adversary
   could read the answer, so the only way to find out is to enter it. */
async function setPanicPassword(inputId = 'panicPasswordInput') {
const inputEl = document.getElementById(inputId);
const pass = inputEl ? inputEl.value : '';
const fa = state.language === 'fa';
if (!pass) {
showNotification(fa ? 'رمز اضطراری نمی‌تواند خالی باشد' : 'Duress password cannot be empty', 'warning');
return;
}
if (pass.length < 8) {
showNotification(fa ? 'رمز اضطراری باید دست‌کم ۸ نویسه باشد' : 'The duress password needs at least 8 characters', 'warning');
return;
}
try {
await window.PoorijaVault.setAlternatePassword(state.activeProfile, pass);
if (inputEl) inputEl.value = '';
showNotification(fa
? 'رمز اضطراری تنظیم شد. وارد کردن آن، فضای دیگری را باز می‌کند — چیزی پاک نمی‌شود.'
: 'Duress password set. Entering it opens a different space — nothing is erased.', 'success');
} catch (error) {
if (error && error.message === 'DUPLICATE_PASSWORD') {
showNotification(fa
? 'این رمز همین حالا یک فضا را باز می‌کند. رمز دیگری انتخاب کنید.'
: 'That password already opens a space. Choose a different one.', 'error');
return;
}
console.error('[Vault] could not set the duress password:', error);
showNotification(fa ? 'تنظیم رمز اضطراری ناموفق بود' : 'Could not set the duress password', 'error');
}
}

async function clearPanicPassword() {
const fa = state.language === 'fa';
try {
const ok = await window.PoorijaVault.clearAlternate(state.activeProfile);
showNotification(ok
? (fa ? 'رمز اضطراری برداشته شد.' : 'Duress password removed.')
: (fa ? 'چیزی برای برداشتن نبود.' : 'There was nothing to remove.'),
ok ? 'success' : 'info');
} catch (error) {
console.error('[Vault] could not clear the duress password:', error);
showNotification(fa ? 'عملیات ناموفق بود' : 'That did not work', 'error');
}
}

/* Kept, and reachable only from the nuclear-wipe button on the lock screen.
   It is no longer wired to any password. */
function triggerPanicWipe() {
  window.wipeAllData(true);
}

/* Opens whichever slot the password opens, converting a pre-vault installation
   on the way. Returns null when nothing opens — which is the only signal the
   caller gets, and the only one it should have. */
async function openVaultForUnlock(password) {
  const vault = window.PoorijaVault;
  if (vault.hasLegacyVault()) {
    const migrated = await vault.migrateLegacy(password, legacyVerifyMasterPassword);
    if (migrated) return migrated;
  }
  return vault.openVault(password);
}

/* The pre-vault verifier, kept only so migrateLegacy can prove a password
   against the old record before replacing it. Nothing else calls it. */
async function legacyVerifyMasterPassword(password) {
  const saved = localStorage.getItem('poorija_master_hash') || '';
  if (!saved) return false;
  if (saved.trim().startsWith('{')) {
    try {
      const record = JSON.parse(saved);
      if (record.v === 2 && record.phc) {
        const advanced = window.PoorijaAdvancedCrypto;
        if (!advanced?.verifyPassword) return false;
        return await advanced.verifyPassword(password, record.phc);
      }
    } catch (error) {
      return false;
    }
    return false;
  }
  return (await hashPassword(password)) === saved;
}
/* The second factor, asked the same way by every door.
 *
 * Two bugs lived in the copies this replaces. The password path validated the
 * code AFTER adoptProfile() had already set state.activeProfile and
 * state.masterPassword, and its failure branch was a bare `return`: a correct
 * password with a wrong code left the lock screen up and the vault wide open
 * in memory, with the auto-lock timer never started. And neither copy counted
 * a wrong code, so the six digits could be guessed for as long as the attacker
 * cared to keep typing while the password lockout ladder — which only ever saw
 * correct passwords — stayed at zero.
 *
 * Returns true when the door may open. A false has already told the user why
 * and has already charged the attempt. */
function verifySecondFactor() {
  if (!state.twoFA.enabled) return true;
  const code = document.getElementById('login2FACode')?.value || '';
  let valid = false;
  try {
    const totp = new window.OTPAuth.TOTP({
      issuer: 'P00RIJÃ Cryptography',
      label: 'User',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: window.OTPAuth.Secret.fromBase32(state.twoFA.secret)
    });
    valid = totp.validate({ token: code, window: 1 }) !== null;
  } catch (error) {
    console.error('[2fa] could not evaluate the code:', error);
    valid = false;
  }
  if (valid) return true;
  noteFailedSignIn();
  showNotification(state.language === 'fa' ? 'کد تایید نامعتبر' : 'Invalid 2FA code', 'error');
  return false;
}

/* A wrong answer at the lock screen, whichever half of it was wrong. Charges
   the same ladder the password path has always used, so a second factor can no
   longer be guessed for free beside a lockout that never moves. */
function noteFailedSignIn() {
  const attempts = parseInt(localStorage.getItem('poorija_failed_logins') || '0', 10) + 1;
  localStorage.setItem('poorija_failed_logins', String(attempts));
  const ladder = [1, 3, 6, 9, 10, 20];
  if (attempts >= 3 && attempts < 3 + ladder.length) {
    const until = Date.now() + ladder[attempts - 3] * 60 * 1000;
    localStorage.setItem('poorija_lock_until', String(until));
    showLockTimer(until);
  }
  return attempts;
}

/* Undo an opened vault. adoptProfile() is what switches the storage
   redirection over, so anything that opens a profile and then decides the
   person is not authorised has to put all three back — leaving the master
   password behind is the whole of the bug this exists to prevent. */
function abandonOpenedProfile() {
  state.activeProfile = null;
  state.masterPassword = null;
  state.storageKeyCache = { password: '', salt: '', keys: null };
  state.isLocked = true;
}

async function unlockApp() {
const now = Date.now();
const lockUntil = parseInt(localStorage.getItem('poorija_lock_until') || '0');
if (now < lockUntil) {
showLockTimer(lockUntil);
return;
}
// Remove lockout status if time has passed
if (lockUntil > 0 && now >= lockUntil) {
localStorage.removeItem('poorija_lock_until');
document.getElementById('loginLockTimerSection').classList.add('hidden');
document.getElementById('loginInputsSection').classList.remove('hidden');
}
let failedAttempts = parseInt(localStorage.getItem('poorija_failed_logins') || '0');
const lockoutMinutes = [1, 3, 6, 9, 10, 20];
// Check permanent lockout BEFORE hashing and checking password
if (failedAttempts >= 3 + lockoutMinutes.length) {
document.getElementById('loginMainSection').classList.add('hidden');
window.showResetPassword();
return;
}
const pass = document.getElementById('unlockPassword').value;

/* There is no panic branch here any more, and that is the point.

   The old code hashed the input, compared it against poorija_panic_hash, and
   wiped the device on a match. Two separate failures: the second hash sitting
   in localStorage announced that a duress password existed, and wiping is not
   an escape from compulsion — an empty vault is an answer, and a visibly
   destroyed one invites the next question.

   Now the password simply opens whichever of the two slots it opens. Neither
   the code nor the stored data distinguishes them, so there is nothing here
   for an adversary reading this file to look for on the device. The nuclear
   wipe still exists, deliberately, as its own button for its own moment. */
const openedProfile = await openVaultForUnlock(pass);
if (!openedProfile) {
failedAttempts = noteFailedSignIn();
if (failedAttempts >= 3 + lockoutMinutes.length) {
// Permanent lockout
document.getElementById('loginMainSection').classList.add('hidden');
window.showResetPassword();
return;
}
const errorEl = document.getElementById('loginError');
errorEl.classList.remove('hidden');
setTimeout(() => errorEl.classList.add('hidden'), 3000);
return;
}
/* The second factor decides BEFORE the profile is adopted. The reverse order
   meant a wrong code returned with the vault already open in memory — and
   before the counter is cleared, because clearing it first would let somebody
   who already has the password reset the ladder to zero on every attempt and
   guess the six digits forever. */
if (!verifySecondFactor()) return;
// Both halves answered: clear failures
localStorage.removeItem('poorija_failed_logins');
localStorage.removeItem('poorija_lock_until');
/* Adopt before anything reads poorija_*: until this runs, the storage
   redirection has no profile to point at and reads would hit the flat names. */
adoptProfile(openedProfile, pass);
try {
  await migrateLegacyStorageIntoProfile(openedProfile, pass);
} catch (error) {
  console.warn('[Vault] legacy storage migration failed:', error);
}
/* adoptFromPassword() is the same three steps; unlockApp already has the
   opened profile in hand from its own openVaultForUnlock call, so it keeps
   them inline rather than deriving the key a second time. */
unlockUI();
clearPasskeyUnlockError();
void healPasskeyRecordAfterUnlock();
}
function unlockUI() {
/* The structural half of the quick-unlock fix.
   Without a profile the storage redirection has nothing to point at: reads
   return null and writes throw. Showing the app in that state means every
   change the user makes is quietly discarded, which is a far worse outcome
   than refusing to open. */
if (!state.activeProfile) {
  console.error('[Vault] refusing to unlock the interface: no profile is open.');
  showNotification(
    state.language === 'fa'
      ? 'انبار باز نشد. لطفاً با رمز عبور وارد شوید.'
      : 'The vault did not open. Please sign in with your password.',
    'error');
  state.masterPassword = null;
  state.isLocked = true;
  return;
}
state.isLocked = false;
/* body.app-locked is what hides the phone's quick-access bar while the lock
   screen is up. lockApp() sets it; removing it used to live in unlockApp(),
   which is only the password path. Every other way back in — the passkey, the
   desktop biometric, and the two security-question routes — calls this
   function directly, so the class survived the unlock: the app opened, the
   tabs worked, and the bar at the bottom of the PWA was simply gone until the
   next full reload. It was also being cleared before the password had been
   checked rather than after, which is the wrong order for a class that means
   "this app is locked". Here it is one line, after the profile guard, on the
   path all four routes share. */
try { document.body.classList.remove('app-locked'); } catch (_error) { /* pre-body call */ }
document.getElementById('lockScreen').style.opacity = '0';
setTimeout(() => {
document.getElementById('lockScreen').classList.add('hidden');
document.getElementById('mainApp').classList.remove('hidden', 'opacity-0');
syncResponsiveShell();
setInstallButtonsVisibility();
}, 400); // Slightly faster transition

// Defer heavy data loading to after the UI transition has started
setTimeout(() => {
loadKeys();
applyTabFromLocation();
loadActiveTabDataNow();
schedulePostUnlockLoads();
}, 100);

syncResponsiveShell();
if (state.pendingIncomingShare) {
switchTab('share');
const incomingInput = document.getElementById('secureShareInput');
if (incomingInput && !incomingInput.value) {
incomingInput.value = state.pendingIncomingShare;
}
syncSecureShareOpenUi();
}
consumePendingSharedPayload();
consumePendingLaunchFiles();
resetAutoLockTimer();
syncLockScreenLayout();
syncDesktopAppearanceUi();
syncWindowControlsOverlayUi();
syncAppBadge();
setTimeout(() => {
showDesktopBiometricPromptIfNeeded();
}, 700);
setTimeout(() => {
window.dispatchEvent(new CustomEvent('poorija:unlock', { detail: { activeTab: state.activeTab } }));
}, state.activeTab === 'chat' ? 0 : 200); // Give more breathing room for other tabs
}
function loadActiveTabDataNow() {
if (state.activeTab === 'passwords') loadPasswords();
if (state.activeTab === 'notes') loadSecureNotes();
if (state.activeTab === 'share') {
loadSecureNotes();
loadShareHistory();
}
if (state.activeTab === 'signatures') loadSignatureHistory();
if (state.activeTab === 'securitycenter') renderSecurityCenter();
}
function schedulePostUnlockLoads() {
const loaded = new Set([state.activeTab]);
const later = (name, fn, delay) => {
if (loaded.has(name)) return;
setTimeout(fn, delay);
};
later('passwords', loadPasswords, 40);
later('notes', loadSecureNotes, 80);
later('share', loadShareHistory, 120);
later('signatures', loadSignatureHistory, 160);
later('securitycenter', renderSecurityCenter, 220);
}
function lockApp() {
/* What this does and does NOT clear, stated plainly, because the three lines
   below look like they close the vault and they do not.
 *
 * state.activeProfile survives, and it carries `dkey` — the profile's data
 * key. The master password only ever UNWRAPS that key; once unwrapped, dkey
 * alone is what encryptStorageData/decryptStorageData use. So after this runs,
 * with state.masterPassword null and the key cache emptied, any script in this
 * page can still read and write every byte in the profile. Measured, not
 * assumed: a value written before the lock reads back in full after it.
 *
 * That is deliberate and it is what 2.111 is built on. A locked app stays
 * connected and keeps receiving: sealed envelopes are opened, messages and
 * media are written into encrypted storage, badges are raised — and every one
 * of those needs the key. Dropping dkey here would give back a stricter lock
 * and take away offline delivery, which is the feature the previous release
 * existed to fix.
 *
 * So the lock is a screen plus a stop on the interface, not a zeroisation of
 * key material. It stops somebody holding the device; it does not stop script
 * running in this page (an extension, an injection, a console). Closing the
 * tab is what actually clears the key.
 *
 * If that trade is ever revisited, the shape is to hand the inbound path a
 * narrowly-scoped key of its own rather than to keep the general one. */
try { document.body.classList.add('app-locked'); } catch (e) {}
state.isLocked = true;
state.masterPassword = null;
state.storageKeyCache = { password: '', salt: '', keys: null };
document.getElementById('unlockPassword').value = '';
const login2FA = document.getElementById('login2FACode');
if (login2FA) login2FA.value = '';
/* Hide the virtual keyboard, and blur whatever it was typing into.
 *
 * This read a bare `inputId`, which is a parameter of toggleVirtualKeyboard()
 * and does not exist in this function. Reading an undeclared binding is a
 * ReferenceError, not undefined, so the lock button threw here — after
 * state.isLocked had already been set to true and the master password
 * discarded, and before the lock screen was ever shown. Pressing it left the
 * app looking untouched while it was internally half-locked: the one control
 * whose entire job is "hide this now" did the hiding last and never got
 * there. The field the keyboard targets is window.currentVkTargetId. */
const vkContainer = document.getElementById('virtualKeyboardContainer');
const vkTargetId = window.currentVkTargetId;
if (vkTargetId) document.getElementById(vkTargetId)?.blur();
if (vkContainer) vkContainer.classList.add('hidden');
document.getElementById('mainApp').classList.add('opacity-0');
toggleSidebar(false);
setTimeout(() => {
document.getElementById('mainApp').classList.add('hidden');
document.getElementById('lockScreen').classList.remove('hidden');
document.getElementById('lockScreen').style.opacity = '1';
}, 500);
// Show login section, hide setup
document.getElementById('initialSetup').classList.add('hidden');
document.getElementById('loginSection').classList.remove('hidden');
if (state.twoFA.enabled) {
document.getElementById('login2FASection').classList.remove('hidden');
}
syncLockScreenLayout();
refreshPasskeyUi();
window.dispatchEvent(new CustomEvent('poorija:lock'));
}
// ==================== Cryptography ====================
/* ==================== master password ====================
   The master password used to be stored as a bare SHA-256 of itself: no
   salt, no iterations, one GPU pass per guess. It is now an Argon2id PHC
   record, which carries its own salt and cost parameters and is memory-hard.

   Existing installs must keep working, so verification accepts both and
   quietly rewrites a legacy record into the new form the first time the
   correct password is entered. Nothing else changes: the key that actually
   encrypts stored data is still derived separately from state.masterPassword,
   so no vault data has to be re-encrypted for this upgrade.
   ==================================================================== */
const MASTER_ARGON2 = { preset: 'moderate' };

/* Setup no longer writes a verifier anywhere. It builds the two-slot vault in
   js/vault-profiles.js, whose whole point is that nothing on disk can be
   pointed at and called "the password record". */
/* Three different things used to call this, and giving them all a brand new
   vault was right for exactly one of them.

     - first run: there is no vault, so build one.
     - changing the password from settings: a profile is OPEN and its old
       password was just verified, so re-key that slot and keep everything.
       Building a new vault here orphaned every note, key and message.
     - reset through the security questions: nobody knows the old password, so
       nothing under it can ever be read again. A new vault is the only
       possible answer, and createVault now clears the unreachable namespaces
       it leaves behind.
*/
async function writeMasterPasswordRecord(password) {
  const vault = window.PoorijaVault;

  if (vault.hasVault() && state.activeProfile) {
    const profile = await vault.changePassword(state.activeProfile, password);
    adoptProfile(profile, password);
    return true;
  }

  const profile = await vault.createVault(password);
  adoptProfile(profile, password);
  return true;
}

/* Re-authentication inside the app — changing the master password, revealing a
   stored one — asks whether the password opens the profile that is currently
   open. Two consequences worth being explicit about: the duress password does
   not satisfy a re-auth prompt inside the real profile, and the real password
   does not satisfy one inside the decoy. Each profile is its own world. */
async function verifyMasterPassword(password) {
  if (!state.activeProfile) return false;
  try {
    const opened = await window.PoorijaVault.openVault(password);
    return Boolean(opened && opened.pid === state.activeProfile.pid);
  } catch (error) {
    return false;
  }
}

/* Every way into the app goes through here.

   The password unlock did this correctly. The three quick-unlock paths —
   desktop biometric, passkey largeBlob, passkey PRF — each did
   `state.masterPassword = <recovered password>` and opened the UI, without
   ever opening the vault. state.activeProfile stayed null, so the app looked
   unlocked, isUnlocked() agreed, and then every encrypted write threw
   "Cannot touch local storage data before unlock" into a catch block that
   logged it and moved on.

   What the user saw: a display name and avatar that vanished on restart, and a
   chat lock that announced itself as enabled while being neither stored nor
   applied. Nothing was broken about saving; nothing was ever saved.

   So there is one function now, and the guard in unlockUI() below refuses to
   present an unlocked app without a profile — a fourth path that forgets this
   fails visibly instead of silently losing everything the user does next. */
async function adoptFromPassword(password) {
  const profile = await openVaultForUnlock(password);
  if (!profile) return false;
  adoptProfile(profile, password);
  try {
    await migrateLegacyStorageIntoProfile(profile, password);
  } catch (error) {
    console.warn('[Vault] legacy storage migration failed:', error);
  }
  void healPasskeyRecordAfterUnlock();
  return true;
}

/* One place where a freshly opened profile becomes the app's current world.
   Setting state.activeProfile is what switches the storage redirection over,
   so nothing that reads or writes poorija_* may run before this. */
function adoptProfile(profile, password) {
  state.activeProfile = profile;
  state.masterPassword = password;
  state.storageKeyCache = { password: '', salt: '', keys: null };
}

async function hashPassword(password) {
const encoder = new TextEncoder();
const data = encoder.encode(password);
const hashBuffer = await crypto.subtle.digest('SHA-256', data);
return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// ==================== Hash Checker ====================
async function handleHashFile(event) {
const file = event.target.files[0];
if (!file) return;
document.getElementById('hashForm').classList.remove('hidden');
document.getElementById('hashFileName').textContent = file.name;
document.getElementById('calculatedHash').value = state.language === 'fa' ? 'در حال محاسبه...' : 'Calculating...';
document.getElementById('expectedHash').value = '';
document.getElementById('hashResult').classList.add('hidden');
try {
const buffer = await file.arrayBuffer();
const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
const hashArray = Array.from(new Uint8Array(hashBuffer));
const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
document.getElementById('calculatedHash').value = hashHex;
verifyHash();
} catch (error) {
document.getElementById('calculatedHash').value = state.language === 'fa' ? 'خطا در محاسبه هش' : 'Error calculating hash';
}
}
function verifyHash() {
const calculated = document.getElementById('calculatedHash').value.trim().toLowerCase();
const expected = document.getElementById('expectedHash').value.trim().toLowerCase();
const resultEl = document.getElementById('hashResult');
if (!expected || calculated === 'calculating...' || calculated === 'در حال محاسبه...') {
resultEl.classList.add('hidden');
return;
}
resultEl.classList.remove('hidden');
resultEl.classList.remove('bg-green-100', 'text-green-800', 'bg-red-100', 'text-red-800', 'dark:bg-green-900', 'dark:text-green-200', 'dark:bg-red-900', 'dark:text-red-200');
if (calculated === expected) {
resultEl.textContent = state.language === 'fa' ? 'هش مطابقت دارد (فایل سالم است)' : 'Hash Matches (File Intact)';
resultEl.classList.add('bg-green-100', 'text-green-800', 'dark:bg-green-900', 'dark:text-green-200');
} else {
resultEl.textContent = state.language === 'fa' ? 'هش مطابقت ندارد (فایل دستکاری شده است)' : 'Hash Mismatch (File Altered)';
resultEl.classList.add('bg-red-100', 'text-red-800', 'dark:bg-red-900', 'dark:text-red-200');
}
}
// ==================== File Encryption ====================
async function generateRandomFileKey() {
const algSelect = document.getElementById('encAlgorithm');
const alg = algSelect && algSelect.value ? algSelect.value : (state.settings.algorithm || 'AES-256-GCM');
const keyMaterial = await generateAlgorithmKeyMaterial(alg);
const newKey = {
id: Date.now(),
algorithm: alg,
tag: `${state.language === 'fa' ? 'رمزنگاری' : 'Encryption'}_` + new Date().getTime().toString().slice(-4),
description: 'Auto-generated random file key',
created: new Date().toLocaleDateString(),
publicKeyData: keyMaterial.publicKeyData,
privateKeyData: keyMaterial.privateKeyData,
keyMeta: keyMaterial.keyMeta
};
state.keys.push(normalizeKeyRecord(newKey));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
showNotification(state.language === 'fa' ? 'کلید تصادفی تولید و ذخیره شد' : 'Random key generated and saved', 'success');
renderKeysDropdown();
document.getElementById('encPublicKey').value = newKey.id;
}
function getSymmetricRuntimeInfo(algorithmId) {
const config = CryptoConfig.getAlgorithmConfig(algorithmId);
const symmetricConfig = CryptoConfig.isSymmetricAlgorithm(config.id)
? config
: CryptoConfig.getAlgorithmConfig(config.contentAlgorithm || 'AES-256-GCM');
return {
algorithmId: symmetricConfig.id,
webCryptoAlgorithm: symmetricConfig.mode,
ivLength: symmetricConfig.ivLength,
keyLength: symmetricConfig.keyLengthBits
};
}
/* The one algorithm on offer that WebCrypto cannot perform. It used to be that
   "not WebCrypto" meant CryptoJS and a 1990s cipher; now it means
   XChaCha20-Poly1305 out of js/crypto-core.js, which is authenticated, modern,
   and checked against the RFC vectors on every test run. */
const SOFTWARE_AEAD_ID = 'XCHACHA20-POLY1305';

function isSoftwareAeadAlgorithm(rawAlgorithm) {
  return normalizeAlgorithmId(rawAlgorithm, '') === SOFTWARE_AEAD_ID
      || rawAlgorithm === SOFTWARE_AEAD_ID;
}

function getEncryptionAlgorithmInfo(rawAlgorithm) {
const config = CryptoConfig.getAlgorithmConfig(rawAlgorithm);
if (isSoftwareAeadAlgorithm(rawAlgorithm)) {
return {
type: 'software-aead',
algorithmId: SOFTWARE_AEAD_ID,
ivLength: 24,
keyLength: 256
};
}
if (CryptoConfig.isSymmetricAlgorithm(rawAlgorithm)) {
return {
type: 'symmetric',
...getSymmetricRuntimeInfo(rawAlgorithm)
};
}
const contentRuntime = getSymmetricRuntimeInfo(config.contentAlgorithm);
return {
type: 'hybrid-rsa',
rsaAlgorithm: 'RSA-OAEP',
rsaHash: config.hash || 'SHA-256',
modulusLength: config.keyLengthBits,
...contentRuntime
};
}

/* ---- the software AEAD path -------------------------------------------------

   Key material arrives either as a stored 32-byte secret in base64 or as a
   password the user typed. Passwords go through Argon2id rather than PBKDF2:
   this path is already off the hardware track, so there is no reason to pick
   the weaker KDF, and a memory-hard derivation is the only thing standing
   between a short password and an offline attack on the ciphertext. */

function softwareAeadCore() {
  const core = window.PoorijaCryptoCore;
  if (!core) throw new Error('crypto-core.js is not loaded.');
  return core;
}

async function deriveSoftwareAeadKey(keyMaterial, saltBytes) {
  const core = softwareAeadCore();
  const raw = detectSecretKeyBase64(keyMaterial, SOFTWARE_AEAD_ID);
  if (raw) {
    const bytes = new Uint8Array(base64ToArrayBuffer(keyMaterial.trim()));
    if (bytes.length === 32) return bytes;
  }
  return core.argon2id(keyMaterial, saltBytes, { hashLength: 32 });
}

/* Returns the envelope fields the decrypt side needs, so callers stay short. */
async function softwareAeadEncrypt(keyMaterial, plaintextBytes) {
  const core = softwareAeadCore();
  const salt = core.randomBytes(16);
  const nonce = core.randomBytes(core.NONCE_BYTES);
  const key = await deriveSoftwareAeadKey(keyMaterial, salt);
  const sealed = core.seal(key, nonce, plaintextBytes);
  return {
    alg: SOFTWARE_AEAD_ID,
    kdf: 'argon2id',
    kdfParams: core.ARGON2_DEFAULTS,
    salt: core.toBase64(salt),
    nonce: core.toBase64(nonce),
    data: core.toBase64(sealed)
  };
}

/* Null on any failure — a wrong password, a truncated blob, a flipped bit.
   Callers must treat null as "did not open" and never as "opened to nothing". */
async function softwareAeadDecrypt(keyMaterial, fields) {
  const core = softwareAeadCore();
  try {
    if (!fields || !fields.salt || !fields.nonce || !fields.data) return null;
    const key = await deriveSoftwareAeadKey(keyMaterial, core.fromBase64(fields.salt));
    return core.open(key, core.fromBase64(fields.nonce), core.fromBase64(fields.data));
  } catch (error) {
    return null;
  }
}
async function importSymmetricKeyFromBase64(secretKeyBase64, algorithmId, usages) {
const runtime = getSymmetricRuntimeInfo(algorithmId);
return crypto.subtle.importKey(
'raw',
base64ToArrayBuffer(secretKeyBase64.trim()),
{ name: runtime.webCryptoAlgorithm },
false,
usages
);
}
async function importRsaPublicKey(publicKeyBase64, algorithmId, usages) {
const config = CryptoConfig.getAlgorithmConfig(algorithmId);
return crypto.subtle.importKey(
'spki',
base64ToArrayBuffer(publicKeyBase64.trim()),
{ name: 'RSA-OAEP', hash: config.hash || 'SHA-256' },
false,
usages
);
}
async function importRsaPrivateKey(privateKeyBase64, algorithmId, usages) {
const config = CryptoConfig.getAlgorithmConfig(algorithmId);
return crypto.subtle.importKey(
'pkcs8',
base64ToArrayBuffer(privateKeyBase64.trim()),
{ name: 'RSA-OAEP', hash: config.hash || 'SHA-256' },
false,
usages
);
}
function getSelectedStoredKey(selectId) {
const select = document.getElementById(selectId);
const selectedKeyId = select ? select.value : null;
return state.keys.find((key) => key.id.toString() === selectedKeyId);
}
function getStoredKeyKind(key) {
if (key && key.keyMeta && key.keyMeta.keyKind) {
return key.keyMeta.keyKind;
}
const algorithmId = key && key.algorithm ? normalizeAlgorithmId(key.algorithm, '') : '';
if (key && key.publicKeyData && !key.privateKeyData && (CryptoConfig.isRsaHybridAlgorithm(algorithmId) || algorithmId === 'RSA-OAEP')) {
return 'keypair';
}
if (key && key.publicKeyData && key.privateKeyData && key.publicKeyData !== key.privateKeyData) {
return 'keypair';
}
return 'secret';
}
function getSecretKeyLengthBytes(key) {
return (key && key.keyMeta && key.keyMeta.secretLengthBytes)
|| getBase64ByteLengthOrNull((key && (key.publicKeyData || key.privateKeyData)) || '')
|| 0;
}
function getCompatibleStoredKeys(algorithmId, usage) {
const config = CryptoConfig.getAlgorithmConfig(algorithmId);
const candidateKeys = state.keys.filter((key) => !(key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm)));
if (isSoftwareAeadAlgorithm(algorithmId)) {
return candidateKeys.filter((key) => getStoredKeyKind(key) === 'secret');
}
if (CryptoConfig.isRsaHybridAlgorithm(algorithmId) || algorithmId === 'RSA-OAEP') {
return candidateKeys.filter((key) => {
const keyKind = getStoredKeyKind(key);
return keyKind === 'keypair' && (usage === 'decrypt' ? Boolean(key.privateKeyData) : Boolean(key.publicKeyData));
});
}
const expectedLength = CryptoConfig.getSymmetricKeyLengthBytes(algorithmId);
return candidateKeys.filter((key) => getStoredKeyKind(key) === 'secret' && getSecretKeyLengthBytes(key) === expectedLength);
}
function buildKeyValueForUsage(key, usage) {
if (usage === 'decrypt') {
return key.privateKeyData || key.publicKeyData || key.tag;
}
return key.publicKeyData || key.privateKeyData || key.tag;
}
function getEncryptionKeySelection(keyMethod, algorithmId) {
if (keyMethod === 'password') {
if (CryptoConfig.isRsaHybridAlgorithm(algorithmId)) {
showNotification(state.language === 'fa' ? 'الگوریتم RSA هیبریدی به کلید عمومی نیاز دارد، نه رمز عبور' : 'Hybrid RSA requires a public key, not a password', 'error');
return null;
}
const password = document.getElementById('encPassword').value;
if (!password) {
showNotification(state.language === 'fa' ? 'رمز عبور وارد نشده' : 'No password entered', 'error');
return null;
}
return { kind: 'password', material: password };
}
const selectedKey = getSelectedStoredKey('encPublicKey');
if (!selectedKey) {
showNotification(state.language === 'fa' ? 'کلیدی انتخاب نشده' : 'No key selected', 'error');
return null;
}
const storedKeyKind = getStoredKeyKind(selectedKey);
if (CryptoConfig.isRsaHybridAlgorithm(algorithmId)) {
if (storedKeyKind !== 'keypair' || !selectedKey.publicKeyData) {
showNotification(state.language === 'fa' ? 'برای این الگوریتم باید کلید عمومی RSA انتخاب شود' : 'This algorithm requires an RSA public key', 'error');
return null;
}
return { kind: 'rsa-public', material: selectedKey.publicKeyData, key: selectedKey };
}
if (storedKeyKind !== 'secret') {
showNotification(state.language === 'fa' ? 'برای الگوریتم‌های متقارن باید یک کلید متقارن ذخیره‌شده انتخاب شود' : 'Symmetric algorithms require a stored symmetric key', 'error');
return null;
}
const secretMaterial = selectedKey.publicKeyData || selectedKey.privateKeyData;
if (!secretMaterial) {
showNotification(state.language === 'fa' ? 'کلید متقارن معتبر پیدا نشد' : 'No valid symmetric key found', 'error');
return null;
}
return { kind: 'secret', material: secretMaterial, key: selectedKey };
}
function getDecryptionKeySelection(poorijaData) {
const keyProtection = poorijaData.keyProtection || (poorijaData.method === 'publicKey' ? 'stored-secret' : 'password');
if (keyProtection === 'password') {
const password = document.getElementById('decryptPassword').value;
if (!password) {
showNotification(state.language === 'fa' ? 'رمز عبور وارد نشده' : 'Enter password', 'error');
return null;
}
return { kind: 'password', material: password };
}
const selectedKey = getSelectedStoredKey('decryptPublicKey');
if (!selectedKey) {
showNotification(state.language === 'fa' ? 'کلیدی انتخاب نشده' : 'No key selected', 'error');
return null;
}
if (keyProtection === 'rsa-wrapped') {
if (!selectedKey.privateKeyData) {
showNotification(state.language === 'fa' ? 'کلید خصوصی RSA در دسترس نیست' : 'RSA private key is missing', 'error');
return null;
}
return { kind: 'rsa-private', material: selectedKey.privateKeyData, key: selectedKey };
}
if (getStoredKeyKind(selectedKey) !== 'secret') {
showNotification(state.language === 'fa' ? 'برای رمزگشایی این فایل باید یک کلید متقارن ذخیره‌شده انتخاب شود' : 'This file requires a stored symmetric key', 'error');
return null;
}
const secretMaterial = selectedKey.privateKeyData || selectedKey.publicKeyData;
if (!secretMaterial) {
showNotification(state.language === 'fa' ? 'کلید متقارن معتبر پیدا نشد' : 'No valid symmetric key found', 'error');
return null;
}
return { kind: 'secret', material: secretMaterial, key: selectedKey };
}
async function derivePasswordCryptoKey(password, algorithmId, salt, usages, iterations, hash = 'SHA-256') {
const runtime = getSymmetricRuntimeInfo(algorithmId);
const passwordData = new TextEncoder().encode(password);
const baseKey = await crypto.subtle.importKey('raw', passwordData, 'PBKDF2', false, ['deriveKey']);
return crypto.subtle.deriveKey(
{ name: 'PBKDF2', salt: salt, iterations: iterations, hash: normalizeHashSetting(hash) },
baseKey,
{ name: runtime.webCryptoAlgorithm, length: runtime.keyLength },
false,
usages
);
}
function buildRsaOaepParams(algorithmId, labelText = '') {
const params = { name: 'RSA-OAEP' };
const normalizedLabel = String(labelText || '').trim();
if (normalizedLabel) {
params.label = new TextEncoder().encode(normalizedLabel);
}
return params;
}
function buildSymmetricParams(runtime, iv, options = {}) {
const params = { name: runtime.webCryptoAlgorithm };
if (runtime.webCryptoAlgorithm === 'AES-CTR') {
params.counter = iv;
params.length = normalizeIntegerSetting(options.ctrCounterLength, 64, ALLOWED_CTR_COUNTER_LENGTHS);
} else if (runtime.webCryptoAlgorithm === 'AES-GCM') {
params.iv = iv;
params.tagLength = normalizeIntegerSetting(options.gcmTagLength, 128, ALLOWED_GCM_TAG_LENGTHS);
const additionalData = encodeAadContext(options.aadContext);
if (additionalData) {
params.additionalData = additionalData;
}
} else {
params.iv = iv;
}
return params;
}
async function startEncryption() {
if (!state.currentFile) {
showNotification(state.language === 'fa' ? 'فایل انتخاب نشده' : 'No file selected', 'warning');
return;
}
const keyMethod = document.getElementById('keyMethod').value;
const rawAlgorithm = document.getElementById('encAlgorithm').value;
const algorithmInfo = getEncryptionAlgorithmInfo(rawAlgorithm);
const keySelection = getEncryptionKeySelection(keyMethod, rawAlgorithm);
if (!keySelection) return;
document.getElementById('encryptBtn').disabled = true;
document.getElementById('progressSection').classList.remove('hidden');
try {
const fileData = await readFile(state.currentFile);
const chunkSize = parseChunkSize(state.settings.chunkSize);
const totalChunks = Math.ceil(fileData.byteLength / chunkSize);
const encryptionPreferences = getEncryptTabEncryptionPreferences();
const iterations = encryptionPreferences.pbkdf2Iterations;
const encryptedChunks = [];
const poorijaData = {
version: '3.0',
algorithm: rawAlgorithm,
method: keyMethod,
originalName: state.currentFile.name,
originalType: state.currentFile.type || 'application/octet-stream',
chunks: encryptedChunks,
timestamp: new Date().toISOString()
};
if (algorithmInfo.type === 'software-aead') {
const fields = await softwareAeadEncrypt(keySelection.material, new Uint8Array(fileData));
Object.assign(poorijaData, {
keyProtection: 'software-aead',
kdf: fields.kdf,
kdfParams: fields.kdfParams,
salt: fields.salt,
nonce: fields.nonce
});
encryptedChunks.push(fields.data);
updateProgress(100, `1/1`);
} else {
let workingKey;
if (algorithmInfo.type === 'hybrid-rsa') {
const rsaPublicKey = await importRsaPublicKey(keySelection.material, rawAlgorithm, ['encrypt', 'wrapKey']);
workingKey = await crypto.subtle.generateKey(
{ name: algorithmInfo.webCryptoAlgorithm, length: algorithmInfo.keyLength },
true,
['encrypt', 'decrypt']
);
const wrappedKey = await crypto.subtle.wrapKey('raw', workingKey, rsaPublicKey, buildRsaOaepParams(rawAlgorithm, encryptionPreferences.rsaOaepLabel));
poorijaData.keyProtection = 'rsa-wrapped';
poorijaData.contentAlgorithm = algorithmInfo.algorithmId;
poorijaData.wrappedKey = arrayBufferToBase64(wrappedKey);
poorijaData.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) {
poorijaData.aad = encryptionPreferences.aadContext;
}
if (encryptionPreferences.rsaOaepLabel) {
poorijaData.oaepLabel = encryptionPreferences.rsaOaepLabel;
}
} else if (keySelection.kind === 'secret') {
workingKey = await importSymmetricKeyFromBase64(keySelection.material, rawAlgorithm, ['encrypt']);
poorijaData.keyProtection = 'stored-secret';
} else {
const salt = crypto.getRandomValues(new Uint8Array(encryptionPreferences.saltLength));
poorijaData.keyProtection = 'password';
poorijaData.iterations = iterations;
poorijaData.salt = Array.from(salt);
poorijaData.kdfHash = encryptionPreferences.pbkdf2Hash;
workingKey = await derivePasswordCryptoKey(keySelection.material, rawAlgorithm, salt, ['encrypt'], iterations, encryptionPreferences.pbkdf2Hash);
}
if (algorithmInfo.webCryptoAlgorithm === 'AES-GCM') {
poorijaData.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) {
poorijaData.aad = encryptionPreferences.aadContext;
}
}
if (algorithmInfo.webCryptoAlgorithm === 'AES-CTR') {
poorijaData.ctrCounterLength = encryptionPreferences.ctrCounterLength;
}
for (let i = 0; i < totalChunks; i++) {
const start = i * chunkSize;
const end = Math.min(start + chunkSize, fileData.byteLength);
const chunk = fileData.slice(start, end);
const iv = generateSecureRandomBytes(algorithmInfo.ivLength);
const encrypted = await crypto.subtle.encrypt(
buildSymmetricParams(algorithmInfo, iv, encryptionPreferences),
workingKey,
chunk
);
encryptedChunks.push({
d: arrayBufferToBase64(encrypted),
iv: Array.from(iv)
});
updateProgress(Math.round(((i + 1) / totalChunks) * 100), `${i + 1}/${totalChunks}`);
await new Promise((resolve) => setTimeout(resolve, 0));
}
}
const blob = new Blob([JSON.stringify(poorijaData)], { type: 'application/poorija' });
state.outputData = blob;
state.outputName = generateOutputName(state.currentFile.name);
updateProgress(100, 'Complete');
addHistory(state.currentFile.name, fileData.byteLength, rawAlgorithm, 'encrypt');
showOutputModal();
if (state.settings.deleteOriginal) {
clearFile();
}
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'خطا در رمزنگاری' : 'Encryption error', 'error');
} finally {
document.getElementById('encryptBtn').disabled = false;
}
}
async function performWebCryptoDecryption(poorijaData, keySelection) {
const algorithmId = poorijaData.contentAlgorithm || poorijaData.algorithm;
const runtime = getSymmetricRuntimeInfo(algorithmId);
const encryptionPreferences = getEnvelopeEncryptionPreferences(poorijaData);
let workingKey;
if (keySelection.kind === 'password') {
const salt = new Uint8Array(poorijaData.salt);
const iterations = poorijaData.iterations || encryptionPreferences.pbkdf2Iterations;
workingKey = await derivePasswordCryptoKey(keySelection.material, algorithmId, salt, ['decrypt'], iterations, poorijaData.kdfHash || encryptionPreferences.pbkdf2Hash);
} else if (keySelection.kind === 'secret') {
workingKey = await importSymmetricKeyFromBase64(keySelection.material, algorithmId, ['decrypt']);
} else {
workingKey = await crypto.subtle.unwrapKey(
'raw',
base64ToArrayBuffer(poorijaData.wrappedKey),
await importRsaPrivateKey(keySelection.material, poorijaData.algorithm, ['decrypt', 'unwrapKey']),
buildRsaOaepParams(poorijaData.algorithm, poorijaData.oaepLabel || encryptionPreferences.rsaOaepLabel),
{ name: runtime.webCryptoAlgorithm, length: runtime.keyLength },
false,
['decrypt']
);
}
const chunks = [];
for (let i = 0; i < poorijaData.chunks.length; i++) {
const currentChunk = poorijaData.chunks[i];
const encryptedChunk = typeof currentChunk === 'string'
? new Uint8Array(base64ToArrayBuffer(currentChunk))
: new Uint8Array(base64ToArrayBuffer(currentChunk.d));
const iv = typeof currentChunk === 'string'
? new Uint8Array(poorijaData.iv || [])
: new Uint8Array(currentChunk.iv || []);
const decrypted = await crypto.subtle.decrypt(
buildSymmetricParams(runtime, iv, encryptionPreferences),
workingKey,
encryptedChunk
);
chunks.push(new Uint8Array(decrypted));
if (i % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
}
const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
const result = new Uint8Array(totalLength);
let offset = 0;
for (const chunk of chunks) {
result.set(chunk, offset);
offset += chunk.length;
}
return result;
}
async function startDecryption() {
if (!state.currentFile) return;
try {
const text = await state.currentFile.text();
const poorijaData = normalizeFilePayloadRecord(JSON.parse(text));
if (!poorijaData.chunks) {
throw new Error('Invalid file format');
}
const keySelection = getDecryptionKeySelection(poorijaData);
if (!keySelection) return;
let result;
if (poorijaData.keyProtection === 'software-aead') {
const opened = await softwareAeadDecrypt(keySelection.material, {
salt: poorijaData.salt,
nonce: poorijaData.nonce,
data: poorijaData.chunks[0]
});
if (!opened) throw new Error('XChaCha20-Poly1305 authentication failed');
result = opened.buffer.slice(opened.byteOffset, opened.byteOffset + opened.byteLength);
} else {
result = await performWebCryptoDecryption(poorijaData, keySelection);
}
const blob = new Blob([result], { type: poorijaData.originalType });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = poorijaData.originalName || 'decrypted_file';
a.click();
URL.revokeObjectURL(url);
addHistory(poorijaData.originalName || state.currentFile.name, result.byteLength, poorijaData.algorithm, 'decrypt');
showNotification(state.language === 'fa' ? 'رمزگشایی موفق' : 'Decryption successful', 'success');
if (state.settings.deleteOriginal) {
document.getElementById('decryptForm').classList.add('hidden');
state.currentFile = null;
document.getElementById('decryptInput').value = '';
}
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'خطا در رمزگشایی - رمز اشتباه یا فایل خراب' : 'Decryption failed - wrong password or corrupt file', 'error');
}
}
// ==================== Helper Functions ====================
function addHistory(name, size, action, type) {
const item = {
id: Date.now(),
name: name,
size: size,
action: action, // encrypt or decrypt algorithm string
type: type, // 'encrypt' or 'decrypt'
date: new Date().toISOString()
};
state.history.unshift(item);
localStorage.setItem('poorija_history', JSON.stringify(state.history));
renderHistory(type);
}
function populateHistoryAlgorithmFilter(type, items) {
const select = document.getElementById(`${type}HistoryAlgorithmFilter`);
if (!select) return;
const currentValue = select.value || 'all';
const algorithms = [...new Set(items.map((item) => String(item.action || '').trim()).filter(Boolean))]
.sort((a, b) => a.localeCompare(b));
select.innerHTML = [
`<option value="all">${escapeHTML(getTranslatedText('allAlgorithms'))}</option>`,
...algorithms.map((algorithm) => `<option value="${escapeHTML(algorithm)}">${escapeHTML(algorithm)}</option>`)
].join('');
select.value = algorithms.includes(currentValue) || currentValue === 'all' ? currentValue : 'all';
}
function getHistorySortValue(type) {
return document.getElementById(`${type}HistorySort`)?.value || 'date-desc';
}
function sortHistory(type, criteria) {
const select = document.getElementById(`${type}HistorySort`);
if (select) {
const legacyMap = {
date: 'date-desc',
size: 'size-desc',
name: 'name-asc'
};
select.value = legacyMap[criteria] || criteria || 'date-desc';
}
renderHistory(type);
}
function renderHistory(type) {
const allItems = state.history.filter(h => h.type === type);
populateHistoryAlgorithmFilter(type, allItems);
const query = String(document.getElementById(`${type}HistoryQuery`)?.value || '').trim().toLowerCase();
const algorithmFilter = document.getElementById(`${type}HistoryAlgorithmFilter`)?.value || 'all';
const sortMode = getHistorySortValue(type);
let filtered = allItems.filter((item) => {
const matchesQuery = !query
|| String(item.name || '').toLowerCase().includes(query)
|| String(item.action || '').toLowerCase().includes(query);
const matchesAlgorithm = algorithmFilter === 'all' || String(item.action || '') === algorithmFilter;
return matchesQuery && matchesAlgorithm;
});
if (sortMode === 'date-asc') {
filtered.sort((a, b) => new Date(a.date) - new Date(b.date));
} else if (sortMode === 'date-desc') {
filtered.sort((a, b) => new Date(b.date) - new Date(a.date));
} else if (sortMode === 'size-asc') {
filtered.sort((a, b) => a.size - b.size);
} else if (sortMode === 'size-desc') {
filtered.sort((a, b) => b.size - a.size);
} else if (sortMode === 'name-desc') {
filtered.sort((a, b) => b.name.localeCompare(a.name));
} else {
filtered.sort((a, b) => a.name.localeCompare(b.name));
}
renderHistoryUI(type, filtered);
}
function renderHistoryUI(type, list) {
const containerId = type === 'encrypt' ? 'encryptHistory' : 'decryptHistory';
const container = document.getElementById(containerId);
if (!container) return;
if (list.length === 0) {
container.innerHTML = `<div class="text-center py-4 text-gray-500 text-sm">${state.language === 'fa' ? 'موردی یافت نشد' : 'No items found'}</div>`;
return;
}
container.innerHTML = list.map(h => `
<div class="flex justify-between items-center p-3 bg-gray-50 dark:bg-slate-800 rounded mb-2 border border-gray-100 dark:border-gray-700">
<div class="overflow-hidden">
<p class="text-sm font-medium truncate">${escapeHTML(h.name)}</p>
<p class="text-xs text-gray-500">${new Date(h.date).toLocaleString(state.language === 'fa' ? 'fa-IR' : 'en-US')} | ${formatBytes(h.size)}</p>
</div>
<span class="text-xs px-2 py-1 bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300 rounded whitespace-nowrap">${escapeHTML(h.action)}</span>
</div>
`).join('');
}
function arrayBufferToBase64(buffer) {
let binary = '';
const bytes = new Uint8Array(buffer);
const len = bytes.byteLength;
const chunkSize = 8192;
for (let i = 0; i < len; i += chunkSize) {
binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
}
return btoa(binary);
}
function base64ToArrayBuffer(base64) {
if (typeof Uint8Array.fromBase64 === 'function') {
return Uint8Array.fromBase64(base64).buffer;
}
const binary_string = atob(base64);
const len = binary_string.length;
const bytes = new Uint8Array(len);
for (let i = 0; i < len; i++) {
bytes[i] = binary_string.charCodeAt(i);
}
return bytes.buffer;
}
async function deriveAesGcmKeyFromPassword(password, salt, iterations = 600000, hash = 'SHA-256') {
const baseKey = await crypto.subtle.importKey(
'raw',
new TextEncoder().encode(password),
'PBKDF2',
false,
['deriveKey']
);
return crypto.subtle.deriveKey(
{ name: 'PBKDF2', salt, iterations, hash },
baseKey,
{ name: 'AES-GCM', length: 256 },
false,
['encrypt', 'decrypt']
);
}
async function encryptMigrationBackup(plainText, password) {
const salt = generateSecureRandomBytes(16);
const iv = generateSecureRandomBytes(12);
const iterations = 600000;
const hash = 'SHA-256';
const key = await deriveAesGcmKeyFromPassword(password, salt, iterations, hash);
const cipher = await crypto.subtle.encrypt(
{ name: 'AES-GCM', iv },
key,
new TextEncoder().encode(plainText)
);
return JSON.stringify({
format: 'poorija-backup-v2',
version: 2,
algorithm: 'AES-256-GCM',
kdf: 'PBKDF2',
hash,
iterations,
salt: arrayBufferToBase64(salt),
iv: arrayBufferToBase64(iv),
data: arrayBufferToBase64(cipher)
});
}
async function decryptMigrationBackup(serialized, password) {
const trimmed = String(serialized || '').trim();
try {
const envelope = JSON.parse(trimmed);
if (envelope && envelope.format === 'poorija-backup-v2') {
const salt = new Uint8Array(base64ToArrayBuffer(envelope.salt));
const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
const iterations = normalizeIntegerSetting(envelope.iterations, 600000);
const hash = normalizeHashSetting(envelope.hash, 'SHA-256');
const key = await deriveAesGcmKeyFromPassword(password, salt, iterations, hash);
const plain = await crypto.subtle.decrypt(
{ name: 'AES-GCM', iv },
key,
base64ToArrayBuffer(envelope.data)
);
return new TextDecoder().decode(plain);
}
} catch (error) {
if (trimmed.startsWith('{')) throw error;
}
/* Anything that is not a v2 envelope is not something this build wrote.
   The old code fell through to CryptoJS.AES here, which meant an unreadable
   input produced an empty string rather than an error — and an empty string
   flowed on as if decryption had succeeded. */
throw new Error('Unrecognised encrypted payload.');
}
function parseChunkSize(size) {
const sizes = { '512KB': 512 * 1024, '1MB': 1024 * 1024, '5MB': 5 * 1024 * 1024, '10MB': 10 * 1024 * 1024 };
return sizes[size] || 1024 * 1024;
}
function generateOutputName(originalName) {
const pattern = state.settings.namingPattern;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const random = generateSecureRandomString(6, 'abcdefghijklmnopqrstuvwxyz0123456789');
switch(pattern) {
case 'timestamp': return `encrypted_${timestamp}.poorija`;
case 'random': return `${random}.poorija`;
case 'custom':
const prefix = document.getElementById('customPrefix').value || 'secured';
return `${prefix}_${originalName}.poorija`;
default: return `${originalName}.poorija`;
}
}
function readFile(file) {
return new Promise((resolve, reject) => {
const reader = new FileReader();
reader.onload = (e) => resolve(e.target.result);
reader.onerror = reject;
reader.readAsArrayBuffer(file);
});
}
function updateProgress(percent, status) {
document.getElementById('progressBar').style.width = percent + '%';
document.getElementById('progressPercent').textContent = percent + '%';
document.getElementById('progressStatus').textContent = status;
}
// ==================== Text Encryption ====================
async function generateTextKey() {
const algSelect = document.getElementById('textAlgorithm');
const alg = algSelect && algSelect.value ? algSelect.value : (state.settings.algorithm || 'AES-256-GCM');
const keyMaterial = await generateAlgorithmKeyMaterial(alg);
document.getElementById('textKey').value = keyMaterial.publicKeyData;
// Save to keys library automatically
const newKey = {
id: Date.now(),
algorithm: alg,
tag: `${state.language === 'fa' ? 'رمزنگاری نوشتاری' : 'Text Encryption'}_` + new Date().getTime().toString().slice(-4),
description: 'Auto-generated key for text encryption',
created: new Date().toLocaleDateString(),
publicKeyData: keyMaterial.publicKeyData,
privateKeyData: keyMaterial.privateKeyData,
keyMeta: keyMaterial.keyMeta
};
state.keys.push(normalizeKeyRecord(newKey));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
showNotification(state.language === 'fa' ? 'کلید تصادفی تولید و در کتابخانه ذخیره شد' : 'Random key generated and saved to library', 'success');
renderKeysDropdown();
renderKeysList();
processTextEncryption();
}
// ⚡ Bolt Performance Optimization
// Added 300ms debounce to prevent expensive synchronous cryptographic
// operations from blocking the main UI thread on every keystroke.
// Impact: Reduces CPU spikes and UI freezing during rapid typing.
let textEncryptionTimeout = null;
function processTextEncryption() {
if (textEncryptionTimeout) clearTimeout(textEncryptionTimeout);
textEncryptionTimeout = setTimeout(async () => {
const text = document.getElementById('plainTextInput').value;
const key = document.getElementById('textKey').value;
const alg = document.getElementById('textAlgorithm').value;
const output = document.getElementById('encryptedTextOutput');
if (!text || !key) {
output.value = '';
return;
}
try {
const algorithmInfo = getEncryptionAlgorithmInfo(alg);
const encryptionPreferences = getSettingsEncryptionPreferences();
let result = '';
if (algorithmInfo.type === 'software-aead') {
const core = softwareAeadCore();
const fields = await softwareAeadEncrypt(key, core.utf8(text));
output.value = btoa(JSON.stringify(Object.assign({ v: 2 }, fields)));
} else {
let encryptedBuffer;
const encoder = new TextEncoder();
const envelope = { v: 2, alg: alg };
if (algorithmInfo.type === 'hybrid-rsa') {
try {
const importedKey = await importRsaPublicKey(key, alg, ['encrypt', 'wrapKey']);
const contentKey = await crypto.subtle.generateKey(
{ name: 'AES-GCM', length: 256 },
true,
['encrypt', 'decrypt']
);
const iv = generateSecureRandomBytes(12);
encryptedBuffer = await crypto.subtle.encrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), iv, encryptionPreferences),
contentKey,
encoder.encode(text)
);
const wrappedKey = await crypto.subtle.wrapKey('raw', contentKey, importedKey, buildRsaOaepParams(alg, encryptionPreferences.rsaOaepLabel));
envelope.keyProtection = 'rsa-wrapped';
envelope.contentAlgorithm = 'AES-256-GCM';
envelope.i = Array.from(iv);
envelope.wk = arrayBufferToBase64(wrappedKey);
envelope.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) envelope.aad = encryptionPreferences.aadContext;
if (encryptionPreferences.rsaOaepLabel) envelope.oaepLabel = encryptionPreferences.rsaOaepLabel;
} catch (e) {
output.value = 'Invalid RSA Public Key. Must be SPKI base64.';
return;
}
} else {
const iv = generateSecureRandomBytes(algorithmInfo.ivLength);
const rawSecretKey = detectSecretKeyBase64(key, alg);
let workingKey;
if (rawSecretKey) {
workingKey = await importSymmetricKeyFromBase64(key, alg, ['encrypt']);
envelope.keyProtection = 'raw-secret';
} else {
const salt = generateSecureRandomBytes(encryptionPreferences.saltLength);
workingKey = await derivePasswordCryptoKey(key, alg, salt, ['encrypt'], encryptionPreferences.pbkdf2Iterations, encryptionPreferences.pbkdf2Hash);
envelope.keyProtection = 'password';
envelope.s = Array.from(salt);
envelope.it = encryptionPreferences.pbkdf2Iterations;
envelope.kdfHash = encryptionPreferences.pbkdf2Hash;
}
encryptedBuffer = await crypto.subtle.encrypt(
buildSymmetricParams(algorithmInfo, iv, encryptionPreferences),
workingKey,
encoder.encode(text)
);
envelope.i = Array.from(iv);
if (algorithmInfo.webCryptoAlgorithm === 'AES-GCM') {
envelope.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) envelope.aad = encryptionPreferences.aadContext;
}
if (algorithmInfo.webCryptoAlgorithm === 'AES-CTR') {
envelope.ctrCounterLength = encryptionPreferences.ctrCounterLength;
}
}
envelope.d = arrayBufferToBase64(encryptedBuffer);
output.value = btoa(JSON.stringify(envelope));
}
} catch (e) {
output.value = state.language === 'fa' ? 'خطا در رمزنگاری' : 'Encryption error';
}
}, 300);
}
function copyEncryptedText() {
const output = document.getElementById('encryptedTextOutput');
if (output.value) {
navigator.clipboard.writeText(output.value);
showNotification(state.language === 'fa' ? 'متن کپی شد' : 'Text copied', 'success');
}
}
let textDecryptionTimeout = null;
function processTextDecryption() {
if (textDecryptionTimeout) clearTimeout(textDecryptionTimeout);
textDecryptionTimeout = setTimeout(async () => {
const text = document.getElementById('encryptedTextInput').value;
const key = document.getElementById('textDecKey').value;
const alg = document.getElementById('textDecAlgorithm').value;
const output = document.getElementById('decryptedTextOutput');
if (!text || !key) {
output.value = '';
return;
}
try {
const algorithmInfo = getEncryptionAlgorithmInfo(alg);
let result = '';
if (algorithmInfo.type === 'software-aead') {
const core = softwareAeadCore();
let fields = null;
try { fields = JSON.parse(atob(text)); } catch (parseError) { fields = null; }
const opened = await softwareAeadDecrypt(key, fields);
/* A failed open must not look like an empty message. */
if (!opened) throw new Error('XChaCha20-Poly1305 authentication failed');
result = core.fromUtf8(opened);
} else {
try {
const envelopeStr = atob(text);
const envelope = normalizeTextEnvelopeRecord(JSON.parse(envelopeStr));
const envelopePreferences = getEnvelopeEncryptionPreferences(envelope);
if (envelope.v === 2 && envelope.d) {
const effectiveAlgorithm = envelope.alg || alg;
const effectiveInfo = getEncryptionAlgorithmInfo(effectiveAlgorithm);
const encryptedBuffer = base64ToArrayBuffer(envelope.d);
let decryptedBuffer;
if (effectiveInfo.type === 'hybrid-rsa') {
try {
const importedKey = await importRsaPrivateKey(key, effectiveAlgorithm, ['decrypt', 'unwrapKey']);
const sessionKey = await crypto.subtle.unwrapKey(
'raw',
base64ToArrayBuffer(envelope.wk),
importedKey,
buildRsaOaepParams(effectiveAlgorithm, envelope.oaepLabel || envelopePreferences.rsaOaepLabel),
{ name: 'AES-GCM', length: 256 },
false,
['decrypt']
);
decryptedBuffer = await crypto.subtle.decrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), new Uint8Array(envelope.i), envelopePreferences),
sessionKey,
encryptedBuffer
);
} catch (e) {
output.value = 'Invalid RSA Private Key. Must be PKCS8 base64.';
return;
}
} else {
const iv = new Uint8Array(envelope.i);
let workingKey;
if (envelope.keyProtection === 'raw-secret') {
workingKey = await importSymmetricKeyFromBase64(key, effectiveAlgorithm, ['decrypt']);
} else {
const salt = new Uint8Array(envelope.s);
workingKey = await derivePasswordCryptoKey(key, effectiveAlgorithm, salt, ['decrypt'], envelope.it || envelopePreferences.pbkdf2Iterations, envelope.kdfHash || envelopePreferences.pbkdf2Hash);
}
decryptedBuffer = await crypto.subtle.decrypt(
buildSymmetricParams(effectiveInfo, iv, envelopePreferences),
workingKey,
encryptedBuffer
);
}
result = new TextDecoder().decode(decryptedBuffer);
} else if (envelope.v === 1 && envelope.d) {
const encryptedBuffer = base64ToArrayBuffer(envelope.d);
let decryptedBuffer;
if ((envelope.alg || alg) === 'RSA-OAEP') {
const importedKey = await importRsaPrivateKey(key, 'RSA-OAEP', ['decrypt']);
decryptedBuffer = await crypto.subtle.decrypt(
{ name: 'RSA-OAEP' },
importedKey,
encryptedBuffer
);
} else {
const salt = new Uint8Array(envelope.s || []);
const iv = new Uint8Array(envelope.i || []);
const workingKey = await derivePasswordCryptoKey(key, alg, salt, ['decrypt'], envelope.it || envelopePreferences.pbkdf2Iterations, envelope.kdfHash || envelopePreferences.pbkdf2Hash);
decryptedBuffer = await crypto.subtle.decrypt(
buildSymmetricParams(algorithmInfo, iv, envelopePreferences),
workingKey,
encryptedBuffer
);
}
result = new TextDecoder().decode(decryptedBuffer);
} else {
throw new Error('Invalid webcrypto envelope format');
}
} catch (e) {
result = '';
}
}
if (!result) {
output.value = state.language === 'fa' ? 'خطا در رمزگشایی - کلید یا الگوریتم اشتباه است' : 'Decryption error - Wrong key or algorithm';
} else {
output.value = result;
}
} catch (e) {
output.value = state.language === 'fa' ? 'خطا در رمزگشایی' : 'Decryption error';
}
}, 300);
}
function copyDecryptedText() {
const output = document.getElementById('decryptedTextOutput');
if (output.value && !output.value.includes('error') && !output.value.includes('خطا')) {
navigator.clipboard.writeText(output.value);
showNotification(state.language === 'fa' ? 'متن کپی شد' : 'Text copied', 'success');
}
}
// ==================== Self-Destruct Messages ====================
async function generateSelfDestructMessage() {
const days = parseInt(document.getElementById('sdTimeLimitDays').value) || 0;
const hours = parseInt(document.getElementById('sdTimeLimitHours').value) || 0;
const minutes = parseInt(document.getElementById('sdTimeLimitMinutes').value) || 0;
const seconds = parseInt(document.getElementById('sdTimeLimitSeconds').value) || 0;
const viewLimit = parseInt(document.getElementById('sdViewLimit').value) || 0;
const key = document.getElementById('sdKey').value;
const text = document.getElementById('sdTextInput').value;
const bindToDevice = document.getElementById('sdBindToDevice')?.checked ?? (state.settings.selfDestructBindToDevice !== false);
const useServerSync = Boolean(document.getElementById('sdUseServerSync')?.checked);
const serverOrigin = useServerSync ? resolveSelfDestructServerOrigin(document.getElementById('sdServerUrl')?.value || '') : '';
if (!text || !key) {
showNotification(state.language === 'fa' ? 'لطفا متن و کلید را وارد کنید' : 'Please enter text and key', 'warning');
return;
}
if (useServerSync && !serverOrigin) {
showNotification(state.language === 'fa' ? 'برای همگام‌سازی پیام خودتخریب، اطلاعات سرور را وارد کنید.' : 'Enter the server information to sync this self-destruct message.', 'warning');
return;
}
const payloadId = generateSecureRandomString(16, 'abcdefghijklmnopqrstuvwxyz0123456789');
// Store timeLimit as duration so we can calculate per-session expiration
const totalSeconds = (days * 24 * 60 * 60) + (hours * 60 * 60) + (minutes * 60) + seconds;
const timeLimitMs = totalSeconds > 0 ? (totalSeconds * 1000) : 0;
const payload = {
id: payloadId,
content: text,
timeLimitMs: timeLimitMs,
maxViews: viewLimit,
createdAt: Date.now()
};
if (bindToDevice) {
payload.installationBindingHash = await getInstallationBindingHash();
}
try {
let serverRecord = null;
if (useServerSync) {
serverRecord = await createSelfDestructServerRecord({
serverOrigin,
payloadId,
timeLimitMs,
maxViews: viewLimit,
createdAt: payload.createdAt
});
payload.serverSync = {
enabled: true,
recordId: serverRecord.id,
serverOrigin,
createdAt: serverRecord.createdAt || new Date().toISOString()
};
}
const alg = document.getElementById('sdAlgorithm') ? document.getElementById('sdAlgorithm').value : 'AES';
const textStr = JSON.stringify(payload);
let encryptedPayload = '';
let envelope = { version: APP_VERSION, type: 'self-destruct', alg: alg };
if (serverRecord) {
envelope.serverSync = {
enabled: true,
recordId: serverRecord.id,
serverOrigin,
api: 'poorija-self-destruct-v1'
};
}
const algorithmInfo = getEncryptionAlgorithmInfo(alg);
const encryptionPreferences = getSettingsEncryptionPreferences();
if (algorithmInfo.type === 'software-aead') {
const core = softwareAeadCore();
Object.assign(envelope, await softwareAeadEncrypt(key, core.utf8(textStr)));
envelope.keyProtection = 'software-aead';
} else {
let encryptedBuffer;
const encoder = new TextEncoder();
if (algorithmInfo.type === 'hybrid-rsa') {
const importedKey = await importRsaPublicKey(key, alg, ['encrypt', 'wrapKey']);
const contentKey = await crypto.subtle.generateKey(
{ name: 'AES-GCM', length: 256 },
true,
['encrypt', 'decrypt']
);
const iv = generateSecureRandomBytes(12);
encryptedBuffer = await crypto.subtle.encrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), iv, encryptionPreferences),
contentKey,
encoder.encode(textStr)
);
const wrappedKey = await crypto.subtle.wrapKey('raw', contentKey, importedKey, buildRsaOaepParams(alg, encryptionPreferences.rsaOaepLabel));
envelope.keyProtection = 'rsa-wrapped';
envelope.contentAlgorithm = 'AES-256-GCM';
envelope.iv = Array.from(iv);
envelope.wrappedKey = arrayBufferToBase64(wrappedKey);
envelope.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) envelope.aad = encryptionPreferences.aadContext;
if (encryptionPreferences.rsaOaepLabel) envelope.oaepLabel = encryptionPreferences.rsaOaepLabel;
} else {
const iv = generateSecureRandomBytes(algorithmInfo.ivLength);
const rawSecretKey = detectSecretKeyBase64(key, alg);
let workingKey;
if (rawSecretKey) {
workingKey = await importSymmetricKeyFromBase64(key, alg, ['encrypt']);
envelope.keyProtection = 'raw-secret';
} else {
const salt = generateSecureRandomBytes(encryptionPreferences.saltLength);
workingKey = await derivePasswordCryptoKey(key, alg, salt, ['encrypt'], encryptionPreferences.pbkdf2Iterations, encryptionPreferences.pbkdf2Hash);
envelope.keyProtection = 'password';
envelope.salt = Array.from(salt);
envelope.iterations = encryptionPreferences.pbkdf2Iterations;
envelope.kdfHash = encryptionPreferences.pbkdf2Hash;
}
encryptedBuffer = await crypto.subtle.encrypt(
buildSymmetricParams(algorithmInfo, iv, encryptionPreferences),
workingKey,
encoder.encode(textStr)
);
envelope.iv = Array.from(iv);
if (algorithmInfo.webCryptoAlgorithm === 'AES-GCM') {
envelope.tagLength = encryptionPreferences.gcmTagLength;
if (encryptionPreferences.aadContext) envelope.aad = encryptionPreferences.aadContext;
}
if (algorithmInfo.webCryptoAlgorithm === 'AES-CTR') {
envelope.ctrCounterLength = encryptionPreferences.ctrCounterLength;
}
}
envelope.data = arrayBufferToBase64(encryptedBuffer);
envelope.isCryptoJs = false;
}
document.getElementById('sdOutputText').value = btoa(JSON.stringify(envelope));
showNotification(state.language === 'fa' ? 'پیغام با موفقیت ایجاد شد' : 'Message created successfully', 'success');
} catch (e) {
showNotification(state.language === 'fa' ? 'خطا در ایجاد پیغام' : 'Error creating message', 'error');
}
}
function copySelfDestructOutput() {
const output = document.getElementById('sdOutputText');
if (output.value) {
navigator.clipboard.writeText(output.value);
showNotification(state.language === 'fa' ? 'متن کپی شد' : 'Text copied', 'success');
}
}
let sdTimerInterval = null;
async function readSelfDestructMessage() {
const inputStr = document.getElementById('sdInputToRead').value.trim();
const key = document.getElementById('sdReadKey').value;
const resultContainer = document.getElementById('sdReadResultContainer');
const resultContent = document.getElementById('sdReadResultContent');
const viewsRemaining = document.getElementById('sdViewsRemaining');
const countdownTimer = document.getElementById('sdCountdownTimer');
if (sdTimerInterval) clearInterval(sdTimerInterval);
const viewAgainBtn = document.getElementById('sdViewAgainBtn');
if (viewsRemaining) viewsRemaining.textContent = '';
if (viewsRemaining) viewsRemaining.className = 'text-gray-500 text-xs';
if (countdownTimer) countdownTimer.textContent = '';
if (countdownTimer) countdownTimer.className = 'hidden font-mono font-bold text-lg px-4 py-1 rounded border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400';
if (viewAgainBtn) viewAgainBtn.classList.add('hidden');
if (!inputStr || !key) {
showNotification(state.language === 'fa' ? 'لطفا رشته و کلید را وارد کنید' : 'Please enter payload and key', 'warning');
return;
}
try {
const envelopeStr = atob(inputStr);
const envelope = normalizeSelfDestructEnvelopeRecord(JSON.parse(envelopeStr));
if (envelope.type !== 'self-destruct') {
throw new Error("Invalid payload type");
}
setSelfDestructReadServerFromEnvelope(envelope);
const alg = envelope.alg || 'AES';
let decryptedStr = '';
if (envelope.keyProtection === 'software-aead' || isSoftwareAeadAlgorithm(alg)) {
const core = softwareAeadCore();
const opened = await softwareAeadDecrypt(key, envelope);
if (!opened) throw new Error('XChaCha20-Poly1305 authentication failed');
decryptedStr = core.fromUtf8(opened);
} else {
const effectiveAlgorithm = envelope.contentAlgorithm || alg;
const algorithmInfo = getEncryptionAlgorithmInfo(effectiveAlgorithm);
const envelopePreferences = getEnvelopeEncryptionPreferences(envelope);
const encryptedBuffer = base64ToArrayBuffer(envelope.data);
let decryptedBuffer;
if (envelope.keyProtection === 'rsa-wrapped') {
const importedKey = await importRsaPrivateKey(key, alg, ['decrypt', 'unwrapKey']);
const sessionKey = await crypto.subtle.unwrapKey(
'raw',
base64ToArrayBuffer(envelope.wrappedKey),
importedKey,
buildRsaOaepParams(alg, envelope.oaepLabel || envelopePreferences.rsaOaepLabel),
{ name: 'AES-GCM', length: 256 },
false,
['decrypt']
);
decryptedBuffer = await crypto.subtle.decrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), new Uint8Array(envelope.iv), envelopePreferences),
sessionKey,
encryptedBuffer
);
} else if (alg === 'RSA-OAEP' && !envelope.keyProtection) {
const importedKey = await importRsaPrivateKey(key, 'RSA-OAEP', ['decrypt']);
decryptedBuffer = await crypto.subtle.decrypt(
{ name: 'RSA-OAEP' },
importedKey,
encryptedBuffer
);
} else {
const iv = new Uint8Array(envelope.iv);
let workingKey;
if (envelope.keyProtection === 'raw-secret') {
workingKey = await importSymmetricKeyFromBase64(key, effectiveAlgorithm, ['decrypt']);
} else {
const salt = new Uint8Array(envelope.salt);
workingKey = await derivePasswordCryptoKey(key, effectiveAlgorithm, salt, ['decrypt'], envelope.iterations || envelopePreferences.pbkdf2Iterations, envelope.kdfHash || envelopePreferences.pbkdf2Hash);
}
decryptedBuffer = await crypto.subtle.decrypt(
buildSymmetricParams(algorithmInfo, iv, envelopePreferences),
workingKey,
encryptedBuffer
);
}
decryptedStr = new TextDecoder().decode(decryptedBuffer);
}
if (!decryptedStr) {
showNotification(state.language === 'fa' ? 'کلید اشتباه است' : 'Wrong key', 'error');
return;
}
const payload = JSON.parse(decryptedStr);
if (payload.installationBindingHash) {
const currentInstallationBindingHash = await getInstallationBindingHash();
if (currentInstallationBindingHash !== payload.installationBindingHash) {
throw new Error('SELF_DESTRUCT_INSTALLATION_MISMATCH');
}
}
const serverSync = envelope.serverSync?.enabled ? envelope.serverSync : (payload.serverSync?.enabled ? payload.serverSync : null);
let serverOpenState = null;
if (serverSync) {
const serverOrigin = resolveSelfDestructServerOrigin(document.getElementById('sdReadServerUrl')?.value || serverSync.serverOrigin || '');
if (!serverOrigin) {
showNotification(state.language === 'fa' ? 'این پیام به سرور کنترل نیاز دارد؛ آدرس سرور را وارد کنید.' : 'This message requires a control server; enter the server URL.', 'error');
return;
}
document.getElementById('sdReadServerUrl').value = serverOrigin;
serverOpenState = await openSelfDestructServerRecord({
serverOrigin,
recordId: serverSync.recordId,
payloadId: payload.id
});
}
const currentViewsKey = `sd_views_${payload.id}`;
let currentViews = parseInt(localStorage.getItem(currentViewsKey) || '0');
// Map old payload.expiresAt to timeLimitMs if legacy
let messageTimeLimitMs = payload.timeLimitMs || 0;
if (!payload.timeLimitMs && payload.expiresAt > 0) {
messageTimeLimitMs = payload.expiresAt - payload.createdAt;
}
// Calculate when it should expire in this viewing session
let sessionExpiresAt = messageTimeLimitMs > 0 ? Date.now() + messageTimeLimitMs : 0;
if (serverOpenState) {
currentViews = Number(serverOpenState.opens || 0);
messageTimeLimitMs = Number(serverOpenState.timeLimitMs || messageTimeLimitMs || 0);
sessionExpiresAt = serverOpenState.expiresAt ? Date.parse(serverOpenState.expiresAt) : 0;
}
// Check View Limit
if (!serverOpenState && payload.maxViews > 0) {
if (currentViews >= payload.maxViews) {
resultContainer.classList.remove('hidden');
resultContainer.classList.add('border-rose-500', 'bg-rose-50', 'dark:bg-rose-900/20');
resultContent.classList.add('text-rose-700', 'dark:text-rose-400');
resultContent.textContent = state.language === 'fa' ? 'این پیغام به حداکثر تعداد دفعات مشاهده رسیده و از بین رفته است.' : 'This message has reached its view limit and is destroyed.';
return;
}
currentViews++;
localStorage.setItem(currentViewsKey, currentViews.toString());
}
// Display Content
resultContainer.classList.remove('hidden', 'border-rose-500', 'bg-rose-50', 'dark:bg-rose-900/20');
resultContainer.classList.add('border-emerald-500', 'bg-emerald-50', 'dark:bg-emerald-900/20');
resultContent.classList.remove('text-rose-700', 'dark:text-rose-400');
resultContent.textContent = payload.content;
const effectiveMaxViews = serverOpenState ? Number(serverOpenState.maxViews || 0) : payload.maxViews;
if (effectiveMaxViews > 0) {
const remainingViews = serverOpenState ? Number(serverOpenState.remainingViews || 0) : (effectiveMaxViews - currentViews);
if (viewsRemaining) {
viewsRemaining.textContent = state.language === 'fa' ? `${remainingViews} مشاهده باقیمانده` : `${remainingViews} views left`;
if (remainingViews <= 3) {
viewsRemaining.className = 'text-rose-600 text-xs font-bold';
}
}
}
if (sessionExpiresAt > 0) {
if (countdownTimer) countdownTimer.classList.remove('hidden');
const updateTimer = () => {
const now = Date.now();
const remainingMs = sessionExpiresAt - now;
if (remainingMs <= 0) {
clearInterval(sdTimerInterval);
resultContainer.classList.add('border-rose-500', 'bg-rose-50', 'dark:bg-rose-900/20');
resultContainer.classList.remove('border-emerald-500', 'bg-emerald-50', 'dark:bg-emerald-900/20');
resultContent.classList.add('text-rose-700', 'dark:text-rose-400');
resultContent.textContent = state.language === 'fa' ? 'این پیغام منقضی شده و از بین رفته است.' : 'This message has expired and is destroyed.';
if (countdownTimer) {
countdownTimer.textContent = '00:00:00';
countdownTimer.className = 'font-mono font-bold text-lg px-4 py-1 rounded border-2 border-rose-500 text-rose-600 dark:text-rose-400';
}
// localStorage.removeItem(currentViewsKey); // Keep view counts for "View again"
// If view limit exists and views are remaining, allow to view again
if (!serverOpenState && payload.maxViews > 0) {
const latestViews = parseInt(localStorage.getItem(currentViewsKey) || currentViews.toString());
if (latestViews < payload.maxViews && viewAgainBtn) {
const viewsLeft = payload.maxViews - latestViews;
viewAgainBtn.textContent = state.language === 'fa' ? `مشاهده مجدد پیغام (${viewsLeft})` : `View again (${viewsLeft})`;
viewAgainBtn.classList.remove('hidden');
}
}
return;
}
const totalSeconds = Math.floor(remainingMs / 1000);
const days = Math.floor(totalSeconds / (3600 * 24));
const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
const minutes = Math.floor((totalSeconds % 3600) / 60);
const seconds = totalSeconds % 60;
let formattedTime = '';
if (days > 0) {
formattedTime += days + (state.language === 'fa' ? ' روز و ' : 'd ');
}
formattedTime +=
String(hours).padStart(2, '0') + ':' +
String(minutes).padStart(2, '0') + ':' +
String(seconds).padStart(2, '0');
if (countdownTimer) {
countdownTimer.textContent = formattedTime;
if (totalSeconds <= 10) {
countdownTimer.className = 'font-mono font-bold text-lg px-4 py-1 rounded border-2 border-rose-500 text-rose-600 dark:text-rose-400 animate-fast-pulse';
} else if (totalSeconds <= 30) {
countdownTimer.className = 'font-mono font-bold text-lg px-4 py-1 rounded border-2 border-rose-500 text-rose-600 dark:text-rose-400 animate-pulse';
} else {
countdownTimer.className = 'font-mono font-bold text-lg px-4 py-1 rounded border-2 border-emerald-500 text-emerald-600 dark:text-emerald-400';
}
}
};
updateTimer(); // initial call
sdTimerInterval = setInterval(updateTimer, 1000);
}
} catch (e) {
if (e && e.message === 'SELF_DESTRUCT_INSTALLATION_MISMATCH') {
showNotification(
state.language === 'fa'
? 'این پیغام به نصب فعلی قفل شده است و روی یک نصب دیگر باز نمی‌شود'
: 'This message is locked to a trusted installation and cannot be opened on this copy',
'error'
);
return;
}
if (e && (String(e.message || '').startsWith('self-destruct-') || e.serverBody?.reason)) {
const reason = e.serverBody?.reason || e.message;
const faMessage = reason === 'view-limit-reached'
? 'این پیغام روی سرور به حداکثر تعداد مشاهده رسیده است.'
: reason === 'expired'
? 'این پیغام طبق وضعیت سرور منقضی شده است.'
: reason === 'not-found'
? 'رکورد پیام روی سرور پیدا نشد.'
: 'اتصال یا تایید سرور کنترل پیام ناموفق بود.';
const enMessage = reason === 'view-limit-reached'
? 'The server-side view limit has been reached.'
: reason === 'expired'
? 'This message has expired according to the server.'
: reason === 'not-found'
? 'The message record was not found on the server.'
: 'Message control server verification failed.';
showNotification(state.language === 'fa' ? faMessage : enMessage, 'error');
return;
}
showNotification(state.language === 'fa' ? 'فرمت پیغام نامعتبر است یا کلید اشتباه است' : 'Invalid payload format or wrong key', 'error');
}
}
// ==================== Password Generation ====================
function generateStrongPassword() {
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
const password = generateSecureRandomString(16, chars);
const encPassword = document.getElementById('encPassword');
encPassword.value = password;
// keep it hidden by default, unless user toggles the eye manually.
checkPasswordStrength(password, 'enc');
state.generatedPasswords.push({
password: password,
created: new Date().toISOString(),
id: Date.now()
});
savePasswords();
showNotification(state.language === 'fa' ? 'رمز عبور تولید و ذخیره شد' : 'Password generated and saved', 'success');
}
// Advanced Password Generator
let isSelectingForEncryption = false;
function openAdvancedPasswordGenerator(forEncryption = false) {
isSelectingForEncryption = forEncryption;
document.getElementById('advPasswordModal').classList.remove('hidden');
document.getElementById('advPasswordModal').classList.add('flex');
generateAdvancedPasswordLive();
}
function closeAdvancedPasswordGenerator() {
document.getElementById('advPasswordModal').classList.add('hidden');
document.getElementById('advPasswordModal').classList.remove('flex');
isSelectingForEncryption = false;
}
function generateAdvancedPasswordLive() {
const length = parseInt(document.getElementById('advLength').value);
const useUpper = document.getElementById('advUpper').checked;
const useLower = document.getElementById('advLower').checked;
const useNum = document.getElementById('advNumbers').checked;
const useSym = document.getElementById('advSymbols').checked;
const startWith = document.getElementById('advStartWith').value;
const middleWith = document.getElementById('advMiddleWith').value;
const endWith = document.getElementById('advEndWith').value;
if (!useUpper && !useLower && !useNum && !useSym) {
document.getElementById('advResult').value = state.language === 'fa' ? 'حداقل یک نوع کاراکتر انتخاب کنید' : 'Select at least one character type';
return;
}
const upperChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const lowerChars = 'abcdefghijklmnopqrstuvwxyz';
const numChars = '0123456789';
const symChars = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
let pool = '';
if (useUpper) pool += upperChars;
if (useLower) pool += lowerChars;
if (useNum) pool += numChars;
if (useSym) pool += symChars;
let password = '';
// Build the password
for (let i = 0; i < length; i++) {
password += generateSecureRandomString(1, pool);
}
// Apply placement rules
let finalPassword = password.split('');
// Start rule
if (startWith !== 'any') {
let startPool = '';
if (startWith === 'letter') startPool = (useUpper ? upperChars : '') + (useLower ? lowerChars : '');
else if (startWith === 'number') startPool = numChars;
else if (startWith === 'symbol') startPool = symChars;
if(!startPool) startPool = pool; // Fallback if selected type is unchecked
finalPassword[0] = generateSecureRandomString(1, startPool);
}
// Middle rule
if (middleWith !== 'any' && length >= 3) {
let midPool = '';
if (middleWith === 'letter') midPool = (useUpper ? upperChars : '') + (useLower ? lowerChars : '');
else if (middleWith === 'number') midPool = numChars;
else if (middleWith === 'symbol') midPool = symChars;
if(!midPool) midPool = pool; // Fallback
const midIndex = Math.floor(length / 2);
finalPassword[midIndex] = generateSecureRandomString(1, midPool);
}
// End rule
if (endWith !== 'any') {
let endPool = '';
if (endWith === 'letter') endPool = (useUpper ? upperChars : '') + (useLower ? lowerChars : '');
else if (endWith === 'number') endPool = numChars;
else if (endWith === 'symbol') endPool = symChars;
if(!endPool) endPool = pool; // Fallback if selected type is unchecked
finalPassword[length - 1] = generateSecureRandomString(1, endPool);
}
document.getElementById('advResult').value = finalPassword.join('');
}
function saveAdvancedPassword() {
const password = document.getElementById('advResult').value;
if (!password || password.includes('حداقل') || password.includes('Select')) return;
state.generatedPasswords.push({
password: password,
created: new Date().toISOString(),
id: Date.now()
});
savePasswords();
renderPasswords();
if (isSelectingForEncryption) {
const encPasswordInput = document.getElementById('encPassword');
if (encPasswordInput) {
encPasswordInput.value = password;
checkPasswordStrength(password, 'enc');
}
showNotification(state.language === 'fa' ? 'رمز عبور تولید، ذخیره و اعمال شد' : 'Password generated, saved and applied', 'success');
} else {
showNotification(state.language === 'fa' ? 'رمز عبور پیشرفته ذخیره شد' : 'Advanced password saved', 'success');
}
closeAdvancedPasswordGenerator();
}
/* Encrypted, like every other store that holds something worth reading.
 *
 * These rows are {password, created, id} — the generated password itself, in
 * the clear — and they went in through a bare JSON.stringify while every chat
 * store around them went through encryptStorageData. Anybody with the browser
 * profile directory, a backup of it, or a minute at an unlocked desk read the
 * list without needing the master password, which is the one thing this
 * product says cannot happen.
 *
 * The TOTP secret next door stays in the clear and should: verifySecondFactor()
 * runs BEFORE adoptProfile(), deliberately, so that a wrong code cannot return
 * with the vault already open in memory. There is no profile key to encrypt it
 * with at the moment it has to be read. This list has no such constraint — it
 * is only ever touched after unlock. */
function savePasswords() {
  try {
    localStorage.setItem('poorija_passwords', encryptStorageData(state.generatedPasswords));
  } catch (error) {
    /* Before unlock there is no profile to encrypt for. Writing plaintext as a
       fallback would defeat the point, so the list simply is not saved — it is
       still in memory, and the next save after unlock writes it properly. */
    console.warn('[passwords] not saved: no profile is open yet', error?.message || error);
  }
}
function loadPasswords() {
const saved = localStorage.getItem('poorija_passwords');
if (saved) {
/* decryptStorageData already reads a plain JSON array written before this
   change and returns it, so an existing list survives the upgrade and is
   re-encrypted by the next savePasswords(). A truncated or unreadable write
   used to abort boot; whatever is already in state stays instead. */
try {
const opened = decryptStorageData(saved);
if (Array.isArray(opened)) state.generatedPasswords = opened;
} catch (error) {
console.error('[passwords] unreadable poorija_passwords; keeping current list', error);
}
renderPasswords();
}
}
function renderPasswords() {
const container = document.getElementById('passwordsList');
if (!container) return;
if (state.generatedPasswords.length === 0) {
container.innerHTML = `
<div class="text-center py-8 text-gray-500">
<i class="fas fa-keyboard text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز رمز عبوری تولید نشده' : 'No passwords generated yet'}</p>
</div>
`;
return;
}
renderPasswordsList();
}
/* The saved-password rows show a fixed-width mask — ten stars and an ellipsis —
 * so no password length can ever push the row wider than its card. The real
 * length is stated in the counter line, and the secret itself only appears
 * inside the master-password gate. */
function maskedPasswordPreview(password) {
  const length = String(password || '').length;
  return '*'.repeat(Math.min(10, length)) + (length > 10 ? '…' : '');
}
function renderPasswordsList() {
const container = document.getElementById('passwordsList');
if (!container) return;
if (state.generatedPasswords.length === 0) {
container.innerHTML = `
<div class="text-center py-8 text-gray-500">
<i class="fas fa-keyboard text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز رمز عبوری تولید نشده' : 'No passwords generated yet'}</p>
</div>
`;
return;
}
container.innerHTML = state.generatedPasswords.map(p => `
<div class="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg space-y-2">
<div class="font-mono text-sm bg-gray-100 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg px-3 py-2 select-all text-white tracking-widest" dir="ltr">${maskedPasswordPreview(p.password)}</div>
<div class="flex items-center justify-between gap-2 min-w-0">
<span class="text-xs text-gray-500 dark:text-gray-400 truncate" dir="ltr">${p.password.length} ${state.language === 'fa' ? 'کاراکتر' : 'chars'} · ${new Date(p.created).toLocaleDateString(state.language === 'fa' ? 'fa-IR' : 'en-US')}</span>
<div class="flex gap-2 shrink-0">
<button onclick="viewPassword(${p.id})" class="px-3 py-1 bg-gray-200 dark:bg-slate-700 text-white rounded text-sm hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors" title="View">
<i class="fas fa-eye"></i>
</button>
<button onclick="copyPassword(${p.id})" class="px-3 py-1 bg-gray-200 dark:bg-slate-700 text-white rounded text-sm hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors" title="Copy">
<i class="fas fa-copy"></i>
</button>
<button onclick="deletePassword(${p.id})" class="px-3 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded text-sm" title="Delete">
<i class="fas fa-trash"></i>
</button>
</div>
</div>
</div>
`).join('');
}
/* Every action on a saved password runs through the master-password gate —
 * reveal, copy and delete alike — with biometric quick unlock beside it
 * wherever the desktop shell can vouch for the user. */
window.currentViewPasswordId = null;
window.currentViewPasswordAction = null;
function viewPassword(id) {
openPasswordGate(id, 'view');
}
function copyPassword(id) {
openPasswordGate(id, 'copy');
}
function deletePassword(id) {
window.currentViewPasswordId = id;
window.currentViewPasswordAction = 'delete';
window.PoorijaDialogs.confirm(
state.language === 'fa' ? 'این رمز عبور حذف شود؟ این عمل بازگشت‌پذیر نیست.' : 'Delete this password? This cannot be undone.',
{ title: state.language === 'fa' ? 'حذف رمز عبور' : 'Delete password' }
).then((confirmed) => {
if (confirmed === true) openPasswordGate(id, 'delete');
}).catch(() => { /* dialog queue closed */ });
}
function openPasswordGate(id, action) {
const record = state.generatedPasswords.find((p) => p.id === id);
if (!record) return;
window.currentViewPasswordId = id;
window.currentViewPasswordAction = action;
const titles = {
view: { fa: 'برای مشاهده رمز، رمز مستر را وارد کنید', en: 'Enter the master password to reveal it' },
copy: { fa: 'برای کپی رمز، رمز مستر را وارد کنید', en: 'Enter the master password to copy it' },
delete: { fa: 'برای حذف رمز، رمز مستر را وارد کنید', en: 'Enter the master password to delete it' },
};
const title = document.getElementById('viewPasswordTitle');
if (title) title.textContent = state.language === 'fa' ? titles[action].fa : titles[action].en;
const input = document.getElementById('viewPasswordInput');
if (input) input.value = '';
document.getElementById('viewPasswordReveal')?.classList.add('hidden');
document.getElementById('viewPasswordCopyBtn')?.classList.add('hidden');
document.getElementById('viewPasswordGateRow')?.classList.remove('hidden');
document.getElementById('viewPasswordVerifyBtn')?.classList.remove('hidden');
const modal = document.getElementById('viewPasswordModal');
modal.classList.remove('hidden');
modal.classList.add('flex');
input.focus();
/* Biometric sits beside the master password, and it is ALWAYS the same
   biometric: the Passkey / Biometric Quick Unlock the user set up in
   settings. Native shells go through the keychain; browsers assert the one
   configured passkey and unwrap the stored secret. This gate never creates a
   second credential. */
const biometricButton = document.getElementById('viewPasswordBiometricBtn');
if (biometricButton) {
biometricButton.classList.add('hidden');
const available = window.PoorijaDesktop?.available
? Boolean(state.desktopAuth?.enabled)
: Boolean(getPasskeyRecord());
if (available) {
biometricButton.classList.remove('hidden');
}
}
}
async function biometricViewPassword() {
/* Native: the keychain returns the stored master password. Web: the ONE
   passkey configured in settings asserts, and the stored secret unwraps. */
if (window.PoorijaDesktop?.available) {
try {
if (!await openMobileBiometricWindow()) return;
const master = await invokeDesktopCommand('desktop_unlock_with_biometric');
await finishPasswordGate(String(master || ''));
} catch (_error) {
showNotification(state.language === 'fa' ? 'احراز هویت بیومتریک ناموفق بود' : 'Biometric authentication failed', 'error');
}
return;
}
const passkeyRecord = getPasskeyRecord();
if (!passkeyRecord) {
showNotification(state.language === 'fa' ? 'اول Passkey / Biometric Quick Unlock را در تنظیمات فعال کنید' : 'Enable Passkey / Biometric Quick Unlock in settings first', 'warning');
return;
}
try {
let master = '';
if (passkeyRecord.strategy === 'largeBlob') {
const payload = await webauthnWithWatchdog(() => readPasskeyLargeBlob(base64UrlToArrayBuffer(passkeyRecord.credentialId)));
master = String(payload.masterPassword || '');
} else if (passkeyRecord.strategy === 'presence') {
/* Ceremony first — the wrap key alone must never reveal the vault. */
await runPasskeyPresenceCeremony(passkeyRecord.credentialId);
const wrapB64 = getPasskeyWrapKey(passkeyRecord);
if (!wrapB64) throw new Error('local wrap key is missing');
master = await decryptPasskeyPayload(passkeyRecord, base64ToArrayBuffer(wrapB64));
} else {
const seed = await webauthnWithWatchdog(() => derivePasskeyPrfSeed(base64UrlToArrayBuffer(passkeyRecord.credentialId)));
master = await decryptPasskeyPayload(passkeyRecord, seed);
}
if (!master) throw new Error('empty master password');
const matches = await verifyMasterPassword(master);
if (!matches) throw new Error('recovered password does not match');
await finishPasswordGate(master);
} catch (error) {
console.error('[passkey-gate]', error);
showNotification(
state.language === 'fa'
? 'باز کردن با بایومتریک انجام نشد.'
: 'Biometric unlock did not go through.',
'error'
);
}
}
async function submitViewPassword() {
const pass = document.getElementById('viewPasswordInput').value;
const matches = await verifyMasterPassword(pass);
if (matches) {
await finishPasswordGate(pass);
} else {
showNotification(state.language === 'fa' ? 'رمز اشتباه' : 'Wrong password', 'error');
}
}
async function finishPasswordGate(masterPassword) {
const id = window.currentViewPasswordId;
const action = window.currentViewPasswordAction || 'view';
const record = state.generatedPasswords.find((p) => p.id === id);
if (!record) {
closeViewPasswordModal();
return;
}
if (action === 'copy') {
try {
await navigator.clipboard.writeText(record.password);
showNotification(state.language === 'fa' ? 'رمز در کلیپ‌بورد کپی شد' : 'Password copied to clipboard', 'success');
} catch (_error) {
showNotification(state.language === 'fa' ? 'کپی ناموفق بود' : 'Copy failed', 'error');
}
closeViewPasswordModal();
return;
}
if (action === 'delete') {
state.generatedPasswords = state.generatedPasswords.filter((p) => p.id !== id);
savePasswords();
renderPasswords();
showNotification(state.language === 'fa' ? 'رمز عبور حذف شد' : 'Password deleted', 'success');
closeViewPasswordModal();
return;
}
/* Reveal: the password appears inside this same popup, with its own copy
   button — no clipboard surprise, nothing to type twice. */
document.getElementById('viewPasswordGateRow')?.classList.add('hidden');
document.getElementById('viewPasswordVerifyBtn')?.classList.add('hidden');
const revealed = document.getElementById('viewPasswordRevealed');
if (revealed) revealed.textContent = record.password;
document.getElementById('viewPasswordReveal')?.classList.remove('hidden');
document.getElementById('viewPasswordCopyBtn')?.classList.remove('hidden');
}
function copyRevealedPassword() {
const record = state.generatedPasswords.find((p) => p.id === window.currentViewPasswordId);
if (!record) return;
navigator.clipboard.writeText(record.password).then(() => {
showNotification(state.language === 'fa' ? 'رمز در کلیپ‌بورد کپی شد' : 'Password copied to clipboard', 'success');
}).catch(() => {
showNotification(state.language === 'fa' ? 'کپی ناموفق بود' : 'Copy failed', 'error');
});
}
function closeViewPasswordModal() {
const modal = document.getElementById('viewPasswordModal');
modal.classList.add('hidden');
modal.classList.remove('flex');
}
/* A call is activity, even when nobody touches the keyboard.
 *
 * Auto-lock counts inactivity from the last input event, and a call is exactly
 * the situation where there is none: both people are talking and neither is
 * typing. Locking tears the media down, so a five-minute timer ended a
 * ten-minute call mid-sentence with no warning and nothing to undo it.
 *
 * Both call shapes count. The functions live in the chat module, which shares
 * this realm but is loaded after app.js, so they are checked for rather than
 * called blind — a lock that throws is worse than one that fires early. */
function callIsLive() {
  try {
    if (typeof isCallBusy === 'function' && isCallBusy()) return true;
    if (typeof groupCallActive === 'function' && groupCallActive()) return true;
  } catch (_error) { /* chat module not loaded yet: nothing is live */ }
  return false;
}

function resetAutoLockTimer() {
clearTimeout(state.inactivityTimer);
if (!state.isLocked && state.settings && state.settings.autoLock) {
state.inactivityTimer = setTimeout(() => {
/* Do not lock over a live call — re-arm instead, so the timer starts again
   from the moment the call ends rather than firing the instant it does. */
if (callIsLive()) {
  resetAutoLockTimer();
  return;
}
lockApp();
showNotification(state.language === 'fa' ? 'برنامه به دلیل عدم فعالیت قفل شد' : 'App locked due to inactivity', 'info');
}, state.settings.autoLockTime * 60000 || 300000);
}
}
/* ============================================================================
   Local storage encryption
   ============================================================================

   This used to be CryptoJS: PBKDF2-SHA256 into AES-256-CBC with an HMAC-SHA256
   over the envelope. Sound construction, unmaintained library, and it kept
   RC4 and TripleDES in the shipped payload alongside it.

   It is now XChaCha20-Poly1305 from js/crypto-core.js, keyed per profile by
   js/vault-profiles.js. Three things fall out of that change:

     - One AEAD instead of encrypt-then-MAC assembled by hand, so there is no
       envelope-string format whose exact spelling the MAC depends on.
     - A 192-bit random nonce per write, so the vault can be re-encrypted
       forever without a counter to reset or repeat.
     - Data lands under poorija_p_<pid>_*, which is what makes the decoy
       profile's storage indistinguishable in shape from the real one's.

   Both functions stay synchronous, because their callers are ordinary state
   writes scattered through this file. That is the whole reason crypto-core
   implements the cipher in software rather than reaching for crypto.subtle. */

function activeProfileOrThrow() {
  if (!state.activeProfile) {
    throw new Error('Cannot touch local storage data before unlock.');
  }
  return state.activeProfile;
}

function encryptStorageData(data) {
  return window.PoorijaVault.encryptForProfile(activeProfileOrThrow(), data);
}

function decryptStorageData(encryptedStr) {
  if (!encryptedStr) return null;
  if (!state.activeProfile) return null;
  const trimmed = String(encryptedStr).trim();

  const opened = window.PoorijaVault.decryptForProfile(state.activeProfile, trimmed);
  if (opened !== null) return opened;

  /* Plain JSON written before any encryption existed. Still read, still
     re-encrypted on the next write. */
  if (trimmed.startsWith('[')) {
    try { return JSON.parse(trimmed); } catch (error) { return null; }
  }
  return null;
}

/* ---- migrating the pre-profile vault ---------------------------------------

   Everything above is synchronous and only understands the v4 envelope. Data
   written by the CryptoJS build is v2/v3 — PBKDF2-SHA256, AES-256-CBC,
   HMAC-SHA256 — which WebCrypto can read perfectly well, just not
   synchronously. So the conversion happens once, at unlock, in an async
   context, and the synchronous path never has to know the old format existed.

   Reading it here rather than deleting it matters: this application has not
   been released, but it has been *used*, and silently discarding the
   maintainer's own notes and keys because a cipher changed would be its own
   kind of data loss. */

const LEGACY_STORAGE_SALT_KEY_V3 = 'poorija_storage_key_salt_v3';

async function deriveLegacyStorageKeys(password, saltBytes, iterations) {
  const material = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, material, 512);
  const all = new Uint8Array(bits);
  return { enc: all.slice(0, 32), mac: all.slice(32, 64) };
}

async function readLegacyStorageEnvelope(parsed, password) {
  const core = window.PoorijaCryptoCore;
  const saltB64 = parsed.v === 3
    ? localStorage.getItem(LEGACY_STORAGE_SALT_KEY_V3)
    : parsed.s;
  if (!saltB64) return null;

  const keys = await deriveLegacyStorageKeys(
    password, core.fromBase64(saltB64), parsed.it || 250000);

  /* The MAC covered this exact string. Reproduce it byte for byte or the
     comparison is meaningless. */
  const macInput = `${parsed.v}.${parsed.alg}.${parsed.it}.${parsed.s}.${parsed.iv}.${parsed.ct}`;
  const macKey = await crypto.subtle.importKey(
    'raw', keys.mac, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const macBytes = new Uint8Array(await crypto.subtle.sign(
    'HMAC', macKey, new TextEncoder().encode(macInput)));
  if (core.toBase64(macBytes) !== parsed.mac) return null;

  const encKey = await crypto.subtle.importKey(
    'raw', keys.enc, { name: 'AES-CBC' }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: core.fromBase64(parsed.iv) },
    encKey, core.fromBase64(parsed.ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

/* Walks every un-namespaced poorija_* entry, re-encrypts what it can read into
   the open profile, and removes the original. Anything unreadable is left
   alone rather than deleted — a failed migration should cost nothing. */
async function migrateLegacyStorageIntoProfile(profile, password) {
  const native = window.PoorijaVault.__native;
  const moved = [];
  const skipped = [];
  const doomed = [];

  /* Snapshot the names before touching anything. The loop writes a new
     poorija_p_<pid>_* entry for each key it migrates, and localStorage.key(i)
     indexes a live collection — so growing it mid-walk shifted the indices,
     visiting one key twice and skipping the one after it. The migration report
     showed "chat_settings" listed twice, which is what gave it away. */
  const names = [];
  for (let i = 0; i < localStorage.length; i++) names.push(localStorage.key(i));

  for (const key of names) {
    if (!key || !key.startsWith('poorija_')) continue;
    if (key.startsWith(window.PoorijaVault.PROFILE_PREFIX)) continue;
    if (key === window.PoorijaVault.VAULT_STORAGE_KEY) continue;
    if (window.PoorijaVault.GLOBAL_KEYS.has(key)) continue;

    /* Through native, NOT through localStorage.getItem.

       By the time this runs a profile is open, so the redirection installed by
       vault-profiles.js rewrites every poorija_* name into that profile's
       namespace. Reading `poorija_chat_identity` here would therefore look up
       `poorija_p_<pid>_chat_identity`, which does not exist yet — so the
       migration read nothing, moved nothing, and reported success. Every
       upgrading user lost their chat identity, contacts and notes to that one
       line; the data was never deleted, only orphaned under names the app had
       stopped looking at. */
    const raw = native.getItem(key);
    if (!raw || !raw.trim().startsWith('{')) continue;

    let parsed;
    try { parsed = JSON.parse(raw); } catch (error) { continue; }
    // Safari builds before 2.100.19 wrote v4 ciphertext under flat names.
    // Recover only authenticated data belonging to this profile, and never
    // overwrite a namespaced copy. A different profile's ciphertext stays put.
    if (parsed?.v === 4) {
      const data = window.PoorijaVault.decryptForProfile(profile, raw);
      if (data === null) { skipped.push(key); continue; }
      const target = window.PoorijaVault.profileKey(profile, key.replace(/^poorija_/, ''));
      if (native.getItem(target) !== null) continue;
      try {
        native.setItem(target, raw);
        doomed.push(key);
        moved.push(key.replace(/^poorija_/, ''));
      } catch (error) { skipped.push(key); }
      continue;
    }
    if (!parsed || (parsed.v !== 2 && parsed.v !== 3) || !parsed.ct || !parsed.mac) continue;

    try {
      const data = await readLegacyStorageEnvelope(parsed, password);
      if (data === null) { skipped.push(key); continue; }
      const plainName = key.replace(/^poorija_/, '');
      localStorage.setItem(
        window.PoorijaVault.profileKey(profile, plainName),
        window.PoorijaVault.encryptForProfile(profile, data));
      doomed.push(key);
      moved.push(plainName);
    } catch (error) {
      skipped.push(key);
    }
  }

  /* Native again, and for a sharper reason than the read above: a redirected
     removeItem('poorija_chat_identity') would delete
     poorija_p_<pid>_chat_identity — the copy that was just migrated. The two
     bugs cancelled out only because the read never succeeded, so nothing ever
     reached this loop. */
  doomed.forEach((key) => native.removeItem(key));
  if (skipped.length) {
    console.warn('[Vault] left in place, could not be read:', skipped.join(', '));
  }
  /* The salt is the only key that can still open whatever was skipped, so it
     survives until those records do. Removing it here — while unreadable v2/v3
     entries are still on disk — turned "temporarily unreadable" into
     "permanently bricked": a later password would never decrypt them either. */
  if (!skipped.length) native.removeItem(LEGACY_STORAGE_SALT_KEY_V3);
  return { moved, skipped };
}

['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
document.addEventListener(evt, resetAutoLockTimer);
});
// ==================== Appearance Settings ====================
function normalizeColorForPicker(value) {
const color = String(value || '').trim();
if (!color) return '#0ea5e9';
if (/^#[0-9a-f]{6}$/i.test(color)) {
return color;
}
if (/^#[0-9a-f]{3}$/i.test(color)) {
return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
}
const rgbMatch = color.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
if (rgbMatch) {
return `#${[rgbMatch[1], rgbMatch[2], rgbMatch[3]]
.map((channel) => Number(channel).toString(16).padStart(2, '0'))
.join('')}`;
}
return '#0ea5e9';
}
function getCurrentIconAccentColor() {
const explicitColor = state.settings.typography?.iconColor;
if (explicitColor) {
return normalizeColorForPicker(explicitColor);
}
const computedColor = getComputedStyle(document.documentElement).getPropertyValue('--icon-accent');
return normalizeColorForPicker(computedColor);
}
function syncIconColorInput() {
const iconColorInput = document.getElementById('settingIconColor');
if (iconColorInput) {
iconColorInput.value = getCurrentIconAccentColor();
}
}
function applyAppearanceSettings() {
const fontFa = document.getElementById('settingFontFa')?.value || "'Vazirmatn', sans-serif";
const fontEn = document.getElementById('settingFontEn')?.value || "'Inter', sans-serif";
const fontSize = document.getElementById('settingFontSize')?.value || "16px";
const iconColor = normalizeColorForPicker(document.getElementById('settingIconColor')?.value || '#0ea5e9');
document.body.style.fontFamily = state.language === 'fa' ? fontFa : fontEn;
document.body.style.fontSize = fontSize;
document.documentElement.style.setProperty('--icon-accent', iconColor);
state.settings.typography = { fontFa, fontEn, fontSize, iconColor };
saveSettings();
}
function applyTypographySettings() {
applyAppearanceSettings();
}
// ==================== Settings ====================
function loadSettings() {
const saved = localStorage.getItem('poorija_settings');
if (saved) {
/* One truncated settings blob used to kill the whole boot here. Defaults are
   already live in state, so a bad parse is survivable: say so and go on. */
try {
state.settings = { ...state.settings, ...normalizeSettingsRecord(JSON.parse(saved)) };
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
} catch (error) {
console.error('[settings] unreadable poorija_settings; keeping defaults', error);
}
}
applySettings();
if(state.settings.typography) {
document.body.style.fontFamily = state.language === 'fa' ? state.settings.typography.fontFa : state.settings.typography.fontEn;
document.body.style.fontSize = state.settings.typography.fontSize;
if (state.settings.typography.iconColor) {
document.documentElement.style.setProperty('--icon-accent', state.settings.typography.iconColor);
} else {
document.documentElement.style.removeProperty('--icon-accent');
}
}
const savedHistory = localStorage.getItem('poorija_history');
if (savedHistory) {
try {
state.history = JSON.parse(savedHistory);
} catch (error) {
/* History is plain JSON on the tools side, so it has no envelope to catch a
   truncated write. Rename the corpse aside rather than delete it — it is the
   only copy of the user's work and a bug that cut it short is worth looking
   at — then boot clean instead of dying at the same line next time. */
console.error('[settings] unreadable poorija_history; preserved as poorija_history.corrupt-*', error);
try {
localStorage.setItem('poorija_history.corrupt-' + Date.now(), savedHistory);
localStorage.removeItem('poorija_history');
} catch (renameError) {
console.error('[settings] could not set the corrupt history aside', renameError);
}
}
}
renderHistory('encrypt');
renderHistory('decrypt');
}
function toggleCustomAutoLockTime() {
const timeSelect = document.getElementById('autoLockTime');
const customInput = document.getElementById('customAutoLockTime');
if (timeSelect && customInput) {
if (timeSelect.value === 'custom') {
customInput.classList.remove('hidden');
} else {
customInput.classList.add('hidden');
}
}
saveSettings();
}
function saveSettings() {
const algSelect = document.getElementById('defaultAlgorithm');
const defaultKeyMethodSelect = document.getElementById('defaultKeyMethod');
const defaultIterationsInput = document.getElementById('defaultKdfIterations');
const defaultKdfHashSelect = document.getElementById('defaultKdfHash');
const defaultSaltLengthSelect = document.getElementById('defaultSaltLength');
const defaultGcmTagLengthSelect = document.getElementById('defaultGcmTagLength');
const defaultCtrCounterLengthSelect = document.getElementById('defaultCtrCounterLength');
const defaultAadContextInput = document.getElementById('defaultAadContext');
const defaultRsaLabelInput = document.getElementById('defaultRsaLabel');
const chunkSelect = document.getElementById('chunkSize');
const patternSelect = document.getElementById('namingPattern');
const notifToggle = document.getElementById('notificationsToggle');
const deleteToggle = document.getElementById('deleteOriginalToggle');
const timeSelect = document.getElementById('autoLockTime');
const customInput = document.getElementById('customAutoLockTime');
const desktopIconSelect = document.getElementById('settingDesktopIconProfile');
const selfDestructBindToggle = document.getElementById('sdBindToDevice');
if (algSelect) state.settings.algorithm = algSelect.value;
if (defaultKeyMethodSelect) state.settings.defaultKeyMethod = defaultKeyMethodSelect.value;
if (defaultIterationsInput) state.settings.pbkdf2Iterations = defaultIterationsInput.value;
if (defaultKdfHashSelect) state.settings.pbkdf2Hash = defaultKdfHashSelect.value;
if (defaultSaltLengthSelect) state.settings.saltLength = defaultSaltLengthSelect.value;
if (defaultGcmTagLengthSelect) state.settings.gcmTagLength = defaultGcmTagLengthSelect.value;
if (defaultCtrCounterLengthSelect) state.settings.ctrCounterLength = defaultCtrCounterLengthSelect.value;
if (defaultAadContextInput) state.settings.aadContext = defaultAadContextInput.value;
if (defaultRsaLabelInput) state.settings.rsaOaepLabel = defaultRsaLabelInput.value;
if (chunkSelect) state.settings.chunkSize = chunkSelect.value;
if (patternSelect) state.settings.namingPattern = patternSelect.value;
if (notifToggle) state.settings.notifications = notifToggle.checked;
if (deleteToggle) state.settings.deleteOriginal = deleteToggle.checked;
Object.assign(state.settings, normalizeEncryptionPreferences(state.settings));
if (timeSelect) {
if (timeSelect.value === 'custom') {
state.settings.autoLockTime = parseInt(customInput.value) || 5;
state.settings.autoLockTimeType = 'custom';
} else {
state.settings.autoLockTime = parseInt(timeSelect.value) || 5;
state.settings.autoLockTimeType = timeSelect.value;
}
}
const customPrefix = document.getElementById('customPrefix');
if (customPrefix) {
if (state.settings.namingPattern === 'custom') {
customPrefix.classList.remove('hidden');
} else {
customPrefix.classList.add('hidden');
}
}
if (desktopIconSelect && DESKTOP_ICON_PROFILES[desktopIconSelect.value]) {
state.settings.desktopIconProfile = desktopIconSelect.value;
}
if (selfDestructBindToggle) state.settings.selfDestructBindToDevice = selfDestructBindToggle.checked;
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
applySettings(); // Re-apply to update all algorithms in inputs across app
resetAutoLockTimer();
}
async function handleNotificationsToggleChange() {
const toggle = document.getElementById('notificationsToggle');
if (!toggle) return;
if (toggle.checked && isDesktopAppRuntime()) {
const permission = await ensureDesktopNotificationPermission(true);
if (!permission.granted) {
toggle.checked = false;
}
}
if (toggle.checked && !isDesktopAppRuntime()) {
const permission = await ensureWebPushPermission(true);
if (!permission.granted) {
toggle.checked = false;
} else {
window.dispatchEvent(new CustomEvent('poorija:notifications-enabled'));
}
}
saveSettings();
syncDesktopNotificationUi();
}
function applySettings() {
state.settings = normalizeSettingsRecord(state.settings);
const algSelect = document.getElementById('defaultAlgorithm');
const defaultKeyMethodSelect = document.getElementById('defaultKeyMethod');
const defaultIterationsInput = document.getElementById('defaultKdfIterations');
const defaultKdfHashSelect = document.getElementById('defaultKdfHash');
const defaultSaltLengthSelect = document.getElementById('defaultSaltLength');
const defaultGcmTagLengthSelect = document.getElementById('defaultGcmTagLength');
const defaultCtrCounterLengthSelect = document.getElementById('defaultCtrCounterLength');
const defaultAadContextInput = document.getElementById('defaultAadContext');
const defaultRsaLabelInput = document.getElementById('defaultRsaLabel');
const chunkSelect = document.getElementById('chunkSize');
const patternSelect = document.getElementById('namingPattern');
const notifToggle = document.getElementById('notificationsToggle');
const deleteToggle = document.getElementById('deleteOriginalToggle');
const iconColorInput = document.getElementById('settingIconColor');
const desktopIconSelect = document.getElementById('settingDesktopIconProfile');
const selfDestructBindToggle = document.getElementById('sdBindToDevice');
const encryptTabKeyMethodSelect = document.getElementById('keyMethod');
const encIterationsInput = document.getElementById('encIterations');
const encKdfHashSelect = document.getElementById('encKdfHash');
const encSaltLengthSelect = document.getElementById('encSaltLength');
const encGcmTagLengthSelect = document.getElementById('encGcmTagLength');
const encCtrCounterLengthSelect = document.getElementById('encCtrCounterLength');
const encAadContextInput = document.getElementById('encAadContext');
const encRsaLabelInput = document.getElementById('encRsaLabel');
if (algSelect) algSelect.value = state.settings.algorithm;
if (defaultKeyMethodSelect) defaultKeyMethodSelect.value = state.settings.defaultKeyMethod;
if (defaultIterationsInput) defaultIterationsInput.value = state.settings.pbkdf2Iterations;
if (defaultKdfHashSelect) defaultKdfHashSelect.value = state.settings.pbkdf2Hash;
if (defaultSaltLengthSelect) defaultSaltLengthSelect.value = String(state.settings.saltLength);
if (defaultGcmTagLengthSelect) defaultGcmTagLengthSelect.value = String(state.settings.gcmTagLength);
if (defaultCtrCounterLengthSelect) defaultCtrCounterLengthSelect.value = String(state.settings.ctrCounterLength);
if (defaultAadContextInput) defaultAadContextInput.value = state.settings.aadContext || '';
if (defaultRsaLabelInput) defaultRsaLabelInput.value = state.settings.rsaOaepLabel || '';
// Update algorithms everywhere applicable
const keyAlgorithmSelect = document.getElementById('keyAlgorithm');
if (keyAlgorithmSelect) keyAlgorithmSelect.value = state.settings.algorithm;
const encAlgorithmSelect = document.getElementById('encAlgorithm');
if (encAlgorithmSelect) encAlgorithmSelect.value = state.settings.algorithm;
if (encryptTabKeyMethodSelect) encryptTabKeyMethodSelect.value = state.settings.defaultKeyMethod;
if (encIterationsInput) encIterationsInput.value = state.settings.pbkdf2Iterations;
if (encKdfHashSelect) encKdfHashSelect.value = state.settings.pbkdf2Hash;
if (encSaltLengthSelect) encSaltLengthSelect.value = String(state.settings.saltLength);
if (encGcmTagLengthSelect) encGcmTagLengthSelect.value = String(state.settings.gcmTagLength);
if (encCtrCounterLengthSelect) encCtrCounterLengthSelect.value = String(state.settings.ctrCounterLength);
if (encAadContextInput) encAadContextInput.value = state.settings.aadContext || '';
if (encRsaLabelInput) encRsaLabelInput.value = state.settings.rsaOaepLabel || '';
const textAlgorithmSelect = document.getElementById('textAlgorithm');
if (textAlgorithmSelect) {
textAlgorithmSelect.value = state.settings.algorithm;
}
const textDecAlgorithmSelect = document.getElementById('textDecAlgorithm');
if (textDecAlgorithmSelect) {
textDecAlgorithmSelect.value = state.settings.algorithm;
}
const sdAlgorithmSelect = document.getElementById('sdAlgorithm');
if (sdAlgorithmSelect) {
sdAlgorithmSelect.value = state.settings.algorithm;
}
if (chunkSelect) chunkSelect.value = state.settings.chunkSize;
if (patternSelect) patternSelect.value = state.settings.namingPattern;
if (notifToggle) notifToggle.checked = state.settings.notifications;
syncPushSettingsUi();
if (deleteToggle) deleteToggle.checked = state.settings.deleteOriginal;
if (selfDestructBindToggle) selfDestructBindToggle.checked = state.settings.selfDestructBindToDevice !== false;
if (state.settings.typography?.iconColor) {
document.documentElement.style.setProperty('--icon-accent', state.settings.typography.iconColor);
} else {
document.documentElement.style.removeProperty('--icon-accent');
}
if (iconColorInput) {
iconColorInput.value = getCurrentIconAccentColor();
}
if (desktopIconSelect) {
desktopIconSelect.value = state.settings.desktopIconProfile || 'poorija-default';
}
if (state.settings.autoLock) {
const toggle = document.getElementById('autoLockToggle');
if (toggle) toggle.checked = true;
const section = document.getElementById('autoLockTimeSection');
if (section) section.classList.remove('hidden');
const timeSelect = document.getElementById('autoLockTime');
const customInput = document.getElementById('customAutoLockTime');
if (timeSelect) {
if (state.settings.autoLockTimeType === 'custom') {
timeSelect.value = 'custom';
if (customInput) {
customInput.value = state.settings.autoLockTime;
customInput.classList.remove('hidden');
}
} else {
timeSelect.value = state.settings.autoLockTimeType || state.settings.autoLockTime || '5';
if (customInput) customInput.classList.add('hidden');
}
}
}
loadCustomThemeConfig();
if (state.settings.typography) {
const fontFaInput = document.getElementById('settingFontFa');
const fontEnInput = document.getElementById('settingFontEn');
const fontSizeInput = document.getElementById('settingFontSize');
if(fontFaInput) fontFaInput.value = state.settings.typography.fontFa;
if(fontEnInput) fontEnInput.value = state.settings.typography.fontEn;
if(fontSizeInput) fontSizeInput.value = state.settings.typography.fontSize;
if(iconColorInput) iconColorInput.value = state.settings.typography.iconColor || '#0ea5e9';
document.body.style.fontFamily = state.language === 'fa' ? state.settings.typography.fontFa : state.settings.typography.fontEn;
document.body.style.fontSize = state.settings.typography.fontSize;
document.documentElement.style.setProperty('--icon-accent', state.settings.typography.iconColor || '#0ea5e9');
}
syncDesktopAppearanceUi();
applyDesktopIconProfileToRuntime(state.settings.desktopIconProfile || 'poorija-default');
toggleKeyMethod();
applySidebarTabOrder();
renderTabOrderCustomizer();
syncDesktopNotificationUi();
syncShredderDesktopUi();
renderKeysDropdown();
}
function toggleAutoLock() {
const enabled = document.getElementById('autoLockToggle').checked;
document.getElementById('autoLockTimeSection').classList.toggle('hidden', !enabled);
state.settings.autoLock = enabled;
saveSettings();
}
function showChangePassword() {
document.getElementById('changePasswordSection').classList.toggle('hidden');
}
async function changeMasterPassword() {
const current = document.getElementById('currentPassword').value;
const newPass = document.getElementById('newPassword').value;
const confirm = document.getElementById('confirmNewPassword').value;
if (!await verifyMasterPassword(current)) {
showNotification(state.language === 'fa' ? 'رمز فعلی اشتباه است' : 'Current password wrong', 'error');
return;
}
if (newPass !== confirm) {
showNotification(state.language === 'fa' ? 'رمزها مطابقت ندارند' : 'Passwords do not match', 'error');
return;
}
await writeMasterPasswordRecord(newPass);
state.masterPassword = newPass;
// Re-encrypt keys with new master password
if (state.keys.length > 0) {
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
}
if (state.secureNotes.length > 0) {
localStorage.setItem(NOTES_STORAGE_KEY, encryptStorageData(state.secureNotes));
}
await refreshStoredPasskeyUnlockSecret();
showNotification(state.language === 'fa' ? 'رمز عبور تغییر کرد' : 'Password changed', 'success');
document.getElementById('changePasswordSection').classList.add('hidden');
}
async function toggle2FA() {
if (state.twoFA.enabled) {
if (await PoorijaDialogs.confirm(state.language === 'fa' ? 'غیرفعال کردن 2FA؟' : 'Disable 2FA?')) {
state.twoFA.enabled = false;
localStorage.removeItem('poorija_2fa');
updateLanguage();
document.getElementById('2faStatus').textContent = state.language === 'fa' ? 'غیرفعال' : 'Disabled';
}
} else {
openSettings2FA();
}
}
function openSettings2FA() {
document.getElementById('settings2FAModal').classList.remove('hidden');
document.getElementById('settings2FAModal').classList.add('flex');
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secret = generateSecureRandomString(32, chars);
state.twoFA.tempSecret = secret;
const qrContainer = document.getElementById('settingsQrcode');
qrContainer.innerHTML = '';
const issuer = encodeURIComponent('P00RIJÃ');
const account = encodeURIComponent('User');
const otpauth = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}`;
setTimeout(() => {
/* This code is scanned exactly once, by a separate authenticator app, and a
   person who cannot scan it does not turn on two-factor at all. So it never
   takes the user's chosen palette: pure black on white, a real quiet zone,
   and large enough that each module survives another phone's camera. At 150
   px an otpauth payload at level H left barely three pixels a module.

   Level M rather than H for a related reason: H spends a third of the symbol
   on recovering from damage, which a screen does not suffer, and pays for it
   in density. The audit measured 53 modules at H against 41 at M, and only the
   M code could still be read from across a desk or slightly out of focus. */
if (window.PoorijaQR) {
window.PoorijaQR.render(qrContainer, otpauth, { preset: 'classic', level: 'M', px: 280, quiet: 4 });
} else {
new QRCode(qrContainer, {
text: otpauth,
width: 280,
height: 280,
colorDark: '#000000',
colorLight: '#ffffff',
correctLevel: QRCode.CorrectLevel.M
});
}
}, 50);
document.getElementById('settingsSecretKey').textContent = secret;
}
function closeSettings2FA() {
document.getElementById('settings2FAModal').classList.add('hidden');
document.getElementById('settings2FAModal').classList.remove('flex');
document.getElementById('settingsVerify2FACode').value = '';
}
function verifySettings2FA() {
const code = document.getElementById('settingsVerify2FACode').value;
const totp = new window.OTPAuth.TOTP({
issuer: 'P00RIJÃ Cryptography',
label: 'User',
algorithm: 'SHA1',
digits: 6,
period: 30,
secret: window.OTPAuth.Secret.fromBase32(state.twoFA.tempSecret)
});
const delta = totp.validate({ token: code, window: 1 });
if (delta !== null) {
state.twoFA.enabled = true;
state.twoFA.secret = state.twoFA.tempSecret;
localStorage.setItem('poorija_2fa', JSON.stringify({ enabled: true, secret: state.twoFA.secret }));
showNotification(state.language === 'fa' ? 'تایید دو مرحله‌ای فعال شد' : '2FA Enabled', 'success');
updateLanguage();
closeSettings2FA();
} else {
showNotification(state.language === 'fa' ? 'کد نامعتبر' : 'Invalid code', 'error');
}
}
function setTheme(theme) {
state.settings.theme = theme;
document.documentElement.classList.remove('dark', 'theme-pastel', 'theme-midnight', 'theme-neon', 'theme-dracula', 'theme-nord', 'theme-solarized', 'theme-custom', 'theme-cyberpunk', 'theme-ocean', 'theme-forest', 'theme-aurora', 'theme-sunset', 'theme-linen', 'theme-obsidian');
if (theme === 'dark') {
document.documentElement.classList.add('dark');
} else if (theme === 'pastel') {
document.documentElement.classList.add('theme-pastel');
} else if (theme === 'midnight') {
document.documentElement.classList.add('theme-midnight', 'dark');
} else if (theme === 'neon') {
document.documentElement.classList.add('theme-neon', 'dark');
} else if (theme === 'dracula') {
document.documentElement.classList.add('theme-dracula', 'dark');
} else if (theme === 'nord') {
document.documentElement.classList.add('theme-nord', 'dark');
} else if (theme === 'solarized') {
document.documentElement.classList.add('theme-solarized');
} else if (theme === 'cyberpunk') {
document.documentElement.classList.add('theme-cyberpunk', 'dark');
} else if (theme === 'ocean') {
document.documentElement.classList.add('theme-ocean', 'dark');
} else if (theme === 'forest') {
document.documentElement.classList.add('theme-forest', 'dark');
} else if (theme === 'aurora') {
document.documentElement.classList.add('theme-aurora', 'dark');
} else if (theme === 'sunset') {
document.documentElement.classList.add('theme-sunset', 'dark');
} else if (theme === 'linen') {
document.documentElement.classList.add('theme-linen');
} else if (theme === 'obsidian') {
document.documentElement.classList.add('theme-obsidian', 'dark');
} else if (theme === 'custom') {
document.documentElement.classList.add('theme-custom');
applyCustomTheme();
}
/* Two of the three chat tick colours come from the theme, so the settings card
   that reports their contrast has to be told the numbers just moved. */
window.dispatchEvent(new CustomEvent('poorija:theme-changed', { detail: { theme } }));
const builder = document.getElementById('customThemeBuilder');
if (builder) {
builder.classList.toggle('hidden', theme !== 'custom');
}
if (state.settings.typography?.iconColor) {
document.documentElement.style.setProperty('--icon-accent', state.settings.typography.iconColor);
} else {
document.documentElement.style.removeProperty('--icon-accent');
}
syncIconColorInput();
const themeColor = {
light: '#f8fafc',
dark: '#0f172a',
pastel: '#fff0f5',
midnight: '#0a0e27',
neon: '#050505',
dracula: '#282a36',
nord: '#2e3440',
solarized: '#fdf6e3',
cyberpunk: '#0d0221',
ocean: '#001f3f',
forest: '#1e392a',
aurora: '#06111f',
sunset: '#2b0f54',
linen: '#faf5ef',
obsidian: '#050816',
custom: state.settings.customTheme?.bgColor || '#ffffff'
};
applyStatusBarColour(themeColor[theme] || '#0f172a');
localStorage.setItem('poorija_theme', theme);
}

/* The phone's own status strip.
   The map above is a fallback, not the source of truth: what the strip has to
   match is whatever the theme actually paints, and the two had already drifted
   apart (pastel declared #fff0f5 while painting #fffafa). So the colour is read
   back from --app-bg after the theme class is on, and the map only covers a
   theme that does not define it.

   Two metas matter, for two platforms. Android Chrome tints the strip from
   theme-color. iOS uses apple-mobile-web-app-status-bar-style plus the page's
   own background colour, and it was pinned to "black" — which is why a light
   theme still got a black strip there. The style is picked from the colour's
   luminance, so a custom theme gets the right one without being listed. */
function applyStatusBarColour(fallback) {
const painted = getComputedStyle(document.documentElement).getPropertyValue('--app-bg').trim();
const colour = painted || fallback;
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colour);
/* The iOS style meta is pinned to black-translucent in the markup: iOS reads
   it once at launch, so changing it here never reached the running app. With
   translucent, the strip is painted by the page — see the safe-area band on
   the header — which does follow the theme, live. */
/* iOS samples the page background behind the strip, and a gradient gives it
   nothing flat to read, so the flat colour is stated as well. */
document.documentElement.style.setProperty('background-color', colour);
document.body?.style.setProperty('background-color', colour);
/* With black-translucent the OS draws its clock and battery in white over
   whatever we paint. A pale theme would swallow them, so the band behind the
   strip is deepened — same hue, dark enough to read against. */
document.documentElement.style.setProperty('--status-strip-bg',
isLightColour(colour) ? `color-mix(in srgb, ${colour} 26%, #0b1220)` : colour);
/* One flag for the whole sheet: whether this theme paints on light or on
   dark. CSS cannot work that out from a colour, and the muted and accent
   tones need different values on each — a grey that reads on navy is a
   whisper on cream. */
document.documentElement.dataset.tone = isLightColour(colour) ? 'light' : 'dark';
}

/* Used by the status-strip band below, which has to stay readable under white
   iOS glyphs even when the theme is a pale one. */
function isLightColour(value) {
const hex = String(value || '').trim().replace('#', '');
if (hex.length !== 3 && hex.length !== 6) return false;
const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
const r = parseInt(full.slice(0, 2), 16);
const g = parseInt(full.slice(2, 4), 16);
const b = parseInt(full.slice(4, 6), 16);
if ([r, g, b].some((n) => Number.isNaN(n))) return false;
/* Rec. 709 luma; 0.6 is where dark text stops being readable on the strip. */
return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
}
function applyCustomTheme() {
const bgColor = document.getElementById('customBgColor')?.value || '#ffffff';
const cardColor = document.getElementById('customCardColor')?.value || '#f8fafc';
const textColor = document.getElementById('customTextColor')?.value || '#000000';
const primaryColor = document.getElementById('customPrimaryColor')?.value || '#14b8a6';
document.documentElement.style.setProperty('--custom-bg', bgColor);
document.documentElement.style.setProperty('--custom-bg-card', cardColor);
document.documentElement.style.setProperty('--custom-text', textColor);
document.documentElement.style.setProperty('--custom-primary', primaryColor);
// Save custom theme config to settings
state.settings.customTheme = {
bgColor, cardColor, textColor, primaryColor
};
saveSettings();
}
function loadCustomThemeConfig() {
if (state.settings.customTheme) {
const config = state.settings.customTheme;
const bgInput = document.getElementById('customBgColor');
const cardInput = document.getElementById('customCardColor');
const textInput = document.getElementById('customTextColor');
const primaryInput = document.getElementById('customPrimaryColor');
if (bgInput) bgInput.value = config.bgColor;
if (cardInput) cardInput.value = config.cardColor;
if (textInput) textInput.value = config.textColor;
if (primaryInput) primaryInput.value = config.primaryColor;
}
}
async function resetAllSettings() {
if (await PoorijaDialogs.confirm(state.language === 'fa' ? 'تمام تنظیمات پاک شود؟' : 'Reset all settings?')) {
localStorage.removeItem('poorija_settings');
localStorage.removeItem('poorija_keys');
localStorage.removeItem('poorija_passwords');
localStorage.removeItem(NOTES_STORAGE_KEY);
localStorage.removeItem(SHARE_HISTORY_STORAGE_KEY);
localStorage.removeItem(SIGNATURE_HISTORY_STORAGE_KEY);
localStorage.removeItem(PASSKEY_STORAGE_KEY);
localStorage.removeItem('poorija_2fa');
localStorage.removeItem('poorija_history');
localStorage.removeItem('poorija_last_backup_at');
location.reload();
}
}
// ==================== UI Functions ====================
/* iOS standalone bug guard: after keyboard use the window can stay shrunk
   (innerHeight shorter than the physical screen) which letterboxes the app and
   lifts every bottom:0 element. Detect it and force iOS to restore the window
   by re-asserting the fixed body shell. */
(function initViewportWatchdog() {
const physicalH = () => Math.round((window.screen && window.screen.height ? window.screen.height : window.innerHeight * (window.devicePixelRatio || 1)) / (window.devicePixelRatio || 1));
const keyboardOpen = () => document.documentElement.classList.contains('keyboard-open');
let restoreTries = 0;
/* WebKit under-reports innerHeight by exactly the top inset in a cover-fit
   standalone window (measured: screen 932, window 873, env-top 59), so the
   raw difference is not evidence of a shrunken window. Discount the inset
   the shell is already accounting for before deciding anything is wrong. */
const reportedTopInset = () => Math.max(0, parseFloat(
getComputedStyle(document.documentElement).getPropertyValue('--pwa-safe-top')) || 0);
const restoreViewport = () => {
if (keyboardOpen()) return;
const gap = physicalH() - window.innerHeight - reportedTopInset();
if (gap <= 10) { restoreTries = 0; return; }
document.documentElement.style.setProperty('--ios-viewport-gap', gap + 'px');
if (restoreTries++ > 3) return;
const body = document.body;
const hadFixed = body.style.position;
body.style.position = 'static';
void body.offsetHeight;
body.style.position = hadFixed || '';
window.scrollTo(0, 0);
};
setInterval(restoreViewport, 3000);
window.addEventListener('resize', () => setTimeout(restoreViewport, 350));
window.addEventListener('orientationchange', () => setTimeout(restoreViewport, 500));
document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(restoreViewport, 400); });
})();

/* ---- Mobile quick tab bar: catalog, user customization, rendering ---- */
const MOBILE_TAB_CATALOG = [
{ id: 'encrypt', fa: 'فایل‌ها', en: 'Files', icon: 'fa-shield-halved' },
{ id: 'decrypt', fa: 'بازگشایی', en: 'Decrypt', icon: 'fa-unlock' },
{ id: 'chat', fa: 'چت امن', en: 'Secure Chat', icon: 'fa-comments' },
{ id: 'sshkeys', fa: 'کلید SSH', en: 'SSH Keys', icon: 'fa-key' },
{ id: 'passwords', fa: 'رمزها', en: 'Passwords', icon: 'fa-user-lock' },
{ id: 'notes', fa: 'یادداشت', en: 'Notes', icon: 'fa-note-sticky' },
{ id: 'textencrypt', fa: 'متن', en: 'Text', icon: 'fa-font' },
{ id: 'hash', fa: 'هش', en: 'Hash', icon: 'fa-fingerprint' },
{ id: 'keys', fa: 'کلیدها', en: 'Keys', icon: 'fa-sitemap' },
{ id: 'signatures', fa: 'امضا', en: 'Signatures', icon: 'fa-signature' },
{ id: 'stego', fa: 'استگانوگرافی', en: 'Stego', icon: 'fa-image' },
{ id: 'shredder', fa: 'خراده‌کن', en: 'Shredder', icon: 'fa-trash' },
{ id: 'securitycenter', fa: 'مرکز امنیت', en: 'Security', icon: 'fa-shield' },
{ id: 'vault', fa: 'مدیریت فایل‌ها', en: 'File manager', icon: 'fa-folder-tree' },
{ id: 'voice', fa: 'تغییر صدا', en: 'Voice changer', icon: 'fa-wave-square' },
{ id: 'metadata', fa: 'متادیتا', en: 'Metadata', icon: 'fa-tags' },
{ id: 'qrbridge', fa: 'پل QR', en: 'QR bridge', icon: 'fa-qrcode' },
{ id: 'locallink', fa: 'پیوند محلی', en: 'Local link', icon: 'fa-tower-broadcast' },
{ id: 'authenticator', fa: 'کدساز', en: 'Authenticator', icon: 'fa-mobile-screen-button' },
{ id: 'inspector', fa: 'بازرس نویسه', en: 'Inspector', icon: 'fa-eye-low-vision' },
{ id: 'convert', fa: 'تبدیل', en: 'Convert', icon: 'fa-right-left' },
{ id: 'share', fa: 'اشتراک امن', en: 'Share', icon: 'fa-share-nodes' },
{ id: 'selfdestruct', fa: 'خودنابودی', en: 'Self-Destruct', icon: 'fa-bomb' },
{ id: 'wizard', fa: 'ویزارد', en: 'Wizard', icon: 'fa-wand-magic-sparkles' },
{ id: 'migration', fa: 'مهاجرت', en: 'Migration', icon: 'fa-right-left' },
{ id: 'settings', fa: 'تنظیمات', en: 'Settings', icon: 'fa-gear' },
{ id: 'help', fa: 'راهنما', en: 'Help', icon: 'fa-circle-question' },
{ id: 'about', fa: 'درباره', en: 'About', icon: 'fa-circle-info' },
];
const MOBILE_TABBAR_KEY = 'poorija_mobile_tabbar';
const MOBILE_TABBAR_DEFAULT = ['encrypt', 'chat', 'sshkeys', 'passwords', 'settings'];
function loadMobileTabBarConfig() {
try {
const raw = JSON.parse(localStorage.getItem(MOBILE_TABBAR_KEY) || 'null');
if (Array.isArray(raw) && raw.length) {
const valid = raw.filter((id) => MOBILE_TAB_CATALOG.some((item) => item.id === id));
if (valid.length) return valid.slice(0, 5);
}
} catch (error) { /* corrupted config — fall back */ }
return [...MOBILE_TABBAR_DEFAULT];
}
function saveMobileTabBarConfig(ids) {
try { localStorage.setItem(MOBILE_TABBAR_KEY, JSON.stringify(ids)); } catch (error) { /* storage full */ }
}
/* Moving the highlight is not a reason to rebuild the row. The bar carries a
   backdrop-filter, so it sits on its own compositor layer: replacing every
   child invalidates that layer and the blurred backdrop has to be sampled
   again, and the fresh <i> nodes re-resolve the icon font. switchTab() was
   writing innerHTML twice per switch (once through syncMobileTabBar, once
   directly), and when the compositor missed the frame the whole bar blinked
   out and came back — the "sometimes the bottom bar vanishes" report. The
   markup only depends on the chosen tab ids and the language, so that pair is
   the signature: same signature, no rebuild, just move the class. */
function mobileTabBarSignature(ids) {
return `${ids.join(',')}|${state.language === 'en' ? 'en' : 'fa'}`;
}
function paintMobileTabBarActive(bar) {
bar.querySelectorAll('.mobile-tab-btn').forEach((button) => {
button.classList.toggle('is-active', button.dataset.mtab === state.activeTab);
});
}
function renderMobileTabBar() {
const bar = document.getElementById('mobileTabBar');
if (!bar) return;
const lang = state.language === 'en';
const ids = loadMobileTabBarConfig();
const signature = mobileTabBarSignature(ids);
if (bar.dataset.tabSignature === signature && bar.children.length === ids.length) {
paintMobileTabBarActive(bar);
return;
}
bar.innerHTML = ids.map((id) => {
const item = MOBILE_TAB_CATALOG.find((entry) => entry.id === id);
if (!item) return '';
const label = lang ? item.en : item.fa;
return `<button type="button" class="mobile-tab-btn${state.activeTab === id ? ' is-active' : ''}" data-mtab="${id}" onclick="switchTab('${id}')" aria-label="${label}"><i class="fas ${item.icon}"></i><span>${label}</span></button>`;
}).join('');
bar.dataset.tabSignature = signature;
bar.style.gridTemplateColumns = `repeat(${Math.max(1, ids.length)}, minmax(0, 1fr))`;
}
/* Only ever a class move: the row itself is already on screen and correct. */
function syncMobileTabBar(tabName) {
const active = typeof tabName === 'string' ? tabName : state.activeTab;
state.activeTab = active;
const bar = document.getElementById('mobileTabBar');
if (!bar) return;
renderMobileTabBar();
}
function forceRenderMobileTabBar() {
const bar = document.getElementById('mobileTabBar');
if (bar) delete bar.dataset.tabSignature;
renderMobileTabBar();
}
function toggleMobileTabBarItem(id) {
let ids = loadMobileTabBarConfig();
if (ids.includes(id)) {
if (ids.length <= 1) {
showNotification(state.language === 'fa' ? 'حداقل یک تب لازم است.' : 'At least one tab is required.', 'warning');
return;
}
ids = ids.filter((item) => item !== id);
} else {
if (ids.length >= 5) {
showNotification(state.language === 'fa' ? 'حداکثر ۵ تب می‌توانید داشته باشید.' : 'You can have at most 5 tabs.', 'warning');
return;
}
ids.push(id);
}
saveMobileTabBarConfig(ids);
forceRenderMobileTabBar();
renderMobileTabBarSettings();
}
function moveMobileTabBarItem(id, direction) {
const ids = loadMobileTabBarConfig();
const index = ids.indexOf(id);
const target = index + direction;
if (index < 0 || target < 0 || target >= ids.length) return;
[ids[index], ids[target]] = [ids[target], ids[index]];
saveMobileTabBarConfig(ids);
forceRenderMobileTabBar();
renderMobileTabBarSettings();
}
function renderMobileTabBarSettings() {
const wrap = document.getElementById('mobileTabBarSettings');
if (!wrap) return;
const lang = state.language === 'en';
/* Priority 1 is the FIRST slot of the bar in the active reading direction:
   rightmost on Persian, leftmost on English — same as the bar itself. */
wrap.setAttribute('dir', lang ? 'ltr' : 'rtl');
const active = loadMobileTabBarConfig();
/* Names come from the same translations the sidebar tabs use, so the picker
   and the bar can never drift into different words for one feature. */
const labelFor = (item) => {
  const definition = sidebarTabDefinitions().find((tab) => tab.id === item.id);
  return definition ? getTranslatedText(definition.labelKey, lang ? item.en : item.fa) : (lang ? item.en : item.fa);
};
/* Selection grid: a tick and nothing else — the arrows never belonged here,
   they belonged on the ordered list below. */
const grid = MOBILE_TAB_CATALOG.map((item) => {
const on = active.includes(item.id);
return `<label class="mtab-cfg-row${on ? ' on' : ''}">
<span class="mtab-cfg-label"><i class="fas ${item.icon}"></i><span>${escapeHtml(labelFor(item))}</span></span>
<input type="checkbox" data-mtab-cb="${item.id}" ${on ? 'checked' : ''} onchange="toggleMobileTabBarItem('${item.id}')">
</label>`;
}).join('');
/* The ordered list: exactly the selected tabs, in bar order, each with its
   priority number and the up/down controls that reshape the bar. */
const orderRows = active.map((tabId, index) => {
const item = MOBILE_TAB_CATALOG.find((candidate) => candidate.id === tabId);
if (!item) return '';
return `<div class="mtab-order-row">
<span class="mtab-priority">${index + 1}</span>
<i class="fas ${item.icon}"></i>
<span class="mtab-order-name">${escapeHtml(labelFor(item))}</span>
<span class="mtab-cfg-order">
<button type="button" class="mtab-order-btn" ${index === 0 ? 'disabled' : ''} onclick="moveMobileTabBarItem('${tabId}', -1)" aria-label="up"><i class="fas fa-chevron-up"></i></button>
<button type="button" class="mtab-order-btn" ${index === active.length - 1 ? 'disabled' : ''} onclick="moveMobileTabBarItem('${tabId}', 1)" aria-label="down"><i class="fas fa-chevron-down"></i></button>
</span>
</div>`;
}).join('');
wrap.innerHTML = `
<div class="mtab-cfg-list">${grid}</div>
${active.length ? `
<div class="text-xs text-gray-500 dark:text-gray-400 mt-4 mb-2 font-medium">${t('ترتیب نمایش در نوار (بالا = اول)', 'Bar display order (top = first)')}</div>
<div class="mtab-order-list">${orderRows}</div>` : ''}`;
}
/* On a wide screen most tabs are shorter than the region they sit in, which
   left a dead band under them — on a 1080px window the passwords tab used only
   33% of its area. Two strategies, chosen by what the tab actually contains:

   - a tab built around a list or grid GROWS, and the list takes the slack and
     scrolls inside itself, which is how a real desktop app behaves;
   - a short form CENTERS instead, because stretching a five-field card to
     1000px tall looks broken rather than full.

   Tabs whose content already overflows are left alone. */
const TAB_FILL_GROW_SELECTOR = [
  '#privateKeysList', '#publicKeysList', '#signatureKeysList',
  '#sshKeysList', '#secureNotesList', '#passwordsList', '#passwordList',
  '#shareHistoryList', '#signatureHistoryList', '#selfDestructList',
  '.ssh-manager', '.security-center-grid',
].join(', ');
const TAB_FILL_EXEMPT = new Set(['chat', 'settings', 'help']);

function applyTabFill(tabName) {
  const pane = document.getElementById(`content-${tabName}`);
  const region = document.querySelector('.dashboard-main-content');
  /* Clear every pane, not just this one: the wrapper is styled with :has(),
     so a stale attribute on a hidden pane would keep the wrapper stretched. */
  document.querySelectorAll('.tab-content[data-fill]').forEach((el) => el.removeAttribute('data-fill'));
  if (!pane) return;
  if (!region || TAB_FILL_EXEMPT.has(tabName)) return;
  if (window.innerWidth < 1024) return;
  /* Measure after the browser has laid the pane out, or scrollHeight is
     whatever the previous tab left behind. */
  requestAnimationFrame(() => {
    if (state.activeTab !== tabName) return;
    const available = region.clientHeight;
    const natural = pane.scrollHeight;
    if (!available || natural >= available - 12) return;
    pane.dataset.fill = pane.querySelector(TAB_FILL_GROW_SELECTOR) ? 'grow' : 'center';
  });
}

function switchTab(tabName, options = {}) {
const { updateHash = true } = options;
const coveredTabs = sharedLockTabs();
if (coveredTabs.includes(state.activeTab) && !coveredTabs.includes(tabName)) window.PoorijaChat?.vaultLock?.().lock();
state.activeTab = tabName;
document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
const content = document.getElementById(`content-${tabName}`);
if (content) content.classList.remove('hidden');
document.querySelectorAll('.tab-btn').forEach(el => {
el.classList.remove('active', 'border-brand-500', 'text-brand-600', 'dark:text-brand-400');
el.classList.add('border-transparent', 'text-gray-500');
});
const activeBtn = document.getElementById(`tab-${tabName}`);
if (activeBtn) {
activeBtn.classList.remove('border-transparent', 'text-gray-500');
activeBtn.classList.add('active', 'border-brand-500', 'text-brand-600', 'dark:text-brand-400');
}
if (tabName === 'keys') renderKeysList();
if (tabName === 'passwords') loadPasswords();
if (tabName === 'notes') loadSecureNotes();
if (tabName === 'securitycenter') renderSecurityCenter();
if (tabName === 'share') {
loadSecureNotes();
loadShareHistory();
toggleSharePayloadType();
}
if (tabName === 'signatures') {
loadSignatureHistory();
toggleSignatureMode();
toggleVerifySignatureMode();
}
applyTabFill(tabName);
if (updateHash && window.location.hash !== `#${tabName}`) {
history.replaceState(null, '', `#${tabName}`);
}
if (!isDesktopViewport()) {
toggleSidebar(false);
}
if (tabName === 'chat' && !document.hidden) {
clearUnreadChatCount();
}
/* syncMobileTabBar already repaints the highlight; calling the renderer a
   second time here only bought another teardown of the same row. */
syncMobileTabBar(tabName);
requestAnimationFrame(syncResponsiveShell);
syncAppBadge();
window.dispatchEvent(new CustomEvent('poorija:tab-switched', { detail: { tabName } }));
}
function toggleKeyMethod() {
const method = document.getElementById('keyMethod').value;
document.getElementById('passwordSection').classList.toggle('hidden', method !== 'password');
const publicKeySection = document.getElementById('publicKeySection');
if (publicKeySection) {
publicKeySection.classList.toggle('hidden', method !== 'publicKey');
}
syncEncryptAdvancedSettingsState();
renderKeysDropdown();
}
function renderKeysDropdown() {
const encSelect = document.getElementById('encPublicKey');
const decSelect = document.getElementById('decryptPublicKey');
const textKeySelect = document.getElementById('textKeySelect');
const encAlgorithm = document.getElementById('encAlgorithm') ? document.getElementById('encAlgorithm').value : state.settings.algorithm;
const textAlgorithm = document.getElementById('textAlgorithm') ? document.getElementById('textAlgorithm').value : state.settings.algorithm;
const textDecAlgorithm = document.getElementById('textDecAlgorithm') ? document.getElementById('textDecAlgorithm').value : state.settings.algorithm;
const sdAlgorithm = document.getElementById('sdAlgorithm') ? document.getElementById('sdAlgorithm').value : state.settings.algorithm;
const shareAlgorithm = document.getElementById('shareAlgorithm') ? document.getElementById('shareAlgorithm').value : 'AES-256-GCM';
const decryptContextAlgorithm = (state.currentDecryptContext && state.currentDecryptContext.keyProtection === 'rsa-wrapped')
? state.currentDecryptContext.algorithm
: ((state.currentDecryptContext && state.currentDecryptContext.contentAlgorithm)
|| (state.currentDecryptContext && state.currentDecryptContext.algorithm)
|| state.settings.algorithm);
const decryptUsage = 'decrypt';
const idPlaceholder = `<option value="" disabled selected>${state.language === 'fa' ? 'کلیدی موجود نیست' : 'No keys available'}</option>`;
const valuePlaceholder = `<option value="" disabled selected>${state.language === 'fa' ? '-- انتخاب از کلیدهای موجود --' : '-- Select from existing keys --'}</option>`;
const buildIdOptions = (keys) => keys.length > 0
? keys.map((key) => `<option value="${key.id}">${escapeHTML(key.name || key.tag)} (${escapeHTML(key.algorithm)})</option>`).join('')
: idPlaceholder;
const buildValueOptions = (keys, usage) => keys.length > 0
? valuePlaceholder + keys.map((key) => {
const safeValue = escapeHTML(buildKeyValueForUsage(key, usage));
return `<option value="${safeValue}">${escapeHTML(key.name || key.tag)} (${escapeHTML(key.algorithm)})</option>`;
}).join('')
: idPlaceholder;
const encryptFileKeys = getCompatibleStoredKeys(encAlgorithm, 'encrypt');
const decryptFileKeys = getCompatibleStoredKeys(decryptContextAlgorithm, decryptUsage);
const textEncryptKeys = getCompatibleStoredKeys(textAlgorithm, 'encrypt');
const textDecryptKeys = getCompatibleStoredKeys(textDecAlgorithm, 'decrypt');
const selfDestructEncryptKeys = getCompatibleStoredKeys(sdAlgorithm, 'encrypt');
const selfDestructDecryptKeys = getCompatibleStoredKeys(sdAlgorithm, 'decrypt');
if (encSelect) encSelect.innerHTML = buildIdOptions(encryptFileKeys);
if (decSelect) decSelect.innerHTML = buildIdOptions(decryptFileKeys);
if (textKeySelect) textKeySelect.innerHTML = buildValueOptions(textEncryptKeys, 'encrypt');
const textDecKeySelect = document.getElementById('textDecKeySelect');
if (textDecKeySelect) textDecKeySelect.innerHTML = buildValueOptions(textDecryptKeys, 'decrypt');
const sdKeySelect = document.getElementById('sdKeySelect');
if (sdKeySelect) sdKeySelect.innerHTML = buildValueOptions(selfDestructEncryptKeys, 'encrypt');
const sdDecKeySelect = document.getElementById('sdDecKeySelect');
if (sdDecKeySelect) sdDecKeySelect.innerHTML = buildValueOptions(selfDestructDecryptKeys, 'decrypt');
const shareKeySelect = document.getElementById('shareKeySelect');
if (shareKeySelect) {
const publicOnlyKeys = state.keys.filter((key) => key.purpose !== 'signature' && Boolean(key.publicKeyData));
shareKeySelect.innerHTML = buildIdOptions(publicOnlyKeys);
}
const shareRecipientKeySelect = document.getElementById('shareRecipientKeySelect');
if (shareRecipientKeySelect) {
const recipientKeys = getCompatibleStoredKeys(shareAlgorithm, 'encrypt');
shareRecipientKeySelect.innerHTML = buildIdOptions(recipientKeys);
}
const secureSharePrivateKeySelect = document.getElementById('secureSharePrivateKeySelect');
if (secureSharePrivateKeySelect) {
const rsaPrivateKeys = state.keys.filter((key) =>
key.purpose !== 'signature'
&& Boolean(key.privateKeyData)
&& String(key.algorithm || '').startsWith('RSA-OAEP')
);
secureSharePrivateKeySelect.innerHTML = buildIdOptions(rsaPrivateKeys);
}
const shareNoteSelect = document.getElementById('shareNoteSelect');
if (shareNoteSelect) {
shareNoteSelect.innerHTML = state.secureNotes.length > 0
? state.secureNotes.map((note) => `<option value="${note.id}">${escapeHTML(note.title)}</option>`).join('')
: idPlaceholder;
}
const signingKeySelect = document.getElementById('signingKeySelect');
const verifyKeySelect = document.getElementById('verifyKeySelect');
const signatureKeys = state.keys.filter((key) => key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm));
const signatureOptions = signatureKeys.length > 0
? signatureKeys.map((key) => `<option value="${key.id}">${escapeHTML(key.name || key.tag)} (${escapeHTML(key.algorithm)})</option>`).join('')
: idPlaceholder;
if (signingKeySelect) signingKeySelect.innerHTML = signatureOptions;
if (verifyKeySelect) verifyKeySelect.innerHTML = signatureOptions;
}
async function generateSelfDestructKey() {
const algSelect = document.getElementById('sdAlgorithm');
const alg = algSelect && algSelect.value ? algSelect.value : (state.settings.algorithm || 'AES-256-GCM');
const keyMaterial = await generateAlgorithmKeyMaterial(alg);
document.getElementById('sdKey').value = keyMaterial.publicKeyData;
// Auto save to key management
const newKey = {
id: Date.now(),
tag: `${state.language === 'fa' ? 'پیام خودتخریب' : 'Self-Destruct Message'}_` + keyMaterial.publicKeyData.substring(0, 6),
name: `${state.language === 'fa' ? 'پیام خودتخریب' : 'Self-Destruct Message'}_` + keyMaterial.publicKeyData.substring(0, 6),
color: '#ec4899', // Pink color for SD keys
desc: 'Auto-generated Self-Destruct Key',
algorithm: alg,
publicKeyData: keyMaterial.publicKeyData,
privateKeyData: keyMaterial.privateKeyData,
keyMeta: keyMaterial.keyMeta,
created: new Date().toLocaleDateString()
};
state.keys.push(normalizeKeyRecord(newKey));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
renderKeysList();
renderKeysDropdown();
// Set the dropdown to the newly created key value
const sdKeySelect = document.getElementById('sdKeySelect');
if (sdKeySelect) {
sdKeySelect.value = keyMaterial.publicKeyData;
}
showNotification(state.language === 'fa' ? 'کلید با موفقیت تولید و ذخیره شد' : 'Key generated and saved successfully', 'success');
}
function handleFileSelect(event) {
const file = event.target.files[0];
if (file) {
state.currentFile = file;
document.getElementById('selectedFile').classList.remove('hidden');
document.getElementById('fileName').textContent = file.name;
document.getElementById('fileSize').textContent = formatBytes(file.size);
}
}
function clearFile() {
state.currentFile = null;
state.currentDecryptContext = null;
document.getElementById('selectedFile').classList.add('hidden');
document.getElementById('fileInput').value = '';
}
function handleDecryptFile(event) {
const file = event.target.files[0];
if (!file) return;
state.currentFile = file;
document.getElementById('decryptForm').classList.remove('hidden');
document.getElementById('decryptFileName').textContent = file.name;
file.text().then(text => {
try {
const data = normalizeFilePayloadRecord(JSON.parse(text));
state.currentDecryptContext = data;
document.getElementById('decryptMeta').textContent =
`Algorithm: ${data.algorithm} | Chunks: ${data.chunks?.length || 0}`;
const isPublicKey = (data.keyProtection && data.keyProtection !== 'password') || data.method === 'publicKey';
const passSection = document.getElementById('decryptPasswordSection');
const keySection = document.getElementById('decryptKeySection');
if (passSection) passSection.classList.toggle('hidden', isPublicKey);
if (keySection) keySection.classList.toggle('hidden', !isPublicKey);
if (isPublicKey) {
renderKeysDropdown();
}
} catch (e) {
state.currentDecryptContext = null;
document.getElementById('decryptMeta').textContent = 'Invalid format';
}
});
}
function escapeHTML(str) {
if (typeof str !== 'string') return str;
return str
.replace(/&/g, '&amp;')
.replace(/</g, '&lt;')
.replace(/>/g, '&gt;')
.replace(/"/g, '&quot;')
.replace(/'/g, '&#39;');
}
function escapeHtml(str) {
return escapeHTML(str);
}
/* U+2066 .. U+2069 wrap the run in a left-to-right isolate. Without it the
   bidi algorithm sees "0 Bytes" arriving in Persian text and puts the Latin
   word first, so the reader gets "Bytes 0". The marks are invisible and
   survive being dropped into innerText, a title attribute or a toast, which
   a CSS rule cannot promise. */
function formatBytes(bytes) {
const k = 1024;
const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
if (!bytes || bytes < 1) return '\u20660 Bytes\u2069';
const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
return `\u2066${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}\u2069`;
}
function ensureInstallationIdentity() {
let secret = localStorage.getItem(INSTALLATION_SECRET_STORAGE_KEY);
if (!secret) {
secret = generateSecureRandomString(48, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
localStorage.setItem(INSTALLATION_SECRET_STORAGE_KEY, secret);
}
return secret;
}
async function sha256Base64(value) {
const encoder = new TextEncoder();
const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
return arrayBufferToBase64(digest);
}
async function getInstallationBindingHash() {
const secret = ensureInstallationIdentity();
return sha256Base64(`${INSTALLATION_BINDING_NAMESPACE}:${secret}`);
}
// Export for testing
if (typeof module !== 'undefined' && module.exports) {
module.exports.formatBytes = formatBytes;
}
function showOutputModal() {
document.getElementById('outputFileName').textContent = state.outputName;
document.getElementById('outputModal').classList.remove('hidden');
document.getElementById('outputModal').classList.add('flex');
}
function closeOutputModal() {
document.getElementById('outputModal').classList.add('hidden');
document.getElementById('outputModal').classList.remove('flex');
clearFile();
}
function downloadOutput() {
if (!state.outputData) return;
const url = URL.createObjectURL(state.outputData);
const a = document.createElement('a');
a.href = url;
a.download = state.outputName;
a.click();
URL.revokeObjectURL(url);
closeOutputModal();
}
/* Why the camera or the microphone did not open.
 *
 * Every call site used to catch the rejection, throw the error away, and say
 * "access was denied" — for all of them. So a mic blocked by the macOS
 * hardened runtime, a webcam already held by another app, and a laptop with no
 * camera in it produced one identical sentence, and there was no way to tell
 * which had happened without a debugger. That cost a real diagnosis: a missing
 * entitlement read exactly like a permission the user had refused.
 *
 * getUserMedia names its failures, and the names are the useful part.
 *
 * The chat modules' t(fa, en) is not in scope here — this file reads
 * state.language directly — so the pair is chosen inline. */
function describeMediaError(error, want = 'both') {
  const fa = state.language === 'fa';
  const name = String(error?.name || '');
  const thing = want === 'audio'
    ? (fa ? 'میکروفون' : 'the microphone')
    : want === 'video'
      ? (fa ? 'دوربین' : 'the camera')
      : (fa ? 'میکروفون یا دوربین' : 'the microphone or camera');
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return fa
      ? `دسترسی به ${thing} داده نشد. در تنظیمات سیستم اجازه را بدهید و دوباره تلاش کنید.`
      : `Access to ${thing} was refused. Allow it in your system settings and try again.`;
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return fa ? `${thing} پیدا نشد.` : `No usable device for ${thing} was found.`;
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    /* The device exists and is allowed, and something else has it. */
    return fa
      ? `${thing} در دسترس نیست — احتمالاً برنامهٔ دیگری از آن استفاده می‌کند.`
      : `${thing} is not available — another application is probably using it.`;
  }
  if (name === 'SecurityError') {
    return fa
      ? `${thing} فقط روی یک اتصال امن کار می‌کند.`
      : `${thing} is only available over a secure connection.`;
  }
  /* Anything unforeseen carries its own name out rather than being flattened
     into the sentence above. */
  return fa
    ? `${thing} باز نشد${name ? ` (${name})` : ''}.`
    : `Could not open ${thing}${name ? ` (${name})` : ''}.`;
}

/* An in-app toast, and by default a system notification beside it.
 *
 * Those are two different surfaces with two different audiences. A toast is
 * drawn inside a window the person already has open and unlocked; a system
 * notification can land on a lock screen, in a shade the whole room can see,
 * or on a paired watch. Anything carrying what somebody wrote or the name of
 * a file they were sent must pass `system: false` and, if the arrival is
 * worth announcing at all, raise its own contentless notification.
 *
 * This was not separated, and every native shell is a desktop runtime --
 * Android included. An arriving message showed "Name: <the message>" on the
 * lock screen while the same build's PWA showed only that something encrypted
 * had arrived, because the PWA has no such mirror and takes the contentless
 * push from the service worker instead. */
function showNotification(message, type = 'info', { system = true } = {}) {
if (!state.settings.notifications) return;
const colors = {
success: 'linear-gradient(135deg, rgba(16,185,129,0.95), rgba(5,150,105,0.95))',
error: 'linear-gradient(135deg, rgba(239,68,68,0.95), rgba(220,38,38,0.95))',
warning: 'linear-gradient(135deg, rgba(245,158,11,0.95), rgba(217,119,6,0.95))',
info: 'linear-gradient(135deg, rgba(14,165,233,0.95), rgba(37,99,235,0.95))'
};
const icons = { success: 'check', error: 'exclamation', warning: 'triangle-exclamation', info: 'info' };
let stack = document.getElementById('toastStack');
if (!stack) {
stack = document.createElement('div');
stack.id = 'toastStack';
stack.className = 'toast-stack';
}
/* Last child of the body, every time.
   The stylesheet already puts this above every layer the app defines, but
   z-index only settles ties between siblings in the same stacking context —
   and overlays are appended to the body as they open, so a dialog created
   after the stack would win on document order alone. Moving it to the end
   costs nothing and makes "the notice is on top" true rather than usually
   true. */
if (stack.parentElement !== document.body || stack.nextSibling) {
document.body.appendChild(stack);
}
const div = document.createElement('div');
div.className = 'app-toast animate-slide-up';
div.style.background = colors[type] || colors.info;
div.innerHTML = `<i class="fas fa-${icons[type] || icons.info}-circle"></i><div class="app-toast-message"></div>`;
div.querySelector('.app-toast-message').textContent = String(message || '');
stack.appendChild(div);
if (system) void sendDesktopSystemNotification(message, type);
setTimeout(() => {
div.remove();
if (!stack.children.length) stack.remove();
}, type === 'error' ? 5200 : 3600);
}
function initializeTheme() {
const saved = localStorage.getItem('poorija_theme') || 'dark';
setTheme(saved);
}
function toggleTheme() {
const isDark = document.documentElement.classList.contains('dark');
setTheme(isDark ? 'light' : 'dark');
}
// Key management
function generateNewKeyPair() {
document.getElementById('keyModal').classList.remove('hidden');
document.getElementById('keyModal').classList.add('flex');
document.getElementById('keyTag').value = '';
document.getElementById('keyDesc').value = '';
const keyAlgorithmSelect = document.getElementById('keyAlgorithm');
if (keyAlgorithmSelect) {
keyAlgorithmSelect.value = state.settings.algorithm || 'AES-256-GCM';
}
}
function closeKeyModal() {
document.getElementById('keyModal').classList.add('hidden');
document.getElementById('keyModal').classList.remove('flex');
}
async function createAndSaveKey() {
const alg = document.getElementById('keyAlgorithm').value;
const tag = document.getElementById('keyTag').value;
const color = document.getElementById('keyColor').value;
const desc = document.getElementById('keyDesc').value;
if (!tag) {
showNotification(state.language === 'fa' ? 'لطفا تگ را وارد کنید' : 'Please enter a tag', 'warning');
return;
}
const keyMaterial = await generateAlgorithmKeyMaterial(alg);
// Create full key object matching standard schema
const newKey = {
id: Date.now(),
algorithm: alg,
tag: tag,
name: tag, // Align name with tag
color: color,
description: desc,
created: new Date().toLocaleDateString(),
publicKeyData: keyMaterial.publicKeyData,
privateKeyData: keyMaterial.privateKeyData,
keyMeta: keyMaterial.keyMeta
};
state.keys.push(normalizeKeyRecord(newKey));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
showNotification(state.language === 'fa' ? 'کلید با موفقیت ساخته شد' : 'Key created successfully', 'success');
closeKeyModal();
renderKeysList();
renderKeysDropdown();
}
function renderKeysList() {
const privateContainer = document.getElementById('privateKeysList');
const publicContainer = document.getElementById('publicKeysList');
const signatureContainer = document.getElementById('signatureKeysList');
if (!privateContainer || !publicContainer || !signatureContainer) return;
const signatureKeys = state.keys.filter((key) => key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm));
const cryptoKeys = state.keys.filter((key) => !(key.purpose === 'signature' || isSignatureAlgorithmId(key.algorithm)));
const privateKeys = cryptoKeys.filter(k => k.privateKeyData !== undefined || !k.publicKeyData);
const publicKeys = cryptoKeys.filter(k => k.publicKeyData !== undefined && k.privateKeyData === undefined);
const renderKeyCard = (k) => {
const badgeColor = k.color || (k.purpose === 'signature' ? '#f59e0b' : (k.publicKeyData && !k.privateKeyData ? '#10b981' : '#3b82f6'));
const title = k.name || k.tag;
const tagContent = k.name && k.tag !== k.name ? k.tag : '';
return `
<div onclick="openKeyDetails(${k.id})" class="p-4 bg-gray-50 dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm relative group overflow-hidden cursor-pointer hover:border-brand-500 transition-colors">
<div class="absolute top-0 right-0 p-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
<button onclick="event.stopPropagation(); deleteKey(${k.id})" class="text-red-500 hover:text-red-700 bg-white dark:bg-slate-900 rounded-full w-8 h-8 flex items-center justify-center shadow-md">
<i class="fas fa-trash text-sm"></i>
</button>
</div>
<div class="flex items-center gap-3 mb-3">
<div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style="background-color: ${badgeColor}20; color: ${badgeColor};">
<i class="fas fa-key"></i>
</div>
<div class="overflow-hidden">
<h4 class="font-bold truncate text-gray-900 dark:text-gray-100 flex items-center gap-2">
${escapeHTML(title)}
${tagContent ? `<span class="px-2 py-0.5 rounded-full text-[10px] text-white" style="background-color: ${badgeColor}; opacity: 0.9">${escapeHTML(tagContent)}</span>` : ''}
</h4>
<p class="text-xs text-gray-500 font-mono">${escapeHTML(k.algorithm)}</p>
</div>
</div>
${k.description ? `<p class="text-sm text-gray-600 dark:text-gray-400 mt-2 text-ellipsis overflow-hidden whitespace-nowrap" title="${escapeHTML(k.description)}">${escapeHTML(k.description)}</p>` : ''}
<div class="mt-3 text-xs text-gray-400 flex items-center justify-between">
<span>${escapeHTML(k.created)}</span>
</div>
</div>
`};
if (privateKeys.length === 0) {
privateContainer.innerHTML = `
<div class="col-span-full text-center py-8 text-gray-500">
<i class="fas fa-key text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز کلیدی ایجاد نشده' : 'No keys created yet'}</p>
</div>
`;
} else {
privateContainer.innerHTML = privateKeys.map(renderKeyCard).join('');
}
if (publicKeys.length === 0) {
publicContainer.innerHTML = `
<div class="col-span-full text-center py-8 text-gray-500">
<i class="fas fa-key text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز کلید عمومی دریافت نشده' : 'No public keys received yet'}</p>
</div>
`;
} else {
publicContainer.innerHTML = publicKeys.map(renderKeyCard).join('');
}
if (signatureKeys.length === 0) {
signatureContainer.innerHTML = `
<div class="col-span-full text-center py-8 text-gray-500">
<i class="fas fa-signature text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز کلید امضایی ایجاد نشده' : 'No signature keys created yet'}</p>
</div>
`;
} else {
signatureContainer.innerHTML = signatureKeys.map(renderKeyCard).join('');
}
}
function openKeyDetails(id) {
const key = state.keys.find(k => k.id === id);
if (!key) return;
const keyKind = getStoredKeyKind(key);
const publicByteLength = (key.keyMeta && key.keyMeta.publicLengthBytes) || getBase64ByteLengthOrNull(key.publicKeyData) || 0;
const privateByteLength = (key.keyMeta && key.keyMeta.privateLengthBytes) || getBase64ByteLengthOrNull(key.privateKeyData) || 0;
const secretByteLength = (key.keyMeta && key.keyMeta.secretLengthBytes) || getBase64ByteLengthOrNull(key.publicKeyData) || 0;
const algorithmSummary = keyKind === 'secret'
? `${key.algorithm} | ${secretByteLength} bytes`
: `${key.algorithm} | pub ${publicByteLength} B / priv ${privateByteLength} B`;
document.getElementById('detailKeyId').value = id;
document.getElementById('detailKeyTag').value = key.name || key.tag;
document.getElementById('detailKeyColor').value = key.color || (key.publicKeyData && !key.privateKeyData ? '#10b981' : '#3b82f6');
document.getElementById('detailKeyAlgorithm').value = algorithmSummary;
// Generate simulated PEM strings for display/export if not native export
const pubMatch = btoa(unescape(encodeURIComponent(JSON.stringify(key)))).match(/.{1,64}/g);
const pubPem = pubMatch ? `-----BEGIN PUBLIC KEY-----\n${pubMatch.join('\n')}\n-----END PUBLIC KEY-----` : '';
const privMatch = btoa(unescape(encodeURIComponent(key.desc || 'private_placeholder'))).match(/.{1,64}/g);
const privPem = privMatch ? `-----BEGIN PRIVATE KEY-----\n${privMatch.join('\n')}\n-----END PRIVATE KEY-----` : '';
document.getElementById('detailPublicKey').value = key.publicKeyData || pubPem;
document.getElementById('detailPrivateKey').value = key.privateKeyData || privPem;
const publicKeyLabel = document.getElementById('detailPublicKeyLabel');
const privateKeyLabel = document.getElementById('detailPrivateKeyLabel');
if (publicKeyLabel) publicKeyLabel.textContent = getKeyDisplayLabel(key);
if (privateKeyLabel) privateKeyLabel.textContent = getPrivateKeyDisplayLabel(key);
const privContainer = document.getElementById('detailPrivateKeyContainer');
if (keyKind === 'secret' || (key.publicKeyData && !key.privateKeyData)) {
privContainer.classList.add('hidden');
} else {
privContainer.classList.remove('hidden');
}
const downloadBtn = document.getElementById('downloadKeyBtn');
downloadBtn.onclick = () => downloadKeyFile(id);
const downloadPubBtn = document.getElementById('downloadPublicKeyBtn');
if (downloadPubBtn) {
if (key.publicKeyData) {
downloadPubBtn.classList.remove('hidden');
downloadPubBtn.onclick = () => downloadSpecificKey(id, 'public');
} else {
downloadPubBtn.classList.add('hidden');
}
}
const downloadPrivBtn = document.getElementById('downloadPrivateKeyBtn');
if (downloadPrivBtn) {
if (key.privateKeyData) {
downloadPrivBtn.classList.remove('hidden');
downloadPrivBtn.onclick = () => downloadSpecificKey(id, 'private');
} else {
downloadPrivBtn.classList.add('hidden');
}
}
const modal = document.getElementById('keyDetailsModal');
modal.classList.remove('hidden');
modal.classList.add('flex');
}
function saveKeyDetailsEdit() {
const id = parseInt(document.getElementById('detailKeyId').value, 10);
const newTag = document.getElementById('detailKeyTag').value.trim();
const newColor = document.getElementById('detailKeyColor').value;
if (!newTag) {
showNotification(state.language === 'fa' ? 'لطفا تگ را وارد کنید' : 'Please enter a tag', 'warning');
return;
}
const keyIndex = state.keys.findIndex(k => k.id === id);
if (keyIndex !== -1) {
state.keys[keyIndex].tag = newTag;
state.keys[keyIndex].name = newTag;
state.keys[keyIndex].color = newColor;
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
renderKeysList();
renderKeysDropdown();
showNotification(state.language === 'fa' ? 'تغییرات با موفقیت ذخیره شد' : 'Changes saved successfully', 'success');
}
}
function closeKeyDetailsModal() {
const modal = document.getElementById('keyDetailsModal');
modal.classList.add('hidden');
modal.classList.remove('flex');
}
function downloadSpecificKey(id, type) {
const key = state.keys.find(k => k.id === id);
if (!key) return;
let exportKey = { ...key };
if (type === 'public') {
delete exportKey.privateKeyData;
} else if (type === 'private') {
delete exportKey.publicKeyData;
}
const blob = new Blob([JSON.stringify(exportKey, null, 2)], { type: 'application/json' });
triggerDownload(blob, `${key.tag}_${type}.json`);
}
async function downloadKeyFile(id) {
const key = state.keys.find(k => k.id === id);
if (!key) return;
const format = document.getElementById('downloadKeyFormat').value;
if (format === 'json') {
const blob = new Blob([JSON.stringify(key, null, 2)], { type: 'application/json' });
triggerDownload(blob, `${key.tag}.json`);
} else if (format === 'both') {
const zip = new window.JSZip();
// Full key
zip.file(`${key.tag}_keys.json`, JSON.stringify(key, null, 2));
// Public key only
if (key.publicKeyData) {
let pubKey = { ...key };
delete pubKey.privateKeyData;
zip.file(`${key.tag}_public.json`, JSON.stringify(pubKey, null, 2));
}
// Private key only
if (key.privateKeyData) {
let privKey = { ...key };
delete privKey.publicKeyData;
zip.file(`${key.tag}_private.json`, JSON.stringify(privKey, null, 2));
}
const content = await zip.generateAsync({ type: 'blob' });
triggerDownload(content, `${key.tag}_keys.zip`);
}
}
function triggerDownload(blob, filename) {
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = filename;
a.click();
URL.revokeObjectURL(a.href);
}
function openImportKeyModal() {
document.getElementById('importKeyModal').classList.remove('hidden');
document.getElementById('importKeyModal').classList.add('flex');
document.getElementById('importKeyTag').value = '';
document.getElementById('importKeyData').value = '';
}
function closeImportKeyModal() {
document.getElementById('importKeyModal').classList.add('hidden');
document.getElementById('importKeyModal').classList.remove('flex');
}
function handleImportKeyFile(event) {
const file = event.target.files[0];
if (!file) return;
const reader = new FileReader();
reader.onload = function(e) {
const content = e.target.result;
document.getElementById('importKeyData').value = content;
// Auto-fill tag if empty
const tagInput = document.getElementById('importKeyTag');
if (!tagInput.value) {
tagInput.value = file.name.split('.')[0];
}
};
reader.readAsText(file);
}
function importPublicKey() {
const tag = document.getElementById('importKeyTag').value;
const name = document.getElementById('importKeyName').value;
const color = document.getElementById('importKeyColor').value;
const data = document.getElementById('importKeyData').value.trim();
if (!tag || !data) {
showNotification(state.language === 'fa' ? 'لطفا تگ و کلید را وارد کنید' : 'Please enter tag and key data', 'warning');
return;
}
let newKey = {
id: Date.now(),
tag: tag,
name: name || tag,
color: color || '#3b82f6',
desc: 'Imported Key',
algorithm: 'Unknown',
created: new Date().toLocaleDateString()
};
// Enforce JSON format
try {
const parsedData = JSON.parse(data);
if (parsedData.algorithm) {
newKey.algorithm = parsedData.algorithm;
}
if (parsedData.publicKeyData) {
newKey.publicKeyData = parsedData.publicKeyData;
}
if (parsedData.privateKeyData) {
newKey.privateKeyData = parsedData.privateKeyData;
}
if (parsedData.keyMeta) {
newKey.keyMeta = parsedData.keyMeta;
}
// If JSON only has publicKeyData and no privateKeyData, make sure it is considered a public key
if (parsedData.publicKeyData && !parsedData.privateKeyData) {
newKey.privateKeyData = undefined;
newKey.algorithm = parsedData.algorithm || 'Imported Public Key';
}
// If it's just a raw JSON string of a key
if (!parsedData.publicKeyData && !parsedData.privateKeyData) {
newKey.privateKeyData = data;
newKey.algorithm = 'Imported JSON';
}
// If it's a full key object with name/tag/color
if (parsedData.tag && !name) newKey.tag = parsedData.tag;
if (parsedData.name && !name) newKey.name = parsedData.name;
if (parsedData.color) newKey.color = parsedData.color;
} catch (e) {
showNotification(state.language === 'fa' ? 'فایل نامعتبر است. فقط فرمت JSON پشتیبانی می‌شود.' : 'Invalid file. Only JSON format is supported.', 'error');
return;
}
state.keys.push(normalizeKeyRecord(newKey));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
showNotification(state.language === 'fa' ? 'کلید با موفقیت وارد شد' : 'Key imported successfully', 'success');
closeImportKeyModal();
renderKeysList();
renderKeysDropdown();
}
async function deleteKey(id) {
if (await PoorijaDialogs.confirm(state.language === 'fa' ? 'آیا از حذف این کلید اطمینان دارید؟' : 'Are you sure you want to delete this key?')) {
state.keys = state.keys.filter(k => k.id !== id);
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
renderKeysList();
renderKeysDropdown();
}
}
function loadKeys() {
const saved = localStorage.getItem('poorija_keys');
if (saved) {
const loadedKeys = decryptStorageData(saved);
if (loadedKeys) {
state.keys = normalizeKeyCollection(loadedKeys);
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
}
if (document.getElementById('content-keys') && !document.getElementById('content-keys').classList.contains('hidden')) {
renderKeysList();
}
}
renderKeysDropdown();
}
function loadSecureNotes() {
const saved = localStorage.getItem(NOTES_STORAGE_KEY);
if (saved) {
const loaded = decryptStorageData(saved);
state.secureNotes = Array.isArray(loaded) ? loaded : [];
if (Array.isArray(loaded)) {
saveSecureNotesStore();
}
} else {
state.secureNotes = [];
}
renderSecureNotes();
}
function saveSecureNotesStore() {
localStorage.setItem(NOTES_STORAGE_KEY, encryptStorageData(state.secureNotes));
}
function newSecureNote() {
document.getElementById('secureNoteId').value = '';
document.getElementById('secureNoteTitle').value = '';
document.getElementById('secureNoteTag').value = '';
document.getElementById('secureNoteBody').value = '';
document.getElementById('secureNoteAttachment').value = '';
// Reset view mode
document.getElementById('noteViewModeBtn').classList.remove('hidden');
document.getElementById('secureNoteEditView').classList.remove('hidden');
document.getElementById('secureNotePreviewView').classList.add('hidden');
const btnText = document.getElementById('noteViewModeText');
if (btnText) {
btnText.setAttribute('data-i18n', 'previewNote');
btnText.textContent = state.language === 'fa' ? 'پیش‌نمایش' : 'Preview';
}
}
function editSecureNote(id) {
const note = state.secureNotes.find((item) => item.id === id);
if (!note) return;
document.getElementById('secureNoteId').value = String(note.id);
document.getElementById('secureNoteTitle').value = note.title || '';
document.getElementById('secureNoteTag').value = note.tag || '';
document.getElementById('secureNoteBody').value = note.body || '';
document.getElementById('secureNoteAttachment').value = note.attachment || '';
// Reset view mode
document.getElementById('noteViewModeBtn').classList.remove('hidden');
document.getElementById('secureNoteEditView').classList.remove('hidden');
document.getElementById('secureNotePreviewView').classList.add('hidden');
const btnText = document.getElementById('noteViewModeText');
if (btnText) {
btnText.setAttribute('data-i18n', 'previewNote');
btnText.textContent = state.language === 'fa' ? 'پیش‌نمایش' : 'Preview';
}
}
function saveSecureNote() {
const id = document.getElementById('secureNoteId').value;
const title = document.getElementById('secureNoteTitle').value.trim();
const tag = document.getElementById('secureNoteTag').value.trim();
const body = document.getElementById('secureNoteBody').value.trim();
const attachment = document.getElementById('secureNoteAttachment').value.trim();
if (!title || !body) {
showNotification(state.language === 'fa' ? 'عنوان و محتوای یادداشت الزامی است' : 'A secure note needs both a title and content', 'warning');
return;
}
const timestamp = new Date().toISOString();
const record = {
id: id ? parseInt(id, 10) : Date.now(),
title,
tag,
body,
attachment,
createdAt: id ? (state.secureNotes.find((item) => item.id === parseInt(id, 10))?.createdAt || timestamp) : timestamp,
updatedAt: timestamp
};
if (id) {
state.secureNotes = state.secureNotes.map((item) => item.id === record.id ? record : item);
} else {
state.secureNotes.unshift(record);
}
saveSecureNotesStore();
document.getElementById('secureNoteId').value = String(record.id);
renderSecureNotes();
renderKeysDropdown();
showNotification(state.language === 'fa' ? 'یادداشت امن ذخیره شد' : 'Secure note saved', 'success');
}
function shareCurrentSecureNote() {
const id = document.getElementById('secureNoteId').value;
if (!id) {
showNotification(state.language === 'fa' ? 'ابتدا یادداشت را ذخیره کنید' : 'Save the note first', 'warning');
return;
}
switchTab('share');
const shareType = document.getElementById('sharePayloadType');
const noteSelect = document.getElementById('shareNoteSelect');
if (shareType) shareType.value = 'note';
toggleSharePayloadType();
if (noteSelect) noteSelect.value = id;
}
async function deleteSecureNote(id) {
if (!await PoorijaDialogs.confirm(state.language === 'fa' ? 'این یادداشت امن حذف شود؟' : 'Delete this secure note?')) return;
state.secureNotes = state.secureNotes.filter((item) => item.id !== id);
saveSecureNotesStore();
renderSecureNotes();
}
function renderSimpleMarkdown(text) {
if (!text) return '';
let html = escapeHTML(text);
// Simple Markdown-ish replacements
// Headers
html = html.replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-4 mb-2">$1</h3>');
html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-5 mb-3 border-b border-gray-200 dark:border-gray-700 pb-1">$1</h2>');
html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-6 mb-4 gradient-text">$1</h1>');
// Bold & Italic
html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
// Code blocks
html = html.replace(/```([\s\S]*?)```/g, '<pre class="bg-gray-100 dark:bg-slate-800 p-3 rounded-lg overflow-x-auto my-3 text-sm font-mono">$1</pre>');
html = html.replace(/`(.*?)`/g, '<code class="bg-gray-100 dark:bg-slate-800 px-1 rounded text-sm font-mono">$1</code>');
// Lists
html = html.replace(/^\s*[-*+]\s+(.*)$/gim, '<li class="list-disc ml-5">$1</li>');
html = html.replace(/(<li>.*<\/li>)/gms, '<ul class="my-3">$1</ul>');
// Line breaks
html = html.replace(/\n/g, '<br>');
return html;
}
function toggleNoteViewMode() {
const editView = document.getElementById('secureNoteEditView');
const previewView = document.getElementById('secureNotePreviewView');
const btnText = document.getElementById('noteViewModeText');
const btnIcon = document.querySelector('#noteViewModeBtn i');
const body = document.getElementById('secureNoteBody').value;
if (editView.classList.contains('hidden')) {
// Switch to Edit
editView.classList.remove('hidden');
previewView.classList.add('hidden');
btnText.setAttribute('data-i18n', 'previewNote');
btnText.textContent = state.language === 'fa' ? 'پیش‌نمایش' : 'Preview';
btnIcon.className = 'fas fa-eye mr-2';
} else {
// Switch to Preview
editView.classList.add('hidden');
previewView.classList.remove('hidden');
document.getElementById('secureNotePreviewContent').innerHTML = renderSimpleMarkdown(body);
btnText.setAttribute('data-i18n', 'editNote');
btnText.textContent = state.language === 'fa' ? 'ویرایش' : 'Edit';
btnIcon.className = 'fas fa-pen mr-2';
}
}
function renderSecureNotes() {
const container = document.getElementById('secureNotesList');
if (!container) return;
if (state.secureNotes.length === 0) {
container.innerHTML = `
<div class="text-center py-8 text-gray-500">
<i class="fas fa-note-sticky text-4xl mb-3 opacity-30"></i>
<p>${state.language === 'fa' ? 'هنوز یادداشت امنی ذخیره نشده' : 'No secure notes saved yet'}</p>
</div>
`;
return;
}
container.innerHTML = state.secureNotes.map((note) => `
<div class="p-4 rounded-xl bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700">
<div class="flex items-start justify-between gap-3">
<div>
<h3 class="font-bold text-gray-900 dark:text-white">${escapeHTML(note.title)}</h3>
<p class="text-xs text-gray-500 mt-1">${escapeHTML(note.tag || (state.language === 'fa' ? 'بدون تگ' : 'No tag'))}</p>
</div>
<div class="flex gap-2">
<button onclick="editSecureNote(${note.id})" class="px-2 py-1 text-xs bg-sky-500/10 text-sky-600 rounded">${state.language === 'fa' ? 'ویرایش' : 'Edit'}</button>
<button onclick="deleteSecureNote(${note.id})" class="px-2 py-1 text-xs bg-red-500/10 text-red-600 rounded">${state.language === 'fa' ? 'حذف' : 'Delete'}</button>
</div>
</div>
<p class="text-sm text-gray-600 dark:text-gray-400 mt-3 line-clamp-3">${escapeHTML(note.body)}</p>
</div>
`).join('');
}
function loadShareHistory() {
try {
state.shareHistory = JSON.parse(localStorage.getItem(SHARE_HISTORY_STORAGE_KEY) || '[]');
} catch (error) {
state.shareHistory = [];
}
}
function saveShareHistory() {
localStorage.setItem(SHARE_HISTORY_STORAGE_KEY, JSON.stringify(state.shareHistory.slice(0, 30)));
}
function loadSignatureHistory() {
try {
state.signatureHistory = JSON.parse(localStorage.getItem(SIGNATURE_HISTORY_STORAGE_KEY) || '[]');
} catch (error) {
state.signatureHistory = [];
}
}
function saveSignatureHistory() {
localStorage.setItem(SIGNATURE_HISTORY_STORAGE_KEY, JSON.stringify(state.signatureHistory.slice(0, 30)));
}
function launchScenario(scenario) {
if (scenario === 'encrypt-self') {
document.getElementById('encAlgorithm').value = 'AES-256-GCM';
document.getElementById('keyMethod').value = 'password';
toggleKeyMethod();
switchTab('encrypt');
} else if (scenario === 'encrypt-share') {
document.getElementById('encAlgorithm').value = 'RSA-OAEP-3072';
document.getElementById('keyMethod').value = 'publicKey';
toggleKeyMethod();
renderKeysDropdown();
switchTab('encrypt');
} else if (scenario === 'share-link') {
switchTab('share');
} else if (scenario === 'sign-verify') {
switchTab('signatures');
} else if (scenario === 'secure-note') {
switchTab('notes');
newSecureNote();
} else if (scenario === 'self-destruct') {
switchTab('selfdestruct');
}
}
function toggleSharePayloadType() {
const type = document.getElementById('sharePayloadType')?.value || 'text';
const algorithm = document.getElementById('shareAlgorithm')?.value || 'AES-256-GCM';
const isRsa = algorithm.startsWith('RSA-OAEP');
document.getElementById('shareTextSection')?.classList.toggle('hidden', type !== 'text');
document.getElementById('shareNoteSection')?.classList.toggle('hidden', type !== 'note');
document.getElementById('shareFileSection')?.classList.toggle('hidden', type !== 'file');
document.getElementById('shareKeySection')?.classList.toggle('hidden', type !== 'public-key');
document.getElementById('shareRecipientSection')?.classList.toggle('hidden', !isRsa);
const passwordField = document.getElementById('sharePassword');
if (passwordField) {
passwordField.disabled = isRsa;
passwordField.classList.toggle('opacity-60', isRsa);
}
}
function syncSecureShareOpenUi() {
const privateKeySection = document.getElementById('secureSharePrivateKeySection');
const passwordField = document.getElementById('secureSharePassword');
if (!privateKeySection || !passwordField) return;
let requiresPrivateKey = false;
try {
const envelope = parseSecureShareInput(document.getElementById('secureShareInput')?.value || '');
requiresPrivateKey = Boolean(envelope && envelope.keyProtection === 'rsa-wrapped');
} catch (error) {
requiresPrivateKey = false;
}
privateKeySection.classList.toggle('hidden', !requiresPrivateKey);
passwordField.disabled = requiresPrivateKey;
passwordField.classList.toggle('opacity-60', requiresPrivateKey);
}
function handleSecureShareFile(event) {
const file = event.target.files?.[0];
state.secureShareFile = file || null;
const label = document.getElementById('shareFileName');
if (label) {
label.textContent = file ? file.name : getTranslatedText('shareFileSelect');
}
}
function fillGeneratedSharePassword() {
document.getElementById('sharePassword').value = generateSecureRandomString(18, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*');
}
async function getSharePayloadObject() {
const type = document.getElementById('sharePayloadType').value;
if (type === 'text') {
const content = document.getElementById('shareTextInput').value.trim();
if (!content) throw new Error(state.language === 'fa' ? 'متن برای اشتراک وارد نشده' : 'No text entered for sharing');
return { type: 'text', content };
}
if (type === 'note') {
const noteId = parseInt(document.getElementById('shareNoteSelect').value, 10);
const note = state.secureNotes.find((item) => item.id === noteId);
if (!note) throw new Error(state.language === 'fa' ? 'یادداشتی انتخاب نشده' : 'No note selected');
return { type: 'note', content: note };
}
if (type === 'file') {
if (!state.secureShareFile) throw new Error(state.language === 'fa' ? 'فایلی انتخاب نشده' : 'No file selected');
const buffer = await readFile(state.secureShareFile);
return {
type: 'file',
name: state.secureShareFile.name,
mime: state.secureShareFile.type || 'application/octet-stream',
content: arrayBufferToBase64(buffer)
};
}
const selectedKey = getSelectedStoredKey('shareKeySelect');
if (!selectedKey || !selectedKey.publicKeyData) {
throw new Error(state.language === 'fa' ? 'کلید عمومی برای اشتراک انتخاب نشده' : 'No public key selected for sharing');
}
return {
type: 'public-key',
content: {
name: selectedKey.name || selectedKey.tag,
algorithm: selectedKey.algorithm,
publicKeyData: selectedKey.publicKeyData
}
};
}
async function encryptSecureShareEnvelope(payload, algorithmId, password, recipientKeyData) {
const plaintext = new TextEncoder().encode(JSON.stringify(payload));
const encryptionPreferences = getSettingsEncryptionPreferences();
if (algorithmId.startsWith('RSA-OAEP')) {
const sessionKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
const iv = generateSecureRandomBytes(12);
const encrypted = await crypto.subtle.encrypt(buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), iv, encryptionPreferences), sessionKey, plaintext);
const publicKey = await importRsaPublicKey(recipientKeyData, algorithmId, ['encrypt', 'wrapKey']);
const wrappedKey = await crypto.subtle.wrapKey('raw', sessionKey, publicKey, buildRsaOaepParams(algorithmId, encryptionPreferences.rsaOaepLabel));
return {
version: 1,
type: 'secure-share',
algorithm: algorithmId,
keyProtection: 'rsa-wrapped',
contentAlgorithm: 'AES-256-GCM',
wrappedKey: arrayBufferToBase64(wrappedKey),
iv: Array.from(iv),
data: arrayBufferToBase64(encrypted),
tagLength: encryptionPreferences.gcmTagLength,
aad: encryptionPreferences.aadContext || undefined,
oaepLabel: encryptionPreferences.rsaOaepLabel || undefined
};
}
if (!password) throw new Error(state.language === 'fa' ? 'رمز عبور اشتراک وارد نشده' : 'No share password entered');
const salt = generateSecureRandomBytes(encryptionPreferences.saltLength);
const iv = generateSecureRandomBytes(12);
const workingKey = await derivePasswordCryptoKey(password, 'AES-256-GCM', salt, ['encrypt'], encryptionPreferences.pbkdf2Iterations, encryptionPreferences.pbkdf2Hash);
const encrypted = await crypto.subtle.encrypt(buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), iv, encryptionPreferences), workingKey, plaintext);
return {
version: 1,
type: 'secure-share',
algorithm: 'AES-256-GCM',
keyProtection: 'password',
iterations: encryptionPreferences.pbkdf2Iterations,
kdfHash: encryptionPreferences.pbkdf2Hash,
salt: Array.from(salt),
iv: Array.from(iv),
data: arrayBufferToBase64(encrypted),
tagLength: encryptionPreferences.gcmTagLength,
aad: encryptionPreferences.aadContext || undefined
};
}
function buildSecureShareUrl(serializedEnvelope) {
const url = new URL(window.location.href);
url.search = '';
url.hash = '';
url.searchParams.set('share', serializedEnvelope);
return url.toString();
}
async function generateSecureShare() {
try {
const payload = await getSharePayloadObject();
const envelopePayload = {
id: `share_${Date.now()}`,
createdAt: Date.now(),
expiresAt: Date.now() + ((parseInt(document.getElementById('shareExpiryHours').value, 10) || 24) * 3600 * 1000),
maxViews: parseInt(document.getElementById('shareMaxViews').value, 10) || 0,
payload
};
const algorithmId = document.getElementById('shareAlgorithm').value;
const recipient = algorithmId.startsWith('RSA-OAEP') ? getSelectedStoredKey('shareRecipientKeySelect') : null;
if (algorithmId.startsWith('RSA-OAEP') && !recipient?.publicKeyData) {
throw new Error(state.language === 'fa' ? 'برای اشتراک RSA باید کلید عمومی گیرنده را انتخاب کنید' : 'Select a recipient public key for RSA sharing');
}
const encryptedEnvelope = await encryptSecureShareEnvelope(
envelopePayload,
algorithmId,
document.getElementById('sharePassword').value.trim(),
recipient?.publicKeyData
);
const serializedEnvelope = arrayBufferToBase64Url(new TextEncoder().encode(JSON.stringify(encryptedEnvelope)));
const output = document.getElementById('secureShareOutput');
const shareUrl = buildSecureShareUrl(serializedEnvelope);
const isLinkFriendly = shareUrl.length <= 1900;
output.value = isLinkFriendly ? shareUrl : JSON.stringify(encryptedEnvelope, null, 2);
state.secureShareBundle = new Blob([output.value], { type: 'text/plain;charset=utf-8' });
state.secureShareBundleName = `${envelopePayload.id}.poorija-share`;
state.shareHistory.unshift({ id: envelopePayload.id, type: payload.type, createdAt: envelopePayload.createdAt, algorithm: algorithmId });
saveShareHistory();
syncSecureShareOpenUi();
showNotification(state.language === 'fa' ? 'خروجی اشتراک امن ساخته شد' : 'Secure share output created', 'success');
} catch (error) {
console.error(error);
showNotification(error.message || (state.language === 'fa' ? 'ساخت اشتراک امن ناموفق بود' : 'Failed to generate secure share'), 'error');
}
}
function copySecureShareOutput() {
const output = document.getElementById('secureShareOutput').value;
if (!output) return;
navigator.clipboard.writeText(output);
showNotification(state.language === 'fa' ? 'خروجی کپی شد' : 'Output copied', 'success');
}
function downloadSecureShareBundle() {
if (!state.secureShareBundle) {
showNotification(state.language === 'fa' ? 'ابتدا خروجی اشتراک را بسازید' : 'Generate a secure share first', 'warning');
return;
}
triggerDownload(state.secureShareBundle, state.secureShareBundleName || 'secure-share.poorija-share');
}
function parseSecureShareInput(rawInput) {
const value = String(rawInput || '').trim();
if (!value) return null;
try {
const parsedUrl = new URL(value);
const shareParam = parsedUrl.searchParams.get('share');
if (shareParam) return JSON.parse(new TextDecoder().decode(base64UrlToArrayBuffer(shareParam)));
} catch (error) {
// Not a URL.
}
try {
return JSON.parse(value);
} catch (error) {
return JSON.parse(new TextDecoder().decode(base64UrlToArrayBuffer(value)));
}
}
async function decryptSecureShareEnvelope(envelope, password, rsaPrivateKeyData) {
const envelopePreferences = getEnvelopeEncryptionPreferences(envelope);
if (envelope.keyProtection === 'rsa-wrapped') {
const privateKey = await importRsaPrivateKey(rsaPrivateKeyData, envelope.algorithm, ['decrypt', 'unwrapKey']);
const sessionKey = await crypto.subtle.unwrapKey(
'raw',
base64ToArrayBuffer(envelope.wrappedKey),
privateKey,
buildRsaOaepParams(envelope.algorithm, envelope.oaepLabel || envelopePreferences.rsaOaepLabel),
{ name: 'AES-GCM', length: 256 },
false,
['decrypt']
);
const decrypted = await crypto.subtle.decrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), new Uint8Array(envelope.iv), envelopePreferences),
sessionKey,
base64ToArrayBuffer(envelope.data)
);
return JSON.parse(new TextDecoder().decode(decrypted));
}
const workingKey = await derivePasswordCryptoKey(
password,
'AES-256-GCM',
new Uint8Array(envelope.salt || []),
['decrypt'],
envelope.iterations || envelopePreferences.pbkdf2Iterations,
envelope.kdfHash || envelopePreferences.pbkdf2Hash
);
const decrypted = await crypto.subtle.decrypt(
buildSymmetricParams(getSymmetricRuntimeInfo('AES-256-GCM'), new Uint8Array(envelope.iv), envelopePreferences),
workingKey,
base64ToArrayBuffer(envelope.data)
);
return JSON.parse(new TextDecoder().decode(decrypted));
}
async function openSecureShare() {
const resultEl = document.getElementById('secureShareOpenResult');
resultEl.classList.add('hidden');
try {
const envelope = parseSecureShareInput(document.getElementById('secureShareInput').value);
syncSecureShareOpenUi();
if (!envelope) throw new Error(state.language === 'fa' ? 'ورودی اشتراک خالی است' : 'Secure share input is empty');
let rsaPrivateKeyData = null;
if (envelope.keyProtection === 'rsa-wrapped') {
const selectedKey = getSelectedStoredKey('secureSharePrivateKeySelect')
|| state.keys.find((key) =>
key.purpose !== 'signature'
&& Boolean(key.privateKeyData)
&& String(key.algorithm || '') === String(envelope.algorithm || '')
)
|| state.keys.find((key) =>
key.purpose !== 'signature'
&& Boolean(key.privateKeyData)
&& String(key.algorithm || '').startsWith('RSA-OAEP')
);
rsaPrivateKeyData = selectedKey?.privateKeyData || '';
if (!rsaPrivateKeyData) {
throw new Error(state.language === 'fa' ? 'برای این باندل باید کلید خصوصی RSA در کتابخانه موجود باشد' : 'An RSA private key is required in the key library for this bundle');
}
}
const payloadWrapper = await decryptSecureShareEnvelope(
envelope,
document.getElementById('secureSharePassword').value.trim(),
rsaPrivateKeyData
);
const viewsKey = `poorija_share_views_${payloadWrapper.id}`;
const currentViews = parseInt(localStorage.getItem(viewsKey) || '0', 10);
if (payloadWrapper.expiresAt && Date.now() > payloadWrapper.expiresAt) {
throw new Error(state.language === 'fa' ? 'این اشتراک منقضی شده است' : 'This secure share has expired');
}
if (payloadWrapper.maxViews > 0 && currentViews >= payloadWrapper.maxViews) {
throw new Error(state.language === 'fa' ? 'این اشتراک به سقف دفعات مشاهده رسیده است' : 'This secure share has reached its view limit');
}
localStorage.setItem(viewsKey, String(currentViews + 1));
const payload = payloadWrapper.payload;
resultEl.className = 'mt-4 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20';
if (payload.type === 'file') {
const blob = new Blob([base64ToArrayBuffer(payload.content)], { type: payload.mime || 'application/octet-stream' });
triggerDownload(blob, payload.name || 'shared-file.bin');
resultEl.textContent = state.language === 'fa' ? 'فایل با موفقیت باز و برای دانلود آماده شد.' : 'The file was decrypted and prepared for download.';
} else {
const printable = payload.type === 'public-key'
? JSON.stringify(payload.content, null, 2)
: payload.type === 'note'
? JSON.stringify(payload.content, null, 2)
: payload.content;
resultEl.innerHTML = `<pre class="whitespace-pre-wrap break-words font-mono text-sm">${escapeHTML(String(printable))}</pre>`;
}
resultEl.classList.remove('hidden');
showNotification(state.language === 'fa' ? 'اشتراک امن باز شد' : 'Secure share opened', 'success');
} catch (error) {
console.error(error);
resultEl.className = 'mt-4 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300';
resultEl.textContent = error.message || (state.language === 'fa' ? 'باز کردن اشتراک امن ناموفق بود' : 'Failed to open secure share');
resultEl.classList.remove('hidden');
}
}
function buildSignatureImportParams(config) {
if (config.id.startsWith('RSA-PSS')) {
return { name: 'RSA-PSS', hash: 'SHA-256' };
}
return { name: 'ECDSA', namedCurve: config.generateParams.namedCurve };
}
async function generateSignatureKeyPair() {
const algorithmId = document.getElementById('signatureKeyAlgorithm').value;
const config = getSignatureConfig(algorithmId);
try {
const keyPair = await crypto.subtle.generateKey(config.generateParams, true, config.usages);
const publicKeyData = arrayBufferToBase64(await crypto.subtle.exportKey(config.publicFormat, keyPair.publicKey));
const privateKeyData = arrayBufferToBase64(await crypto.subtle.exportKey(config.privateFormat, keyPair.privateKey));
state.keys.unshift(normalizeKeyRecord({
id: Date.now(),
purpose: 'signature',
tag: `${config.displayName} ${new Date().toLocaleDateString()}`,
name: `${config.displayName} ${new Date().toLocaleDateString()}`,
color: '#f59e0b',
algorithm: algorithmId,
description: 'Digital signature key pair',
publicKeyData,
privateKeyData,
created: new Date().toLocaleDateString()
}));
localStorage.setItem('poorija_keys', encryptStorageData(state.keys));
renderKeysList();
renderKeysDropdown();
showNotification(state.language === 'fa' ? 'کلید امضای دیجیتال ساخته شد' : 'Digital signature key created', 'success');
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'ساخت کلید امضایی ناموفق بود' : 'Failed to create signature key', 'error');
}
}
function toggleSignatureMode() {
const isFile = document.getElementById('signatureMode')?.value === 'file';
document.getElementById('signTextSection')?.classList.toggle('hidden', isFile);
document.getElementById('signFileSection')?.classList.toggle('hidden', !isFile);
}
function toggleVerifySignatureMode() {
const isFile = document.getElementById('verifySignatureMode')?.value === 'file';
document.getElementById('verifyTextSection')?.classList.toggle('hidden', isFile);
document.getElementById('verifyFileSection')?.classList.toggle('hidden', !isFile);
}
function handleSignatureFile(event) {
const file = event.target.files?.[0];
state.signatureSourceFile = file || null;
document.getElementById('signatureFileName').textContent = file ? file.name : getTranslatedText('signatureFileSelect');
}
function handleVerifySignatureFile(event) {
const file = event.target.files?.[0];
state.verifySignatureSourceFile = file || null;
document.getElementById('verifySignatureFileName').textContent = file ? file.name : getTranslatedText('signatureVerifyFileSelect');
}
async function getSignatureSourceBytes(mode, fieldId, fileStateKey) {
if (mode === 'file') {
const file = state[fileStateKey];
if (!file) throw new Error(state.language === 'fa' ? 'فایلی انتخاب نشده' : 'No file selected');
return new Uint8Array(await readFile(file));
}
return new TextEncoder().encode(document.getElementById(fieldId).value);
}
async function signSelectedContent() {
try {
const selectedKey = getSelectedStoredKey('signingKeySelect');
if (!selectedKey || !selectedKey.privateKeyData) throw new Error(state.language === 'fa' ? 'کلید امضایی معتبر انتخاب نشده' : 'No valid signing key selected');
const config = getSignatureConfig(selectedKey.algorithm);
const sourceMode = document.getElementById('signatureMode').value;
const sourceBytes = await getSignatureSourceBytes(sourceMode, 'signatureTextInput', 'signatureSourceFile');
const privateKey = await crypto.subtle.importKey(config.privateFormat, base64ToArrayBuffer(selectedKey.privateKeyData), buildSignatureImportParams(config), false, ['sign']);
const signature = await crypto.subtle.sign(config.signParams, privateKey, sourceBytes);
const bundle = {
version: 1,
type: 'signature-bundle',
algorithm: selectedKey.algorithm,
keyId: selectedKey.id,
keyName: selectedKey.name || selectedKey.tag,
mode: sourceMode,
signature: arrayBufferToBase64(signature),
dataHash: uint8ArrayToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', sourceBytes.buffer)))
};
if (sourceMode === 'file' && state.signatureSourceFile) {
bundle.fileName = state.signatureSourceFile.name;
}
document.getElementById('signatureOutput').value = JSON.stringify(bundle, null, 2);
state.signatureHistory.unshift({ id: Date.now(), algorithm: selectedKey.algorithm, mode: sourceMode, createdAt: new Date().toISOString() });
saveSignatureHistory();
showNotification(state.language === 'fa' ? 'امضا ساخته شد' : 'Signature created', 'success');
} catch (error) {
console.error(error);
showNotification(error.message || (state.language === 'fa' ? 'ساخت امضا ناموفق بود' : 'Failed to create signature'), 'error');
}
}
async function verifySelectedSignature() {
const resultEl = document.getElementById('signatureVerifyResult');
try {
const selectedKey = getSelectedStoredKey('verifyKeySelect');
if (!selectedKey || !selectedKey.publicKeyData) throw new Error(state.language === 'fa' ? 'کلید راستی‌آزمایی معتبر انتخاب نشده' : 'No valid verification key selected');
const bundle = JSON.parse(document.getElementById('verifySignatureInput').value);
const config = getSignatureConfig(selectedKey.algorithm);
const sourceMode = document.getElementById('verifySignatureMode').value;
const sourceBytes = await getSignatureSourceBytes(sourceMode, 'verifySignatureTextInput', 'verifySignatureSourceFile');
const publicKey = await crypto.subtle.importKey(config.publicFormat, base64ToArrayBuffer(selectedKey.publicKeyData), buildSignatureImportParams(config), false, ['verify']);
const verified = await crypto.subtle.verify(config.verifyParams, publicKey, base64ToArrayBuffer(bundle.signature), sourceBytes);
resultEl.className = `p-4 rounded-xl border ${verified ? 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`;
resultEl.textContent = verified
? (state.language === 'fa' ? 'امضا معتبر است و محتوا دست‌نخورده مانده است.' : 'The signature is valid and the content is intact.')
: (state.language === 'fa' ? 'امضا معتبر نیست یا محتوا تغییر کرده است.' : 'The signature is invalid or the content was changed.');
resultEl.classList.remove('hidden');
} catch (error) {
console.error(error);
resultEl.className = 'p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300';
resultEl.textContent = error.message || (state.language === 'fa' ? 'راستی‌آزمایی امضا ناموفق بود' : 'Failed to verify signature');
resultEl.classList.remove('hidden');
}
}
function renderSecurityCenter() {
const summary = document.getElementById('securityCenterSummary');
const list = document.getElementById('securityCenterList');
if (!summary || !list) return;
const weakPasswords = state.generatedPasswords.filter((item) => evaluatePasswordStrengthScore(item.password) < 4).length;
const duplicatePasswords = new Set(state.generatedPasswords.map((item) => item.password)).size !== state.generatedPasswords.length;
const legacyKeys = state.keys.filter((key) => key.migratedFromAlgorithm || key.algorithm === 'RSA-OAEP').length;
const backupTimestamp = localStorage.getItem('poorija_last_backup_at');
const backupAgeHours = backupTimestamp ? Math.round((Date.now() - new Date(backupTimestamp).getTime()) / 3600000) : null;
const passkeyReady = isDesktopAppRuntime()
? Boolean(state.desktopAuth.enabled)
: Boolean(getPasskeyRecord());
const items = [
{
status: passkeyReady ? 'good' : 'warn',
title: state.language === 'fa' ? 'Passkey Quick Unlock' : 'Passkey Quick Unlock',
desc: passkeyReady
? (state.language === 'fa' ? 'برای بازکردن سریع روی این دستگاه فعال است.' : 'Enabled for quick unlock on this device.')
: (state.language === 'fa' ? 'هنوز فعال نشده؛ برای ورود سریع‌تر و مقاوم‌تر در برابر فیشینگ ارزش فعال‌سازی دارد.' : 'Not enabled yet; worth enabling for faster, phishing-resistant unlock.'),
action: 'settings'
},
{
status: state.twoFA.enabled ? 'good' : 'critical',
title: state.language === 'fa' ? 'تأیید دو مرحله‌ای' : 'Two-factor authentication',
desc: state.twoFA.enabled
? (state.language === 'fa' ? 'برای حساب برنامه فعال است.' : 'Enabled for the app account.')
: (state.language === 'fa' ? 'فعال نیست و بهتر است از بخش تنظیمات روشن شود.' : 'Disabled and should be enabled from Settings.'),
action: 'settings'
},
{
status: evaluatePasswordStrengthScore(state.masterPassword || '') === 4 ? 'good' : 'warn',
title: state.language === 'fa' ? 'قدرت رمز مستر' : 'Master password strength',
desc: evaluatePasswordStrengthScore(state.masterPassword || '') === 4
? (state.language === 'fa' ? 'رمز عبور فعلی قوی ارزیابی می‌شود.' : 'The current password scores as strong.')
: (state.language === 'fa' ? 'رمز عبور فعلی می‌تواند قوی‌تر باشد.' : 'The current password could be stronger.'),
action: 'settings'
},
{
status: backupAgeHours !== null && backupAgeHours <= 168 ? 'good' : 'warn',
title: state.language === 'fa' ? 'وضعیت بکاپ' : 'Backup status',
desc: backupAgeHours === null
? (state.language === 'fa' ? 'هیچ بکاپ اخیری ثبت نشده است.' : 'No recent backup is recorded.')
: (state.language === 'fa' ? `آخرین بکاپ حدود ${backupAgeHours} ساعت پیش بوده است.` : `Last backup was about ${backupAgeHours} hours ago.`),
action: 'migration'
},
{
status: weakPasswords === 0 && !duplicatePasswords ? 'good' : 'warn',
title: state.language === 'fa' ? 'بهداشت رمزهای ذخیره‌شده' : 'Stored password hygiene',
desc: weakPasswords === 0 && !duplicatePasswords
? (state.language === 'fa' ? 'رمزهای ذخیره‌شده مورد ضعیف یا تکراری ندارند.' : 'No weak or duplicate generated passwords were found.')
: (state.language === 'fa' ? `موارد ضعیف: ${weakPasswords} | تکراری: ${duplicatePasswords ? 'بله' : 'خیر'}` : `Weak: ${weakPasswords} | Duplicates: ${duplicatePasswords ? 'Yes' : 'No'}`),
action: 'passwords'
},
{
status: legacyKeys === 0 ? 'good' : 'warn',
title: state.language === 'fa' ? 'کلیدها و سازگاری قدیمی' : 'Keys and legacy compatibility',
desc: legacyKeys === 0
? (state.language === 'fa' ? 'کلید legacy مشکل‌داری دیده نشد.' : 'No problematic legacy key records were found.')
: (state.language === 'fa' ? `${legacyKeys} کلید یا رکورد نیازمند بازبینی وجود دارد.` : `${legacyKeys} key records may need review.`),
action: 'keys'
}
];
const goodCount = items.filter((item) => item.status === 'good').length;
const warnCount = items.filter((item) => item.status === 'warn').length;
const criticalCount = items.filter((item) => item.status === 'critical').length;
summary.innerHTML = [
{ label: state.language === 'fa' ? 'خوب' : 'Good', value: goodCount, classes: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20' },
{ label: state.language === 'fa' ? 'نیازمند توجه' : 'Needs attention', value: warnCount, classes: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' },
{ label: state.language === 'fa' ? 'بحرانی' : 'Critical', value: criticalCount, classes: 'text-red-600 bg-red-50 dark:bg-red-900/20' }
].map((card) => `
<div class="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 ${card.classes}">
<div class="text-sm opacity-80">${card.label}</div>
<div class="text-3xl font-bold mt-2">${card.value}</div>
</div>
`).join('');
list.innerHTML = items.map((item) => `
<div class="p-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-slate-800/80">
<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
<div>
<div class="flex items-center gap-3 mb-2">
<span class="w-3 h-3 rounded-full ${item.status === 'good' ? 'bg-emerald-500' : item.status === 'critical' ? 'bg-red-500' : 'bg-amber-500'}"></span>
<h3 class="font-bold text-gray-900 dark:text-white">${escapeHTML(item.title)}</h3>
</div>
<p class="text-sm text-gray-600 dark:text-gray-400">${escapeHTML(item.desc)}</p>
</div>
<button onclick="switchTab('${item.action}')" class="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors whitespace-nowrap">
${state.language === 'fa' ? 'باز کردن بخش مرتبط' : 'Open related area'}
</button>
</div>
</div>
`).join('');
}
// ==================== Security Questions Logic ====================
const securityQuestionsDB = {
fa: [
"نام اولین مدرسه شما چه بود؟",
"نام حیوان خانگی مورد علاقه شما چیست؟",
"در چه شهری متولد شدید؟",
"نام بهترین دوست دوران کودکی شما چیست؟",
"مدل اولین ماشین شما چه بود؟",
"غذای مورد علاقه شما در کودکی چه بود؟",
"نام خیابانی که در آن بزرگ شدید چیست؟",
"نام اولین معلم شما چه بود؟",
"لقب شما در دوران کودکی چه بود؟",
"تیم ورزشی مورد علاقه شما چیست؟"
],
en: [
"What was the name of your first school?",
"What is your favorite pet's name?",
"In what city were you born?",
"What is your childhood best friend's name?",
"What was the model of your first car?",
"What was your favorite childhood food?",
"What is the name of the street you grew up on?",
"What was your first teacher's name?",
"What was your childhood nickname?",
"What is your favorite sports team?"
]
};
function getLocalizedQuestions() {
return securityQuestionsDB[state.language] || securityQuestionsDB['fa'];
}
function getSecurityQuestionSelects(selectIds) {
return selectIds.map((id) => document.getElementById(id));
}
function populateSecurityQuestionSelectGroup(selectIds, presetValues = []) {
const qs = getLocalizedQuestions();
const selects = getSecurityQuestionSelects(selectIds);
if (selects.some((select) => !select)) return;
selects.forEach((select, index) => {
let optionsHtml = `<option value="">${state.language === 'fa' ? '-- انتخاب سوال --' : '-- Select Question --'}</option>`;
qs.forEach((q, i) => {
optionsHtml += `<option value="${i}">${q}</option>`;
});
select.innerHTML = optionsHtml;
if (presetValues[index] !== undefined && presetValues[index] !== null && presetValues[index] !== '') {
select.value = String(presetValues[index]);
}
});
}
function updateSecurityQuestionSelectGroup(selectIds, { updateSetupState = false } = {}) {
const selects = getSecurityQuestionSelects(selectIds);
if (selects.some((select) => !select)) return;
const qs = getLocalizedQuestions();
const normalizedSelections = selects.map((select) => select.value || '');
const seen = new Set();
normalizedSelections.forEach((value, index) => {
if (!value) return;
if (seen.has(value)) {
normalizedSelections[index] = '';
return;
}
seen.add(value);
});
selects.forEach((select, index) => {
const currentValue = normalizedSelections[index];
const blockedValues = new Set(
normalizedSelections.filter((value, valueIndex) => value && valueIndex !== index)
);
let optionsHtml = `<option value="">${state.language === 'fa' ? '-- انتخاب سوال --' : '-- Select Question --'}</option>`;
qs.forEach((question, questionIndex) => {
const optionValue = String(questionIndex);
if (blockedValues.has(optionValue)) return;
optionsHtml += `<option value="${optionValue}">${question}</option>`;
});
select.innerHTML = optionsHtml;
select.value = currentValue;
});
if (updateSetupState) {
updateSetupButtonState();
}
}
window.initSecQuestionsUI = function() {
populateSecurityQuestionSelectGroup(['secQ1', 'secQ2', 'secQ3']);
updateSecurityQuestionSelectGroup(['secQ1', 'secQ2', 'secQ3'], { updateSetupState: true });
const settingsSection = document.getElementById('changeSecurityQuestionsSection');
if (settingsSection && !settingsSection.classList.contains('hidden')) {
const currentSelections = ['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3']
.map((id) => document.getElementById(id)?.value || '');
populateSecurityQuestionSelectGroup(['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3'], currentSelections);
updateSecurityQuestionSelectGroup(['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3']);
}
};
window.updateSecQuestions = function() {
updateSecurityQuestionSelectGroup(['secQ1', 'secQ2', 'secQ3'], { updateSetupState: true });
};
window.updateSettingsSecurityQuestions = function() {
updateSecurityQuestionSelectGroup(['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3']);
};
async function hashAnswer(answer) {
return sha256Base64(answer.trim().toLowerCase());
}
function showChangeSecurityQuestions() {
const section = document.getElementById('changeSecurityQuestionsSection');
if (!section) return;
section.classList.toggle('hidden');
if (!section.classList.contains('hidden')) {
const sqData = JSON.parse(localStorage.getItem('poorija_sq') || 'null');
const presetValues = sqData ? [sqData.q1, sqData.q2, sqData.q3] : [];
populateSecurityQuestionSelectGroup(['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3'], presetValues);
updateSecurityQuestionSelectGroup(['settingsSecQ1', 'settingsSecQ2', 'settingsSecQ3']);
['settingsSecurityPassword', 'settingsSecA1', 'settingsSecA2', 'settingsSecA3'].forEach((id) => {
const input = document.getElementById(id);
if (input) input.value = '';
});
}
}
async function changeSecurityQuestions() {
const currentPassword = document.getElementById('settingsSecurityPassword')?.value || '';
const q1 = document.getElementById('settingsSecQ1')?.value || '';
const q2 = document.getElementById('settingsSecQ2')?.value || '';
const q3 = document.getElementById('settingsSecQ3')?.value || '';
const a1 = document.getElementById('settingsSecA1')?.value || '';
const a2 = document.getElementById('settingsSecA2')?.value || '';
const a3 = document.getElementById('settingsSecA3')?.value || '';
if (!await verifyMasterPassword(currentPassword)) {
showNotification(state.language === 'fa' ? 'رمز فعلی اشتباه است' : 'Current password is incorrect', 'error');
return;
}
if (!q1 || !q2 || !q3 || !a1 || !a2 || !a3) {
showNotification(state.language === 'fa' ? 'لطفاً هر سه سوال و پاسخ را کامل کنید' : 'Please complete all three questions and answers', 'error');
return;
}
const nextQuestions = [q1, q2, q3];
if (new Set(nextQuestions).size !== nextQuestions.length) {
showNotification(state.language === 'fa' ? 'هر سوال باید یکتا باشد' : 'Each question must be unique', 'error');
return;
}
const sqData = {
q1: parseInt(q1, 10), a1: await hashAnswer(a1),
q2: parseInt(q2, 10), a2: await hashAnswer(a2),
q3: parseInt(q3, 10), a3: await hashAnswer(a3)
};
localStorage.setItem('poorija_sq', JSON.stringify(sqData));
localStorage.removeItem('poorija_sq_failed');
showNotification(state.language === 'fa' ? 'سوالات امنیتی به‌روزرسانی شدند' : 'Security questions updated', 'success');
document.getElementById('changeSecurityQuestionsSection')?.classList.add('hidden');
}
window.showResetPassword = function() {
const sqData = JSON.parse(localStorage.getItem('poorija_sq') || 'null');
if (!sqData) {
showNotification(state.language === 'fa' ? 'سوالات امنیتی تنظیم نشده‌اند!' : 'Security questions not set!', 'error');
return;
}
document.getElementById('loginMainSection').classList.add('hidden');
document.getElementById('resetSection').classList.remove('hidden');
const questions = getLocalizedQuestions();
const q1Text = questions[sqData.q1];
const q2Text = questions[sqData.q2];
const q3Text = questions[sqData.q3];
document.getElementById('resetQ1Text').textContent = q1Text || '';
document.getElementById('resetQ2Text').textContent = q2Text || '';
document.getElementById('resetQ3Text').textContent = q3Text || '';
// Clear previous inputs
document.getElementById('resetA1').value = '';
document.getElementById('resetA2').value = '';
document.getElementById('resetA3').value = '';
document.getElementById('resetNewPassword').value = '';
document.getElementById('resetConfirmPassword').value = '';
document.getElementById('resetNewPasswordSection').classList.add('hidden');
document.getElementById('setNewResetPasswordBtn').classList.add('hidden');
document.getElementById('verifyResetBtn').classList.remove('hidden');
syncLockScreenLayout();
};
window.hideResetPassword = function() {
document.getElementById('resetSection').classList.add('hidden');
document.getElementById('loginMainSection').classList.remove('hidden');
syncLockScreenLayout();
};
window.verifySecurityQuestions = async function() {
const sqData = JSON.parse(localStorage.getItem('poorija_sq') || 'null');
if (!sqData) return;
const a1 = document.getElementById('resetA1').value;
const a2 = document.getElementById('resetA2').value;
const a3 = document.getElementById('resetA3').value;
if (!a1 || !a2 || !a3) {
showNotification(state.language === 'fa' ? 'لطفاً تمام فیلدها را پر کنید' : 'Please fill all fields', 'error');
return;
}
const h1 = await hashAnswer(a1);
const h2 = await hashAnswer(a2);
const h3 = await hashAnswer(a3);
if (h1 === sqData.a1 && h2 === sqData.a2 && h3 === sqData.a3) {
// Success, clear failures
localStorage.removeItem('poorija_sq_failed');
localStorage.removeItem('poorija_failed_logins');
localStorage.removeItem('poorija_lock_until');
showNotification(state.language === 'fa' ? 'پاسخ‌ها تایید شد. رمز عبور جدید را وارد کنید' : 'Answers verified. Enter new password', 'success');
document.getElementById('verifyResetBtn').classList.add('hidden');
document.getElementById('resetNewPasswordSection').classList.remove('hidden');
document.getElementById('setNewResetPasswordBtn').classList.remove('hidden');
// Disable inputs to prevent changes after verification
document.getElementById('resetA1').disabled = true;
document.getElementById('resetA2').disabled = true;
document.getElementById('resetA3').disabled = true;
} else {
let fails = parseInt(localStorage.getItem('poorija_sq_failed') || '0');
fails++;
if (fails >= 3) {
showNotification(state.language === 'fa' ? 'داده‌ها به دلیل 3 بار اشتباه پاک شدند!' : 'Data wiped due to 3 wrong attempts!', 'error');
localStorage.clear();
setTimeout(() => window.location.reload(), 2000);
return;
}
localStorage.setItem('poorija_sq_failed', fails.toString());
showNotification(state.language === 'fa' ? `پاسخ‌ها نادرست است! (${fails}/3)` : `Incorrect answers! (${fails}/3)`, 'error');
}
};
window.setNewMasterPasswordFromReset = async function() {
const newPass = document.getElementById('resetNewPassword').value;
const confirmPass = document.getElementById('resetConfirmPassword').value;
if (!newPass) {
showNotification(state.language === 'fa' ? 'رمز عبور نمی‌تواند خالی باشد' : 'Password cannot be empty', 'error');
return;
}
if (newPass !== confirmPass) {
showNotification(state.language === 'fa' ? 'رمز عبور و تکرار آن یکسان نیستند' : 'Passwords do not match', 'error');
return;
}
await writeMasterPasswordRecord(newPass);
state.masterPassword = newPass;
await refreshStoredPasskeyUnlockSecret();
showNotification(state.language === 'fa' ? 'رمز عبور با موفقیت تغییر کرد!' : 'Password changed successfully!', 'success');
// Re-enable inputs for future
document.getElementById('resetA1').disabled = false;
document.getElementById('resetA2').disabled = false;
document.getElementById('resetA3').disabled = false;
// Hide reset UI, unlock app
hideResetPassword();
unlockUI();
};
// --- Virtual Keyboard Logic ---
let vkShift = false;
const vkKeysLower = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./'.split('');
const vkKeysUpper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./'.split('');
window.currentVkTargetId = 'unlockPassword';
window.toggleVirtualKeyboard = function(inputId) {
const vkContainer = document.getElementById('virtualKeyboardContainer');
// If switching between inputs while keyboard is open, stay open
if (inputId && window.currentVkTargetId !== inputId && !vkContainer.classList.contains('hidden')) {
window.currentVkTargetId = inputId;
renderVirtualKeyboard();
return;
}
if (inputId) {
window.currentVkTargetId = inputId;
}
if (vkContainer.classList.contains('hidden')) {
vkContainer.classList.remove('hidden');
renderVirtualKeyboard();
} else {
vkContainer.classList.add('hidden');
}
};
window.toggleKeyboardShift = function() {
vkShift = !vkShift;
document.getElementById('vkShiftBtn').classList.toggle('bg-brand-500');
document.getElementById('vkShiftBtn').classList.toggle('text-white');
renderVirtualKeyboard();
};
window.clearKeyboardInput = function() {
const el = document.getElementById(window.currentVkTargetId);
if (el) {
el.value = '';
el.dispatchEvent(new Event('input', { bubbles: true }));
}
};
window.backspaceKeyboardInput = function() {
const el = document.getElementById(window.currentVkTargetId);
if (el && el.value.length > 0) {
el.value = el.value.slice(0, -1);
el.dispatchEvent(new Event('input', { bubbles: true }));
}
};
function renderVirtualKeyboard() {
const container = document.getElementById('virtualKeyboard');
container.innerHTML = '';
// Shuffle keys
const keys = vkShift ? [...vkKeysUpper] : [...vkKeysLower];
for (let i = keys.length - 1; i > 0; i--) {
const randomValues = new Uint32Array(1);
window.crypto.getRandomValues(randomValues);
const j = randomValues[0] % (i + 1);
[keys[i], keys[j]] = [keys[j], keys[i]];
}
keys.forEach(key => {
const btn = document.createElement('button');
btn.textContent = key;
btn.className = 'py-3 px-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white text-lg font-mono transition-colors shadow-sm';
btn.onclick = (e) => {
e.preventDefault();
const el = document.getElementById(window.currentVkTargetId);
if (el) {
el.value += key;
el.dispatchEvent(new Event('input', { bubbles: true }));
}
};
container.appendChild(btn);
});
}

/* The in-app keyboard is a fixed panel, and a fixed panel takes no space.
 *
 * On a phone it is roughly half the screen, and every field it exists to type
 * into is vertically centred in what it does not know is a shrinking box: the
 * shared section gate centres inside calc(100dvh - 12rem), the lock screen
 * centres its card in the viewport. So the keyboard opened directly on top of
 * the password field. Typing still worked — the keys write into the field
 * either way — but the field, the dots, and its eye and keyboard buttons were
 * all behind the panel, in the PWA and in the native mobile shell alike.
 *
 * Two halves, and both are needed. The measurement publishes how much of the
 * viewport bottom the panel actually occupies (--vk-inset), which the
 * stylesheet spends on shortening the centring boxes and padding the
 * scrollports; that alone keeps the field above the keyboard in the ordinary
 * case. The scroll is the correction for the rest: a field low in a long form,
 * a rotation that changes both heights at once, a keyboard that grew a row
 * when Shift was pressed.
 *
 * It observes the panel rather than hooking toggleVirtualKeyboard, because the
 * panel is opened and hidden from a dozen places — the section gate, the
 * dialogs, the lock path, its own Close key — and an observer cannot be the
 * one call site somebody forgot. */
function measureVirtualKeyboardInset() {
const container = document.getElementById('virtualKeyboardContainer');
if (!container || container.classList.contains('hidden')) return 0;
const box = container.getBoundingClientRect();
if (!box.height) return 0;
/* What the panel costs is everything from its top edge down to the viewport
   bottom, which includes the gap it floats above. */
return Math.max(0, Math.round(window.innerHeight - box.top));
}
function nudgeScrollableAncestor(element, amount) {
let node = element.parentElement;
let remaining = amount;
while (node && node !== document.documentElement && remaining > 0.5) {
const style = getComputedStyle(node);
if (/(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight - node.clientHeight > 1) {
const before = node.scrollTop;
node.scrollTop = before + remaining;
remaining -= node.scrollTop - before;
}
node = node.parentElement;
}
if (remaining > 0.5) window.scrollBy(0, remaining);
}
function revealVirtualKeyboardTarget() {
const container = document.getElementById('virtualKeyboardContainer');
if (!container || container.classList.contains('hidden')) return;
const target = document.getElementById(window.currentVkTargetId);
if (!target || target.offsetWidth + target.offsetHeight === 0) return;
const ceiling = container.getBoundingClientRect().top - 8;
let box = target.getBoundingClientRect();
if (box.bottom <= ceiling && box.top >= 8) return;
try { target.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (_error) { target.scrollIntoView(); }
box = target.getBoundingClientRect();
if (box.bottom > ceiling) nudgeScrollableAncestor(target, box.bottom - ceiling);
}
function syncVirtualKeyboardInset() {
const root = document.documentElement;
const inset = measureVirtualKeyboardInset();
root.classList.toggle('vk-open', inset > 0);
root.style.setProperty('--vk-inset', inset + 'px');
if (inset > 0) requestAnimationFrame(revealVirtualKeyboardTarget);
}
window.syncVirtualKeyboardInset = syncVirtualKeyboardInset;
(function watchVirtualKeyboardInset() {
const start = () => {
const container = document.getElementById('virtualKeyboardContainer');
if (!container) return;
new MutationObserver(syncVirtualKeyboardInset).observe(container, { attributes: true, attributeFilter: ['class', 'style'] });
if (typeof ResizeObserver === 'function') new ResizeObserver(syncVirtualKeyboardInset).observe(container);
addEventListener('resize', syncVirtualKeyboardInset);
addEventListener('orientationchange', syncVirtualKeyboardInset);
/* Some mobile webviews move the visual viewport for the OS keyboard without
   firing a window resize. */
window.visualViewport?.addEventListener('resize', syncVirtualKeyboardInset);
syncVirtualKeyboardInset();
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
// --- Panic Button Logic ---
/* =====================================================================
   Emergency wipe
   ---------------------------------------------------------------------
   Both the biohazard button and the panic password end here, and they end
   at the same place: nothing of this install survives it.

   What "nothing" has to mean, because the two earlier versions of this each
   covered a different half and neither covered the rest:
     - the relay's copy: queued envelopes and the push subscription, asked for
       over the socket that owns them, and waited on rather than fired blindly
     - the browser's push subscription, so the device stops being reachable
     - localStorage AND sessionStorage
     - every IndexedDB database, which is where the media vault lives — the
       panic path cleared these and the button path did not
     - every Cache Storage entry and the service worker itself, so a reload
       cannot come back with the old app or its cached data
     - the keys and messages held in memory by the chat module, blanked rather
       than left for the reload to maybe collect
   Then the page reloads into first-run: no identity, no master password, no
   history, nothing to unlock.
   ===================================================================== */
let appDataWipeInProgress = false;
let desktopVaultWritePending = null;
const appWipeChannel = (() => {
  try { return typeof BroadcastChannel === 'function' ? new BroadcastChannel('poorija-data-wipe') : null; }
  catch (_) { return null; } // Some embedded/private runtimes disable this API.
})();
appWipeChannel?.addEventListener('message', event => {
  if (event.data !== 'erase-local-app-data' || appDataWipeInProgress) return;
  state.activeProfile = null;
  state.masterPassword = null;
  emergencyWipe({ purgeRelay: false, broadcast: false }).finally(() => window.location.replace(window.location.pathname));
});
async function emergencyWipe({ purgeRelay = true, broadcast = true } = {}) {
  appDataWipeInProgress = true;
  if (broadcast) appWipeChannel?.postMessage('erase-local-app-data');
  clearTimeout(desktopVaultSnapshotTimer);
  desktopVaultSnapshotTimer = null;
  const fa = state.language === 'fa';
  const report = { relay: null, idb: 0, caches: 0, workers: 0, push: false };
  try {
    showNotification(fa ? 'در حال پاک‌سازی کامل...' : 'Wiping everything...', 'error');
  } catch (error) { /* the UI may already be gone */ }

  /* 1. The relay first: it is the only copy this device cannot reach later. */
  try {
    if (window.PoorijaChat?.emergencyWipe) {
      report.relay = await window.PoorijaChat.emergencyWipe({ purgeRelay });
    }
  } catch (error) { console.warn('[Wipe] chat purge failed:', error); }

  /* 2. Stop this device being reachable by push. */
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager?.getSubscription?.();
      if (subscription) { await subscription.unsubscribe().catch(() => {}); report.push = true; }
    }
  } catch (error) { /* nothing subscribed */ }

  /* 3. In-memory: the master key and everything derived from it. */
  try {
    state.masterKey = null;
    state.encryptionKey = null;
    state.currentFile = null;
    state.isLocked = true;
    if (state.settings) state.settings.push = { enabled: false, ttlDays: 30, asked: false };
  } catch (error) { /* state may be partially built */ }

  /* Native app-owned vault copies and the keychain quick-unlock secret.
     External exports and the user's ~/.ssh are not app-owned storage. */
  if (desktopShellApi()) {
    try {
      await desktopVaultWritePending?.catch(() => {});
      const files = await invokeDesktopCommand('desktop_list_app_files');
      await Promise.all((files || []).map(file => invokeDesktopCommand('desktop_delete_app_file', { name: file.name })));
    } catch (error) { console.warn('[Wipe] native vault files:', error); report.nativeVaultError = String(error); }
    try { await invokeDesktopCommand('desktop_clear_quick_unlock'); }
    catch (error) { console.warn('[Wipe] native credentials:', error); report.nativeAuthError = String(error); }
  }

  /* 4. Both web storages. */
  try { localStorage.clear(); } catch (error) { /* blocked */ }
  try { sessionStorage.clear(); } catch (error) { /* blocked */ }

  /* 5. IndexedDB, where the media vault and any queued blobs live. */
  try {
    if (window.indexedDB) {
      const dbs = indexedDB.databases ? await indexedDB.databases() : [];
      const names = new Set(['poorija-media', 'poorija-stickers', 'poorija-chat-appearance', ...(dbs || []).map(db => db.name).filter(Boolean)]);
      await Promise.all([...names].map(name => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        const timer = setTimeout(() => reject(new Error('Database deletion blocked: ' + name)), 5000);
        request.onsuccess = () => { clearTimeout(timer); report.idb += 1; resolve(); };
        request.onerror = () => { clearTimeout(timer); reject(request.error); };
        // onblocked is not success: other tabs receive the wipe broadcast and close handles.
      })));
    }
  } catch (error) { console.warn('[Wipe] IndexedDB:', error); }

  /* 6. The caches, then the worker that holds them. */
  try {
    if (window.caches?.keys) {
      const names = await caches.keys();
      await Promise.all(names.map((name) => caches.delete(name)));
      report.caches = names.length;
    }
  } catch (error) { console.warn('[Wipe] caches:', error); }
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister().catch(() => false)));
      report.workers = registrations.length;
    }
  } catch (error) { console.warn('[Wipe] service worker:', error); }

  console.warn('[Wipe] emergency wipe complete:', JSON.stringify(report));
  window.__lastWipeReport = report;
  return report;
}
window.emergencyWipe = emergencyWipe;

window.wipeAllData = function(isPanic = false) {
  /* Drop the open profile first so the storage redirection stops pointing at a
     namespace mid-wipe, then let emergencyWipe clear everything underneath. */
  state.activeProfile = null;
  state.masterPassword = null;
  /* Both doors, one wipe. The reload is what lands the user on first-run, and
     it waits for the wipe rather than racing it — the old version reloaded on
     a one-second timer whether or not anything had finished. */
  emergencyWipe({ purgeRelay: true })
    .catch((error) => console.error('[Wipe] failed:', error))
    .finally(() => { window.location.replace(window.location.pathname); });
};
/* The Danger Zone's "reset everything" button.
 *
 * An audit found its onclick calling a function that did not exist anywhere in
 * the project: pressing it raised a ReferenceError and did nothing at all.
 * That is the worst possible failure for this particular control — somebody
 * who wants their data gone presses it, sees no error, and is entitled to
 * believe it worked.
 *
 * It does what its label promises by going through emergencyWipe, the same
 * path the lock screen's button and the panic password use, so there is one
 * implementation of "erase everything" rather than three.
 *
 * Two confirmations, because it is not undoable and the second one cannot be
 * hit by accident: the first is a yes/no, the second requires typing a word. */
window.resetAppSettings = async function resetAppSettings() {
  const fa = state.language === 'fa';
  const dialogs = window.PoorijaDialogs;
  const word = fa ? 'پاک' : 'ERASE';

  /* No window.confirm/window.prompt fallback, deliberately. The native shell
     cannot display either — window.confirm returns false without showing
     anything, which is the entire reason js/dialogs.js exists — so a fallback
     would silently do nothing on the desktop build. That is exactly the bug
     this function was written to fix, and the native suite caught it here.
     If the dialog module is missing, refusing to erase is the right failure. */
  if (!dialogs) {
    showNotification(fa ? 'پنجرهٔ تأیید در دسترس نیست؛ چیزی پاک نشد.'
      : 'The confirmation dialog is unavailable; nothing was erased.', 'error');
    return;
  }

  const first = await dialogs.confirm(fa
    ? 'همه چیز پاک می‌شود: کلیدها، رمزها، یادداشت‌ها، گفتگوها، فایل‌ها و تنظیمات. این کار برگشت‌پذیر نیست.'
    : 'Everything will be erased: keys, passwords, notes, conversations, files and settings. This cannot be undone.',
    { tone: 'danger', okLabel: fa ? 'ادامه' : 'Continue' });
  if (!first) return;

  const typed = await dialogs.prompt(fa
    ? `برای تأیید، کلمهٔ «${word}» را بنویسید.`
    : `Type "${word}" to confirm.`, { tone: 'danger' });
  if (String(typed || '').trim().toUpperCase() !== word.toUpperCase()) {
    showNotification(fa ? 'پاک‌سازی انجام نشد.' : 'Nothing was erased.', 'info');
    return;
  }

  /* Drop the open profile first so the storage redirection stops pointing at a
     namespace mid-wipe — the same order wipeAllData uses. */
  state.activeProfile = null;
  state.masterPassword = null;
  try {
    await emergencyWipe({ purgeRelay: true });
  } catch (error) {
    console.error('[Reset] failed:', error);
  } finally {
    window.location.replace(window.location.pathname);
  }
};

let lastEscPressTime = 0;
window.triggerPanic = function() {
wipeAllData(true);
};
document.addEventListener('keydown', (e) => {
if (e.key === 'Escape') {
const currentTime = new Date().getTime();
// If pressed twice within 500ms
if (currentTime - lastEscPressTime < 500) {
triggerPanic();
}
lastEscPressTime = currentTime;
}
});
window.PoorijaApp = {
  metadataSettings,
state,
/* The three pieces a lock needs to ask this device "is it still you".
   Exported rather than reimplemented: the biometric path differs by runtime —
   the desktop shell has no WebAuthn and answers through its own bridge, and the
   browser needs the registered credential id because the passkey is not
   discoverable. A second copy of that logic in the chat module got both halves
   wrong and simply never opened anything. */
isDesktopAppRuntime,
/* The phone shells are Tauri runtimes too, so isDesktopAppRuntime alone
   cannot tell them apart from a laptop -- and they answer biometrics
   through a different mechanism than either the desktop or the browser. */
isNativeMobileShell,
/* The update check compares against this from its own file, and had no way
   to read it: it is a module-scope const here, so the checker fell back to
   "0.0.0" and every release on earth looked newer. The dialog printed the
   real number because it is written in this file and could see it, which is
   how a build told people 2.35.0 was an update over 2.35.0. */
APP_VERSION_SEMVER,
APP_BUILD_TAG,
invokeDesktopCommand,
getPasskeyRecord,
/* The ceremony's shape, not just its ingredients: the relying-party id the
   credential was created under, the allowCredentials entry with the registered
   transports, and the watchdog for engines that finish the fingerprint and
   never settle the promise. Exported so the conversation locks assert exactly
   as the app does — every past copy of this logic got some part of it wrong
   and failed silently. */
getExplicitPasskeyRpId,
passkeyAllowList,
webauthnWithWatchdog,
base64UrlToArrayBuffer,
translations,
getTranslatedText,
showNotification,
encryptStorageData,
decryptStorageData,
escapeHTML,
formatBytes,
generateSecureRandomBytes,
arrayBufferToBase64,
base64ToArrayBuffer,
triggerDownload,
switchTab,
normalizeKeyRecord,
registerWebPushSubscription
};
// Export for testing
if (typeof module !== 'undefined' && module.exports) {
module.exports = {
parseChunkSize
};
}

window.addEventListener('poorija:tab-switched', (event) => {
if (event.detail && event.detail.tabName === 'settings') renderMobileTabBarSettings();
});
window.addEventListener('poorija:unlock', () => { renderMobileTabBar(); renderMobileTabBarSettings(); });
document.addEventListener('DOMContentLoaded', () => renderMobileTabBar());

/* ============================================================
   Layout diagnostics — open the app with ?layoutdebug in the URL
   to see the live viewport/safe-area/header numbers on the real
   device (persisted via sessionStorage so it survives the PWA
   relaunch without the query string).
   ============================================================ */
(function initLayoutDebug() {
try {
if (/[?&]layoutdebug/.test(location.search)) {
try { sessionStorage.setItem('poorija-layout-debug', '1'); } catch (e) {}
}
let enabled = false;
try { enabled = sessionStorage.getItem('poorija-layout-debug') === '1'; } catch (e) {}
if (!enabled) return;
const style = document.createElement('style');
style.textContent = '#layoutDebugOverlay{position:fixed;bottom:8px;left:8px;z-index:2147483000;background:rgba(0,0,0,.88);color:#4ade80;font:11px/1.45 ui-monospace,monospace;padding:8px 10px;border-radius:8px;direction:ltr;max-width:72vw;pointer-events:auto;white-space:pre;border:1px solid #166534;cursor:pointer}';
document.head.appendChild(style);
const el = document.createElement('div');
el.id = 'layoutDebugOverlay';
el.title = 'tap to dismiss';
el.addEventListener('click', () => { try { sessionStorage.removeItem('poorija-layout-debug'); } catch (e) {} el.remove(); });
document.body.appendChild(el);
const px = (v) => String(Math.round(parseFloat(v) || 0));
const tick = () => {
if (!document.body.contains(el)) return;
const html = document.documentElement;
const header = document.getElementById('appHeader');
const wrap = header ? header.querySelector('.max-w-full') : null;
const row = header ? header.querySelector('.max-w-full > .flex') : null;
const cs = (node, prop) => (node ? getComputedStyle(node)[prop] : '-');
el.textContent = [
'ver ' + APP_VERSION_SEMVER,
'inner ' + innerWidth + 'x' + innerHeight + ' dpr ' + (window.devicePixelRatio || 1),
'vv ' + Math.round((window.visualViewport && window.visualViewport.height) || 0) + ' scale ' + (window.visualViewport && window.visualViewport.scale || 1),
'safe T/B/L/R ' + html.style.getPropertyValue('--pwa-safe-top') + '/' + html.style.getPropertyValue('--pwa-safe-bottom') + '/' + html.style.getPropertyValue('--pwa-safe-left') + '/' + html.style.getPropertyValue('--pwa-safe-right'),
'cls ' + html.className,
'hdrPad ' + cs(header, 'paddingTop') + ' wrapPad ' + cs(wrap, 'paddingTop') + ' wrapMinH ' + cs(wrap, 'minHeight'),
'rowTop ' + (row ? Math.round(row.getBoundingClientRect().top) : '-') + ' hdrH ' + (header ? Math.round(header.getBoundingClientRect().height) : '-'),
'bodyPadT/B ' + cs(document.body, 'paddingTop') + '/' + cs(document.body, 'paddingBottom'),
].join('\n');
};
tick();
setInterval(tick, 1000);
window.addEventListener('resize', tick);
} catch (error) { console.warn('layoutdebug failed', error); }
})();

/* ============================================================
   Native desktop shell — background behaviour and the on-system vault
   ------------------------------------------------------------
   Four things the browser build cannot do, all of them driven from the
   Settings tab and all of them no-ops outside the native runtime:

     1. Closing the window hides it instead of quitting, so the relay
        connection survives and messages still arrive.
     2. The app can register itself with the OS login items.
     3. The whole vault is written to disk as one Argon2id-sealed file,
        so the "internal database" exists on the system as well as
        inside the webview's storage.
     4. The Dock / launcher badge is set through Rust, because
        navigator.setAppBadge does nothing in WKWebView or WebKitGTK.

   Nothing here talks to a server. The only bytes that leave this file go
   to the local filesystem, already encrypted.
   ============================================================ */
const DESKTOP_VAULT_FILE = 'vault-snapshot.poorija-backup';
const DESKTOP_VAULT_DEBOUNCE_MS = 20000;

state.desktopShell = {
    loaded: false,
    closeBehavior: 'tray',
    startMinimized: false,
    autostart: false,
    vaultDir: '',
    vaultSavedAt: Number(localStorage.getItem('poorija_desktop_vault_saved_at') || 0) || 0,
    vaultBytes: Number(localStorage.getItem('poorija_desktop_vault_bytes') || 0) || 0,
    vaultBusy: false,
    vaultError: ''
};

let desktopVaultSnapshotTimer = null;

function desktopShellApi() {
    return window.PoorijaDesktop?.available ? window.PoorijaDesktop : null;
}

function formatDesktopTimestamp(value) {
    if (!value) return '';
    try {
        return new Date(value).toLocaleString(state.language === 'fa' ? 'fa-IR' : 'en-GB');
    } catch (error) {
        return new Date(value).toISOString();
    }
}

/* ---------- shell settings ---------- */

async function refreshDesktopShellSettings() {
    const api = desktopShellApi();
    if (!api) {
        syncDesktopShellUi();
        return;
    }
    try {
        const [settings, info] = await Promise.all([
            api.getShellSettings(),
            api.platformInfo().catch(() => null)
        ]);
        state.desktopShell = {
            ...state.desktopShell,
            loaded: true,
            closeBehavior: settings?.closeBehavior === 'quit' ? 'quit' : 'tray',
            startMinimized: Boolean(settings?.startMinimized),
            autostart: Boolean(settings?.autostart),
            vaultDir: info?.vaultDir || '',
            trayAvailable: info ? info.tray !== false : true,
            os: info?.os || ''
        };
    } catch (error) {
        console.error(error);
    }
    syncDesktopShellUi();
}

async function persistDesktopShellSettings(patch) {
    const api = desktopShellApi();
    if (!api) return;
    const next = {
        closeBehavior: state.desktopShell.closeBehavior,
        startMinimized: state.desktopShell.startMinimized,
        autostart: state.desktopShell.autostart,
        ...patch
    };
    try {
        const applied = await api.setShellSettings(next);
        state.desktopShell = {
            ...state.desktopShell,
            closeBehavior: applied?.closeBehavior === 'quit' ? 'quit' : 'tray',
            startMinimized: Boolean(applied?.startMinimized),
            autostart: Boolean(applied?.autostart)
        };
    } catch (error) {
        console.error(error);
        showNotification(String(error?.message || error), 'error');
        // The OS refused the change (a locked-down login-items policy, most
        // likely); re-read rather than leaving the toggle lying about it.
        await refreshDesktopShellSettings();
        return;
    }
    syncDesktopShellUi();
}

function handleDesktopKeepRunningChange() {
    const toggle = document.getElementById('desktopKeepRunningToggle');
    if (!toggle) return;
    persistDesktopShellSettings({ closeBehavior: toggle.checked ? 'tray' : 'quit' });
}

function handleDesktopStartMinimizedChange() {
    const toggle = document.getElementById('desktopStartMinimizedToggle');
    if (!toggle) return;
    persistDesktopShellSettings({ startMinimized: toggle.checked });
}

function handleDesktopAutostartChange() {
    const toggle = document.getElementById('desktopAutostartToggle');
    if (!toggle) return;
    persistDesktopShellSettings({ autostart: toggle.checked });
}

function syncDesktopShellUi() {
    const card = document.getElementById('desktopShellCard');
    const isDesktop = Boolean(desktopShellApi());
    if (card) card.classList.toggle('hidden', !isDesktop);
    if (!isDesktop) return;

    /* "Keep running" means a tray icon on desktop and a foreground service on
       Android — same setting, different mechanism, and only the desktop one can
       be missing. Treating a phone as a tray-less desktop would grey out the
       toggle on exactly the platform that needs it most. */
    const isMobile = state.desktopShell.os === 'android' || state.desktopShell.os === 'ios';
    const trayMissing = state.desktopShell.loaded && !isMobile
        && state.desktopShell.trayAvailable === false;
    const keepRunningHint = document.getElementById('desktopKeepRunningHintText');
    if (keepRunningHint) {
        keepRunningHint.textContent = getTranslatedText(
            isMobile ? 'mobileKeepRunningHint' : (trayMissing ? 'desktopNoTray' : 'desktopKeepRunningHint')
        );
    }
    /* Login items and "start hidden" are desktop ideas; Android decides for
       itself what runs at boot and there is no window to start hidden. */
    ['desktopAutostartToggle', 'desktopStartMinimizedToggle'].forEach((id) => {
        const row = document.getElementById(id)?.closest('.desktop-shell-row');
        row?.classList.toggle('hidden', isMobile);
        row?.nextElementSibling?.classList?.toggle('hidden', isMobile);
    });
    const keepRunning = document.getElementById('desktopKeepRunningToggle');
    const startMinimized = document.getElementById('desktopStartMinimizedToggle');
    const autostart = document.getElementById('desktopAutostartToggle');
    if (keepRunning) {
        // Without a tray there is no way back to a hidden window, so the shell
        // quits on close no matter what this says. Do not offer the choice.
        keepRunning.checked = !trayMissing && state.desktopShell.closeBehavior !== 'quit';
        keepRunning.disabled = trayMissing;
        keepRunning.closest('.desktop-shell-row')?.classList.toggle('opacity-50', trayMissing);
    }
    if (autostart) autostart.checked = state.desktopShell.autostart;
    if (startMinimized) {
        startMinimized.checked = state.desktopShell.startMinimized;
        // Starting hidden is meaningless without a launch-at-login entry to
        // start hidden *from*.
        startMinimized.disabled = !state.desktopShell.autostart;
        startMinimized.closest('.desktop-shell-row')?.classList.toggle('opacity-50', !state.desktopShell.autostart);
    }
    syncDesktopVaultUi();
}

/* ---------- the on-system encrypted vault copy ---------- */

function syncDesktopVaultUi() {
    const toggle = document.getElementById('desktopVaultSyncToggle');
    const status = document.getElementById('desktopVaultStatus');
    const pathLabel = document.getElementById('desktopVaultPath');
    if (toggle) toggle.checked = state.settings.desktopVaultSync !== false;
    if (pathLabel) {
        pathLabel.textContent = state.desktopShell.vaultDir
            ? `${state.desktopShell.vaultDir}/${DESKTOP_VAULT_FILE}`
            : '—';
    }
    if (!status) return;
    if (state.desktopShell.vaultBusy) {
        status.textContent = getTranslatedText('desktopVaultSaving');
        return;
    }
    if (state.desktopShell.vaultError) {
        status.textContent = state.desktopShell.vaultError;
        return;
    }
    if (!state.desktopShell.vaultSavedAt) {
        status.textContent = getTranslatedText('desktopVaultNever');
        return;
    }
    status.textContent = `${formatDesktopTimestamp(state.desktopShell.vaultSavedAt)} — ${formatBytes(state.desktopShell.vaultBytes)}`;
}

function handleDesktopVaultSyncChange() {
    const toggle = document.getElementById('desktopVaultSyncToggle');
    if (!toggle) return;
    state.settings.desktopVaultSync = toggle.checked;
    saveSettings();
    if (toggle.checked) scheduleDesktopVaultSnapshot('enabled');
    syncDesktopVaultUi();
}

/* Rebuilding the snapshot means re-reading every attachment out of
   IndexedDB and running Argon2id, so it is debounced hard and never runs
   on a keystroke. */
function scheduleDesktopVaultSnapshot(reason = 'change') {
    if (appDataWipeInProgress) return;
    if (!desktopShellApi()) return;
    if (state.settings.desktopVaultSync === false) return;
    if (desktopVaultSnapshotTimer) clearTimeout(desktopVaultSnapshotTimer);
    desktopVaultSnapshotTimer = setTimeout(() => {
        desktopVaultSnapshotTimer = null;
        writeDesktopVaultSnapshot(reason).catch((error) => console.error(error));
    }, DESKTOP_VAULT_DEBOUNCE_MS);
}

async function writeDesktopVaultSnapshot(reason = 'manual') {
    if (appDataWipeInProgress) return { ok: false, reason: 'wiping' };
    const api = desktopShellApi();
    if (!api) return { ok: false, reason: 'not-desktop' };
    if (state.settings.desktopVaultSync === false) return { ok: false, reason: 'disabled' };
    if (state.desktopShell.vaultBusy) return { ok: false, reason: 'busy' };
    if (!state.masterPassword) {
        state.desktopShell.vaultError = getTranslatedText('desktopVaultLocked');
        syncDesktopVaultUi();
        return { ok: false, reason: 'locked' };
    }
    const backup = window.PoorijaVaultBackup;
    if (!backup?.createBackup) return { ok: false, reason: 'unavailable' };

    state.desktopShell.vaultBusy = true;
    state.desktopShell.vaultError = '';
    syncDesktopVaultUi();
    try {
        // Same format and same Argon2id parameters as the manual export, so
        // the on-disk copy can be restored by the normal restore flow.
        const { file } = await backup.createBackup(state.masterPassword, () => {});
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (appDataWipeInProgress) return { ok: false, reason: 'wiping' };
        desktopVaultWritePending = api.writeVaultFile(DESKTOP_VAULT_FILE, bytes);
        await desktopVaultWritePending;
        desktopVaultWritePending = null;
        if (appDataWipeInProgress) return { ok: false, reason: 'wiping' };
        state.desktopShell.vaultSavedAt = Date.now();
        state.desktopShell.vaultBytes = bytes.length;
        localStorage.setItem('poorija_desktop_vault_saved_at', String(state.desktopShell.vaultSavedAt));
        localStorage.setItem('poorija_desktop_vault_bytes', String(bytes.length));
        return { ok: true, bytes: bytes.length, reason };
    } catch (error) {
        console.error(error);
        state.desktopShell.vaultError = `${getTranslatedText('desktopVaultFailed')} ${String(error?.message || error)}`;
        return { ok: false, reason: 'error', error };
    } finally {
        state.desktopShell.vaultBusy = false;
        syncDesktopVaultUi();
    }
}

async function saveDesktopVaultSnapshotNow() {
    if (desktopVaultSnapshotTimer) {
        clearTimeout(desktopVaultSnapshotTimer);
        desktopVaultSnapshotTimer = null;
    }
    const result = await writeDesktopVaultSnapshot('manual');
    if (result.ok) {
        showNotification(
            state.language === 'fa'
                ? `نسخهٔ رمزشدهٔ خزانه روی دیسک نوشته شد (${formatBytes(result.bytes)}).`
                : `Encrypted vault copy written to disk (${formatBytes(result.bytes)}).`,
            'success'
        );
    } else if (result.reason === 'locked') {
        showNotification(getTranslatedText('desktopVaultLocked'), 'warning');
    }
}

async function deleteDesktopVaultSnapshot() {
    const api = desktopShellApi();
    if (!api) return;
    const question = state.language === 'fa'
        ? 'نسخهٔ رمزشدهٔ خزانه روی دیسک با بازنویسی امن حذف شود؟ داده‌های داخل برنامه دست‌نخورده می‌مانند.'
        : 'Securely overwrite and remove the on-disk encrypted vault copy? The in-app data is untouched.';
    if (!await PoorijaDialogs.confirm(question)) return;
    try {
        await api.deleteVaultFile(DESKTOP_VAULT_FILE);
        state.desktopShell.vaultSavedAt = 0;
        state.desktopShell.vaultBytes = 0;
        state.desktopShell.vaultError = '';
        localStorage.removeItem('poorija_desktop_vault_saved_at');
        localStorage.removeItem('poorija_desktop_vault_bytes');
        showNotification(getTranslatedText('desktopVaultDeleted'), 'success');
    } catch (error) {
        console.error(error);
        showNotification(String(error?.message || error), 'error');
    }
    syncDesktopVaultUi();
}

/* ---------- wiring ---------- */

function initializeDesktopShell() {
    if (!desktopShellApi()) {
        syncDesktopShellUi();
        return;
    }
    refreshDesktopShellSettings();

    /* Ask once, at startup, rather than the first time a message arrives:
       a permission sheet that appears during an incoming call is the worst
       possible moment for it. */
    if (state.settings.notifications) {
        ensureDesktopNotificationPermission(true).catch((error) => console.error(error));
    }

    window.addEventListener('poorija:unlock', () => {
        // The first snapshot after unlocking is the one that matters — it is
        // the only point where the master password is certain to be in memory.
        scheduleDesktopVaultSnapshot('unlock');
        syncDesktopShellUi();
    });
    window.addEventListener('poorija:vault-changed', () => scheduleDesktopVaultSnapshot('vault-changed'));

    /* Hiding the window is the normal way this app "closes", so it is the
       last reliable moment to flush. beforeunload does not fire when the
       window is merely hidden. */
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        if (!state.masterPassword) return;
        if (desktopVaultSnapshotTimer) {
            clearTimeout(desktopVaultSnapshotTimer);
            desktopVaultSnapshotTimer = null;
            writeDesktopVaultSnapshot('hidden').catch((error) => console.error(error));
        }
    });
}

document.addEventListener('DOMContentLoaded', initializeDesktopShell);
window.addEventListener('poorija:tab-switched', (event) => {
    if (event.detail?.tabName === 'settings') syncDesktopShellUi();
});
