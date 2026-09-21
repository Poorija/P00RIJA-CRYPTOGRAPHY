# Calls on the Linux native build — why there are none

تاریخ بررسی: ۲۰۲۶-۰۹-۱۸ · Investigated: 2026-09-18

این سند برای این نوشته شده که کسی — از جمله نویسنده‌اش — دوباره از اول درنیاورد.
اگر قصد دارید تماس صوتی/تصویری را در نسخهٔ نیتیو لینوکس فعال کنید، **اول این را
بخوانید**؛ مسیری که بدیهی به‌نظر می‌رسد بن‌بست است و دلیلش از روی خواندن کد یا
مستندات معلوم نمی‌شود.

This exists so nobody — including the person who wrote it — re-derives it from
scratch. If you are about to enable voice/video calls in the Linux native
build, **read this first**: the obvious route is a dead end, and nothing you can
read in the code or the docs will tell you that.

---

## فارسی

### جواب کوتاه

بیلدهای رایجِ WebKitGTK که توزیع‌ها منتشر می‌کنند، بک‌اند WebRTC را **کامپایل‌شده
ندارند**. نه ناپایدار است، نه خاموش — اصلاً نیست. `RTCPeerConnection` تعریف‌نشده
است و هیچ تنظیمی این را عوض نمی‌کند.

### دام اصلی

`WebKitSettings` خاصیتی به نام `enable-webrtc` دارد. این خاصیت:

- در GIR سیستم هست و `writable="1"` است،
- کریت `webkit2gtk` ستِرش را دارد (`set_enable_webrtc`)،
- واقعاً ست می‌شود و `get_property` مقدار جدید را برمی‌گرداند،
- و **هیچ کاری نمی‌کند**.

آن خاصیت همیشه در آبجکت settings کامپایل می‌شود، چه بک‌اند ساخته شده باشد چه
نشده باشد. وجودِ خاصیت با وجودِ قابلیت یکی نیست — و این تنها دامی است که این
بررسی را یک بار به جواب غلط رساند.

### شواهد

یک WebKitGTK واقعی بالا آورده شد و از خودش پرسیده شد:

```
WebKitGTK 2.50.4  (Ubuntu 22.04، همان ایمیجی که بسته‌های لینوکس با آن ساخته می‌شوند)

enable-webrtc default            False
enable-webrtc = False   →  {"pc":"undefined","dc":"undefined","gum":true}
enable-webrtc = True    →  {"pc":"undefined","dc":"undefined","gum":true}
```

`gum: true` یعنی `navigator.mediaDevices.getUserMedia` هست — دوربین و میکروفون
قابلیت جدایی‌اند (`enable-media-stream`) و آن‌ها کامپایل شده‌اند. چیزی که نیست،
اتصال همتا‌به‌همتاست.

مختص اوبونتو هم نیست:

| توزیع | رشتهٔ `webrtcbin` در `libwebkit2gtk-4.1.so.0` | لینک به `libgstwebrtc` |
|---|---|---|
| Ubuntu 22.04 (WebKitGTK 2.50.4) | غایب | نه |
| Fedora 41 | غایب | نه |

`webrtcbin` نام کارخانهٔ المان است و اگر بک‌اند ساخته شده بود **باید** به‌صورت
رشتهٔ تحت‌اللفظی در باینری می‌بود، چون با `gst_element_factory_make("webrtcbin", …)`
ساخته می‌شود.

### حتی اگر بود، چرا شکننده می‌بود

WebKitGTK از **libwebrtc گوگل استفاده نمی‌کند** — همان پیاده‌سازی‌ای که کروم،
فایرفاکس و اپ‌های نیتیو دارند. بک‌اندش روی **GStreamer** است: `webrtcbin` از
`gst-plugins-bad` به‌اضافهٔ `libnice` برای ICE. پیاده‌سازی مستقلی با منحنی بلوغ
جداگانه، و سه شکاف که مستقیم روی پایداری تماس اثر می‌گذارند:

