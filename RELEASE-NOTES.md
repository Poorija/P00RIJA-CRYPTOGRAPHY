# P00RIJA Cryptography 2.98.30

Version 2.98.30 · build chat-v123

نوار قالب‌بندی حالا جایی می‌نشیند که منوی کپی و چسباندن خود گوشی رویش نیاید، چه آن
منو بالای متن انتخاب‌شده باز شود چه پایینش. متن هر بخش اول فارسی است و بعد انگلیسی.
تغییرات نسخه‌های 2.98.29 و 2.98.28 پایین‌تر آمده‌اند.

The formatting bar now sits where the phone's own copy-and-paste menu cannot
cover it, whether that menu opens above the selection or below it. Each section
is Persian first, English after. The changes in 2.98.29 and 2.98.28 follow below.

---

## جای نوار قالب‌بندی · Where the formatting bar sits

- **منوی سیستم دیگر رویش نمی‌آید** — iOS منوی Cut/Copy/Paste را گاهی بالای متن
  انتخاب‌شده باز می‌کند و گاهی پایینش، حتی برای همان انتخاب. در 2.98.29 نوار زیر کادر
  بود و منوی پایینی آن را می‌پوشاند. حالا نوار بالای کادر شناور است و به اندازهٔ ارتفاع آن
  منو بالاتر از خطِ انتخاب‌شده می‌ایستد: منوی بالایی در فاصلهٔ بین کادر و نوار باز
  می‌شود و منوی پایینی اصلاً به آن نمی‌رسد. جای کافی برای متن بزرگ‌تر سیستم هم در نظر
  گرفته شده.
- **فاصله از روی خطِ انتخاب‌شده حساب می‌شود** — وقتی متن چندخطی است و انتخاب در
  خطوط پایین‌تر است، منو داخل خود کادر باز می‌شود و نوار نزدیک کادر می‌آید. از بالای
  فهرست پیام‌ها هم بالاتر نمی‌رود.
- **کادر تکان نمی‌خورد** — نوار روی صفحه شناور است، پس با ظاهر شدنش متنی که در حال
  انتخاب آن هستید جابه‌جا نمی‌شود.
- روی دسکتاپ که منوی سیستمی در کار نیست، نوار درست بالای کادر می‌نشیند.

- **The system menu no longer covers it**: iOS opens Cut/Copy/Paste above the
  selection or below it, even for the same selection. In 2.98.29 the bar sat
  under the box, where the menu below covered it. The bar now floats above the
  box and keeps the menu's height clear above the selected line: a menu that
  opens above lands in the gap between the box and the bar, and one that opens
  below never reaches it. There is room for a larger system text size too.
- **Measured from the selected line**: when the text runs over several lines and
  the selection is on a lower one, the menu opens inside the box and the bar
  comes down to it. It never rises past the top of the messages.
- **The box stays still**: the bar floats over the page, so showing it never
  moves the text being selected.
- On a desktop, with no system menu to clear, the bar sits just above the box.

---

# P00RIJA Cryptography 2.98.29

Version 2.98.29 · build chat-v122

قالب‌بندی متن حالا روی گوشی هم با یک لمس انجام می‌شود، بدون تایپ علامت‌ها. متن هر
بخش اول فارسی است و بعد انگلیسی. تغییرات نسخهٔ 2.98.28 پایین‌تر آمده‌اند.

Text formatting now takes one tap on a phone, with no markers to type. Each
section is Persian first, English after. The changes in 2.98.28 follow below.

---

## نوار قالب‌بندی · The formatting bar

- **با انتخاب متن ظاهر می‌شود** — هر جای کادر پیام که متنی انتخاب کنید، نواری با
  دکمه‌های پررنگ، کج، خط‌خورده، کد، متن پنهان و حذف قالب زیر کادر باز می‌شود. روی
  گوشی، PWA، مرورگر و نسخه‌های دسکتاپ یکسان است.
