# P00RIJA Cryptography 2.91.21

Version 2.91.21 · build chat-v96

این نسخه همهٔ فاصلهٔ از 2.77.0 تا امروز را پوشش می‌دهد: یک ممیزی کامل که از
ریله تا نصاب را گشت، باگ‌هایی که پیدا شد و همه‌شان فیکس شدند، رفتارهایی که
درست شدند، و چند قابلیتی که همان جاها را پر کردند. متن هر بخش اول فارسی
است و بعد انگلیسی.

This release covers the whole distance from 2.77.0 to today: a full audit
that walked from the relay to the installer, the bugs it found and fixed to
the last one, behaviours put right, and a few features that filled the same
places. Each section is Persian first, English after.

---

## امنیت و پایداری رله · Relay security and stability

از ممیزی بیرون آمد که رله در شش جا ساده‌تر از آن فکر می‌کرد که دنیا مهربان
است. هر شش بسته شد:

The audit found six places where the relay assumed a kinder world than the
one it listens to. All six are closed:

- **فریمی که پیام نیست، رله را نمی‌اندازد.** هر بایت‌نامه‌ای که به سوکت
  برسد قبل از اینکه بدانیم چیست تجزیه می‌شود؛ یکی از آن‌ها می‌توانست
  کل سرویس را بیندازد. حالا هر چیز ناشناخته، رد می‌شود و رله سرِ پا
  می‌ماند. **A frame that is not a message no longer takes the relay
  down.** Anything unrecognised is refused and the process stays up.

- **کلید میل‌باکس فقط فینگرپرینت می‌تواند باشد.** نشانی صندوق از کلیدی
  ساخته می‌شد که سمت کاربر می‌آمد؛ شکلی از آن می‌توانست به نام فایل‌های
  بیرون از صندوق برسد. حالا هر کلیدی که فینگرپرینت نیست، پیش از رسیدن
  به هر نام فایلی رد می‌شود. **A mailbox key that is not a fingerprint
  never reaches a filename** — the old form could address files outside
  the mailbox.

- **لینک مردهٔ بین رله‌ها دیده می‌شود، نه فرض.** رلهٔ دوم اگر می‌مرد،
  لینک transit سالم به‌نظر می‌رسید و پیام‌ها را به سکوت می‌فرستاد. حالا
  مرگِ آن‌طرف معلوم می‌شود و مسیر عوض می‌شود. **A link between relays
  that has died is noticed, not assumed** — a dead far side used to look
  like a healthy link eating messages.

- **سوکت اثبات‌نشده هزینهٔ محاسباتی رله را خرج نمی‌کند.** اتصالی که هنوز
  خودش را معرفی نکرده بود می‌توانست از رله کارِ سنگین بگیرد. **An
  unproven socket can no longer spend the relay's arithmetic.**

- **رلهٔ توزیع، همان امنیتی را دارد که رلهٔ مستقر.** نُه فیکس امنیتی‌ای
  که در سرورِ اصلی نشسته بودند، در بستهٔ توزیع (standalone-relay) جای
  خودشان را پیدا کردند؛ نسخه‌ای که دیگران نصب می‌کنند از نسخه‌ای که شما
  نصب کرده‌اید امن‌تر نیست. **The distribution relay answers to the same
  security the deployed one already had** — nine fixes that had landed
  only on the main server now ship in the package everyone installs.

- **پاکت می‌گوید کی نوشته‌اش، و نام را رله انتخاب نمی‌کند.** نام فرستنده
  روی پاکت می‌آید و مهر می‌خورد، نه این‌که رلهٔ مسیر هر نامی که بخواهد
  جایش بگذارد. **An envelope says who wrote it, and the name is not the
  relay's to choose** — the sender's name rides sealed, not renamed in
  transit.

## پیام و مخاطب، درست‌تر · Messages and contacts, behaving

- **مخاطبی که روی رلهٔ دیگر است، مثل یک مخاطب رفتار می‌کند.** قبلاً
  آنلاین‌بودنش دیده نمی‌شد، تماسش همیشه missed می‌شد و از список گفتگو
  چیز دیگری می‌گفت تا از هدرش. حالا همان مخاطب است، همه‌جا. **A contact
  on another relay behaves like the contact it is** — presence, calls and
  the conversation list all agree about them now.

- **فایلی که از سقف بزرگ‌تر است رد می‌شود، نه این‌که بی‌صدا بریده شود.**
  قبلاً فایلِ بزرگ‌تر از حد، ساکت تا حد مجوز بریده می‌شد و طرف مقابل
  فایلِ نصفه را سالم می‌پنداشت — بدترین نوع خرابی. **A file larger than
  the clamp is refused, not quietly cut short.**

