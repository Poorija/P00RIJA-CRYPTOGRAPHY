/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The panel's guide and the page about the project: written here, in both
 * languages, nothing fetched. */
import { state, t, esc, card, subtabs } from './ui.js';

/* [icon, title, text] per section, in each language. */
const GUIDE = {
  fa: [
    ['fa-gauge-high', 'نمای کلی', 'وضعیت همهٔ سرورها در یک نگاه: کاشی‌های عددی (سرورهای در دسترس، کاربران آنلاین، تماس‌ها، پیوندها، پیام در دقیقه، پهنای باند، صف) و نمودارهای زندهٔ هر سرور. نمودارها را می‌توانید تک‌سرور، بر اساس خوشه، بر اساس منطقه (داخل/خارج) یا همه با هم ببینید و دسته را انتخاب کنید: منابع (پردازنده، حافظه، دیسک)، ترافیک، کاربران، یا شبکه و صف. بازهٔ زمانی از ۱۵ دقیقه تا ۷ روز است و سرعت تازه‌سازی را می‌توانید ۱، ۳، ۵، ۱۰، ۳۰ یا ۶۰ ثانیه بگذارید؛ با انتخاب «سرور» یک سرور را به‌تنهایی با همهٔ نمودارها و عددهایش می‌بینید. اشاره‌گر را روی نمودار ببرید تا مقدار هر سرور در آن لحظه را ببینید.'],
    ['fa-diagram-project', 'شبکه', 'نقشهٔ خانواده: هر رله یک گره در خوشهٔ خودش، شریک‌ها و پیوندها. گره را بکشید تا جایش بماند؛ روی قاب خوشهٔ دیگری رها کنید تا به آن منتقل شود. می‌توانید فقط یک خوشه، فقط پیوندهای قطع، یا بدون شریک‌ها نمایش دهید، چیدمان را از نو بچینید و نقشه را به JSON بگیرید. زبانه‌های «گره‌ها» و «پیوندها» همین نقشه را به صورت جدول و دسته‌بندی‌شده نشان می‌دهند.'],
    ['fa-server', 'سرورها', 'افزودن، ویرایش، آزمایش اتصال و حذف سرورها در deploy.conf. «نصب» روی یک سرور تازه اول پیش‌نیازها را می‌گذارد (داکر و افزونهٔ compose)؛ برای سرور داخل ایران از میرورهای داخلی، و اگر سرور به هیچ‌جا نرسد پنل خودش فایل‌ها را دانلود و از راه SSH کپی می‌کند. اگر کاربر SSH دسترسی sudo دارد، گزینه‌اش را بزنید و اگر sudo رمز می‌خواهد آن را هم بنویسید؛ دکمهٔ «آزمایش دسترسی» پیش از نصب می‌گوید کاربر چه دسترسی‌ای دارد. رمز فقط از درون اتصال SSH فرستاده می‌شود و جایی نمی‌ماند.'],
    ['fa-layer-group', 'خوشه‌ها', 'هر خوشه با سرورهای در دسترس، کاربران و پیوندهای درون و بیرون آن؛ اقدام روی همهٔ سرورهای یک خوشه (پشتیبان، بهینه‌سازی، راه‌اندازی دوباره). ساختن، پر کردن، تغییر نام، ادغام و حذف خوشه، جابه‌جایی سرور بین خوشه‌ها، نشانی‌های داخلی هر سرور (برای سرور خارج هم: نشانی IP، تا اگر DNS از کار افتاد باز در دسترس بماند) و درگاه‌ها. هر تغییر، فهرست امضاشدهٔ خانواده را عوض می‌کند و به امضای همین مرورگر نیاز دارد.'],
    ['fa-file-signature', 'خانواده و کلیدها', 'کلید اپراتور، فهرست امضاشدهٔ رله‌ها و کلیدهای مدیر. کلید این مرورگر را در «کلید مرورگر» بسازید و در فهرست بگذارید تا کارهای حساس امضا شوند.'],
    ['fa-handshake', 'شریک‌ها', 'خانواده‌های اپراتورهای دیگر: جست‌وجو و درخواست شراکت، پذیرش یا رد درخواست، قطع شراکت و یادداشت خودتان دربارهٔ هر شریک (نام دلخواه، راه تماس، برچسب). یادداشت‌ها فقط روی همین پنل می‌مانند.'],
    ['fa-users-gear', 'مدیران', 'مدیران خانواده هر کدام با کلید امضای خودشان؛ افزودن و برداشتن مدیر. هر مدیر یک «کلید جعبه» هم در مرورگر خودش دارد. تنظیمات پنل (فهرست سرورها، میرورها، یادداشت شریک‌ها، چیدمان نقشه، انتخاب‌های صفحه، تنظیمات ربات بدون توکن) را می‌توان برای مدیر دیگری فرستاد: در همین مرورگر با کلید جعبهٔ او و یک رمز پیچیده قفل و با کلید شما امضا می‌شود، و فقط مرورگر او با همان رمز، و فقط اگر شما در فهرست مدیران باشید، بازش می‌کند. کلید اپراتور، کلیدهای SSH، رمزها و توکن هرگز در آن نیست و اعمالش کد دومرحله‌ای می‌خواهد.'],
    ['fa-paper-plane', 'ربات تلگرام', 'همهٔ تنظیمات ربات: توکن، چت، زبان، دسته‌های پیام، آستانه‌ها، ساعت سکوت، گزارش روزانه، دستورها، تاپیک‌ها و طرح کارت. شش طرح (کلاسیک، کادردار، فشرده، ساده، کامل و طراحی خودتان) با نمایش همه کنار هم، خط جداکننده، جهت متن، نمادها و کادر جمع‌شونده. جهت هر سطر درست تنظیم می‌شود. توکن فقط روی سرور خارجی می‌ماند؛ اگر ربات آن سرور خاموش باشد، بالای بخش هشدار داده می‌شود.'],
    ['fa-inbox', 'صف پیام‌ها', 'پیام‌های در انتظار هر سرور: خلاصه با نمودار، صندوق‌ها دسته‌بندی‌شده بر اساس سرور، خوشه، اندازه یا عمر، و دفتر انقضا بر اساس علت.'],
    ['fa-users', 'کاربران', 'کاربران آنلاین دسته‌بندی‌شده، کاربران هر رله، رله‌هایی که با هم در ارتباط‌اند (ماتریس پیوندها و کاربرانی که از پیوند گذشته‌اند)، محدودشده‌ها، فهرست مجاز و مرکز پیام. پیام را می‌توان به همهٔ سرورها، یک خوشه، یک سرور یا چند سرور انتخابی فرستاد.'],
    ['fa-tower-broadcast', 'رله‌ها', 'پیوندهای هر سرور دسته‌بندی‌شده بر اساس سرور، خوشه، وضعیت، نوع یا رلهٔ مقابل؛ فهرست رله‌های خانواده و اینکه هر سرور به کدام وصل است؛ و ترتیب درگاه‌ها.'],
    ['fa-chart-line', 'ترافیک', 'نمودارهای زندهٔ ترافیک به تفکیک سرور، خوشه یا منطقه، سهم هر سرور و خوشه، کاربران پرترافیک و ترافیک بین رله‌ها.'],
    ['fa-box-open', 'ساخت و بسته‌بندی', 'پوشهٔ برنامه روی این کامپیوتر را بدهید تا بررسی شود و در همان پوشه (dist/server/<نسخه>) ساخته شود: بستهٔ به‌روزرسانی امضاشده با ایمیج‌های سرور و آرشیو برنامه، ایمیج‌های Docker Hub به صورت آرشیو، و انتشار در Docker Hub. هر فایل ساخته‌شده را می‌توان دانلود کرد یا مستقیم به سرورها فرستاد.'],
    ['fa-screwdriver-wrench', 'عملیات سرورها', 'پشتیبان، به‌روزرسانی و کار روی خود سرورها: وضعیت ماشین‌ها، پشتیبان‌ها، به‌روزرسانی از این کامپیوتر یا از گیت‌هاب (زنجیره‌ای و در خلوت‌ترین ساعت)، حافظه و پردازندهٔ کانتینرها دسته‌بندی‌شده بر اساس سرور، خوشه یا کانتینر، ایمیج‌ها و پاک‌سازی، نصب پیش‌نیازها، و سیستم.'],
    ['fa-file-lines', 'گزارش‌ها', 'گزارش هر سرور در سه سطح (خلاصه، معمولی، کامل)، تماس‌های زنده، رویدادهای سرورها، رویدادهای همین پنل، و خروجی هر کدام برای همهٔ سرورها، یک خوشه یا یک سرور با قالب‌های CSV، TSV، JSON، اکسل، HTML (قابل چاپ و PDF) و Markdown.'],
  ],
  en: [
    ['fa-gauge-high', 'Overview', 'Every server at a glance: number tiles (servers reachable, people online, calls, links, messages a minute, bandwidth, queue) and live graphs of every server. Draw them one server at a time, by cluster, by region (inside or outside) or all together, and pick a category: resources (processor, memory, disk), traffic, users, or the network and its queues. The range runs from 15 minutes to 7 days and the graphs refresh every 1, 3, 5, 10, 30 or 60 seconds, as you choose; pick one server under Server to watch it on its own, every graph and number of it. Point at a graph to read each server’s value at that moment.'],
    ['fa-diagram-project', 'Network', 'The family as a map: every relay a node in its cluster, the partners and the links. Drag a node and it stays; drop it on another cluster’s frame to move it there. Show one cluster, only the links that are down, or no partners, lay it out afresh, and export it as JSON. The Nodes and Links tabs show the same map as grouped tables.'],
    ['fa-server', 'Servers', 'Add, edit, test and remove servers in deploy.conf. Install on a fresh server first puts its prerequisites in (Docker and its compose plugin): through the mirrors inside Iran for a server there, and when a server reaches nothing at all the panel downloads the files itself and copies them in over SSH. If the SSH user has sudo, tick it, and type its sudo password if it asks for one; Test access says what the user may do before anything is installed. The password travels inside the SSH connection only and is kept nowhere.'],
    ['fa-layer-group', 'Clusters', 'Each cluster with its servers up, its people and its links inside and out; actions on all of a cluster’s servers at once (backup, optimise, restart). Make, fill, rename, merge and delete clusters, move a server between them, every server’s inside addresses (an outside server too: its IP address, so that it stays reachable when DNS is gone) and the gateways. Every change changes the signed family list and is signed in this browser.'],
    ['fa-file-signature', 'Family and keys', 'The operator key, the signed list of relays and the admin keys. Make this browser’s key under Browser key and list it, so that sensitive actions are signed.'],
    ['fa-handshake', 'Partners', 'Other operators’ families: look one up and ask, approve or reject a request, disconnect, and keep your own notes on each (a name of your choice, a contact, tags). Notes stay on this panel only.'],
    ['fa-users-gear', 'Admins', 'The family’s admins, each with their own signing key; add and remove them. Each admin also has a box key in their own browser. The panel’s settings (the server list, mirrors, notes on partners, the map’s layout, the page’s choices, and the bot’s settings without the token) can be sent to another admin: sealed in this browser with their box key and a complex password and signed with your key, opened only by their browser with that password, and only if you are a listed admin. The operator key, SSH keys, passwords and the token are never in it, and applying it takes an authenticator code.'],
    ['fa-paper-plane', 'Telegram bot', 'Every setting of the bot: token, chat, language, categories, thresholds, quiet hours, daily report, commands, topics and the card’s design. Six designs (classic, boxed, compact, minimal, detailed and your own), all previewed side by side, the separator, the direction, icons, and a folding box. Every line’s direction is set right. The token stays on the server outside Iran; if that server’s bot is off, the section says so at the top.'],
    ['fa-inbox', 'Message queues', 'What waits on each server: a summary with charts, mailboxes grouped by server, cluster, size or age, and the expiry ledger by reason.'],
    ['fa-users', 'Users', 'People online, grouped; the people on each relay; the relays talking to each other (a matrix of links and who crossed one lately); restrictions, the allowlist and the message centre. A message goes to every server, a cluster, one server or a few picked by hand.'],
    ['fa-tower-broadcast', 'Relays', 'Every server’s links grouped by server, cluster, state, kind or the relay at the other end; the family’s relays and which of our servers holds a link to each; the gateway order.'],
    ['fa-chart-line', 'Traffic', 'Live traffic graphs by server, cluster or region, each server’s and cluster’s share, the busiest users and the traffic between relays.'],
    ['fa-box-open', 'Build & package', 'Name the app’s folder on this computer: it is looked over and built in that same folder (dist/server/<version>) — the signed update package with the server images and the archive, the Docker Hub images as an archive, and the push to Docker Hub. Every file made can be downloaded or sent straight to servers.'],
    ['fa-screwdriver-wrench', 'Server operations', 'Backups, updates and work on the servers themselves: the machines, backups, updates from this computer or from GitHub (in a chain, at the quietest hour), containers’ memory and processor grouped by server, cluster or container, images and clean-up, prerequisites, and the system.'],
    ['fa-file-lines', 'Reports', 'Each server at three levels (brief, standard, detailed), live calls, the servers’ events, this panel’s own events, and exports of any of them for every server, one cluster or one server as CSV, TSV, JSON, Excel, HTML (printable, and so PDF) or Markdown.'],
  ],
};
const TIPS = {
  fa: ['کد دومرحله‌ای برای هر کار حساس پرسیده می‌شود و هر کد فقط یک بار پذیرفته می‌شود.', 'دکمهٔ لایه‌ها در نوار بالا سرورهای نمایش‌داده‌شده را به یک خوشه محدود می‌کند؛ همهٔ بخش‌ها از همین انتخاب پیروی می‌کنند.', 'هر فهرست بلند را می‌توان دسته‌بندی کرد و گروه‌ها را بست؛ انتخاب‌ها در همین مرورگر می‌مانند.', 'هیچ تغییری روی سرورها بی‌پرسش انجام نمی‌شود و کار خطرناک با کلید این مرورگر امضا می‌شود.'],
  en: ['Every sensitive action asks for an authenticator code, and each code is taken once.', 'The layers picker in the top bar limits the servers shown to one cluster; every section follows it.', 'Every long list can be grouped and its groups folded; the choices stay in this browser.', 'Nothing changes on a server without asking, and a dangerous action is signed with this browser’s key.'],
};

