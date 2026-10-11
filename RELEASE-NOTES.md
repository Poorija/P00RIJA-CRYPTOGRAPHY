# P00RIJA Cryptography 2.98.27

Version 2.98.27 · build chat-v120

این نسخه حاصل یک ممیزی کامل روی دو رلهٔ واقعی (فنلاند و ایران) است: هر یافته
فیکس شد، مسیر تماس و فایل هوشمند شد، گروه‌ها بین دو رله کار می‌کنند، و
همگام‌سازی چند دستگاهی دستگاه‌به‌دستگاه شد بی‌آنکه سروری چیزی برای دستگاه دیگر
نگه دارد. متن هر بخش اول فارسی است و بعد انگلیسی.

This release comes from a full audit of the two production relays (Finland and
Iran): every finding fixed, a measured route for calls and files, groups that
work across relays, and multi-device sync that runs device to device with no
server keeping anything for the other device. Each section is Persian first,
English after.

---

## ۱. پیامی که بی‌صدا گم نمی‌شود · Messages that no longer vanish quietly

- **پیام در رلهٔ اشتباه دیگر «تحویل شده» نشان داده نمی‌شود** — وقتی رلهٔ خانگی
  مخاطب معلوم نبود، پیام در رلهٔ خودت صف می‌شد و تیک «ارسال شد» می‌گرفت، در حالی
  که گیرنده هرگز به آن رله وصل نمی‌شد. حالا رله می‌گوید این گیرنده را نمی‌شناسد،
  برنامه از رله‌های متصل می‌پرسد او کجا زندگی می‌کند، پیام‌های پارک‌شده را از
  مسیر درست دوباره می‌فرستد و نسخه‌های سرگردان را پس می‌گیرد.
- **خطای لحظه‌ای لینک بین دو رله پیام را ناموفق نمی‌کند** — پیام در صف می‌ماند و
  تا یک روز با فاصلهٔ فزاینده خودکار دوباره فرستاده می‌شود؛ به‌محض اولین پاسخ لینک،
  صف جلو می‌افتد.
- **باگ رله در پنجرهٔ وصل‌شدن دوبارهٔ لینک** — پاکتی که در آن لحظه می‌رسید پارک
  می‌شد و بعد روی متغیرِ تهی فرستاده می‌شد؛ همه با خطا ناموفق می‌شدند. فیکس شد.
- **لینک مرده در ~۳۰ ثانیه شناخته می‌شود** (قبلاً تا ~۷۵ ثانیه) و پاکت‌های بی‌پاسخش
  همان لحظه برای ارسال دوباره آزاد می‌شوند.
- **تکه‌های فایل بین دو رله** شماره‌دار، با پنجرهٔ کنترل سرعت و ارسال دوبارهٔ
  تکهٔ گمشده؛ گیرنده هم می‌تواند تکه‌های گمشده را از مسیر رله بخواهد.
- **تماس با مخاطب آفلاینِ رلهٔ دیگر** به‌جای ۴۵ ثانیه زنگِ بی‌حاصل، به حالت
  «زنگ برای مخاطب آفلاین» می‌رود و به‌محض برگشتن او برقرار می‌شود.

- **A message parked at the wrong relay no longer shows as delivered.** The relay
  now says when it queues for a stranger; the app asks the linked relays where
  that person lives, re-sends the parked messages the right way and withdraws
  the stray copies.
- **A transit hiccup no longer fails a message**: it stays queued and is retried
  with backoff for up to a day, brought forward the moment the link answers.
- **The relay's redial-window bug** (a parked envelope sent on a null link) is
  fixed; a dead link is noticed in ~30 s instead of ~75 s, and its unanswered
  envelopes are released for retry at once.
- **File chunks across relays** are tagged, paced and re-sent when lost; the
  receiver can ask for missing chunks over the relay too.
- **Calling an offline contact on another relay** turns into the offline ring and
  connects when they come back, instead of ringing nobody for 45 seconds.

## ۲. گروه بین دو رله · Groups across relays

- **هر عضو به هر عضو می‌رسد** — فهرست گروه فقط اثرانگشت اعضا را داشت؛ عضوی که
  مخاطب مستقیم نبود بی‌صدا جا می‌افتاد و در گروهی با اعضای فنلاند و ایران، فقط کسانی
  که کارت هم را داشتند صدای هم را می‌شنیدند. حالا با فهرست گروه یک «کارت عضو»
  برای هر عضو می‌رود (کلید عمومی + رلهٔ خانگی، کلید با اثرانگشت چک می‌شود) و عضو
  ناآشنا به‌صورت ساکت نگه داشته می‌شود — بدون باز شدن چت جدید.
