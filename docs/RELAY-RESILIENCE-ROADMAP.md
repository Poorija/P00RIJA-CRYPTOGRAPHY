# برنامهٔ تاب‌آوری شبکهٔ رله‌ها — وضعیت و نقشهٔ راه · Relay network resilience — status and roadmap

آخرین به‌روزرسانی: ۷ نوامبر ۲۰۲۶، نسخهٔ 2.98.90 · Last updated: 7 November 2026, version 2.98.90

متن اول فارسی است و بعد انگلیسی. · Persian first, English after.

---

## فارسی

### هدف

رله‌های یک اپراتور مثل یک شبکهٔ واحد کار کنند: اگر رلهٔ یک کاربر قطع شد، کاربر بی‌پیام نماند؛ رلهٔ تازه بدون دست بردن در تنظیمات همهٔ سرورها به شبکه اضافه شود؛ کاربر روی رله‌ای بنشیند که از جای خودش در دسترس‌تر و خلوت‌تر است؛ و نسخهٔ تازه امن و خودکار به همهٔ رله‌ها برسد.

مدل واقعی «رلهٔ خانهٔ ثابت + رلهٔ مهمان موقت» است، نه جابه‌جایی دائمی کاربر بین رله‌ها. صندوق پیام، مسیر مخاطب‌ها و اعلان push به رلهٔ خانه بسته‌اند. جابه‌جایی دائمی، خطر گم شدن پیام را خیلی بالا می‌برد.

این برنامه در ۲۳ اکتبر ۲۰۲۶ با چهار فاز و یک بخش اختیاری نوشته شد. ترتیب پیشنهادی آن روز: فاز ۱ ← فاز ۲ ← فاز ۴ ← فاز ۳.

### خلاصهٔ وضعیت

| فاز | کار | وضعیت |
|---|---|---|
| ۱ | فهرست امضاشدهٔ رله‌ها | 🟡 نیمه‌کاره: سمت رله‌ها کامل، سمت برنامهٔ کاربر انجام نشده |
| ۲ | حالت مهمان (failover) | ❌ شروع نشده |
| ۳ | انتخاب هوشمند رله و پخش بار | ❌ شروع نشده |
| ۴ | پخش زنجیره‌ای آپدیت | 🟢 بیشترش انجام شده؛ بررسی سلامت با برگشت خودکار و پخش مرحله‌ای مانده |
| اختیاری | کپی صندوق روی رلهٔ دوم | ❌ شروع نشده |

### زیربنایی که پیش از این برنامه بود

- **لینک بین رله‌ها:** رمزنگاری‌شده و پساکوانتومی (هیبرید)، با heartbeat و اتصال دوباره.
- **کار کامل بین رله‌ها:** پیام، حضور، تماس، گروه و چنددستگاهی بین کاربران رله‌های مختلف.
- **پیدا کردن رلهٔ مخاطب (`route-query`):** رله از همتاهایش می‌پرسد «این شخص پیش توست؟». کلید اصلی حالت مهمان همین است.
- **رلهٔ خانهٔ هر مخاطب:** در کارت مخاطب ثبت است و ادعای آن بر اساس کانالی که از آن رسیده رتبه‌بندی می‌شود (`tests/e2e/homerelay.mjs`).
- **آدرس‌های جایگزین یک رله (mirror و «در ورودی»):** کلاینت بعد از ۲۵ ثانیه سکوت به آدرس دیگری از **همان رله** می‌رود، کلید رله را آزمون می‌کند و هر ۵ دقیقه به آدرس اصلی سر می‌زند (`js/chat/52-relay-mirrors.js`).
- **`/transit-peers`:** شناسه، کلید و آدرس رله‌های لینک‌شده. کلاینت فعلاً فقط برای پیدا کردن مسیر مخاطب از آن استفاده می‌کند (`js/chat/40-route-finder.js`).
- **رله نزدیک سقف ظرفیت:** `/ready` پاسخ ۵۰۳ می‌دهد تا load balancer کاربر تازه نفرستد.

### فاز ۱ — فهرست امضاشدهٔ رله‌ها

