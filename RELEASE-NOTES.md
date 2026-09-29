# P00RIJA Cryptography 2.77.0

Version 2.77.0 · build chat-v85

این نسخه دربارهٔ یک سؤال است: وقتی شبکه بین شما و آن‌طرف خراب است، چه چیزی
می‌شود کرد؟ سه جواب، به ترتیب سختی شبکه — تماسی که مسیر کوتاه را پیدا می‌کند،
دو رله که برای هم بار می‌برند بی آن‌که بدانند برای چه کسی، و عکسی که یک پیام
را از میان پیام‌رسانی می‌برد که همه‌چیز را می‌خواند.

This release is about one question: when the network between you and the other
person is broken, what can still be done? Three answers, in order of how broken
— a call that finds the short path, two relays that carry for each other without
knowing who for, and a photograph that takes a message through a messenger that
reads everything.

---

## تماس بین دو سرور

دو سرور مستقل که هر کدام کل برنامه را به کاربران خودش می‌دهد، حالا **تماس** هم
بین کاربرانشان برقرار می‌کنند. پیام و فایل از قبل رد می‌شدند؛ تماس نمی‌شد، و
دلیلش یک خط بود: `chatState.peer.call()` یک شناسهٔ PeerJS را صدا می‌زند، و
شناسهٔ PeerJS فقط روی سروری معنا دارد که صادرش کرده. زنگ همیشه می‌رسید — چون
`call-invite` یک پاکت رله است و پاکت رله از transit رد می‌شود — پس تماس زنگ
می‌زد و بعد تسلیم می‌شد، که از سه رفتار ممکن بدترین است.

حالا مذاکرهٔ مدیا از همان راهی می‌رود که پیام می‌رود: offer و answer و
candidate به‌عنوان payload رله سفر می‌کنند، به رلهٔ **گیرنده** مهر شده، پس
رله‌ای که حملشان می‌کند بازشان نمی‌کند.

**مدیا عوض نمی‌شود.** بعد از تبادل دو توصیف، این یک peer connection عادی است:
مستقیم اگر شبکه اجازه بدهد، و از TURN اگر نه. هر طرف TURN **خودش** را استفاده
می‌کند — یک candidate ریلی فقط یک آدرس است، پس چیزی برای اشتراک نیست و هیچ
مسیر مدیای سرور‌به‌سرور لازم نیست. دو TURN مستقل شانس وصل‌شدن را بیشتر می‌کند.

و یک اصلاح که پیدا شدنش تست واقعی بین دو سرور لازم داشت: مخاطبی که روی رلهٔ
دیگر است هرگز آنلاین دیده نمی‌شود، چون presence برای هر رله جداست. این
**بی‌خبری** است نه دانش، ولی شاخهٔ «آفلاین» را می‌رفت — پس تماس بین‌سروری
سی ثانیه زنگ می‌زد و **همیشه** خودش را missed ثبت می‌کرد، حتی وقتی طرف مقابل
نشسته بود و نگاهش می‌کرد.

Two independent servers, each serving the whole application to its own users,
now carry **calls** between them as well. Messages and files already crossed; a
call did not, and the reason was one line — `chatState.peer.call()` addresses a
PeerJS id, and a PeerJS id only means something on the server that issued it.
The ring always arrived, so the failure looked like a call that rang and then
gave up.

The media negotiation now goes the way everything else goes: the offer, the
answer and the candidates travel as relay payloads, sealed to the recipient's
relay, so the relay that carries them cannot open them. The media itself is
unchanged — an ordinary peer connection, direct where the networks allow it and
through TURN where they do not, each side using its own relay's TURN server.

---

## تماس: مسیر کوتاه، و دیدنِ مسیر

رسانهٔ تماس **هرگز از رله رد نمی‌شود**. یا مستقیم است یا از TURN. پس جای رله
هیچ کاری برای کیفیت تماس نمی‌کند و جای TURN تمام ماجراست — و این نسخه اجازه
می‌دهد رله TURN خودش را داشته باشد.