- **فایل قدیمی، روی تنظیمات جدید باز می‌شود.** تغییر سهمیهٔ دانلود یا
  کلیدها دیگر آرشیوِ موجود را نمی‌شکند. **An old file opens on new
  settings** — a quota or key change no longer breaks the archive you
  already have.

- **پیامی که با فینگرپرینت نشانی‌گرفته شده، یک جست‌وجوست نه یک مرتب‌سازی.**
  در گفتگوهای بزرگ، هزینهٔ پیدا کردن گیرنده از مرتب‌کردنِ همه‌چیز به یک
  دروازهٔ جست‌وجو افتاد. **A message addressed by fingerprint costs a
  lookup, not a sort.**

- **مسیر پیام، آیکون کنارش است — نه پاراگرافی که بالای گفتگو می‌آید.**
  وقتی پیامی برای مخاطبِ روی رلهٔ دیگر ناچار از رلهٔ خودتان می‌گذرد، دیگر
  اعلینِ تکراریِ [transit fallback] نمی‌گیرید؛ فلش کوچکی کنار پیام
  نشانش می‌دهد و با زدنش توضیح، موقع خودش، می‌آید. **The route a message
  took is an icon beside it, not a paragraph above it** — the repeated
  [transit fallback] banner is gone; an arrow marks the message and tapping
  it explains, exactly when wanted.

## کلید «ارتباط بین رله‌ها» · The cross-relay switch

در چت امن ← تنظیمات ← اتصال و TURN، کنار خودِ اتصال: روشن (پیش‌فرض) یعنی
پیام، فایل و تماس — شخصی و گروهی — از مسیر رمزنگاری‌شدهٔ بین دو رله
می‌رود و رلهٔ شما نمی‌بیند با چه کسی حرف می‌زنید. خاموش یعنی همه‌چیز از
رلهٔ خودتان می‌رود؛ محتوا همیشه رمزنگاری‌شده می‌ماند، ولی رله می‌بیند.
انتخاب شما بخشی از پروفایل است و همراهش سفر می‌کند. نام و توضیح کلید در
هر دو زبان برنامه هست.

In Secure Chat ← Settings ← Connection & TURN, next to the connection
itself: on (the default) sends messages, files and calls — private and
group — over the encrypted link between the relays, so your relay cannot
see who you talk to. Off sends everything through your own relay; content
stays encrypted either way, but the relay sees. The choice travels with
your profile, and the switch is named and explained in both languages.

## iOS · iOS

- **ردیف‌های اموجی زیر کیبورد گم نمی‌شوند.** اندروید با باز شدن کیبورد
  خودش صفحه را کوچک می‌کند؛ iOS این کار را نمی‌کند و کیبورد روی ردیف‌های
  آخرِ پنل استیکر و اموجی می‌نشیند. حالا سقفِ ارتفاع پنل، ارتفاع کیبورد
  را که سرووی خود برنامه می‌سنجد کم می‌کند — iOS هم مثل اندروید پنل را
  جمع می‌کند — و یک کف هم دارد که در هیچ حالتی پنل بی‌استفاده نشود.
  **Emoji rows no longer vanish under the iOS keyboard.** Android resizes
  the viewport itself; iOS does not, so the keyboard sat on the last rows.
  The panel's height cap now subtracts the keyboard height the app's own
  viewport servo measures — iOS shrinks the panel the way Android's `dvh`
  would have — with a floor that keeps it usable in any state.

- **سوییچ‌ها روی هر iOS یک شکل.** حالت روشنِ ردیف (پس‌زمینهٔ روشن) برای
  دو کلید «چت امن» و «ارتباط بین رله‌ها» هرگز روشن نمی‌شد — از فهرستی
  جا مانده بودند؛ حالت خاموشِ رنگ کلیدها هم به `color-mix()` وابسته بود
  که iOS فقط از ۱۶.۲ می‌شناسد. هر دو درست شد: ردیف‌ها مثل بقیه روشن
  می‌شوند و رنگ خاموش روی هر نسخهٔ iOS همان رنگِ همه‌جاست. **Switches
  draw one shape on every iOS.** The on-row state never lit for the
  secure-chat and cross-relay switches (they were missing from the list
  that draws it), and the off colour depended on `color-mix()`, which iOS
  only knows from 16.2. Both fixed: rows light up like every other switch,
  and the off colour is the same on any iOS version.

## اشتراک‌گذاری پک استیکر · Sharing sticker packs

