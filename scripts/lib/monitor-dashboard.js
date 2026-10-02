/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The monitor dashboard, monitor 3.33. The relay serves this HTML from
 * GET /Monitor_Server once the operator has a session; everything the page
 * shows arrives over the same JSON actions the page's buttons use, so the
 * HTML carries no state and no secrets.
 *
 * One page, one sidebar, eight working surfaces: overview, queues, users,
 * relay links, traffic, the machine (docker, backups, GitHub updates),
 * bootstrap, system. The old single-scroll sheet showed the same numbers
 * with none of the hands; this one keeps the numbers and adds them. */

'use strict';

function monitorDashboardHtml({ version, buildTag, monitorVersion, port, presencePort }) {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>P00RIJA Monitor ${monitorVersion}</title>
<style>
:root{
  --bg:#070d1a;--panel:#0d1628;--panel2:#111d33;--line:#1e2f4d;--ink:#dbe7ff;--muted:#7d93b8;
  --accent:#38bdf8;--good:#34d399;--warn:#fbbf24;--bad:#f87171;--violet:#a78bfa;--radius:14px;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(1200px 600px at 85% -10%,#12305533,transparent),var(--bg);color:var(--ink);
  font-family:Vazirmatn,Tahoma,'Segoe UI',sans-serif;font-size:14px;min-height:100vh}
a{color:var(--accent)}
.shell{display:grid;grid-template-columns:238px 1fr;min-height:100vh}
/* sidebar */
.side{background:linear-gradient(180deg,#0b1424,#0a1220);border-inline-end:1px solid var(--line);
  padding:18px 12px;display:flex;flex-direction:column;gap:4px;position:sticky;top:0;height:100vh;overflow:auto}
.brand{display:flex;align-items:center;gap:10px;padding:6px 8px 14px}
.brand .logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#0ea5e9,#6366f1);
  display:grid;place-items:center;font-weight:800;font-size:16px;color:#fff}
.brand b{font-size:14px}
.brand span{display:block;color:var(--muted);font-size:11px;margin-top:2px}
.nav{display:flex;flex-direction:column;gap:2px}
.nav button{all:unset;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;
  color:var(--muted);cursor:pointer;font:inherit;font-size:13.5px;transition:.15s}
.nav button i{width:18px;text-align:center;font-size:14px}
.nav button:hover{background:#ffffff0a;color:var(--ink)}
.nav button.on{background:linear-gradient(90deg,#38bdf81f,#38bdf80a);color:#bfe3ff;box-shadow:inset 2px 0 0 var(--accent)}
.side .foot{margin-top:auto;padding:10px 8px;color:var(--muted);font-size:11px;line-height:1.8;border-top:1px solid var(--line)}
/* main */
.main{padding:20px 22px;display:flex;flex-direction:column;gap:16px;min-width:0}
.topbar{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.topbar h1{font-size:17px;font-weight:800}
.pill{padding:5px 12px;border-radius:999px;font-size:11.5px;border:1px solid var(--line);color:var(--muted);display:inline-flex;gap:6px;align-items:center}
.pill .dot{width:8px;height:8px;border-radius:50%;background:var(--bad);box-shadow:0 0 8px currentColor}
.pill.live .dot{background:var(--good)}
.topbar .grow{flex:1}
.btn{border:1px solid var(--line);background:var(--panel2);color:var(--ink);padding:7px 14px;border-radius:10px;
  cursor:pointer;font:inherit;font-size:12.5px;display:inline-flex;gap:7px;align-items:center;transition:.15s}
.btn:hover{border-color:#38bdf880;background:#16233d}
.btn.acc{background:linear-gradient(135deg,#0ea5e9,#2563eb);border:0;color:#fff;font-weight:700}
.btn.warn{border-color:#fbbf2455;color:var(--warn)}
.btn.bad{border-color:#f8717155;color:var(--bad)}
.btn:disabled{opacity:.4;cursor:default}
select,input[type=text],input[type=password],input[type=number]{background:var(--panel2);border:1px solid var(--line);
  color:var(--ink);border-radius:10px;padding:7px 10px;font:inherit;font-size:12.5px}
/* cards */
.grid{display:grid;gap:14px}
.cards{grid-template-columns:repeat(auto-fit,minmax(168px,1fr))}
.card{background:linear-gradient(180deg,var(--panel),#0c1424);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px;min-width:0}
.card h3{font-size:11.5px;color:var(--muted);font-weight:600;margin-bottom:8px;display:flex;gap:8px;align-items:center}
.card h3 i{color:var(--accent)}
.big{font-size:22px;font-weight:800;letter-spacing:.3px}
.sub{color:var(--muted);font-size:11px;margin-top:4px}
.bar{height:6px;background:#ffffff10;border-radius:99px;margin-top:10px;overflow:hidden}
.bar>div{height:100%;border-radius:99px;background:linear-gradient(90deg,var(--accent),var(--violet));transition:width .4s}
.bar.warn>div{background:linear-gradient(90deg,var(--warn),#f97316)}
.two{grid-template-columns:1fr 1fr}
.three{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
canvas{width:100%;height:150px;display:block}
/* tabs & tables */
.tab{display:none;flex-direction:column;gap:14px}
.tab.on{display:flex}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{color:var(--muted);text-align:start;font-weight:600;font-size:11px;padding:8px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid #16233d55;white-space:nowrap;vertical-align:middle}
tr:hover td{background:#ffffff06}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;direction:ltr;display:inline-block}
.tag{padding:2px 9px;border-radius:99px;font-size:10.5px;border:1px solid}
.tag.good{color:var(--good);border-color:#34d39944;background:#34d39910}
.tag.bad{color:var(--bad);border-color:#f8717144;background:#f8717110}
.tag.mut{color:var(--muted);border-color:#7d93b844}
.tag.warnc{color:var(--warn);border-color:#fbbf2444;background:#fbbf2410}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.empty{color:var(--muted);text-align:center;padding:22px 0;font-size:12px}
.hint{color:var(--muted);font-size:11.5px;line-height:1.9}
.hint b{color:var(--ink)}
pre.logs{background:#050a14;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:11px;
  max-height:300px;overflow:auto;direction:ltr;text-align:left;white-space:pre-wrap;word-break:break-all;color:#9fb6d8}
.toast{position:fixed;bottom:18px;inset-inline-start:18px;background:var(--panel2);border:1px solid var(--line);
  border-radius:12px;padding:11px 16px;font-size:12.5px;z-index:99;box-shadow:0 12px 40px #0009;display:none}
.toast.show{display:block}
.toast.ok{border-color:#34d39966}.toast.err{border-color:#f8717166}
/* modal */
.modal{position:fixed;inset:0;background:#02060fb0;display:none;place-items:center;z-index:50;padding:16px}
.modal.on{display:grid}
.modal .box{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:20px;width:min(420px,92vw);display:flex;flex-direction:column;gap:12px}
.modal h3{font-size:15px}
.modal label{font-size:11.5px;color:var(--muted);display:block;margin-bottom:5px}
.modal input{width:100%}
@media(max-width:900px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;align-items:center;overflow-x:auto;padding:10px}
  .brand{padding:0 8px}.brand span,.side .foot{display:none}
  .nav{flex-direction:row}
  .nav button{padding:8px 10px}
  .main{padding:14px}
  .two{grid-template-columns:1fr}
}
</style>
</head>
<body>
<div class="shell">
  <aside class="side">
    <div class="brand">
      <div class="logo">P</div>
      <div><b>Monitor ${monitorVersion}</b><span>P00RIJA · relay ${version} · ${buildTag}</span></div>
    </div>
    <nav class="nav" id="nav">
      <button data-tab="over" class="on"><i class="fas fa-gauge-high"></i><span data-t>نمای کلی</span></button>
      <button data-tab="queues"><i class="fas fa-envelopes"></i><span data-t>صف‌های پیام</span></button>
      <button data-tab="users"><i class="fas fa-users"></i><span data-t>کاربران</span></button>
      <button data-tab="relays"><i class="fas fa-diagram-project"></i><span data-t>رله‌ها</span></button>
      <button data-tab="traffic"><i class="fas fa-chart-line"></i><span data-t>ترافیک</span></button>
      <button data-tab="machine"><i class="fas fa-server"></i><span data-t>سرور و بکاپ</span></button>
      <button data-tab="bootstrap"><i class="fas fa-rocket"></i><span data-t>نصب خام</span></button>
      <button data-tab="system"><i class="fas fa-gears"></i><span data-t>سیستم</span></button>
    </nav>
    <div class="foot">
      <div id="footPorts">relay :${port} · presence :${presencePort}</div>
      <div>Monitor ${monitorVersion} — از نسخهٔ برنامه جدا</div>
    </div>
  </aside>
  <main class="main">
    <div class="topbar">
      <h1 id="tabTitle">نمای کلی</h1>
      <span class="pill" id="statusPill"><span class="dot"></span><span id="statusText">…</span></span>
      <div class="grow"></div>
      <select id="langSel"><option value="fa">فارسی</option><option value="en">English</option></select>
      <button class="btn" id="refreshNow"><i class="fas fa-rotate"></i><span data-t>نوسازی</span></button>
      <button class="btn bad" id="logoutBtn"><i class="fas fa-power-off"></i><span data-t>خروج</span></button>
    </div>

    <!-- ============ overview ============ -->
    <section class="tab on" data-tab="over">
      <div class="grid cards" id="statCards"></div>
      <div class="grid three">
        <div class="card"><h3><i class="fas fa-users"></i><span data-t>کاربران متصل</span></h3><canvas id="chPeers"></canvas></div>
        <div class="card"><h3><i class="fas fa-microchip"></i><span data-t>پردازنده و حافظه</span></h3><canvas id="chCpu"></canvas></div>
        <div class="card"><h3><i class="fas fa-envelopes"></i><span data-t>پیام‌های در صف</span></h3><canvas id="chQueue"></canvas></div>
      </div>
      <div class="card">
        <h3><i class="fas fa-heart-pulse"></i><span data-t>سلامت رله</span></h3>
        <div class="grid three" id="relayHealth" style="gap:10px"></div>
      </div>
    </section>

    <!-- ============ queues ============ -->
    <section class="tab" data-tab="queues">
      <div class="card">
        <h3><i class="fas fa-envelopes"></i><span data-t>میل‌باکس‌های آفلاین — پیام‌های نگه‌داشته برای گیرندگان</span></h3>
        <div class="row" style="margin-bottom:10px">
          <button class="btn acc" id="qFlush"><i class="fas fa-bolt"></i><span data-t>تحویل فوری به متصل‌ها</span></button>
          <button class="btn warn" id="qClearAll"><i class="fas fa-trash-can"></i><span data-t>پاک‌کردن کل صف آفلاین</span></button>
          <span class="hint" id="qSummary"></span>
        </div>
        <div style="overflow:auto"><table id="qTable"><thead><tr>
          <th data-t>گیرنده</th><th data-t>تعداد</th><th data-t>حجم</th><th data-t>قدیمی‌ترین</th><th data-t>جدیدترین</th><th></th>
        </tr></thead><tbody></tbody></table></div>
      </div>
      <div class="card" id="qDetailCard" style="display:none">
        <h3><i class="fas fa-magnifying-glass"></i><span id="qDetailTitle"></span></h3>
        <div style="overflow:auto"><table id="qDetailTable"><thead><tr>
          <th>#</th><th data-t>شناسه</th><th data-t>فرستنده</th><th data-t>نوع</th><th data-t>حجم</th><th data-t>زمان</th><th></th>
        </tr></thead><tbody></tbody></table></div>
      </div>
    </section>

    <!-- ============ users ============ -->
    <section class="tab" data-tab="users">
      <div class="card">
        <h3><i class="fas fa-users"></i><span data-t>کاربران متصل</span> <span class="tag mut" id="uCount"></span></h3>
        <div style="overflow:auto"><table id="uTable"><thead><tr>
          <th data-t>نام</th><th data-t>شناسه</th><th>IP</th><th data-t>اتصال از</th><th data-t>آخرین فعالیت</th><th data-t>عملیات</th>
        </tr></thead><tbody></tbody></table></div>
      </div>
      <div class="grid two">
        <div class="card"><h3><i class="fas fa-pause"></i><span data-t>معلق‌شده‌ها</span></h3><table id="suspTable"><tbody></tbody></table></div>
        <div class="card"><h3><i class="fas fa-ban"></i><span data-t>اخراجی‌ها</span></h3><table id="kickTable"><tbody></tbody></table></div>
      </div>
      <div class="card">
        <h3><i class="fas fa-list-check"></i><span data-t>اجازه‌نامه (Allowlist)</span></h3>
        <div class="row" style="margin-bottom:10px">
          <button class="btn" id="alToggle"><i class="fas fa-shield-halved"></i><span></span></button>
          <input type="text" id="alFp" placeholder="AB64… (64 hex)" style="direction:ltr;min-width:240px">
          <input type="text" id="alLabel" data-p="برچسب">
          <button class="btn acc" id="alAdd"><i class="fas fa-plus"></i><span data-t>افزودن</span></button>
        </div>
        <table id="alTable"><tbody></tbody></table>
      </div>
      <div class="card">
        <h3><i class="fas fa-bullhorn"></i><span data-t>پیام همگانی</span></h3>
        <div class="row" style="margin-bottom:8px">
          <input type="text" id="bcTarget" placeholder="clientId (خالی = همه)" style="direction:ltr;min-width:200px">
        </div>
        <div class="row">
          <input type="text" id="bcMsg" data-p="متن پیام" style="flex:1;min-width:200px">
          <button class="btn acc" id="bcSend"><i class="fas fa-paper-plane"></i><span data-t>ارسال</span></button>
        </div>
      </div>
    </section>

    <!-- ============ relays ============ -->
    <section class="tab" data-tab="relays">
      <div class="card">
        <h3><i class="fas fa-diagram-project"></i><span data-t>رله‌های همکار (Transit)</span> <span class="tag mut" id="tStatus"></span></h3>
        <div class="hint" style="margin-bottom:10px">
          <span data-t>هر رله با شناسهٔ ۶۴ حرفی‌اش (hash کلیدش) شناخته می‌شود؛ origin نشانی‌ای است که از آن شماره می‌گیریم — خالی یعنی فقط پاسخ‌گو. تغییرات بی‌درنگ اعمال می‌شوند و بعد از ری‌استارت می‌مانند.</span>
        </div>
        <div class="row" style="margin-bottom:12px">
          <input type="text" id="tId" placeholder="64-hex relay id" style="direction:ltr;min-width:340px">
          <input type="text" id="tOrigin" placeholder="https://relay.example.com:8585" style="direction:ltr;min-width:240px">
          <button class="btn acc" id="tAdd"><i class="fas fa-link"></i><span data-t>افزودن / اصلاح</span></button>
        </div>
        <div style="overflow:auto"><table id="tTable"><thead><tr>
          <th data-t>شناسه</th><th>Origin</th><th data-t>وضعیت</th><th data-t>نقش</th><th data-t>حمل‌شده</th><th data-t>حجم</th><th></th>
        </tr></thead><tbody></tbody></table></div>
      </div>
    </section>

    <!-- ============ traffic ============ -->
    <section class="tab" data-tab="traffic">
      <div class="grid cards" id="trCards"></div>
      <div class="grid two">
        <div class="card"><h3><i class="fas fa-user-clock"></i><span data-t>پرمصرف‌ترین کاربران</span></h3>
          <div style="overflow:auto"><table id="trClients"><thead><tr>
            <th data-t>کاربر</th><th>clientId</th><th data-t>دریافتی</th><th data-t>ارسالی</th><th data-t>حجم</th><th data-t>آخرین</th>
          </tr></thead><tbody></tbody></table></div>
        </div>
        <div class="card"><h3><i class="fas fa-network-wired"></i><span data-t>ترافیک بین رله‌ها</span></h3>
          <div style="overflow:auto"><table id="trRelays"><thead><tr>
            <th data-t>رله</th><th data-t>پاکت حمل‌شده</th><th data-t>حجم</th><th data-t>آخرین</th>
          </tr></thead><tbody></tbody></table></div>
        </div>
      </div>
    </section>

    <!-- ============ machine ============ -->
    <section class="tab" data-tab="machine">
      <div class="card">
        <h3><i class="fas fa-database"></i><span data-t>بکاپ‌های کامل سرور</span></h3>
        <div class="hint" style="margin-bottom:10px"><span data-t>هر بکاپ همهٔ درخت نصب را به‌جز داده‌های زندهٔ همین ماشین (data، .env، certs) برمی‌دارد و برای انتقال به سرور دیگر است. ری‌استور به‌صورت overlay است و قبلش خودش یک بکاپ ایمنی می‌گیرد (همان رول‌بک).</span></div>
        <div class="row" style="margin-bottom:10px">
          <button class="btn acc" id="bkMake"><i class="fas fa-box-archive"></i><span data-t>ساخت بکاپ</span></button>
          <span class="hint" id="bkNote"></span>
        </div>
        <div style="overflow:auto"><table id="bkTable"><thead><tr>
          <th data-t>نام</th><th data-t>حجم</th><th></th><th></th><th></th>
        </tr></thead><tbody></tbody></table></div>
      </div>
      <div class="card">
        <h3><i class="fab fa-docker"></i><span data-t>ایمیج‌های داکر</span></h3>
        <div class="hint" style="margin:6px 0 10px"><span data-t>«بررسی و آپدیت» همان تگ را دوباره می‌گیرد؛ اگر رجیستری نسخهٔ تازه‌تری داشته باشد دانلود می‌شود و پیام می‌گوید. اجرای نسخهٔ جدید نیازمند ری‌استارت استک است.</span></div>
        <div class="row" style="margin-bottom:10px">
          <button class="btn" id="imRefresh"><i class="fas fa-rotate"></i><span data-t>بازخوانی</span></button>
          <button class="btn acc" id="stackRestart"><i class="fas fa-arrows-rotate"></i><span data-t>ری‌استارت استک</span></button>
          <button class="btn" id="imgExport"><i class="fas fa-file-export"></i><span data-t>خروجی خام ایمیج رله</span></button>
        </div>
        <div style="overflow:auto"><table id="imTable"><thead><tr>
          <th data-t>ایمیج</th><th>Tag</th><th>ID</th><th data-t>حجم</th><th data-t>ساخته‌شده</th><th></th>
        </tr></thead><tbody></tbody></table></div>
      </div>
      <div class="card">
        <h3><i class="fab fa-github"></i><span data-t>به‌روزرسانی از گیت‌هاب</span></h3>
        <div class="row" style="margin-bottom:8px">
          <button class="btn" id="ghCheck"><i class="fas fa-cloud-arrow-down"></i><span data-t>بررسی نسخهٔ جدید</span></button>
          <button class="btn acc" id="ghApply"><i class="fas fa-download"></i><span data-t>دانلود و اعمال آخرین ریلیز</span></button>
          <button class="btn warn" id="ghRollback"><i class="fas fa-clock-rotate-left"></i><span data-t>رول‌بک (آخرین بکاپ)</span></button>
        </div>
        <div class="hint" id="ghInfo">…</div>
      </div>
    </section>

    <!-- ============ bootstrap ============ -->
    <section class="tab" data-tab="bootstrap">
      <div class="card">
        <h3><i class="fas fa-rocket"></i><span data-t>نصب نسخهٔ خام روی سرور دیگر</span></h3>
        <div class="hint" style="line-height:2">
          <span data-t>روی سرور مقصد، همین یک خط را اجرا کنید؛ بستهٔ خام (برنامهٔ کامل، بدون هیچ داده، هویت یا رازی از این سرور) دانلود و استک با هویت تازه بالا می‌آید. توکن مخصوص این کارست و از داشبورد می‌چرخانیدش.</span>
        </div>
        <div class="row" style="margin:12px 0">
          <button class="btn acc" id="bsShow"><i class="fas fa-key"></i><span data-t>نمایش / ساخت توکن</span></button>
        </div>
        <pre class="logs" id="bsCommand" style="display:none"></pre>
      </div>
    </section>

    <!-- ============ system ============ -->
    <section class="tab" data-tab="system">
      <div class="grid cards" id="sysCards"></div>
      <div class="card">
        <h3><i class="fas fa-key"></i><span data-t>تغییر رمز مانیتور</span></h3>
        <div class="row">
          <input type="password" id="pwOld" data-p="رمز فعلی">
          <input type="password" id="pwNew" data-p="رمز جدید (≥۱۲ نویسه)">
          <input type="password" id="pwNew2" data-p="تکرار رمز جدید">
          <button class="btn acc" id="pwSave"><i class="fas fa-check"></i><span data-t="1">تغییر</span></button>
        </div>
      </div>
      <div class="card">
        <h3><i class="fas fa-terminal"></i><span data-t>گزارش‌های زنده</span></h3>
        <pre class="logs" id="logs"></pre>
      </div>
    </section>
  </main>
</div>

<div class="toast" id="toast"></div>
<div class="modal" id="policyModal"><div class="box">
  <h3 data-t>مدت اعمال</h3>
  <div class="row">
    <label style="flex:1"><span data-t>روز</span><input type="number" id="polDays" value="0" min="0" style="width:100%"></label>
    <label style="flex:1"><span data-t>ساعت</span><input type="number" id="polHours" value="0" min="0" style="width:100%"></label>
    <label style="flex:1"><span data-t>دقیقه</span><input type="number" id="polMins" value="0" min="0" style="width:100%"></label>
  </div>
  <label class="row"><input type="checkbox" id="polPerm"> <span data-t>دائمی</span></label>
  <div class="row" style="justify-content:flex-end">
    <button class="btn" id="polCancel" data-t>انصراف</button>
    <button class="btn acc" id="polOk" data-t>اعمال</button>
  </div>
</div></div>

<link rel="stylesheet" href="/vendor/fontawesome/css/all.min.css">
<script>
/* ---------- i18n ---------- */
const T = {
  fa: { over:'نمای کلی', queues:'صف‌های پیام', users:'کاربران', relays:'رله‌ها', traffic:'ترافیک', machine:'سرور و بکاپ', bootstrap:'نصب خام', system:'سیستم',
    peers:'کاربران متصل', cpu:'پردازنده', ram:'حافظه', disk:'دیسک', queue:'در صف', none:'—', online:'آنلاین', offline:'آفلاین',
    kick:'اخراج', suspend:'تعلیق', resume:'رفع تعلیق', unkick:'لغو اخراج', del:'حذف', restore:'ری‌استور', download:'دانلود',
    empty:'چیزی برای نمایش نیست', linked:'متصل', down:'قطع', dialer:'شماره‌گیر', answerer:'پاسخ‌گو', none2:'—',
    msgsIn:'پیام دریافتی', msgsOut:'پیام ارسالی', bytesIn:'دریافتی', bytesOut:'ارسالی', ok:'انجام شد', fail:'ناموفق',
    confirmClear:'کل صف آفلاین پاک شود؟', confirmRestore:'این بکاپ روی درخت نصب باز شود؟ (ابتدا بکاپ ایمنی گرفته می‌شود)',
    confirmDelete:'حذف شود؟', confirmRestart:'کل استک ری‌استارت شود؟ همهٔ اتصال‌ها لحظه‌ای قطع می‌شوند.' },
  en: { over:'Overview', queues:'Message queues', users:'Users', relays:'Relays', traffic:'Traffic', machine:'Server & backups', bootstrap:'Clean install', system:'System',
    peers:'Connected users', cpu:'CPU', ram:'Memory', disk:'Disk', queue:'Queued', none:'—', online:'online', offline:'offline',
    kick:'Kick', suspend:'Suspend', resume:'Resume', unkick:'Unkick', del:'Delete', restore:'Restore', download:'Download',
    empty:'Nothing to show', linked:'linked', down:'down', dialer:'dialer', answerer:'answerer', none2:'—',
    msgsIn:'Messages in', msgsOut:'Messages out', bytesIn:'Received', bytesOut:'Sent', ok:'Done', fail:'Failed',
    confirmClear:'Drop the ENTIRE offline queue?', confirmRestore:'Restore this backup over the install tree? (a safety snapshot is taken first)',
    confirmDelete:'Delete?', confirmRestart:'Restart the whole stack? Every connection drops for a moment.' },
};
let LANG = localStorage.getItem('monitor_lang_v3') || 'fa';
const t = (k) => (T[LANG] && T[LANG][k]) || T.fa[k] || k;

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
async function api(path, body) {
  const response = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify(body || {}) });
  if (response.status === 401) { location.reload(); throw new Error('unauthorized'); }
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return response;
  return response.json();
}
function toast(text, cls) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast show ' + (cls || '');
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.className = 'toast'; }, 4200);
}
function fmtBytes(n) {
  n = Number(n || 0);
  if (n < 1024) return n + ' B';
  const units = ['KB','MB','GB','TB'];
  let i = -1;
  do { n /= 1024; i += 1; } while (n >= 1024 && i < units.length - 1);
  return n.toFixed(n >= 100 ? 0 : 1) + ' ' + units[i];
}
function fmtTime(iso) { if (!iso) return t('none'); try { return new Date(iso).toLocaleString(LANG === 'fa' ? 'fa-IR' : 'en-GB'); } catch (_e) { return iso; } }
function esc(text) { const d = document.createElement('div'); d.textContent = String(text ?? ''); return d.innerHTML; }
function confirmKey(key) { return confirm(t(key)); }

/* ---------- charts (tiny canvas lines, no libraries) ---------- */
const series = { peers: [], cpu: [], queue: [] };
function drawLine(canvas, data, color) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 150 * devicePixelRatio;
  ctx.clearRect(0, 0, w, h);
  if (data.length < 2) return;
  const max = Math.max(...data, 1);
  const stepX = w / (data.length - 1);
  ctx.beginPath();
  data.forEach((v, i) => { const x = i * stepX; const y = h - 6 - (v / max) * (h - 16); if (!i) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.strokeStyle = color; ctx.lineWidth = 2 * devicePixelRatio; ctx.stroke();
  ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '33'); grad.addColorStop(1, color + '00');
  ctx.fillStyle = grad; ctx.fill();
}

/* ---------- tabs ---------- */
document.querySelectorAll('#nav button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('#nav button').forEach((b) => b.classList.remove('on'));
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('on'));
    button.classList.add('on');
    document.querySelector('.tab[data-tab="' + button.dataset.tab + '"]').classList.add('on');
    $('tabTitle').textContent = t(button.dataset.tab);
    refreshTab(button.dataset.tab);
  });
});
function refreshTab(name) {
  if (name === 'over') loadHealth();
  if (name === 'queues') loadQueues();
  if (name === 'users') loadHealth();
  if (name === 'relays') loadTransit();
  if (name === 'traffic') loadTraffic();
  if (name === 'machine') { loadBackups(); loadImages(); ghCheck(); }
  if (name === 'system') loadHealth();
}

/* ---------- i18n apply ---------- */
function applyLang() {
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG === 'fa' ? 'rtl' : 'ltr';
  $('langSel').value = LANG;
  document.querySelectorAll('[data-t]').forEach((el) => {
    if (el.dataset.t && T[LANG][el.dataset.t] !== undefined) el.textContent = T[LANG][el.dataset.t];
  });
  document.querySelectorAll('[data-p]').forEach((el) => { el.placeholder = el.dataset.p; });
  $('tabTitle').textContent = t(document.querySelector('#nav button.on').dataset.tab);
}
$('langSel').addEventListener('change', (e) => { LANG = e.target.value; localStorage.setItem('monitor_lang_v3', LANG); applyLang(); });

/* ---------- overview + users + system (from /healthz) ---------- */
let lastHealth = null;
async function loadHealth() {
  try {
    const data = await api('/healthz');
    lastHealth = data;
    $('statusPill').classList.add('live');
    $('statusText').textContent = t('online') + ' · ' + fmtTime(new Date().toISOString());
    series.peers.push(data.peers || 0); series.cpu.push(data.cpu?.percent || 0); series.queue.push(data.queuedMessages || 0);
    for (const key of ['peers','cpu','queue']) { series[key] = series[key].slice(-90); }
    drawLine($('chPeers'), series.peers, '#38bdf8');
    drawLine($('chCpu'), series.cpu, '#a78bfa');
    drawLine($('chQueue'), series.queue, '#34d399');

    const memPct = data.memory ? Math.round((data.memory.usedHeap / Math.max(1, data.memory.heap)) * 100) : 0;
    const diskPct = data.storage ? Math.round((data.storage.used / Math.max(1, data.storage.total)) * 100) : 0;
    $('statCards').innerHTML = [
      card('fa-users', t('peers'), data.peers ?? 0, (data.capacity?.sockets?.inUse ?? '—') + ' / ' + (data.capacity?.sockets?.max ?? '—') + ' sockets'),
      card('fa-microchip', t('cpu'), Math.round(data.cpu?.percent || 0) + '%', bar(Math.round(data.cpu?.percent || 0), data.cpu?.percent > 80)),
      card('fa-memory', t('ram'), fmtBytes(data.memory?.usedHeap), t('cpu') + ' ' + memPct + '%' + bar(memPct, memPct > 85), true),
      card('fa-hard-drive', t('disk'), diskPct + '%', fmtBytes(data.storage?.used) + ' / ' + fmtBytes(data.storage?.total) + bar(diskPct, diskPct > 85), true),
      card('fa-envelopes', t('queue'), data.queuedMessages ?? 0, (data.relay?.mailboxes?.count ?? 0) + ' ' + (LANG === 'fa' ? 'میل‌باکس' : 'mailboxes')),
      card('fa-tower-broadcast', 'Transit', (data.relay?.transitText || ((lastHealth.relay?.limits ? '' : '') + ((data.traffic?.relays) || 0))), t('linked') + ': ' + esc(String(JSON.stringify(data.relay?.transit || {})).slice(0,40))),
    ].join('');

    /* users table */
    const rows = (data.peersList || []).map((peer) => {
      const since = fmtTime(peer.connectedAt ? new Date(peer.connectedAt).toISOString() : '');
      return '<tr><td>' + esc(peer.username || peer.peerId || '') + '</td>' +
        '<td class="mono">' + esc((peer.fingerprint || peer.clientId || '').slice(0, 12)) + '</td>' +
        '<td class="mono">' + esc(peer.ip || '') + '</td><td>' + since + '</td><td>' + fmtTime(peer.lastSeenAt ? new Date(peer.lastSeenAt).toISOString() : '') + '</td>' +
        '<td><div class="row">' +
        '<button class="btn warn" data-suspend="' + esc(peer.clientId) + '"><i class="fas fa-pause"></i>' + t('suspend') + '</button>' +
        '<button class="btn bad" data-kick="' + esc(peer.clientId) + '"><i class="fas fa-ban"></i>' + t('kick') + '</button>' +
        '</div></td></tr>';
    });
    $('uTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="empty">' + t('empty') + '</td></tr>';
    $('uCount').textContent = (data.peersList || []).length;

    /* suspended / kicked */
    $('suspTable').querySelector('tbody').innerHTML = (data.suspendedUsers || []).map(suspRow).join('') || '<tr><td class="empty">' + t('empty') + '</td></tr>';
    $('kickTable').querySelector('tbody').innerHTML = (data.kickedUsers || []).map(kickRow).join('') || '<tr><td class="empty">' + t('empty') + '</td></tr>';

    /* relay health */
    const relay = data.relay || {};
    $('relayHealth').innerHTML = [
      '<div class="hint"><b>limits</b><br>' + esc(JSON.stringify(relay.limits || {})) + '</div>',
      '<div class="hint"><b>mailboxes</b><br>' + esc(JSON.stringify(relay.mailboxes || {})) + '</div>',
      '<div class="hint"><b>discarded</b><br>' + esc(JSON.stringify(relay.discarded?.summary || {})) + '</div>',
    ].join('');

    /* system cards + logs */
    $('sysCards').innerHTML = [
      card('fa-server', 'Node', esc(data.node || ''), esc(data.platform || '')),
      card('fa-clock', LANG === 'fa' ? 'به‌روز بودن' : 'Uptime', Math.round((data.uptime || 0) / 60) + ' min', ''),
      card('fa-tower-cell', 'TURN', data.turnEnabled ? '<span class="tag good">on</span>' : '<span class="tag bad">off</span>', ''),
      card('fa-fingerprint', 'Relay ID', '<span class="mono">' + esc(String(data.relayId || '').slice(0, 16)) + '</span>', ''),
    ].join('');
    $('logs').textContent = (data.logs || []).slice(-140).join('\\n');
  } catch (error) {
    $('statusPill').classList.remove('live');
    $('statusText').textContent = t('offline');
  }
}
function card(icon, title, big, extra, isHtml) {
  return '<div class="card"><h3><i class="fas ' + icon + '"></i>' + title + '</h3>' +
    '<div class="big">' + (isHtml ? big : esc(big)) + '</div><div class="sub">' + (isHtml ? extra : esc(extra)) + '</div></div>';
}
function bar(pct, warn) { return '<div class="bar' + (warn ? ' warn' : '') + '"><div style="width:' + Math.min(100, pct) + '%"></div></div>'; }
function suspRow(entry) {
  const key = entry.fingerprint || entry.clientId || entry.key || '';
  return '<tr><td class="mono">' + esc(String(key).slice(0, 12)) + '</td><td>' +
    '<button class="btn" data-resume="' + esc(key) + '"><i class="fas fa-play"></i>' + t('resume') + '</button></td></tr>';
}
function kickRow(entry) {
  const key = entry.fingerprint || entry.clientId || entry.key || '';
  return '<tr><td class="mono">' + esc(String(key).slice(0, 12)) + '</td><td>' +
    '<button class="btn" data-unkick="' + esc(key) + '"><i class="fas fa-undo"></i>' + t('unkick') + '</button></td></tr>';
}

/* ---------- queues ---------- */
async function loadQueues() {
  const data = await api('/Monitor_Server/queues');
  $('qSummary').textContent = t('queue') + ': ' + (data.totals?.queued ?? 0) + ' · ' + fmtBytes(data.totals?.bytes) +
    ' · held: ' + (data.heldForConnected ?? 0) + ' · transit-waiting: ' + (data.transitWaiting ?? 0);
  const rows = (data.mailboxes || []).map((box) => {
    return '<tr><td><a href="#" data-open-mailbox="' + esc(box.fingerprint) + '" class="mono">' + esc(box.fingerprint) + '</a></td>' +
      '<td>' + box.count + '</td><td>' + fmtBytes(box.bytes) + '</td><td>' + fmtTime(box.oldestAt) + '</td><td>' + fmtTime(box.newestAt) + '</td>' +
      '<td><button class="btn bad" data-drop-mailbox="' + esc(box.fingerprint) + '"><i class="fas fa-trash-can"></i>' + t('del') + '</button></td></tr>';
  });
  $('qTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="empty">' + t('empty') + '</td></tr>';
}
$('qTable').addEventListener('click', async (event) => {
  const open = event.target.closest('[data-open-mailbox]');
  if (open) { event.preventDefault(); openMailbox(open.getAttribute('data-open-mailbox')); return; }
  const drop = event.target.closest('[data-drop-mailbox]');
  if (drop && confirmKey('confirmDelete')) {
    await api('/Monitor_Server/queue-drop', { fingerprint: drop.getAttribute('data-drop-mailbox') });
    loadQueues();
  }
});
async function openMailbox(prefix) {
  const data = await api('/Monitor_Server/queue-mailbox', { fingerprint: prefix });
  $('qDetailCard').style.display = '';
  $('qDetailTitle').textContent = t('queues') + ' → ' + data.fingerprint;
  $('qDetailTable').querySelector('tbody').innerHTML = (data.items || []).map((item) =>
    '<tr><td>' + item.index + '</td><td class="mono">' + esc(item.id) + '</td><td class="mono">' + esc(item.from) + '</td>' +
    '<td><span class="tag mut">' + esc(item.type) + '</span></td><td>' + fmtBytes(item.size) + '</td><td>' + fmtTime(item.queuedAt) + '</td>' +
    '<td><button class="btn bad" data-drop-item="' + item.index + '" data-fp="' + esc(data.fingerprint) + '">✕</button></td></tr>'
  ).join('') || '<tr><td colspan="7" class="empty">' + t('empty') + '</td></tr>';
}
$('qDetailTable').addEventListener('click', async (event) => {
  const drop = event.target.closest('[data-drop-item]');
  if (!drop) return;
  await api('/Monitor_Server/queue-drop', { fingerprint: drop.getAttribute('data-fp'), index: Number(drop.getAttribute('data-drop-item')) });
  openMailbox(drop.getAttribute('data-fp'));
});
$('qFlush').addEventListener('click', async () => { const r = await api('/Monitor_Server/queue-flush'); toast(t('ok') + ': ' + (r.pumped ?? 0), 'ok'); });
$('qClearAll').addEventListener('click', async () => {
  if (!confirmKey('confirmClear')) return;
  await api('/admin/clear-offline');
  loadQueues();
});

/* ---------- users actions ---------- */
let policyTarget = null;
$('uTable').addEventListener('click', (event) => {
  const kick = event.target.closest('[data-kick]');
  const suspend = event.target.closest('[data-suspend]');
  if (!kick && !suspend) return;
  policyTarget = { id: (kick || suspend).getAttribute(kick ? 'data-kick' : 'data-suspend'), action: kick ? 'kick' : 'suspend' };
  $('policyModal').classList.add('on');
});
$('polCancel').addEventListener('click', () => $('policyModal').classList.remove('on'));
$('polOk').addEventListener('click', async () => {
  $('policyModal').classList.remove('on');
  const body = {
    clientId: policyTarget.id,
    days: Number($('polDays').value || 0), hours: Number($('polHours').value || 0), minutes: Number($('polMins').value || 0),
    permanent: $('polPerm').checked,
  };
  const result = await api('/admin/' + (policyTarget.action === 'kick' ? 'kick-peer' : 'suspend-peer'), body);
  toast(result.ok ? t('ok') : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  loadHealth();
});
$('suspTable').addEventListener('click', async (event) => {
  const resume = event.target.closest('[data-resume]');
  if (!resume) return;
  await api('/admin/resume-peer', { fingerprint: resume.getAttribute('data-resume') });
  loadHealth();
});
$('kickTable').addEventListener('click', async (event) => {
  const unkick = event.target.closest('[data-unkick]');
  if (!unkick) return;
  await api('/admin/unkick-peer', { fingerprint: unkick.getAttribute('data-unkick') });
  loadHealth();
});

/* allowlist */
async function loadAllowlist() {
  const data = await api('/admin/allowlist');
  $('alToggle').querySelector('span').textContent = (data.allowlistEnabled ? 'ON' : 'OFF');
  $('alTable').querySelector('tbody').innerHTML = (data.allowedUsers || []).map((entry) => {
    const fp = entry.fingerprint || entry;
    const label = entry.label || '';
    return '<tr><td class="mono">' + esc(String(fp).slice(0, 20)) + '…</td><td>' + esc(label) + '</td>' +
      '<td><button class="btn bad" data-al-remove="' + esc(fp) + '">✕</button></td></tr>';
  }).join('') || '<tr><td class="empty">' + t('empty') + '</td></tr>';
}
$('alToggle').addEventListener('click', async () => { await api('/admin/allowlist-mode'); loadAllowlist(); });
$('alAdd').addEventListener('click', async () => {
  const result = await api('/admin/allowlist-add', { fingerprint: $('alFp').value.trim(), label: $('alLabel').value.trim() });
  toast(result.ok ? t('ok') : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  if (result.ok) { $('alFp').value = ''; $('alLabel').value = ''; }
  loadAllowlist();
});
$('alTable').addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-al-remove]');
  if (!remove) return;
  await api('/admin/allowlist-remove', { fingerprint: remove.getAttribute('data-al-remove') });
  loadAllowlist();
});

/* broadcast */
$('bcSend').addEventListener('click', async () => {
  const result = await api('/admin/broadcast', { message: $('bcMsg').value, clientId: $('bcTarget').value.trim() || undefined });
  toast(result.ok ? t('ok') : t('fail'), result.ok ? 'ok' : 'err');
});

/* ---------- relays ---------- */
async function loadTransit() {
  const data = await api('/Monitor_Server/transit');
  const status = data.status || {};
  $('tStatus').textContent = 'allowed: ' + (status.allowed ?? 0) + ' · up: ' + (status.up ?? 0);
  const rows = (data.peers || []).map((peer) =>
    '<tr><td class="mono">' + esc(peer.id) + '…</td><td class="mono">' + esc(peer.origin || t('none2')) + '</td>' +
    '<td>' + (peer.linked ? '<span class="tag good">' + t('linked') + '</span>' : '<span class="tag bad">' + t('down') + '</span>') + '</td>' +
    '<td><span class="tag mut">' + t(peer.role === 'dialer' ? 'dialer' : peer.role === 'answerer' ? 'answerer' : 'none2') + '</span></td>' +
    '<td>' + (peer.traffic?.carried ?? 0) + '</td><td>' + fmtBytes(peer.traffic?.bytes) + '</td>' +
    '<td><button class="btn bad" data-t-remove="' + esc(peer.id) + '"><i class="fas fa-unlink"></i></button></td></tr>'
  );
  $('tTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="7" class="empty">' + t('empty') + '</td></tr>';
}
$('tAdd').addEventListener('click', async () => {
  const result = await api('/Monitor_Server/transit-add', { id: $('tId').value.trim(), origin: $('tOrigin').value.trim() });
  toast(result.ok ? t('ok') : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  if (result.ok) { $('tId').value = ''; $('tOrigin').value = ''; }
  loadTransit();
});
$('tTable').addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-t-remove]');
  if (!remove || !confirmKey('confirmDelete')) return;
  await api('/Monitor_Server/transit-remove', { id: remove.getAttribute('data-t-remove') });
  loadTransit();
});

/* ---------- traffic ---------- */
async function loadTraffic() {
  const data = await api('/Monitor_Server/traffic');
  $('trCards').innerHTML = [
    card('fa-inbox', t('msgsIn'), data.totals?.msgsIn ?? 0, fmtBytes(data.totals?.bytesIn)),
    card('fa-paper-plane', t('msgsOut'), data.totals?.msgsOut ?? 0, fmtBytes(data.totals?.bytesOut)),
    card('fa-tower-broadcast', 'Relayed', data.totals?.relays ?? 0, ''),
  ].join('');
  $('trClients').querySelector('tbody').innerHTML = (data.clients || []).map((row) =>
    '<tr><td>' + esc(row.label || '—') + '</td><td class="mono">' + esc(row.clientId) + '</td>' +
    '<td>' + row.msgsIn + '</td><td>' + row.msgsOut + '</td><td>' + fmtBytes(row.bytesIn + row.bytesOut) + '</td><td>' + fmtTime(row.lastAt) + '</td></tr>'
  ).join('') || '<tr><td colspan="6" class="empty">' + t('empty') + '</td></tr>';
  $('trRelays').querySelector('tbody').innerHTML = (data.relays || []).map((row) =>
    '<tr><td class="mono">' + esc(row.relayId) + '…</td><td>' + row.carried + '</td><td>' + fmtBytes(row.bytes) + '</td><td>' + fmtTime(row.lastAt) + '</td></tr>'
  ).join('') || '<tr><td colspan="4" class="empty">' + t('empty') + '</td></tr>';
}

/* ---------- machine: backups / images / github ---------- */
async function loadBackups() {
  const data = await api('/Monitor_Server/ops-backup-list');
  $('bkNote').textContent = data.reason ? String(data.reason) : '';
  const rows = (data.backups || []).map((row) =>
    '<tr><td class="mono">' + esc(row.name) + '</td><td>' + esc(row.size) + '</td>' +
    '<td><button class="btn" data-bk-get="' + esc(row.name) + '"><i class="fas fa-download"></i></button></td>' +
    '<td><button class="btn warn" data-bk-restore="' + esc(row.name) + '">' + t('restore') + '</button></td>' +
    '<td><button class="btn bad" data-bk-del="' + esc(row.name) + '">✕</button></td></tr>'
  );
  $('bkTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="5" class="empty">' + t('empty') + '</td></tr>';
}
$('bkMake').addEventListener('click', async (event) => {
  event.target.disabled = true;
  const result = await api('/Monitor_Server/ops-backup-create');
  event.target.disabled = false;
  toast(result.ok ? t('ok') + ': ' + result.name : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  loadBackups();
});
$('bkTable').addEventListener('click', async (event) => {
  const get = event.target.closest('[data-bk-get]');
  const restore = event.target.closest('[data-bk-restore]');
  const del = event.target.closest('[data-bk-del]');
  if (get) { window.open('', '_blank'); await downloadPost('/Monitor_Server/ops-backup-download', { name: get.getAttribute('data-bk-get') }); return; }
  if (restore && confirmKey('confirmRestore')) {
    const result = await api('/Monitor_Server/ops-backup-restore', { name: restore.getAttribute('data-bk-restore') });
    toast(result.ok ? t('ok') + ' — ' + (result.note || '') : t('fail'), result.ok ? 'ok' : 'err');
    return;
  }
  if (del && confirmKey('confirmDelete')) {
    await api('/Monitor_Server/ops-backup-delete', { name: del.getAttribute('data-bk-del') });
    loadBackups();
  }
});
async function downloadPost(path, body) {
  const response = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body: JSON.stringify(body) });
  if (!response.ok) { toast(t('fail'), 'err'); return; }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = (body && body.name) || 'download';
  link.click();
  URL.revokeObjectURL(url);
}

async function loadImages() {
  const data = await api('/Monitor_Server/ops-images');
  if (!data.ok) { $('imTable').querySelector('tbody').innerHTML = '<tr><td colspan="6" class="empty">' + esc(data.reason || '') + '</td></tr>'; return; }
  const rows = (data.images || []).slice(0, 30).map((image) => {
    const watched = /^(node|docker|coturn\/coturn|nginx|certbot\/certbot)/.test(image.repository);
    return '<tr><td class="mono">' + esc(image.repository) + (watched ? ' <span class="tag good">stack</span>' : '') + '</td>' +
      '<td>' + esc(image.tag) + '</td><td class="mono">' + esc(image.id) + '</td><td>' + fmtBytes(image.size) + '</td><td>' + fmtTime(image.created) + '</td>' +
      '<td>' + (watched ? '<button class="btn" data-im-update="' + esc(image.repository + ':' + image.tag) + '"><i class="fas fa-arrows-rotate"></i> ' + (LANG === 'fa' ? 'بررسی/آپدیت' : 'check') + '</button>' : '') + '</td></tr>';
  });
  $('imTable').querySelector('tbody').innerHTML = rows.join('') || '<tr><td colspan="6" class="empty">' + t('empty') + '</td></tr>';
}
$('imRefresh').addEventListener('click', loadImages);
$('imTable').addEventListener('click', async (event) => {
  const update = event.target.closest('[data-im-update]');
  if (!update) return;
  update.disabled = true;
  const result = await api('/Monitor_Server/ops-image-update', { reference: update.getAttribute('data-im-update') });
  update.disabled = false;
  toast(result.changed ? (LANG === 'fa' ? 'پایه به‌روز شد؛ استک را ری‌استارت کنید' : 'base updated; restart the stack') : (result.note || t('fail')), result.ok ? 'ok' : 'err');
});
$('stackRestart').addEventListener('click', async () => {
  if (!confirmKey('confirmRestart')) return;
  toast(LANG === 'fa' ? 'در حال ری‌استارت… این صفحه چند لحظه بی‌جواب می‌شود' : 'restarting… this page will hang briefly');
  await api('/Monitor_Server/ops-stack-restart');
  toast(t('ok'), 'ok');
});
$('imgExport').addEventListener('click', () => downloadPost('/Monitor_Server/ops-image-export', {}));

async function ghCheck() {
  const data = await api('/Monitor_Server/ops-github-check');
  if (!data.reachable) { $('ghInfo').textContent = LANG === 'fa' ? 'گیت‌هاب در دسترس نیست' : 'github unreachable'; return; }
  $('ghInfo').innerHTML = (LANG === 'fa'
    ? 'در حال اجرا: <b>' + esc(data.running?.version || '?') + ' · ' + esc(data.running?.buildTag || '') + '</b> — آخرین ریلیز گیت‌هاب: <b>' + esc(data.latest?.tag || '?') + '</b> (' + fmtTime(data.latest?.published) + ')'
    : 'running: <b>' + esc(data.running?.version || '?') + ' · ' + esc(data.running?.buildTag || '') + '</b> — latest on GitHub: <b>' + esc(data.latest?.tag || '?') + '</b> (' + fmtTime(data.latest?.published) + ')')
    + (data.updateAvailable ? ' — <span class="tag warnc">' + (LANG === 'fa' ? 'نسخهٔ جدید موجود است' : 'update available') + '</span>' : '');
}
$('ghCheck').addEventListener('click', ghCheck);
$('ghApply').addEventListener('click', async (event) => {
  const data = await api('/Monitor_Server/ops-github-check');
  const tag = String(data.latest?.tag || '').replace(/^v/, '');
  if (!tag) { toast(t('fail'), 'err'); return; }
  if (!confirm((LANG === 'fa' ? 'ریلیز ' : 'release ') + tag + (LANG === 'fa' ? ' دانلود و روی سرور اعمال شود؟ (ابتدا بکاپ ایمنی)' : ' download and apply? (safety backup taken first)'))) return;
  event.target.disabled = true;
  const result = await api('/Monitor_Server/ops-github-apply', { tag });
  event.target.disabled = false;
  toast(result.ok ? t('ok') + ' — ' + (result.note || '') : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  if (result.ok) ghCheck();
});
$('ghRollback').addEventListener('click', async () => {
  if (!confirmKey('confirmRestore')) return;
  const result = await api('/Monitor_Server/ops-github-rollback');
  toast(result.ok ? t('ok') + ' — ' + (result.note || '') : t('fail'), result.ok ? 'ok' : 'err');
});

/* ---------- bootstrap ---------- */
$('bsShow').addEventListener('click', async () => {
  const data = await api('/Monitor_Server/bootstrap-token');
  if (!data.ok) { toast(t('fail'), 'err'); return; }
  const origin = location.origin;
  $('bsCommand').style.display = '';
  $('bsCommand').textContent = 'curl -sSL ' + origin.replace(':8585', ':${port}') + '/install | bash -s -- ' + origin.replace(':8585', ':${port}') + ' ' + data.token + ' ~/poorija-cryptography';
});

/* ---------- system ---------- */
$('pwSave').addEventListener('click', async () => {
  if ($('pwNew').value !== $('pwNew2').value) { toast(LANG === 'fa' ? 'رمزها یکی نیستند' : 'passwords differ', 'err'); return; }
  const result = await api('/admin/change-password', { currentPassword: $('pwOld').value, newPassword: $('pwNew').value });
  toast(result.ok ? t('ok') : t('fail') + ' ' + (result.reason || ''), result.ok ? 'ok' : 'err');
  if (result.ok) { $('pwOld').value = ''; $('pwNew').value = ''; $('pwNew2').value = ''; }
});
$('logoutBtn').addEventListener('click', async () => {
  await api('/admin/logout');
  localStorage.removeItem('monitor_token_v2');
  location.replace('/Monitor_Server?logged_out=' + Date.now());
});
$('refreshNow').addEventListener('click', () => refreshTab(document.querySelector('#nav button.on').dataset.tab));

/* ---------- loop ---------- */
applyLang();
loadHealth();
loadAllowlist();
setInterval(() => {
  const current = document.querySelector('#nav button.on').dataset.tab;
  if (current === 'over' || current === 'users' || current === 'system') loadHealth();
}, 10000);
</script>
</body>
</html>`;
}

module.exports = { monitorDashboardHtml };
