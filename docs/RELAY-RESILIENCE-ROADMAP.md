# برنامهٔ تاب‌آوری شبکهٔ رله‌ها — وضعیت و نقشهٔ راه · Relay network resilience — status and roadmap

آخرین به‌روزرسانی: ۸ نوامبر ۲۰۲۶، نسخهٔ 2.98.90 · Last updated: 8 November 2026, version 2.98.90

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
| ۱ | فهرست امضاشدهٔ رله‌ها | 🟢 انجام شده؛ سمت برنامه روی main است و هنوز منتشر نشده |
| ۲ | حالت مهمان (failover) | 🟢 انجام شده؛ روی main است و هنوز منتشر نشده. پشت کلید «میزبان مهمان» هر رله که پیش‌فرض خاموش است |
| ۳ | انتخاب هوشمند رله و پخش بار | 🟢 انجام شده؛ کارت «بهترین سرور» با سه حالت، پیش‌فرض خودکار |
| ۴ | پخش زنجیره‌ای آپدیت | 🟢 انجام شده؛ برگشت خودکار و قناری روی main هستند و هنوز منتشر نشده‌اند. کلید جدا برای انتشار اختیاری است |
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

**سمت برنامه، انجام شده پس از 2.98.90 (روی main، هنوز منتشر نشده):**

- **لنگر اعتماد:** نخستین فهرست معتبر از نشانی اصلیِ تنظیم‌شده (نه آدرس پشتیبان یا رلهٔ دیگر)، روی HTTPS یا شبکهٔ محلی، و از رله‌ای که هویتش ثبت شده و در فهرست هست، کلید اپراتور را ثبت می‌کند. یا QR آن را از پیش می‌گوید. لنگر در پروفایل رمزنگاری‌شدهٔ چت می‌ماند و هیچ رله‌ای نمی‌تواند بی‌صدا عوضش کند.
- **گرفتن و بررسی:** بعد از هر اتصال و هر ۶ ساعت، از رلهٔ خانه، آدرس پشتیبان در حال استفاده، و بعد رله‌های دیگر فهرست. همان قواعد رله‌ها در مرورگر (`js/chat/61-relay-directory.js`) و یک شرط بیشتر: رلهٔ خانه باید در فهرست باشد. پاسخ بیش از ۵۱۲ کیلوبایت خوانده نمی‌شود. آخرین فهرست معتبر بدون اینترنت هم هست.
- **تحویل کلید:** چرخش کلید در پنل با کلید قبلی یک تحویل امضا می‌کند و رله‌ها آن را در `/operator-handover` نگه می‌دارند. برنامه با آن کلید تازه را بی‌پرسش می‌پذیرد؛ بدون آن از کاربر می‌پرسد و تا جواب، فهرست تازه را باور نمی‌کند.
- **QR:** `P0R1|<نشانی>/#op=<شناسهٔ اپراتور>&relay=<شناسهٔ رله>`، که برنامه‌های قدیمی همچنان فقط نشانی را از آن می‌خوانند. پنل کنار هر سرور و هر رله آن را نشان می‌دهد و «نمایش نشانی به‌صورت QR» در برنامه هم آن را می‌سازد. کد اسکن‌شده تا وقتی برنامه به همان نشانی وصل نشده کاری نمی‌کند، و هرگز هویتِ ثبت‌شدهٔ یک رله را بازنویسی نمی‌کند.
- **تنظیمات:** کارت «خانوادهٔ رله‌ها» در «اتصال و TURN»: اپراتور، منبع اعتماد، سریال، رله‌ها با رلهٔ خانه، و «بررسی کن».
- **تست:** `tests/e2e/clientdirectory.mjs` (۵۲ بررسی) و بخش `handover` در `tests/e2e/relaydirectory.mjs`.

### فاز ۲ — حالت مهمان (failover)

**هدف:** وقتی رلهٔ خانه قطع است، کلاینت با همان هویت روی رلهٔ دیگری از فهرست ثبت‌نام موقت می‌کند، و پیام‌های تازه به آن‌جا می‌رسند. وقتی خانه برگشت، کلاینت برمی‌گردد و از هر دو صندوق تحویل می‌گیرد.

**وضعیت:** انجام شده پس از 2.98.90 (روی main، هنوز منتشر نشده). طراحی کامل در `docs/RELAY-NETWORK.md`، بخش «حالت مهمان».

