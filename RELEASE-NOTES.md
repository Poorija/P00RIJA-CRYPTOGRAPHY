# P00RIJA Cryptography 2.98.77

Version 2.98.77 · build chat-v170

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## اتصال به اپراتورهای دیگر · Linking with other operators

- **خانواده‌های رلهٔ اپراتورهای مختلف با تأیید ادمین به هم وصل می‌شوند.** ادمین در پنل
  نشانی رلهٔ اپراتور دیگر را می‌زند، می‌بیند کیست و درخواست اتصال می‌فرستد. درخواست در
  پنل همهٔ رله‌های طرف مقابل دیده می‌شود و تلگرام هم خبر می‌دهد؛ ادمین آن طرف در پنل
  تأیید یا رد می‌کند و هر وقت بخواهد ارتباط را قطع می‌کند.
- **فقط Gatewayها به هم وصل می‌شوند.** هر خانواده چند سرور را با اولویت Gateway می‌کند؛
  بقیهٔ سرورها، از جمله سرور داخلی، از راه همین Gatewayها به خانوادهٔ دیگر می‌رسند و
  هرگز لینک بیرونی نمی‌گیرند. همهٔ Gatewayها هم‌زمان وصل‌اند: اگر یکی قطع شود، پیام بعدی
  بی‌درنگ از بعدی می‌رود و وقتی برگشت و یک دقیقه پایدار ماند، دوباره نقش را می‌گیرد.
- **Gatewayها از پنل هم انتخاب می‌شوند**، هر وقت بخواهید؛ خانوادهٔ مقابل خودش و بدون
  تأیید دوباره با Gateway تازه هماهنگ می‌شود و Gateway قدیمی تا وصل شدن تازه باز می‌ماند.
- **از طریق شریک مشترک:** اگر روشن کنید، دو شریک شما که هم‌دیگر را تأیید کرده‌اند،
  وقتی لینک خودشان پایدار نیست، از راه خانوادهٔ شما به هم می‌رسند؛ محتوا همیشه مهروموم
  می‌ماند.
- **امن:** درخواست‌ها امضا، تاریخ‌دار و فقط برای یک اپراتورند، سقف تعداد دارند و تکرار
  نمی‌شوند؛ شریک فقط ترافیک و خبر خانوادهٔ خودش را می‌فرستد و هیچ‌چیزی در خانوادهٔ شما
  تغییر نمی‌دهد؛ نشانی‌های شبکهٔ خصوصی در فهرست شریک هرگز دنبال نمی‌شوند.
- **برای هر کسی که خودش میزبانی می‌کند:** حتی یک سرور تنها با `scripts/deploy.sh` یک
  خانوادهٔ یک‌نفره و Gateway خودش می‌شود تا بتواند با دیگران وصل شود.
- **اصلاح:** رله‌ای که ابزار اپراتور یا `scripts/link-relays.sh` ری‌استارت می‌کند، مسیر
  نصب، مسیر پشتیبان و نسخه را نگه می‌دارد تا پشتیبان‌گیری و کارهای پنل از کار نیفتد.

- **Relay families run by different operators link once an admin approves.**
  The admin types the address of another operator's relay in the dashboard,
  sees who it is, and sends a link request. The request shows on every relay
  of the other family, Telegram says so, and their admin approves or rejects
  it in the dashboard and can disconnect at any time.
- **Only gateways link.** Each family names a few servers as gateways, in
  order; every other server, the server inside Iran included, reaches the
  other family through them and never holds a link outside its own. All
  gateways are linked at once: when one drops, the next message already goes
  through the next one, and a gateway that comes back takes over again once
  it has stayed up for a minute.
- **Gateways can be chosen in the dashboard** at any time; the other family
  follows by itself, without approving again, and the old gateway stays up
  until the new one has linked.
- **Through a common partner:** when you turn it on, two of your partners that
  approved each other reach each other through your family while their own
  link is not settled; content stays sealed throughout.
- **Safe:** requests are signed, dated, meant for one operator, limited, and
  cannot be replayed; a partner sends only traffic and news about its own
  family and changes nothing in yours; a partner's directory is never followed
  to a private address.
- **For anyone who self-hosts:** even a single server becomes a family of one,
  and its own gateway, through `scripts/deploy.sh`, so it can link with others.
- **Fix:** a relay restarted by the operator tool or `scripts/link-relays.sh`
  keeps its install and backup paths and version, so backups and dashboard
  jobs keep working.

---

# P00RIJA Cryptography 2.98.76

Version 2.98.76 · build chat-v169

---

## خانوادهٔ رله‌ها · Relay families

- **رله‌های یک اپراتور خودشان به هم وصل می‌شوند.** اپراتور فهرست رله‌هایش را با «کلید اپراتور»
  امضا می‌کند و هر رلهٔ این فهرست خودکار با همهٔ بقیه لینک می‌شود. اضافه کردن یک سرور یعنی امضای
  فهرست تازه؛ نه `.env` سرورهای دیگر ویرایش می‌شود و نه رله‌ای ری‌استارت می‌شود. سرور گم‌شده یا
  نفوذشده هم با یک فرمان در همهٔ رله‌ها بسته و رد می‌شود.
- **برای هر کسی که خودش میزبانی می‌کند، همین‌طور خودکار است.** کسی که دو سرور یا بیشتر را در
  تنظیمات `scripts/deploy.sh` بنویسد، در اولین استقرار کلید اپراتورش روی کامپیوتر خودش ساخته
  می‌شود، فهرست امضا و به همهٔ سرورها داده می‌شود، و سرورهایش یک خانواده می‌شوند. سرور تازه در
  استقرار بعدی‌اش می‌پیوندد. ابزار دستی `tools/relay-directory.mjs` هم هست.
- **امن:** هر رله فقط فهرستی را می‌پذیرد که کلید اپراتور خودش امضا کرده، شماره‌اش از هر فهرست
  قبلی بالاتر است و نام خود رله در آن آمده؛ فهرست قدیمی را نمی‌شود دوباره فرستاد و رلهٔ باطل‌شده را
  زنده کرد، حتی روی رله‌ای که فایل فهرستش از دست رفته. کلید اپراتور هرگز روی سرور نمی‌رود و رمز پنل
  هنگام تحویل فهرست در فهرست پردازه‌های سرور دیده نمی‌شود.
- **حتی رله‌ای که کسی به آن دسترسی ندارد** (سرور داخلی، از بیرون ایران) فهرست تازه را می‌گیرد: هر
  رله هر پنج دقیقه از بقیه می‌پرسد و فهرست تازه را فوراً به همهٔ لینک‌هایش می‌دهد.
- **پنل** در زبانهٔ رله‌ها خانواده را نشان می‌دهد: اپراتور، شمارهٔ فهرست، هر رله با منطقه و وضعیت
  لینکش، و رله‌های باطل‌شده. هشدارهای هر عضو تازه هم خودکار به رلهٔ دارای تلگرام می‌رسد.

- **An operator's relays link with each other by themselves.** The operator signs the
  list of their relays with an "operator key", and every relay on the list links with
  every other one on its own. Adding a server is signing a new list; nobody edits the
  other servers' `.env` and no relay restarts. A lost or compromised server is closed and
  refused on every relay with one command.
- **The same, automatically, for anyone who self-hosts.** Someone who lists two or more
  servers in `scripts/deploy.sh`'s settings gets an operator key made on their own machine
  at the first deploy, the list signed and handed to every server, and their servers
  become a family. A new server joins on its next deploy. The manual tool,
  `tools/relay-directory.mjs`, is there too.
- **Safe:** a relay takes only a list signed by its own operator's key, with a serial
  higher than any before it, that names the relay itself; an old list cannot be replayed
  to bring back a revoked relay, not even on a relay that lost its copy. The operator key
  never goes to a server, and the dashboard password never shows in a server's process
  list while the list is handed over.
- **Even a relay nobody can reach** (the server inside Iran, seen from outside) gets the
  new list: every relay asks the others every five minutes and passes a new list on over
  its links at once.
- **The dashboard** shows the family in its Relays tab: the operator, the list's serial,
  each relay with its region and link state, and the revoked ones. A new member's alerts
  reach the relay with Telegram without a line of its own.

---

# P00RIJA Cryptography 2.98.75

Version 2.98.75 · build chat-v168

---

## هشدارهای بین دو رله، امن‌تر · Alerts between relays, safer

- **فقط به رله‌های نام‌برده**: هشدار، که می‌گوید سرور چقدر پر است و چه نامی دارد، به هر رلهٔ
  لینک‌شده‌ای فرستاده می‌شد؛ اگر روزی رلهٔ یک اپراتور دیگر لینک شود، این اطلاعات به او هم می‌رسید و
  او هم می‌توانست در تلگرام این اپراتور بنویسد. حالا هشدار فقط به رله‌هایی که در `CHAT_ALERT_PEERS`
  نام برده شده‌اند فرستاده و فقط از همان‌ها پذیرفته می‌شود.
- **منشأ قطعی**: هشداری که از رلهٔ دیگر می‌رسد با شناسه‌ای شروع می‌شود که خود لینک ثابت کرده، و در
  یک خط؛ رله‌ای نمی‌تواند خود را جای رلهٔ دیگری جا بزند.
- **هیچ هشداری گم نمی‌شود**: رلهٔ گیرنده دریافت هر هشدار را تأیید می‌کند و فرستنده تا تأیید، آن را
  نگه می‌دارد و دوباره می‌فرستد؛ هشدارهای رلهٔ دیگر هم سهم محدودی از صف دارند و هشدارهای خود این
  رله را بیرون نمی‌اندازند.

- **Only to relays named outright**: an alert, which says how full the server is and what
  it is called, went to every linked relay; should another operator's relay ever be
  linked, it would have read that, and could write into this operator's Telegram. Alerts
  now go only to the relays named in `CHAT_ALERT_PEERS`, and are taken only from them.
- **Provenance that holds**: an alert from another relay opens with the id the link
  proved, on one line; no relay can pass itself off as another.
- **No alert is lost**: the receiving relay acknowledges each alert, and the sender keeps
  it and sends it again until it does; another relay's alerts have a limited share of the
  queue and cannot push out this relay's own.

---

# P00RIJA Cryptography 2.98.74

Version 2.98.74 · build chat-v167

---

## هشدار تلگرامی، Node 26 و nginx 1.31 · Telegram alerts, Node 26, and nginx 1.31

- **هشدار به تلگرام مدیر**: رله هر دقیقه این‌ها را می‌سنجد و وقتی چیزی از حد بگذرد، با ربات تلگرام
  به مدیر پیام می‌دهد:
  - فضای دیسکی که داده‌ها روی آن است، و حافظهٔ سرور؛
  - حافظهٔ خود رله در برابر سقف کانتینرش، و فایل‌های بازش؛
  - ظرفیت TURN: چند پورت از پورت‌های رلهٔ coturn گرفته شده، اینکه coturn اصلاً اجرا می‌شود یا نه،
    و پهنای باند سرور (اگر سرعت لینک تعیین شده باشد)؛
  - رلهٔ دیگری که ده دقیقه در دسترس نیست؛ رله‌ای که از کار افتاده نمی‌تواند خودش خبر بدهد.

  پیام یک بار وقتی مشکل شروع می‌شود فرستاده می‌شود، دوباره اگر بدتر شود، هر شش ساعت یک یادآوری تا
  وقتی ادامه دارد، و یک پیام وقتی برطرف شد؛ هرگز هر دقیقه یک پیام. هر راه‌اندازی رله هم اعلام می‌شود،
  تا مثلاً بعد از یک کرش و راه‌اندازی دوباره، مدیر بداند. رله‌ای که به تلگرام دسترسی ندارد (سرور داخلی)
  هشدارهایش را از لینک رمزنگاری‌شدهٔ بین دو رله به رلهٔ دیگر می‌دهد و آن رله می‌فرستد. پنل با
  `alert-test` یک پیام آزمایشی می‌فرستد و `healthz` هشدارهای فعال را نشان می‌دهد. شناسهٔ چت در
  `CHAT_ALERT_TELEGRAM_CHAT_ID` و آستانه‌ها در `CHAT_ALERT_*` تنظیم می‌شوند.
- **Node 26.12.0 و nginx 1.31.7**، جدیدترین نسخه‌ها: رله، رلهٔ مستقل و کارهای پنل روی Node 26.12.0،
  و nginx روی 1.31.7. نسخه‌ها دقیق ثابت شده‌اند: با برچسب شناور، ساخت از هر نسخه‌ای که از قبل روی
  سرور بود استفاده می‌کرد و بی‌صدا ماه‌ها عقب می‌ماند.
- بازهٔ پورت‌های رلهٔ coturn حالا از `.env` (`TURN_MIN_PORT` و `TURN_MAX_PORT`) تنظیم می‌شود و همان
  عددها به هشدار TURN می‌رسند.

- **Alerts to the operator's Telegram**: once a minute the relay checks the following and,
  when something crosses a line, sends the operator a message through the Telegram bot:
  - the disk its data is on, and the machine's memory;
  - its own memory against its container's ceiling, and its open files;
  - TURN capacity: how many of coturn's relay ports are taken, whether coturn is running
    at all, and the machine's bandwidth (when the link speed is given);
  - a linked relay unreachable for ten minutes; a relay that has died cannot say so
    itself.

  One message when a problem starts, another if it gets worse, a reminder every six hours
  while it lasts, and one when it is over; never one a minute. Every start of the relay
  is announced too, so a crash and restart does not go unnoticed. A relay that cannot
  reach Telegram (the server inside Iran) hands its alerts over the encrypted link between the
  two relays, and the other relay sends them on. The dashboard's `alert-test` sends a test
  message, and `healthz` lists what is active. The chat is set with
  `CHAT_ALERT_TELEGRAM_CHAT_ID` and the thresholds with `CHAT_ALERT_*`.
- **Node 26.12.0 and nginx 1.31.7**, the newest releases: the relay, the standalone relay,
  and the dashboard's jobs run on Node 26.12.0, and nginx on 1.31.7. The versions are
  pinned exactly: with a floating tag, a build used whatever copy the server already held
  and quietly fell months behind.
- coturn's relay port range is now set in `.env` (`TURN_MIN_PORT` and `TURN_MAX_PORT`), and
  the same numbers reach the TURN alert.

---

# P00RIJA Cryptography 2.98.73

Version 2.98.73 · build chat-v166

---

## پشتیبان‌های پیش از استقرار، کامل · Pre-deployment snapshots, complete

- **کلیدها و داده‌های رله در پشتیبان نبودند**: پشتیبانی که پیش از هر استقرار روی سرور گرفته می‌شود،
  قاعدهٔ `.gitignore` خود برنامه را رعایت می‌کرد و آن قاعده `data/`، `.env` و `certs/` را کنار
  می‌گذارد؛ یعنی دقیقاً همان چیزهایی که پشتیبان برای نگه داشتنشان وجود دارد: کلید Web Push، هویت
  رله، صندوق‌های پیام، فهرست دستگاه‌ها، کلید TLS و رمز پنل. پیام پشتیبان می‌گفت این‌ها را «نجات
  داده»، اما هیچ‌وقت ثبت نمی‌شدند. حالا همه ثبت می‌شوند.
- **چیزی از پشتیبان حذف نمی‌شد**: چون چند فایل رله فقط برای root خواندنی است، rsync خطا می‌گرفت و در
  این حالت بی‌صدا هیچ فایلی را حذف نمی‌کرد؛ صندوق پیامی که هفته‌ها پیش تحویل و پاک شده بود هنوز در
  پشتیبان بود و با بازگردانی برمی‌گشت. حالا پشتیبان همان چیزی است که روی سرور هست.
- **آرشیوهای پنل** دیگر در تاریخچهٔ پشتیبان‌ها کپی نمی‌شوند.
- بازگردانی پیش‌فرض مثل قبل فقط کد را برمی‌گرداند؛ داده فقط وقتی برمی‌گردد که مسیرش صریحاً خواسته
  شود.

- **The relay's keys and data were not in the snapshots**: the snapshot taken on the
  server before every deployment followed the program's own `.gitignore`, which leaves
  out `data/`, `.env`, and `certs/`: exactly what the snapshot exists to keep, namely the
  Web Push key, the relay's identity, the mailboxes, the device lists, the TLS key, and
  the dashboard password. The snapshot's message said they had been rescued; they were
  never committed. They all are now.
- **Nothing was ever removed from a snapshot**: a few of the relay's files are readable
  by root only, so rsync reported errors and, on errors, silently deleted nothing; a
  mailbox delivered and gone weeks ago was still in the snapshot, ready to be restored.
  A snapshot is now what is on the server.
- **The dashboard's archives** are no longer copied into the snapshots' history.
- A default restore still brings back the code only; data comes back only when its path
  is asked for by name.

---

# P00RIJA Cryptography 2.98.72

Version 2.98.72 · build chat-v165

---

## پنل مدیریت سرور: پشتیبان‌ها و پاکسازی دیسک · The server dashboard: backups and disk cleanup

- **دکمهٔ «لایه‌های بی‌نام»** در کارت دیسک، به‌جای لایه‌های بی‌نام، همهٔ ایمیج‌هایی را پاک می‌کرد که
  کانتینری از آن‌ها استفاده نمی‌کرد: ایمیج‌های پایه‌ای که ساخت بعدی لازم دارد (که روی سرور داخلی
  دانلود دوباره‌شان ساعت‌ها طول می‌کشد یا اصلاً ممکن نیست) و ایمیج‌های سرویس‌های دیگر همان سرور.
  حالا فقط لایه‌های بی‌نام و بی‌استفاده را پاک می‌کند.
- **ایمیج در حال استفاده**: پنل ایمیجی را که کانتینری از آن ساخته شده بود هم برای حذف پیشنهاد می‌داد
  و با تیک زدن پاکش می‌کرد. دیگر هرگز.
- **دانلود پشتیبان و بستهٔ تمیز**: فایل در پوشه‌ای گذاشته می‌شد که رله از آن نمی‌خواند؛ دانلود خالی
  می‌آمد و خود رله از کار می‌افتاد تا دوباره راه بیفتد. نصب‌کنندهٔ یک‌خطی سرور تازه هم به همین دلیل
  بستهٔ خالی می‌گرفت. حالا هر دو کامل دانلود می‌شوند، و خطای یک دانلود فقط همان دانلود را قطع می‌کند.
- **بازگشت بدون انتخاب نسخه** همیشه جواب می‌داد «پشتیبانی نیست». حالا آخرین پشتیبان را برمی‌گرداند.
- **فقط دو پشتیبان آخر، از هر راهی**: پشتیبان ایمنی که پیش از هر بازگردانی، به‌روزرسانی و بازگشت
  گرفته می‌شود، بی‌حد روی هم جمع می‌شد. حالا قاعدهٔ «دو پشتیبان آخر» برای همه اعمال می‌شود و
  پشتیبانی که از آن بازگردانی شده نگه داشته می‌شود.
- دو دانلود هم‌زمان دیگر فایل یکدیگر را خراب نمی‌کنند، و سقف حافظه‌ای که از پنل برای کانتینر رله
  تعیین شود، بدون ری‌استارت در نگهبان حافظهٔ رله اعمال می‌شود.
- تست تازهٔ `tests/e2e/opspanel.mjs` همهٔ این‌ها را با یک Docker ساختگی می‌سنجد که دستورهای پنل را
  واقعاً اجرا می‌کند.

- **The "dangling layers" button** on the disk card removed, instead of dangling layers,
  every image no container was using: the base images the next build needs (which take
  hours to fetch again on the server inside Iran, if they can be fetched at all) and the
  images of the machine's other services. It now removes untagged layers nothing uses,
  and only those.
- **Images in use**: the dashboard offered an image a container is made from for removal,
  and removed it when ticked. Never again.
- **Downloading a backup and the clean bundle**: the file was handed over in a directory
  the relay does not read, so the download came out empty and the relay itself went down
  until it restarted. The one-line installer for a new server got an empty bundle for the
  same reason. Both download whole now, and a failed download ends only that download.
- **Rolling back without choosing a backup** always answered "no backup". It now restores
  the newest one.
- **The last two backups, whichever way they were made**: the safety copy taken before
  every restore, update, and rollback piled up without limit. The same "last two" rule
  now applies to all of them, and the backup a restore came from is kept.
- Two downloads at once no longer spoil each other's file, and a memory ceiling set for
  the relay's container from the dashboard reaches the relay's memory guard without a
  restart.
- A new test, `tests/e2e/opspanel.mjs`, checks all of it against a stand-in Docker that
  really runs the dashboard's commands.

---

# P00RIJA Cryptography 2.98.71

Version 2.98.71 · build chat-v164

---

## آمادگی تولید: امنیت، حریم خصوصی و ظرفیت · Production readiness: security, privacy, and capacity

یک تست تازه (`tests/e2e/prodready.mjs`) رله را از همان Dockerfile تولید و با محدودیت‌های
واقعی هر دو سرور اجرا کرد: ظرفیت با بار معمولی و با بار انفجاری، هجوم اتصال، ماندگاری بعد از
قطع ناگهانی، نشت، و حمله. همهٔ مواردی که پیدا شد بسته شدند:

- **نشت آدرس IP**: فهرست حضوری که برای همهٔ کاربران متصل فرستاده می‌شد، IP واقعی هر کاربر را
  هم داشت؛ هر کسی که به رله وصل می‌شد می‌توانست IP همهٔ کاربران آنلاین را جمع کند. IP از آن فهرست
  حذف شد. پنل مدیریت IP کاربران را مثل قبل از مسیر محافظت‌شدهٔ خودش می‌بیند و مسدود کردن IP دست
  نخورده است.
- **دور زدن سقف اتصال با هدر جعلی**: مسیر وب‌سوکت آدرس را از بخشی از `X-Forwarded-For` می‌خواند
  که کاربر می‌نویسد، پس یک سیستم می‌توانست هر تعداد اتصال باز کند و رله را از کار بیندازد. حالا
  همان قاعدهٔ مسیر HTTP به کار می‌رود: آدرسی که nginx خودش دیده. آدرس‌های پنل و مسدود کردن هم دیگر
  با هدر جعلی دور زده نمی‌شوند.
- **جعل حضور**: فهرست حضور اتصال‌هایی را هم پخش می‌کرد که هنوز هویتشان را ثابت نکرده بودند؛ یعنی
  کسی که فقط کلید عمومی یک کاربر را داشت می‌توانست او را برای همه «آنلاین» نشان دهد. حالا فقط
  هویت‌های ثابت‌شده در فهرست می‌آیند.
- **پاک کردن پیام‌های گروه بدون هویت**: درخواست پاک کردن پیام‌های صف‌شدهٔ یک گروه منحل‌شده حالا
  اثبات هویت می‌خواهد.
- **سقف ۱۰۲۴ فایل باز**: رله، nginx و رلهٔ مستقل با سقف پیش‌فرض Docker اجرا می‌شدند و هر سرور حدود ۱۰۰۰ اتصال،
  یعنی حدود ۵۰۰ کاربر، را تحمل می‌کرد. سقف به ۶۵۵۳۶ و `worker_connections` nginx به ۱۶۳۸۴ رسید.
  رله حالا خودش تعداد فایل‌های باز را می‌پاید و پیش از رسیدن به سقف، اتصال تازه را با پاسخ «پر است»
  رد می‌کند، تا پاسخ سلامت، نوشتن صندوق پیام و پنل همیشه کار کنند.
- **کشته شدن رله به‌خاطر حافظه**: در آزمون، رله در حدود ۷۰۰۰ اتصال به‌خاطر کمبود حافظه کشته شد.
  هر اتصال تازه کل فهرست حضور را می‌گرفت (چند مگابایت) و هجوم اتصال‌ها، مثلاً بعد از هر ری‌استارت،
  گیگابایت‌ها در حافظه انباشته می‌کرد. حالا فهرست حضور برای کلاینت کُند روی هم انباشته نمی‌شود،
  فهرست‌های کامل در هر نوبت محدودند، درخواست فهرست کامل حداکثر هر ده ثانیه یک بار پاسخ می‌گیرد، و
  رله نزدیک سقف حافظه اتصال تازه را با پاسخ «پر است» رد می‌کند. هیچ‌وقت به‌خاطر حافظه کشته نمی‌شود.
- **فهرست حضور، فقط تغییرات**: با هر وصل یا قطع شدن هر کاربر، فهرست همهٔ کاربران برای همه فرستاده
  می‌شد؛ با ۲۷۰۰ اتصال، هر بار ۲٫۵ گیگابایت. حالا برنامه فهرست را یک بار کامل و بعد فقط تغییرات را
  می‌گیرد، و زمان‌هایی که هر دقیقه برای همه عوض می‌شدند و برنامه از آن‌ها استفاده نمی‌کرد از فهرست
  حذف شدند. این هم ظرفیت رله را بالا می‌برد و هم مصرف اینترنت و باتری گوشی را کم می‌کند. نسخه‌های
  قدیمی برنامه مثل قبل فهرست کامل می‌گیرند.
- **صف پذیرش اتصال** از ۵۱۱ به ۴۰۹۶ رسید، تا هجوم اتصال‌های هم‌زمان جا نماند.
- **Node.js 22**: پشتیبانی Node 20 در آوریل 2026 تمام شده بود. رله و کارهای پنل حالا روی Node 22‌اند.
- **سقف اتصال هر IP**: برای کاربرانی که پشت NAT مشترک اپراتور موبایل‌اند (رایج در ایران)، بالاتر
  رفت (سرور خارجی حدود ۳۰۰، سرور داخلی حدود ۱۶۰). جلوی سوءاستفاده را سقف کل، نگهبان فایل
  و حافظه، و محدودیت نرخ می‌گیرند.
- **سیل درخواست**: رله دیگر به هر فریم اضافی جواب نمی‌دهد (حداکثر یک جواب در ثانیه) و اتصالی را که
  بعد از هزاران تخطی ادامه بدهد می‌بندد.
- **حافظهٔ کانتینر**: برای کانتینر رله سقف حافظه تعریف شد تا نتواند حافظهٔ بقیهٔ سرویس‌های سرور
  را بگیرد.
- **استقرار**: build ایمیج برنامه بدون شمارهٔ نسخه اجرا می‌شد و هر استقرار برنامه را دو بار
  می‌ساخت. حالا یک بار ساخته می‌شود، و بعد از هر استقرار فقط ایمیج همین نسخه و نسخهٔ قبل نگه داشته
  می‌شود و کش build قدیمی‌تر از یک هفته پاک می‌شود. روی سرورها چند ده گیگابایت از این‌ها جمع شده بود.
- **پشتیبان‌ها**: هم snapshot‌های استقرار و هم پشتیبان‌های پنل، فقط دو نسخهٔ آخر را نگه می‌دارند.
- **همگام‌سازی دستگاه‌ها**: اولین پیامی که بعد از وصل شدن دستگاه دوم حساب فرستاده می‌شد، گاهی هرگز
  به آن دستگاه نمی‌رسید (و فایلش هم خودکار منتقل نمی‌شد)، چون برنامه آن را نقطهٔ شروع مقایسه حساب
  می‌کرد. حالا از اولین پیام به بعد همه چیز به دستگاه‌های دیگر می‌رسد.
- **ظرفیت اندازه‌گیری‌شده**، با بار معمولی (هر کاربر هر ده ثانیه یک پیام) و محدودیت‌های واقعی هر
  سرور: سرور خارجی تا **۱۰٬۰۰۰ اتصال (حدود ۵۰۰۰ کاربر هم‌زمان)** با تأخیر p95 حدود ۱۰۰
  میلی‌ثانیه و بدون حتی یک پیام گم‌شده؛ سرور داخلی تا سقف خودش، **حدود ۴۷۰۰ اتصال (حدود ۲۳۰۰
  کاربر)**، با تأخیر p95 زیر ۲۰ میلی‌ثانیه، و اتصال‌های بیشتر از سقف با پاسخ «پر است» رد می‌شوند.
  هزار اتصالی که یک‌باره قطع شوند در چند ثانیه همه برمی‌گردند. پیش از این اصلاحات، هر سرور حدود
  ۵۰۰ کاربر را تحمل می‌کرد.

A new test (`tests/e2e/prodready.mjs`) ran the relay from the production Dockerfile with
both servers' real limits: capacity under ordinary and under burst load, reconnect
storms, persistence after a hard kill, leaks, and abuse. Everything it found is closed:

- **IP address leak**: the presence table sent to every connected client carried each
  person's real IP address; anyone connected could collect the addresses of everyone
  online. The address is gone from that table. The admin panel still sees addresses
  through its own protected endpoint, and IP bans are untouched.
- **Bypassing the connection cap with a forged header**: the WebSocket path took the
  address from the part of `X-Forwarded-For` the client writes, so one machine could open
  any number of sockets and take the relay down. It now uses the same rule as the HTTP
  path: the address nginx itself saw. The panel's addresses and IP bans can no longer be
  dodged with a forged header either.
- **Faked presence**: the presence table announced sockets before they had proven their
  identity, so anyone holding a person's public key could make them appear online to
  everyone. Only proven identities are announced now.
- **Emptying a group's mail without an identity**: the request to drop a dissolved
  group's queued mail now needs a proven identity.
- **The 1024 open-file limit**: the relay, nginx, and the standalone relay ran with Docker's default limit, so
  each server held about 1,000 sockets, roughly 500 people. The limit is now 65536, and
  nginx's `worker_connections` 16384. The relay also watches its open files and, before
  the limit is reached, refuses new sockets with a "full" answer, so health checks,
  mailbox writes, and the panel always keep working.
- **The relay killed for memory**: in testing, the relay was killed for lack of memory at
  about 7,000 sockets. Each new socket got the whole presence table (megabytes), and a
  crowd connecting at once, after any restart for example, piled gigabytes into memory.
  Now presence never piles up for a slow client, whole tables go out a bounded number at
  a time, a request for the full table is answered at most once every ten seconds, and
  near its memory limit the relay refuses new sockets with a "full" answer. It is never
  killed for memory.
- **Presence as changes only**: every time anyone connected or left, the whole table of
  everyone went to everyone; at 2,700 sockets that was 2.5 GB each time. The app now gets
  the table once and then only the changes, and the clocks that changed every minute for
  everyone, which the app never read, are gone from it. That raises the relay's capacity
  and saves phones data and battery. Older builds still get the whole table, as before.
- **The queue of connections waiting to be accepted** grew from 511 to 4096, so a crowd
  connecting at once is not dropped.
- **Node.js 22**: Node 20 support ended in April 2026. The relay and the panel's jobs now
  run on Node 22.
- **The per-address cap** is higher, for people behind a mobile carrier's shared NAT
  (common in Iran): about 300 on the server outside Iran and 160 on the server inside Iran.
  Abuse is held back by the total cap, the open-file and memory guards, and rate
  limiting.
- **Floods**: the relay no longer answers every excess frame (one answer a second at
  most), and closes a socket that keeps going after thousands of refusals.
- **Container memory**: the relay container has a memory ceiling, so it cannot take
  memory from the server's other services.
- **Deployment**: the app image was built without its version number, so every deploy
  built the app twice. It is built once now, and after each deploy only this version's
  image and the previous one are kept, and build cache older than a week is cleared.
  Tens of gigabytes of this had piled up on the servers.
- **Backups**: both the deployment snapshots and the panel's backups keep only the last
  two versions.
- **Device sync**: the first message sent after an account's second device came online
  sometimes never reached it (nor did its file come over by itself), because the app
  took it as the starting point to compare against. Everything from the first message
  on now reaches the other devices.
- **Measured capacity**, under ordinary use (each person sending a message every ten
  seconds) and each server's real limits: the server outside Iran up to **10,000 sockets
  (about 5,000 people at once)** at about a 100 ms p95 and not one message lost; the
  server inside Iran up to its own ceiling, **about 4,700 sockets (about 2,300 people)**, at
  under a 20 ms p95, with sockets past the ceiling refused with a "full" answer. A
  thousand sockets dropped at once all come back within seconds. Before these fixes,
  each server held about 500 people.

---

# P00RIJA Cryptography 2.98.70

Version 2.98.70 · build chat-v163

---

## سه اصلاح امنیتی پس از بازبینی · Three security fixes after review

بازبینی امنیتی کد 2.98.69، که به‌محض استقرار انجام شد، سه نکته پیدا کرد و هر سه بسته شدند:

- **رله نمی‌تواند دستگاهی را وادار به پاک کردن حساب کند**: اعلان «دسترسی این دستگاه لغو شد»
  که از سرور می‌رسد حالا دقیقاً با همان قاعده‌ای پذیرفته می‌شود که هر فهرست دستگاه دیگری
  پذیرفته می‌شود: باید با کلید همان دستگاه اصلی‌ای امضا شده باشد که این دستگاه می‌شناسد، و از
  فهرست فعلی جدیدتر باشد. قبلاً رله‌ای بدخواه می‌توانست دور گواهی واقعی حساب، فهرستی با امضای
  خودش بسازد.
- **اولین فهرست، بدون پرسیدن پاک نمی‌کند**: دستگاهی که هنوز دستگاه اصلی را نمی‌شناخت، اولین
  فهرست را فقط وقتی می‌پذیرد که با کلید همان دستگاه اصلی‌ای که در آن نام برده شده امضا شده باشد.
  اگر آن فهرست لغو دسترسی همین دستگاه را بگوید، پیش از پاک کردن حساب از شما پرسیده می‌شود. سرور
  به هر حال دیگر آن دستگاه را راه نمی‌دهد.
- **اتصال با QR بدون رضایت، حسابی را جا نمی‌اندازد**: در حالتی که دستگاه جدید کد را نشان می‌دهد،
  دستگاه جدید حسابی را که پیش از زدن «پیوستن» برسد نادیده می‌گیرد. قبلاً کسی که کد را اسکن کرده
  بود می‌توانست حساب خودش را پیش از تأیید شما روی دستگاه جدید بنشاند.

هر سه با تست تازه پوشش داده شده‌اند.

A security review of the 2.98.69 code, run as soon as it was deployed, found three
points, and all three are closed:

- **A relay cannot make a device wipe the account**: a "this device was revoked" notice
  from the server is now taken by exactly the rule any device list is taken by: it must
  be signed with the key of the primary this device knows, and be newer than the list it
  holds. Before, a malicious relay could have built a list signed with its own key around
  the account's genuine certificate.
- **The first list does not wipe without asking**: a device that did not yet know the
  primary takes its first list only when it is signed with the key of the primary it
  names. If that list says this device was revoked, you are asked before the account is
  removed. The relay keeps that device out either way.
- **QR linking cannot slip an account in without consent**: when the new device is the
  one showing the code, it ignores an account that arrives before "Join" is pressed.
  Before, whoever had scanned the code could have put their own account on the new
  device ahead of your approval.

All three are covered by new tests.

---

# P00RIJA Cryptography 2.98.69

Version 2.98.69 · build chat-v162

---

## اتصال دستگاه با کد QR · Linking a device with a QR code

مثل تلگرام و واتس‌اپ، دستگاه جدید را می‌شود با یک کد QR به حساب وصل کرد. روی دستگاهی که حساب
را دارد «دستگاه‌های من › افزودن دستگاه» و روی دستگاه جدید «هویت شما در چت › اتصال این دستگاه
به حساب» را بزنید. یکی از دو دستگاه کد نشان می‌دهد و دیگری با دوربین اسکنش می‌کند. هر دو
جهت کار می‌کند، پس دسکتاپ بی‌دوربین کد را نشان می‌دهد و گوشی اسکن می‌کند؛ گوشی به گوشی هم
همین‌طور. پروفایل همراه (فایل با رمز) هم مثل قبل هست.

- **کد هر ده ثانیه عوض می‌شود**: هر کد یک اتاق تصادفی و یک کلید ECDH (P-256) تازه دارد و
  فقط نیم دقیقه پذیرفته می‌شود. عکسی که از صفحه گرفته شود زود بی‌ارزش می‌شود. دستگاهی که کد
  کهنه را اسکن کند همان لحظه باخبر می‌شود.
- **رمزگذاری سرتاسری**: دو دستگاه از تبادل ECDH یک کلید AES-GCM مشترک می‌سازند که به اتاق و
  هر دو کلید عمومی گره خورده است. همه‌چیز، از نام دستگاه تا خود حساب، با همین کلید رمز می‌شود.
  سرور فقط پیام‌های رمزی را جابه‌جا می‌کند و چیزی از آن‌ها نگه نمی‌دارد.
- **تأیید با عدد شش‌رقمی**: بعد از اسکن، هر دو صفحه یک عدد شش‌رقمی نشان می‌دهند که از کلید
  مشترک ساخته شده است. اگر کسی وسط راه باشد، دو عدد یکی نمی‌شوند. دستگاه حساب پیش از تحویل
  حساب می‌پرسد و دستگاه جدید پیش از پذیرفتن آن؛ بدون تأیید شما هیچ اتفاقی نمی‌افتد. حسابی هم
  که می‌رسد، پیش از فعال شدن بررسی می‌شود که همان حسابی باشد که کد نشان داده بود.
- **بعد از اتصال**: هویت، مخاطبین، گروه‌ها و فهرست دستگاه‌ها منتقل می‌شوند و تاریخچه و فایل‌ها
  مستقیم، دستگاه‌به‌دستگاه، از دستگاه دیگر می‌رسند.

Like Telegram and WhatsApp, a new device can join the account with a QR code. On the
device that has the account open "My devices › Add a device", and on the new one "Your
chat identity › Link this device to an account". One of the two shows a code and the
other scans it with its camera. It works both ways, so a desktop without a camera shows
the code and a phone scans it, and phone to phone works the same way. The portable
profile (a password-protected file) is still there too.

- **The code changes every ten seconds**: each code carries a random room and a fresh
  ECDH (P-256) key, and is accepted for half a minute only. A photo of the screen soon
  becomes worthless, and a device that scans a stale code is told so at once.
- **End-to-end encryption**: the two devices derive one shared AES-GCM key from the
  ECDH exchange, bound to the room and to both public keys. Everything, from the
  device's name to the account itself, is encrypted with it. The server only passes
  ciphertext along and keeps none of it.
- **Approval with six digits**: after the scan, both screens show the same six digits,
  made from the shared key. With anyone in between, the two numbers would not match.
  The account's device asks before it hands the account over, and the new device asks
  before it accepts one; nothing happens without your approval. The account that
  arrives is checked to be the one the code named before it is activated.
- **After linking**: the identity, contacts, groups, and device list move across, and
  the history and files arrive straight from the other device, device to device.

---

## صدا و تصویر تماس · Call sound and picture