**هدف:** یک کلید «اپراتور» فهرست رله‌ها را امضا می‌کند. رله‌ها عضویت مش را از همین فهرست می‌خوانند و کلاینت هم فهرست را می‌گیرد و امضایش را چک می‌کند. اضافه کردن رلهٔ تازه یعنی امضای فهرست تازه، نه ویرایش `.env` همهٔ سرورها.

**انجام شده:**

| نسخه | چه چیزی |
|---|---|
| 2.98.76 | خانوادهٔ رله‌ها: فهرست امضاشده با کلید اپراتور (شناسه، کلید، آدرس‌ها، منطقه، جای Gateway)، شمارهٔ سریال و کف آن، فهرست ابطال، پخش و دریافت فهرست بین رله‌ها، و `/relay-directory` عمومی (`scripts/lib/relay-directory.js`، `tools/relay-directory.mjs`) |
| 2.98.77 | اتصال به خانوادهٔ اپراتورهای دیگر از راه Gatewayها، با پذیرش طرف مقابل (شریک‌ها) |
| 2.98.79–2.98.80 | خوشه‌ها و نشانی‌های داخلی در فهرست؛ اعضای یک خوشه اول از نشانی داخلی همدیگر را می‌گیرند؛ راه دوم بین سرورهای یک خانواده |
| 2.98.85 | مدیریت فهرست خانواده، خوشه‌ها، کلیدهای مدیر و کلید اپراتور از پنل مرکزی، با امضای مرورگر |
| 2.98.89–2.98.90 | نشانی داخلی (IP) برای سرورهای خارج از ایران هم، برای وقتی DNS از کار بیفتد؛ ادغام و جابه‌جایی خوشه؛ چند مدیر با کلید خودشان |

**مانده — سمت برنامهٔ کاربر:** برنامه هنوز `/relay-directory` را نمی‌گیرد. رله‌های دیگر را فقط از `/transit-peers` و آدرس‌های جایگزین رلهٔ خودش می‌شناسد. کارهای لازم:

1. **لنگر اعتماد:** کلید اپراتور در نخستین اتصال موفق به رلهٔ خانه، یا از لینک دعوت یا QR، ثبت می‌شود و پس از آن هیچ رله‌ای نمی‌تواند عوضش کند. عوض شدن کلید اپراتور برای کلاینت قاعدهٔ خودش را می‌خواهد، مثلاً اعلامیه‌ای که کلید قبلی امضا کرده و کلید تازه را نام می‌برد. چرخش کلید در پنل فعلاً فقط رله‌ها را، سرور به سرور و از راه SSH، عوض می‌کند.
2. **گرفتن و بررسی:** گرفتن `/relay-directory` از رلهٔ خانه (و از هر رلهٔ دیگر فهرست وقتی خانه جواب نمی‌دهد)؛ بررسی امضا، شناسهٔ اپراتور و سریال صعودی با همان قواعد `relay-directory.js` (کد مشترک یا معادل مرورگری‌اش)؛ نگه داشتن آخرین فهرست معتبر در IndexedDB.
3. **استفاده:** فهرست، نامزدهای فاز ۲ و ۳ را می‌دهد. کلید هر رله از فهرست می‌آید، نه از خود رله.
4. **رابط کاربری:** در تنظیمات اتصال، رله‌های خانواده و رلهٔ خانه دیده شوند.
5. **تست:** فهرست با امضای نادرست، سریال قدیمی‌تر، کلید اپراتور دیگر و رلهٔ ابطال‌شده رد شود؛ فهرست بی‌اتصال هم از IndexedDB خوانده شود.

تخمین: ۲ تا ۳ روز.

### فاز ۲ — حالت مهمان (failover)

**هدف:** وقتی رلهٔ خانه قطع است، کلاینت با همان هویت روی رلهٔ دیگری از فهرست ثبت‌نام موقت می‌کند، و پیام‌های تازه به آن‌جا می‌رسند. وقتی خانه برگشت، کلاینت برمی‌گردد و از هر دو صندوق تحویل می‌گیرد.

**وضعیت:** شروع نشده. پیش‌نیازش فهرست سمت کلاینت در فاز ۱ است.

**طرح:**

