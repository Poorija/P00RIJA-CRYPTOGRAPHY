# P00RIJA Cryptography 2.98.64

Version 2.98.64 · build chat-v157

متن هر بخش اول فارسی است و بعد انگلیسی. تغییرات نسخه‌های قبلی پایین‌تر آمده‌اند.

Each section is Persian first, English after. Earlier changes follow below.

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