- **کی مهمان می‌شود:** وقتی رلهٔ خانه و همهٔ آدرس‌های پشتیبان و درهای ورودی‌اش ۲ دقیقه در دسترس نبودند. برنامه رله‌هایی از خانواده را که «میزبان مهمان» هستند (حداکثر ۸ تا) هم‌زمان از دستگاه خود کاربر می‌سنجد و کلید هرکدام را اثبات می‌کند: اول هم‌خوشه، بعد هم‌منطقه، بعد سریع‌ترین. رلهٔ فیلترشده برای کاربر جواب نمی‌دهد و انتخاب نمی‌شود.
- **مهمان، نه ساکن:** نشانی تنظیم‌شده عوض نمی‌شود، کارت هنوز خانه را نام می‌برد، و رلهٔ مهمان هرگز کاربر را ساکن خود اعلام نمی‌کند. برنامه هر دقیقه خانه را می‌آزماید و بعد از دو اثبات پشت سر هم برمی‌گردد. آنچه روی رلهٔ مهمان مانده به خانه می‌رود و آنچه هنوز می‌رسد ۷ روز دنبالش می‌رود.
- **امنیت:** رله‌های خانواده فهرست دستگاه‌های هر حساب را به‌صورت مهروموم‌شده با کلیدی از اثر انگشت حساب نگه می‌دارند؛ دستگاهِ لغوشده مهمان نمی‌شود. مسیر مهمان فقط با بیانیهٔ امضاشدهٔ خود مخاطب پذیرفته می‌شود و نشانی ذخیره‌شدهٔ هیچ مخاطبی جابه‌جا نمی‌شود.
- **خانه‌ای که فقط برای یک نفر فیلتر است:** با اعلامیهٔ امضاشدهٔ خود کاربر، رلهٔ خانه پیام‌هایش را به رلهٔ مهمان می‌دهد؛ بعد از ۳ روز برنامه با دلیل‌ها پیشنهاد انتقال دائمی می‌دهد و انتخاب با کاربر است. دستگاه‌های دیگر حساب دنبال انتقال می‌روند.
- **push، چنددستگاهی، گروه و تماس:** رلهٔ مهمان اعلان می‌دهد و خانه برای آن دستگاه ساکت می‌ماند؛ دو دستگاه روی دو رلهٔ مهمان هر دو پیام می‌گیرند؛ گروه و تماس (با TURN رلهٔ مهمان) کار می‌کنند.
- **تست:** `tests/e2e/relayguests.mjs` (سطح رله، ۱۲۲ بررسی) و `tests/e2e/guestmode.mjs` (برنامه روی سه رلهٔ یک خانواده).

### فاز ۳ — انتخاب هوشمند رله و پخش بار

**هدف:** کلاینت تأخیر و پایداری هر رله را از جای خودش می‌سنجد، و هر رله بار خودش را اعلام می‌کند. کاربر تازه روی کم‌بارترین رلهٔ در دسترس می‌نشیند، و رلهٔ پر به‌جای رد کردن خشک، کاربر را به رلهٔ خلوت (به‌صورت مهمان) می‌فرستد.

**وضعیت:** انجام شده در ۹ نوامبر ۲۰۲۶. طراحی کامل در `docs/RELAY-NETWORK.md`، بخش «بهترین سرور».

- **سنجش از دستگاه کاربر:** پاسخ‌گویی و نوسانش، پایداری، سرعت دانلود (حداکثر روزی یک بار، حدود ۲۵۶ کیلوبایت)، و میزان پر بودن هر رله که خودش در `/chat-health` اعلام می‌کند. نتیجه فقط روی دستگاه می‌ماند.
- **امتیاز:** پایداری ۰٫۵، پاسخ‌گویی ۰٫۳، سرعت ۰٫۲؛ رلهٔ بالای ۸۰٪ پر انتخاب نمی‌شود و بین ۶۰ تا ۸۰٪ امتیاز کمتری می‌گیرد.
- **کاربر تازه:** همان اول روی بهترین رلهٔ خانواده می‌نشیند.
- **کاربر فعلی:** فقط وقتی رلهٔ دیگری ۳ روز جدا دست‌کم ۳۰٪ بهتر بود، یا خانه بالای ۸۵٪ پر شد، منتقل می‌شود؛ بین دو انتقال حداقل ۳۰ روز. انتقال مستقیم است (بدون مهمان شدن) و با همان بیانیهٔ امضاشدهٔ فاز ۲.
- **کارت «بهترین سرور»** در «اتصال و TURN»: خودکار (پیش‌فرض، بی‌پرسش)، فقط پیشنهاد (با دلیل‌ها)، یا خاموش (با هشدار)؛ «الان بسنج» و «انتقال به اینجا». با یک رله پنهان است.
- **تست:** `tests/e2e/relaychoice.mjs`.

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