1. **تشخیص قطعی:** همان منطق فعلی (۲۵ ثانیه سکوت)، پس از آن‌که همهٔ آدرس‌های جایگزین رلهٔ خانه هم آزموده شدند.
2. **انتخاب رلهٔ مهمان:** از فهرست امضاشده، با کلیدی که فهرست برای آن رله داده. اول هم‌خوشه‌ای‌ها، بعد بقیه. اگر فاز ۳ آماده باشد، بر اساس امتیاز آن.
3. **ثبت‌نام موقت:** hello با علامت «مهمان»، شناسهٔ رلهٔ خانه، و اثبات هویت همان کلید کاربر. رلهٔ مهمان فقط کاربرانی را می‌پذیرد که رلهٔ خانه‌شان در فهرست همان خانواده است، با سهمیه و مدت محدود.
4. **مسیریابی:** رلهٔ مهمان به `route-query` پاسخ «پیش من است، به‌عنوان مهمان» می‌دهد. پیام‌های تازه به آن‌جا می‌روند و پیام‌هایی که در راه رلهٔ خانه بودند در صندوق خانه می‌مانند.
5. **اعلان push:** ثبت دوبارهٔ اشتراک push روی رلهٔ مهمان، و برداشتنش هنگام برگشت.
6. **چنددستگاهی، گروه‌ها و تماس:** هر دستگاه جدا مهمان می‌شود؛ گروه‌ها از راه `route-query` عضو مهمان را پیدا می‌کنند؛ اعتبار TURN از رلهٔ مهمان گرفته می‌شود.
7. **برگشت:** کلاینت هر چند دقیقه رلهٔ خانه را می‌آزماید. وقتی خانه برگشت، کلاینت دوباره به آن ثبت‌نام می‌کند، صندوق رلهٔ مهمان را تحویل می‌گیرد، ثبت‌نام مهمان را می‌بندد و پیام‌های تکراری با شناسهٔ پیام کنار گذاشته می‌شوند.
8. **رابط کاربری:** نشانگر «موقتاً روی رلهٔ X»، و کلیدی در تنظیمات که حالت مهمان را خاموش کند.
9. **حریم خصوصی:** رلهٔ مهمان همان چیزی را می‌بیند که رلهٔ خانه می‌بیند (IP و آدرس‌دهی پیام‌ها، نه محتوا). این در راهنما گفته شود.
10. **تست:** خاموش کردن رلهٔ خانه در میانهٔ گفتگو؛ رسیدن پیام تازه به کاربر مهمان؛ برگشت و تحویل از هر دو صندوق بدون تکرار؛ گروه و تماس در حالت مهمان؛ رد شدن کاربر غریبه از رلهٔ مهمان.

تخمین: ۱ تا ۲ هفته.

### فاز ۳ — انتخاب هوشمند رله و پخش بار

**هدف:** کلاینت تأخیر و پایداری هر رله را از جای خودش می‌سنجد، و هر رله بار خودش را اعلام می‌کند. کاربر تازه روی کم‌بارترین رلهٔ در دسترس می‌نشیند، و رلهٔ پر به‌جای رد کردن خشک، کاربر را به رلهٔ خلوت (به‌صورت مهمان) می‌فرستد.

**وضعیت:** شروع نشده. فقط `/ready` با پاسخ ۵۰۳ نزدیک سقف وجود دارد.

**طرح:**

1. **اعلام بار:** رله در `/relay-directory` یا یک نقطهٔ سبک کنارش، بار فعلی را به‌صورت عدد تقریبی منتشر کند (اتصال‌ها نسبت به سقف، صف، پردازنده)، بدون هیچ اطلاعاتی از کاربران.
2. **سنجش از دستگاه کاربر:** کلاینت در پس‌زمینه و کم‌مصرف، تأخیر و موفقیت اتصال به هر رلهٔ فهرست را می‌سنجد و نتیجه فقط روی همان دستگاه می‌ماند. برای کاربر داخل ایران، دسترس‌پذیری (فیلترینگ) بیشترین وزن را دارد.
3. **امتیاز:** ترکیب دسترس‌پذیری، تأخیر، پایداری چند روز اخیر و بار اعلام‌شده.
4. **کاربر تازه:** انتخاب رلهٔ خانه بر اساس امتیاز، نه فقط آدرسی که برنامه از آن باز شده.
5. **رلهٔ پر:** به‌جای ۵۰۳ خشک، فهرست رله‌های خلوت را برمی‌گرداند و کلاینت به‌صورت مهمان (فاز ۲) به یکی از آن‌ها می‌رود.
6. **تست:** رلهٔ پر کاربر تازه را به رلهٔ خلوت بفرستد؛ رلهٔ فیلترشده از جای کاربر انتخاب نشود؛ هیچ داده‌ای از سنجش از دستگاه بیرون نرود.