- **حذف نویز محیط**: صدای پس‌زمینه (پنکه، خیابان، کیبورد، همهمه) با RNNoise از صدای شما جدا
  می‌شود. RNNoise شبکهٔ عصبی بنیاد Xiph، سازندگان Opus، است. پردازش روی خود دستگاه و در
  AudioWorklet انجام می‌شود و چیزی برای آن به جایی فرستاده نمی‌شود. از کتابخانهٔ آمادهٔ
  `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT) استفاده شده که RNNoise را از
  `@shiguredo/rnnoise-wasm` (Apache-2.0) اجرا می‌کند؛ فایل‌ها با مجوزهایشان داخل برنامه‌اند.
  این گزینه به‌طور پیش‌فرض روشن است و در تنظیمات چت و در تنظیمات داخل تماس کلید دارد. در تماس
  صوتی، تصویری و گروهی کار می‌کند. هر جا اجرا نشود، تماس با میکروفون معمولی و کاهش نویز خود
  مرورگر ادامه پیدا می‌کند، هرگز با سکوت.
- **بالاترین کیفیت صدا**: میکروفون با ۴۸ کیلوهرتز و تک‌کاناله گرفته می‌شود و Opus تمام‌باند،
  بدون DTX (که ابتدای کلمه‌ها را می‌برید) و با FEC فرستاده می‌شود، تا ۱۲۸ کیلوبیت بر ثانیه.
- **بالاترین فریم‌ریت و کیفیت تصویر**: دوربین با ۶۰ فریم در ثانیه درخواست می‌شود (حداکثر چیزی
  که دوربین بدهد) و سقف پهنای باند در ۶۰ فریم تا ۱۲ مگابیت بالا می‌رود. تعویض دوربین و دستگاه
  هم با همین کیفیت انجام می‌شود. کیفیت مثل قبل با شبکه و پردازنده تطبیق داده می‌شود تا حرکت
  روان بماند.
- **تصویر خودتان آینه‌ای نیست**: به‌طور پیش‌فرض همان را می‌بینید که طرف مقابل می‌بیند. با دکمهٔ
  «نمای آینه‌ای خودم» می‌شود آینه‌ای‌اش کرد و این انتخاب به خاطر سپرده می‌شود.

- **Background noise removal**: background sound (a fan, traffic, a keyboard, chatter)
  is taken out of your voice by RNNoise, the neural suppressor from Xiph, the makers of
  Opus. It runs on the device itself, in an AudioWorklet, and nothing is sent anywhere
  for it. It uses the ready-made library `@sapphi-red/web-noise-suppressor` 0.4.1 (MIT),
  which runs RNNoise from `@shiguredo/rnnoise-wasm` (Apache-2.0); the files ship inside
  the app with their licences. It is on by default, with a switch in the chat settings
  and in the call's own settings, and works in voice, video, and group calls. Wherever
  it cannot run, the call carries on with the plain microphone and the browser's own
  noise reduction, never with silence.
- **The best sound**: the microphone is taken at 48 kHz in one channel, and Opus goes
  at full band, without DTX (which clips word onsets) and with FEC, up to 128 kbit/s.
- **The highest frame rate and picture quality**: the camera is asked for 60 frames a
  second (the most the camera gives), and the bandwidth ceiling rises to 12 Mbit/s at
  60 fps. Switching camera or device keeps the same quality. As before, quality adapts
  to the network and the processor so that movement stays smooth.
- **Your own picture is not mirrored**: by default you see what the other side sees.
  "Mirror my preview" mirrors it, and the choice is remembered.

---

## دستگاه اصلی، لغو دسترسی و جدا شدن · A primary device, revoking, and detaching

همهٔ دستگاه‌های یک حساب کلید هویت یکسانی دارند. برای همین، آن کلید نمی‌تواند تشخیص بدهد
کدام دستگاه اول بوده است. حالا هر دستگاه یک کلید امضای مخصوص خودش هم دارد (ECDSA P-256).
این کلید روی همان دستگاه ساخته می‌شود و هرگز از آن خارج نمی‌شود: نه در پروفایل همراه، نه
در بستهٔ همگام‌سازی.

- **دستگاه اصلی**: دستگاهی که هویت را ساخته، دستگاه اصلی حساب است. فهرست دستگاه‌های حساب
  را همین دستگاه می‌نویسد و با کلید خودش امضا می‌کند. یک گواهی هم کنار آن است که کلید هویت
  حساب امضایش کرده. پس نه سرور و نه هیچ دستگاه دیگری نمی‌تواند فهرستی بسازد که معتبر باشد.
  سرور و همهٔ دستگاه‌ها اولین دستگاه اصلی‌ای را که دیده‌اند نگه می‌دارند و فهرست را از کس
  دیگری قبول نمی‌کنند.
- **لغو دسترسی، فقط از دستگاه اصلی**: دستگاه اصلی می‌تواند دسترسی هر دستگاه دیگری را لغو
  کند. سرور آن دستگاه را، هم با شناسه‌اش و هم با کلیدش، همان لحظهٔ اثبات هویت بیرون
  می‌گذارد. اتصال باز آن دستگاه بسته می‌شود و آنچه برایش نگه داشته شده بود پاک می‌شود.
  دستگاه‌های دیگر حساب هم دیگر با آن همگام نمی‌شوند و فایلی به آن نمی‌دهند. خود آن دستگاه،
  به‌محض اینکه باخبر شود (اگر آفلاین بوده، همان لحظهٔ برگشتن)، فهرست امضاشده را خودش بررسی
  می‌کند، حساب را از روی خودش پاک می‌کند و با هویتی تازه ادامه می‌دهد. سرور به‌تنهایی
  نمی‌تواند دستگاهی را وادار به پاک کردن خودش کند؛ فقط می‌تواند راهش ندهد.
- **جدا شدن**: هر دستگاه دیگری می‌تواند خودش را از حساب جدا کند. هویت، گفتگوها، مخاطبین و
  فایل‌های حساب از روی همان دستگاه پاک می‌شود و دستگاه با یک هویت تازه، مثل قبل از اتصال،
  جداگانه کار می‌کند. دستگاه‌های دیگر بی‌تغییر ادامه می‌دهند و دستگاه اصلی آن را در فهرست
  «رفته» ثبت می‌کند. دستگاه غیراصلی نمی‌تواند دسترسی دستگاه دیگری را لغو کند.
- **سپردن نقش اصلی**: دستگاه اصلی می‌تواند این نقش را به دستگاه دیگری بسپارد. اگر خود
  دستگاه اصلی بخواهد جدا شود، اول می‌پرسد نقش را به کدام دستگاه بسپارد.
- **حساب‌های قدیمی**: حسابی که پیش از این نسخه چند دستگاه داشت، خودبه‌خود دستگاه اصلی
  نمی‌گیرد، چون حدس زدن آن شیر یا خط است. در «دستگاه‌های من» دکمهٔ «این دستگاه اصلی شود»
  هست؛ آن را روی دستگاهی بزنید که اول هویت را رویش ساخته‌اید. حسابی که فقط یک دستگاه
  داشته، خودبه‌خود همان را اصلی می‌کند.
- **محدودیت**: دستگاهی که لغو دسترسی شده هنوز کلید هویتی را که داشت می‌داند. اگر کسی
  برنامهٔ آن را دست‌کاری کند تا لغو را نادیده بگیرد، می‌تواند به‌عنوان «دستگاه تازه»
  برگردد. چنین دستگاهی در فهرست دستگاه اصلی دیده می‌شود و می‌شود دوباره لغوش کرد. اگر
  دستگاهی دزدیده شده و رمز برنامه‌اش هم لو رفته، راه‌حل کامل یک هویت تازه برای حساب است.

The devices of one account all hold the same identity key, so that key cannot tell
which device came first. Each device now also has a signing key of its own (ECDSA
P-256). It is made on that device and never leaves it: not in the portable profile,
and not in a sync bundle.

- **The primary device**: the device that created the identity is the account's
  primary. It writes the account's list of devices and signs it with its own key,
  alongside a certificate signed by the account's identity key. Neither the relay nor
  any other device can make a list that verifies. The relay and every device keep the
  first primary they saw, and accept a list from no one else.
- **Revoking, from the primary only**: the primary can revoke any other device. The
  relay shuts that device out, by its id and by its key, the moment it proves the
  identity. Its open connection is closed and whatever was held for it is dropped. The
  account's other devices stop syncing with it and hand it no files. The device itself,
  as soon as it learns of it (at once if it is online, or the moment it comes back),
  checks the signed list for itself, removes the account from itself, and carries on
  with a new identity of its own. The relay alone cannot make a device wipe itself; it
  can only refuse it.
- **Detaching**: any other device can detach itself from the account. The account's
  identity, conversations, contacts, and files are removed from that device, which then
  carries on separately with a new identity, as it was before it was linked. The other
  devices carry on unchanged, and the primary records it as gone. A device that is not
  the primary cannot revoke another device.
- **Handing the role on**: the primary can hand its role to another device. If the
  primary itself wants to detach, it first asks which device should take over.
- **Older accounts**: an account that had several devices before this version does not
  get a primary on its own, because guessing would be a coin toss. "My devices" offers
  "Make this the primary"; press it on the device you first created the identity on.
  An account that only ever had one device makes that one the primary by itself.
- **A limit**: a revoked device still knows the identity key it held. With its app
  modified to ignore the revocation, it could come back as a "new device". Such a
  device shows up in the primary's list and can be revoked again. If a device was
  stolen and its app password is known too, the complete answer is a new identity for
  the account.

---

## همهٔ دستگاه‌ها، همیشه در فهرست · Every device, always listed

در «تنظیمات › دستگاه‌های من» و در «هویت شما در چت › دستگاه‌های متصل» حالا همهٔ دستگاه‌های
حساب دیده می‌شوند، نه فقط آن‌هایی که الان آنلاین‌اند. دستگاه آفلاین با زمان آخرین بازدیدش
در فهرست می‌ماند و فقط وضعیتش عوض می‌شود. تعداد هم همیشه نمایش داده می‌شود: «۳ دستگاه · ۲
آنلاین». دستگاه اصلی با نشان تاج مشخص است و دکمه‌های «لغو دسترسی»، «اصلی شود» و «جدا
کردن این دستگاه» در هر دو جا هستند.

Settings › My devices and Your chat identity › Linked devices now list every device of
the account, not only the ones online right now. An offline device stays in the list
with when it was last seen, and only its status changes. The count is always shown:
"3 devices · 2 online". The primary carries a crown, and "Revoke", "Make primary", and
"Detach this device" are in both places.

---

## همگام‌سازی کامل همهٔ محتوا · Sync all content

یک گزینهٔ تازه در همان دو جا: «همگام‌سازی کامل همهٔ محتوا». وقتی روشن است، هر فایل، عکس،
ویدیو، پیام صوتی، استیکر و گیفی که دستگاهی ندارد، هر بار که دستگاه دیگری که آن را دارد
آنلاین است، خودکار منتقل و روی این دستگاه نگه داشته می‌شود. لازم نیست روی چیزی بزنید.
انتقال مستقیم و دستگاه‌به‌دستگاه است، با همان رمزگذاری دوباره‌ای که برای «دریافت از دستگاه
دیگر» هست. هیچ بایتی از سرور رد نمی‌شود و هیچ چیزی روی آن نمی‌ماند.

- این انتخاب برای کل حساب است: روی هر دستگاهی روشن یا خاموش شود، به بقیه هم می‌رسد.
- پیام خودتخریب و یک‌بارمصرف خودکار آورده نمی‌شود.
- فایل بزرگ‌تر از فضای داخلی برنامه (۶۴ مگابایت) همچنان با یک زدن آورده می‌شود.
- انتقال خودکار هیچ‌وقت آن‌قدر پیش نمی‌رود که برنامه برای جا باز کردن، فایل‌های
  نگه‌داشته‌شده را پاک کند.
- مکان‌ها و متن‌ها مثل قبل با همگام‌سازی تاریخچه می‌رسند.

A new switch in the same two places: "Sync all content". While it is on, every file,
photo, video, voice note, sticker, and GIF a device lacks moves over by itself and is
kept there, whenever another device that has it is online. There is nothing to press.
The transfer is direct, device to device, with the same extra encryption "Fetch from my
other device" uses. No byte passes through the server, and nothing stays on it.

- The choice is the account's: switched on or off on any device, it reaches the others.
- A self-destruct or view-once message is not fetched by itself.
- A file larger than the app's own store (64 MB) is still one tap away.
- The automatic transfer never goes so far that the app would remove files it already
  keeps to make room.
- Locations and text arrive with the history sync, as before.

---

## کارت «این فایل روی این دستگاه نیست» · The "not on this device" card

این کارت حالا یک ردیف است: یک خط که می‌گوید چه چیزی اینجا نیست (فایل، استیکر، گیف یا
پیام صوتی)، و کنارش «دریافت از دستگاه دیگر» که شکل یک دکمهٔ واقعی دارد. استیکر و گیف هم
دیگر در یک قاب مربع باریک فشرده نمی‌شوند. فقط روی صفحه‌ای که برای هر دو جا ندارد، دکمه به
خط بعد می‌رود.

The card is now one row: one line saying what is missing here (a file, sticker, GIF, or
voice note), and beside it "Fetch from my other device", which looks like a real button.
Stickers and GIFs are no longer squeezed into a narrow square frame. Only on a screen too
narrow for both does the button move to the next line.

---

## اصلاحات امنیتی و پایداری · Security and reliability fixes

- **پاک‌سازی اضطراری فقط با اثبات هویت**: درخواست پاک کردن داده‌های یک حساب روی سرور
  (صف پیام‌ها، beacon‌ها و اشتراک اعلان) قبلاً فقط به ادعای اثرانگشت بسنده می‌کرد. اثرانگشت
  و کلید عمومی هر دو عمومی‌اند، پس هر کسی می‌توانست صف پیام‌های دیگران را خالی کند. حالا
  سرور فقط از اتصالی که هویتش را ثابت کرده قبول می‌کند. فهرست دستگاه‌ها هم فقط با پاک‌سازی
  خود دستگاه اصلی حذف می‌شود.
- **اثبات هویت پس از سلام دوباره**: وقتی برنامه دو بار پشت سر هم سلام می‌کرد، جواب دیررسِ
  چالش اول، چالش دوم را هم باطل می‌کرد. اتصال تا آخر ثابت‌نشده می‌ماند و صندوق پیام، beacon
  و همگام‌سازی به آن جواب نمی‌دادند. سرور حالا جواب چالش قدیمی را کنار می‌گذارد و برنامه
  کلید دستگاه را پیش از اولین سلام آماده می‌کند تا فقط یک بار سلام کند.
- **«بازنشانی کلید چت» واقعاً کلید تازه می‌سازد**: کلید قبلی از حافظهٔ زنده دوباره خوانده
  می‌شد و بازنشانی در عمل کاری نمی‌کرد.

- **An emergency wipe needs proof of identity**: the request to wipe an account's data
  on the server (queued mail, beacons, and the push registration) used to accept a
  claimed fingerprint alone. A fingerprint and its public key are both public, so anyone
  could empty someone else's queued mail. The relay now accepts it only from a connection
  that has proven the identity. The device list is removed only when the primary itself
  wipes.
- **Proof of identity after a second hello**: when the app said hello twice in a row,
  the late answer to the first challenge cancelled the second one. The connection then
  stayed unproven for good, and the mailbox, beacons, and sync did not answer it. The
  relay now sets an old challenge's answer aside, and the app gets the device key ready
  before its first hello, so it says hello only once.
- **"Reset chat key" really makes a new key**: the old key was read straight back from
  the live cache, so the reset did nothing in practice.

---

# P00RIJA Cryptography 2.98.68

Version 2.98.68 · build chat-v161

---

## همگام‌سازی چند دستگاه، امن‌تر · Several devices, made safer

بازبینی امنیتی همگام‌سازی چند دستگاهیِ 2.98.67 سه نکته پیدا کرد که همه برطرف شدند:

- **رمزگذاری فایل در خود برنامه**: فایلی که از دستگاه دیگر آورده می‌شود دیگر فقط به
  رمزگذاری کانال WebRTC تکیه نمی‌کند. رله‌ای که دو دستگاه را به هم معرفی می‌کند، در اصل
  می‌توانست خودش را وسط آن‌ها بگذارد. حالا دستگاهی که فایل را می‌خواهد برای همین یک انتقال
  یک کلید AES-GCM تازه می‌سازد. این کلید را با کلید عمومی حساب مهر می‌کند، تا فقط دستگاه
  همین حساب بتواند بازش کند، و همراه چالش امضا می‌کند. همهٔ تکه‌های فایل، و نام و اندازهٔ
  آن، با این کلید رمزگذاری‌شده منتقل می‌شوند. هر چه وسط راه باشد فقط متن رمزی می‌بیند و
  نمی‌تواند کلید را عوض کند.
- **سقف حافظه و دیسک سرور**: آنچه رله برای دستگاه آفلاین نگه می‌دارد حالا سقف کلی هم
  دارد: ۲۵۶ مگابایت برای کل رله (قابل تنظیم با `CHAT_SIBLING_MAX_BYTES`) و حداکثر ۳۲
  مگابایت در حافظه. اگر رله پر شود، دیگر چیزی نگه نمی‌دارد و دستگاه بقیه را مستقیم از
  دستگاه دیگر می‌گیرد. مدت نگهداری هم از ۳۰ روز به ۱۴ روز کم شد.
- **پیام‌های گذرا روی سرور نمی‌مانند**: پیام خودتخریب و یک‌بارمصرف هرگز در نسخه‌ای که
  رله نگه می‌دارد قرار نمی‌گیرد. چنین پیامی فقط وقتی به دستگاه دیگر می‌رسد که آن دستگاه
  آنلاین باشد؛ نسخهٔ ذخیره‌شده معنای «گذرا» بودنش را از بین می‌برد.

- **The file is encrypted by the app as well**: a file fetched from another device no
  longer relies on the WebRTC channel's encryption alone. The relay that introduces the
  two devices could, in principle, have put itself between them. Now the device asking
  for the file makes a fresh AES-GCM key for that one transfer. It seals the key to the
  account's public key, so only a device of this account can open it, and signs it with
  the challenge. Every piece of the file, and its name and size, travel encrypted with
  that key. Whatever sits in between sees only ciphertext and cannot swap the key.
- **A ceiling on the server's memory and disk**: what the relay keeps for an offline
  device now has an overall cap as well: 256 MB for the whole relay (set with
  `CHAT_SIBLING_MAX_BYTES`), and at most 32 MB in memory. When the relay is full it keeps
  nothing more, and the device gets the rest directly from another device. The keeping
  time is down from 30 days to 14.
- **Disappearing messages never stay on a server**: a self-destruct or view-once
  message is never put into a copy the relay keeps. It reaches another device only
  while that device is online; a stored copy would defeat the point of it.

---

# P00RIJA Cryptography 2.98.67

Version 2.98.67 · build chat-v160

---

## چند دستگاه با یک حساب، کامل همگام · Several devices on one account, fully in step

### چه چیزی کار نمی‌کرد

تستی که برای این نسخه نوشته شد، روی کد قبلی ۷ ایراد از ۱۵ بررسی را نشان داد:

- **ویرایش، ری‌اکشن و حذف**: ویرایش پیام، ری‌اکشن و حذف یک پیام روی یک دستگاه به دستگاه
  دیگر نمی‌رسید؛ فقط پیام تازه می‌رسید.
- **دستگاه آفلاین**: دستگاهی که آفلاین بود، پیام‌ها را فقط وقتی می‌گرفت که خودش و دستگاه
  دیگر هم‌زمان آنلاین باشند. اگر دستگاه دیگر تا آن موقع رفته بود، هیچ چیز نمی‌رسید.
- **فایل بزرگ**: فایل بزرگ از دستگاه دیگر تکه‌تکه و از مسیر رله می‌آمد. سقف آن ۱۶ مگابایت
  بود و فایل بزرگ‌تر، بی‌هیچ هشداری، **بریده و ناقص ذخیره می‌شد**. یک فایل ۲۰ مگابایتی با
  ۲۶۰ بستهٔ رله، ۱۶ مگابایت ذخیره شد.

### حالا

- **هر تغییر، به همهٔ دستگاه‌ها**: هر تغییری در تاریخچهٔ یک دستگاه، یعنی پیام فرستاده یا
  رسیده، ویرایش، ری‌اکشن، سنجاق، وضعیت تحویل و پیام حذف‌شده، همان لحظه به دستگاه‌های آنلاین
  دیگر می‌رسد. برنامه تغییر را از مقایسهٔ هر پیام با آخرین حالتی که دستگاه‌های دیگر دیده‌اند
  پیدا می‌کند، پس هر راهی که تاریخچه عوض شود پوشش داده می‌شود. چیزی هم که از دستگاه دیگر
  می‌رسد دوباره برگردانده نمی‌شود.
- **دستگاه آفلاین، بی‌نیاز از دستگاه دیگر**: برای دستگاهی که در آن لحظه آفلاین است، رله
  یک نسخه از همین تغییرها را نگه می‌دارد. این نسخه فقط برای همان دستگاه است، با کلید خود
  حساب رمزگذاری شده و رله نمی‌تواند بازش کند. دستگاه وقتی آنلاین شد آن را می‌گیرد، حتی اگر
  دستگاه دیگر دیگر آنلاین نباشد، و رله همان لحظه پاکش می‌کند.
  - برای دستگاهی که آنلاین است هیچ چیز نگه داشته نمی‌شود.
  - هیچ فایلی هرگز در آن نیست؛ هر بسته حداکثر ۹۶ کیلوبایت است.
  - برای هر حساب سقف ۴ مگابایت و ۲۰۰۰ بسته و حداکثر ۳۰ روز دارد. اگر سقف پر شود،
    دستگاه با خبر می‌شود و بقیه را مستقیم از دستگاه دیگر می‌گیرد.
- **فایل‌ها مستقیم از دستگاه به دستگاه**: با زدن «دریافت از دستگاه دیگر»، فایل از دستگاهی
  که آن را دارد، از راه یک کانال WebRTC، مستقیم می‌آید و هیچ بایتی از آن از رله نمی‌گذرد.
  - **احراز هویت دوطرفه**: پیش از انتقال، هر دو دستگاه با کلید خصوصی حساب ثابت می‌کنند
    همان حساب‌اند.
  - **بدون اشغال بی‌جای حافظه**: فایل در تکه‌های ۶۴ کیلوبایتی و با کنترل جریان می‌آید.
  - **ادامه از همان‌جا**: اگر کانال وسط راه قطع شود، از همان‌جا ادامه پیدا می‌کند.
  - **ذخیره و بررسی اندازه**: اندازهٔ کامل بررسی و فایل در فضای رمزگذاری‌شدهٔ برنامه ذخیره
    می‌شود. فایلی که بزرگ‌تر از این فضاست، روی خود دستگاه ذخیره می‌شود.
  - **همهٔ انواع فایل**: این دکمه حالا برای پیام صوتی، استیکر و گیف هم هست، نه فقط برای فایل.
  - **تنظیم**: «جابه‌جایی فایل بین دستگاه‌ها» روی دستگاهی که فایل را دارد تعیین می‌کند آن
    را بدهد یا نه.
- **سازگاری و ایراد ناقص ذخیره شدن**: برای دستگاهی که هنوز نسخهٔ قدیمی دارد، فایل کوچک به
  روش قدیم آورده می‌شود. ایراد ذخیره شدن ناقص هم رفع شد: فایل بزرگ‌تر از توان آن روش دیگر
  فرستاده یا ذخیره نمی‌شود.
- **سینک دستی**: «هم‌اکنون سینک کن» مثل قبل کار می‌کند و حالا چیزی را هم که رله برای این
  دستگاه نگه داشته می‌گیرد.
- یک بخش راهنما هم با عنوان «چند دستگاه با یک حساب» اضافه شد.

### What did not work

The test written for this release found 7 faults in 15 checks on the previous code:

- **Edits, reactions, and deletions**: editing a message, a reaction, and deleting a
  message on one device did not reach the other; only new messages did.
- **An offline device**: a device that had been offline got its messages only when it
  and another device were online at the same time. If the other had gone by then,
  nothing came.
- **A large file**: a large file from the other device came in pieces through the
  relay. That path stopped at 16 MB, and a larger file was **saved cut short, with no
  warning**. A 20 MB file took 260 relay frames and was saved as 16 MB.

### Now

- **Every change, to every device**: every change to one device's history (a message
  sent or received, an edit, a reaction, a pin, a delivery status, a deleted message)
  reaches the others that are online at once. Changes are found by comparing each
  message with how the other devices last saw it, so every way the history can change
  is covered. What arrives from another device is not sent back.
- **An offline device needs no other device**: for a device that is offline at that
  moment, the relay keeps a copy of those changes. The copy is for that device only,
  sealed to the account's own key, and the relay cannot open it. The device collects
  it when it comes online, even if the other device is no longer there, and the relay
  deletes it at once.
  - Nothing is kept for a device that is online.
  - It never holds a file; each piece is at most 96 KB.
  - Each account is capped at 4 MB, 2,000 pieces, and 30 days. If the cap is reached,
    the device is told and gets the rest directly from another device.
- **Files device to device**: "Fetch from my other device" brings a file straight from
  the device that has it, over a WebRTC channel, and not one byte of it passes through
  the relay.
  - **Mutual proof**: before anything moves, both devices prove with the account's
    private key that they are the same account.
  - **No needless memory use**: the file comes in 64 KB pieces with flow control.
  - **Picks up where it stopped**: a channel that drops part-way resumes from there.
  - **Size checked, then kept**: the full size is checked and the file is kept in the
    app's encrypted store. One larger than that store is saved to the device itself.
  - **Every kind of file**: the button now shows for voice notes, stickers, and GIFs
    too, not just files.
  - **The setting**: "Move files between devices", on the device that has the file,
    decides whether it hands it over.
- **Compatibility, and the cut-short fault**: for a device still on an older build, a
  small file comes the old way. The cut-short fault is fixed: a file larger than that
  way can carry is no longer sent or saved.
- **Manual sync**: "Sync now" works as before, and now also collects whatever the relay
  kept for this device.
- A help section, "Several devices on one account", is added.

---

# P00RIJA Cryptography 2.98.66

Version 2.98.66 · build chat-v159

---

## lottie-web به آخرین نسخه · lottie-web at its latest release

- آخرین نسخهٔ منتشرشدهٔ lottie-web، یعنی ۵.۱۳.۰، با رجیستری npm بررسی شد. دو نسخهٔ
  canvas از قبل ۵.۱۳.۰ بودند، ولی پخش‌کنندهٔ SVG هنوز ۵.۱۲.۲ بود. حالا هر سه یک نسخه‌اند.
  این پخش‌کننده تصویرهای ثابت را می‌سازد و هر جا canvas نباشد استیکرهای Lottie را پخش
  می‌کند. نسخهٔ ۵.۱۳.۰ ماتریس تبدیل‌های ثابت را دوباره حساب نمی‌کند (بهبود محسوس
  سرعت)، کش گرادیان‌ها را درست باطل می‌کند و در worker هم از resetSegments پشتیبانی
  دارد. فایل‌ها همان بستهٔ رسمی npm هستند و امضای آن با رجیستری یکی است.
- The latest lottie-web release, 5.13.0, was checked against the npm registry. The
  two canvas builds were already 5.13.0, but the SVG player was still 5.12.2. All
  three are one version now. That player makes the stills and plays Lottie stickers
  wherever a canvas cannot be had. 5.13.0 no longer recomputes static transform
  matrices (a noticeable speed-up), invalidates gradient caches correctly, and
  supports resetSegments in the worker. The files are the official npm package, and
  its integrity hash matches the registry's.

---

# P00RIJA Cryptography 2.98.65

Version 2.98.65 · build chat-v158

---

## حذف کامل‌تر کد از استیکر · Expressions taken out of a sticker more thoroughly

- در 2.98.64 فقط expressionی برداشته می‌شد که به‌صورت متن بود. پخش‌کننده هر چیزی را که
  زیر آن کلید ببیند در کدش می‌گذارد، و فهرستی از متن‌ها هم با به هم چسبیدن به کد تبدیل
  می‌شد. حالا آن کلید فقط وقتی می‌ماند که نتواند کد باشد: عدد یا فهرستی از عددها (دسته‌های
  نرمی حرکت)، یا شیء (مثل جزء x یک موقعیت جداشده، که درونش هم همین‌طور بررسی می‌شود).
  یک تست هر سه حالت را می‌سنجد.
- In 2.98.64 only an expression written as text was taken out. The player puts
  whatever it finds under that key into its code, and a list of strings became code
  too once joined. Now the key stays only when it cannot be code: a number or a list
  of numbers (the easing handles), or an object (such as a split position's x part,
  whose insides are checked the same way). A test covers all three cases.

---

# P00RIJA Cryptography 2.98.64

Version 2.98.64 · build chat-v157

---

## هیچ کدی از داخل استیکر اجرا نمی‌شود · Nothing inside a sticker is ever run

- انیمیشن Lottie می‌تواند «expression» داشته باشد: تکه‌کدهای جاوااسکریپت که lottie-web با
  eval اجرا می‌کند. نسخهٔ canvas که در 2.98.63 برای روان شدن دسکتاپ اضافه شد این قابلیت را
  دارد. استیکر از هر کسی که آن را فرستاده یا پک را ساخته می‌آید، پس حالا پیش از آن‌که
  انیمیشن به هر پخش‌کننده‌ای داده شود، همهٔ expressionها از آن برداشته می‌شوند. استیکرهای
  تلگرام هیچ‌وقت expression ندارند و سیاست امنیتی صفحه هم eval را از قبل رد می‌کرد؛ این
  لایه مستقل از هر دو کار می‌کند. یک تست هم این را می‌سنجد.
- A Lottie animation can carry "expressions": snippets of JavaScript that lottie-web
  runs with eval. The canvas build added in 2.98.63 to make the desktop smooth has
  that ability. A sticker comes from whoever sent it or made its pack, so every
  expression is now taken out of an animation before it is handed to any player.
  Telegram's stickers never carry one, and the page's security policy already
  refused eval; this layer holds regardless of either. A test checks it.

---

# P00RIJA Cryptography 2.98.63

Version 2.98.63 · build chat-v156

---

## استیکرهای متحرک روان روی دسکتاپ · Smooth animated stickers on the desktop

- **مشکل**: روی مک، در نسخهٔ نیتیو و PWA، با چند پک متحرک یا پک‌های سنگین، باز شدن پنل
  کند بود و برنامه مدام گیر می‌کرد. اندازه‌گیری روی همان موتور WebKit مک نشان داد: با یک
  پک Lottie که ۴۰ استیکرش هم‌زمان روی صفحه بود، صفحه فقط ۲۸ فریم در ثانیه رسم می‌کرد و
  اسکرول پنل ۲۲ فریم بود. علت: پنجرهٔ دسکتاپ سه چهار برابر گوشی استیکر نشان می‌دهد، و
  هر استیکر Lottie یک صحنهٔ SVG بود که شصت بار در ثانیه و همه با هم دوباره رسم می‌شد.
- **حالا**:
  - **رسم روی canvas**: استیکرهای Lottie روی canvas رسم می‌شوند، نه SVG. در Chrome و
    Firefox این کار روی یک worker و در یک هستهٔ دیگر پردازنده انجام می‌شود و صفحه فقط
    نتیجه را نشان می‌دهد. در WebKit، یعنی Safari، آیفون و پنجرهٔ نسخهٔ نیتیو مک، روی خود
    صفحه انجام می‌شود، چون WebKit هر فریم canvasِ worker را از مسیر صفحه برمی‌گرداند و
    اندازه‌گیری نشان داد کندتر است.
  - **یک ساعت مشترک با سقف زمانی**: همهٔ استیکرها با یک ساعت مشترک و در سقف چند
    میلی‌ثانیه از هر فریم رسم می‌شوند. هر استیکر همیشه با سرعت واقعی خودش جلو می‌رود؛
    اگر کار زیاد شود، استیکرها کمتر بار در ثانیه رسم می‌شوند (۶۰، بعد ۳۰، ۲۰ و ۱۵) به‌جای
    آن‌که خود صفحه فریم از دست بدهد. وقتی جا باز شد، دوباره بالا می‌روند.
  - **ساخت در سقف زمانی هر فریم**: ساختن هر استیکر Lottie، که سنگین‌ترین مرحله است، در
    همان سقف زمانی هر فریم انجام می‌شود. پیش از این همه با هم ساخته می‌شدند و همین یک
    ثانیه گیر می‌ساخت. ویدیوها هم حداکثر دوتا در هر فریم شروع می‌شوند.
  - **وقفه در هنگام اسکرول**: وقتی پنل اسکرول می‌شود، شروع استیکرهای سنگین صبر می‌کند و
    تصویر ثابتشان خانه را پر می‌کند. به محض ایستادن اسکرول، شروع می‌شوند.
  - **آزاد کردن بیرون از دید**: استیکری که از دید خارج شود، صحنه‌اش را آزاد می‌کند.
  - **تصویرهای ثابت تنبل**: تصویرهای ثابت استیکرهای متحرک، به‌جز چند ردیف اول، وقتی
    نزدیک دید شوند بار می‌شوند، نه همه با هم.
  - **آزاد شدن دیرتر نشانی‌ها**: نشانی تصویرها کمی دیرتر آزاد می‌شود، تا تصویر یا
    ویدیویی که هنوز روی صفحه است خطا ندهد و پنل همهٔ پک‌ها را از نو بار نکند.
  - **نتیجه روی همان موتور WebKit**: با ۴۱ استیکر Lottie متحرک، ۶۰ فریم در ثانیه (قبلاً
    ۲۸)؛ اسکرول ۵۵ فریم (قبلاً ۲۲)؛ هیچ مکث بالای ربع ثانیه در باز شدن پنل، اسکرول یا
    جابه‌جایی بین پک‌ها.
- **ویدیوی استیکر روی WebKit**: WebKit در فایل WebM که فهرست ندارد نمی‌تواند به عقب
  برگردد. اگر استیکری بعد از برگشت به اول هم حرکت نکند، فایل دوباره بار می‌شود. توقف در
  فریم آخر هم دیگر زودتر از موعد تشخیص داده نمی‌شود، چون ساعت ویدیو در WebKit پله‌پله جلو
  می‌رود و تشخیص زودهنگام انتهای انیمیشن را می‌برید.
- **کتابخانه**: دو نسخهٔ canvas از همان lottie-web (۵.۱۳.۰، با مجوز MIT) کنار نسخهٔ SVG
  اضافه شد. هر دو فقط وقتی لازم شوند بار می‌شوند و برای کار آفلاین هم در کش برنامه‌اند.
- **The problem**: on a Mac, in the native app and the PWA, with several moving packs
  or heavy ones, the panel was slow to open and the app kept hanging. Measured in
  the same WebKit engine: with a Lottie pack showing 40 stickers at once, the page drew
  only 28 frames a second, and scrolling the panel 22. The cause: a desktop window
  shows three or four times the stickers a phone does, and each Lottie sticker was
  an SVG scene redrawn sixty times a second, all of them at once.
- **Now**:
  - **Drawn on a canvas**: Lottie stickers are drawn on a canvas, not as SVG. In
    Chrome and Firefox that happens in a worker, on another core, and the page only
    shows the result. In WebKit (Safari, the iPhone, and the native app's window on
    macOS) it happens on the page itself, because WebKit hands each frame of a
    worker's canvas back through the page, and measured, that was slower.
  - **One clock, with a budget**: every sticker is drawn by one shared clock, within a
    few milliseconds of each frame. Each sticker always moves at its own true speed;
    when the work is too much, the stickers are drawn fewer times a second (60, then
    30, 20, and 15) rather than the page losing frames. When there is room again,
    they go back up.
  - **Built within the frame budget**: building each Lottie sticker, the heaviest
    step, happens within the same per-frame budget. Before, they were all built at
    once, which made a one-second hang. Videos start at most two to a frame.
  - **Waiting while scrolling**: while the panel is scrolled, heavy stickers wait to
    start and their stills fill the cells. They start the moment the scrolling stops.
  - **Let go off screen**: a sticker that leaves the view gives up its scene.
  - **Lazy stills**: the stills of moving stickers, apart from the first rows, load
    as they near the view, not all at once.
  - **Picture addresses let go a little later**: so a picture or video still on the
    page does not fail, and the panel does not reload every pack.
  - **Results, in the same WebKit engine**: with 41 moving Lottie stickers, 60 frames
    a second (28 before); scrolling at 55 (22 before); and no pause of a quarter of a
    second while the panel opens, scrolls, or switches between packs.
- **Video stickers in WebKit**: WebKit cannot seek back in a WebM file that carries no
  index. A sticker that does not move after being sent back to the start is loaded
  again. A stop on the last frame is no longer called too early either: WebKit moves
  a video's clock in steps, and calling it early cut off the end of the animation.
- **Library**: two canvas builds of the same lottie-web (5.13.0, MIT licence) are
  added beside the SVG one. Both load only when needed, and both are in the app's
  cache for offline use.

---

# P00RIJA Cryptography 2.98.62

Version 2.98.62 · build chat-v155

---

## اتصالی که گیر می‌کرد و فقط با پاک‌سازی درست می‌شد · A connection that stuck until a wipe

- **مشکل**: گاهی برنامه به سرور چت وصل نمی‌شد. «اتصال دوباره» کمکی نمی‌کرد و خطای PeerJS
  نشان داده می‌شد. فقط پاک‌سازی امن و راه‌اندازی دوباره درستش می‌کرد.
- **علت**: وقتی رله می‌گوید شناسهٔ اتصال حساب در حال استفاده است، دستگاه شناسهٔ خودش را
  می‌گیرد: شناسهٔ حساب به‌علاوهٔ بخشی از شناسهٔ دستگاه. این حالت دو جا پیش می‌آید: وقتی
  دستگاه لینک‌شدهٔ دیگری از همان حساب آنلاین است، یا وقتی اتصال قبلی خود دستگاه بعد از یک
  بسته شدن ناگهانی، مثلاً PWA در پس‌زمینهٔ آیفون، هنوز روی رله مانده است. این دو بخش با
  «~» به هم وصل می‌شدند، که PeerJS در شناسه نمی‌پذیرد. پس اتصال هرگز باز نمی‌شد. این تصمیم
  در پروفایل ذخیره می‌شد، و برای همین هر تلاش و هر بار باز کردن برنامه همان‌طور شکست
  می‌خورد.
- **حالا**: دو بخش با «-» و فقط با حرف و عدد وصل می‌شوند، و شناسهٔ دستگاه همیشه معتبر و در
  هر اتصال یکسان است. دستگاهی که الان در این حالت گیر کرده، با همین نسخه خودش وصل می‌شود و
  پاک‌سازی لازم نیست. اگر PeerJS به هر دلیلی شناسه‌ای را نپذیرد، برنامه دیگر همان را
  بی‌پایان امتحان نمی‌کند و به شناسهٔ حساب برمی‌گردد.
- **چند دستگاهی دست نخورده**: شناسهٔ حساب همچنان مال دستگاهی است که آن را دارد، و
  دستگاه‌های لینک‌شده و همگام‌سازی‌شان مثل قبل کار می‌کنند. فقط حالا آن دستگاه دوم واقعاً
  به P2P وصل می‌شود.
- **The problem**: sometimes the app would not connect to the chat server.
  Reconnecting did not help and a PeerJS error was shown. Only a secure wipe and a
  fresh start cleared it.
- **The cause**: when the relay says the account's connection id is in use, the
  device takes an id of its own: the account's id plus part of the device id. That
  happens in two cases: when another linked device of the same account is online,
  or when the device's own earlier connection is still registered on the relay
  after an abrupt close, such as a PWA in the background on an iPhone. The two parts
  were joined with "~", which PeerJS does not accept in an id, so the connection
  never opened. The choice was kept in the profile, which is why every try and
  every restart failed the same way.
- **Now**: the two parts are joined with "-", in letters and digits only, and the
  device's id is always valid and the same on every connect. A device stuck in this
  state today connects on its own with this release, with no wipe. If PeerJS refuses
  an id for any reason, the app no longer retries it forever; it goes back to the
  account's id.
- **Multiple devices untouched**: the account's id stays with the device that holds
  it, and linked devices and their sync work as before. The difference is that the
  second device now really gets onto P2P.

---

# P00RIJA Cryptography 2.98.61

Version 2.98.61 · build chat-v154

---

## اندازهٔ درست شاخص متحرک، و دسکتاپ روان‌تر · Moving covers at the right size, and a smoother desktop

- **اندازهٔ شاخص متحرک**: در «مدیریت پک‌ها»، شاخصِ متحرک به‌جای اندازهٔ یک تصویر کوچک
  به پهنای کل ردیف بزرگ می‌شد. یک قاعدهٔ عمومی «کادرت را پر کن» که بعد از قاعدهٔ اندازهٔ
  شاخص در فایل استایل آمده بود، اندازه را لغو می‌کرد. حالا شاخص متحرک دقیقاً هم‌اندازهٔ
  شاخص ثابت است و در نوار پک‌ها هم در کادر خودش می‌ماند. یک تست هم این اندازه را
  می‌سنجد.
- **دسکتاپ (برنامهٔ نیتیو و PWA)**: همهٔ امکانات تازهٔ استیکر و گیف، یعنی تصویر ثابت،
  پخش دائم، دیدن بزرگ، شاخص متحرک و راه‌اندازی دوبارهٔ ویدیو، روی دسکتاپ هم بررسی شد
  و درست کار می‌کند. روی macOS، برنامهٔ نیتیو همان موتور WebKit آیفون را دارد و اصلاح
  توقف استیکر ویدیویی شامل آن هم می‌شود. علاوه بر این:
  - پنل استیکر در پنجرهٔ بزرگ بلندتر است؛ روی گوشی باید جا را با کیبورد تقسیم کند،
    روی دسکتاپ نه.
  - استیکری که نشانگر موس رویش است کمی بزرگ و جلو می‌آید، و روی استیکر داخل گفتگو
    نشانگر ذره‌بین نشان می‌دهد که با کلیک بزرگ می‌شود.
  - روی دسکتاپ تصویرهای پنل از فاصلهٔ دورتری آماده می‌شوند، و روی دستگاه‌های با
    هستهٔ بیشتر، تصویرهای ثابت تا شش‌تا‌شش‌تا ساخته می‌شوند.
- **Moving covers at the right size**: in Manage packs, a moving cover grew to the
  width of the whole row instead of the size of a small picture. A general "fill
  your box" rule that came after the cover's size in the stylesheet overrode the
  size. A moving cover is now exactly the size of a still one, and in the pack bar
  it stays in its box too. A test measures it.
- **The desktop (native app and PWA)**: every new sticker and GIF feature (stills,
  playing forever, the up-close view, moving covers, and restarting a stuck video)
  was checked on the desktop and works there. On macOS the native app runs the
  same WebKit as an iPhone, so the fix for a video sticker stopping on its last
  frame covers it as well. On top of that:
  - The sticker panel is taller in a large window; a phone has to share its screen
    with the keyboard, a desktop does not.
  - A sticker under the pointer grows a little and comes forward, and a sticker in
    a conversation shows a zoom pointer, since a click lifts it.
  - On a desktop the panel's pictures are made ready from further ahead, and a
    machine with more cores makes stills up to six at a time.

---

# P00RIJA Cryptography 2.98.60

Version 2.98.60 · build chat-v153

---

## استیکر بدون مکث، شاخص متحرک، پک‌های سریع‌تر · Stickers without the pause, moving covers, faster packs

- **پخش دوباره بدون مکث**: روی آیفون، استیکر ویدیویی (WebM) بعد از دو سه بار پخش روی
  فریم آخر می‌ایستاد. نسخهٔ قبل آن را دوباره راه می‌انداخت، ولی بررسی هر یک و نیم ثانیه
  انجام می‌شد و همین دو سه ثانیه مکث می‌ساخت. حالا وضعیت پخش هر فریم بررسی می‌شود و
  استیکری که در انتها ایستاده در کسری از ثانیه از اول پخش می‌شود. استیکری هم که خودش
  تمام شود بلافاصله دوباره شروع می‌شود.
- **تصویر شاخص متحرک**: اگر استیکری که شاخص پک است متحرک باشد، در نوار پک‌ها، «مدیریت
  پک‌ها» و صفحهٔ انتخاب شاخص هم متحرک نمایش داده می‌شود.
- **پک‌های بزرگ سریع‌تر**:
  - تصویرهای ثابت همهٔ پک‌ها چند ثانیه بعد از باز شدن برنامه در پس‌زمینه ساخته می‌شوند،
    نه اولین باری که پک را باز می‌کنید. ساختشان هم سه‌تا‌سه‌تا انجام می‌شود، نه یکی‌یکی.
  - چند ردیف اول پک همراه خود پنل رسم می‌شوند، بی آن‌که منتظر نوبت بمانند.
  - استیکرهای متحرک چندتا‌چندتا در هر فریم شروع می‌شوند، نه همه با هم؛ پس باز شدن یک
    پک بزرگ دیگر گیر نمی‌کند.
- **پراکسی و Xray در نسخهٔ وب و PWA**: صفحهٔ وب نمی‌تواند خودش از پراکسی عبور کند؛ مرورگر
  به هیچ صفحه‌ای چنین اجازه‌ای نمی‌دهد. به همین دلیل این گزینه فقط در برنامهٔ دسکتاپ
  است. در نسخهٔ وب و PWA، همان بخش حالا راهی را که کار می‌کند نشان می‌دهد: یک برنامهٔ
  v2ray/xray را روی دستگاه در حالت VPN روشن کنید (آیفون: Streisand یا V2Box؛ اندروید:
  v2rayNG). سیستم مرورگر و این برنامه را از آن عبور می‌دهد.
- **Replays without the pause**: on an iPhone a video (WebM) sticker stopped on its
  last frame after two or three plays. The last release started it again, but it
  checked only every second and a half, which made a pause of two or three seconds.
  Now playback is checked every frame, and a sticker stuck at its end is back at
  the start within a fraction of a second. One that ends on its own starts again
  at once.
- **Moving covers**: when the sticker a pack is known by moves, it moves in the pack
  bar, in Manage packs, and on the cover chooser too.
- **Big packs, faster**:
  - The stills for every pack are made in the background a few seconds after the
    app opens, not the first time you open the pack. They are made three at a time,
    not one by one.
  - The first rows of a pack are drawn with the panel itself, without waiting
    their turn.
  - Moving stickers start a few per frame rather than all at once, so opening a big
    pack no longer stutters.
- **Proxy and Xray on the web and in the PWA**: a web page cannot go through a proxy
  on its own; the browser lets no page do that. That is why the setting is only in
  the desktop app. On the web and in the PWA the same section now shows what works:
  turn on a v2ray/xray client on the device in VPN mode (iPhone: Streisand or V2Box;
  Android: v2rayNG). The system routes the browser, and this app with it, through it.

---

# P00RIJA Cryptography 2.98.59

Version 2.98.59 · build chat-v152

---

## استیکرهای روان، همیشه متحرک، و دیدن بزرگ · Smooth stickers that keep moving, seen up close

- **پک‌های بزرگ بدون تکه‌تکه لود شدن**: هر استیکر حالا یک تصویر ثابت کوچک دارد: فریم
  اول ویدیو، یک فریم از انیمیشن Lottie، یا فریم اول تصویر متحرک. پنل این تصویر را فوراً
  نشان می‌دهد و استیکر متحرک وقتی روی صفحه است و آماده شد، نرم رویش ظاهر می‌شود. پیش از
  این، استیکرهای ویدیویی و Lottie یک پک تلگرام تا لود شدن کامل خالی بودند. برای پک‌هایی
  که از قبل داشتید، این تصویرها در پس‌زمینه ساخته می‌شوند و از بالای پک یکی‌یکی پر
  می‌شوند.
- **انیمیشن روان‌تر**: استیکرهای Lottie فقط وقتی نزدیک دید هستند پخش می‌شوند، بیرون از
  دید متوقف می‌شوند، و انیمیشن‌هایی که با هر بار رسم دوباره کنار گذاشته می‌شدند دیگر
  پنهانی ادامه نمی‌دهند. قبلاً همهٔ استیکرهای یک پک هم‌زمان در حال پخش بودند و همین روی
  گوشی کندی و لرزش می‌آورد. پنل دیگر بعد از هر ارسال استیکر همهٔ تصویرها را از نو بار
  نمی‌کند، و تصویرها کمی زودتر از رسیدن به دید آماده می‌شوند.
- **کیفیت بالاتر**: تصویر کوچک استیکرها ۲۵۶ پیکسل شد (قبلاً ۱۶۰) تا روی صفحهٔ آیفون تار
  نباشد.
- **همیشه در حال پخش**: خیلی از گیف‌ها و استیکرهای متحرک داخل خودشان نوشته‌اند چند بار
  پخش شوند، مثلاً دو یا سه بار، و بعد روی فریم آخر می‌ایستادند. حالا همهٔ آن‌ها، چه در پنل
  و قفسهٔ گیف، چه در گفتگو، برای همیشه پخش می‌شوند. فقط همان عدد تکرار عوض می‌شود و بقیهٔ
  فایل دست نمی‌خورد. استیکر ویدیویی‌ای که سیستم وسط کار متوقفش کند خودکار دوباره پخش
  می‌شود.
- **دیدن بزرگ**: با زدن روی استیکر یا گیف داخل گفتگو، استیکر بزرگ و متحرک روی پس‌زمینهٔ
  محو بالا می‌آید. ری‌اکشن‌ها (برای پیامی که دیگری فرستاده) و همهٔ کارهای منوی پیام
  همان‌جاست: پاسخ، افزودن به استیکرها یا گیف‌های من، کپی، سنجاق، هدایت و حذف. منوی پیام
  دست نخورده است؛ این دکمه‌ها همان دکمه‌های منو را می‌زنند. برای بستن، بیرون را بزنید،
  استیکر را پایین بکشید یا Esc را بزنید.
- **تصویر شاخص پک**: پک‌هایی که اولین استیکرشان ویدیو یا Lottie بود، مثل پک‌های تلگرام،
  در نوار پک‌ها و «مدیریت پک‌ها» به‌جای تصویر یک علامت سؤال داشتند. حالا تصویر دارند.
  شاخص هر پک را می‌توانید عوض کنید: در «مدیریت پک‌ها» روی تصویر پک بزنید و استیکر دلخواه
  را انتخاب کنید، یا در پنل استیکر یک استیکر را انتخاب کنید و «شاخص پک» را بزنید.
- **Big packs without the patchwork**: every sticker now has a small still: a
  video's first frame, a frame of a Lottie animation, or an animated picture's
  first frame. The panel draws the still at once, and the moving sticker fades in
  over it once it is on screen and ready. Before, the video and Lottie stickers of
  a Telegram pack were empty cells until they had loaded. For packs you already
  have, the stills are made in the background and fill in from the top.
- **Smoother animation**: Lottie stickers play only near the view, pause outside
  it, and the animations a redraw threw away no longer go on running unseen.
  Before, every sticker of a pack played at once, which is what made a phone slow
  and jittery. The panel no longer reloads every picture after each sticker sent,
  and pictures are ready a little before they scroll into view.
- **Sharper**: sticker thumbnails are 256 pixels now (160 before), so they are not
  soft on an iPhone's screen.
- **Always moving**: many GIFs and animated stickers say inside themselves how
  many times to play, two or three, say, and then stopped on their last frame.
  Now they all play forever, in the panel, on the GIF shelf, and in conversations.
  Only that count is changed; the rest of the file is left as it is. A video
  sticker the system pauses on its own is started again.
- **Up close**: tap a sticker or a GIF in a conversation and it lifts out, large
  and moving, over a blurred backdrop. Its reactions (on a message somebody else
  sent) and every action of the message menu are there with it: reply, add to my
  stickers or GIFs, copy, pin, forward, and delete. The message menu is untouched;
  these buttons press its own buttons. Tap outside, pull the sticker down, or press
  Esc to close it.
- **Pack covers**: packs whose first sticker was a video or a Lottie animation,
  like Telegram packs, showed a question mark instead of a picture in the pack bar
  and in Manage packs. They show a picture now. Any pack's cover can be changed:
  in Manage packs, tap the pack's picture and choose a sticker, or pick one sticker
  in the sticker panel and press "Pack cover".

---

# P00RIJA Cryptography 2.98.58

Version 2.98.58 · build chat-v151

---

## پک تلگرام کامل و درست وارد می‌شود · A Telegram pack imports whole and as itself

- **مشکل**: هنگام وارد کردن پک از لینک تلگرام، فقط چند استیکر اول درست بودند و بقیه
  تکرار یک استیکر بودند. پک دوم هم به‌جای خودش، دوباره همان پک اول وارد می‌شد. علت در
  Service Worker نسخهٔ وب و PWA بود: هر درخواستی را که نمی‌شناخت، مثل یکی از فایل‌های
  خود برنامه نگه می‌داشت، آن هم بدون بخش بعد از «?» آدرس. پس همهٔ فایل‌های پک یک آدرس
  داشتند و پاسخ اولی به بقیه هم داده می‌شد؛ توضیح پک دوم هم همان توضیح پک اول بود.
  وارد شدن «سریع» پک هم از همین بود: فایل‌ها اصلاً از رله گرفته نمی‌شدند.
- **حالا**: Service Worker فقط فایل‌های خود برنامه را نگه می‌دارد (صفحه، کد، فونت،
  تصویر). پاسخ رله‌ها همیشه از شبکه می‌آید. همین مشکل بی‌سروصدا اطلاعات رله‌ها
  (/relay-identity، /relay-fronts و /transit-peers) را هم تا نسخهٔ بعدی روی اولین پاسخ
  نگه می‌داشت؛ آن هم برطرف شد.
- **یک بررسی بیشتر**: برنامه حالا مطمئن می‌شود پکی که رله توضیح داده همان پکی است
  که خواسته شده، وگرنه آن را وارد نمی‌کند.
- **کمتر معطلی بعد از وارد کردن**: استیکرهایی که تازه از رله رسیده‌اند پیش از ذخیره
  دوباره کپی نمی‌شوند؛ آن کپی فقط برای تصویرهایی لازم است که از حافظهٔ برنامه خوانده
  شده‌اند.
- **پک‌هایی که قبلاً اشتباه وارد شده‌اند** درست نمی‌شوند: آن‌ها را حذف و دوباره از
  همان لینک وارد کنید. وارد کردن حالا کمی بیشتر طول می‌کشد، چون همهٔ فایل‌ها واقعاً
  از تلگرام گرفته می‌شوند؛ پیشرفت کار در نوار بالا دیده می‌شود.
- **The problem**: importing a pack from a Telegram link gave the first few
  stickers right and the rest as one sticker repeated, and a second pack came in as
  the first one again. The cause was the service worker of the web app and the
  PWA: it kept any request it did not know as if it were one of the app's own
  files, and with the part of the address after "?" cut off. Every file of a pack
  therefore had one address, the first answer was handed out for the rest, and the
  second pack's description was the first one's. That is also why the import looked
  quick: the files were never fetched from the relay.
- **Now**: the service worker keeps only the app's own files (pages, code, fonts,
  pictures). A relay's answers always come from the network. The same fault had
  quietly pinned relay information (/relay-identity, /relay-fronts, and
  /transit-peers) at its first answer until the next release; that is fixed too.
- **One more check**: the app now makes sure the pack the relay describes is the
  pack that was asked for, and imports nothing otherwise.
- **Less waiting after an import**: stickers fresh from the relay are no longer
  copied again before they are stored; that copy is only needed for pictures read
  out of the app's storage.
- **Packs imported wrongly before** are not repaired: delete them and import them
  again from the same link. An import now takes a little longer, because every file
  really is fetched from Telegram; the bar at the top shows how far it has got.

---

# P00RIJA Cryptography 2.98.57

Version 2.98.57 · build chat-v150

---

## پک‌های استیکر روی آیفون دیگر خراب نمی‌شوند · Sticker packs no longer break on an iPhone

- **مشکل**: روی آیفون، تصویری که از حافظهٔ برنامه (IndexedDB) خوانده می‌شود به فایلی وصل
  است که Safari برای همان رکورد نگه می‌دارد. اگر رکورد دوباره با همان تصویرها نوشته شود،
  رکورد تازه به فایل‌هایی اشاره می‌کند که Safari بعداً دور می‌ریزد. در نسخهٔ 2.98.55 برای
  پک‌های قدیمی تصویر کوچک ساخته و پک دوباره نوشته می‌شد، و همین پک‌هایی را که سالم بودند
  خراب کرد: تصویر شکسته یا خانهٔ خالی. اصلاح نسخهٔ 2.98.54 هم که بعد از نوشتن تصویرها را
  دوباره می‌خواند، گاهی تصویر استیکر دیگری را برمی‌گرداند؛ تکراری دیده شدن پک تلگرام از
  همین بود.
- **حالا**: پیش از هر نوشتن، از هر تصویر یک نسخه در حافظه گرفته می‌شود؛ Safari فایل تازهٔ
  خودش را ذخیره می‌کند و برنامه از همان نسخه نمایش می‌دهد. بعد از نوشتن هم چیزی دوباره
  خوانده نمی‌شود. این برای همهٔ نوشتن‌هاست: تصویر کوچک، کپی و انتقال و حذف استیکر، تغییر
  نام پک، ذخیره و حذف گیف.
- **پکی که قبلاً خراب شده**: اگر تصویرهای یک پک دیگر خوانده نشوند، برنامه هنگام نمایش آن
  پک می‌گوید که دوباره واردش کنید. استیکرهایی که از دست رفته‌اند برنمی‌گردند؛ پک را حذف
  و دوباره وارد کنید (پک تلگرام را از همان لینک).
- **The problem**: on an iPhone, a picture read from the app's storage (IndexedDB)
  is tied to a file Safari keeps for that record. Writing the record again with
  those same pictures leaves the new record pointing at files Safari later throws
  away. In 2.98.55 thumbnails were made for older packs and the pack written
  again, and that is what broke packs that had been fine: broken images or empty
  cells. The 2.98.54 attempt, which read the pictures back after writing, could
  return another sticker's picture; that is why a Telegram pack showed repeats.
- **Now**: before every write, each picture is copied into memory; Safari stores
  fresh files of its own and the app draws from the copies. Nothing is read back
  after a write. This holds for every write: thumbnails, copying, moving and
  deleting stickers, renaming a pack, saving and removing GIFs.
- **A pack damaged already**: when a pack's pictures can no longer be read, the app
  says so as it is shown and asks for it to be imported again. Stickers already
  lost do not come back; delete the pack and import it again (a Telegram pack from
  the same link).

---

# P00RIJA Cryptography 2.98.56

Version 2.98.56 · build chat-v149

---

## هدایت پیام‌ها کامل شد · Forwarding sends the real thing

- **پک استیکر**: هدایت یک پک استیکر فقط «هدایت‌شده: نام‌فایل.wastickers» می‌فرستاد و
  خود پک همراهش نبود. حالا خود پک با عنوان و تعداد استیکرهایش می‌رود و طرف مقابل
  می‌تواند اضافه‌اش کند.
- **کارت‌ها**: نظرسنجی، موقعیت و کارت مخاطب هم فقط به‌صورت یک خط متن می‌رفتند. حالا
  به‌صورت کارت واقعی هدایت می‌شوند. نظرسنجی با رأی‌های خالی می‌رود، و موقعیت زنده
  به‌صورت یک موقعیت ثابت در آخرین نقطه؛ هدایت یک اشتراک زنده معنایی ندارد.
- **فایل، پیام صوتی، استیکر و گیف** مثل قبل خودشان می‌روند؛ گیف حالا اندازه‌اش را هم
  همراه دارد. فایلی که حبابش هنوز نمایش داده نشده، از خزانهٔ دستگاه خوانده می‌شود.
- **چیزی خالی نمی‌رود**: پیام یک‌بار مصرف هدایت نمی‌شود، و پیامی که فایلش روی این
  دستگاه نیست به‌جای فرستادن نامش، با یک توضیح رد می‌شود.
- **پیام‌های ذخیره‌شده**: هدایت به پیام‌های ذخیره‌شده هم عنوان و تعداد پک و اندازهٔ گیف
  را نگه می‌دارد.
- **Sticker packs**: forwarding a sticker pack sent only "Forwarded:
  name.wastickers", with no pack attached. The pack itself now goes, with its
  title and sticker count, and the other person can add it.
- **Cards**: polls, locations, and contact cards also went as a single line of
  text. They now forward as real cards. A poll goes with its votes cleared, and
  a live location as a fixed location at its last point; forwarding a live share
  makes no sense.
- **Files, voice notes, stickers, and GIFs** go as themselves, as before; a GIF
  now carries its size too. A file whose bubble has not been drawn yet is read
  from the device's vault.
- **Nothing goes empty**: a view-once message is not forwarded, and a message
  whose file is not on this device is refused with an explanation instead of
  sending its name.
- **Saved Messages**: forwarding into Saved Messages keeps a pack's title and
  count and a GIF's size as well.

---

# P00RIJA Cryptography 2.98.55

Version 2.98.55 · build chat-v148

---

## پک‌های استیکر سنگین دیگر گوشی را قفل نمی‌کنند · Heavy sticker packs no longer freeze a phone

- **مشکل**: هر پک تا ۲۴۰ استیکر دارد، و پنل همهٔ آن‌ها را با اندازهٔ کامل ۵۱۲ پیکسل و
  همه را با هم بارگذاری می‌کرد؛ روی گوشی یعنی حدود ۲۴۰ مگابایت تصویر هم‌زمان و یک برنامهٔ
  قفل‌شده. پک‌های تلگرام دقیقاً همین شکل‌اند: پر و با فایل‌های .webp ۵۱۲ پیکسلی.
- **حالا**:
  - هر استیکر ثابت هنگام وارد شدن یک تصویر کوچک ۱۶۰ پیکسلی می‌گیرد و پنل همان را نشان
    می‌دهد؛ برای ارسال، خود استیکر کامل فرستاده می‌شود. پک‌هایی که قبلاً وارد شده‌اند در
    پس‌زمینه تصویر کوچک می‌گیرند.
  - فقط استیکرهایی که روی صفحه یا نزدیک آن هستند بارگذاری می‌شوند و آن‌هایی که دور شده‌اند
    آزاد می‌شوند. قفسهٔ گیف هم همین‌طور.
  - وارد کردن پک بزرگ بین استیکرها به برنامه فرصت نفس کشیدن می‌دهد و پیشرفتش را نشان
    می‌دهد.
- **The problem**: a pack holds up to 240 stickers, and the panel loaded every one
  at its full 512 px, all at once; on a phone that is about 240 MB of pictures at
  the same moment and a frozen app. Telegram packs are exactly that shape: full,
  and 512 px .webp files.
- **Now**:
  - Each static sticker gets a 160 px thumbnail as it is imported, and the panel
    shows that; sending sends the full sticker. Packs imported before get their
    thumbnails in the background.
  - Only the stickers on screen or near it are loaded, and the ones scrolled far
    away are let go. The GIF shelf works the same way.
  - Importing a large pack lets the app breathe between stickers and shows its
    progress.

## وارد کردن پک استیکر از لینک تلگرام · Importing a sticker pack from a Telegram link

- در پنل استیکر، دکمهٔ «وارد کردن» حالا دو گزینه دارد: «از فایل» و «از لینک تلگرام». لینک
  اشتراک پک را (مثل t.me/addstickers/نام_پک) بچسبانید تا پک با عنوان و ایموجی‌هایش اضافه
  شود؛ استیکرهای ثابت، متحرک (.tgs) و ویدیویی (.webm).
- تلگرام پک را فقط از راه API ربات می‌دهد، پس رله آن را می‌گیرد: رله با توکن ربات خودش
  (TELEGRAM_BOT_TOKEN) از تلگرام می‌پرسد، و رله‌ای که به تلگرام دسترسی ندارد سؤال را به
  رله‌ای که دارد می‌سپارد (TELEGRAM_STICKERS_UPSTREAM). توکن هرگز از رله بیرون نمی‌رود و
  تلگرام آدرس رله را می‌بیند، نه آدرس شما. رله فقط فایل‌های همان پکی را می‌گیرد که توصیفش
  کرده است.
- اگر رله هیچ‌کدام را نداشته باشد، برنامه همین را توضیح می‌دهد.
- In the sticker panel, the Import button now offers "From a file" and "From a
  Telegram link". Paste a pack's share link (like t.me/addstickers/pack_name) and
  the pack is added with its title and emoji: static, animated (.tgs), and video
  (.webm) stickers.
- Telegram hands packs out only through its bot API, so the relay fetches it: a
  relay asks Telegram with its own bot token (TELEGRAM_BOT_TOKEN), and a relay
  that cannot reach Telegram hands the question to one that can
  (TELEGRAM_STICKERS_UPSTREAM). The token never leaves the relay, and Telegram
  sees the relay's address, not yours. The relay fetches only the files of a pack
  it has described.
- A relay with neither says so, and the app explains.

---

# P00RIJA Cryptography 2.98.54

Version 2.98.54 · build chat-v147

---

## گیف‌های ذخیره‌شده بعد از ارسال ناپدید نمی‌شوند · Saved GIFs no longer vanish after a send

- **مشکل**: روی آیفون، بعد از فرستادن یک گیف، اگر پنل گیف بسته و دوباره باز می‌شد، به‌جای
  همهٔ گیف‌های ذخیره‌شده تصویر شکسته دیده می‌شد. روی آیفون تصویری که از حافظهٔ برنامه
  (IndexedDB) خوانده می‌شود به نسخهٔ ذخیره‌شده وصل است و نوشتن دوبارهٔ همان رکورد آن نسخه
  را دور می‌ریزد. فرستادن گیف، کل کتابخانهٔ گیف را فقط برای ثبت «آخرین استفاده» دوباره
  می‌نوشت.
- **حالا**:
  - فرستادن گیف دیگر چیزی در کتابخانهٔ گیف نمی‌نویسد؛ زمان آخرین استفاده جداگانه نگه
    داشته می‌شود.
  - هر بار که یک پک یا کتابخانهٔ گیف نوشته می‌شود (ذخیرهٔ گیف تازه، انتقال یا کپی
    استیکر)، تصویرها دوباره از همان چیزی که نوشته شد خوانده می‌شوند.
  - اگر تصویری در پنل استیکر یا گیف به هر دلیل بارگذاری نشود، پک‌ها دوباره از حافظه
    خوانده و پنل از نو کشیده می‌شود.
- **The problem**: on an iPhone, after sending a GIF, closing the GIF panel and
  opening it again showed a broken image in place of every saved GIF. On an
  iPhone a picture read from the app's storage (IndexedDB) is tied to the stored
  copy, and writing the same record again throws that copy away. Sending a GIF
  rewrote the whole GIF library just to note when it was last used.
- **Now**:
  - Sending a GIF writes nothing to the GIF library; when it was last used is kept
    apart.
  - Each time a pack or the GIF library is written (a new GIF saved, a sticker
    moved or copied), its pictures are read back from what was written.
  - A picture in the sticker or GIF panel that fails to load for any reason has
    the packs read back from storage and the panel drawn again.

---

# P00RIJA Cryptography 2.98.53

Version 2.98.53 · build chat-v146

---

## گفتگو با چند گیف پشت سر هم ثابت می‌ماند · A thread of GIFs holds still

- **علت**: هر بار گفتگو دوباره کشیده می‌شد (فرستادن، رسیدن تیک، انتخاب پیام)، همهٔ
  پیام‌ها از نو ساخته می‌شدند و روی آیفون هر گیف دوباره بارگذاری می‌شد. ارتفاع حباب گیف
  از خود تصویر می‌آمد، پس برای یک لحظه صفر بود؛ جای خواندن روی همان ارتفاع صفر تنظیم
  می‌شد و وقتی گیف‌ها پر می‌شدند، گفتگو جابه‌جا می‌شد. با چند گیف پشت سر هم، بعد از
  فرستادن گیف تازه، به‌جای آن گیف‌های قبلی دیده می‌شدند.
- **حالا**: اندازهٔ هر گیف همراهش فرستاده می‌شود و حباب پیش از بارگذاری تصویر همان
  شکل را دارد. گیفی که اندازه‌اش را نداشت (از نسخهٔ قدیمی‌تر)، اولین بار که بارگذاری
  شد اندازه‌اش را یاد می‌گیرد، و تا آن موقع جای ۴ به ۳ نگه می‌دارد.
- **پایین گفتگو می‌ماند**: اگر پایین گفتگو بودید، تا تصویرها کامل بارگذاری شوند پایین
  می‌ماند و آخرین گیف دیده می‌شود.
- **انتخاب پیام بدون پرش**: انتخاب پیام‌ها دیگر گفتگو را از نو نمی‌کشد و فقط پیام را
  علامت می‌زند، و ارتفاع نوار انتخاب که بالای گفتگو باز می‌شود جبران می‌شود؛ پیامی که
  زیر انگشت است همان‌جا می‌ماند.
- **The cause**: every time the thread was drawn again (a send, a tick arriving,
  picking a message), every message was rebuilt, and on an iPhone every GIF was
  loaded again. A GIF bubble took its height from its picture, so for a moment
  it had none; the reading position was restored against that, and the thread
  slid as the GIFs filled in. With several GIFs in a row, sending a new one left
  the earlier ones in view instead of it.
- **Now**: each GIF's size travels with it, and its bubble has that shape before
  the picture loads. A GIF that came without its size (from an older build)
  learns it the first time it loads, and holds a 4:3 space until then.
- **The bottom stays the bottom**: if you were at the newest message, the thread
  stays there while pictures finish loading, and the newest GIF is the one in
  view.
- **Picking messages without a jump**: picking messages no longer redraws the
  thread; it only marks them, and the height of the selection bar that opens
  above the thread is taken up, so the message under your finger stays there.

---

# P00RIJA Cryptography 2.98.52

Version 2.98.52 · build chat-v145

---

## مدیریت کامل استیکرها و گیف‌ها · Full management of stickers and GIFs

- **دکمهٔ «انتخاب و مدیریت»**: در سرِ پنل استیکر یک دکمهٔ تازه هست که انتخاب را شروع
  می‌کند؛ نگه داشتن انگشت روی استیکر یا گیف هم همین کار را می‌کند. در حالت انتخاب، هر
  ضربه یک مورد را انتخاب یا رها می‌کند و چیزی فرستاده نمی‌شود.
- **استیکرها**: استیکرهای انتخاب‌شده را، از هر پکی و از هر بخشی (حتی «اخیر» و
  «دلخواه‌ها» و «استیکرهای من»)، می‌توانید:
  - **کپی کنید** در یک پک دیگر یا یک پک تازه؛
  - **منتقل کنید** به یک پک دیگر یا یک پک تازه؛ ستارهٔ «دلخواه» همراهش می‌رود؛
  - **حذف کنید**؛ پکی که خالی بماند خودش برداشته می‌شود؛
  - مثل قبل **بفرستید** یا از آن‌ها **پک بسازید**.
  استیکری که گیف است را می‌توانید در قفسهٔ گیف هم کپی کنید.
- **گیف‌ها**: گیف‌های انتخاب‌شده را می‌توانید **بفرستید**، **در یک پک استیکر کپی کنید** یا
  **حذف کنید**.
- **A "Select and manage" button**: a new button at the top of the sticker panel
  starts picking; holding a finger on a sticker or a GIF does the same. While
  picking, each tap picks or drops one, and nothing is sent.
- **Stickers**: picked stickers, from any pack and any tab (Recent, Favourites,
  and My stickers included), can be:
  - **copied** into another pack or a new one;
  - **moved** into another pack or a new one, taking their favourite star along;
  - **deleted**, and a pack left empty is removed on its own;
  - **sent**, or made into a **pack**, as before.
  A sticker that is a GIF can also be copied onto the GIF shelf.
- **GIFs**: picked GIFs can be **sent**, **copied into a sticker pack**, or
  **deleted**.

## دکمهٔ بازگشت · The back button

- دکمهٔ بازگشت در صفحهٔ مدیریت پک‌های استیکر روی اندروید خالی دیده می‌شد و روی آیفون
  فلشش خیلی نازک بود، چون یک نویسهٔ متنی بود که بعضی فونت‌های اندروید ندارند. حالا یک
  آیکون است، با اندازهٔ خوانا. دکمه‌های بالا و پایین بردن پک‌ها هم همین‌طور.
- The back button in the sticker pack manager showed empty on Android and drew a
  hairline arrow on an iPhone, because it was a text character some Android fonts
  do not have. It is now an icon, at a size that reads. So are the buttons that
  move a pack up and down.

---

# P00RIJA Cryptography 2.98.51

Version 2.98.51 · build chat-v144

---

## قفسهٔ گیف · The GIF shelf

- **با گیف‌های زیاد هم درست نمایش داده می‌شود**: روی آیفون، وقتی تعداد گیف‌ها زیاد
  می‌شد، خانه‌ها روی هم می‌افتادند. حالا هر ردیف ارتفاع خودش را دارد و روی گوشی سه
  گیف در هر ردیف کنار هم قرار می‌گیرند، مثل استیکرها.
- **دیگر به اول قفسه برنمی‌گردد**: فرستادن یک گیف قفسه را به اولین گیف می‌برد، چون
  گیف فرستاده‌شده همان لحظه به اول فهرست منتقل می‌شد. حالا قفسه سر جایش می‌ماند و
  ترتیب «آخرین استفاده‌شده اول» دفعهٔ بعد که قفسه باز می‌شود اعمال می‌شود.
- **حذف در حالت مدیریت**: ضربدر حذف گیف فقط با دکمهٔ مدیریت نشان داده می‌شود، مثل
  حذف پک استیکر، و دیگر روی همهٔ گیف‌ها نیست.
- **Many GIFs display properly**: on an iPhone, with enough GIFs the cells fell on
  top of one another. Each row now has a height of its own, and a phone shows
  three to a row, like the stickers.
- **No more jumping back to the top**: sending a GIF threw the shelf back to its
  first GIF, because the GIF just sent moved to the front at once. The shelf now
  stays where it is, and "used last, shown first" applies the next time it opens.
- **Removing in the manage view**: the cross that removes a GIF shows only with
  the manage button, like deleting a sticker pack, instead of on every GIF.

## استیکر متحرک · Animated stickers

- استیکر متحرکی که از گفتگو نگه داشته می‌شد، برای استفادهٔ دوباره ثابت شده بود: هر
  استیکر بزرگ‌تر از ۲۲۰ کیلوبایت برای کوچک شدن دوباره کشیده می‌شد و فقط فریم اولش
  می‌ماند. حالا استیکر متحرک همان‌طور که رسیده نگه داشته می‌شود.
- An animated sticker kept from a conversation came back still: any sticker over
  220 KB was redrawn to make it smaller, which keeps only the first frame. An
  animated sticker is now kept exactly as it came.

## انتخاب چندتایی پیام‌ها · Picking several messages

- **یک ضربه، یک انتخاب**: در حالت انتخاب چندتایی، ضربه روی پیام نوار گزینه‌های همان
  پیام را هم باز می‌کرد، پس برای هر پیام دو ضربه لازم بود و نوار جلوی پیام بعدی را
  می‌گرفت. حالا هر ضربه فقط پیام را انتخاب می‌کند.
- **ذخیرهٔ همه با هم**: دکمهٔ جدید دانلود در نوار انتخاب همهٔ فایل‌های انتخاب‌شده را
  یک‌جا ذخیره می‌کند: یک فایل به همان شکل خودش، چند فایل در یک zip، و روی آیفون از
  راه منوی اشتراک‌گذاری، تا عکس‌ها مستقیم به Photos بروند.
- **One tap, one pick**: while picking several messages, a tap also opened that
  message's toolbar, so each message took two taps and the toolbar covered the
  next one. A tap now only picks.
- **Save them all at once**: a new download button on the selection bar saves
  every picked file in one go: one file as itself, several in one zip, and on an
  iPhone through the share sheet, so photos can go straight to Photos.

## دانلود عکس پروفایل روی آیفون · Saving a profile photo on an iPhone

- دکمهٔ «دانلود عکس» روی آیفون کاری نمی‌کرد، چون برنامهٔ وب نصب‌شده روی آیفون لینک
  دانلودی را که به داده‌ی خود تصویر اشاره دارد نادیده می‌گیرد. حالا عکس به‌صورت فایل از
  منوی اشتراک‌گذاری آیفون ذخیره می‌شود (Save Image یا Save to Files). اندروید و
  دسکتاپ مثل قبل دانلود می‌کنند.
- "Download photo" did nothing on an iPhone, because a home-screen web app there
  ignores a download link to the picture's own data. The photo now saves as a
  file through the iPhone's share sheet (Save Image or Save to Files). Android and
  desktop download as before.

---

# P00RIJA Cryptography 2.98.50

Version 2.98.50 · build chat-v143

---

## پیام همیشه می‌رسد · A message always arrives

- **دیگر «سشن امن آماده نیست، دوباره تلاش کنید» نیست**: اگر کانال مستقیم به‌موقع
  برقرار نشود، پیام به‌جای «ناموفق» از راه رله فرستاده می‌شود، رمزنگاری‌شده با کلید
  هویت طرف مقابل، همان‌طور که پیام به کسی که آفلاین است همیشه می‌رفت. فایل، استیکر،
  گیف و پیام‌های ساختاریافته هم همین‌طور.
- **پیامی که در راه گم می‌شد دوباره فرستاده می‌شود**: کانال مستقیم گاهی باز به نظر
  می‌رسد ولی طرف مقابل دیگر آنجا نیست، یا دو طرف کلید متفاوتی دارند و پیام باز
  نمی‌شود. در هر دو حالت پیام بی‌صدا گم می‌شد و باید چند بار فرستاده می‌شد، یا صبر
  می‌کردید طرف مقابل اول پیام بدهد. حالا اگر چند ثانیه بعد از ارسال، رسید تحویل
  نرسد، پیام خودکار از راه رله دوباره فرستاده می‌شود. طرف مقابل فقط یک نسخه از آن
  را می‌بیند.
- **سشن امن خودکار**: وقتی هر دو آنلاین هستید و شما سراغ کادر پیام می‌روید یا پیامی
  می‌فرستید، کانال مستقیم خودکار برقرار می‌شود، حتی اگر کلیدی از قبل مانده باشد.
- **اگر از رله رفت، می‌گوید**: وقتی طرف مقابل آنلاین است ولی کانال مستقیم برقرار
  نشد و پیام از راه رله رفت، یک بار برای هر گفتگو اطلاع داده می‌شود.
- **No more "the secure session is not ready, try again"**: when a live channel
  does not come up in time, the message goes through the relay instead of
  failing, sealed to the other person's identity key, the way a message to
  somebody offline always has. Files, stickers, GIFs, and structured messages
  do the same.
- **A message lost on the way is sent again**: a live channel can look open
  after the other end has gone, or the two ends can hold different keys, so
  the message cannot be opened. Either way the message used to vanish without
  a word, and had to be sent two or three times, or until the other person
  wrote first. Now a message with no delivery receipt a few seconds after it
  was sent goes again through the relay on its own. The other person sees one
  copy.
- **Automatic secure session**: when you are both online and you reach for the
  message box or send, a live channel is opened on its own, even when a key
  from an earlier session is kept.
- **Told when it took the relay**: when the other person is online but no live
  channel could be opened and the message took the relay, you are told, once
  per conversation.

## گیفی که بعد از مدتی دیده نمی‌شد · A GIF that went blank

- **گیف فرستاده‌شده دیگر خالی نمی‌شود**: روی اندروید، گیف یا استیکری که پیست یا از
  کیبورد گذاشته می‌شود یک فایل موقت است که سیستم بعداً پاکش می‌کند، و حباب پیام از
  همان فایل نمایش داده می‌شد. برای همین بعد از مدتی خالی می‌شد و فقط با بستن و باز
  کردن برنامه برمی‌گشت. حالا یک نسخه از آن پیش از نمایش در حافظه نگه داشته می‌شود.
- **خودترمیم**: تصویر یا ویدیوی کوتاهی که به هر دلیل از بارگذاری بماند، خودکار از
  خزانهٔ رمزنگاری‌شدهٔ دستگاه دوباره خوانده می‌شود.
- **A sent GIF no longer goes blank**: on Android, a GIF or sticker pasted or put
  in by the keyboard is a temporary file the system deletes later, and the
  message bubble was drawn from it. So it went blank after a while and came back
  only when the app was closed and reopened. A copy is now held in memory
  before it is drawn.
- **It heals itself**: a picture or a short clip that fails to load for any
  reason is read again from the device's encrypted vault.

## راهنمای گیف و استیکر از کیبورد · A guide to keyboard GIFs and stickers

- در «راهنما» و با دکمهٔ ؟ در قفسهٔ گیف: روی اندروید چه چیزی امروز کار می‌کند،
  پرچم Chrome برای نسخهٔ PWA، و این‌که چرا WebView اندروید در نسخهٔ نیتیو هنوز گیف
  کیبورد را نمی‌پذیرد.
- In Help, and behind the ? button on the GIF shelf: what works on Android today,
  the Chrome flag for the PWA, and why the native app's Android WebView does not
  accept keyboard GIFs yet.

## کلید محافظ صفحه · The screen guard switch

- کلید «محافظ صفحه» روی گوشی کنار توضیح بلندش فشرده می‌شد و فقط دایره‌اش دیده می‌شد.
  حالا همهٔ کلیدهای تنظیمات اندازهٔ خودشان را نگه می‌دارند.
- The screen guard switch was squeezed beside its long description on a phone,
  leaving only its knob. Every settings switch now keeps its size.

---

# P00RIJA Cryptography 2.98.49

Version 2.98.49 · build chat-v142

---

## همگام‌سازی مخاطبان بین دستگاه‌ها · Contacts between your devices

- **مخاطب جدید دوباره به دستگاه‌های دیگر شما می‌رسد**: از نسخهٔ 2.98.43، مخاطبی که
  روی یک دستگاه اضافه می‌کردید به دستگاه‌های دیگرتان نمی‌رسید. علتش این بود که
  برنامه هر نامی را که هرگز حذف نشده بود، حذف‌شده در اول ژانویهٔ ۲۰۰۰ می‌دید، چون
  `Date.parse(0)` در جاوااسکریپت سال ۲۰۰۰ را برمی‌گرداند. به همین دلیل دستگاه دوم
  همهٔ مخاطبان رسیده را کنار می‌گذاشت. پیام یا تماسی هم که تاریخ ثبت‌شده نداشت، در
  همگام‌سازی جا می‌ماند. هر دو درست شد. حذف گفتگو مثل قبل کار می‌کند.
- **A new contact reaches your other devices again**: since 2.98.43, a contact
  added on one device did not reach your others. The app read every name that
  had never been deleted as deleted on 1 January 2000, because JavaScript's
  `Date.parse(0)` answers the year 2000, so the second device refused every
  contact it was sent. A message or call with no recorded date was also left
  out of a sync. Both are fixed, and deleting a conversation works as before.

---

# P00RIJA Cryptography 2.98.48

Version 2.98.48 · build chat-v141

---

## پیام روی همهٔ دستگاه‌های شما · A message on all your devices

- **پیامی که از کانال مستقیم می‌رسد، به دستگاه‌های دیگر شما هم می‌رسد**: وقتی با
  چند دستگاه هم‌زمان آنلاین بودید، پیامی که یک مخاطب از کانال مستقیم می‌فرستاد فقط
  به یکی از دستگاه‌های شما می‌رسید، همان که کانال به آن وصل بود. بقیه تا همگام‌سازی
  بعدی آن را نداشتند. حالا دستگاهی که پیام را می‌گیرد، همان لحظه آن را به دستگاه‌های
  آنلاین دیگر شما می‌دهد؛ رمزنگاری‌شده با کلید خودتان و مستقیم از طریق رله، بدون
  این‌که رله چیزی نگه دارد. پیامی که از رله می‌رسد از قبل به همهٔ دستگاه‌ها می‌رسید.
- **هدایت به پیام‌های ذخیره‌شده**: یکی از نتیجه‌های همین مشکل این بود که روی دستگاه
  دوم، پیام برای هدایت به «پیام‌های ذخیره‌شده» پیدا نمی‌شد. این هم درست شد.
- **A message that arrives down a live channel reaches your other devices too**:
  with several devices online at once, a contact's message sent down a live
  channel reached only the one device that channel was connected to, and the
  others did not have it until the next sync. The device that receives it now
  hands it on at once to your other online devices, sealed to your own key and
  passed through the relay, which keeps none of it. A message that comes
  through the relay already reached every device.
- **Forwarding into Saved Messages**: one result of the same gap was that on the
  second device the message could not be found to forward into Saved Messages.
  That is fixed as well.

---

# P00RIJA Cryptography 2.98.47

Version 2.98.47 · build chat-v140

---

## گیف و استیکرهای کیبورد · GIFs and keyboard stickers

- **پیست کنید، فرستاده می‌شود**: گیف یا استیکری که از هر جایی کپی شده باشد — با
  «کپی تصویر» مرورگر، یا استیکری که در پیام‌رسان دیگری کپی شده — با پیست در کادر
  پیام همان لحظه فرستاده می‌شود. کشیدن و رها کردن فایل روی کادر پیام هم همین کار
  را می‌کند. برای عکس بزرگ اول می‌پرسد که به‌صورت عکس برود یا استیکر؛ متن، و کپی
  از سند و جدول، مثل قبل به‌صورت متن پیست می‌شوند.
- **از کیبورد گوشی**: روی اندروید، کیبوردهایی مثل Gboard حالا می‌توانند گیف و
  استیکر را مستقیم در کادر پیام بگذارند (Chrome اندروید هنوز این قابلیت را پشت
  پرچم `chrome://flags/#enable-android-media-insertion` نگه داشته است). روی آیفون
  و آیپد کیبورد استیکر را در کادر پیام نمی‌گذارد؛ برای همین پنل استیکر یک «کادر
  کیبورد» دارد: رویش بزنید، از بخش استیکرهای کیبورد ایموجی یک استیکر، Memoji یا
  Genmoji انتخاب کنید، یا گیفی را پیست کنید، و فرستاده می‌شود.