**انجام شده پس از 2.98.90 (روی main، هنوز منتشر نشده):**

- **بررسی سلامت پس از نصب و برگشت خودکار:** `scripts/apply-update.sh` پیش از جایگزینی، یک کپی از درخت قدیمی نگه می‌دارد. پس از بالا آمدن، رله را دو دقیقه از راه nginx می‌پاید: باید به `/chat-health` جواب بدهد، نسخهٔ تازه را سرو کند، در این مدت ری‌استارت نشود، و اگر پیش از آپدیت به خانواده لینک داشت، دوباره لینک بگیرد. اگر کپی، `sync-to-server.sh` تازه یا این پایش ناموفق بود، درخت قدیمی برمی‌گردد و `sync-to-server.sh` همان درخت قدیمی نسخهٔ قبلی را با ایمیج‌هایی که هر دیپلوی نگه می‌دارد بالا می‌آورد. `.env` و `data/` هیچ‌وقت دست نمی‌خورند، پس پیامی که در این فاصله رسیده گم نمی‌شود. کد خروج ۳ یعنی برگردانده شد و ۴ یعنی برگرداندن هم ناموفق بود.
- **گزارش و جلوگیری از حلقه:** رله‌ای که بالا می‌آید منتظر حرف مرحلهٔ نصب (`result.json`) می‌ماند و نسخهٔ خودش را دلیل موفقیت نمی‌گیرد. برگشت را با دلیلش به پنل و تلگرام می‌گوید، آن نسخه را دیگر به بقیه نمی‌دهد و هرگز دوباره از همتایان نمی‌گیرد. فقط پنل می‌تواند عمداً دوباره بفرستدش.
- **قناری:** زمانِ امضاشدهٔ اپراتور می‌تواند یک رله را قناری کند و مدتی را بگوید (۵ تا ۱۴۴۰ دقیقه، پیش‌فرض ۳۰). قناری سر زمانش اعمال می‌کند و بقیه صبر می‌کنند تا قناری این مدت با نسخهٔ تازه سالم بماند. اگر قناری نسخه را برگرداند، بقیه متوقف می‌مانند تا اپراتور تصمیم بگیرد. خبر قناری در پیشنهاد (offer) هر رله دست‌به‌دست می‌شود، پس رله‌ای که به قناری راه ندارد هم باخبر می‌شود. زمانِ بی‌قناری درست مثل قبل امضا می‌شود، و زمانِ امضاشده همراه بسته از رله‌ای هم که آن را اعمال کرده می‌رود.
- **از پنل:** انتخاب سرور قناری و مدت در فرم ارسال و فرم زمان، و نمایش مرحله‌های «منتظر قناری»، «متوقف» و «برگردانده شد» با دلیل.

**نکته‌های انتشار:** برگشت خودکار از آپدیتِ *بعد از* نسخه‌ای که آن را نصب می‌کند کار می‌کند، چون همیشه `apply-update.sh` نصب‌شده اجرا می‌شود. قناری وقتی کامل کار می‌کند که همهٔ رله‌ها این نسخه را داشته باشند؛ رلهٔ قدیمی‌تر زمانِ قناری‌دار را «بدون زمان» می‌گیرد و در کم‌کاربرترین ساعت اعمال می‌کند.

**مانده (اختیاری):** کلید جدا برای انتشار. فعلاً کلید اپراتور بسته را امضا می‌کند. اگر رله‌های اپراتورهای دیگر هم بخواهند از نسخهٔ توسعه‌دهنده آپدیت بگیرند، یک کلید جدا برای انتشار لازم است.

### اختیاری — کپی صندوق روی رلهٔ دوم