- **زیر کادر، نه بالای آن** — منوی کپی و چسباندن خود سیستم بالای متن انتخاب‌شده
  باز می‌شود؛ نوار پایین کادر است تا زیر آن منو نماند و لمسی که برای «پررنگ» بود
  روی «کپی» ننشیند.
- **وقتی انتخاب تمام شد** — تا انگشت روی متن است یا دستگیره‌های انتخاب حرکت
  می‌کنند نوار ظاهر نمی‌شود، تا متن زیر انگشت جابه‌جا نشود. با گذاشتن نشانگر، ارسال
  پیام یا بیرون رفتن از کادر بسته می‌شود.
- **کیبورد باز می‌ماند** — لمس دکمه فوکوس کادر را نمی‌گیرد، و همان کلمه انتخاب‌شده
  می‌ماند تا قالب دوم را هم بزنید.
- **روشن و خاموش** — دکمهٔ قالبی که روی متن هست روشن نشان داده می‌شود و لمس دوباره
  آن را برمی‌دارد. قالب‌ها به ترتیبی روی هم می‌نشینند که درست نمایش داده شوند
  (پررنگِ کج همیشه کار می‌کند).
- **رفتار دقیق‌تر** — بخشی از یک کلمه برای پررنگ، کج و خط‌خورده کل کلمه می‌شود، چون
  فقط این‌طور نمایش داده می‌شود؛ متن پنهان و کد می‌توانند بخشی از کلمه باشند. در
  انتخاب چندخطی هر خط جدا قالب می‌گیرد و «کد» یک بلوک کد می‌سازد. زیرخط‌های
  `snake_case` کج حساب نمی‌شوند.
- **واگرد کار می‌کند** — تغییر از راه ویرایشگر خود سیستم وارد می‌شود، پس واگرد گوشی
  و Ctrl/⌘+Z آن را برمی‌گرداند.
- روی دسکتاپ هر دکمه میان‌بر خودش را نشان می‌دهد و میان‌برها هم حالا مثل دکمه‌ها
  روشن و خاموش می‌کنند.

- **It appears when you select text** in the message box: Bold, Italic,
  Strikethrough, Code, Spoiler, and Clear formatting, in a bar under the box. It
  is the same on a phone, in the PWA, in a browser, and in the desktop apps.
- **Under the box, not above it**: the system's own copy-and-paste menu opens
  above a selection, so the bar sits below where that menu cannot cover it and a
  tap meant for Bold cannot land on Copy.
- **Once the selection is made**: while a finger is on the text or the selection
  handles are moving the bar waits, so the text never shifts under a finger. It
  closes when the caret is put down, the message is sent, or the box loses focus.
- **The keyboard stays up**: a tap does not take focus from the box, and the
  word stays selected for a second format.
- **On and off**: a format already on the text shows as on, and a second tap
  takes it off. Formats nest in the order that renders, so bold italic always
  works.
- **Sensible edges**: part of a word is made bold, italic, or struck as the whole
  word, the only way those render; spoilers and code may cover part of a word.
  Across lines each line is formatted on its own, and Code makes one code
  block. Underscores in `snake_case` are not taken for italics.
- **Undo works**: the change goes in through the system's own editing, so the
  phone's undo and Ctrl/⌘+Z take it back.
- On a desktop each button names its shortcut, and the shortcuts now toggle
  exactly as the buttons do.

---

# P00RIJA Cryptography 2.98.28

Version 2.98.28 · build chat-v121

دوازده قابلیت تازه برای چت امن و کل برنامه: پنهان شدن فرستنده از رله، اندازهٔ
یکسان برای پیام‌ها، تأیید هویت با اسکن کد، صندوق درخواست پیام، آدرس پشتیبان
برای رله، محافظ صفحه، پراکسی، و چند امکان روزمره. هر قابلیت پیش از انتشار با
تست واقعی بین دو رله و یک بازبینی امنیتی جدا آزموده شده و یافته‌های آن بازبینی
همه فیکس شده‌اند. متن هر بخش اول فارسی است و بعد انگلیسی.