export const help = {
  id: 'help', title: 'help',
  render() {
    const lang = state.lang === 'en' ? 'en' : 'fa';
    const tabs = subtabs('help', [['sections', 'helpSections'], ['tips', 'helpTips']]);
    const body = tabs.current === 'sections'
      ? `<div class="help-list">${GUIDE[lang].map(([icon, title, text]) => `<details class="grp" open><summary><i class="fa-solid ${icon}"></i> <strong>${esc(title)}</strong></summary><p>${esc(text)}</p></details>`).join('')}</div>`
      : `<ul class="tips">${TIPS[lang].map((tip) => `<li>${esc(tip)}</li>`).join('')}</ul><pre>bash scripts/panel.sh update --builds yes
bash scripts/panel.sh doctor
bash scripts/panel.sh backup</pre>`;
    return card('help', tabs.html + body);
  },
};

const ABOUT = {
  fa: {
    project: 'این سوئیت رمزنگاری با هدف ارائه یک محیط کاملا امن، مبتنی بر مرورگر و سمت کلاینت (Client-Side) برای محافظت از داده‌های شخصی توسعه یافته است. هیچ یک از کلیدها یا داده‌های شما به هیچ سروری ارسال نمی‌شوند.',
    panel: 'پنل مرکزی جایی است که همهٔ سرورهای رلهٔ یک خانواده از یک جا اداره می‌شوند: روی کامپیوتر خود اپراتور اجرا می‌شود، از راه SSH به سرورها وصل می‌شود و هیچ چیزی را به جای دیگری نمی‌فرستد. کارهای حساس با رمز، کد دومرحله‌ای و امضای کلید همین مرورگر انجام می‌شوند و فهرست خانواده با کلید اپراتور امضا می‌شود. از همین‌جا می‌توان سرور تازه را آماده و نصب کرد، برنامه را ساخت و بسته‌بندی کرد، سرورها را زنجیره‌ای به‌روز کرد، خوشه‌ها و شریک‌ها را مدیریت کرد، ربات تلگرام را تنظیم کرد و همه چیز را با نمودار زنده و گزارش دید.',
    license: 'برنامه تحت لایسنس AGPL v3.0 است. اگر آن را به‌عنوان سرویس روی شبکه اجرا کنید — از جمله رلهٔ آن — باید سورس کد همان نسخه را در اختیار کاربران آن سرویس بگذارید (بند ۱۳).',
  },
  en: {
    project: 'This cryptography suite is developed to provide a fully secure, client-side, browser-based environment for protecting personal data. None of your keys or data are ever sent to any server.',
    panel: 'The central panel is where all of a family’s relay servers are run from one place: it runs on the operator’s own computer, reaches the servers over SSH and sends nothing anywhere else. Sensitive actions take the password, an authenticator code and this browser’s key, and the family list is signed by the operator key. From here a fresh server is made ready and installed, the app is built and packed, servers are updated in a chain, clusters and partners are managed, the Telegram bot is set up, and all of it is seen in live graphs and reports.',
    license: 'This application is licensed under AGPL v3.0. If you run it as a network service - its relay included - you must offer that same version’s source to the people using it (section 13).',
  },
};