- **کد دعوت** رلهٔ دعوت‌کننده و کارت اعضا را نگه می‌دارد.
- **حریم خصوصی** — اطلاعات گروه دیگر برای هر کسی که آنلاین می‌شد فرستاده نمی‌شود،
  فقط برای اعضا.

- **Every member reaches every member**: rosters carry a verified card per member
  (public key + home relay; the key must hash to the fingerprint), so members
  who never swapped cards can seal to each other on either relay.
- **Invite codes keep the inviter's relay** and carry member cards.
- **Privacy**: a group's record is no longer pushed at every peer that comes online.

## ۳. مسیر هوشمند برای تماس و فایل · A measured route for calls and files

- **اول P2P، اگر پایدار بود** — ICE مسیر مستقیم را ترجیح می‌دهد؛ برنامه حالا
  می‌سنجد که آن مسیر *دوام* می‌آورد یا نه. اندازه‌گیری روی سرورها نشان داد جریان UDP
  که از داخل ایران شروع شود بعد از ۷ تا ۹ بسته قطع می‌شود؛ مسیر مستقیمی که این‌طور
  می‌میرد یا ضعیف می‌ماند با یک ICE restart به مسیر رله منتقل می‌شود و آن مخاطب
  یک روز به خاطر سپرده می‌شود تا تماس بعدی مستقیم از مسیر رله شروع شود.
- **TURN مشترک، فقط برای همان تماس یا انتقال** — برای ارتباط بین دو رله، از رلهٔ
  مخاطب یک اعتبارنامهٔ کوتاه‌مدت TURN گرفته و فقط به همان اتصال اضافه می‌شود تا هر
  دو طرف روی یک TURN به هم برسند؛ پروفایل دست نمی‌خورد و با پایان تماس از بین می‌رود.
- **کانال مستقیم داده بین دو رله** — پیام و فایل بین دو نفر روی دو رلهٔ مختلف حالا
  از کانال مستقیم (یا TURN) می‌رود، نه تکه‌تکه از رله‌ها.
- **اعتبارنامهٔ TURN زمان‌دار (TURN REST)** — `/turn-config` دیگر رمز ثابت coturn را
  به همه نمی‌دهد؛ هر کلاینت اعتبارنامهٔ منقضی‌شونده می‌گیرد و پیش از انقضا تازه می‌کند.
- **TURNS روی سرور ایران دوباره روشن است** — کلید TLS برای coturn قابل خواندن نبود؛
  دیپلوی و تمدیدکنندهٔ گواهی حالا مالکیت را درست و coturn را ری‌استارت می‌کنند.

- **Direct first, if it holds**: the selected pair is watched; a direct path that
  dies or stays poor moves to a relay path once, and the contact is remembered
  for a day. (Measured: a UDP flow started from inside Iran is cut after 7–9
  packets.)
- **A shared TURN, for that connection only**: a short-lived credential from the
  contact's relay is added to the one call or transfer that needs it.
- **A live data channel across relays** carries sessions, messages and files.
- **TURN REST**: expiring credentials instead of the static coturn pair.
- **TURNS on the Iran server is back** (coturn could not read its key).

## ۴. چند دستگاه، دستگاه‌به‌دستگاه · Several devices, device to device

- **سرور برای دستگاه آفلاین چیزی نگه نمی‌دارد** — دستگاهی که هم‌اکانت داشت رسید
  پیام‌ها را تا برگشتن همهٔ دستگاه‌ها نگه می‌داشت و رله همه‌چیز را — حتی تکه‌های
  فایل — هفته‌ها نگه می‌داشت. رسید حالا فوری است.
- **beacon رمزنگاری‌شده (حداکثر ۸ کیلوبایت)** — هر دستگاه یک خلاصهٔ رمزنگاری‌شده با
  کلید خود اکانت روی رله می‌گذارد: زمان آخرین پیام هر گفتگو (با نام هش‌شده) و
  رلهٔ خانگی دستگاه؛ هیچ متن، نام یا فایلی. دستگاه برگشته می‌فهمد عقب است و به‌محض
  آنلاین بودن هر دو، فقط تغییرات را مستقیم از دستگاه دیگر می‌گیرد.