- **گیف به شکل خودش**: گیف در گفتگو با نسبت ابعاد خودش، گوشه‌های گرد و برچسب کوچک
  GIF نشان داده می‌شود، نه به شکل مربع استیکر. نسخه‌های قدیمی‌تر برنامه هم آن را
  متحرک می‌بینند.
- **قفسهٔ گیف**: پنل استیکر حالا دو قفسه دارد: «استیکرها» و «گیف». گیفی را که در
  گفتگو آمده با نشانک رویش نگه دارید یا فایل .gif وارد کنید، و بعد با یک ضربه
  دوباره بفرستید. ردیف «گیف» در منوی + مستقیم همین قفسه را باز می‌کند. نشانک روی
  استیکرِ دریافتی هم آن را به «استیکرهای من» اضافه می‌کند. گیف‌های ذخیره‌شده در
  پشتیبان کامل خزانه هم هستند.
- **چیزی از اینترنت گرفته نمی‌شود**: همه‌چیز مثل استیکرها رمزنگاری سرتاسری می‌شود
  و از همان مسیر می‌رود؛ اگر چیزی که پیست شده فقط آدرس تصویری در اینترنت باشد،
  برنامه آن را باز نمی‌کند.
- **Paste it and it is sent**: a GIF or a sticker copied from anywhere — a
  browser's "Copy image", or a sticker copied in another messenger — is sent
  the moment it is pasted into the message box. Dropping the file on the
  message box does the same. A large photo asks first whether it should go as
  a photo or a sticker; text, and copies from documents and spreadsheets,
  still paste as text.