**هدف:** پیام‌هایی که پیش از قطع شدن روی رلهٔ خانه مانده‌اند، بدون این بخش تا برگشتن آن رله در دسترس نیستند. با کپی رمزشده روی یک رلهٔ دوم (ترجیحاً هم‌خوشه)، حتی آن‌ها هم در حالت مهمان می‌رسند.

**وضعیت:** شروع نشده. پیش‌نیاز: فاز ۲.

**طرح کوتاه:** هنگام صف شدن یک پیام آفلاین، رلهٔ خانه یک کپی (همان پاکت رمزشده) را از راه لینک خانواده به یک رلهٔ دوم می‌سپارد؛ تحویل از هر کدام دیگری را پاک می‌کند؛ شناسهٔ پیام از تکرار جلوگیری می‌کند؛ سهمیه و مدت نگه‌داری همان قواعد صندوق اصلی است.

تخمین: حدود ۱ هفته.

### ترتیب پیشنهادی برای ادامه

این ترتیب در ۸ نوامبر ۲۰۲۶ جای ترتیب روز اول (۱ ← ۲ ← ۴ ← ۳) را گرفت.

1. ✅ **مانده‌های فاز ۴: بررسی سلامت با برگشت خودکار، بعد پخش مرحله‌ای.** انجام شد در ۸ نوامبر ۲۰۲۶ (روی main، هنوز منتشر نشده). پخش زنجیره‌ای همین حالا روشن است و یک بستهٔ خراب در یک دور به همهٔ رله‌ها می‌رسد. برگرداندن دستی روی سرورهای داخل ایران سخت است. فاز ۱ و ۲ پروتکل رله را عوض می‌کنند و با قناری هر کدام اول روی یک رله آزموده می‌شود.
2. ✅ **سمت برنامهٔ فاز ۱.** انجام شد در ۸ نوامبر ۲۰۲۶ (روی main، هنوز منتشر نشده). پیش از کد، لنگر اعتماد و قاعدهٔ عوض شدن کلید اپراتور برای کلاینت تصمیم گرفته شود: کلیدی که روی دستگاه کاربران ثبت شد را نمی‌شود از راه دور اصلاح کرد. لنگر بهتر است از لینک دعوت یا QR بیاید تا از نخستین اتصال.
3. ✅ **فاز ۲، حالت مهمان.** انجام شد در ۸ نوامبر ۲۰۲۶ (روی main، هنوز منتشر نشده)، در این تکه‌ها و پشت کلیدی که پیش‌فرض خاموش است:
   - الف) اول محیط تست سه‌رله‌ای که رلهٔ خانه را در میانهٔ گفتگو خاموش می‌کند؛
   - ب) ثبت‌نام مهمان، رسیدن پیام تازهٔ یک‌به‌یک، و برگشت به خانه بدون پیام تکراری؛
   - ج) اعلان push؛
   - د) چنددستگاهی، گروه و تماس؛
   - هـ) پیشنهاد انتقال دائمی برای خانه‌ای که فقط برای یک نفر فیلتر است.

   سنجش دسترس‌پذیری از دستگاه کاربر (قدم ۲ فاز ۳) به همین فاز می‌آید: برای کاربر داخل ایران، رلهٔ مهمانِ فیلترشده یعنی رفتن از یک رلهٔ مرده به رلهٔ مردهٔ دیگر.
4. ✅ **فاز ۳، انتخاب هوشمند رله.** انجام شد در ۹ نوامبر ۲۰۲۶: هر کاربر روی بهترین رلهٔ غیرشلوغ خانواده، از دید اینترنت خودش.
5. **کپی صندوق (حدود ۱ هفته).** بعد از فاز ۲ سنجیده شود چند پیام پشت رلهٔ قطع‌شده می‌ماند و قطعی‌ها چقدر طول می‌کشند. اگر قطعی‌ها کوتاه‌اند، شاید لازم نشود.

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
| 1 | Signed relay directory | 🟢 Done; the app side is on main, not released yet |
| 2 | Guest mode (failover) | 🟢 Done; on main, not released yet. Behind each relay's "takes guests" switch, off by default |
| 3 | Smart relay choice and load spreading | 🟢 Done; the "Best relay" card with three settings, Automatic by default |
| 4 | Chained updates | 🟢 Done; the automatic revert and the canary are on main, not released yet. A separate release key is optional |
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