Call media never goes through the relay: it is peer to peer, or it goes through
a TURN server. So where the relay sits does nothing for call quality and where
the TURN server sits is the whole of it.

**پنل کیفیت حالا مسیر را می‌گوید:** مستقیم · از TURN شما · از TURN طرف مقابل ·
**از TURN هر دو طرف**. آن آخری همان مسیر دوپرشی است که هر طرف به TURN نزدیک
خودش می‌رسد و بخش بین‌المللی دیتاسنتر به دیتاسنتر می‌رود. تا امروز تماسی که
بی‌صدا به TURN قارهٔ دیگری افتاده بود، عین تماس مستقیمِ کُند دیده می‌شد.

The quality panel now reports the route — direct, through your TURN, through
theirs, or through both. Until now a call that had quietly fallen back to a TURN
on another continent looked exactly like a direct call that happened to be slow.

**با دو سرور TURN، برنامه انتخاب می‌کند.** ICE هر جفت کاندیدا را واقعاً
اندازه می‌گیرد و بعد با **فرمول اولویت** انتخاب می‌کند، نه با آن اندازه‌گیری.
پس عددی هست که خودش از آن استفاده نمی‌کند. برنامه حالا **برای هر مخاطب** به
یاد می‌سپارد کدام سرور جواب داد، و اگر تماسی چند نمونهٔ پشت‌هم بد بماند آن را
جابه‌جا می‌کند — حداکثر یک بار در هر تماس، چون وقفهٔ کوتاهی در صدا دارد.

With two TURN servers the app chooses. ICE measures every candidate pair for
real and then picks by a priority formula rather than by what it measured, so
there is a number in front of it that it does not use. The app remembers which
server worked **for each contact** — a device with a near server and a far one
has two different right answers — and moves a call that stays poor.

**و اعتبارنامهٔ TURN دنبال رله می‌رود.** تا امروز وقتی چیزی در پروفایل بود
دیگر تازه نمی‌شد، پس کسی که به رلهٔ نزدیک‌تری سوئیچ می‌کرد همچنان تماس‌هایش را
از رلهٔ دور رد می‌کرد — دقیقاً چیزی که TURN نزدیک برای حذفش هست.

TURN credentials now follow the relay in use. They used to be fetched once and
kept, so a client that moved to a nearer relay went on relaying its calls
through the far one.

---

## دو رله که برای هم بار می‌برند

وقتی مخاطب شما روی رلهٔ دیگری است، رلهٔ شما هرگز اسمش را نشنیده. راه ساده این
بود که رلهٔ خودتان پیام را پاس بدهد — و آن‌وقت رله می‌داند گیرنده کیست، و تمام
نکته از دست رفته: **گراف اجتماعی** دقیقاً همان چیزی است که رله‌ای درون یک حوزهٔ
قضایی نباید بتواند بسازد.

پس کلاینت پاکت واقعی را **برای رلهٔ گیرنده** مهر می‌کند و به رلهٔ خودش چیزی
می‌دهد که نمی‌تواند بازش کند. رلهٔ حامل این را می‌بیند و همین را:

```
{ type: 'transit', toRelay, eph, iv, ct }
```

کدام رله، چند بایت، چه زمانی. نه گیرنده، نه محتوا، نه حتی نوع پیام.

When your contact is on another relay, your relay has never heard of them. The
easy answer — have your relay pass it along — hands your relay the recipient,
and the social graph is exactly what a relay inside one jurisdiction must not be
able to assemble. So the client seals the real envelope to the RECIPIENT'S relay
and hands its own relay something it cannot open: a relay id, a byte count and a
time, and nothing else.

**رله حالا نامی دارد که نمی‌تواند دربارهٔ آن دروغ بگوید.** شناسه‌اش هش کلید
عمومی‌اش است، پس کلاینت خودش می‌سازدش و باور نمی‌کند. تغییر آن نام **گزارش
می‌شود و پین را عوض نمی‌کند** — پذیرفتن هر چیزی که آخرین بار جواب داده با
نداشتن پین یکی است.