- **پیام فرستاده‌شده روی یک دستگاه** فوراً روی دستگاه‌های آنلاین دیگر دیده می‌شود.
- **فایل‌ها** فقط به درخواست شما و فقط وقتی هر دو دستگاه آنلاین‌اند منتقل می‌شوند؛
  وگرنه ردیف پیام می‌گوید فایل روی دستگاه دیگر است.

- **No server keeps anything for an absent device**: acknowledgements are
  immediate; the relay no longer holds mail (file chunks included) for siblings.
- **An encrypted beacon of at most 8 KB** per device tells a returning device it
  is behind; deltas then come straight from a sibling while both are online.
- **Sent messages are mirrored live** to the account's other online devices.
- **Files sync only when asked, and only while both devices are online.**

## ۵. امنیت · Security

- رمز مانیتور فقط به‌صورت هش scrypt ذخیره می‌شود (قبلاً متن ساده بود).
- origin که رله به کلاینت‌های رلهٔ دیگر اعلام می‌کند دیگر از هدر Host قابل جعل نیست.
- یک بروزرسانی حضور دیگر بلاک، بی‌صدا، آرشیو و تایمر پیام را پاک نمی‌کند.
- کارت مخاطبی که فوروارد می‌شود دیگر «حدس» رلهٔ خانگی را به «کارت» ارتقا نمی‌دهد.

- The monitor password is stored only as a scrypt hash.
- The origin a relay repeats to linked relays can no longer be set by a Host header.
- A presence update no longer clears block, mute, archive and the message timer.
- Forwarding a contact card no longer launders a relay hint into a card.

## ۶. زیر کاپوت · Under the hood

- `standalone-relay` همان برنامهٔ رلهٔ اصلی را اجرا می‌کند (نسخهٔ جداگانه‌اش عقب
  افتاده بود)؛ پورت اشغالِ نصب‌کنندهٔ bootstrap دیگر رله را از کار نمی‌اندازد.
- **گواهی‌ها با Let's Encrypt (رایگان)** صادر و ۱۰ روز مانده به انقضا خودکار تمدید
  می‌شوند؛ آستانهٔ خود certbot هم روی ۱۰ روز هم‌گام می‌شود. اسکریپت تمدیدکننده با هر
  دیپلوی به سرور می‌رسد و تاریخ openssl را زیر busybox درست می‌خواند (قبلاً هر شش
  ساعت گواهی سالم را «ناموجود» گزارش می‌کرد).
- nginx آدرس `/transit-peers` را به رله می‌رساند و ابزار تازهٔ
  `tools/check-nginx-routes.cjs` جلوی دیپلوی مسیری را می‌گیرد که nginx نمی‌شناسد.
- نوشتن صندوق نامه حداکثر ظرف یک ثانیه روی دیسک است؛ فایل‌های موقت جامانده جارو می‌شوند.
- سوئیت‌های جدید: پرسش‌های بین‌رله‌ای (۲۷ چک)، گروه بین دو رله (۱۶)، مسیر هوشمند و
  کانال داده (۱۵)، beacon چند دستگاهی (۱۰).

- `standalone-relay` now runs the deployed relay program; a busy bootstrap port
  no longer kills the relay.
- **Let's Encrypt certificates (free)** are issued automatically and renewed
  when ten days are left; certbot's own window is kept in step. The renewer's
  script ships with every deploy and reads openssl's date under busybox (it
  used to call a healthy certificate missing every six hours).
- nginx routes `/transit-peers` to the relay, and `tools/check-nginx-routes.cjs`
  stops a deploy that would send a relay path to the single-page app.
- Mailbox writes reach disk within a second; leftover temp files are swept.
- New suites: transit queries (27), groups across relays (16), smart path and
  data link (15), device beacon (10).

---

## بررسی صحت فایل‌ها · Verifying the downloads

روی مک · on macOS:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

روی لینوکس · on Linux:

```bash
sha256sum -c SHA256SUMS.txt
```

روی ویندوز (PowerShell) · on Windows:

```powershell
Get-FileHash ".\P00RIJA Cryptography_2.98.27_x64-setup.exe" -Algorithm SHA256
```

برای یک فایل تکی، چک‌سام را با سطر مربوط به همان فایل در `SHA256SUMS.txt`
مقایسه کنید. اگر نخواند، نصبش نکنید و دوباره دانلود کنید.
For a single file, compare the hash against that file's line in
`SHA256SUMS.txt`. If it does not match, do not install it — download again.

---

AGPL-3.0-only · P00RIJA · p00rija@tutamail.com