Twelve new features for the secure chat and the app as a whole: a sender the
relay cannot see, messages of uniform size, verification by scanning a code,
message requests, backup addresses for a relay, a screen guard, a proxy, and a
few everyday conveniences. Each was tested end to end across two relays and
reviewed for security on its own, and every finding of that review is fixed.
Each section is Persian first, English after.

---

## ۱. آنچه رله دیگر نمی‌بیند · What the relay no longer sees

- **فرستندهٔ پنهان (Sealed Sender)** — پیامی که برای مخاطبِ آفلاین در صف رله
  می‌ماند دیگر اسم فرستنده، امضا، نوع پیام و زمانش را بیرون نشان نمی‌دهد؛ همهٔ این‌ها
  در جعبه‌ای رمزنگاری‌شده با همان کلیدی است که فقط گیرنده باز می‌کند. رله پیام را
  بدون نام فرستنده در صندوق ذخیره می‌کند و بدون نام فرستنده تحویل می‌دهد، و در
  فایل صندوق روی سرور هیچ ردی از اینکه چه کسی به چه کسی نوشته نمی‌ماند. امضا حالا
  گیرنده را هم پوشش می‌دهد تا پیامی که برای یک نفر بوده، برای نفر دیگری جا زده نشود.
  فقط برای مخاطبی به کار می‌رود که نسخه‌اش آن را می‌خواند؛ نسخه‌های قدیمی همان شکل
  قبلی را می‌گیرند.
- **اندازهٔ یکسان (Padding)** — طول متنِ رمزشده همان طول پیام بود؛ «باشه» و یک
  نامهٔ بلند و یک رسید از روی اندازه قابل تشخیص بودند. حالا بدنهٔ پیام‌های صف‌شده و
  هر فریم کوچکِ مسیر مستقیم به چند اندازهٔ ثابت (۵۱۲ بایت تا ۶۴ کیلوبایت) گرد
  می‌شوند.
- **هر پاکت امضا دارد** — پاکتِ بی‌امضایی که خودش را یکی از مخاطبان جا می‌زد، قبلاً
  به‌عنوان «شکل قدیمی» پذیرفته می‌شد. حالا هر دو نامی که پاکت می‌دهد با کلید
  ذخیره‌شده چک می‌شود، نامِ خودِ شما فقط با امضای خودِ شما پذیرفته است، و پاکت
  بی‌امضا از یک مخاطبِ شناخته‌شده فقط برای رسید و «در حال نوشتن» قبول می‌شود.

- **Sealed sender.** A message queued for somebody who is away no longer shows
  its sender, signature, kind, or time on the outside; they travel in a box
  encrypted under the key only the recipient can recover. The relay files and
  delivers it without a sender, and the mailbox on its disk says nothing about
  who wrote to whom. The signature now covers the recipient, so an envelope
  written to one person cannot pass as written to another. Used only toward a
  build that reads it; older builds get the old shape.
- **Padding.** Ciphertext was as long as what it hid. Queued bodies and every
  small frame on a live channel are now rounded to fixed sizes, 512 B to 64 KB.
- **Every envelope signed.** An unsigned envelope naming a contact used to pass
  as "the old format". Both names an envelope gives are now checked against the
  pinned key, the reader's own name is accepted only with the reader's own
  signature, and an unsigned envelope from a pinned contact is accepted only for
  receipts and typing.

## ۲. اعتماد به مخاطب · Trusting a contact

- **تأیید با اسکن کد** — در صفحهٔ تأیید کلید، کدی نمایش داده می‌شود که اثرانگشت هر
  دو طرف را دارد؛ یکی کد دیگری را با دوربین اسکن می‌کند و اگر جور باشد مخاطب خودکار
  تأیید می‌شود. اگر کسی میان شما کلید عوض کرده باشد، کدها جور نمی‌شوند و برنامه
  همین را می‌گوید. فقط با دوربین: تصویرِ یک کد چیزی دربارهٔ صاحب گوشی ثابت نمی‌کند.