هر دو جایی که پک‌ها را مدیریت می‌کند — پنجرهٔ «مدیریت پک‌های استیکر» و
نمای مدیریتی خود پنل استیکر — حالا دو راه ارسال دارد: دکمهٔ ارسالِ هر
ردیف همان پک را برای گفتگوی باز می‌فرستد، و اگر چند پک را تیک بزنید،
دکمهٔ «ارسال انتخاب‌شده‌ها» همه را به ترتیبی که می‌بینید می‌فرستد — هر پک
همچنان یک پیام جدا، چون دکمهٔ «افزودن» در آن‌طرف به ازای هر پک کار می‌کند.
پک خالی یا بیش از حد بزرگ رد می‌شود ولی مانع بقیه نمی‌شود، و آخرش یک جمله
می‌گوید چند پک رفت و چند تا نرفت.

Both places that manage packs — the pack-manager window and the sticker
panel's own manage view — now share two ways: the send button on each row
shares that one pack into the open chat, and ticking several packs sends
them all, in the order shown, each still its own message because the
receiver's Add button works per pack. An empty or oversized pack is
skipped without stopping the rest, and one sentence at the end says how
many went and how many did not.

## تصویر بزرگ پروفایل، با یک لمس · The other person's photo, one tap away

آواتارِ بالای گفتگو یک عکس کوچک است و تا حالا لمسش هیچ کاری نمی‌کرد. حالا
با زدنش، همان عکس در اندازه‌ای که ارزش دیدن دارد باز می‌شود — همراه نام و
وضعیتی که خودِ طرف مقابل برای خودش نوشته، اگر نوشته باشد. چیزی جز این در
کارت نیست و Esc یا ضربه به پس‌زمینه می‌بنددش. آواتار اعضای گروه، در صفحهٔ
اطلاعات گروه، همین کار را می‌کند.

The avatar at the top of a conversation is a thumbnail, and until now
tapping it did nothing. It now opens that photo at a size worth looking
at, with the name and the status the person wrote for themselves, if they
wrote one; Escape or the backdrop closes it. The member avatars in a
group's info sheet do the same.

## نصب و انتشار · Installing and publishing

- **اپ نصب‌شده، نصبش را کامل می‌کند.** نصاب وسطِ کار رها می‌شد و PWA بعد
  از به‌روزرسانی، دو نسخه از هر فایل را در کش نگه می‌داشت. **An installed
  app actually finishes installing, and its cache keeps one copy of each
  asset.**

- **اسکریپت‌های دیپلوی بلند خطا می‌دهند** — به‌جای این‌که نصفه کپی کنند و
  موفق گزارش شوند — **رازهای سرور روی سیم نمی‌روند** و لینکِ دو رله با
  احتیاط ساخته می‌شود؛ و هیچ‌کس با قفلِ بیلد مسابقه نمی‌رود. **The
  deployment scripts fail loudly, link carefully, and keep the server's
  secrets off the wire** — and nobody races the build lock.

- **بیلد نیتیو می‌تواند بگوید چه رله‌هایی را می‌شناسد** — نصبِ بسته، از
  قبل می‌داند به کدام رله‌ها اعتماد کرده باشد. **A native build can be
  told which relays it ships knowing.**

## زیر کاپوت · Under the hood

- تستِ دو سرورِ واقعی، همان چیزی را قفل می‌کند که ادعا می‌کند (تشکیل پین
  رله، مسیر transit، توافق بیلد دو سرور).
- پروبِ امنیتی همان را می‌خواند که کد می‌گوید؛ کد هم اکنون بی‌ابهام
  می‌گوید.
- `scripts/sync-github-desktop.sh`: export تمیز را در کلونِ GitHub Desktop
  آینه می‌کند و کامیتش می‌کند؛ پوش‌کردن دست آدم می‌ماند.

- The two-real-server test pins what it claims (relay pin formation, the
  transit route, both servers agreeing on the build).
- The security probe reads what the code says, and the code now says it
  unambiguously.
- `scripts/sync-github-desktop.sh` mirrors the clean export into the
  GitHub Desktop clone and commits it; pressing Push stays a human act.

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
Get-FileHash ".\P00RIJA Cryptography_2.91.21_x64-setup.exe" -Algorithm SHA256
```

برای یک فایل تکی، چک‌سام را با سطر مربوط به همان فایل در `SHA256SUMS.txt`
مقایسه کنید. اگر نخواند، نصبش نکنید و دوباره دانلود کنید.
For a single file, compare the hash against that file's line in
`SHA256SUMS.txt`. If it does not match, do not install it — download again.

---

AGPL-3.0-only · P00RIJA · p00rija@tutamail.com