- **From the phone's keyboard**: on Android, keyboards such as Gboard can now
  put GIFs and stickers straight into the message box (Chrome on Android still
  keeps this behind `chrome://flags/#enable-android-media-insertion`). On
  iPhone and iPad the keyboard will not put a sticker into the message box, so
  the sticker panel has a keyboard box: tap it, pick a sticker, Memoji or
  Genmoji from the emoji keyboard's stickers, or paste a GIF, and it is sent.
- **GIFs in their own shape**: a GIF shows at its own aspect ratio, with
  rounded corners and a small GIF mark, rather than as a square sticker. Older
  versions of the app still see it move.
- **A GIF shelf**: the sticker panel now has two shelves, Stickers and GIF.
  Keep a GIF somebody sent with the bookmark on it, or import .gif files, then
  send it again with one tap. The GIF row in the + menu opens this shelf
  directly. The bookmark on a received sticker adds it to "My stickers". Saved
  GIFs are part of the full vault backup.
- **Nothing is fetched from the internet**: everything is end-to-end encrypted
  and travels the way stickers do; a paste that only names a picture by its
  web address is not followed.

---

# P00RIJA Cryptography 2.98.46

Version 2.98.46 · build chat-v139

---

## گزینه‌های کوتاه‌تر در پرسش حذف · Shorter answers when deleting