- **نشان «تأییدشده»** در فهرست چت‌ها.
- **قانون سخت‌تر برای مخاطب تأییدشده** — اگر کلید مخاطبی که تأیید کرده بودید عوض
  شود، تا کلید تازه را بررسی نکنید چیزی برایش فرستاده نمی‌شود (پیام، فایل، پیام
  زمان‌بندی‌شده). اسکن کد تازه کلید را می‌پذیرد و تأیید می‌کند؛ پذیرفتن بدون اسکن هم
  ممکن است اما با هشدار صریح.
- **صندوق درخواست پیام** — پیام کسی که در مخاطبان شما نیست زیر «درخواست‌ها» می‌ماند:
  صدا و اعلان ندارد، رسید خواندن نمی‌گیرد، فایل و استیکرش نمایش داده نمی‌شود، فایل
  بزرگش همیشه پرسیده می‌شود و تماسش زنگ نمی‌زند (به‌عنوان تماس ازدست‌رفته ثبت
  می‌شود). گروهی که غریبه‌ای شما را در آن گذاشته هم همین‌طور. با یک دکمه پذیرفته
  می‌شود و پاسخ دادن هم یعنی پذیرفتن. مخاطبان قبلی شما خودکار پذیرفته شده‌اند.

- **Verify by scanning a code.** The safety panel shows a code holding both
  fingerprints; one of you scans the other's with the camera, and the contact is
  verified when the halves fit. A relay that swapped a key produces codes that
  do not fit, and the scan says so. Camera only: a picture of a code proves
  nothing about whose phone it came from.
- **A verified badge** in the chat list.
- **A stricter rule for verified contacts.** When a verified contact's key
  changes, nothing is sent to them — messages, files, scheduled messages — until
  the new key is checked. Scanning their new code accepts and verifies it in one
  step; accepting without a scan is possible, with a plain warning.
- **Message requests.** What somebody who is not a contact sends waits under
  Requests: no sound, no notification, no read receipt, files, and stickers not
  drawn, large files always asked about, calls logged as missed instead of
  ringing. A group a stranger put you in waits the same way. One tap accepts,
  and replying accepts. Everybody you already talked to is accepted.

## ۳. وقتی دامنه مسدود است · When the domain is blocked

- **آدرس‌های پشتیبان برای رله** — مدیر سرور می‌تواند آدرس‌های دیگری که به همان
  رله می‌رسند (دامنهٔ دوم یا یک CDN) را در `CHAT_MIRROR_ORIGINS` معرفی کند. برنامه
  فهرست را وقتی آدرس اصلی کار می‌کند یاد می‌گیرد — فهرستی که با کلید خود رله تأیید
  شده و کسی سر راه نمی‌تواند آدرسی به آن اضافه کند. اگر آدرس اصلی ۲۵ ثانیه پاسخ
  ندهد، آدرس پشتیبان باید ثابت کند به دارندهٔ کلیدِ همان رله می‌رسد، بعد اتصال از آن
  برقرار می‌شود؛ آدرس تنظیم‌شدهٔ شما دست نمی‌خورد و هر چند دقیقه دوباره امتحان
  می‌شود. CSP صفحه آدرس‌های پشتیبان را خودکار شامل می‌شود.
- **اتصال رله‌به‌رله با چند آدرس** — در `CHAT_TRANSIT_PEERS` می‌شود برای یک رله
  چند آدرس با `|` داد؛ به نوبت امتحان می‌شوند.
- **پراکسی در نسخهٔ نیتیو (ویندوز و لینوکس)** — v2ray، xray یا Tor محلی را در
  تنظیمات اتصال وارد کنید (`socks5://127.0.0.1:10808`)؛ پنجرهٔ برنامه و درخواست‌های
  خود برنامه از آن عبور می‌کنند و نام‌ها هم در پراکسی resolve می‌شوند. چون WebRTC
  روی UDP از پراکسی رد نمی‌شود، با پراکسی تماس‌ها و انتقال مستقیم فقط از مسیر رله
  برقرار می‌شوند تا آدرس شما به طرف مقابل نرسد. روی مک از پراکسی سیستم استفاده
  کنید و روی گوشی از برنامه‌ای مثل v2rayNG در حالت VPN.