تخمین: ۳ تا ۵ روز.

### فاز ۴ — پخش زنجیره‌ای آپدیت

**هدف:** هر نسخه امضا شود. رله‌ای که نسخهٔ تازه گرفت به بقیه خبر بدهد. هر رله بسته را بگیرد، امضا را چک کند، پشتیبان بگیرد و نصب کند، و پس از نصب سلامتش سنجیده شود و اگر خراب بود خودکار برگردد. پخش مرحله‌ای باشد.

**انجام شده (2.98.88، با بهبودهای 2.98.89 و 2.98.90):**

- **بستهٔ امضاشده:** شامل manifest، امضا، درخت برنامه و ایمیج‌ها. با کلید اپراتور امضا می‌شود و رله بستهٔ بی‌امضا، دست‌کاری‌شده یا قدیمی‌تر از نسخهٔ فعلی را نمی‌پذیرد (`scripts/lib/update-package.js`).
- **پخش زنجیره‌ای بین اعضای خانواده:** با احراز هویت لینک‌های خانواده، پس سروری که پنل به آن دسترسی ندارد هم به‌روز می‌شود (`scripts/lib/relay-updates.js`).
- **زمان نصب:** هوشمند (کم‌کاربرترین ساعت)، در زمان مشخص، یا همین حالا. زمان فقط وقتی بین رله‌ها پخش می‌شود که اپراتور امضایش کرده باشد.
- **خبر به کاربران:** دو دقیقه پیش از نصب، به کاربران آنلاین گفته می‌شود سرور در حال به‌روزرسانی است.
- **پشتیبان پیش از نصب:** در `scripts/apply-update.sh`. نسخهٔ قدیمی‌تر رد می‌شود، امضا دوباره چک می‌شود و هیچ تلاش خودکار دوباره‌ای در کار نیست.
- **از پنل مرکزی:** ساخت بسته از پوشه، فایل فشرده، گیت‌هاب یا «ساخت و بسته‌بندی»؛ فرستادن به سرورها؛ و نصب از راه SSH روی سروری که هنوز به‌روزرسان ندارد.
- **برنامهٔ کاربر:** PWA از service worker رلهٔ جدید به‌روز می‌شود، و برنامهٔ نیتیو فقط فایل دقیقاً هم‌نوع خودش را دانلود و با `SHA256SUMS` چک می‌کند.

**مانده:**

1. **بررسی سلامت پس از نصب و برگشت خودکار:** پشتیبان پیش از نصب گرفته می‌شود، ولی برگرداندنش هنوز دستی است (`scripts/server-backup.sh --restore`). کار لازم این است که پس از بالا آمدن، `/chat-health`، رسیدن لینک‌های خانواده و نسخهٔ سرو‌شده سنجیده شوند؛ اگر در زمان معین سالم نشد، همان پشتیبان خودکار برگردد و به پنل و تلگرام گزارش شود.
2. **پخش مرحله‌ای:** اول یک رله (قناری)، و فقط اگر آن رله در مدت معین سالم ماند، بقیه. پیشنهاد: جای قناری در سیاست امضاشده بیاید و رله‌های دیگر تا گزارش سلامت قناری صبر کنند.
3. **(اختیاری) کلید جدا برای انتشار:** فعلاً کلید اپراتور بسته را امضا می‌کند. اگر رله‌های اپراتورهای دیگر هم بخواهند از نسخهٔ توسعه‌دهنده آپدیت بگیرند، یک کلید جدا برای انتشار لازم است.

تخمین مانده: ۲ تا ۴ روز.

### اختیاری — کپی صندوق روی رلهٔ دوم