- **«فقط حذف گفتگو»**: گزینهٔ اول پرسش حذف گفتگو به‌جای «حذف گفتگو — مخاطب
  می‌ماند» حالا «فقط حذف گفتگو» است و کنار گزینهٔ دیگر در یک خط جا می‌شود. در گروه
  هم «فقط پاک کردن تاریخچه» جای «پاک کردن تاریخچه — در گروه می‌مانید» را گرفته است.
- **"Delete only the conversation"**: the delete question's first answer, which
  was "Delete the conversation - keep the contact", now reads "Delete only the
  conversation" and fits on one line beside the other. In a group, "Delete only
  the history" replaces "Delete the history - stay in the group".

---

# P00RIJA Cryptography 2.98.45

Version 2.98.45 · build chat-v138

---

## ظاهر پرسش‌های چندگزینه‌ای · How a question with answers looks

- **«انصراف» از گزینه‌ها جداست**: دکمهٔ «انصراف» تنها دکمهٔ پررنگ پنجره است، به
  رنگ اصلی برنامه، و دیگر شبیه گزینه‌هایی نیست که از آن‌ها برمی‌گردد.
- **گزینه‌های حذف قرمزند**: در پرسش حذف گفتگو و حذف تاریخچهٔ گروه، گزینه‌ها به رنگ
  هشدار نشان داده می‌شوند.