1. **کنترل ازدحام.** `rtpgccbwe` — تخمین‌گر پهنای‌باند Google Congestion Control —
   در `gst-plugins-rs` است، نه در `plugins-bad`، و روی اوبونتو ۲۲.۰۴ بسته‌بندی
   نشده. در کانتینر بیلد بررسی شد: **غایب**. بدون آن، فرستنده وقتی لینک افت
   می‌کند بیت‌ریت را پایین نمی‌آورد. همین یک قلم «تماسی که مدام قطع و وصل می‌شود»
   را تولید می‌کند.
2. **بافر جیتر.** `rtpjitterbuffer` کار می‌کند ولی معادل NetEq نیست — تطبیق‌پذیری
   و پنهان‌سازی از دست رفتن بسته ضعیف‌تر است.
3. **حذف اکو.** به پیکربندی PipeWire/PulseAudio وابسته است، نه یک AEC3 توکار.

ضمناً GStreamer روی همان ایمیج **۱.۲۰.۳** است (۲۰۲۲) در حالی که WebKitGTK ۲.۵۰
است (۲۰۲۵) — بک‌اند WebRTC آن برای گسترمر به‌مراتب جدیدتری نوشته شده.

### پس برنامه چه می‌کند

`webRTCSupported()` نبودِ `RTCPeerConnection` را می‌بیند و تماس را رد می‌کند با
پیامی که قابل اقدام است، و پنل تماس‌ها دکمه‌ای دارد که آدرس رلهٔ خود کاربر را با
`openExternal` به مرورگر سیستم می‌دهد. فایرفاکس و کروم libwebrtc کامل دارند.

**این دور زدن مشکل نیست، جواب درست است.** حتی اگر روزی یک توزیع WebKitGTK را با
WebRTC بسازد، باز هم تشخیص زمان اجرا و بازگشت به مرورگر لازم است، چون نمی‌شود
روی بیلدِ موتورِ کاربر حساب کرد.

### برای اینکه عوض شود، چه لازم است

- WebKitGTK ساخته‌شده با `-DENABLE_WEB_RTC=ON` (یعنی بیلد سفارشی، نه چیزی که
  توزیع‌ها می‌دهند)،
- GStreamer ≥ ۱.۲۲، ترجیحاً بالاتر،
- `gst-plugins-rs` برای `rtpgccbwe`، وگرنه تماس بدون کنترل ازدحام می‌ماند،
- و هندل‌کردن سیگنال `permission-request` وب‌ویو، وگرنه WebKitGTK درخواست
  میکروفون/دوربینی را که کسی جوابش را ندهد رد می‌کند.

هیچ‌کدام از این‌ها را نمی‌شود به کاربر نهایی تحمیل کرد.

---

## English

### The short answer

The WebKitGTK builds distributions actually ship **do not have the WebRTC
backend compiled in**. It is not unstable and it is not switched off — it is
absent. `RTCPeerConnection` is undefined and no setting changes that.

### The trap

`WebKitSettings` carries a property called `enable-webrtc`. That property:

- is in the system GIR, marked `writable="1"`,
- has a setter in the `webkit2gtk` crate (`set_enable_webrtc`),
- really does set, and `get_property` reads the new value back,
- and **does nothing at all**.

The property is compiled into the settings object whether or not the backend
was built. A property existing is not a capability existing — and that is the
one trap that took this investigation to a wrong answer once already.

### The evidence

A real WebKitGTK was started and asked directly:

```
WebKitGTK 2.50.4  (Ubuntu 22.04, the same image the Linux packages are built in)

enable-webrtc default            False
enable-webrtc = False   →  {"pc":"undefined","dc":"undefined","gum":true}
enable-webrtc = True    →  {"pc":"undefined","dc":"undefined","gum":true}
```

`gum: true` means `navigator.mediaDevices.getUserMedia` is present — camera and
microphone are a separate feature (`enable-media-stream`) and that one *is*
built. What is missing is the peer connection.

Not an Ubuntu quirk either:

| Distribution | `webrtcbin` string in `libwebkit2gtk-4.1.so.0` | links `libgstwebrtc` |
|---|---|---|
| Ubuntu 22.04 (WebKitGTK 2.50.4) | absent | no |
| Fedora 41 | absent | no |

`webrtcbin` is an element factory name, so it would **have** to appear as a
literal in the binary if the backend were built: it is created with
`gst_element_factory_make("webrtcbin", …)`.

### Why it would be shaky even if it were there

