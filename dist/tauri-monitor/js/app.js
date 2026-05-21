const APP_VERSION = '2.99';
const APP_VERSION_SEMVER = '2.99.0';
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
viewLicense: 'مشاهده لایسنس GPL v3.0',
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
showNotifications: 'نمایش اعلانات',
desktopNotificationsUnsupported: 'اعلانات سیستمی در این نسخه دسکتاپ در دسترس نیست.',
desktopNotificationsPrompt: 'برای دریافت اعلان‌های سیستمی، این گزینه را روشن کنید تا برنامه از سیستم اجازه بگیرد.',
desktopNotificationsGranted: 'اعلان‌های سیستمی مجاز هستند و در صورت روشن بودن این گزینه نمایش داده می‌شوند.',
desktopNotificationsDenied: 'دسترسی اعلان‌های سیستمی رد شده است. برای فعال‌سازی دوباره باید از تنظیمات سیستم اجازه بدهید.',
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
desktopIconProfileHint: 'در دسکتاپ، این گزینه آیکون runtime برنامه را به‌روزرسانی می‌کند؛ آیکون فایل نصب همچنان مربوط به بسته‌ی build شده است.',
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
about: 'درباره ما',
githubProfile: 'پروفایل گیت‌هاب',
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
textEncHelp: 'این بخش متن را به‌صورت زنده با Web Crypto و الگوریتم انتخاب‌شده رمزنگاری می‌کند؛ مسیرهای legacy فقط برای سازگاری با داده‌های قدیمی از CryptoJS استفاده می‌شوند.',
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
gplLicense: 'تحت لایسنس GPL v3.0',
gplLicenseNote: 'برنامه تحت لیسانس GPL v3.0 می‌باشد.',
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
deleteConversation: 'حذف گفتگو',
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
voiceMessage: 'پیام صوتی',
chatPlaceholder: 'پیام امن شما…',
selfDestructMessage: 'پیام خودتخریب',
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
screenShare: 'اشتراک صفحه',
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
viewLicense: 'View GPL v3.0 license',
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
showNotifications: 'Show Notifications',
desktopNotificationsUnsupported: 'System notifications are unavailable in this desktop build.',
desktopNotificationsPrompt: 'Turn this on to let the app request system-notification permission from the OS.',
desktopNotificationsGranted: 'System notifications are allowed and will be shown while this setting stays enabled.',
desktopNotificationsDenied: 'System-notification permission was denied. Re-enable it from the operating system settings to use desktop alerts again.',
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
desktopIconProfileHint: 'On desktop this updates the runtime app icon; the installer/package icon still comes from the built bundle.',
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
about: 'About Us',
githubProfile: 'GitHub Profile',
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
textEncHelp: 'This section encrypts text live with Web Crypto and the selected algorithm; legacy-only fallbacks still use CryptoJS for older payloads.',
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
gplLicense: 'Licensed under GPL v3.0',
gplLicenseNote: 'This application is licensed under GPL v3.0.',
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
deleteConversation: 'Delete conversation',
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
voiceMessage: 'Voice message',
chatPlaceholder: 'Your secure message...',
selfDestructMessage: 'Self-destruct message',
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
screenShare: 'Screen share',
end: 'End',
pwaWarningTitle: 'Attention',
pwaWarningContent: 'Warning:\nDue to the nature of this application, all encryption and decryption of texts and files, as well as the creation and processing of Peer-to-Peer chat sessions, are performed entirely client-side. Therefore, it is highly recommended to use the Desktop PWA version or native versions suitable for your operating system. This decision has been made due to the security nature and sensitivity of maintaining information confidentiality.\nRegarding mobile devices, especially older ones, there is a possibility of issues such as overheating, rapid battery drain, and occasional responsiveness delays. This warning serves as an acceptance of these risks when using the application on mobile devices.'
}
};
function getTranslatedText(key, fallback = '') {
return translations[state.language]?.[key] || fallback || key;
}
const PASSKEY_STORAGE_KEY = 'poorija_passkey_quick_unlock';
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
{ id: 'textencrypt', labelKey: 'textEncryption' },
{ id: 'selfdestruct', labelKey: 'selfDestruct' },
{ id: 'stego', labelKey: 'steganography' },
{ id: 'passwords', labelKey: 'passwords' },
{ id: 'wizard', labelKey: 'smartWizard' },
{ id: 'securitycenter', labelKey: 'securityCenter' },
{ id: 'share', labelKey: 'secureShare' },
{ id: 'chat', labelKey: 'secureChat' },
{ id: 'notes', labelKey: 'secureNotes' },
{ id: 'signatures', labelKey: 'digitalSignatures' },
{ id: 'keys', labelKey: 'keyManagement' },
{ id: 'shredder', labelKey: 'fileShredder' },
{ id: 'hash', labelKey: 'hashChecker' },
{ id: 'migration', labelKey: 'migration' },
{ id: 'settings', labelKey: 'settings' },
{ id: 'help', labelKey: 'help' },
{ id: 'about', labelKey: 'about' }
];
function getDefaultTabOrder() {
return SIDEBAR_TAB_DEFINITIONS.map((tab) => tab.id);
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
function isMobileBrowserContext() {
return /Android|webOS|iPhone|iPad|iPod|Mobile|CriOS/i.test(navigator.userAgent || '');
}
function isStandaloneWebApp() {
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
return Math.min(99, (state.unreadChatCount || 0) + sharedPayloadPending + launchQueuePending + secureSharePending);
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
if (!state.pwa.badgeApi || isDesktopAppRuntime()) return;
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
const mobile = state.pwa.mobile;
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
function hideTextInImage() {
const canvas = document.getElementById('stegoCanvas');
const text = document.getElementById('stegoTextInput').value;
const fileName = document.getElementById('stegoImageName').textContent;
if (!text || fileName === 'یک تصویر (PNG/JPG) انتخاب کنید...' || fileName === 'Select a (PNG/JPG) image...') {
showNotification(state.language === 'fa' ? 'لطفا هم تصویر و هم متن را وارد کنید' : 'Please provide both image and text', 'error');
return;
}
const ctx = canvas.getContext('2d');
const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const data = imgData.data;
// Simple LSB Steganography
const textEncoder = new TextEncoder();
const textBytes = textEncoder.encode(text + '\0'); // Null terminator
if (textBytes.length * 8 > data.length / 4) {
showNotification(state.language === 'fa' ? 'متن برای این تصویر خیلی طولانی است' : 'Text is too long for this image', 'error');
return;
}
let dataIdx = 0;
for (let i = 0; i < textBytes.length; i++) {
let byte = textBytes[i];
for (let j = 0; j < 8; j++) {
const bit = (byte >> (7 - j)) & 1;
data[dataIdx] = (data[dataIdx] & ~1) | bit; // modify lowest bit
dataIdx += 4; // move to next pixel's red channel
}
}
ctx.putImageData(imgData, 0, 0);
// Download
canvas.toBlob(function(blob) {
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `stego_${fileName.split('.')[0]}.png`; // Always save as PNG to preserve LSB
a.click();
URL.revokeObjectURL(url);
showNotification(state.language === 'fa' ? 'تصویر با موفقیت ایجاد شد' : 'Image created successfully', 'success');
}, 'image/png');
}
function extractTextFromImage(input) {
const file = input.files[0];
if (!file) return;
document.getElementById('stegoExtractName').textContent = file.name;
const reader = new FileReader();
reader.onload = function(e) {
const img = new Image();
img.onload = function() {
const canvas = document.createElement('canvas');
canvas.width = img.width;
canvas.height = img.height;
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);
const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const data = imgData.data;
const extractedBytes = [];
let currentByte = 0;
let bitCount = 0;
for (let i = 0; i < data.length; i += 4) {
const bit = data[i] & 1;
currentByte = (currentByte << 1) | bit;
bitCount++;
if (bitCount === 8) {
if (currentByte === 0) break; // Null terminator
extractedBytes.push(currentByte);
currentByte = 0;
bitCount = 0;
}
}
const textDecoder = new TextDecoder();
const text = textDecoder.decode(new Uint8Array(extractedBytes));
document.getElementById('stegoExtractedOutput').value = text;
if(text.length === 0) {
showNotification(state.language === 'fa' ? 'متن پنهانی یافت نشد' : 'No hidden text found', 'warning');
} else {
showNotification(state.language === 'fa' ? 'متن با موفقیت استخراج شد' : 'Text extracted successfully', 'success');
}
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
if (!confirm(state.language === 'fa' ? 'آیا مطمئن هستید؟ این عملیات فایل اصلی روی هارد شما را به صورت ایمن حذف می‌کند و غیر قابل بازگشت است!' : 'Are you sure? This will securely delete the original file on your drive and cannot be undone!')) {
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
masterHash: localStorage.getItem('poorija_master_hash') || '',
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
if (confirm(state.language === 'fa' ? 'اطلاعات فعلی شما پاک شده و با اطلاعات جدید جایگزین خواهد شد. آیا مطمئن هستید؟' : 'Current data will be overwritten. Are you sure?')) {
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
localStorage.setItem('poorija_master_hash', migrationData.masterHash);
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
deleteOriginal: false,
desktopIconProfile: 'poorija-default',
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
const overlay = document.getElementById('sidebarOverlay');
const sidebar = document.getElementById('appSidebar');
const header = document.getElementById('appHeader');
const footer = document.getElementById('appFooter');
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
const keyboardOpen = keyboardInset > 110 && isMobileRuntime;
const isStandalone = isStandaloneWebApp();
// On iOS PWA, offsetTop often represents the status bar height
const safeTopInset = isStandalone ? viewportOffsetTop : 0;
const headerRectHeight = header ? Math.round(header.getBoundingClientRect().height || header.offsetHeight || 0) : 0;
const headerHeight = Math.max(header?.offsetHeight || 0, headerRectHeight);
const footerHeight = keyboardOpen || !footer ? 0 : (footer.offsetHeight || 0);
document.documentElement.style.setProperty('--app-height', `${Math.max(320, windowHeight)}px`);
document.documentElement.style.setProperty('--app-window-height', `${Math.max(320, windowHeight)}px`);
document.documentElement.style.setProperty('--app-viewport-height', `${Math.max(320, viewportHeight)}px`);
document.documentElement.style.setProperty('--app-visual-height', `${Math.max(320, viewportHeight)}px`);
document.documentElement.style.setProperty('--app-visual-offset-top', `${viewportOffsetTop}px`);
document.documentElement.style.setProperty('--app-safe-top', `${safeTopInset}px`);
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
async function registerWebPushSubscription(fingerprint, serverOrigin = window.location.origin, promptForAccess = false) {
if (!state.settings.notifications || !fingerprint) return { ok: false, reason: 'disabled' };
const permission = await ensureWebPushPermission(promptForAccess);
if (!permission.granted) return { ok: false, reason: permission.permission };
const registration = await navigator.serviceWorker.ready;
const publicKey = await fetchVapidPublicKey(serverOrigin);
const existing = await registration.pushManager.getSubscription();
const subscription = existing || await registration.pushManager.subscribe({
userVisibleOnly: true,
applicationServerKey: base64UrlToUint8Array(publicKey),
});
const response = await fetch(new URL('/push/subscribe', serverOrigin), {
method: 'POST',
headers: { 'content-type': 'application/json' },
body: JSON.stringify({
fingerprint,
subscription: subscription.toJSON(),
}),
});
if (!response.ok) throw new Error('Failed to register push subscription');
state.webPush = {
supported: true,
permission: Notification.permission,
subscribed: true,
endpoint: subscription.endpoint || '',
};
syncDesktopNotificationUi();
return { ok: true };
}
function getPathBaseName(filePath) {
return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || String(filePath || '');
}
function syncPasskeyHintCard() {
const hintCard = document.getElementById('passkeyHintCard');
if (!hintCard) return;
hintCard.textContent = isDesktopAppRuntime()
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
const isDesktop = isDesktopAppRuntime();
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
const definition = SIDEBAR_TAB_DEFINITIONS.find((tab) => tab.id === tabId);
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
const hideOnDesktopHeader = id === 'installAppBtn' && state.pwa.mobile;
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
navigator.serviceWorker.addEventListener('controllerchange', () => {
const reloadKey = 'poorija-sw-reload-2.99.0-mobile-connection-turn-v1';
if (pwaReloadedForUpdate || sessionStorage.getItem(reloadKey) === '1') return;
pwaReloadedForUpdate = true;
sessionStorage.setItem(reloadKey, '1');
window.location.reload();
});
window.addEventListener('load', () => {
window.loadDeferredFonts?.();
navigator.serviceWorker.register('./sw.js?v=2.99.0-mobile-connection-turn-v1', { scope: './' }).then((registration) => {
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
function clearUnreadChatCount() {
if (!state.unreadChatCount) return;
state.unreadChatCount = 0;
syncAppBadge();
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
await cache.delete(SHARE_TARGET_CACHE_KEY);
state.pendingSharedPayload = payload;
syncAppBadge();
if (!state.isLocked) {
await consumePendingSharedPayload();
}
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
const primaryFile = base64ToFile(
sharedFiles[0].base64,
sharedFiles[0].name,
sharedFiles[0].type,
sharedFiles[0].lastModified
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
function refreshPasskeyUi() {
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
if (checkingDesktop) {
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
const disabled = unsupported || checkingDesktop;
toggleBtn.disabled = disabled;
toggleBtn.classList.toggle('opacity-50', disabled);
toggleBtn.classList.toggle('cursor-not-allowed', disabled);
toggleBtn.innerHTML = unsupported
? `<span>${state.language === 'fa' ? 'پشتیبانی نمی‌شود' : 'Unsupported'}</span>`
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
async function refreshStoredPasskeyUnlockSecret() {
if (isDesktopAppRuntime()) {
if (!state.desktopAuth.enabled || !state.masterPassword) return;
try {
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
allowCredentials: [{ id: credentialIdBuffer, type: 'public-key' }],
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
allowCredentials: [{ id: credentialIdBuffer, type: 'public-key' }],
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
allowCredentials: [{ id: credentialIdBuffer, type: 'public-key' }],
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
try {
const rpId = getExplicitPasskeyRpId();
const credential = await navigator.credentials.create({
publicKey: {
challenge: generateSecureRandomBytes(32),
rp: rpId
? { name: 'P00RIJÃ Cryptography', id: rpId }
: { name: 'P00RIJÃ Cryptography' },
user: {
id: generateSecureRandomBytes(16),
name: 'poorija-user',
displayName: 'P00RIJÃ User'
},
pubKeyCredParams: [
{ type: 'public-key', alg: -7 },
{ type: 'public-key', alg: -257 }
],
authenticatorSelection: {
residentKey: 'preferred',
userVerification: 'required'
},
timeout: 60000,
attestation: 'none',
extensions: {
credProps: true,
prf: {},
largeBlob: {
support: 'preferred'
}
}
}
});
if (!credential) {
throw new Error('Credential creation failed');
}
const credentialId = arrayBufferToBase64Url(credential.rawId);
const extensionResults = credential.getClientExtensionResults ? credential.getClientExtensionResults() : {};
const prfEnabled = Boolean(extensionResults.prf?.enabled || extensionResults.prf?.results?.first);
const largeBlobSupported = Boolean(extensionResults.largeBlob?.supported);
let record;
if (prfEnabled) {
const seed = await derivePasskeyPrfSeed(credential.rawId);
const wrapped = await encryptPasskeyPayload(state.masterPassword, seed);
record = {
credentialId,
createdAt: new Date().toISOString(),
strategy: 'prf',
cipher: wrapped.cipher,
iv: wrapped.iv
};
} else if (largeBlobSupported) {
await writePasskeyLargeBlob(credential.rawId, state.masterPassword);
record = {
credentialId,
createdAt: new Date().toISOString(),
strategy: 'largeBlob'
};
} else {
throw new Error('No supported passkey secret storage extension');
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
console.error(error);
showNotification(
state.language === 'fa'
? 'فعالسازی Passkey کامل نشد. این قابلیت به secure context و authenticator سازگار با PRF یا largeBlob نیاز دارد.'
: 'Passkey enrollment failed. This flow needs a secure context and an authenticator that supports PRF or largeBlob.',
'error'
);
}
}
async function unlockWithPasskey() {
if (isDesktopAppRuntime()) {
if (!state.desktopAuth.enabled) {
showNotification(
state.language === 'fa' ? 'ورود سریع بیومتریک برای این دستگاه فعال نشده است' : 'Desktop biometric quick unlock is not enabled on this device',
'warning'
);
return;
}
try {
state.masterPassword = await invokeDesktopCommand('desktop_unlock_with_biometric');
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
try {
if (passkeyRecord.strategy === 'largeBlob') {
const payload = await readPasskeyLargeBlob(base64UrlToArrayBuffer(passkeyRecord.credentialId));
state.masterPassword = payload.masterPassword;
} else {
const seed = await derivePasskeyPrfSeed(base64UrlToArrayBuffer(passkeyRecord.credentialId));
state.masterPassword = await decryptPasskeyPayload(passkeyRecord, seed);
}
unlockUI();
showNotification(state.language === 'fa' ? 'برنامه با Passkey باز شد' : 'Unlocked with passkey', 'success');
} catch (error) {
console.error(error);
showNotification(state.language === 'fa' ? 'باز کردن با Passkey ناموفق بود' : 'Passkey unlock failed', 'error');
}
}
function checkFirstVisit() {
const hasSetup = localStorage.getItem('poorija_master_hash');
const hasLang = localStorage.getItem('poorija_lang');
const mobileInstallGate = document.getElementById('mobileInstallGate');
const langScreen = document.getElementById('langScreen');
const lockScreen = document.getElementById('lockScreen');
syncPwaRuntimeState();
if (mobileInstallGate) {
const shouldShowGate = state.pwa.mobile && !state.pwa.standalone && !state.installGateDismissed && !isDesktopAppRuntime();
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
const hasSetup = localStorage.getItem('poorija_master_hash');
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
document.documentElement.lang = state.language;
document.documentElement.dir = state.language === 'fa' ? 'rtl' : 'ltr';
updateLanguage();
}
function updateLanguage() {
const texts = translations[state.language];
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
syncShredderDesktopUi();
renderTabOrderCustomizer();
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
// ==================== 2FA Implementation ====================
function toggle2FASetup() {
const enabled = document.getElementById('enable2FAToggle').checked;
const section = document.getElementById('setup2FASection');
if (enabled) {
section.classList.remove('hidden');
generate2FASecret();
} else {
section.classList.add('hidden');
}
}
function generate2FASecret() {
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const secret = generateSecureRandomString(32, chars);
state.twoFA.tempSecret = secret;
const qrContainer = document.getElementById('qrcode');
qrContainer.innerHTML = '';
const issuer = encodeURIComponent('P00RIJÃ');
const account = encodeURIComponent('User');
const otpauth = `otpauth://totp/${issuer}:${account}?secret=${secret}&issuer=${issuer}`;
setTimeout(() => {
new QRCode(qrContainer, {
text: otpauth,
width: 150,
height: 150,
colorDark: '#000000',
colorLight: '#ffffff',
correctLevel: QRCode.CorrectLevel.H
});
}, 50);
document.getElementById('secretKey').textContent = secret;
}
function verify2FASetup() {
const code = document.getElementById('verify2FACode').value;
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
document.getElementById('setup2FASection').classList.add('hidden');
} else {
showNotification(state.language === 'fa' ? 'کد نامعتبر' : 'Invalid code', 'error');
}
}
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
localStorage.setItem('poorija_master_hash', hash);
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
async function setPanicPassword(inputId = 'panicPasswordInput') {
const inputEl = document.getElementById(inputId);
const pass = inputEl ? inputEl.value : '';
if (!pass) {
showNotification(state.language === 'fa' ? 'رمز اضطراری نمی‌تواند خالی باشد' : 'Panic password cannot be empty', 'warning');
return;
}
if (pass === state.masterPassword) {
showNotification(state.language === 'fa' ? 'رمز اضطراری نباید با رمز اصلی یکی باشد' : 'Panic password should not be the same as master password', 'error');
return;
}
const hash = await hashPassword(pass);
localStorage.setItem('poorija_panic_hash', hash);
if (inputEl) inputEl.value = '';
showNotification(state.language === 'fa' ? 'رمز اضطراری با موفقیت ذخیره شد' : 'Panic password saved successfully', 'success');
}
function triggerPanicWipe() {
// Immediate data destruction
localStorage.clear();
// Try to clear indexedDB if any
if (window.indexedDB) {
indexedDB.databases().then(dbs => {
for (const db of dbs) {
indexedDB.deleteDatabase(db.name);
}
});
}
// Force reload to clear memory
window.location.reload();
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
const hash = await hashPassword(pass);
// Check Panic Password
const panicHash = localStorage.getItem('poorija_panic_hash');
if (panicHash && hash === panicHash) {
console.warn('Panic mode triggered!');
triggerPanicWipe();
return;
}
const saved = localStorage.getItem('poorija_master_hash');
if (hash !== saved) {
failedAttempts++;
localStorage.setItem('poorija_failed_logins', failedAttempts.toString());
if (failedAttempts >= 3 + lockoutMinutes.length) {
// Permanent lockout
document.getElementById('loginMainSection').classList.add('hidden');
window.showResetPassword();
return;
}
const errorEl = document.getElementById('loginError');
errorEl.classList.remove('hidden');
setTimeout(() => errorEl.classList.add('hidden'), 3000);
if (failedAttempts >= 3) {
const minutes = lockoutMinutes[failedAttempts - 3];
const unlockTime = now + (minutes * 60 * 1000);
localStorage.setItem('poorija_lock_until', unlockTime.toString());
showLockTimer(unlockTime);
}
return;
}
// Success, clear failures
localStorage.removeItem('poorija_failed_logins');
localStorage.removeItem('poorija_lock_until');
if (state.twoFA.enabled) {
const code = document.getElementById('login2FACode').value;
const totp = new window.OTPAuth.TOTP({
issuer: 'P00RIJÃ Cryptography',
label: 'User',
algorithm: 'SHA1',
digits: 6,
period: 30,
secret: window.OTPAuth.Secret.fromBase32(state.twoFA.secret)
});
const delta = totp.validate({ token: code, window: 1 });
if (delta === null) {
showNotification(state.language === 'fa' ? 'کد تایید نامعتبر' : 'Invalid 2FA code', 'error');
return;
}
}
state.masterPassword = pass;
unlockUI();
}
function unlockUI() {
state.isLocked = false;
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
state.isLocked = true;
state.masterPassword = null;
state.storageKeyCache = { password: '', salt: '', keys: null };
document.getElementById('unlockPassword').value = '';
const login2FA = document.getElementById('login2FACode');
if (login2FA) login2FA.value = '';
// Hide Virtual Keyboard
const vkContainer = document.getElementById('virtualKeyboardContainer');
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
function getEncryptionAlgorithmInfo(rawAlgorithm) {
const config = CryptoConfig.getAlgorithmConfig(rawAlgorithm);
if (config.family === 'legacy-cryptojs') {
return { type: 'legacy-cryptojs', isCryptoJs: true };
}
if (CryptoConfig.isSymmetricAlgorithm(rawAlgorithm)) {
return {
type: 'symmetric',
isCryptoJs: false,
...getSymmetricRuntimeInfo(rawAlgorithm)
};
}
const contentRuntime = getSymmetricRuntimeInfo(config.contentAlgorithm);
return {
type: 'hybrid-rsa',
isCryptoJs: false,
rsaAlgorithm: 'RSA-OAEP',
rsaHash: config.hash || 'SHA-256',
modulusLength: config.keyLengthBits,
...contentRuntime
};
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
if (config.family === 'legacy-cryptojs') {
return candidateKeys.slice();
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
isCryptoJs: algorithmInfo.isCryptoJs,
version: '3.0',
algorithm: rawAlgorithm,
method: keyMethod,
originalName: state.currentFile.name,
originalType: state.currentFile.type || 'application/octet-stream',
chunks: encryptedChunks,
timestamp: new Date().toISOString()
};
if (algorithmInfo.isCryptoJs) {
// Fallback to CryptoJS for unsupported WebCrypto algorithms
const fileBase64 = arrayBufferToBase64(fileData);
let encryptedStr = '';
const legacyPassword = keySelection.material;
if (rawAlgorithm === '3DES *') {
encryptedStr = CryptoJS.TripleDES.encrypt(fileBase64, legacyPassword).toString();
} else if (rawAlgorithm === 'RC4 *') {
encryptedStr = CryptoJS.RC4.encrypt(fileBase64, legacyPassword).toString();
} else if (rawAlgorithm === 'Rabbit *') {
encryptedStr = CryptoJS.Rabbit.encrypt(fileBase64, legacyPassword).toString();
} else if (rawAlgorithm === 'AES-256-CFB *') {
encryptedStr = CryptoJS.AES.encrypt(fileBase64, legacyPassword, { mode: CryptoJS.mode.CFB }).toString();
} else if (rawAlgorithm === 'AES-256-OFB *') {
encryptedStr = CryptoJS.AES.encrypt(fileBase64, legacyPassword, { mode: CryptoJS.mode.OFB }).toString();
} else {
encryptedStr = CryptoJS.AES.encrypt(fileBase64, legacyPassword).toString();
}
encryptedChunks.push(encryptedStr); // Storing as single chunk string for simplicity in JS fallback
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
function performCryptoJsDecryption(poorijaData, password) {
const encryptedStr = poorijaData.chunks[0];
let decryptedStr = '';
if (poorijaData.algorithm === '3DES *') {
decryptedStr = CryptoJS.TripleDES.decrypt(encryptedStr, password).toString(CryptoJS.enc.Utf8);
} else if (poorijaData.algorithm === 'RC4 *') {
decryptedStr = CryptoJS.RC4.decrypt(encryptedStr, password).toString(CryptoJS.enc.Utf8);
} else if (poorijaData.algorithm === 'Rabbit *') {
decryptedStr = CryptoJS.Rabbit.decrypt(encryptedStr, password).toString(CryptoJS.enc.Utf8);
} else if (poorijaData.algorithm === 'AES-256-CFB *') {
decryptedStr = CryptoJS.AES.decrypt(encryptedStr, password, { mode: CryptoJS.mode.CFB }).toString(CryptoJS.enc.Utf8);
} else if (poorijaData.algorithm === 'AES-256-OFB *') {
decryptedStr = CryptoJS.AES.decrypt(encryptedStr, password, { mode: CryptoJS.mode.OFB }).toString(CryptoJS.enc.Utf8);
} else {
decryptedStr = CryptoJS.AES.decrypt(encryptedStr, password).toString(CryptoJS.enc.Utf8);
}
if (!decryptedStr) throw new Error('Decryption failed');
return base64ToArrayBuffer(decryptedStr);
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
if (poorijaData.isCryptoJs) {
result = performCryptoJsDecryption(poorijaData, keySelection.material);
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
return CryptoJS.AES.decrypt(trimmed, password).toString(CryptoJS.enc.Utf8);
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
if (algorithmInfo.isCryptoJs || !window.crypto || !window.crypto.subtle) {
if (alg === 'Rabbit *' || alg === 'Rabbit') result = CryptoJS.Rabbit.encrypt(text, key).toString();
else if (alg === '3DES *' || alg === 'TripleDES') result = CryptoJS.TripleDES.encrypt(text, key).toString();
else if (alg === 'RC4 *' || alg === 'RC4') result = CryptoJS.RC4.encrypt(text, key).toString();
else if (alg === 'AES-256-CFB *') result = CryptoJS.AES.encrypt(text, key, { mode: CryptoJS.mode.CFB }).toString();
else if (alg === 'AES-256-OFB *') result = CryptoJS.AES.encrypt(text, key, { mode: CryptoJS.mode.OFB }).toString();
else result = CryptoJS.AES.encrypt(text, key).toString();
output.value = result;
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
if (algorithmInfo.isCryptoJs || !window.crypto || !window.crypto.subtle) {
if (alg === 'Rabbit *' || alg === 'Rabbit') result = CryptoJS.Rabbit.decrypt(text, key).toString(CryptoJS.enc.Utf8);
else if (alg === '3DES *' || alg === 'TripleDES') result = CryptoJS.TripleDES.decrypt(text, key).toString(CryptoJS.enc.Utf8);
else if (alg === 'RC4 *' || alg === 'RC4') result = CryptoJS.RC4.decrypt(text, key).toString(CryptoJS.enc.Utf8);
else if (alg === 'AES-256-CFB *') result = CryptoJS.AES.decrypt(text, key, { mode: CryptoJS.mode.CFB }).toString(CryptoJS.enc.Utf8);
else if (alg === 'AES-256-OFB *') result = CryptoJS.AES.decrypt(text, key, { mode: CryptoJS.mode.OFB }).toString(CryptoJS.enc.Utf8);
else result = CryptoJS.AES.decrypt(text, key).toString(CryptoJS.enc.Utf8);
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
if (!text || !key) {
showNotification(state.language === 'fa' ? 'لطفا متن و کلید را وارد کنید' : 'Please enter text and key', 'warning');
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
const alg = document.getElementById('sdAlgorithm') ? document.getElementById('sdAlgorithm').value : 'AES';
const textStr = JSON.stringify(payload);
let encryptedPayload = '';
let envelope = { version: APP_VERSION, type: 'self-destruct', alg: alg };
const algorithmInfo = getEncryptionAlgorithmInfo(alg);
const encryptionPreferences = getSettingsEncryptionPreferences();
if (algorithmInfo.isCryptoJs || alg === 'AES' || !window.crypto || !window.crypto.subtle) {
if (alg === 'Rabbit *' || alg === 'Rabbit') encryptedPayload = CryptoJS.Rabbit.encrypt(textStr, key).toString();
else if (alg === '3DES *' || alg === 'TripleDES') encryptedPayload = CryptoJS.TripleDES.encrypt(textStr, key).toString();
else if (alg === 'RC4 *' || alg === 'RC4') encryptedPayload = CryptoJS.RC4.encrypt(textStr, key).toString();
else if (alg === 'AES-256-CFB *') encryptedPayload = CryptoJS.AES.encrypt(textStr, key, { mode: CryptoJS.mode.CFB }).toString();
else if (alg === 'AES-256-OFB *') encryptedPayload = CryptoJS.AES.encrypt(textStr, key, { mode: CryptoJS.mode.OFB }).toString();
else encryptedPayload = CryptoJS.AES.encrypt(textStr, key).toString();
envelope.data = encryptedPayload;
envelope.isCryptoJs = true;
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
const alg = envelope.alg || 'AES';
let decryptedStr = '';
if (envelope.isCryptoJs !== false) {
if (alg === 'Rabbit *' || alg === 'Rabbit') decryptedStr = CryptoJS.Rabbit.decrypt(envelope.data, key).toString(CryptoJS.enc.Utf8);
else if (alg === '3DES *' || alg === 'TripleDES') decryptedStr = CryptoJS.TripleDES.decrypt(envelope.data, key).toString(CryptoJS.enc.Utf8);
else if (alg === 'RC4 *' || alg === 'RC4') decryptedStr = CryptoJS.RC4.decrypt(envelope.data, key).toString(CryptoJS.enc.Utf8);
else if (alg === 'AES-256-CFB *') decryptedStr = CryptoJS.AES.decrypt(envelope.data, key, { mode: CryptoJS.mode.CFB }).toString(CryptoJS.enc.Utf8);
else if (alg === 'AES-256-OFB *') decryptedStr = CryptoJS.AES.decrypt(envelope.data, key, { mode: CryptoJS.mode.OFB }).toString(CryptoJS.enc.Utf8);
else decryptedStr = CryptoJS.AES.decrypt(envelope.data, key).toString(CryptoJS.enc.Utf8);
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
const currentViewsKey = `sd_views_${payload.id}`;
let currentViews = parseInt(localStorage.getItem(currentViewsKey) || '0');
// Map old payload.expiresAt to timeLimitMs if legacy
let messageTimeLimitMs = payload.timeLimitMs || 0;
if (!payload.timeLimitMs && payload.expiresAt > 0) {
messageTimeLimitMs = payload.expiresAt - payload.createdAt;
}
// Calculate when it should expire in this viewing session
const sessionExpiresAt = messageTimeLimitMs > 0 ? Date.now() + messageTimeLimitMs : 0;
// Check View Limit
if (payload.maxViews > 0) {
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
if (payload.maxViews > 0) {
const remainingViews = payload.maxViews - currentViews;
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
if (payload.maxViews > 0) {
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
function savePasswords() {
localStorage.setItem('poorija_passwords', JSON.stringify(state.generatedPasswords));
}
function loadPasswords() {
const saved = localStorage.getItem('poorija_passwords');
if (saved) {
state.generatedPasswords = JSON.parse(saved);
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
container.innerHTML = state.generatedPasswords.map(p => `
<div class="flex items-center justify-between p-4 bg-gray-50 dark:bg-slate-800 rounded-lg">
<div class="font-mono text-sm">${'*'.repeat(p.password.length)}</div>
<div class="flex gap-2">
<button onclick="viewPassword(${p.id})" class="px-3 py-1 bg-brand-100 dark:bg-brand-900 text-brand-700 dark:text-brand-300 rounded text-sm">
<i class="fas fa-eye"></i>
</button>
<button onclick="copyPassword(${p.id})" class="px-3 py-1 bg-gray-200 dark:bg-slate-700 rounded text-sm">
<i class="fas fa-copy"></i>
</button>
<button onclick="deletePassword(${p.id})" class="px-3 py-1 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded text-sm">
<i class="fas fa-trash"></i>
</button>
</div>
</div>
`).join('');
}
function viewPassword(id) {
window.currentViewPasswordId = id;
const viewPasswordInput = document.getElementById('viewPasswordInput');
viewPasswordInput.value = '';
const modal = document.getElementById('viewPasswordModal');
modal.classList.remove('hidden');
modal.classList.add('flex');
viewPasswordInput.focus();
}
function closeViewPasswordModal() {
const modal = document.getElementById('viewPasswordModal');
modal.classList.add('hidden');
modal.classList.remove('flex');
}
function submitViewPassword() {
const pass = document.getElementById('viewPasswordInput').value;
hashPassword(pass).then(hash => {
if (hash === localStorage.getItem('poorija_master_hash')) {
const pwd = state.generatedPasswords.find(p => p.id === window.currentViewPasswordId);
if (pwd) {
navigator.clipboard?.writeText(pwd.password).then(() => {
showNotification(state.language === 'fa' ? 'رمز عبور در کلیپ‌بورد کپی شد' : 'Password copied to clipboard', 'success');
}).catch(() => {
showNotification(state.language === 'fa' ? 'امکان کپی خودکار رمز وجود نداشت' : 'Automatic copy was not available', 'error');
});
}
closeViewPasswordModal();
} else {
showNotification(state.language === 'fa' ? 'رمز اشتباه' : 'Wrong password', 'error');
}
});
}
function resetAutoLockTimer() {
clearTimeout(state.inactivityTimer);
if (!state.isLocked && state.settings && state.settings.autoLock) {
state.inactivityTimer = setTimeout(() => {
lockApp();
showNotification(state.language === 'fa' ? 'برنامه به دلیل عدم فعالیت قفل شد' : 'App locked due to inactivity', 'info');
}, state.settings.autoLockTime * 60000 || 300000);
}
}
function cryptoJsWordArrayToBase64(wordArray) {
return CryptoJS.enc.Base64.stringify(wordArray);
}
function cryptoJsBase64ToWordArray(base64) {
return CryptoJS.enc.Base64.parse(base64);
}
function deriveStorageKeys(saltWordArray, iterations = 250000) {
const material = CryptoJS.PBKDF2(state.masterPassword, saltWordArray, {
keySize: 512 / 32,
iterations,
hasher: CryptoJS.algo.SHA256
});
return {
encKey: CryptoJS.lib.WordArray.create(material.words.slice(0, 8), 32),
macKey: CryptoJS.lib.WordArray.create(material.words.slice(8, 16), 32)
};
}
function storageEnvelopeMac(envelope, macKey) {
return CryptoJS.HmacSHA256(`${envelope.v}.${envelope.alg}.${envelope.it}.${envelope.s}.${envelope.iv}.${envelope.ct}`, macKey).toString(CryptoJS.enc.Base64);
}
function getStorageKeySalt() {
let salt = localStorage.getItem(STORAGE_KEY_SALT_STORAGE_KEY);
if (!salt) {
salt = cryptoJsWordArrayToBase64(CryptoJS.lib.WordArray.random(16));
localStorage.setItem(STORAGE_KEY_SALT_STORAGE_KEY, salt);
}
return salt;
}
function getCachedStorageKeys() {
if (!state.masterPassword) {
throw new Error('Cannot derive local storage keys before unlock.');
}
const salt = getStorageKeySalt();
if (
state.storageKeyCache.keys &&
state.storageKeyCache.password === state.masterPassword &&
state.storageKeyCache.salt === salt
) {
return state.storageKeyCache.keys;
}
const keys = deriveStorageKeys(cryptoJsBase64ToWordArray(salt), 250000);
state.storageKeyCache = {
password: state.masterPassword,
salt,
keys
};
return keys;
}
function encryptStorageData(data) {
if (!state.masterPassword) {
throw new Error('Cannot encrypt local storage data before unlock.');
}
const iterations = 250000;
const salt = getStorageKeySalt();
const iv = CryptoJS.lib.WordArray.random(16);
const keys = getCachedStorageKeys();
const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), keys.encKey, {
iv,
mode: CryptoJS.mode.CBC,
padding: CryptoJS.pad.Pkcs7
});
const envelope = {
v: 3,
alg: 'AES-256-CBC-HMAC-SHA256',
kdf: 'PBKDF2-SHA256',
it: iterations,
s: salt,
iv: cryptoJsWordArrayToBase64(iv),
ct: encrypted.ciphertext.toString(CryptoJS.enc.Base64)
};
envelope.mac = storageEnvelopeMac(envelope, keys.macKey);
return JSON.stringify(envelope);
}
function decryptStorageData(encryptedStr) {
if (!encryptedStr) return null;
try {
if (!state.masterPassword) return null;
const trimmed = encryptedStr.trim();
if (trimmed.startsWith('{')) {
const parsed = JSON.parse(trimmed);
if (parsed && parsed.v === 3 && parsed.ct && parsed.s && parsed.iv && parsed.mac) {
const currentSalt = getStorageKeySalt();
if (parsed.s !== currentSalt) {
throw new Error('Storage key salt mismatch');
}
const keys = getCachedStorageKeys();
const expectedMac = storageEnvelopeMac(parsed, keys.macKey);
if (expectedMac !== parsed.mac) {
throw new Error('Storage MAC verification failed');
}
const decrypted = CryptoJS.AES.decrypt(
{ ciphertext: cryptoJsBase64ToWordArray(parsed.ct) },
keys.encKey,
{
iv: cryptoJsBase64ToWordArray(parsed.iv),
mode: CryptoJS.mode.CBC,
padding: CryptoJS.pad.Pkcs7
}
).toString(CryptoJS.enc.Utf8);
return decrypted ? JSON.parse(decrypted) : null;
}
if (parsed && parsed.v === 2 && parsed.ct && parsed.s && parsed.iv && parsed.mac) {
const salt = cryptoJsBase64ToWordArray(parsed.s);
const keys = deriveStorageKeys(salt, parsed.it || 250000);
const expectedMac = storageEnvelopeMac(parsed, keys.macKey);
if (expectedMac !== parsed.mac) {
throw new Error('Storage MAC verification failed');
}
const decrypted = CryptoJS.AES.decrypt(
{ ciphertext: cryptoJsBase64ToWordArray(parsed.ct) },
keys.encKey,
{
iv: cryptoJsBase64ToWordArray(parsed.iv),
mode: CryptoJS.mode.CBC,
padding: CryptoJS.pad.Pkcs7
}
).toString(CryptoJS.enc.Utf8);
return decrypted ? JSON.parse(decrypted) : null;
}
return parsed;
}
if (trimmed.startsWith('[')) {
return JSON.parse(trimmed);
}
const bytes = CryptoJS.AES.decrypt(encryptedStr, state.masterPassword);
const decrypted = bytes.toString(CryptoJS.enc.Utf8);
if (!decrypted) return null;
return JSON.parse(decrypted);
} catch (e) {
console.error("Failed to decrypt storage data", e);
return null;
}
}
['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
document.addEventListener(evt, resetAutoLockTimer);
});
function copyPassword(id) {
const pwd = state.generatedPasswords.find(p => p.id === id);
if (pwd) {
navigator.clipboard.writeText(pwd.password);
showNotification(state.language === 'fa' ? 'کپی شد' : 'Copied', 'success');
}
}
function deletePassword(id) {
state.generatedPasswords = state.generatedPasswords.filter(p => p.id !== id);
savePasswords();
renderPasswords();
}
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
state.settings = { ...state.settings, ...normalizeSettingsRecord(JSON.parse(saved)) };
localStorage.setItem('poorija_settings', JSON.stringify(state.settings));
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
state.history = JSON.parse(savedHistory);
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
if (await hashPassword(current) !== localStorage.getItem('poorija_master_hash')) {
showNotification(state.language === 'fa' ? 'رمز فعلی اشتباه است' : 'Current password wrong', 'error');
return;
}
if (newPass !== confirm) {
showNotification(state.language === 'fa' ? 'رمزها مطابقت ندارند' : 'Passwords do not match', 'error');
return;
}
const newHash = await hashPassword(newPass);
localStorage.setItem('poorija_master_hash', newHash);
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
function toggle2FA() {
if (state.twoFA.enabled) {
if (confirm(state.language === 'fa' ? 'غیرفعال کردن 2FA؟' : 'Disable 2FA?')) {
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
new QRCode(qrContainer, {
text: otpauth,
width: 150,
height: 150,
colorDark: '#000000',
colorLight: '#ffffff',
correctLevel: QRCode.CorrectLevel.H
});
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
document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor[theme] || '#0f172a');
localStorage.setItem('poorija_theme', theme);
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
function resetAllSettings() {
if (confirm(state.language === 'fa' ? 'تمام تنظیمات پاک شود؟' : 'Reset all settings?')) {
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
function switchTab(tabName, options = {}) {
const { updateHash = true } = options;
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
if (updateHash && window.location.hash !== `#${tabName}`) {
history.replaceState(null, '', `#${tabName}`);
}
if (!isDesktopViewport()) {
toggleSidebar(false);
}
if (tabName === 'chat' && !document.hidden) {
clearUnreadChatCount();
}
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
function formatBytes(bytes) {
if (bytes === 0) return '0 Bytes';
const k = 1024;
const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
const i = Math.floor(Math.log(bytes) / Math.log(k));
return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
function showNotification(message, type = 'info') {
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
document.body.appendChild(stack);
}
const div = document.createElement('div');
div.className = 'app-toast animate-slide-up';
div.style.background = colors[type] || colors.info;
div.innerHTML = `<i class="fas fa-${icons[type] || icons.info}-circle"></i><div class="app-toast-message"></div>`;
div.querySelector('.app-toast-message').textContent = String(message || '');
stack.appendChild(div);
void sendDesktopSystemNotification(message, type);
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
function deleteKey(id) {
if (confirm(state.language === 'fa' ? 'آیا از حذف این کلید اطمینان دارید؟' : 'Are you sure you want to delete this key?')) {
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
function deleteSecureNote(id) {
if (!confirm(state.language === 'fa' ? 'این یادداشت امن حذف شود؟' : 'Delete this secure note?')) return;
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
if (await hashPassword(currentPassword) !== localStorage.getItem('poorija_master_hash')) {
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
const hash = await hashPassword(newPass);
localStorage.setItem('poorija_master_hash', hash);
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
// --- Panic Button Logic ---
window.wipeAllData = function(isPanic = false) {
// First show a notification to make it clear what happened
showNotification(state.language === 'fa' ? 'در حال پاکسازی امن داده‌ها...' : 'Securely wiping data...', 'error');
// Clear everything from local storage
localStorage.clear();
// Reload page to reset state completely
setTimeout(() => {
window.location.reload();
}, 1000);
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
state,
translations,
getTranslatedText,
showNotification,
encryptStorageData,
decryptStorageData,
escapeHTML,
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