A relay now has a name it cannot lie about: its id is the hash of its public
key, so the client derives it rather than believing it. A change is reported
with both fingerprints and does not replace the pin.

**لینک بین دو رله ترکیبی پساکوانتومی است.** هر طرف رازی به کلید ML-KEM-768
دیگری encapsulate می‌کند و هر دو راز کنار دو راز ECDH در یک HKDF می‌روند: کلید
فقط وقتی می‌افتد که **هر دو** اولیه بیفتند. رایگان بود، چون Node این را بومی
دارد.

The link between two relays is post-quantum hybrid: each end encapsulates to
the other's ML-KEM-768 key and both secrets join the two ECDH ones in one HKDF,
so the key falls only if BOTH primitives fall.

**رلهٔ حامل هیچ‌چیز ذخیره نمی‌کند.** نه پاکت، نه گیرنده، نه یادداشتی که این دو
به هم وصل بودند. سروری که چیزی ذخیره نمی‌کند، چیزی برای تحویل دادن ندارد.

**و برگشت به مسیر مستقیم دیده می‌شود** — یادداشتی در گفتگو می‌گوید رلهٔ خودتان
در آن حالت می‌بیند با چه کسی حرف می‌زنید. پیام گم نمی‌شود.

**پیش‌فرض خاموش است.** رله‌ای که برای هر کسی حمل کند open relay است. راهنمای
راه‌اندازی: `docs/RELAY-NETWORK.md`.

Off by default — a relay that carried for anyone who asked would be an open
relay. The carrier stores nothing, and a fall back to the direct path is never
silent. See `docs/RELAY-NETWORK.md`.

> **صادقانه دربارهٔ حدودش:** اگر هر دو رله در یک دست باشند، فقط سرعت به دست
> آمده — امنیت این طرح از دو حوزهٔ قضایی با منافع متفاوت می‌آید. حجم لایی
> می‌شود ولی **زمان** نه، پس حریفی که هر دو سر را ببیند هنوز می‌تواند همبسته
> کند. و این پنهان نمی‌کند که کسی از این برنامه استفاده می‌کند؛ پنهان می‌کند
> با چه کسی.
>
> Honestly: with both relays in one pair of hands you have bought speed and
> nothing else — the security comes from two jurisdictions with different
> interests. Sizes are padded, timing is not, so an adversary watching both ends
> can still correlate. And it does not hide that somebody uses this app, only
> who they talk to.

---

## وقتی هیچ رله‌ای در دسترس نیست

در قطعی، پیام‌رسان‌هایی که کار می‌کنند همان‌هایی هستند که **اجازه دارند** کار
کنند — و اجازه دارند چون خوانده می‌شوند.

تونل زدن از روی آن‌ها جواب اشتباه است: دقیقاً به این دلیل مجازند که قابل
بازرسی‌اند، پس تونل مسابقهٔ تشخیص شروع می‌کند — و تونلِ تشخیص‌داده‌شده **به
شخص منتسب می‌شود**، نه به نویسندهٔ نرم‌افزار.

فرستادن چیزی که حامل نمی‌تواند بخواند، هیچ مسابقه‌ای شروع نمی‌کند. همه عکس
می‌فرستند.

During a shutdown the messengers that still work are the ones that are permitted
to work — permitted because they can be read. Tunnelling through one starts a
detection race, and a detected tunnel is attributed to the PERSON. Sending
something the carrier cannot read starts no race: everybody sends photographs.

**از منوی + گفتگو: «ارسال از راه دیگر».** یک مخاطب، یک پیام، یک عکس. پیام برای
مخاطب رمز می‌شود و داخل عکس پنهان می‌شود، و عکس را با هر پیام‌رسانی که کار
می‌کند می‌فرستید.