- **دو گزینه کنار هم**: وقتی پرسش دو پاسخ دارد، دو دکمه کنار هم و با فاصله از هم
  قرار می‌گیرند. روی گوشی‌های خیلی باریک (۳۲۰ پیکسل) باز زیر هم می‌آیند تا متن
  کلمه‌به‌کلمه نشکند.
- **Cancel stands apart**: Cancel is the dialog's one filled button, in the
  app's accent, and no longer looks like the answers it backs out of.
- **Delete answers are red**: deleting a conversation or a group's history
  draws its answers in the danger colour.
- **Two answers side by side**: a question with two answers puts them in one
  row with a gap between them; on the narrowest phones (320 px) they stack
  again, so no label breaks word by word.

---

# P00RIJA Cryptography 2.98.44

Version 2.98.44 · build chat-v137

---

## یک دکمهٔ انصراف · One Cancel button

- **پرسش‌های چندگزینه‌ای فقط یک «انصراف» دارند**: پنجره‌ای که چند پاسخ پیشنهاد
  می‌دهد، مثل حذف گفتگو، دو دکمهٔ «انصراف» نشان می‌داد، یا یک «انصراف» و یک
  «تأیید» که آن هم فقط پنجره را می‌بست. حالا گزینه‌ها و فقط یک «انصراف» دیده
  می‌شوند، و همان هنگام باز شدن انتخاب‌شده است؛ پس زدن Enter در پرسش حذف چیزی را
  پاک نمی‌کند. این اصلاح همهٔ پرسش‌های این شکلی را می‌گیرد، از جمله حذف گفتگو و
  تاریخچهٔ گروه، قالب کارت مخاطب، زمان قفل گفتگو، تغییر صدا و فعال‌سازی پروفایل
  همراه.
- **Questions with answers have one Cancel**: a window offering several answers,
  such as deleting a conversation, showed two Cancel buttons, or a Cancel and an
  OK that also only closed it. It now shows the answers and a single Cancel,
  which has the focus when it opens, so pressing Enter on a delete question
  deletes nothing. The fix covers every question of this kind, among them
  deleting a conversation or a group's history, the contact card's format, the
  conversation lock's timing, the voice changer, and activating a portable
  profile.

---

# P00RIJA Cryptography 2.98.43

Version 2.98.43 · build chat-v136

---

## حذف گفتگو · Deleting a conversation

- **پاک‌سازی کامل روی دستگاه شما**: پیام‌ها، فایل‌ها، پیش‌نویس، کلیدهای جلسه روی
  دیسک، جلسهٔ زندهٔ در حافظه و کانال مستقیمش، تاریخچهٔ تماس با آن شخص، قفل آن گفتگو
  و علامت «خوانده‌نشده» همه پاک می‌شوند. اگر هنگام حذف موقعیت زنده می‌فرستادید،
  همان لحظه بی‌صدا متوقف می‌شود.
- **برای طرف مقابل هیچ اتفاقی نمی‌افتد**: چیزی از او پاک نمی‌شود و هیچ پیامی هم
  به او نمی‌رسد.
- **مخاطب می‌ماند**: حذف گفتگو دیگر مخاطب را حذف نمی‌کند. او همچنان مخاطب شماست
  و تأییدشده، مسدودشده یا بی‌صدا هم می‌ماند؛ تماس‌هایش زنگ می‌زند و فقط گفتگوی
  خالی از فهرست کنار می‌رود. قبلاً حذف گفتگو او را غریبه می‌کرد: تماسش زنگ نمی‌زد
  و اگر مسدود بود، از مسدودی درمی‌آمد. اگر بخواهید، می‌توانید «حذف گفتگو و مخاطب»
  را انتخاب کنید؛ در این حالت هم کسی که مسدود کرده‌اید مسدود می‌ماند.
- **همهٔ دستگاه‌های شما**: حذف به دستگاه‌های دیگر خودتان هم می‌رسد، و همگام‌سازی
  بعدی دیگر پیام‌های حذف‌شده را برنمی‌گرداند. پیام‌هایی که بعد از لحظهٔ حذف رسیده‌اند
  می‌مانند.
- **گروه**: می‌توانید فقط تاریخچه را پاک کنید و در گروه بمانید، یا تاریخچه را پاک
  کنید و از گروه خارج شوید.
- **مرحلهٔ بعد**: کلید جداگانه برای هر گفتگو، تا حذف از نظر رمزنگاری هم کامل باشد.
  نقشهٔ آن در `docs/plans/2026-10-15-conversation-keys.md` است.

- **A complete wipe on your device**: the messages, files, draft, session keys on
  disk, the live session in memory with its direct channel, the call log with that
  person, the conversation's lock, and its unread mark all go. A live location
  being shared stops at once, silently.
- **Nothing happens to the other person**: nothing of theirs is deleted, and
  nothing is sent to them.
- **The contact stays**: deleting a conversation no longer deletes the contact.
  They stay a contact, and stay verified, blocked, or muted as before; their
  calls ring, and only the empty conversation leaves the list. Before, deleting
  the conversation made them a stranger: their calls stopped ringing, and a
  blocked person was unblocked. You can choose "Delete the conversation and the
  contact" instead, and someone you blocked stays blocked.
- **All your devices**: the deletion reaches your other devices, and the next
  sync no longer brings deleted messages back. Messages that arrived after the
  moment of deletion stay.
- **Groups**: delete only the history and stay in the group, or delete it and
  leave.
- **Next**: a separate key for every conversation, so that deletion is complete
  cryptographically too. The plan is in
  `docs/plans/2026-10-15-conversation-keys.md`.

---

# P00RIJA Cryptography 2.98.42

Version 2.98.42 · build chat-v135

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## درخواست پیام و کارت مخاطب · Message requests and contact cards

- **درخواست پیام**: پیامِ کسی که در مخاطبان شما نیست، قبلاً اعلانی بالای کادر پیام
  داشت که دکمه‌هایش نصفه می‌ماند و نمی‌شد «پذیرفتن»، «مسدود کردن» یا «حذف» را زد.
  حالا این اعلان کارتی وسط پیام‌هاست، روی گوشی و دسکتاپ، با همهٔ دکمه‌ها کامل و
  در دسترس.
- **کارت مخاطب کامل شد**: کارتی که در چت می‌فرستید حالا علاوه بر نام، شناسه،
  اثرانگشت و کلید، آدرس رلهٔ آن شخص (آدرس، شناسه و کلید رله) را هم دارد. قبلاً
  مخاطبی را که روی سرور دیگری بود از روی کارت اضافه می‌کردید، ولی پیام‌ها به او
  نمی‌رسید. عکس پروفایل هم واضح‌تر شده و دوباره کشیده می‌شود، پس هیچ متادیتایی
  همراهش نمی‌رود. کارتی که بیرون از برنامه به اشتراک می‌گذارید (کارت متنی، JSON و
  متن ساده) هم حالا آدرس رله را دارد؛ کارت متنی و JSON عکس را هم دارند.
- **امنیت**: کارتی که اثرانگشتش با کلیدش جور نباشد دیگر پذیرفته نمی‌شود، چه از چت
  آمده باشد، چه چسبانده یا اسکن شده باشد. چنین کارتی می‌توانست مقایسهٔ شمارهٔ امنیتی
  را رد کند، در حالی که پیام‌ها برای کلید شخص دیگری رمز می‌شدند. کلید مخاطبی که از
  کارت اضافه می‌شود هم مثل بقیه ثبت و تثبیت می‌شود.

- **Message requests**: a message from someone not in your contacts came with a
  notice above the message box whose buttons were cut in half, so Accept, Block,
  and Delete could not be pressed. The notice is now a card in the middle of the
  messages, on phones and desktops, with every button whole and reachable.
- **Complete contact cards**: a card sent in a chat now carries the person's relay
  (address, id, and key) besides the name, id, fingerprint, and key. Before, a
  contact on the other server could be added from a card but never reached. The
  photograph is sharper and redrawn, so no metadata goes with it. A card shared
  outside the app (text card, JSON, plain text) names the relay too, and the text
  card and the JSON carry the photograph.
- **Security**: a card whose fingerprint does not belong to its key is refused,
  whether it came in a chat, was pasted, or was scanned. Such a card could pass a
  safety-number comparison while messages were sealed to someone else's key. A
  contact added from a card has their key pinned like any other.

---

# P00RIJA Cryptography 2.98.41

Version 2.98.41 · build chat-v134

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## وضعیت اتصال · Connection status

- بعد از عوض کردن زبان، متن اتصال در کارت پروفایل «عدم اتصال» می‌شد، در حالی که
  نقطهٔ کنارش سبز بود و اتصال برقرار. حالا همان وضعیت به زبان تازه دوباره نوشته
  می‌شود.
- خط زیر نام همیشه یک وضعیت عقب‌تر بود: مثلاً «در حال اتصال...» نشان می‌داد در
  حالی که اتصال برقرار شده بود. حالا هم‌زمان به‌روز می‌شود.

- After switching language, the connection line on the profile card read
  "Disconnected" beside a green dot while connected. The same state is now said
  again in the new language.
- The line under the name was always one state behind, for example "Connecting..."
  after the connection was up. It now updates at once.

---

# P00RIJA Cryptography 2.98.40

Version 2.98.40 · build chat-v133

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## کارت پروفایل بالای تنظیمات · The profile card above Settings

- نسخهٔ قبل در تنظیمات، روی هر گوشی کوتاه‌تر از ۸۸۰ پیکسل کارت پروفایل را پنهان
  می‌کرد. iPhone 15 Pro Max وقتی برنامه نصب شده باشد، زیر نوار وضعیت فقط ۸۷۳ پیکسل
  ارتفاع دارد؛ پس کارت روی یک گوشی بزرگ هم، با جای خالی فراوان، پنهان می‌شد. حالا
  جا اندازه گرفته می‌شود: اگر کارت کامل جا شود کامل می‌ماند، وگرنه به یک ردیف جمع
  می‌شود (آواتار، نام، وضعیت اتصال و سه دکمه). فقط روی کوچک‌ترین گوشی‌ها مثل iPhone
  SE کنار می‌رود. هر نُه بخش تنظیمات همیشه بدون اسکرول دیده می‌شوند.

- 2.98.39 hid the profile card in Settings on any phone under 880px tall. An
  installed app on an iPhone 15 Pro Max is only 873 tall under the status bar, so
  the card vanished on a large phone with plenty of room. The space is now
  measured: the card stays whole when it fits and otherwise folds to one row
  (avatar, name, connection, and the three buttons). It steps aside only on the
  smallest phones, such as an iPhone SE. All nine settings sections always show
  without scrolling.

---

# P00RIJA Cryptography 2.98.39

Version 2.98.39 · build chat-v132

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## تنظیمات روی گوشی‌های کوتاه‌تر · Settings on shorter phones

- روی گوشی‌های کوتاه‌تر، مثل iPhone SE و گوشی‌های رایج با ارتفاع ۸۴۴ پیکسل، کارت
  پروفایل و نُه ردیف تنظیمات با هم جا نمی‌شدند. حالا تا وقتی تنظیمات باز است کارت
  پروفایل کنار می‌رود و هر نُه بخش یک‌جا دیده می‌شوند. با برگشتن به گفتگوها کارت
  دوباره سر جایش است. گوشی‌های بلندتر (از ۸۸۰ پیکسل به بالا) مثل قبل‌اند.

- On shorter phones, such as an iPhone SE and the common 844px-tall phones, the
  profile card and the nine settings rows did not fit together. The card now steps
  aside while Settings is open, so all nine sections show at once, and it is back
  with the conversations. Taller phones (880px and up) are unchanged.

---

# P00RIJA Cryptography 2.98.38

Version 2.98.38 · build chat-v131

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## منوی تنظیمات · The settings menu

- روی گوشی، هر نُه بخش تنظیمات چت حالا یک‌جا و بدون اسکرول دیده می‌شوند. ردیف
  آخر («ابزارها») زیر لبهٔ پنل می‌رفت. ارتفاع هر ردیف روی گوشی ۴۴ پیکسل شد؛
  همان اندازه‌ای که انگشت لازم دارد.

- On a phone, all nine chat settings sections now show at once, with no scrolling.
  The last row (Tools) used to sit below the panel's edge. Each row is now 44px
  tall on a phone, the height a finger needs.

---

# P00RIJA Cryptography 2.98.37

Version 2.98.37 · build chat-v130

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## عکس پروفایل و وضعیت · Profile photo and status

- **بدون EXIF**: هر عکسی که برای پروفایل یا گروه انتخاب شود (عکس دوربین، HEIC،
  تصویر آماده یا حرف اول نام) پیش از ذخیره دوباره روی بوم کشیده می‌شود و به یک JPEG
  مربعی حداکثر ۶۴۰ پیکسلی تبدیل می‌شود که هیچ متادیتایی ندارد: نه مدل دوربین، نه
  زمان عکس و نه موقعیت GPS. قبلاً اگر بدون «اعمال کراپ» ذخیره می‌زدید، خود فایل اصلی
  با تمام EXIF برای همهٔ مخاطبان فرستاده می‌شد. آواتاری که از قبل ذخیره شده بود هم
  یک‌بار هنگام باز کردن قفل تمیز می‌شود و نسخهٔ تمیزش برای مخاطبان می‌رود.
- **عکس نصفه یا نیامدن عکس**: رله نسخه‌ای از عکس را که در hello می‌آمد بریده‌شده در
  ۱۰۰ هزار نویسه نگه می‌داشت و با فهرست کاربران به همه می‌داد. همین نسخهٔ نصفه جای
  عکس کامل را می‌گرفت، مخصوصاً در شروع برنامه. حالا عکس فقط با کارت پروفایل جابه‌جا
  می‌شود و رله آن را نه نگه می‌دارد و نه پخش می‌کند.
- **شروع چت**: وقتی گفتگویی را باز می‌کنید و عکس طرف مقابل را ندارید، برنامه آن را
  می‌خواهد. جواب کسی که روی همان سرور بود اشتباهی از مسیر رلهٔ دیگر می‌رفت و هرگز
  نمی‌رسید؛ درست شد.
- **در لحظه**: تغییر وضعیت حالا به مخاطبانِ سرور دیگر هم می‌رسد. پاک کردن وضعیت یا
  حذف عکس هم به همه می‌رسد؛ قبلاً مقدار خالی نادیده گرفته می‌شد و نسخهٔ قدیمی
  همیشه می‌ماند. عکس‌های آماده و حرف اول نام قبلاً SVG بودند و مخاطبان اصلاً
  نمی‌دیدندشان؛ حالا آن‌ها هم JPEG هستند.
- **امنیت**:
  - کارت پروفایل حالا با کلید هویت امضا می‌شود. کسی نمی‌تواند با جعل اثر انگشتِ یک
    مخاطب، نام و عکس او را روی گوشی شما عوض کند.
  - عکس، نام و وضعیت فقط برای مخاطبان، اعضای گروه‌های مشترک و گفتگوی باز فرستاده
    می‌شود. قبلاً برای هر کسی که روی همان رله آنلاین بود هم می‌رفت.
  - غریبه‌ای که فقط درخواست عکس بدهد، تا وقتی او را اضافه نکرده‌اید جوابی نمی‌گیرد.

- **No EXIF**: every picture chosen for a profile or a group (a camera photo, HEIC,
  a preset, or a generated initial) is redrawn on a canvas before it is kept. It
  becomes a square JPEG of at most 640 pixels with no metadata in it: no camera,
  no time, and no GPS position. Saving without "Apply crop" used to send the
  original file, EXIF and all, to every contact. An avatar stored by an earlier
  build is cleaned once at unlock, and the clean copy goes out.
- **Half a photograph, or none**: the relay kept its own copy of the picture from
  the hello, cut at 100,000 characters, and handed it out with the peer list. That
  half copy replaced the whole one, most often when the app started. Photographs
  now travel only on the profile card; the relay neither keeps nor hands them out.
- **Starting a chat**: opening a conversation without the other person's
  photograph asks for it. The answer from someone on the same server used to be
  sent by way of another relay and never arrived. That is fixed.
- **Live**: a status change now reaches contacts on the other server too. Clearing
  a status or removing a photograph reaches everyone; an empty value used to be
  ignored, so the old one stayed for good. Presets and initials used to be SVG,
  which no contact could display; they are JPEG now.
- **Security**:
  - The profile card is signed with the identity key, so nobody can change a
    contact's name or photograph on your device by naming their fingerprint.
  - The photograph, name, and status go to contacts, members of shared groups,
    and the open conversation only. Before, they also went to everyone online on
    the same relay.
  - A stranger who only asks for your photograph gets nothing until you add them.

---

# P00RIJA Cryptography 2.98.36

Version 2.98.36 · build chat-v129

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## کلیدهای تنظیمات · Settings switches

- **یک‌شکل** — کلید «پیش‌نمایش لینک» و دو کلید «حذف متادیتا» و «تبدیل HEIC» با روشن شدن
  فقط دکمه‌شان جابه‌جا می‌شد و ردیفشان، برخلاف بقیهٔ کلیدها، رنگ و قاب «روشن» را نمی‌گرفت.
  حالا هر سه دقیقاً مثل بقیه‌اند. یک آزمون هم اضافه شد که اگر کلید تازه‌ای این‌طور جا بماند،
  شکست بخورد.

- **One kind of switch**: the Link previews switch and the Strip metadata and Convert
  HEIC switches moved only their knob when turned on; unlike every other switch,
  their row never took the "on" colour and border. All three now match the rest,
  and a test fails if a new switch is ever left out this way.

## سرتیفیکیت سرور · The server's certificate

- **یک سرتیفیکیت، یک پوشه**: برنامه، سرور TURN و هر برنامهٔ دیگری روی همان سرور
  (مثل 3X-UI) سرتیفیکیت را از یک پوشه می‌خوانند و دیگر کپی جداگانه‌ای در کار نیست.
  روی هر دو سرور این پوشه همان `/root/cert/<domain>/` خودِ 3X-UI است. تمدید خودکار
  ده روز مانده به انقضا انجام می‌شود و بعد از آن برنامه و 3X-UI دوباره راه‌اندازی
  می‌شوند.