WebKitGTK does **not** use Google's libwebrtc — the implementation Chrome,
Firefox and native apps run. Its backend is **GStreamer**: `webrtcbin` from
`gst-plugins-bad` plus `libnice` for ICE. An independent implementation on its
own maturity curve, with three gaps that bear directly on whether a call holds:

1. **Congestion control.** `rtpgccbwe` — the Google Congestion Control
   bandwidth estimator — lives in `gst-plugins-rs`, not `plugins-bad`, and is
   not packaged on Ubuntu 22.04. Checked in the build container: **absent**.
   Without it the sender never backs its bitrate off when the link degrades,
   which on its own produces exactly the "call keeps dropping" symptom.
2. **Jitter buffer.** `rtpjitterbuffer` works but is not NetEq: weaker
   adaptation and weaker packet-loss concealment.
3. **Echo cancellation.** Depends on how PipeWire/PulseAudio is configured
   rather than on a built-in AEC3.

GStreamer on that image is also **1.20.3** (2022) against WebKitGTK 2.50 (2025);
its WebRTC backend was written for a much newer GStreamer.

### So what the app does

`webRTCSupported()` sees no `RTCPeerConnection`, refuses the call with a message
somebody can act on, and the calls pane carries a button that hands the user's
own relay address to the system browser through `openExternal`. Firefox and
Chrome carry full libwebrtc.

**That is not a workaround, it is the right answer.** Even if a distribution one
day ships WebKitGTK with WebRTC, runtime detection and the browser fallback are
still needed, because you cannot depend on which build of the engine a user has.

### What would have to change

- WebKitGTK built with `-DENABLE_WEB_RTC=ON` — a custom build, not what
  distributions ship,
- GStreamer ≥ 1.22, preferably newer,
- `gst-plugins-rs` for `rtpgccbwe`, or calls run with no congestion control at
  all,
- and a handler for the webview's `permission-request` signal, or WebKitGTK
  denies a microphone/camera request nobody answers.

None of that can be imposed on an end user.

---

## Reproducing this

The probe below is the whole argument. It starts a real WebKitGTK off-screen,
sets the property both ways, and asks the engine what it has. Anything short of
this — reading the GIR, grepping the crate, checking which GStreamer packages
are installed — answers a different question and can answer it wrongly.

```python
# webrtc-probe.py — run inside the Linux builder image:
#   apt-get install -y python3-gi gir1.2-webkit2-4.1 xvfb
#   xvfb-run -a python3 webrtc-probe.py
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

def run(enable_webrtc):
    view = WebKit2.WebView()
    settings = view.get_settings()
    settings.set_property("enable-media-stream", True)
    settings.set_property("enable-webrtc", enable_webrtc)
    window = Gtk.OffscreenWindow()
    window.add(view)
    window.show_all()

    loop, out = GLib.MainLoop(), {}
    def done(view_, result, *_ignored):
        try:
            out["answer"] = view_.evaluate_javascript_finish(result).to_string()
        except Exception as error:
            out["answer"] = "eval failed: %s" % error
        loop.quit()
    def loaded(view_, event):
        if event == WebKit2.LoadEvent.FINISHED:
            view_.evaluate_javascript(
                'JSON.stringify({pc: typeof RTCPeerConnection,'
                ' dc: typeof RTCDataChannel,'
                ' gum: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)})',
                -1, None, None, None, done, None)
    view.connect("load-changed", loaded)
    view.load_html("<html><body>probe</body></html>", "https://probe.invalid/")
    GLib.timeout_add_seconds(20, loop.quit)
    loop.run()
    return settings.get_property("enable-webrtc"), out.get("answer", "(no answer)")

for flag in (False, True):
    print(flag, *run(flag))
```

The GStreamer side, in the same image:

```bash
apt-get install -y gstreamer1.0-tools
gst-inspect-1.0 webrtcbin >/dev/null && echo "webrtcbin present"
gst-inspect-1.0 rtpgccbwe  >/dev/null || echo "no congestion control"
```

Two notes for whoever runs this next. `WebKit2.Settings()` segfaults without a
display, so it needs `xvfb-run`; and the `evaluate_javascript` callback is
handed a third argument, so a two-parameter callback fails with a `TypeError`
that is swallowed and looks like the page simply never answered.