قطعاتش از قبل بود — کلیدها، و کدک DCT که عمداً برای عبور از فشرده‌سازی مجدد
پیام‌رسان‌ها نوشته شده بود. آن‌چه نبود راهی برای استفاده بی دانستن این‌ها بود.
نسخهٔ ابزاری هشت قدم داشت و سه قطعه دانش.

In the conversation's **+** menu: a contact, a message, a photograph. The pieces
were already here — the keys, and a DCT codec written to survive a messenger
re-encoding a photo. What did not exist was a way to use them without knowing
they were there.

ظرفیت **به بایت** شمرده می‌شود نه کاراکتر و **پیش از تایپ** گفته می‌شود: یک
حرف فارسی دو بایت و یک اموجی چهار بایت است، و محدودیتی که در انتها کشف شود
یعنی پیامی که باید دوباره تایپ شود.

Room is counted in bytes, not characters, and shown before anybody types.

> **حدودش، در خود رابط نوشته شده:** حامل همچنان می‌بیند که به آن شخص عکسی
> فرستادید — گراف اجتماعی پنهان نیست، فقط محتوا. بُرش یا تغییر اندازه پیام را
> از بین می‌برد؛ فشرده‌سازی خودکار پیام‌رسان نه.

---

## خصوصی‌بودن: رسید خواندن

رسید خواندن یک پاسخ **فوری و تضمین‌شده** به هر پیامی است که می‌رسد — و همین آن
را برای کسی که بیرونِ ترافیک را می‌بیند سودمند می‌کند. پژوهش روی sealed sender
سیگنال نشان می‌دهد جفت‌های در حال مکالمه از روی همان پاسخ و با افشای آماری
بازیابی می‌شوند: محتوا مهرشده می‌ماند و شکل گفتگو نه. سیگنال راهی برای خاموش
کردنش ندارد، و همین آن را به سیگنالِ قابل‌اتکایی تبدیل می‌کند.

**حالا می‌شود خاموشش کرد**، و خاموش یعنی **پاسخ فرستاده نمی‌شود** — نه این‌که
فرستاده شود و تیک پنهان بماند. تیک پنهان تنظیمی است که از هیچ‌کس محافظت
نمی‌کند. پیش‌فرض روشن است.

و رسید `delivered` تا چهار ثانیه تأخیر تصادفی می‌گیرد، چون حمله روی **فوری
بودن** پاسخ تکیه دارد.

A read receipt is a guaranteed, immediate answer to every message that arrives,
which is exactly what makes it useful to somebody watching the outside of the
traffic. It can now be turned off, and off means the reply is not sent rather
than sent with the tick hidden. On by default. The 'delivered' receipt also
waits a random part of four seconds.

---

## دو سرور، در عمل

دو رلهٔ واقعی روی دو کشور بالا آمدند و بین دو مرورگر واقعی تست گرفته شد، و آن
تست چیزهایی پیدا کرد که هیچ تست تابعی نمی‌توانست. همه‌شان یک جنس بودند: چیزی که
روی یک رله درست کار می‌کند و بین دو رله بی‌صدا نمی‌کند.

- **پیام فقط یک طرفه می‌رفت.** مسیر بازگشت — این‌که طرف مقابل یاد بگیرد به کجا
  جواب بدهد — فقط داخل پاکت prekey سفر می‌کرد، و prekey همراه presence می‌رود که
  رله فقط به کلاینت‌های خودش پخش می‌کند. یعنی برای تنها جفتی که مسیر بازگشت لازم
  دارند، هیچ‌وقت وجود نداشت. تیک تحویل، تیک خواندن، فایل و تماس همه از همان جاده
  می‌روند، پس همه با هم برمی‌گردند.
- **مخاطب روی رلهٔ دیگر همیشه آفلاین بود.** presence هر رله فقط کلاینت‌های خودش
  را پخش می‌کند. حالا کلاینت سؤال را به رلهٔ آن‌ها مهر می‌کند و رلهٔ خودش حملش
  می‌کند بی آن‌که بتواند بخواندش. چیز تازه‌ای لو نمی‌رود: رله‌ای که جواب می‌دهد
  همان اثرانگشت را هر بار که پیامی برایش حمل شود می‌بیند.