- **3X-UI روی سرور ایران**: در پوشه‌اش یک گواهی تازه کنار کلید قدیمی مانده بود.
  برای همین پنل بدون TLS روی http ساده بالا آمده بود و ورودی 443 اصلاً گواهی ارائه
  نمی‌داد. درست شد، و تمدیدکننده حالا هر بار جفت بودن گواهی و کلید را بررسی می‌کند.
- **نصب تازه** می‌پرسد که از قبل گواهی دارید یا نه. اگر دارید، پوشه‌اش را می‌دهید
  و نصب‌کننده گواهی و کلیدِ هم‌جفت را خودش پیدا می‌کند؛ بعد انتخاب می‌کنید که همین
  سرور تمدیدش کند یا همان برنامه‌ای که الان تمدیدش می‌کند. اگر ندارید، دامنه گواهی
  Let's Encrypt می‌گیرد؛ IP عمومی هم گواهی شش‌روزهٔ Let's Encrypt می‌گیرد که خودکار
  تمدید می‌شود؛ لوکال و شبکهٔ محلی هم گواهی خودامضا با همهٔ آدرس‌های ماشین می‌گیرند.
- تغییری در اپ‌ها نیست؛ این تغییر فقط سمت سرور است.

- **One certificate, one folder**: the app, the TURN server, and anything else on the
  machine (3X-UI, for one) read the certificate from the same folder, with no
  separate copies. On both servers that folder is 3X-UI's own
  `/root/cert/<domain>/`. It is renewed automatically ten days before expiry,
  after which the stack and 3X-UI are restarted.
- **3X-UI on the server in Iran**: its folder held a new certificate beside an old
  key. The panel had fallen back to plain http and the 443 inbound served no
  certificate. This is fixed, and the renewer now checks that the certificate and
  key belong together on every pass.
- **A fresh install** asks whether you already have a certificate. If you do, you
  give the folder, the installer finds the matching pair, and you choose whether
  this server renews it or the program that already does. If you don't, a domain
  gets Let's Encrypt, a public IP gets Let's Encrypt's six-day certificate,
  renewed for you, and localhost or a LAN gets a self-signed certificate naming
  every address the machine has.
- Nothing changes in the apps. This is a server-side change.

---

# P00RIJA Cryptography 2.98.35

Version 2.98.35 · build chat-v128

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

---

## درِ ورودی در نسخهٔ گوشی · The front door in the phone apps

- نسخهٔ گوشی آدرس صفحه‌ای ندارد که از آن سراغ در را بگیرد. حالا از رلهٔ مخاطبان هم
  می‌پرسد، پس کاربر اندرویدی که روی رلهٔ ایران است ولی هرگز به رلهٔ خارج از ایران وصل نشده، هم در را
  پیدا می‌کند. استفاده از در مثل قبل فقط پس از آزمون کلید رلهٔ ایران است.
- آزموده‌شده با سرورهای واقعی از بیرون ایران: ثبت‌نام تازه روی رلهٔ ایران با وارد کردن
  آدرس آن، پیام و رسید دوطرفه، تماس با صدا و تصویر از TURN واقعی، و فایل ۳ و ۲ مگابایتی در
  هر دو جهت میان کاربر رلهٔ خارج از ایران و کاربر رلهٔ ایران.

- A phone app has no page address to ask for the door. It now asks its contacts'
  relays too, so an Android user on the Iranian relay who never connected to the
  relay outside Iran still finds the door. As before, the door is used only after the
  Iranian relay's key proof.
- Tested against the real servers from outside Iran: a new registration on the
  Iranian relay by entering its address, messages and receipts both ways, a call
  with audio and video over the real TURN, and 3 MB and 2 MB files both ways
  between a user on the relay outside Iran and one on the Iranian relay.

---

# P00RIJA Cryptography 2.98.34

Version 2.98.34 · build chat-v127

اصلاح فوری پس از 2.98.33. متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های
قبلی پایین‌تر آمده‌اند.

An urgent fix after 2.98.33. Each section is Persian first, English after.
Earlier changes follow below.

---

## اتصال nginx به رله · nginx reaching the relay

- **چه شد** — در 2.98.33 رله قرار بود فقط روی loopback و شبکهٔ داخلی داکر گوش بدهد،
  ولی Node رابط `docker0` را وقتی «down» است فهرست نمی‌کند (و در این استک همیشه down
  است). رله فقط روی loopback گوش داد، nginx به آن نرسید و هر دو سرور چند دقیقه به همه
  ۵۰۲ دادند. بررسی بعد از deploy رله را از داخل کانتینر خودش می‌پرسید و این را ندید.
- **اصلاح** — آدرس `docker0` حالا حتی وقتی down است با `ip` خوانده می‌شود. بررسی بعد از
  deploy از همان مسیری می‌رود که کاربران می‌روند (از nginx) و در صورت خطا deploy شکست
  می‌خورد. روی سرورها آدرس `172.17.0.1` صریح در `.env` نوشته شده است.
- **نام‌های در** — فهرست در فقط نام‌های خود رلهٔ پشت در را دارد، نه آدرس‌هایی که فقط برای
  CORS مجازند، تا کاربری که آدرس رلهٔ خارج از ایران را دارد به اشتباه به رلهٔ ایران فرستاده نشود.

- **What happened**: 2.98.33 meant the relay to listen only on loopback and the
  Docker bridge, but Node does not list `docker0` while it is down, which it
  always is in this stack. The relay listened on loopback alone, nginx could not
  reach it, and both servers answered 502 to everyone for a few minutes. The
  post-deploy check asked the relay from inside its own container and missed it.
- **Fixed**: `docker0`'s address is read with `ip` even while it is down. The
  post-deploy check goes the way clients do (through nginx) and fails the deploy
  if that fails. The servers name `172.17.0.1` outright in `.env`.
- **Door names**: a door lists only its relay's own names, not origins allowed
  for CORS, so somebody with the address of the relay outside Iran is never sent to the Iranian
  relay by mistake.

---

# P00RIJA Cryptography 2.98.33

Version 2.98.33 · build chat-v126

کاربران بیرون از ایران دوباره می‌توانند روی رلهٔ ایران ثبت‌نام کنند و با کاربران داخل
پیام، تماس صوتی و تصویری و فایل رد و بدل کنند، و پورت‌های بی‌رمز رله‌ها بسته شدند. متن
هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

People outside Iran can again register on the relay inside Iran and exchange
messages, voice and video calls, and files with people inside it, and the
relays' unencrypted ports are closed. Each section is Persian first, English
after. Earlier changes follow below.

---

## ۱. درِ ورودی برای رلهٔ ایران · A front door for the relay inside Iran

- **مشکل** — از بیرون ایران، هر اتصال امن (TLS) به سرور ایران بعد از دست‌دادن بی‌جواب
  می‌ماند. این فیلتر شبکه است و از داخل برنامه رفع‌شدنی نیست. ولی سرور ایران خودش
  می‌تواند به بیرون وصل شود، و اتصال میان دو رله را همین سرور برقرار می‌کند.
- **راه‌حل** — رلهٔ خارج از ایران حالا با آدرس جداگانهٔ `https://chat.example.com:8586` به‌جای
  رلهٔ ایران جواب می‌دهد. هر اتصالی که به این در برسد، از روی همان اتصال رمزدار میان دو
  رله به سرور خود ایران می‌رسد. برای کاربر این در خودِ رلهٔ ایران است: همان هویت، همان
  صندوق پیام، همان TURN.
- **امن** — برنامه پیش از استفاده ثابت می‌کند که این در واقعاً به رلهٔ ایران می‌رسد (با همان
  آزمون کلید آدرس‌های پشتیبان). رلهٔ ایران فقط از رلهٔ خارج از ایران جریان می‌پذیرد و آن را فقط به
  سرور خودش وصل می‌کند. رلهٔ خارج از ایران، مثل خود رلهٔ ایران، اطلاعات اتصال کسانی را که از در
  می‌آیند می‌بیند، ولی محتوای پیام‌ها همچنان سرتاسری رمز است.
- **خودکار** — کاربری که رلهٔ ایران را دارد و آدرسش جواب نمی‌دهد، خودش به در منتقل
  می‌شود. کاربر تازه‌ای که آدرس رلهٔ ایران را وارد می‌کند، در را از رله‌ای که برنامه را باز
  کرده پیدا می‌کند. وارد کردن مستقیم `https://chat.example.com:8586` به‌عنوان آدرس رله هم
  کار می‌کند.
- **تماس و فایل** — آزموده شد: پیام دوطرفه، پیام بین دو رله، تماس تصویری مستقیم و بین دو
  رله، و فایل در هر دو جهت از طریق در. صدا و تصویر تماس از در عبور نمی‌کند و از TURN رلهٔ
  ایران می‌رود، که پورت 3478 آن (UDP و TCP) از بیرون باز است.

- **The problem**: from outside Iran, every secure (TLS) connection to the
  Iranian server goes silent after its handshake. That is network filtering and
  cannot be fixed inside the app. But the Iranian server can still reach out,
  and it is the one that opens the link between the two relays.
- **The fix**: the relay outside Iran now answers for the Iranian relay at its own
  address, `https://chat.example.com:8586`. Each connection to that door is
  carried over the encrypted link between the relays to the Iranian server
  itself. To a client the door is the Iranian relay: the same identity,
  mailbox, and TURN.
- **Safe**: before using it, the app proves the door leads to the Iranian relay
  (the backup-address key proof). The Iranian relay accepts streams only from
  the relay outside Iran and connects them only to its own server. That
  relay, like the Iranian one, sees the connection details of people coming
  through the door; message content stays end-to-end encrypted.
- **Automatic**: a user on the Iranian relay whose address stops answering moves
  to the door by itself; a new user who enters the Iranian relay's address
  finds the door through the relay that served the app; entering
  `https://chat.example.com:8586` as the relay address works too.
- **Calls and files**: tested through the door — messages both ways, messages
  across the two relays, video calls direct and across relays, and files both
  ways. Call audio and video do not go through the door: they use the Iranian
  relay's TURN, whose port 3478 (UDP and TCP) is open from outside.

## ۲. بستن پورت‌های بی‌رمز · Closing the unencrypted ports

- **پورت 9000 و دوتای دیگر** — رله روی 9000 (رله)، 9001 (حضور آنلاین) و 9080 (نصب
  سرور جدید) بدون رمزنگاری از کل اینترنت جواب می‌داد. حالا این پورت‌ها فقط به خود سرور
  و nginx جواب می‌دهند و از اینترنت اتصال رد می‌شود. همهٔ ارتباط بیرونی فقط از HTTPS
  می‌گذرد.
- **نصب‌کنندهٔ سرور جدید** — به مسیر `/bootstrap/` روی HTTPS منتقل شد. قبلاً اسکریپتی را
  که مستقیم اجرا می‌شود و توکن آن را بی‌رمز می‌فرستاد.
- **استقرار** — اسکریپت deploy حالا وقتی سروری از این‌جا در دسترس نیست (مثل سرور ایران
  از بیرون)، به‌جای ۱۸ دقیقه انتظار همین را می‌گوید و به بررسی روی خود سرور تکیه می‌کند.

- **Port 9000 and two more**: the relay answered the whole internet without
  encryption on 9000 (the relay), 9001 (presence), and 9080 (the new-server
  installer). These ports now answer only the server itself and nginx; from
  the internet the connection is refused. Everything outside goes through
  HTTPS only.
- **The new-server installer** moved to `/bootstrap/` over HTTPS. It used to
  send a script that is piped straight into a shell, and its token, unencrypted.
- **Deploying**: when a server cannot be reached from the deploying machine
  (the Iranian one from outside), the deploy says so instead of waiting out 18
  minutes, and relies on the checks run on the server itself.

---

# P00RIJA Cryptography 2.98.32

Version 2.98.32 · build chat-v125

پیش‌نمایش لینک حالا در نسخهٔ وب و گوشی هم کار می‌کند، کشف محلی دیگر رله را بدون
رمزنگاری انتخاب نمی‌کند، و در نسخهٔ گوشی لینک‌ها (از جمله دانلود به‌روزرسانی) باز
می‌شوند. متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر
آمده‌اند.

Link previews now work in the web and phone apps, local discovery no longer picks
an unencrypted relay address, and links (an update's download included) open in
the phone apps. Each section is Persian first, English after. Earlier changes
follow below.

---

## ۱. پیش‌نمایش لینک در وب و گوشی · Link previews on the web and phones

- **در همهٔ نسخه‌ها** — نسخهٔ دسکتاپ صفحه را مثل قبل خودش باز می‌کند. مرورگر
  نمی‌تواند صفحهٔ سایت دیگری را بخواند و نسخهٔ گوشی هم ابزاری برای این کار نداشت؛
  حالا این دو از رلهٔ خودتان می‌خواهند که صفحه را باز کند.
- **با همان قواعد امنیتی** — رله فقط آدرس عمومی را باز می‌کند و به همان آدرسی وصل
  می‌شود که بررسی کرده؛ فقط پورت‌های وب؛ حداکثر سه ریدایرکت و هیچ‌کدام به سایت
  دیگر؛ سقف حجم صفحه و تصویر و هشت ثانیه زمان. شبکهٔ داخلی سرور، آدرس‌های محلی و
  آدرس متادیتای ابر دست‌نیافتنی‌اند. رله چیزی ثبت یا نگه نمی‌دارد و برای هر کلاینت
  سقف تعداد دارد.
- **صریح دربارهٔ هزینه** — در این حالت رله لینک را می‌بیند (نه پیام را) و سایت
  آدرس رله را می‌بیند نه شما؛ این را متن کنار کلید پیش از روشن کردن می‌گوید. پیش‌فرض
  خاموش است، و کلید فقط وقتی نشان داده می‌شود که رله اعلام کند این کار را می‌کند.
  مدیر سرور با `CHAT_LINK_PREVIEWS=0` آن را خاموش می‌کند.

- **Everywhere**: the desktop app still opens the page itself. A browser cannot
  read another site's page and the phone apps had no way to, so they now ask
  your own relay to open it.
- **Under the same rules**: the relay opens public addresses only and connects
  to exactly the address it checked; web ports only; at most three redirects,
  none to another site; size caps on page and picture, and eight seconds. The
  server's own network, local addresses, and the cloud metadata address are out
  of reach. The relay logs and keeps nothing, and each client has a ceiling.
- **Plain about the cost**: in this mode the relay sees the link (not the
  message) and the site sees the relay's address, not yours. The hint beside the
  switch says so before it is turned on. Off by default, and offered only when
  the relay says it does previews. An operator turns it off with
  `CHAT_LINK_PREVIEWS=0`.

## ۲. کشف محلی و رلهٔ بدون رمزنگاری · Local discovery and unencrypted relays

- **سرور ایران از بیرون ایران** — بررسی شد: از بیرون ایران (حتی از رلهٔ دیگر)
  اتصال امن به سرور ایران دست‌دادنش کامل می‌شود و بعد هیچ داده‌ای برنمی‌گردد، هم
  روی 8585 و هم روی 443، در حالی که HTTP ساده روی 9000 رد می‌شود و سرور ایران خودش
  سالم است. این فیلتر شبکه است نه ایراد برنامه. اتصال میان دو رله برقرار است چون
  سمت ایران آن را برقرار می‌کند. کاربران بیرون از ایران از رلهٔ بیرون استفاده
  کنند؛ پیام و تماس با کاربران رلهٔ ایران از مسیر میان دو رله می‌رود.
- **دیگر بدون رمزنگاری نه** — در اندروید، کشف محلی آدرس `http://...:9000` را
  برمی‌داشت و ارتباط با رله (اطلاعات اتصال، حضور آنلاین، رمز TURN) بی‌رمز از
  اینترنت می‌گذشت؛ در مک هم همهٔ آدرس‌های امتحانی به آدرس خود برنامه تبدیل می‌شدند.
  حالا رلهٔ اینترنتی فقط با https امتحان می‌شود و HTTP ساده فقط در شبکهٔ محلی. پیام‌ها
  در هر حال سرتاسری رمز بودند.
- **انتقال خودکار به https** — آدرسی که قبلاً روی پورت بی‌رمز ذخیره شده، به محض
  جواب دادن https همان سرور به آن منتقل می‌شود؛ اگر جواب ندهد، یک بار هشدار داده
  می‌شود که اتصال بی‌رمز است.
- **پیام دقیق‌تر** — اگر سروری فقط بی‌رمز جواب بدهد، نسخهٔ native همین را می‌گوید نه
  «پیدا نشد»؛ نسخهٔ وب توضیح می‌دهد که ممکن است اتصال امن در مسیر مسدود باشد.
- **سریع‌تر** — آدرس‌ها هم‌زمان امتحان می‌شوند؛ سروری که TLS آن فیلتر شده یک بار
  منتظر می‌گذارد، نه یک بار برای هر آدرس.

- **The Iranian relay from outside Iran**: checked. From outside Iran (even from
  the other relay) a secure connection to it completes its handshake and then
  receives nothing, on 8585 and on 443 alike, while plain HTTP on 9000 passes and
  the server itself is healthy. That is network filtering, not the app. The link
  between the two relays stays up because the Iranian side dials it. People
  outside Iran use the relay outside; messages and calls to people on the
  Iranian relay travel over the link.
- **No more unencrypted relays**: on Android, discovery took `http://...:9000`
  and the relay traffic (connection details, presence, the TURN password)
  crossed the internet unencrypted; on a Mac every candidate became the app's
  own origin. An internet relay is now tried over https only, and plain HTTP
  only on the local network. Messages were end-to-end encrypted either way.
- **Moved to https by itself**: an address saved under a plain port moves to the
  same server's https as soon as that answers; if it does not, a one-time
  warning says the connection is unencrypted.
- **A clearer answer**: when a server answers only without encryption, the
  native apps say exactly that instead of "nothing found"; the web app explains
  that secure connections may be blocked on the way.
- **Faster**: candidates are probed together, so a relay whose TLS is filtered
  costs one wait, not one per address.

## ۳. لینک و به‌روزرسانی در گوشی · Links and updates on phones

- **دانلود به‌روزرسانی** — در اندروید و iOS دستور باز کردن لینک در مرورگر همیشه رد
  می‌شد؛ برای همین «دانلود» در درباره من خطای «لینک باز نشد» می‌داد، و هیچ لینک
  خارجی دیگری (لینک داخل پیام، باز کردن در نقشه) هم باز نمی‌شد. حالا لینک به مرورگر
  گوشی داده می‌شود و فایل نصب از همان‌جا دانلود می‌شود. برنامه خودش چیزی را نصب
  نمی‌کند.
- این بخش در نسخهٔ native است؛ برای گرفتنش نسخهٔ جدید اندروید را نصب کنید.

- **An update's download**: on Android and iOS, opening a link in the browser was
  always refused, so "Download" on the About page said the link would not open,
  and no other external link (a link in a message, "open in maps") opened either.
  Links now go to the phone's browser, and the installer downloads from there.
  The app still installs nothing by itself.
- This part lives in the native app; install the new Android build to get it.

---

# P00RIJA Cryptography 2.98.31

Version 2.98.31 · build chat-v124

هایلایت متن انتخاب‌شده روی آیفون دوباره همان جایی کشیده می‌شود که متن هست. متن هر بخش
اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

The selection highlight on an iPhone is drawn over the selected text again.
Each section is Persian first, English after. Earlier changes follow below.

---

## هایلایت انتخاب روی آیفون · The selection highlight on an iPhone

- **سر جای خودش** — در 2.98.30، تا نوار قالب‌بندی ظاهر می‌شد، iOS هایلایت آبی و
  دستگیره‌های انتخاب را حدود ۱۴۰ پیکسل بالاتر و کمی چپ‌تر از متن داخل کادر
  می‌کشید، روی پیام‌ها. قالب درست اعمال می‌شد ولی ظاهرش به هم می‌ریخت. علت این بود
  که نوار داخل همان ظرفِ کادر پیام بود و از آن بیرون زده بود؛ حالا نوار بیرون از کادر
  است و جایش با محاسبه تعیین می‌شود. روی شبیه‌ساز آیفون آزموده شد: هایلایت بعد از
  انتخاب، بعد از پررنگ و بعد از کجِ همان کلمه روی متن می‌ماند.
- جای نوار همان است که در 2.98.30 بود: بالای کادر و دور از منوی کپی خود گوشی.

- **Where it belongs**: in 2.98.30, as soon as the formatting bar appeared, iOS
  drew the blue highlight and the selection handles about 140px above and a
  little left of the text in the box, over the messages. Formats were applied
  correctly, but it looked wrong. The bar sat inside the message box's own
  container and hung out of it; it is now outside the box and placed by
  measurement. Tested in the iPhone simulator: the highlight stays on the text
  after selecting, after Bold, and after Italic on the same word.
- The bar sits where it did in 2.98.30: above the box, clear of the phone's own
  copy menu.

---

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