**هدف:** پیام‌هایی که پیش از قطع شدن روی رلهٔ خانه مانده‌اند، بدون این بخش تا برگشتن آن رله در دسترس نیستند. با کپی رمزشده روی یک رلهٔ دوم (ترجیحاً هم‌خوشه)، حتی آن‌ها هم در حالت مهمان می‌رسند.

**وضعیت:** شروع نشده. پیش‌نیاز: فاز ۲.

**طرح کوتاه:** هنگام صف شدن یک پیام آفلاین، رلهٔ خانه یک کپی (همان پاکت رمزشده) را از راه لینک خانواده به یک رلهٔ دوم می‌سپارد؛ تحویل از هر کدام دیگری را پاک می‌کند؛ شناسهٔ پیام از تکرار جلوگیری می‌کند؛ سهمیه و مدت نگه‌داری همان قواعد صندوق اصلی است.

تخمین: حدود ۱ هفته.

### ترتیب پیشنهادی برای ادامه

1. سمت برنامهٔ فاز ۱ (۲ تا ۳ روز)
2. فاز ۲، حالت مهمان (۱ تا ۲ هفته). بیشترین سود، یعنی ادامهٔ کار کاربر وقتی رله‌اش قطع است، همین‌جاست.
3. مانده‌های فاز ۴: برگشت خودکار و پخش مرحله‌ای (۲ تا ۴ روز)
4. فاز ۳ (۳ تا ۵ روز). وقتی معنی پیدا می‌کند که تعداد کاربران به سقف ظرفیت رله‌ها نزدیک شود.
5. کپی صندوق (حدود ۱ هفته)

### برنامه‌های دیگر در صف

- **کار پشت Cloudflare (تحلیل‌شده، فعلاً کنار گذاشته شده):**
  - فاز ۱: IP واقعی کاربر با `realip` فقط برای بازه‌های Cloudflare، یک نام جدا برای مسیر Cloudflare، و بسته بودن مسیرهای مدیریتی روی آن نام.
  - فاز ۲: یک nginx لبه با مسیریابی SNI، فقط اگر پورت ۴۴۳ باید با برنامهٔ دیگری روی همان سرور مشترک باشد.
  - فاز ۳: مدیریت مسیرها از پنل مرکزی با بررسی و برگشت خودکار.
  - TURN و Reality هرگز از Cloudflare نمی‌گذرند.

---

## English

### The aim

An operator's relays work as one network: when a user's relay goes down the user is not left without messages; a new relay joins without editing every server's settings; a user sits on the relay that is most reachable and least loaded from where they are; and a new version reaches every relay safely and by itself.

The workable model is "a fixed home relay plus a temporary guest relay", not users moving between relays for good. A mailbox, the routes to a user's contacts, and push are tied to the home relay. Moving users for good raises the risk of losing messages a great deal.

The plan was written on 23 October 2026 in four phases and an optional part. The order suggested that day was phase 1, then 2, then 4, then 3.

### Status at a glance

| Phase | Work | Status |
|---|---|---|
| 1 | Signed relay directory | 🟡 Partly done: relay side complete, app side not started |
| 2 | Guest mode (failover) | ❌ Not started |
| 3 | Smart relay choice and load spreading | ❌ Not started |
| 4 | Chained updates | 🟢 Mostly done; health check with automatic revert, and a staged rollout, remain |
| Optional | A mailbox copy on a second relay | ❌ Not started |

### What was there before the plan

- **Links between relays:** encrypted, post-quantum (hybrid), with heartbeats and reconnection.
- **Everything works across relays:** messages, presence, calls, groups, and several devices between users of different relays.
- **Finding a contact's relay (`route-query`):** a relay asks its peers "is this person with you?". This is the key piece for guest mode.
- **Each contact's home relay:** kept in the contact card, the claim ranked by the channel it came over (`tests/e2e/homerelay.mjs`).
- **A relay's other addresses (mirrors and front doors):** after 25 seconds of silence the client moves to another address of **the same relay**, tests the relay's key, and goes back to the main address every five minutes (`js/chat/52-relay-mirrors.js`).
- **`/transit-peers`:** the ids, keys, and addresses of the linked relays. The client uses it only to find a contact's route today (`js/chat/40-route-finder.js`).
- **A relay near its capacity:** `/ready` answers 503 so that a load balancer sends it no new users.