- **و وضعیتش می‌پرید.** هر پخش presence هرکسی را که رله نام نبرده آفلاین می‌کرد،
  و رله هرگز کسی را که جای دیگر است نام نمی‌برد. این نه‌فقط زشت، که غلط بود:
  رله نگفته بود آن شخص نیست، هیچ چیزی درباره‌اش نگفته بود.
- **عکس پروفایل و نام هیچ‌وقت نمی‌رسیدند** — آن‌ها هم با `hello` می‌روند. حالا
  همان ده واقعیت سرتاسری سفر می‌کنند، و تغییر پروفایل به هر مخاطب دور جداگانه
  خبر داده می‌شود. پخش عمومی روی لینک رله وجود ندارد و نباید داشته باشد: رله‌ای
  که کلاینت‌هایش را به همتایش اعلام کند همان چیزی را می‌دهد که قرار نیست یکجا
  درباره‌شان بداند.
- **تماس زنگ می‌زد و وصل نمی‌شد**، و بعد **تماس تمام‌شده دوباره زنگ می‌خورد.**
  اولی: پاسخ‌دهنده در اولین تماس مسیری به سمت تماس‌گیرنده نداشت، پس SDP دور
  ریخته می‌شد. دومی: فریم‌های تماس در صندوق رله ذخیره می‌شدند و سر اتصال مجدد
  دوباره تحویل داده — رد کنی missed می‌شد، جواب بدهی صدایی نبود. حالا در هر سه
  لایه ephemeral‌اند.
- **«ارسال از راه دیگر» هیچ واکنشی نداشت.** شیتش داخل سه والدِ `display:none`
  بود و `position: fixed` از والد مخفی فرار نمی‌کند: باز می‌شد، `display: flex`
  و `opacity: 1` بود، و صفر در صفر اندازه می‌گرفت.
- **روی مک با Brave، بایومتریک QR و بلوتوث می‌خواست نه اثر انگشت.** اولین تلاش
  ثبت `authenticatorAttachment` نداشت، پس مرورگر باید فرض کند هر transport ممکن
  است و picker کامل را باز می‌کند. سافاری مستقیم Touch ID می‌رود چون فقط یک
  authenticator دارد. اگر قبلاً با مسیر QR ثبت کرده‌اید، **یک بار از نو ثبت
  کنید** — رکورد قدیمی `transports: ['hybrid']` ذخیره کرده.

Two real relays in two countries, two real browsers, and the test found what no
unit test could: things that work on one relay and silently do not between two.
Messages went one way only, because the return route rode in an envelope a
cross-relay contact never gets. Presence was never asked for, so the far side
was always grey — and flickered, because every broadcast marked absent everyone
the relay had said nothing about. Photographs and display names never crossed.
Calls rang without connecting, and finished calls rang again after a reconnect
because the call frames were being stored like messages. "Send another way"
opened a sheet that measured zero by zero inside three hidden parents. And a
Chromium browser on a Mac asked for a phone instead of the fingerprint sitting
under the keyboard.

---

## وصل کردن رله‌ها، با یک دستور

وصل کردن دو رله چهار گام است روی دو ماشین، به ترتیب درست: خواندن هویت هر کدام،
نوشتن شناسهٔ آن یکی در `.env`، ری‌استارت رله تا متغیر را بخواند، و بعد بررسی
این‌که لینک واقعاً بالا آمده. با دست یک رشته دستور ssh است با یک رشتهٔ هگز که
بینشان کپی می‌شود، و یک کاراکتر اشتباه رله‌ای می‌دهد که بی‌صدا برای هیچ‌کس بار
نمی‌برد.

```bash
bash scripts/link-relays.sh first second     # هر چهار گام
bash scripts/link-relays.sh --status          # چه به چه وصل است
```