- **Backup addresses for a relay.** An operator can list other addresses that
  reach the same relay (a second domain, a CDN) in `CHAT_MIRROR_ORIGINS`. The app
  learns the list while the main address works, authenticated by the relay's own
  key so nobody on the path can add to it. If the main address is silent for 25
  seconds, a mirror must prove it reaches the holder of that relay's key before
  the app connects through it; the configured address is kept and tried again
  every few minutes. The page's CSP includes the mirrors automatically.
- **Relay-to-relay links with several addresses**: `CHAT_TRANSIT_PEERS` takes
  `id@https://a|https://b`, tried in turn.
- **A proxy for the native app on Windows and Linux.** Enter a local v2ray, xray
  or Tor (`socks5://127.0.0.1:10808`) in the connection settings; the window and
  the app's own requests use it, with names resolved at the proxy. WebRTC over UDP
  does not go through a proxy, so while one is set calls and direct transfers go
  through the relay only. On a Mac, use the system proxy; on a phone, a VPN-mode
  client such as v2rayNG.

## ۴. محافظ صفحه · Screen guard

- یک کلید در تنظیمات امنیتی: روی **اندروید** سیستم جلوی اسکرین‌شات و ضبط صفحه را
  می‌گیرد و کارت برنامه در فهرست برنامه‌های اخیر خالی است (از اولین فریم اجرای بعد)؛
  روی **ویندوز و مک** پنجره از اسکرین‌شات، ضبط و اشتراک صفحه کنار گذاشته می‌شود؛ روی
  لینوکس، iOS و مرورگر چنین کلیدی در سیستم نیست، پس برنامه هر وقت پنهان شود یا از
  فوکوس خارج شود خودش را می‌پوشاند و صادقانه می‌گوید که جلوی اسکرین‌شاتِ پنجرهٔ باز را
  نمی‌شود گرفت.

- One switch in the security settings. **Android** refuses screenshots and
  recording and blanks the recent-apps card, from the first frame of the next
  start; **Windows and macOS** leave the window out of screenshots, recordings
  and screen sharing; on Linux, iOS, and browsers the system has no such switch,
  so the app covers itself whenever it is hidden or loses focus, and says that a
  screenshot of the open window cannot be stopped there.

## ۵. امکانات چت · Chat conveniences

- **قالب‌بندی متن** — `*پررنگ*`، `_کج_`، `~خط‌خورده~`، `` `کد` ``، بلوک کد، و
  `||متن پنهان||` که با لمس باز می‌شود؛ لینک‌ها قابل کلیک‌اند. میان‌برها: Ctrl/⌘+B و I،
  و Ctrl/⌘+Shift+X، M، P. نسخه‌های قدیمی همان علامت‌ها را نشان می‌دهند.
- **پیام‌های ذخیره‌شده** — یادداشت، لینک یا فایل برای خودتان، و هدایت هر پیام به
  آن. فقط روی دستگاه‌های خودتان می‌ماند و مستقیم بین آن‌ها همگام می‌شود؛ هیچ سروری
  چیزی از آن نمی‌بیند. از دکمهٔ نشانک بالای فهرست چت‌ها باز می‌شود.
- **ارسال زمان‌بندی‌شده** — از منوی + یا کلیک راست روی دکمهٔ ارسال. پیام روی همین
  دستگاه می‌ماند و سر وقت از همین دستگاه فرستاده می‌شود (اگر برنامه بسته باشد، با
  باز شدن بعدی)؛ دستگاه دیگر شما آن را «زمان‌بندی‌شده» نشان می‌دهد اما نسخهٔ دوم
  نمی‌فرستد.
