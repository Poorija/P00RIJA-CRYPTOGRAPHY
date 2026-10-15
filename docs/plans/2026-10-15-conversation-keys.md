# کلید جداگانه برای هر گفتگو: حذفی که واقعاً پاک می‌کند
# Per-conversation keys: a deletion that really erases

وضعیت: نقشهٔ توسعه، هنوز پیاده‌سازی نشده. مرحلهٔ اول حذف گفتگو (پاک‌سازی کامل محلی،
جدا شدن گفتگو از مخاطب، همگام‌سازی حذف با دستگاه‌های دیگر و انتخاب برای گروه) در نسخهٔ
2.98.43 انجام شد. این سند مرحلهٔ دوم است.
Status: development plan, not built yet. Phase one of conversation deletion
(complete local wipe, the conversation apart from the contact, deletion synced
to the account's other devices, and the group choice) shipped in 2.98.43. This
document is phase two.
تاریخ: ۱۵ اکتبر ۲۰۲۶

---

## ۱. مسئله

حذف یک گفتگو الان منطقی است، نه رمزنگارانه:
- همهٔ پیام‌های همهٔ گفتگوها در یک فایل رمزنگاری‌شده با یک کلید ذخیره می‌شوند
  (`poorija_chat_history`).
- همهٔ فایل‌ها با یک کلید مشترک (`poorija_chat_media_key`) در IndexedDB نگهداری
  می‌شوند.

مرورگر و سیستم‌عامل داده‌ای را که پاک شده فوراً از روی دیسک بازنویسی نمی‌کنند
(LevelDB، SQLite، WAL، صفحه‌های آزاد و فشرده‌سازی‌ای که هنوز اجرا نشده). همان کلید
برای بقیهٔ گفتگوها هنوز وجود دارد. پس کسی که به فایل‌های خام دستگاه دسترسی داشته
باشد، تا وقتی آن داده‌ها بازنویسی نشده‌اند، از نظر تئوری می‌تواند نسخهٔ قدیمی یک
گفتگوی حذف‌شده را باز کند.

## 1. The problem

Deleting a conversation is logical, not cryptographic today:
- every conversation's messages are kept in one encrypted record under one key
  (`poorija_chat_history`);
- every file sits in IndexedDB under one shared key (`poorija_chat_media_key`).

Browsers and operating systems do not overwrite deleted bytes at once (LevelDB,
SQLite, WAL, free pages, compaction that has not run yet). The same key still
exists for every other conversation, so someone holding the device's raw files
could, in principle, open an old copy of a deleted conversation until it is
overwritten.

---

## ۲. طرح: Crypto-shredding

هر گفتگو یک کلید داده‌ی تصادفی ۲۵۶ بیتی (DEK) دارد:

```
vault key (همان کلید گاوصندوق، از رمز کاربر)
  └── conversation key directory      ← رمزشده با vault key
        ├── conv A → DEK_A (wrapped)
        ├── conv B → DEK_B (wrapped)
        └── …
history:<hash(conv A)>  ← AES-256-GCM با DEK_A
history:<hash(conv B)>  ← AES-256-GCM با DEK_B
media blob (conv A)     ← AES-256-GCM با DEK_A
```

- **پیام‌ها:** به‌جای یک رکورد برای کل تاریخچه، هر گفتگو رکورد خودش را دارد. نام
  رکورد هش شناسهٔ گفتگوست، پس فهرست رکوردها هم نشان نمی‌دهد با چه کسی گفتگو بوده.
- **فایل‌ها:** هر فایل با DEK گفتگوی خودش رمز می‌شود، نه با کلید مشترک.
- **حذف:** ورودی DEK آن گفتگو از دفترچهٔ کلیدها برداشته می‌شود و دفترچه دوباره
  نوشته می‌شود؛ بعد رکوردها و فایل‌ها پاک می‌شوند. از همان لحظه هر کپی‌ای که روی
  دیسک جا مانده باشد دیگر قابل باز شدن نیست، چون کلیدش دیگر هیچ‌جا وجود ندارد.
- **دفترچهٔ کلیدها** کوچک است (چند ده بایت برای هر گفتگو) و با هر حذف کامل
  بازنویسی می‌شود.

## 2. The design: crypto-shredding

Each conversation gets a random 256-bit data key (DEK), wrapped by the vault key
in a small key directory. Each conversation's history is its own record, named
by a hash of the conversation id. Its files are sealed with the same DEK.
Deleting removes the DEK from the directory and rewrites the directory, and only
then removes the records. From that moment any copy left on disk can no longer
be opened, because the key exists nowhere.

---

## ۳. مراحل پیاده‌سازی

1. **لایهٔ ذخیره‌سازی** (`20-call-rows.js`، `02-media-vault.js`):
   - `conversationKey(id)` که DEK را می‌سازد، باز می‌کند یا cache می‌کند.
   - `storeHistory` به ازای هر گفتگو می‌نویسد، فقط برای گفتگوهای تغییرکرده
     (dirty set)، تا یک پیام جدید کل تاریخچه را بازنویسی نکند.
   - `persistMessageMedia` و خواندن فایل‌ها با DEK همان گفتگو.
2. **مهاجرت یک‌باره هنگام باز کردن قفل:**
   - رکورد قدیمی خوانده، به رکوردهای جدا تقسیم و دوباره نوشته می‌شود؛ بعد
     رکورد قدیمی پاک می‌شود.
   - فایل‌ها در پس‌زمینه و آرام دوباره رمز می‌شوند (با تکه‌تکه کردن تراکنش‌ها)،
     تا برنامه قفل نشود. پیشرفت ذخیره می‌شود تا قطع شدن وسط کار مشکلی نسازد.
   - تا پایان مهاجرت، خواندن از هر دو قالب پشتیبانی می‌شود.
3. **حذف** (`purgeConversationEverywhere`): ابتدا DEK از دفترچه برداشته و دفترچه
   ذخیره می‌شود، بعد بقیهٔ کارها انجام می‌شود.
4. **پروفایل‌های اضطراری (duress) و خروجی/پشتیبان:** دفترچهٔ کلیدها مثل بقیهٔ
   داده‌ها به پروفایل باز تعلق دارد. خروجی رمزنگاری‌شده هر گفتگو را با کلید خودش
   نمی‌برد، بلکه متن باز را با رمز خروجی رمز می‌کند (مثل الان).
5. **همگام‌سازی دستگاه‌ها:** تغییری لازم نیست. هر دستگاه DEKهای خودش را دارد و
   پیام‌ها مثل الان به‌صورت رمزشده برای دستگاه دیگر می‌روند.

## 3. Steps

1. Storage: `conversationKey(id)`; per-conversation history records written for
   dirty conversations only; media sealed with the conversation's DEK.
2. A one-time migration at unlock, resumable, reading both formats until it ends;
   files are re-sealed in the background in small transactions.
3. Deletion drops the DEK and saves the directory first, then everything else.
4. Duress profiles and exports: the directory belongs to the open profile; an
   export carries plaintext sealed under the export password, as today.
5. Device sync: unchanged; each device has its own DEKs.

---

## ۴. آزمون‌ها

- بعد از حذف، رکوردهای قدیمی‌ای که مستقیم از IndexedDB یا localStorage برداشته
  شده‌اند با هیچ کلید موجودی باز نشوند.
- مهاجرت: تاریخچهٔ ۲۰۰۰ پیام و ۵۰ فایل، با قطع شدن وسط کار، بدون از دست رفتن چیزی
  کامل شود.
- کارایی: یک پیام جدید فقط رکورد همان گفتگو را بازنویسی کند.
- پروفایل اضطراری، خروجی و ورودی، و همگام‌سازی دو دستگاه مثل قبل کار کنند.

## 4. Tests

- After deletion, old records lifted straight from IndexedDB or localStorage
  open with no key that still exists.
- Migration of 2,000 messages and 50 files completes losing nothing, including
  when interrupted halfway.
- A new message rewrites only its own conversation's record.
- Duress profiles, export and import, and two-device sync behave as before.

---

## ۵. چیزی که این طرح تضمین نمی‌کند

هیچ برنامه‌ای نمی‌تواند کپی‌هایی را که سیستم‌عامل گرفته پاک کند: حافظهٔ swap، نسخهٔ
پشتیبان دستگاه (iCloud، Time Machine، پشتیبان اندروید) یا اسکرین‌شات. Crypto-shredding
قوی‌ترین کاری است که از دست برنامه برمی‌آید. کپی‌هایی که روی دستگاه طرف مقابل است هم
طبق تعریف دست‌نخورده می‌ماند.

## 5. What this does not promise

No app can erase copies the operating system made: swap, device backups (iCloud,
Time Machine, Android backup), or screenshots. Crypto-shredding is the strongest
an app can do. The other person's copies stay untouched, by design.

**تخمین · Estimate:** ۳ تا ۴ روز، به‌اضافهٔ یک دور آزمون روی دستگاه‌های واقعی.
3 to 4 days, plus a round of testing on real devices.
