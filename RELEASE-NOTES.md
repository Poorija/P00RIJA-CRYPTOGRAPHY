# P00RIJA Cryptography 2.91.11

Version 2.91.11 · build chat-v95

این نسخه دربارهٔ صحنهٔ استفاده است، نه ماشین زیر آن: پک استیکری که با یک
دکمه به دست طرف مقابل می‌رسد، سوئیچ‌هایی که روی هر دستگاهی یک شکل می‌افتند،
و ردیف اموجی‌هایی که زیر کیبورد iOS گم نمی‌شوند.

This release is about the moment of use rather than the machinery underneath
it: a sticker pack that reaches the other person with one button, switches
that draw one shape on every device, and emoji rows that do not vanish under
the iOS keyboard.

---

## اشتراک‌گذاری پک استیکر — تکی و با هم

هر دو جایی که پک‌ها را مدیریت می‌کند — پنجرهٔ «مدیریت پک‌های استیکر» و
نمای مدیریتی خود پنل استیکر — حالا دو راه ارسال دارد: دکمهٔ ارسالِ هر ردیف
همان پک را برای گفتگوی باز می‌فرستد، و اگر چند پک را تیک بزنید، دکمهٔ «ارسال
انتخاب‌شده‌ها» همه را به ترتیبی که می‌بینید می‌فرستد — هر پک همچنان یک پیام
جدا، چون دکمهٔ «افزودن» در آن‌طرف به ازای هر پک کار می‌کند. پک خالی یا بیش
از حد بزرگ رد می‌شود ولی مانع بقیه نمی‌شود، و آخرش یک جمله می‌گوید چند پک
رفت و چند تا نرفت.

Both places that manage packs now share both ways: the send button on each
row shares that one pack into the open chat, and ticking several packs sends
them all, in the order shown — each pack still its own message, because the
receiver's Add button works per pack. An empty or oversized pack is skipped
without stopping the rest, and one sentence at the end says how many went
and how many did not.

## مسیر پیام، یک آیکون کنارش — نه یک پاراگراف بالایش

وقتی پیامی برای مخاطبِ روی رلهٔ دیگر، به‌جای مسیر رمزنگاری‌شدهٔ بین دو رله از
رلهٔ خودتان می‌گذرد (چون آن مسیر در دسترس نیست یا شما آن را خاموش کرده‌اید)،
دیگر اعلین تکراری نمی‌گیرید. فلش کنار پیام نشانش می‌دهد و با زدنش همان
توضیح، موقع خودش، می‌آید.

When a message to a contact on another relay travels through your own relay
instead of the encrypted link between the two — because that link is down, or
because you switched it off — there is no repeated banner any more. An arrow
beside the message marks it, and tapping it brings the explanation exactly
when it is wanted.

## سوئیچ ارتباط بین رله‌ها

در چت امن ← تنظیمات ← اتصال و TURN، یک کلید تازه همان‌جاست که خودِ اتصال
است: «ارتباط بین رله‌ها». روشن، همان رفتار همیشگی است — پیام، فایل و تماس،
شخصی و گروهی، از مسیر رمزنگاری‌شدهٔ بین دو رله. خاموش، همه‌چیز از رلهٔ خودتان
می‌رود؛ محتوا همیشه رمزنگاری‌شده می‌ماند، ولی رله می‌بیند با چه کسی حرف
می‌زنید. انتخاب شما بخشی از پروفایل است و همراهش سفر می‌کند.

In Secure Chat ← Settings ← Connection & TURN, next to the connection itself:
the "cross-relay" switch. On is the behaviour there has always been — messages,
files and calls, private and group, over the encrypted link between the relays.
Off sends everything through your own relay; the content stays encrypted
either way, but the relay sees who you talk to. The choice travels with your
profile.

## سوئیچ‌های «چت امن» و «ارتباط بین رله‌ها» مثل بقیه شدند

هر سوییچ در پنل اتصال دو چیز را از حالتش نشان می‌دهد: خودِ کلید و
**ردیفش** — پس‌زمینهٔ اکسنت‌دارِ ردیف همان چیزی است که «این یکی روشن است»
را از فاصله می‌گوید. لیستی که این حالت ردیف را می‌سازد شش کلید قدیمی را
پوشش می‌داد و این دو را جا انداخته بود: کلیدها کار می‌کردند ولی ردیف‌هایشان
همیشه در رنگ خاموش می‌ماندند — همان «این دو کلید متفاوت‌اند» که روی هر
دستگاهی دیده می‌شد. حالا هر دو در آن لیست‌اند: ردیف روشن، توضیحِ وضعیت روی
خود کلید، و نقش درست برای صفحه‌خوان‌ها، مثل شش تای دیگر. رنگ حالت خاموش
کلیدها هم که با `color-mix()` ساخته می‌شد (قابلیتی که iOS فقط از ۱۶.۲
می‌شناسد) اکنون یک معادل ثابت دارد که هر مرورگری می‌فهمد.

Every switch in the connection panel signals its state twice: the control
itself and its row — the accent-tinted row background is what says "this one
is on" from across the screen. The list that draws that row state covered the
six older switches and missed these two: the switches worked, but their rows
sat permanently in the off colour, which is the "these two look different"
that showed on every device. Both are in the list now — lit row, state
explanation on the control, and the proper role for screen readers, same as
the other six. The controls' off-colour, built with `color-mix()` (which iOS
only knows from 16.2), also gained a plain fallback every browser understands.

## اموجی زیر کیبورد iOS

سقف ارتفاع پنل استیکر و اموجی بر حسب `dvh` بود. اندروید با باز شدن کیبورد
خودش viewport را کوچک می‌کند و `dvh` با آن پایین می‌آید؛ iOS این کار را
نمی‌کند — `dvh` ارتفاع کامل را نگه می‌دارد و کیبورد روی ردیف‌های آخر
می‌نشیند. برای همین در اندروید درست بود و در iOS نه. حالا سقف، مقداری را
که سرووی خود برنامه از ارتفاع کیبورد می‌سنجد و منتشر می‌کند
(`--app-keyboard-inset`) کم می‌کند — iOS هم مثل اندروید پنل را کوچک
می‌کند — و یک کف ارتفاع هم دارد که پنل در هیچ حالتی بی‌استفاده نشود.

The sticker and emoji panel's height cap was in `dvh`. Android shrinks the
viewport itself when the keyboard opens, so `dvh` follows it down; iOS does
not — `dvh` keeps its full height there and the keyboard sits on the last
rows. That is why it was right on Android and wrong on iOS. The cap now
subtracts what the app's own viewport servo measures and publishes as the
keyboard's height (`--app-keyboard-inset`) — so iOS shrinks the panel the way
Android's `dvh` would have — with a floor that keeps the panel usable in any
state.

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
Get-FileHash ".\P00RIJA Cryptography_2.91.11_x64-setup.exe" -Algorithm SHA256
```

برای یک فایل تکی، چک‌سام را با سطر مربوط به همان فایل در `SHA256SUMS.txt`
مقایسه کنید. اگر نخواند، نصبش نکنید و دوباره دانلود کنید.
For a single file, compare the hash against that file's line in
`SHA256SUMS.txt`. If it does not match, do not install it — download again.

---

AGPL-3.0-only · P00RIJA · p00rija@tutamail.com