- **موقعیت زنده** — ۱۵ دقیقه، ۱ ساعت یا ۸ ساعت. فقط یک کارت فرستاده می‌شود و
  به‌روزرسانی‌ها پین آن را جابه‌جا می‌کنند (هر ۲۵ متر حرکت یا دقیقه‌ای یک بار، حداکثر
  هر ۱۵ ثانیه)؛ برای کسی که آنلاین نیست حداکثر یکی در هر ۵ دقیقه در صف می‌ماند.
  توقف، پایان زمان و بستن برنامه اشتراک را در هر دو طرف تمام می‌کند. هیچ کاشی نقشه‌ای
  دانلود نمی‌شود.
- **پیش‌نمایش لینک (فقط دسکتاپ، پیش‌فرض خاموش)** — دستگاه فرستنده صفحه را باز
  می‌کند و عنوان و تصویر کوچک رمزنگاری‌شده همراه پیام می‌رود؛ دستگاه گیرنده هرگز به
  سایت وصل نمی‌شود. فقط آدرس‌های عمومی، بدون ریدایرکت به سایت دیگر، با سقف حجم و
  زمان؛ کارت فقط برای میزبانِ لینکی که در متن دیده می‌شود رسم می‌شود. با پراکسی و
  برای درخواست‌های پیام خاموش است.

- **Text formatting**: `*bold*`, `_italic_`, `~strike~`, `` `code` ``, code
  blocks, and `||spoilers||` revealed by a tap; links are clickable. Shortcuts:
  Ctrl/⌘+B and I, Ctrl/⌘+Shift+X, M, P. Older builds show the markers as typed.
- **Saved Messages**: notes, links, and files for yourself, and any message
  forwarded there. It stays on your own devices and syncs directly between them;
  no server sees any of it. Opened from the bookmark above the chat list.
- **Scheduled messages**, from the + menu or a right-click on Send. The message
  waits on this device and is sent from it at that time (or when the app next
  opens); your other device shows it as scheduled and never sends a second copy.
- **Live location** for 15 minutes, an hour, or eight hours. One card is sent and
  updates move its pin (every 25 m or once a minute, never more often than every
  15 seconds); at most one per five minutes is queued for somebody not connected.
  Stopping, running out, and closing the app end it on both sides. No map tiles
  are fetched.
- **Link previews (desktop only, off by default)**: the sender's device opens the
  page and its title and a small picture travel encrypted with the message; the
  recipient's device never contacts the site. Public addresses only, no redirect
  to another site, size and time caps; a card is drawn only for the host of a link
  visible in the text. Off behind a proxy and for message requests.

## ۶. رفع اشکال · Fixes

- **دکمهٔ «قطع اتصال» خودش دوباره وصل نمی‌شود** — اتصالی که هنگام زدن دکمه در
  جریان بود، بعد از تمام شدن دوباره آنلاین می‌شد؛ گرم کردن سشن در پس‌زمینه هم همین کار
  را می‌کرد.
- کلیدهای مکالمه‌ای که مال خود دستگاه‌اند (پیام‌های ذخیره‌شده، اعلان‌های سیستم) از
  شناسهٔ گروه، شناسهٔ همتا یا هدف ویرایشی که از بیرون می‌رسد محافظت می‌شوند.

- **Disconnect stays disconnected.** A connect already in flight when the button
  was pressed came back online when it finished, and so did a session warm-up in
  the background.
- Conversation keys that belong to this device (Saved Messages, the
  announcements thread) are refused as remote group ids, peer ids, or edit targets.

## راه‌اندازی · Operator notes

- `CHAT_MIRROR_ORIGINS` (اختیاری): آدرس‌های پشتیبان، با فاصله یا کاما. هر آدرس باید با
  گواهی معتبر برای نام خودش به همین سرور برسد — CDN در حالت TLS کامل این کار را
  می‌کند. / Optional backup addresses, space- or comma-separated; each must reach
  this server with a certificate valid for its name (a CDN in full TLS mode does).
- سرور باید با این نسخه به‌روز شود تا فرستندهٔ پنهان، آدرس‌های پشتیبان و پس‌گرفتن پیام
  با رمز کار کنند. / The relay must be updated for sealed sender, mirrors and
  secret-based withdrawal; clients fall back to the old shapes against an old relay.