**The app side, done after 2.98.90 (on main, not released yet):**

- **The anchor:** the first valid list from the configured address (not a mirror or another relay of the list), over HTTPS or a local network, from a relay whose identity is pinned and listed, records the operator key. Or a QR code names it beforehand. The anchor lives in the encrypted chat profile, and no relay can change it unnoticed.
- **Fetching and checking:** after each connect and every 6 hours, from the home relay, the mirror in use, then the list's other relays. The relays' own rules in the browser (`js/chat/61-relay-directory.js`), and one more: the home relay must be on the list. A reply past 512 KB is not read. The last valid list is there offline.
- **Key handovers:** the panel's key rotation signs a handover with the old key, and relays keep it at `/operator-handover`. The app follows it without asking; without one it asks the person and does not believe the new list meanwhile.
- **QR:** `P0R1|<address>/#op=<operator id>&relay=<relay id>`, which older apps still read as a plain address. The panel shows it beside every server and relay, and the app's "show address as QR" draws it too. A scanned code does nothing until the app is connected to that address, and never replaces a relay's pinned identity.
- **Settings:** a "Relay family" card in Connection and TURN: the operator, where the trust came from, the serial, the relays with the home one marked, and "check now".
- **Tests:** `tests/e2e/clientdirectory.mjs` (52 checks) and the `handover` section of `tests/e2e/relaydirectory.mjs`.

### Phase 2 — guest mode (failover)

**Aim:** when the home relay is down, the client registers temporarily, with the same identity, on another relay of the list, and new messages reach it there. When home is back, the client returns and collects from both mailboxes.

**Status:** done after 2.98.90 (on main, not released yet). The full design is in `docs/RELAY-NETWORK.md`, "Guest mode".