خودش تصمیم می‌گیرد کدام زنگ بزند: یک رله فقط آدرسی را dial می‌کند که گواهی‌اش را
verify کند، پس اگر گواهی یک طرف verify نشود برعکس وصلشان می‌کند — و هیچ‌جا
verify خاموش نمی‌شود. نصب‌کننده هم `--peers` گرفت، برای سروری که از همان اول به
یکی موجود می‌پیوندد.

Linking two relays is one command now, on servers that are already running,
which is the case an installer cannot help with. It decides who dials, because a
relay can only dial an address whose certificate it can verify — and turning
that off is not on the table.

---

## نسخهٔ نیتیو و نسخهٔ وب

هر دو از یک درخت می‌آیند و بررسی می‌شوند: یازده اعلان ورژن باید با هم بخوانند،
و اجزای چت از روی دایرکتوری کشف می‌شوند و با `index.html` تطبیق داده — اگر
نخوانند بیلد نیتیو می‌شکند، به‌جای آن‌که اپی بسازد که بی‌خطا بار می‌شود و یک
قابلیت کامل ندارد.

آن‌چه نصب نیتیو نمی‌تواند خودش بفهمد، آدرس رله است: برنامهٔ وب می‌داند چون از
روی همان بار شده. حالا موقع ساخت می‌شود گفت:

```bash
POORIJA_RELAY_HINTS=https://chat.example.com:8585 npm run native:prepare
```

یک متغیر است نه یک فایل، عمداً: `config/relay-defaults.json` در مخزن هست و
عمداً خالی، چون پروژهٔ منتشرشده نباید نصب تازهٔ یک غریبه را به سرور کسی اشاره
بدهد — و متغیر را نمی‌شود اشتباهی کامیت کرد.

---

## آن‌چه در ساختن پیدا شد

- **`standalone-relay/setup.sh` از یک کامیت به بعد اصلاً بالا نمی‌آمد** —
  `TURN_USER` را در `.env` نمی‌نوشت، پس `docker compose up` انتهای همان اسکریپت
  با «required variable TURN_USER is missing a value» می‌ایستاد. حالا می‌سازدش.
- **پیش‌فرض `CHAT_TURN_URL` نسخهٔ مستقل فقط TLS/TCP بود** در حالی که coturn
  کنارش هر سه را گوش می‌داد. TURN خودِ رسانه را حمل می‌کند و روی TCP بدتر صدا
  می‌دهد. UDP اول شد.
- **PeerJS شنوندهٔ upgrade خودش را نصب می‌کند و به هر مسیری که نمی‌شناسد ۴۰۰
  می‌دهد** — پس مسیر دوم نمی‌توانست وجود داشته باشد. دستی مسیریابی شد.
- **سوئیت تست سقف آفلاین کهنه شده بود:** دقیقاً ۲۰۰ مگابایت می‌فرستاد از زمانی
  که آن عدد بالای سقف بود؛ سقف به دقیقاً ۲۰۰ رسید و نگهبان `>` است. حالا سقف را
  از خود برنامهٔ در حال اجرا می‌خواند.

A few things the work turned up: the standalone relay's own setup script could
not start it at all since TURN_USER became required; its default TURN URL
advertised TLS only while coturn was listening on all three; PeerJS answers 400
to any upgrade path it does not know, so a second WebSocket path could not exist
beside it; and the offline ceiling test had gone stale against the limit it was
written for.

---

## نصب · Installing

