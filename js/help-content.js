/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The guide, as data.
 *
 * It used to be a wall of markup: every entry written twice, once per language,
 * with no way to search it and no relationship to the screen the reader was
 * actually looking at. Keeping it as a list means one place to edit, a filter
 * that works, and a "what is this screen" button that can ask for the entries
 * belonging to one tab.
 *
 * Each entry: an id, the tab it belongs to, a category, a title and a body in
 * both languages, and optional steps. Bodies are plain text on purpose - this
 * is rendered with escaping, so nothing here can inject markup. */
(function () {
  const CATEGORIES = [
    { id: 'start', fa: 'شروع', en: 'Getting started' },
    { id: 'chat', fa: 'چت امن', en: 'Secure chat' },
    { id: 'groups', fa: 'گروه‌ها و تماس', en: 'Groups and calls' },
    { id: 'crypto', fa: 'رمزنگاری', en: 'Encryption' },
    { id: 'files', fa: 'فایل‌ها', en: 'Files' },
    { id: 'passwords', fa: 'رمزها', en: 'Passwords' },
    { id: 'security', fa: 'امنیت و حریم خصوصی', en: 'Security and privacy' },
    { id: 'install', fa: 'نصب', en: 'Installing' },
    { id: 'tools', fa: 'ابزارها', en: 'Tools' },
  ];

  const ENTRIES = [
    {
      id: 'first-run', tab: 'encrypt', cat: 'start',
      fa: { t: 'اولین اجرا', b: 'در نخستین اجرا یک رمز مستر می‌سازید. همه‌چیز روی این دستگاه با همان رمز رمزگذاری می‌شود و هیچ نسخه‌ای از آن جایی نگه داشته نمی‌شود — نه روی سرور، نه در برنامه. اگر فراموشش کنید، هیچ راه بازیابی‌ای وجود ندارد؛ سؤال‌های امنیتی فقط برای همان دستگاه‌اند.' },
      en: { t: 'The first run', b: 'The first thing you set is a master password. Everything stored on this device is encrypted with it, and no copy of it is kept anywhere - not on the server, not in the app. If you forget it there is no recovery; the security questions only work on this same device.' },
    },
    {
      id: 'where-data-lives', tab: 'encrypt', cat: 'security',
      fa: { t: 'داده‌ها کجا می‌مانند', b: 'همهٔ کارهای رمزنگاری در مرورگر شما انجام می‌شود. سرور فقط پاکت‌های مهروموم‌شده را جابه‌جا می‌کند و نه کلیدی می‌بیند نه متنی. تاریخچه، مخاطبین و کلیدها در همین دستگاه و رمزگذاری‌شده می‌مانند.' },
      en: { t: 'Where your data lives', b: 'All the cryptography happens in your browser. The server only forwards sealed envelopes; it never sees a key or a plaintext message. History, contacts and keys stay on this device, encrypted.' },
    },
    {
      id: 'identity-card', tab: 'chat', cat: 'chat',
      fa: { t: 'کارت شناسایی', b: 'برای شروع گفتگو، کارت شناسایی خود را به طرف مقابل می‌دهید و کارت او را وارد می‌کنید. کارت شامل کلید عمومی و اثرانگشت شماست — چیزی محرمانه در آن نیست.',
        steps: ['در تب چت امن روی «شروع چت» بزنید', 'کارت خودتان را کپی کنید و برای طرف مقابل بفرستید', 'کارت او را در همان کادر بچسبانید', 'از این پس نامش در فهرست گفتگوها می‌آید'] },
      en: { t: 'The identity card', b: 'To start a conversation you hand somebody your identity card and paste theirs. The card holds your public key and fingerprint - nothing secret is in it.',
        steps: ['Open Secure chat and press "Start a chat"', 'Copy your own card and send it to them', 'Paste theirs into the same box', 'Their name then appears in your conversation list'] },
    },
    {
      id: 'safety-number', tab: 'chat', cat: 'security',
      fa: { t: 'اثرانگشت و هشدار تغییر کلید', b: 'کلید هر مخاطب هنگام اولین تماس پین می‌شود. اگر روزی عوض شود، پیش از آنکه چیزی بنویسید هشدار می‌گیرید. اثرانگشت را از راهی جدا — تماس صوتی یا حضوری — با هم مقایسه کنید؛ همین کار حمله‌ی میانی را بی‌اثر می‌کند.' },
      en: { t: 'Fingerprints and key-change warnings', b: 'A contact’s key is pinned the first time you meet. If it ever changes you are told before you type anything. Compare the fingerprint over a separate channel - a voice call or in person - and a man-in-the-middle has nothing left to work with.' },
    },
    {
      id: 'offline-messages', tab: 'chat', cat: 'chat',
      fa: { t: 'پیام به کسی که آنلاین نیست', b: 'اگر طرف مقابل آنلاین نباشد، پیام مهروموم و روی رله صف می‌شود تا برگردد. کلیدی که آن پاکت را باز می‌کند حداکثر ۱۵ روز زنده است؛ پس از آن پیام تحویل‌نشده برای همیشه غیرقابل بازکردن می‌شود. این عمدی است و همان چیزی است که تضمین می‌کند سرور نتواند بعداً چیزی را باز کند.' },
      en: { t: 'Writing to somebody who is away', b: 'If they are offline the message is sealed and queued on the relay until they come back. The key that opens that envelope lives at most 15 days; after that an undelivered message can never be opened again. That is deliberate - it is what stops the server ever being able to open it later.' },
    },
    {
      id: 'disappearing', tab: 'chat', cat: 'chat',
      fa: { t: 'پیام زمان‌دار و پیام یک‌بارمصرف', b: 'می‌توانید برای پیام‌ها زمان بگذارید تا پس از خوانده شدن پاک شوند، یا رسانه‌ای بفرستید که فقط یک بار باز شود. این‌ها روی هر دو دستگاه اعمال می‌شوند، ولی هیچ برنامه‌ای نمی‌تواند جلوی عکس‌گرفتن از صفحه را بگیرد.' },
      en: { t: 'Timed and view-once messages', b: 'You can put a timer on messages so they clear after they are read, or send media that opens once. Both apply on either device - but no app can stop somebody photographing their own screen.' },
    },
    {
      id: 'new-group', tab: 'chat', cat: 'groups',
      fa: { t: 'ساخت گروه', b: 'در تب گروه‌ها دکمهٔ «گروه جدید» یک پنجره باز می‌کند که همه‌چیز را یک‌جا می‌پرسد: نام، عکس، توضیح، اعضا و اینکه اعضا چه کاری می‌توانند بکنند.',
        steps: ['به تب چت امن و سپس «گروه‌ها» بروید', 'روی «گروه جدید» بزنید', 'نام و در صورت تمایل عکس و توضیح بگذارید', 'اعضا را از فهرست انتخاب کنید', 'اجازه‌ها را تعیین کنید و «ساخت گروه» را بزنید'] },
      en: { t: 'Making a group', b: 'In the Groups list, "New group" opens one dialog that asks everything at once: the name, a picture, a description, who is in it and what they may do.',
        steps: ['Open Secure chat, then Groups', 'Press "New group"', 'Give it a name, and a picture and description if you like', 'Pick the members from the list', 'Set the rules and press Create'] },
    },
    {
      id: 'group-presence', tab: 'chat', cat: 'groups',
      fa: { t: 'عدد کنار نام گروه', b: 'کنار هر گروه چیزی مثل ۲ / ۳ می‌بینید: عدد سبز یعنی چند نفر همین حالا در دسترس‌اند و عدد آبی یعنی گروه چند نفر است. نقطهٔ کنارش سبز است وقتی همه هستند و نارنجی وقتی فقط بخشی از اعضا.' },
      en: { t: 'The number beside a group', b: 'Each group shows something like 2 / 3: the green number is how many people are reachable right now, the blue one is how many are in the group. The dot beside it is green when everybody is here and amber when only some are.' },
    },
    {
      id: 'group-admins', tab: 'chat', cat: 'groups',
      fa: { t: 'ادمین‌ها و اجازه‌ها', b: 'سازنده می‌تواند هر تعداد ادمین بگذارد و هر وقت بخواهد عزلشان کند. اجازه‌ها دو لایه دارند: یک قانون برای کل گروه، و در صورت نیاز محدودیت برای یک عضو خاص — مثلاً بستن ارسال پیام فقط برای یک نفر، بدون آنکه گروه عوض شود.' },
      en: { t: 'Admins and permissions', b: 'The owner can appoint as many admins as they like and take it back at any time. Permissions come in two layers: a rule for the whole group, and if you need it a limit on one person - closing messages for one member without changing anything for the rest.' },
    },
    {
      id: 'group-dissolve', tab: 'chat', cat: 'groups',
      fa: { t: 'انحلال گروه', b: 'فقط سازنده می‌تواند گروه را منحل کند. پس از آن گفتگو و تاریخچه روی دستگاه همه می‌ماند و خواندنی است، ولی برچسب «منحل شده» می‌گیرد و دیگر چیزی فرستاده نمی‌شود. هرچه از آن گروه روی رله مانده بود پاک می‌شود.' },
      en: { t: 'Dissolving a group', b: 'Only the owner can dissolve a group. Afterwards the conversation stays readable on everybody’s device but is marked dissolved and nothing more can be sent. Whatever was still queued for it on the relay is dropped.' },
    },
    {
      id: 'group-call', tab: 'chat', cat: 'groups',
      fa: { t: 'تماس گروهی', b: 'از داخل یک گروه می‌توانید تماس گروهی بگیرید. لازم هم نیست گروهی وجود داشته باشد: در تب تماس‌ها دکمه‌های «تماس گروهی صوتی/تصویری» چند مخاطب را با هم به یک تماس می‌آورند بی‌آنکه چیزی ساخته یا ذخیره شود. حین تماس دو‌نفره هم می‌توانید نفر اضافه کنید و همان تماس گروهی می‌شود.' },
      en: { t: 'Group calls', b: 'You can call from inside a group - and you do not need a group at all: the Calls tab has "Group voice call" and "Group video call", which bring several contacts into one call without creating or storing anything. During a two-person call you can add somebody and it becomes a group call.' },
    },
    {
      id: 'notifications', tab: 'chat', cat: 'security',
      fa: { t: 'اعلان در پس‌زمینه', b: 'در چت امن ← تنظیمات ← اعلان‌های چت. به‌صورت پیش‌فرض خاموش است. اگر روشنش کنید، رله می‌تواند دستگاهتان را بیدار کند — ولی متن اعلان هیچ‌وقت نام، محتوا یا نام گروه را نمی‌گوید؛ فقط می‌گوید پیام است یا تماس، و اگر گروهی باشد همین را. مدت زندگی اشتراک را خودتان بین ۳۰ تا ۱۸۰ روز انتخاب می‌کنید. کلید «نمایش اعلانات» در تنظیمات اصلی برنامه جداست و همهٔ اعلان‌های برنامه را کنترل می‌کند، نه فقط چت را.' },
      en: { t: 'Background notifications', b: 'In Secure Chat → Settings → Chat notifications. Off by default. Turn it on and the relay can wake your device - but the text never names a person, a group or anything that was said; it only says whether something is a message or a call, and whether a group is involved. You choose how long the subscription lives, from 30 to 180 days. The "show notifications" switch in the app\'s own settings is a separate thing: it governs every notice the app raises, not only the ones a message causes.' },
    },
    {
      id: 'one-notice-per-message', tab: 'chat', cat: 'chat',
      fa: { t: 'برای هر پیام یک اعلان', b: 'وقتی برنامه جلوی چشم شماست هیچ اعلان سیستمی نمی‌آید — خودِ صفحه پیام را با نام فرستنده و متنش نشان می‌دهد، و یک اعلان دیگر کنارش یعنی یک پیام دو بار. وقتی برنامه بسته یا پشت برنامهٔ دیگری است، چند پیام پشت سر هم یک ردیف می‌مانند که می‌گوید چندتا خوانده‌نشده دارید، و دستگاه برای هرکدام جداگانه اطلاع می‌دهد. تماس ردیف خودش را دارد تا زیر پیام‌ها گم نشود.' },
      en: { t: 'One notice per message', b: 'While a window of the app is in front of you, no system notification appears - the page itself shows the message with the sender and the text, and a second notice beside it would be the same message twice. When the app is shut or behind something else, several arrivals stay one row that says how many are unread, and the device alerts for each. A call keeps a row of its own so it is not swallowed by the messages beside it.' },
    },
    {
      id: 'away-and-push', tab: 'chat', cat: 'chat',
      fa: { t: 'وقتی برنامه در پس‌زمینه است', b: 'روی گوشی، برنامه‌ای که به پس‌زمینه می‌رود اتصالش را نگه می‌دارد ولی چیزی نمی‌خواند. برای بقیه آفلاین نشان داده می‌شوید — که راستش همین است — و پیام هم زنده فرستاده می‌شود و هم به‌صورت اعلان، تا وقتی برمی‌گردید چیزی جا نمانده باشد. «در حال تایپ» و چیزهای گذرا هیچ‌وقت کسی را بیدار نمی‌کنند.' },
      en: { t: 'When the app is in the background', b: 'On a phone, an app that goes to the background keeps its connection but reads nothing from it. You are shown to everyone else as offline - which is the truth - and the message is sent both live and as a notification, so nothing is missing when you come back. Typing indicators and the other passing signals never wake anybody.' },
    },
    {
      id: 'chat-appearance', tab: 'chat', cat: 'chat',
      fa: { t: 'ظاهر چت', b: 'در چت امن ← تنظیمات ← ظاهر چت. شش تم چت که جدا از تم برنامه است، پس می‌توانید برنامه را تیره نگه دارید و پیام‌ها را روی کاغذ روشن بخوانید. رنگ هر دو حباب، شفافیت، گردی گوشه‌ها و اندازهٔ متن گفتگو. پس‌زمینه: هفت طرح آماده یا تصویر خودتان، با محو کردن ۰ تا ۲۴ پیکسل. تصویر دلخواه فقط روی همین دستگاه و داخل همین پروفایل می‌ماند و هیچ‌وقت فرستاده نمی‌شود. یک پیش‌نمایش زنده بالای تنظیمات هر تغییر را همان لحظه نشان می‌دهد.' },
      en: { t: 'Chat appearance', b: 'In Secure Chat → Settings → Chat appearance. Six chat themes, separate from the app\'s theme, so you can keep the app dark and still read your messages on light paper. Both bubble colours, opacity, corner rounding and the size of the conversation text. For the background: seven ready-made designs or a picture of your own, with a 0-24px blur. Your own picture stays on this device inside this profile and is never sent anywhere. A live preview above the settings shows every change as you make it.' },
    },
    {
      id: 'message-ticks', tab: 'chat', cat: 'chat',
      fa: { t: 'تیک‌های پیام', b: 'یک تیک یعنی پیام از این دستگاه رفت. دو تیک یعنی به دستگاه طرف مقابل رسید ولی هنوز بازش نکرده. دو تیک رنگی یعنی گفتگو را باز کرده و پیام جلوی چشمش بوده. رنگ حالت سوم برای هر تم اندازه‌گیری شده تا روی حباب همان تم خوانده شود؛ اگر با چشم شما جور نبود، در ظاهر چت هر سه رنگ را خودتان انتخاب کنید — کنار هر کدام نوشته می‌شود که چقدر کنتراست دارد.' },
      en: { t: 'The message ticks', b: 'One tick means the message left this device. Two means it reached theirs and has not been opened. Two in colour means they opened the conversation and the message was on their screen. The third colour is measured for each theme so that it can be read on that theme\'s own bubble; if it does not suit your eyes, pick all three yourself in Chat appearance - the contrast each one achieves is printed beside it.' },
    },
    {
      id: 'large-files', tab: 'chat', cat: 'files',
      fa: { t: 'فرستادن فایل بزرگ', b: 'بین دو نفری که هر دو آنلاین‌اند تا ۴ گیگابایت، و برای کسی که آنلاین نیست تا ۱۰۰ مگابایت. فایل تکه‌تکه و هر تکه جداگانه رمز می‌شود، و گیرنده هم هر دسته‌ای را که کامل شد همان‌جا روی دیسک می‌نشاند — پس هیچ‌کدام از دو طرف فایل را یکجا در حافظه نگه نمی‌دارند. برای فایل حجیم، اگر هر دو آنلاین‌اید، «ساخت سشن امن» را از منوی بالای چت بزنید تا مسیر مستقیم پیش از ارسال آماده باشد. نوار پیشرفت سرعت و زمان باقی‌مانده را روی هر دو طرف نشان می‌دهد.' },
      en: { t: 'Sending a large file', b: 'Up to 4 GB between two people who are both online, and up to 100 MB for somebody who is away. The file is split and each chunk encrypted on its own, and the receiver writes each finished run straight out to storage - so neither side ever holds the file whole in memory. For a large file, if you are both online, tap "Create secure session" in the chat\'s top menu so the direct route is ready before you send. The progress bar shows rate and time remaining on both sides.' },
    },
    {
      id: 'encrypt-file', tab: 'encrypt', cat: 'crypto',
      fa: { t: 'رمزنگاری فایل', b: 'هر فایلی را می‌توانید با رمز عبور یا کلید عمومی رمز کنید. خروجی یک فایل .poorija است که همه‌چیزِ لازم برای بازکردن — جز خود رمز — در آن هست.',
        steps: ['به تب رمزنگاری بروید', 'فایل را انتخاب کنید', 'الگوریتم را انتخاب کنید (AES-256-GCM پیشنهاد می‌شود)', 'رمز عبور یا کلید عمومی گیرنده را بدهید', 'فایل .poorija را ذخیره کنید'] },
      en: { t: 'Encrypting a file', b: 'Any file can be encrypted with a password or a public key. The result is a .poorija file that carries everything needed to open it except the secret itself.',
        steps: ['Open the Encrypt tab', 'Choose the file', 'Pick the algorithm (AES-256-GCM is the sensible default)', 'Give a password, or the recipient’s public key', 'Save the .poorija file'] },
    },
    {
      id: 'decrypt-file', tab: 'decrypt', cat: 'crypto',
      fa: { t: 'رمزگشایی', b: 'فایل .poorija را بدهید و رمز یا کلید خصوصی متناظر را وارد کنید. اگر رمز اشتباه باشد هیچ خروجی جزئی تولید نمی‌شود — یا کامل باز می‌شود یا اصلاً.' },
      en: { t: 'Decrypting', b: 'Give it the .poorija file and the matching password or private key. A wrong secret produces no partial output - it either opens completely or not at all.' },
    },
    {
      id: 'keys', tab: 'keys', cat: 'crypto',
      fa: { t: 'کلیدها', b: 'جفت‌کلید RSA یا ECDSA بسازید، کلید عمومی را به دیگران بدهید و کلید خصوصی را نگه دارید. کلید خصوصی هرگز از این دستگاه بیرون نمی‌رود مگر خودتان صادرش کنید.' },
      en: { t: 'Keys', b: 'Generate an RSA or ECDSA pair, hand out the public half and keep the private one. A private key never leaves this device unless you export it yourself.' },
    },
    {
      id: 'passwords', tab: 'passwords', cat: 'passwords',
      fa: { t: 'ساخت و نگهداری رمز', b: 'رمزهای قوی بسازید و در همین برنامه نگه دارید. همه‌شان زیر رمز مستر رمزگذاری می‌شوند و بدون آن حتی از روی همین دستگاه خواندنی نیستند.' },
      en: { t: 'Making and keeping passwords', b: 'Generate strong passwords and keep them here. They are all encrypted under your master password and are unreadable without it, even from this device.' },
    },
    {
      id: 'file-manager', tab: 'encrypt', cat: 'files',
      fa: { t: 'مدیر فایل رمزگذاری‌شده', b: 'فایل‌ها را در خزانهٔ محلی نگه می‌دارد؛ هر فایل با کلید خودش رمز می‌شود و چیزی به‌صورت خام روی دیسک نمی‌ماند.' },
      en: { t: 'The encrypted file manager', b: 'Keeps files in a local vault, each encrypted with its own key. Nothing is left on disk in the clear.' },
    },
    {
      id: 'panic', tab: 'selfdestruct', cat: 'security',
      fa: { t: 'پاک‌سازی اضطراری', b: 'دکمهٔ اضطراری و حالت وحشت هر دو یک کار می‌کنند: صندوق شما روی رله، اشتراک اعلان، کلیدهای در حافظه، هر دو حافظهٔ مرورگر، همهٔ پایگاه‌های داده، همهٔ کش‌ها و سرویس‌ورکر. برگشتی ندارد.' },
      en: { t: 'Emergency wipe', b: 'The emergency button and panic mode do the same thing: your mailbox on the relay, the push subscription, keys in memory, both browser storages, every database, every cache and the service worker. There is no undo.' },
    },
    {
      id: 'limits', tab: 'about', cat: 'security',
      fa: { t: 'آنچه این برنامه ادعا نمی‌کند', b: 'فراداده پنهان نیست: رله می‌بیند چه کسی آنلاین است و با چه کسی حرف می‌زند، فقط نمی‌داند چه می‌گویند. امنیت پس از افشا هم ندارد — کلید نشست زنده اگر دزدیده شود تا چرخش بعدی همان نشست خواندنی است. تاریخچهٔ روی دیسک هم فقط به قوت رمز مستر شماست. و هیچ ممیزی مستقلی انجام نشده است.' },
      en: { t: 'What this app does not claim', b: 'Metadata is not hidden: the relay sees who is online and who talks to whom, just not what they say. There is no post-compromise security - a stolen live session key reads that session until it rotates. History on disk is only as strong as your master password. And no independent audit has been done.' },
    },
    {
      id: 'metadata-tab', tab: 'metadata', cat: 'files',
      fa: { t: 'متادیتای فایل', b: 'هر عکسی که با گوشی گرفته می‌شود می‌گوید کجا، با چه دستگاهی و چه وقت گرفته شده. این تب همه را نشان می‌دهد، اجازهٔ ویرایش می‌دهد و می‌تواند کاملاً پاکشان کند. فایل اصلی دست نمی‌خورد و خروجی یک کپی است. فرمت‌هایی که می‌شناسد: JPEG، PNG، WebP، MP4/MOV/M4A و MP3 — و فرمتی که نشناسد را صریح می‌گوید، نه اینکه تمیز جا بزند.' },
      en: { t: 'File metadata', b: 'A photograph from a phone says where it was taken, on what, and when. This tab shows all of it, lets you change it, and can take it out entirely. The original is never written to; what you get is a copy. It knows JPEG, PNG, WebP, MP4/MOV/M4A and MP3 - and says plainly when a format is not one of them rather than calling it cleaned.' },
    },
    {
      id: 'metadata-on-send', tab: 'chat', cat: 'security',
      fa: { t: 'پاک‌سازی خودکار هنگام ارسال', b: 'به‌صورت پیش‌فرض هر فایلی که در چت امن می‌فرستید، پیش از رمزنگاری از متادیتا پاک می‌شود. اگر فرمتش شناخته نشود یا خیلی بزرگ باشد، دست‌نخورده می‌رود و همین به شما گفته می‌شود. سوئیچش در تنظیمات چت است؛ اگر خاموشش کنید و فایلی مکان یا نام داشته باشد، یک بار هشدار می‌گیرید.' },
      en: { t: 'Cleaned automatically on send', b: 'By default every file you send in Secure Chat has its metadata removed before it is encrypted. A format that is not recognised, or a file too large to hold in memory, goes as it is and you are told so. The switch is in the chat settings; with it off, a file carrying a location or a name warns you once.' },
    },
    {
      id: 'text-live', tab: 'textencrypt', cat: 'crypto',
      fa: { t: 'رمزنگاری زندهٔ متن', b: 'متن را می‌نویسید و همان‌جا رمز یا باز می‌شود، بدون فایل و بدون رفت‌وبرگشت با سرور. برای وقتی خوب است که می‌خواهید نتیجه را در پیام‌رسان دیگری بچسبانید. رمز عبورش را جدا از خودِ متن بفرستید، وگرنه هر دو با هم لو می‌روند.' },
      en: { t: 'Live text encryption', b: 'You type, and it encrypts or decrypts as you go - no file, no round trip to a server. Useful when you want to paste the result into another messenger. Send the password by some other route than the text itself, or both travel together.' },
    },
    {
      id: 'hash-argon2', tab: 'hash', cat: 'tools',
      fa: { t: 'هش و کلیدسازی از رمز', b: 'Argon2id برندهٔ مسابقهٔ Password Hashing است و برخلاف PBKDF2 حافظه هم مصرف می‌کند، پس حملهٔ موازی با GPU گران می‌شود. اینجا می‌توانید هش بگیرید یا از یک رمز، کلید بسازید. همه‌چیز روی همین دستگاه اجرا می‌شود.',
        steps: ['متن یا رمز را وارد کنید', 'پارامترها را بگذارید یا پیش‌فرض را نگه دارید', 'خروجی را کپی کنید'] },
      en: { t: 'Hashing and deriving keys', b: 'Argon2id won the Password Hashing Competition, and unlike PBKDF2 it costs memory as well as time, which makes a GPU attack expensive. Here you can hash something, or turn a password into a key. It all runs on this device.',
        steps: ['Enter the text or password', 'Set the parameters, or keep the defaults', 'Copy the result'] },
    },
    {
      id: 'signatures-tab', tab: 'signatures', cat: 'tools',
      fa: { t: 'امضای دیجیتال', b: 'امضا نمی‌گوید محتوا محرمانه است؛ می‌گوید دست نخورده و از کیست. برای متن و فایل کار می‌کند. طرف مقابل با کلید عمومی شما تأیید می‌کند — پس آن کلید را از راهی بدهید که خودش قابل جعل نباشد.' },
      en: { t: 'Digital signatures', b: 'A signature does not make something secret; it says it has not been altered and who it came from. It works for text and for files. The other side verifies with your public key - so hand that key over by a route that cannot itself be forged.' },
    },
    {
      id: 'sshkeys-tab', tab: 'sshkeys', cat: 'tools',
      fa: { t: 'کلیدهای SSH', b: 'ساخت، وارد کردن و نگه‌داری کلیدهای SSH، همه گرافیکی. کلید خصوصی رمزگذاری‌شده در خزانهٔ همین دستگاه می‌ماند و با رمز مستر شما محافظت می‌شود. خروجی گرفتن از کلید خصوصی یعنی از خزانه بیرونش می‌آورید — بعد از آن محافظتش با شماست.' },
      en: { t: 'SSH keys', b: 'Generate, import and keep SSH keys without a terminal. The private key stays encrypted in this device’s vault under your master password. Exporting one takes it out of that vault - after that, protecting it is on you.' },
    },
    {
      id: 'stego-tab', tab: 'stego', cat: 'tools',
      fa: { t: 'پنهان کردن متن در تصویر', b: 'متن را در پیکسل‌های یک تصویر می‌گذارد، طوری که ظاهرش تغییر نکند. این پنهان‌کاری است نه رمزنگاری: هرکس بداند دنبال چه بگردد، می‌تواند پیدایش کند. اگر محتوا مهم است، اول رمزش کنید و بعد پنهانش کنید. تصویر خروجی را جایی که دوباره فشرده می‌شود نفرستید — فشرده‌سازی دوباره متن را از بین می‌برد.' },
      en: { t: 'Hiding text in a picture', b: 'It puts text into the pixels of an image without changing how it looks. This is concealment, not encryption: anybody who knows what to look for can find it. If the content matters, encrypt it first and hide the ciphertext. Do not send the result somewhere that re-compresses images - that destroys the hidden text.' },
    },
    {
      id: 'notes-tab', tab: 'notes', cat: 'passwords',
      fa: { t: 'یادداشت‌های امن', b: 'یادداشت‌ها با همان کلیدی که از رمز مستر می‌آید رمز و روی همین دستگاه ذخیره می‌شوند. هیچ‌کدام همگام‌سازی نمی‌شوند؛ برای بردن‌شان به دستگاه دیگر از پشتیبان کامل خزانه استفاده کنید.' },
      en: { t: 'Secure notes', b: 'Notes are encrypted with the key derived from your master password and kept on this device. Nothing here syncs; to move notes to another device, use the full vault backup.' },
    },
    {
      id: 'share-tab', tab: 'share', cat: 'crypto',
      fa: { t: 'اشتراک امن', b: 'یک لینک یا باندل رمزنگاری‌شده از متن، یادداشت، فایل کوچک یا کلید عمومی می‌سازد. کلید در خودِ لینک بعد از # می‌آید و هرگز برای سرور فرستاده نمی‌شود — ولی هرکس لینک کامل را داشته باشد می‌تواند بازش کند، پس لینک را مثل خود رمز نگه دارید.' },
      en: { t: 'Secure share', b: 'Builds an encrypted link or bundle out of text, a note, a small file or a public key. The key rides in the link after the #, so it is never sent to the server - but anyone holding the whole link can open it, so treat the link itself as the secret.' },
    },
    {
      id: 'shredder-tab', tab: 'shredder', cat: 'files',
      fa: { t: 'امحای فایل', b: 'محتوای فایل را روی دیسک با صفر بازنویسی و بعد خالی می‌کند. روی SSD و روی سیستم‌فایل‌هایی که copy-on-write هستند این تضمین قطعی نیست: خودِ دیسک ممکن است نسخهٔ قدیمی را در بلوکی دیگر نگه داشته باشد. برای پاک‌کردن قطعی، رمزگذاری کل دیسک و دورانداختن کلید تنها راه مطمئن است.' },
      en: { t: 'Shredding a file', b: 'It overwrites the file’s contents on disk with zeroes and then empties it. On an SSD, or on a copy-on-write filesystem, that is not a guarantee: the drive may still hold the old copy in another block. Full-disk encryption and throwing away the key is the only dependable way to make something unrecoverable.' },
    },
    {
      id: 'voice-tab', tab: 'voice', cat: 'tools',
      fa: { t: 'تغییر صدا', b: 'چند حالت دارد، و دو دسته‌اند. حالت‌های جلوه‌ای صدا را عوض می‌کنند ولی کسی که شما را می‌شناسد باز هم می‌شناسد. حالت‌های پوشش هویت هم زیروبمی و هم فرمانت‌ها را جابه‌جا می‌کنند و بازگرداندنش سخت است — ولی سخت یعنی سخت، نه ناممکن: ریتم حرف زدن، مکث‌ها و لهجه سر جایشان می‌مانند. همه‌چیز روی همین دستگاه پردازش می‌شود و خروجی را می‌توانید ذخیره کنید.' },
      en: { t: 'The voice changer', b: 'It has several modes, in two kinds. The effect modes change how you sound but anyone who knows you will still know you. The disguise modes move pitch and formants together and are hard to undo - hard, not impossible: your rhythm, your pauses and your accent all survive. Everything is processed on this device, and you can save the result.' },
    },
    {
      id: 'voice-message-disguise', tab: 'chat', cat: 'security',
      fa: { t: 'پیام صوتی با صدای تغییریافته', b: 'کنار دکمهٔ ارسال پیام صوتی، دکمهٔ جداگانه‌ای هست که همان ضبط را با صدای پوشانده می‌فرستد. اگر تبدیل به هر دلیلی شکست بخورد، هیچ چیزی فرستاده نمی‌شود — نه اینکه نسخهٔ اصلی برود.' },
      en: { t: 'Voice messages with your voice disguised', b: 'Next to the send button for a voice message there is a separate one that sends the same recording with the speaker disguised. If the transform fails for any reason, nothing is sent at all - it does not quietly fall back to your real voice.' },
    },
    {
      id: 'vault-tab', tab: 'vault', cat: 'files',
      fa: { t: 'مدیریت فایل‌ها', b: 'هرچه برنامه نگه داشته یک‌جاست: پیوست پیام‌ها، پیام‌های صوتی، استیکرها و فایل‌های رمزگذاری‌شده. می‌توانید ببینید چقدر جا گرفته‌اند، جستجو کنید، ذخیره کنید روی دستگاه یا حذف کنید.' },
      en: { t: 'The file manager', b: 'Everything the app has kept, in one place: message attachments, voice messages, stickers and encrypted files. You can see how much room they take, search them, save one to the device, or delete it.' },
    },
    {
      id: 'vault-lock', tab: 'vault', cat: 'security',
      fa: { t: 'قفل روی فهرست فایل‌ها', b: 'می‌توانید یک عبارت عبور روی این بخش بگذارید. صریح باشیم دربارهٔ اینکه چه کاری می‌کند: این فایل‌ها همین حالا با کلیدی که از رمز مستر می‌آید رمزند، و این عبارت رمزنگاری تازه‌ای اضافه نمی‌کند. فقط فهرست را پنهان می‌کند، برای وقتی که برنامه باز است و گوشی لحظه‌ای دست کس دیگری می‌افتد. با قفل شدن برنامه یا قفل چت، خودش هم بسته می‌شود.' },
      en: { t: 'A lock on the file list', b: 'You can put a passphrase on this section. To be plain about what it does: these files are already encrypted under a key derived from your master password, and this passphrase adds no encryption. It hides the listing, for when the app is open and the phone is briefly in somebody else’s hand. It closes again whenever the app or the chat lock closes.' },
    },
    {
      id: 'securitycenter-tab', tab: 'securitycenter', cat: 'security',
      fa: { t: 'مرکز سلامت امنیت', b: 'یک‌جا می‌گوید وضعیت کلیدها، رمزها، پشتیبان، ۲FA و Passkey چطور است و چه چیزی جا مانده. چیزی را خودش عوض نمی‌کند؛ فهرستی است از کارهایی که خودتان باید انجام دهید.' },
      en: { t: 'The security health centre', b: 'One place that reports on your keys, passwords, backup, 2FA and passkeys, and what is still missing. It changes nothing by itself; it is a list of things for you to do.' },
    },
    {
      id: 'migration-tab', tab: 'migration', cat: 'security',
      fa: { t: 'پشتیبان کامل و بردن به دستگاه دیگر', b: 'یک فایل که همه‌چیز را می‌برد: کلیدها، رمزها، یادداشت‌ها، تنظیمات، گفتگوها و مخاطبین، پک‌های استیکر و همهٔ فایل‌های ذخیره‌شده. با Argon2id و AES-256-GCM قفل می‌شود. رمز پشتیبان جداست از رمز مستر و هیچ‌جا نگه داشته نمی‌شود؛ گمش کنید، پشتیبان از دست رفته است.',
        steps: ['در تب مهاجرت رمزی برای پشتیبان بگذارید', 'فایل را بسازید و جایی امن نگه دارید', 'روی دستگاه تازه همان فایل و همان رمز را بدهید'] },
      en: { t: 'A full backup, and moving to a new device', b: 'One file that carries everything: keys, passwords, notes, settings, conversations and contacts, sticker packs and every stored file. It is locked with Argon2id and AES-256-GCM. The backup password is separate from your master password and is kept nowhere; lose it and the backup is gone.',
        steps: ['Set a backup password in the Migration tab', 'Build the file and keep it somewhere safe', 'On the new device, give it that same file and password'] },
    },
    {
      id: 'wizard-tab', tab: 'wizard', cat: 'start',
      fa: { t: 'ویزارد هوشمند', b: 'اگر نمی‌دانید کدام ابزار به کارتان می‌آید، سناریو را انتخاب کنید و ویزارد مسیر و تنظیمات را آماده می‌کند. هر کاری که می‌کند از همان تب‌های عادی هم دستی شدنی است.' },
      en: { t: 'The wizard', b: 'If you are not sure which tool you need, pick the situation and the wizard sets up the route and the settings. Everything it does can also be done by hand from the ordinary tabs.' },
    },
    {
      id: 'settings-tab', tab: 'settings', cat: 'start',
      fa: { t: 'تنظیمات', b: 'زبان، پوسته، رفتار قفل، و اینکه کدام تب‌ها در نوار پایین گوشی باشند (حداکثر پنج تا). تنظیمات چت امن — از جمله پاک‌سازی خودکار متادیتا و پس‌زمینهٔ تصویر در تماس — داخل خود تب چت امن است، نه اینجا.' },
      en: { t: 'Settings', b: 'Language, theme, how the lock behaves, and which tabs sit in the phone’s bottom bar (up to five). Secure Chat’s own settings - including automatic metadata cleaning and the call backdrop - live inside the chat tab, not here.' },
    },
    {
      id: 'help-itself', tab: 'help', cat: 'start',
      fa: { t: 'همین راهنما', b: 'هر چیزی که دربارهٔ برنامه نوشته شده همین‌جاست: با جستجو یا با دسته‌ها. هیچ صفحهٔ دیگری راهنمای جداگانه ندارد — اگر جواب سؤالی اینجا نیست، یعنی هنوز نوشته نشده و همین یک نقص است.' },
      en: { t: 'This guide', b: 'Everything written about the app is here, by search or by category. No other screen carries its own separate help - if an answer is not here, it has not been written yet, and that is a gap worth reporting.' },
    },
    {
      id: 'install-pwa', tab: 'about', cat: 'install',
      fa: { t: 'نصب روی گوشی', b: 'در سافاری یا کروم، از منوی اشتراک‌گذاری «افزودن به صفحهٔ اصلی» را بزنید. روی آیفون، اعلان پس‌زمینه فقط وقتی کار می‌کند که برنامه از صفحهٔ اصلی نصب شده باشد.' },
      en: { t: 'Installing on a phone', b: 'In Safari or Chrome, use the share menu and "Add to Home Screen". On iPhone, background notifications only work when the app was installed from the Home Screen.' },
    },
    {
      id: 'install-desktop', tab: 'about', cat: 'install',
      fa: { t: 'نسخهٔ دسکتاپ', b: 'نصب‌کننده‌های مک، ویندوز و لینوکس موجودند. در نسخهٔ نیتیو اعلان‌ها از خود سیستم‌عامل می‌آیند و تا وقتی برنامه در حال اجراست کار می‌کنند؛ بیدارکردن برنامهٔ کاملاً بسته فقط در نسخهٔ وب ممکن است.' },
      en: { t: 'The desktop app', b: 'There are installers for macOS, Windows and Linux. In the native app notifications come from the operating system and work while the app is running; waking a fully closed app is a web-only trick.' },
    },
    /* These five screens shipped without an entry, which the help suite caught:
       a tab nobody documented is a tab nobody finds a use for. */
    {
      id: 'locallink-tab', tab: 'locallink', cat: 'chat',
      fa: { t: 'پیوند محلی — بدون هیچ سروری', b: 'دو دستگاه روی یک وای‌فای از راه دوربین به هم معرفی می‌شوند و بعد مستقیم و رمزشده با هم حرف می‌زنند. نه رله‌ای، نه اینترنتی، نه هیچ سروری. کلید عمومی هر طرف داخل همان کد QR سفر می‌کند، پس کلید از راه چشم شما می‌رسد نه از روی سیم — قوی‌ترین اعتماد در کل برنامه. عبارت امنیتی شش‌کلمه‌ای باید روی هر دو دستگاه یکسان باشد؛ اگر نبود، قطع کنید. اگر وصل نشد، بیشتر وای‌فای‌های مهمان اجازه نمی‌دهند دستگاه‌ها یکدیگر را ببینند؛ هات‌اسپات شخصی این محدودیت را ندارد.',
        steps: ['روی یک دستگاه «شروع پیوند تازه» را بزنید', 'کد را به دستگاه دوم نشان بدهید و با «اسکن کد طرف مقابل» بخوانید', 'کد پاسخ را به دستگاه اول برگردانید', 'عبارت امنیتی را روی هر دو مقایسه کنید', 'حالا پیام و فایل مستقیم رد و بدل می‌شود'] },
      en: { t: 'Local Link — with no server at all', b: 'Two devices on the same Wi-Fi introduce themselves through a camera, then talk directly and encrypted. No relay, no internet, no server of any kind. Each side\u2019s public key travels inside its own QR code, so the key reaches you through your eyes rather than over a wire \u2014 the strongest trust in the whole app. The six-word safety phrase must read the same on both devices; if it does not, disconnect. If it will not connect, most guest Wi-Fi stops devices seeing each other; a personal hotspot has no such restriction.',
        steps: ['On one device press "Start a new link"', 'Show the code to the second device and read it with "Scan their code"', 'Take the reply code back to the first device', 'Compare the safety phrase on both', 'Messages and files now pass directly'] },
    },
    {
      id: 'qrbridge-tab', tab: 'qrbridge', cat: 'tools',
      fa: { t: 'پل QR — انتقال بدون شبکه', b: 'متن یا دادهٔ رمزشده را به دنبالهٔ کدهای QR تبدیل می‌کند تا دوربین دستگاه دیگر بخواند. وقتی هیچ شبکهٔ مشترکی نیست — نه اینترنت، نه وای‌فای، نه بلوتوث — این تنها راهی است که باقی می‌ماند. قاب‌ها به هر ترتیبی خوانده می‌شوند و برنامه می‌گوید کدام‌ها مانده.',
        steps: ['متن رمزشده را در کادر بگذارید', '«ساخت کدها» را بزنید و «پخش خودکار» را روشن کنید', 'روی دستگاه دوم دوربین را بگیرید تا همهٔ قاب‌ها خوانده شود'] },
      en: { t: 'QR Bridge — transfer with no network', b: 'Turns encrypted text or data into a sequence of QR codes for another device\u2019s camera. When there is no shared network at all \u2014 no internet, no Wi-Fi, no Bluetooth \u2014 this is what is left. Frames may be read in any order and the app says which are still missing.',
        steps: ['Paste the encrypted text into the box', 'Press "Build the codes" and start auto-play', 'Point the second device\u2019s camera at it until every frame is read'] },
    },
    {
      id: 'authenticator-tab', tab: 'authenticator', cat: 'tools',
      fa: { t: 'کدساز دومرحله‌ای', b: 'کدهای TOTP روی همین دستگاه ساخته می‌شوند و کلیدهای مشترک در انبار رمزشدهٔ برنامه می‌مانند. هیچ چیزی به بیرون فرستاده نمی‌شود. اگر کدها پذیرفته نمی‌شوند، معمولاً ساعت دستگاه چند ثانیه اختلاف دارد.',
        steps: ['کلید base32 را وارد کنید یا لینک otpauth:// را بچسبانید', 'کد شش‌رقمی هر سی ثانیه تازه می‌شود'] },
      en: { t: 'Two-factor code generator', b: 'TOTP codes are produced on this device and the shared secrets stay in the app\u2019s encrypted vault. Nothing is sent anywhere. If codes are being rejected, the device clock is usually a few seconds out.',
        steps: ['Enter the base32 secret, or paste an otpauth:// link', 'The six-digit code refreshes every thirty seconds'] },
    },
    {
      id: 'inspector-tab', tab: 'inspector', cat: 'security',
      fa: { t: 'بازرس نویسه', b: 'متن می‌تواند چیزی جز آنچه دیده می‌شود باشد: نویسه‌های نامرئی، نشانگرهای دوجهته که ترتیب نمایش را برعکس می‌کنند، و حروفی که شبیه حروف دیگرند. این‌ها برای جعل نشانی و پنهان‌کردن محتوا به کار می‌روند. اینجا پیدا و در صورت خواست پاک می‌شوند، بدون آنکه متن دیده‌شدنی آسیب ببیند.',
        steps: ['متن مشکوک را بچسبانید', 'فهرست یافته‌ها را ببینید', 'در صورت لزوم پاک‌سازی کنید'] },
      en: { t: 'Character Inspector', b: 'Text can be something other than what it looks like: invisible characters, bidirectional marks that reverse the display order, and letters that impersonate other letters. These are used to forge addresses and hide content. Here they are found and, if you want, stripped, without damaging the visible text.',
        steps: ['Paste the suspicious text', 'Read what it found', 'Strip them if you want to'] },
    },
    {
      id: 'convert-tab', tab: 'convert', cat: 'tools',
      fa: { t: 'میز تبدیل', b: 'ده تبدیل میان متن، base64، hex و بایت خام. برای وقتی که یک کلید یا پاکت رمزشده به شکلی رسیده که ابزار مقابل نمی‌پذیرد. همه‌چیز روی همین دستگاه انجام می‌شود و چیزی ذخیره نمی‌ماند.' },
      en: { t: 'Convert Bench', b: 'Ten conversions between text, base64, hex and raw bytes. For when a key or a sealed envelope arrives in a shape the tool at the other end will not take. It all runs on this device and nothing is kept.' },
    },
  ];

  window.PoorijaHelp = { CATEGORIES, ENTRIES };
})();