export const about = {
  id: 'about', title: 'about',
  render() {
    const text = ABOUT[state.lang === 'en' ? 'en' : 'fa'];
    const version = document.getElementById('footVersion')?.textContent || '';
    return `<section class="card about"><div class="about-head"><img src="/logo.svg" alt="" width="84" height="84"><div><h2 class="brand-name">P00RIJÃ Cryptography</h2><p class="mut">Security &amp; Cryptography Enthusiast</p><p class="mono">v${esc(version)}</p></div></div>
      <h3>${esc(t('aboutProject'))}</h3><p>${esc(text.project)}</p>
      <h3>${esc(t('aboutPanel'))}</h3><p>${esc(text.panel)}</p>
      <div class="cards"><a class="card link-card" href="https://github.com/Poorija" target="_blank" rel="noopener"><i class="fa-brands fa-github"></i> <span>${esc(t('githubProfile'))}</span><span class="mono mut">github.com/Poorija</span></a>
        <a class="card link-card" href="mailto:p00rija@tutamail.com"><i class="fa-solid fa-envelope"></i> <span>${esc(t('emailAddress'))}</span><span class="mono mut">p00rija@tutamail.com</span></a></div>
      <p class="mut small">${esc(text.license)}</p>
      <p class="mut small">${esc(t('madeWith'))} ♥️ · © 2026 P00RIJÃ Cryptography</p></section>`;
  },
};