### Phase 1 — a signed relay directory

**Aim:** an "operator" key signs the list of relays. Relays read mesh membership from it, and the client fetches it and checks its signature. Adding a relay means signing a new list, not editing every server's `.env`.

**Done:**

| Version | What |
|---|---|
| 2.98.76 | Relay families: the list signed with the operator key (id, key, addresses, region, gateway place), a serial and its floor, revocations, the list passed between relays both ways, and a public `/relay-directory` (`scripts/lib/relay-directory.js`, `tools/relay-directory.mjs`) |
| 2.98.77 | Linking with other operators' families through their gateways, once the other side approves (partners) |
| 2.98.79–2.98.80 | Clusters and inside addresses in the list; cluster mates try each other's inside addresses first; a second way between a family's servers |
| 2.98.85 | The family list, clusters, admin keys, and the operator key managed from the central panel, signed in the browser |
| 2.98.89–2.98.90 | Inside (IP) addresses for servers outside Iran too, for when DNS is gone; merging clusters and moving servers between them; several admins, each with their own key |

**Left — the app side:** the app does not fetch `/relay-directory` yet. It knows other relays only from `/transit-peers` and its own relay's other addresses. To do:

1. **A trust anchor:** the operator key is recorded at the first successful connection to the home relay, or from an invite link or QR code, and no relay can change it after that. A change of operator key needs its own rule for the client, such as a statement signed by the old key that names the new one. The panel's key rotation changes only the relays today, server by server over SSH.
2. **Fetch and check:** fetch `/relay-directory` from the home relay (and from any other relay of the list when home does not answer); check the signature, the operator id, and a rising serial with the same rules as `relay-directory.js` (shared code or a browser equivalent); keep the last valid list in IndexedDB.
3. **Use:** the list gives phases 2 and 3 their candidates. Each relay's key comes from the list, not from the relay itself.
4. **Interface:** the connection settings show the family's relays and the home relay.
5. **Tests:** a list with a wrong signature, an older serial, another operator's key, or a revoked relay is refused; with no connection the list is read from IndexedDB.

Estimate: 2 to 3 days.

### Phase 2 — guest mode (failover)

**Aim:** when the home relay is down, the client registers temporarily, with the same identity, on another relay of the list, and new messages reach it there. When home is back, the client returns and collects from both mailboxes.

**Status:** not started. It needs the app-side list of phase 1 first.

**Design:**

1. **Detecting the outage:** the logic there is today (25 seconds of silence), once every other address of the home relay was tried as well.
2. **Choosing the guest relay:** from the signed list, with the key the list gives for it; cluster mates first, then the rest; by phase 3's score once that exists.
3. **A temporary registration:** a hello marked "guest", with the home relay's id and proof of the user's own key. A guest relay takes only users whose home relay is in the same family's list, within a quota and for a limited time.
4. **Routing:** the guest relay answers `route-query` with "here, as a guest". New messages go there; those already on their way to the home relay stay in its mailbox.
5. **Push:** the push subscription is registered again on the guest relay, and removed on return.
6. **Several devices, groups, and calls:** each device becomes a guest on its own; groups find a guest member through `route-query`; TURN credentials come from the guest relay.
7. **Returning:** the client tries the home relay every few minutes. When home is back it registers there again, collects the guest relay's mailbox, closes the guest registration, and drops duplicates by message id.
8. **Interface:** a "temporarily on relay X" badge, and a setting that turns guest mode off.
9. **Privacy:** a guest relay sees what a home relay sees (the IP and how messages are addressed, never their content). The guide says so.
10. **Tests:** the home relay stopped mid-conversation; a new message reaching the guest user; the return, with both mailboxes collected and no duplicates; groups and calls as a guest; a stranger refused by the guest relay.

Estimate: 1 to 2 weeks.

### Phase 3 — smart relay choice and load spreading

**Aim:** the client measures each relay's latency and stability from where it is, and each relay announces its load. A new user sits on the least loaded relay it can reach, and a full relay, instead of a flat refusal, sends the user to a quiet one (as a guest).