| پلتفرم | فایل |
|---|---|
| **Windows x64** | `P00RIJA Cryptography_2.77.0_x64-setup.exe` |
| **Windows ARM** | `P00RIJA Cryptography_2.77.0_arm64-setup.exe` |
| **macOS** | `P00RIJA Cryptography_2.77.0_universal.dmg` (Intel + Apple Silicon) |
| **macOS Apple Silicon** | `P00RIJA Cryptography_2.77.0_aarch64.dmg` |
| **Debian / Ubuntu** | `P00RIJA Cryptography_2.77.0_amd64.deb` · ARM: `_arm64.deb` |
| **Fedora / RHEL** | `P00RIJA Cryptography-2.77.0-1.x86_64.rpm` · ARM: `.aarch64.rpm` |
| **Arch** | `p00rija-cryptography-2.77.0-1-x86_64.pkg.tar.zst` · ARM: `-aarch64` |
| **Linux portable** | `p00rija-cryptography-2.77.0-linux-x86_64.tar.gz` · ARM: `-aarch64` |
| **Linux AppImage** | `P00RIJA Cryptography_2.77.0_amd64.AppImage` · ARM: `_aarch64` |
| **Android** | `P00RIJA-Cryptography-2.77.0-universal.apk` |
| **Source** | `p00rija-cryptography-2.77.0-source.tar.gz` |

**Android:** فایل `.aab` برای آپلود در Google Play است و روی گوشی نصب
نمی‌شود — `.apk` را بگیرید.
The `.aab` is for Play Store upload and cannot be installed on a phone.

**macOS:** برنامه notarize نشده، پس بار اول **راست‌کلیک → Open**.
Not notarised, so the first launch needs **right-click → Open**.

**iOS:** چیزی برای side-load نیست؛ از سورس بیلد کنید.
Nothing to side-load; build from source.

**AppImage:**

```bash
chmod +x "P00RIJA Cryptography_2.77.0_amd64.AppImage"
./"P00RIJA Cryptography_2.77.0_amd64.AppImage"
```

**PWA:** خودش به‌روز می‌شود. اگر رفتار قبلی را می‌بینید، برنامه را ببندید و
دوباره باز کنید تا سرویس‌ورکر نسخهٔ تازه را بردارد.
Updates itself; close and reopen if you still see the old behaviour.

## به‌روزرسانی سرور · Updating a relay

**این نسخه سمت سرور تغییر دارد و سرور باید به‌روز شود.** رله حالا هویت
رمزنگاشتی دارد، `/relay-identity` را جواب می‌دهد، و می‌تواند به رلهٔ دیگری
لینک شود.

This release DOES change the server and the relay must be updated.

```bash
bash scripts/update-server.sh
```

یا از این درخت، با بررسی کامل آن‌چه سرو می‌شود:
Or from this tree, with a full check of what is being served:

```bash
bash scripts/deploy.sh
bash scripts/deploy.sh --check
```

`--check` حالا هویت رله را هم می‌سنجد و بررسی می‌کند شناسه‌اش واقعاً هش کلیدی
است که منتشر کرده.

**پس از اولین راه‌اندازی:** رله یک `relay-identity.json` کنار بقیهٔ state خودش
می‌سازد. **از آن پشتیبان بگیرید.** رله‌ای که آن را از دست بدهد نام تازه
می‌گیرد و هر کلاینتی که نام قبلی را پین کرده بود تغییر هویت را گزارش می‌دهد.

After the first start the relay writes `relay-identity.json` beside its other
state. Back it up: a relay that loses it gets a new name, and every client that
pinned the old one reports that the relay's identity changed.

**TURN:** اگر `TURN_USER` در `.env` ندارید، اضافه‌اش کنید — بی آن کانتینرها
بالا نمی‌آیند. `TURN_USER` و `TURN_PASSWORD` هر دو اجباری‌اند.

**ترانزیت بین رله‌ها** پیش‌فرض خاموش است. برای روشن کردن،
`docs/RELAY-NETWORK.md` را ببینید.

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
Get-FileHash ".\P00RIJA Cryptography_2.77.0_x64-setup.exe" -Algorithm SHA256
```

برای یک فایل تکی، چک‌سام را با سطر مربوط به همان فایل در `SHA256SUMS.txt`
مقایسه کنید. اگر نخواند، نصبش نکنید و دوباره دانلود کنید.
For a single file, compare the hash against that file's line in
`SHA256SUMS.txt`. If it does not match, do not install it — download again.

---

AGPL-3.0-only · P00RIJA · p00rija@tutamail.com