- **When:** the home relay, every backup address of it, and every front door have been unreachable for 2 minutes. The app measures the family's relays that take guests (at most 8) in parallel from the person's own device and proves each one's key: a cluster mate first, then one in home's region, then the fastest. A relay filtered for the person does not answer, so it is never chosen.
- **A guest, never a resident:** the configured address does not change, the card still names home, and the guest relay never claims the person as its resident. Home is tried every minute; two proofs in a row and the app goes back. What waited on the guest relay goes home, and anything still arriving follows for 7 days.
- **Security:** the family's relays keep each account's device roster, sealed under a key made from the account's fingerprint; a revoked device cannot become a guest. A guest route is believed only on the contact's own signed statement, and no contact's stored address ever moves.
- **A home filtered for one person:** on the person's signed notice, the home relay hands their mail to the guest relay; after 3 days the app offers a permanent move, says why, and the person decides. The account's other devices follow.
- **Push, devices, groups, and calls:** the guest relay wakes the device and home stays quiet for it; two devices on two guest relays both receive; groups and calls (with the guest relay's TURN) work.
- **Tests:** `tests/e2e/relayguests.mjs` (relay level, 122 checks) and `tests/e2e/guestmode.mjs` (the app on three relays of one family).

### Phase 3 — smart relay choice and load spreading

**Aim:** the client measures each relay's latency and stability from where it is, and each relay announces its load. A new user sits on the least loaded relay it can reach, and a full relay, instead of a flat refusal, sends the user to a quiet one (as a guest).

**Status:** done on 9 November 2026. The full design is in `docs/RELAY-NETWORK.md`, "Best relay".

- **Measured from the person's device:** how fast each relay answers and how much that varies, how steadily, download speed (at most once a day, about 256 KB), and how full each relay says it is in `/chat-health`. Results stay on the device.
- **Score:** steadiness 0.5, latency 0.3, speed 0.2; a relay over 80% full is not chosen, and 60–80% counts for less.
- **A new account** takes the family's best relay at once.
- **An existing account** moves only when another relay has been at least 30% better on 3 separate days, or home is over 85% full; at least 30 days between moves. The move is direct (no guest stay), with phase 2's signed statement.
- **The "Best relay" card** in Connection and TURN: Automatic (default, no question), Suggest only (with the reasons), or Off (with a warning); "Measure now" and "Move here". Hidden with one relay.
- **Tests:** `tests/e2e/relaychoice.mjs`.

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

**Done after 2.98.90 (on main, not released yet):**

- **A health check after installing, and an automatic revert:** `scripts/apply-update.sh` keeps a copy of the old tree before it replaces it. Once the stack is up, it watches the relay for two minutes through nginx: it must answer `/chat-health`, serve the new version, not restart in that time, and, if it was linked to its family before, be linked again. When the copy, the new `sync-to-server.sh`, or the watch fails, the old tree goes back, and the old tree's own `sync-to-server.sh` brings the previous version up from the images every deploy keeps. `.env` and `data/` are never touched, so nothing that arrived in between is lost. Exit code 3 means put back; 4 means putting it back failed too.
- **Reporting, and no loop:** the relay that comes up waits for the apply step's word (`result.json`) instead of taking its own version as proof. It reports a revert, with the reason, to the panel and Telegram, stops handing that version on, and never takes it from a peer again. Only the panel can hand it over again, on purpose.
- **The canary:** the operator's signed time may name one relay as the canary and a hold (5 to 1440 minutes, 30 by default). The canary applies at its time, and the others wait until it has run the new version healthily for the hold. If the canary puts the version back, the others hold until the operator decides. Word of the canary travels in every relay's offer, so a relay that cannot reach the canary still learns it. A time with no canary is signed exactly as before, and a signed time travels with the package even from a relay that has applied it.
- **From the panel:** a canary server and its hold in the send and time forms, and the "waiting for the canary", "held", and "put back" steps shown with the reason.

**Release notes:** the automatic revert works from the update *after* the version that installs it, since the installed `apply-update.sh` always runs. The canary works fully once every relay runs this version; an older relay takes a time with a canary as no time and applies at its quietest hour.

**Left (optional):** a separate release key. Today the operator key signs packages. If other operators' relays are to take the developer's releases too, a separate release key is needed.

### Optional — a mailbox copy on a second relay

**Aim:** messages already waiting on the home relay when it went down cannot be reached until it is back. With an encrypted copy on a second relay (preferably a cluster mate), even those reach a guest user.

**Status:** not started. It needs phase 2.

**In short:** when an offline message is queued, the home relay hands a copy (the same encrypted envelope) to a second relay over the family link; delivery from either removes it from the other; the message id prevents duplicates; quotas and retention follow the main mailbox's rules.

Estimate: about 1 week.

### The suggested order from here

This order replaced the first day's (1, then 2, then 4, then 3) on 8 November 2026.

1. ✅ **What is left of phase 4: a health check with an automatic revert, then a staged rollout.** Done on 8 November 2026 (on main, not released yet). The chain is live today, and one broken package reaches every relay in one pass. Reverting by hand on the servers inside Iran is hard. Phases 1 and 2 change the relay protocol, and with a canary each is tried on one relay first.
2. ✅ **The app side of phase 1.** Done on 8 November 2026 (on main, not released yet). Before any code, decide the client's trust anchor and its rule for a new operator key: a key pinned on people's devices cannot be fixed from afar. The anchor is better brought by the invite link or QR than by the first connection.
3. ✅ **Phase 2, guest mode.** Done on 8 November 2026 (on main, not released yet), in these slices and behind a switch that is off by default:
   - a) first, a three-relay test bed that stops the home relay in the middle of a chat;
   - b) the guest sign-up, new one-to-one messages arriving, and the return home with no duplicates;
   - c) push;
   - d) several devices, groups, and calls;
   - e) offering a permanent move when home is filtered for one person.

   Measuring reachability from the user's device (step 2 of phase 3) moves into this phase: for a user inside Iran, a filtered guest relay means going from one dead relay to another.
4. ✅ **Phase 3, smart relay choice.** Done on 9 November 2026: everyone on the family's best non-full relay, as seen from their own internet.
5. **The mailbox copy (about 1 week).** After phase 2, measure how many messages are held behind a relay that is down and how long outages last. If outages are short, it may never be needed.

### Other plans waiting

- **Running behind Cloudflare (analysed, set aside for now):**
  - Phase 1: the user's real IP through `realip` limited to Cloudflare's ranges, a separate name for the Cloudflare path, and the management paths closed on that name.
  - Phase 2: an edge nginx routing by SNI, only if port 443 must be shared with another program on the same server.
  - Phase 3: routes managed from the central panel, with a check and an automatic revert.
  - TURN and Reality never go through Cloudflare.