**Status:** not started. Only `/ready` answering 503 near capacity exists.

**Design:**

1. **Announcing load:** a relay publishes its current load as a rough number (connections against capacity, queue, processor) in `/relay-directory` or a light route beside it, with nothing about its users.
2. **Measuring from the user's device:** in the background, cheaply, the client measures latency and connection success to each relay of the list; the results stay on that device. For a user inside Iran, reachability (filtering) weighs most.
3. **A score:** reachability, latency, stability over the last few days, and the announced load.
4. **A new user:** chooses a home relay by score, not only the address the app was opened from.
5. **A full relay:** instead of a bare 503 it returns a list of quiet relays, and the client goes to one of them as a guest (phase 2).
6. **Tests:** a full relay sends a new user to a quiet one; a relay filtered where the user is is not chosen; nothing measured leaves the device.

Estimate: 3 to 5 days.

### Phase 4 — chained updates

**Aim:** every version is signed. A relay that gets a new version tells the others. Each relay fetches the package, checks the signature, takes a backup, and installs it; afterwards its health is checked and, if broken, it goes back by itself. The rollout is staged.

**Done (2.98.88, improved in 2.98.89 and 2.98.90):**

- **A signed package:** a manifest, a signature, the app's tree, and the images. It is signed with the operator key, and a relay refuses a package that is unsigned, changed, or not newer than what it runs (`scripts/lib/update-package.js`).
- **A chain between the family's members:** authenticated by the family's links, so a server the panel cannot reach is updated too (`scripts/lib/relay-updates.js`).
- **When it installs:** smart (the quietest hour), at a set time, or now. A time travels between relays only if the operator signed it.
- **Telling users:** two minutes before, the people online are told the server is updating.
- **A backup before installing:** in `scripts/apply-update.sh`. An older version is refused, the signature is checked again, and nothing is retried by itself.
- **From the central panel:** packages built from a folder, an archive, GitHub, or Build & package; sent to servers; installed over SSH on a server with no updater yet.
- **The app:** the PWA updates from the new relay's service worker, and the native app downloads only its own exact kind of build and checks it against `SHA256SUMS`.

**Left:**

1. **A health check after installing, and an automatic revert:** the backup is taken, but restoring it is still by hand (`scripts/server-backup.sh --restore`). To do: once the stack is up, check `/chat-health`, the family links coming back, and the version served; if it is not healthy within a set time, restore that backup by itself and report to the panel and Telegram.
2. **A staged rollout:** one relay first (a canary), and the rest only if it stays healthy for a set time. Suggested: the canary is named in the signed policy, and the other relays wait for its health report.
3. **(Optional) a separate release key:** today the operator key signs packages. If other operators' relays are to take the developer's releases too, a separate release key is needed.

Estimate for what is left: 2 to 4 days.

### Optional — a mailbox copy on a second relay

**Aim:** messages already waiting on the home relay when it went down cannot be reached until it is back. With an encrypted copy on a second relay (preferably a cluster mate), even those reach a guest user.

**Status:** not started. It needs phase 2.

**In short:** when an offline message is queued, the home relay hands a copy (the same encrypted envelope) to a second relay over the family link; delivery from either removes it from the other; the message id prevents duplicates; quotas and retention follow the main mailbox's rules.

Estimate: about 1 week.

### The suggested order from here

1. The app side of phase 1 (2 to 3 days)
2. Phase 2, guest mode (1 to 2 weeks). The biggest gain, users carrying on when their relay is down, is here.
3. What is left of phase 4: the automatic revert and the staged rollout (2 to 4 days)
4. Phase 3 (3 to 5 days). It starts to matter as the number of users nears the relays' capacity.
5. The mailbox copy (about 1 week)

### Other plans waiting

- **Running behind Cloudflare (analysed, set aside for now):**
  - Phase 1: the user's real IP through `realip` limited to Cloudflare's ranges, a separate name for the Cloudflare path, and the management paths closed on that name.
  - Phase 2: an edge nginx routing by SNI, only if port 443 must be shared with another program on the same server.
  - Phase 3: routes managed from the central panel, with a check and an automatic revert.
  - TURN and Reality never go through Cloudflare.
