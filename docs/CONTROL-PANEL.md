# The central panel

[فارسی](#راهنمای-فارسی)

One panel for every server you run: each section of a relay's own dashboard,
for all of them side by side, the network drawn as a graph you can change, and
your servers grouped into clusters. It is in this repository for anyone who
deploys their own servers, and it works from the same `deploy.conf` the deploy
uses.

It comes two ways:

- **In Docker, in your browser, with a login** (from 2.98.79): described here.
- **On the command line**, `node tools/control-panel.mjs` (from 2.98.78): a
  one-time link, every server at a glance, and each server's own dashboard
  through a proxy. See [MONITOR-SERVER.md](MONITOR-SERVER.md). It still works
  as it did.

## Starting it

On your own computer, with Docker Desktop (or Docker on Linux), from the
repository:

```bash
docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login
docker compose -f config/control-panel.compose.yaml up -d --build
```

The first command makes the login: a name, a password of at least 12
characters, and a secret for an authenticator app (Google Authenticator,
Aegis, 1Password, and the like), which it prints once, as text and as an
`otpauth://` link. The second starts the panel. Open
**http://127.0.0.1:8686/** and log in with the name, the password, and the
six-digit code the app shows.

What the container is given:

| | Default | |
|---|---|---|
| `/config` | `~/.config/p00rija-cryptography`, read-only (`panel.sh` asks about one it finds where it is run, and uses it only on a typed yes) | `deploy.conf`, and the operator's files if this is the operator's computer |
| `/ssh-src` | `~/.ssh`, read-only (`panel.sh` takes the folder in `~/.ssh` that `deploy.conf`'s keys are in) | the SSH keys `deploy.conf` names |
| `/state` | a Docker volume | the login, the operator you confirmed, the graph layout, and the audit log |

Settings for the compose file, all optional: `POORIJA_CONFIG_DIR`,
`POORIJA_SSH_DIR`, `POORIJA_PANEL_PORT` (8686), and `POORIJA_CONFIG_ACCESS`
(`ro`, or `rw` on the computer with the operator key; see
[Clusters](#clusters)). Without Docker the same panel runs as
`node tools/panel/setup-login.mjs` and then `node tools/panel/server.mjs`.

Nothing is opened on any server for it: it reaches each server's dashboard
through an SSH tunnel to that server's own loopback, and reads each dashboard
password over SSH into memory. A server whose `.env` password no longer
matches asks for it in the overview, for this session only.

## Logging in

- The password is kept only as a scrypt hash, and the app secret only in
  `/state/control-panel-login.json` (mode 600).
- A code once used is spent; a code from the step before or after is taken, so
  a clock a little off still works.
- Five failed logins lock the address for 15 minutes
  (`POORIJA_PANEL_LOCK_MS`).
- A session ends after 30 minutes without anyone using the page
  (`POORIJA_PANEL_SESSION_IDLE_MS`); the page reading new numbers on its own
  does not count as using it.
- `setup-login --new-code` keeps the name and password and gives a new app
  secret; running `setup-login` again replaces the login.

## Keys in the browser

The panel holds no signing key. Each browser makes its own in the **This
browser's key** tab: an ECDSA P-256 key made with WebCrypto, its private half
not extractable, kept in that browser's IndexedDB. The tab prints the two lines
the operator runs where the operator key is:

```bash
node tools/relay-directory.mjs admin-add "office-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

Then **Check again**, and the key shows as listed. From then on the page signs
every dangerous action (users, passwords, partners, gateways, restarts,
updates, backups, a server's lock, and changes to the family list) over exactly
what it is about to send, and each relay checks the signature. A locked server
(`CHAT_REQUIRE_OPERATOR_SIGNATURE=1`) takes nothing dangerous without one.

**What a web page cannot promise.** If the computer that runs the panel were
broken into, it could not take the key away, but it could ask a page that is
open in your browser to sign. That is why the panel runs on your own computer
and answers on 127.0.0.1 by default. It can run on a server (see below), with
that in mind.

## The sections

The sidebar has five groups: **Main** (Overview, Network), **Management**
(Servers, Clusters, Family, Partners, Telegram bot, Browser key, Account),
**Monitoring** (Message queues, Users, Relays, Traffic, Reports), **Operations**
(Build & package, Server operations) and **Help** (Panel guide, About the
project). A section with several parts has sub-tabs, and every long list can be
grouped (by server, cluster, region, or what that list has: a mailbox's size or
age, an event's kind, a link's state, a container) with each group folded or
open, and searched; the choices stay in the browser. Each table has the server
and its cluster on every row; the bar above the sections shows all clusters or
one, and any servers you tick.

- **On a row:** that row's server does it (kick a user, drop a mailbox, restore
  a backup, approve a partner, …).
- **Above a table:** every server shown does it, one after another, and the
  result for each is written below (send queues again, back up, test alerts,
  restart, update from GitHub one at a time, stopping at the first failure, …).
- **Ticked rows:** kick, suspend, or delete the rows you ticked, each on its
  own server.
- **Forms:** the message centre, the allowlist, manual links, partner requests,
  and the dashboard password go to the servers shown, or to the one you pick.
- CSV for users, mailboxes, the expiry ledger, links, and traffic, with the
  server on each line; every other export is in Reports.

Everything a relay's own dashboard does, the panel does; the suite checks the
panel's list of actions against the dashboard's calls.

## The network

The Network tab draws your family as a graph:

- **Nodes:** each relay, in the colour of its cluster, with an orange ring and
  its number if it is a gateway, a lock if it is locked, and a dashed edge if
  it does not answer; each other operator's family as one node; a relay outside
  the family that you linked by hand.
- **Frames:** each cluster, and whether it is independent (every member linked
  to every other).
- **Edges:** family links (green up, red dashed down), manual links (purple),
  links to partners (orange), and a partner reached through another (dotted).

What you can do on it, each after a question, and signed when it must be:

- drag nodes (the layout stays on this computer, in `/state`);
- drop a relay on another cluster's frame, or pick a cluster in its details, to
  move it there;
- set its inside addresses;
- order the gateways by dragging the list, then save them on every server;
- link two relays by hand, or remove a manual link;
- approve, reject, or disconnect another operator, or look one up and ask.

## Clusters

A cluster is a named group of your family's relays, for example *Iran* and
*Outside*. Every relay still links with every other and users of one cluster
talk with users of the other as before; what a cluster adds is that its relays
reach each other first at their **inside addresses**, so a cluster cut off from
the international internet keeps working on its own. See
[RELAY-NETWORK.md, Clusters](RELAY-NETWORK.md#clusters-from-29879).

Changing a cluster or an inside address re-signs the family list, which takes
the operator key. The panel can do it only where that key is, with the config
folder writable:

```bash
POORIJA_CONFIG_ACCESS=rw docker compose -f config/control-panel.compose.yaml up -d
```

It then signs the new list (serial one higher), saves it beside your
`deploy.conf` as `relay-directory.mjs` does, and hands it to every server. A
change also needs a signature from a listed browser key, so a stolen session
alone cannot re-sign your family. Anywhere else, clusters are shown, not
changed.

## Managing everything from the page (from 2.98.85)

The easiest start is the launcher: `bash scripts/panel.sh`. It brings Docker
up and asks for the port, the address, and whether the panel starts with
Docker. The login's authenticator secret is shown as a QR code in the
terminal, with the secret and its `otpauth://` link under it. Everything
below is done in the page, and every change asks for a current
authenticator code. A code is used once, so a second change in the same
half-minute waits for the next code.

**Servers.** One row per server in deploy.conf, with its SSH address, key,
jump, public URL, cluster and live state. When a server cannot be reached,
the row says why:

- the key was refused;
- no key file was found;
- the name was not found;
- the server's own key changed since it was first seen;
- the server does not answer.

A refused key is never tried again by itself, because some servers lock an
address out after a few failed logins. "Connect again" makes one fresh try.

A server met for the first time is trusted on that first login, and its key
is kept in the panel's state folder (`known_hosts`). If that key later changes,
the panel refuses the server and says so: unless you reinstalled it, someone
may be in the middle. After a real reinstall, remove the server's line from
that file (and from `~/.ssh/known_hosts`), then press "Connect again". The SSH
user must be filled in; the panel never guesses it.

To add a new server:

1. Press **Add a server**. Give a short name (`ir5`), the SSH host, user and
   port, the key (picked from the keys the panel can see), an optional jump
   through another server, the public URL, the region and the cluster.
2. Press **Test the connection**. It is one SSH login, and it shows whether
   Docker and P00RIJA are on the server.
3. Enter a code and press **Save**. deploy.conf gets the server, with a dated
   backup of what was there, and the panel connects to it straight away.
   There is no restart, and the chips at the top show it.
4. If P00RIJA is not installed there yet, either:
   - press **Install**: the panel sends its own installer and compose file
     over SSH and runs it with the ready-made Docker Hub images (give a
     registry mirror for a server inside Iran: the field offers a few that
     worked from Iran, and one typed by hand is kept for next time). A
     certificate another program already got for the domain on the server is
     served from where it is, as on a server set up by hand: the installer
     finds it (3X-UI's `/root/cert/<domain>/` first, then certbot's,
     acme.sh's, Caddy's, and others), or serves the folder you give. By
     default this server then renews it in that folder; choose its present
     owner to leave renewing to whatever does it now. A program's own store,
     such as certbot's `live/`, stays that program's. **A new one from Let's
     Encrypt** ignores what is there and hides the folder;
   - or run the **deploy.sh** command the panel shows, on your own computer.
5. In **Family list**, press **+ name** to add it to the signed family list.
   The list is signed and handed to every server.

Edit and Remove work the same way. Remove takes the server out of
deploy.conf (and, if you choose, out of the family list); the server itself
is not touched. What the panel writes to deploy.conf is held to plain
characters, so nothing in it can become a command when deploy.sh reads it.

**Clusters.** In the Clusters section:

- create a cluster from a name and its servers;
- rename it (every member moves);
- set its members with the checkboxes;
- give a member its inside addresses;
- delete it.

Each change is signed by this browser's listed key, handed to every server,
and written to deploy.conf for the next deploy.

**The family list and the operator key.** The Family list section shows:

- the signed list: every server's id, addresses, region, cluster, gateway,
  and inside addresses;
- the admin keys;
- which version each server holds.

While no admin key is listed, this browser's key can be listed with a code.
After that, every change needs a listed key's signature. The operator key is:

- **created** when there is none;
- **imported** from a backup file;
- **backed up** (a download, after the password and a code);
- **removed** from this computer (a copy stays beside deploy.conf);
- **replaced**. Every server's trust moves to the new key one at a time:
  each gets its new key and, at once, the list signed with it. The first
  that fails is put back on the old key and nothing after it is touched;
  running it again carries on with the same new key.

**My account.**

- Change the panel password; the other sessions are signed out.
- Replace the authenticator: the new QR and secret take effect only after a
  code from them is entered, so nobody locks themselves out.
- Sign out the other sessions.
- See the last sign-ins.

Sessions survive a restart of the panel.

**System and log.** The System section starts with this panel's card:

- its version, uptime and config folder (writable or not);
- whether the operator key is present;
- how to keep it.

The Panel log section shows what was done and by whom. No password or secret
is ever written to it.

**Keeping it, from the terminal:**

```bash
bash scripts/panel.sh doctor
```

```bash
bash scripts/panel.sh backup
```

```bash
bash scripts/panel.sh restore FILE
```

```bash
bash scripts/panel.sh update
```

```bash
bash scripts/panel.sh uninstall
```

- `doctor` checks Docker, deploy.conf, every key, one SSH login per server,
  the port, and TLS.
- `backup` and `restore` copy the panel's login, trust, layout and sessions
  to a file and back.
- `update` gets a new image with the same settings.
- `uninstall` removes the container and image; `--purge` removes the login
  and settings too.

## Server updates (from 2.98.88)

In **System → Server updates** the panel updates the servers itself:

- **A release** comes from the app's folder (only what a deploy uses is sent:
  `js`, `css`, `assets`, `fonts`, `vendor`, `scripts`, `config`, `tests` and
  the top files, never `node_modules`), an archive of it, a package made
  before, or GitHub's latest release, checked against its `SHA256SUMS`.
- **Build the package.** The panel builds the images once, on this computer,
  and signs the package with the operator key. It needs this computer's
  Docker: start the panel with `bash scripts/panel.sh update --builds yes`
  (see [DOCKER.md](DOCKER.md); that socket is as good as root here).
- **Send it** to the servers chosen, with when to apply it:
  - **smart:** when the fewest people are online (the quietest tenth of the
    last week), and within a day at the latest;
  - **at a set date and time;**
  - **now.**

  A server that has no updater yet is updated over SSH this once, and has one
  from then on.
- **The chain.** Every ten minutes each server asks the family what they hold,
  and takes a newer signed version from any member it can reach, the two
  relays proving who they are with their own keys. A server the panel cannot
  reach directly is updated through the others. A time to apply travels with
  the package only when the operator signed it; otherwise each server waits for
  its own quiet hour.
- **For the people online,** two minutes before it starts, the app says the
  server is updating and to wait a few minutes.
- **What a server refuses:** a package not signed by the operator key, or one
  that is not newer than what it runs. It backs up first. A failed update
  leaves the previous version running, is reported, and is never retried by
  itself.
- **The table** shows each server's version, the update ready, its step, when
  it applies, who is online and the last result. **When** changes the time,
  and **Cancel** drops a ready update.

## The Telegram bot (from 2.98.88)

The **Telegram bot** section manages every server's bot while the relays run.

- **The servers.** Which one sends (it has the token and the chat), which hand
  their alerts on over the relay link, the token (masked), the chat, the
  language, what is queued and what is open. **Test** sends a test message
  from that server, the whole way to the chat.
- **The settings of the server chosen:**
  - **bot and chat:** on or off; the token, typed only, shown as its last
    characters, or removed; the chat id, with the chats that wrote to the bot
    offered; the name on the cards; Persian or English; the time zone; and the
    user ids allowed to give commands;
  - **categories:** critical, warning, resolved, reminder of an open problem,
    server start, signed sensitive action, partnerships, server update, test,
    daily report, and old relays' messages, each sent or not and silent or not
    (critical always sounds, and the test always goes);
  - **alerts and thresholds:** each kind on or off (disk, server memory, relay
    memory, open files, TURN down or full, bandwidth, a relay link down or
    detoured), every threshold, how often to check, how often to remind, and
    the least gap between two messages;
  - **quiet hours,** sending silently or holding until they end (a critical
    message may sound through), and **mute** for an hour, eight hours or a day;
  - **the daily report** and its hour, **each command** on or off, and the
    **Mute** and **Status** buttons under each alert;
  - **forum topics:** a topic for alerts, reports, sensitive actions, updates
    and the rest, when the chat is a group with topics;
  - **the card:** a last line with `{server}`, `{host}`, `{level}` and
    `{time}`, and whether it shows the server's details and its state.
- **Preview** draws any card as the settings would send it, and says whether it
  would go with sound, silently, held, or not at all.
- **Recent messages** lists what was sent, and what was not and why.
- **Save to every server** writes the same settings to all of them, without
  the token or the name. **Back to .env** returns one server to its `.env`.

What the panel changed is kept on the server, beside its data
(`telegram-settings.json`, and the token in `telegram-token`, owner-only);
`.env` stays the default for anything the panel did not change. Saving is a
signed request, so on a locked relay only a listed browser key can do it.

The token belongs on the server outside Iran alone. A server inside Iran needs
none: its alerts go to the one that has it, over the relay link.

## Live graphs, building, and the sections in full (from 2.98.89)

**Overview.** Tiles with what is true now (servers reachable, people online,
calls, links up, messages a minute, bandwidth, the queue, the average
processor), then live graphs of every server. The panel reads every server
every 20 seconds while someone has it open, and every five minutes otherwise;
it keeps two hours at that pace and a week of five-minute averages, saved in
its state folder so a restart keeps the week. The graphs are drawn one server
at a time, by cluster, by region, or all together, in categories: resources
(processor, memory, its share of the container's ceiling, disk), traffic
(messages a minute in and out, bandwidth, relayed), users (online, calls), and
the network (links up, the queue and its size, availability). A group of
servers gets a total line where a sum means something. The range runs from 15
minutes to 7 days; the graphs refresh themselves every 15 seconds without
redrawing anything else, and the pointer reads each server's value at that
moment. The server cards below are grouped the same way.

**Network.** Sub-tabs: the map, the nodes (every relay, partner and outside
node with its cluster, region, gateway place, state, links up and inside
addresses), the links (by kind, state, or pair of clusters), the gateway order,
and the partner lookup. The map can show one cluster, only the links that are
down, or no partners; Lay out afresh forgets every saved position, and JSON
exports the map.

**Clusters.** Each cluster at a glance (its servers up, people, links inside it
and to other clusters, whether it stands alone), with actions on all of its
servers at once (back up, optimise memory, send queues again, test alerts,
restart) and Show only this. Clusters are made, filled, renamed, merged and
deleted, and a server moved between them. **Inside addresses** are offered for
every server, one outside Iran too: an outside server with an address by bare
IP (`https://<IP>:8585`) is still reachable by its cluster mates and the other
relays when DNS is gone altogether, and the table marks which servers can be
reached without a name. The SSH address button suggests that address from
deploy.conf. Each relay's gateway place in the signed list is set here too.

**Partners** has a section of its own: every partner once (the family shares
them), grouped by state, with approve, reject and disconnect, the lookup and
request for a new one, our side (carry between partners, our gateways), and
the admin's own notes on each partner (a name, a contact, tags, notes), kept on
this panel only and never sent to a server.

**Message queues:** a summary with charts, each server's totals, the mailboxes
grouped by server, cluster, region, size or age, and the expiry ledger by
reason. **Users:** people online grouped; the people on each relay; the relays
in contact (a matrix of every link with what it carried, and who crossed a
link lately); restrictions; the allowlist; and the message centre, which sends
to every server, one cluster, one server (relay), or servers picked by hand.
**Relays:** a summary with charts, the links grouped by server, cluster,
state, kind or the relay at the other end, the family's relays with which of
our servers holds a link to each, and the gateways. **Traffic:** live traffic
graphs by server, cluster or region, the shares of each server, cluster and
region, the busiest users, and the traffic between relays.

**Reports:** each server at three levels (brief, standard, detailed), live
calls, the servers' events (by kind, server, cluster or day), this panel's
own events (its audit log, which used to be a section of its own), and the
export centre: any of fifteen tables, for every server shown, one cluster or
one server, at a level, as CSV, TSV, JSON, an Excel workbook (one sheet per
table), a printable HTML report (and so PDF), or Markdown. The file is made in
the page.

**Server operations** is what were Server and backups, System and Fresh
install, in one section with sub-tabs: the servers' machines and the actions on
all of them, backups (grouped), updates (from this computer — a build, a
folder, an archive — or from GitHub, signed and sent in a chain at the quietest
hour, and GitHub's own apply and roll back), containers (memory and processor
grouped by server, cluster or container, with charts and their ceilings),
images and clean-up, install and prerequisites, and the system.

**Build & package.** The app's folder on the operator's computer is named in
the page, looked over (a P00RIJA checkout or not, its version, commit and
files), and built in that same folder, into `dist/server/<version>/`, by
`scripts/build-server-package.sh`, which also runs by hand in a checkout:

```bash
bash scripts/build-server-package.sh            # the archive and the server images
bash scripts/build-server-package.sh --all      # and the Docker Hub images too
bash scripts/build-server-package.sh --push     # publish on Docker Hub (after docker login)
```

From the page: the signed update package (with the server images and the
archive), the Docker Hub images as an archive (with the private-string check
of `dockerhub-release.sh`), and the push to Docker Hub after a login made in
the page. Every file has its line in `SHA256SUMS`, and the run is recorded in
`build.json`. What was built is listed by version: each file downloads, an
update package goes to the servers through Server updates, and an image
archive is copied to servers and loaded with `docker load` (a server installed
with `docker-install.sh` is then started on that version). The panel sees only
the folder it was given: `bash scripts/panel.sh update --builds yes` mounts the
checkout the script is in, at the same path, or another one with
`--source DIR`.

**Prerequisites.** Installing on a fresh server first puts Docker, its compose
plugin, and the small tools in (`scripts/lib/server-prereqs.sh`, sent over
SSH), only what is missing. Docker comes from Docker's own repository, or a
mirror of it (on a server inside Iran the mirrors reachable there are tried
first), or the distribution's own packages. Docker's two signing keys are
written into the script and the repository is set up with them, so apt and
dnf check every package against Docker's own key and a mirror can never pass
off a key or packages of its own. A server that reaches none of them gets Docker's
static binaries and the compose plugin downloaded by the panel itself and
copied in over the same SSH, so any server SSH reaches gets Docker. A server
inside Iran also gets registry mirrors in `/etc/docker/daemon.json` when that
file names none. Check and Install prerequisites are in Server operations →
Install, and on each server's row in Servers.

**Panel guide** and **About the project** close the sidebar: what each section
does, a few tips, and the project's own description with the panel's.

## Admins, card designs, sudo, and a faster page (from 2.98.90)

**Admins.** The Admins section lists the family's admins, each with their own
signing key (made in their own browser, under Browser key), and adds or
removes one by changing the signed family list. Each admin also makes a
**box key** in their own browser (My keys): its private half never leaves
that browser; its public half is a short line they hand to the others, who
check its fingerprint with them another way before setting it.

**Sending the panel's settings to another admin.** Under Send settings, pick
the admin and what to send: the server list, mirrors, notes on partners, the
map's layout, the page's own choices, the bot's settings (never the token).
The operator key, SSH keys, dashboard passwords, the Telegram token, and the
panel's login are never in it. The page seals it in the sender's browser:

    ecdh   = ECDH(a fresh key, the recipient's box key)
    pw     = PBKDF2-SHA-256(password, salt, 600 000 rounds)
    key    = HKDF-SHA-256(ecdh || pw, salt, "p00rija-share-v1|<to>|<from>")
    sealed = AES-256-GCM(key, iv, settings), the header as associated data
    sig    = ECDSA-P-256(the sender's signing key, everything above)

The password must be complex (16 characters or more, every kind of
character, nothing repeated, no well-known word); Make a strong password
writes one. The file goes one way and the password another. Under Receive
settings the recipient opens it in their own browser with the password: it is
refused unless it was sealed to that browser's box key, its signature holds,
and the sender's signing key is one of the family's admins. What is in it is
shown first; applying it takes an authenticator code, every part is checked
again on the panel as if typed in the page, and the bot's settings go to the
servers of the same name signed by the recipient's own browser.

**Telegram card designs.** Six designs: classic, boxed (the server and the
message in a quote, the state in a folding one), compact, minimal, detailed,
and your own. Every design can also set the separator line, the text
direction, icons, and whether the state is boxed or folded. Your own design is
a template with placeholders (`{icon} {kind} {server} {host} {title} {body}
{message} {identity} {snapshot} {time} {version} {cluster} {region} {users}
{queue} {cpu} {memory} {disk} {links} {footer} {rule}`) and marks (`**bold**`,
`__italic__`, `~~struck~~`, `` `code` ``, `||spoiler||`, a line starting `> `
in a quote, `>> ` in a folding quote); everything else in it is text. Every
design is previewed side by side, drawn by the relay with the form's own
settings before they are saved. Telegram draws a bot's message itself: no
bot can set its colour, corners, or transparency. Telegram's quote is the
rounded, tinted box with a coloured edge, and the designs use it. Every line
of a card starts with a direction mark, so a Persian card reads right to left
and an English one left to right in every Telegram. A card that is too long is
shortened in its message, never cut through its markup (Telegram refuses a
card whose markup is broken).

**The bot that holds the token.** A server's test obeys its bot's main switch.
A server whose bot is off answers that it is off, instead of sending a test
while every card forwarded to it is dropped. After a test from a server
without the token, the panel reads the token holder's log and says whether the
card was sent, or why not. With the token holder's bot off, the Telegram
section says so at the top.

**Sudo.** The install dialog has *This server's SSH user has sudo* and a sudo
password field, for a sudo that asks for one. Test access says what the user
may do there: root, sudo without a password, sudo with that password, sudo
that asks for a password, or neither. Every install starts with that check;
told the user has sudo, it stops at once if sudo does not work. The password
goes inside the SSH connection as a quoted here-document, unlocks sudo once
for that session, and is forgotten: it is never on a command line and never
written to a file. Every check tries it only once, since a wrong password
tried again and again can lock the account. The prerequisites also add the
user to the docker group.

**Live graphs and the page.** The overview refreshes every 1, 3, 5, 10, 30, or
60 seconds. The panel then reads the servers at that pace: the light route
every time, the heavy ones at most every 5 seconds. Each answer is thinned to
the points a chart has room for. *Server* shows one server on its own: every
graph of it, its numbers, and its card. Reads are shared for a few seconds
between sections, and every section's data is read in the background after
login, so switching sections is immediate. A loading screen shows while the
page starts, with a Reload button if that takes long. A section read for the
first time shows a spinner, a thin bar shows while anything is being read, and
a banner says when the panel stops answering. Every server table can be shown
one by one, by cluster, or by region, and Servers, Partners, and Server
operations have their charts too.

## Running it on a server

Possible, with the warning above. Serve it over HTTPS with the server's
certificate (the one 3X-UI uses works), and tell it the address browsers use:

```bash
POORIJA_PANEL_HOST=0.0.0.0 POORIJA_PANEL_PORT=8686 \
POORIJA_PANEL_ORIGINS=https://panel.example.com:8686 \
POORIJA_PANEL_TLS_CERT=/root/cert/example.com/fullchain.pem \
POORIJA_PANEL_TLS_KEY=/root/cert/example.com/privkey.pem \
node tools/panel/server.mjs
```

Behind a reverse proxy instead, set `POORIJA_PANEL_SECURE_COOKIE=1` and
`POORIJA_PANEL_TRUSTED_PROXY` to the proxy's address, so failed logins lock the
address the proxy names and not everyone behind it.

## What it keeps, and what it never does

- `control-panel.log` in `/state`: who did what, on which server, and whether
  it was signed; never a password.
- It never writes a dashboard password to disk, never takes the family's
  operator from a server's word (it uses the operator key beside `deploy.conf`,
  or the operator id you confirm), and never signs for a server whose identity
  does not match the signed family list.
- The page runs no script but its own, and every value a server sends is
  escaped before it is shown.

| Variable | Default | |
|---|---|---|
| `POORIJA_PANEL_HOST` | `127.0.0.1` | `0.0.0.0` in the image |
| `POORIJA_PANEL_PORT` | `8686` | |
| `POORIJA_PANEL_ORIGINS` | `http://127.0.0.1:<port>,http://localhost:<port>` | the addresses browsers reach it at |
| `POORIJA_PANEL_STATE_DIR` | the config folder | `/state` in the image |
| `POORIJA_PANEL_SESSION_IDLE_MS` | `1800000` | |
| `POORIJA_PANEL_LOCK_MS` | `900000` | after five failed logins |
| `POORIJA_PANEL_TLS_CERT`, `POORIJA_PANEL_TLS_KEY` | | serve HTTPS |
| `POORIJA_PANEL_SECURE_COOKIE` | | `1` behind an HTTPS proxy |
| `POORIJA_PANEL_TRUSTED_PROXY` | | the proxy's address |
| `POORIJA_PANEL_OPERATOR_ID` | | the family operator, instead of confirming it in the page |
| `POORIJA_PANEL_KNOWN_HOSTS` | | an SSH known_hosts file of its own |

---

## راهنمای فارسی

یک پنل برای همهٔ سرورهایی که دارید: هر بخش پنل یک رله، برای همهٔ سرورها کنار هم؛
شبکه به صورت گرافی که می‌شود عوضش کرد؛ و سرورها در خوشه‌ها. این ابزار در همین
مخزن است تا هر کسی که روی سرورهای خودش مستقر می‌کند از آن استفاده کند، و از همان
`deploy.conf` استقرار کار می‌کند.

دو شکل دارد:

- **داکر، در مرورگر، با ورود** (از نسخهٔ 2.98.79): همین راهنما.
- **خط فرمان**، `node tools/control-panel.mjs` (از نسخهٔ 2.98.78): لینک یک‌بارمصرف،
  همهٔ سرورها در یک نگاه، و پنل هر سرور از راه پروکسی. در
  [MONITOR-SERVER.md](MONITOR-SERVER.md) آمده و مثل قبل کار می‌کند.

### راه‌اندازی

روی کامپیوتر خودتان با Docker Desktop (یا داکر روی لینوکس)، در پوشهٔ مخزن:

```bash
docker compose -f config/control-panel.compose.yaml run --rm -it control-panel setup-login
docker compose -f config/control-panel.compose.yaml up -d --build
```

دستور اول ورود را می‌سازد: یک نام، رمزی دست‌کم ۱۲ حرفی، و کلیدی برای برنامهٔ
کد دومرحله‌ای (Google Authenticator، Aegis، 1Password و مانند این‌ها) که فقط
همان یک بار، هم به صورت متن و هم به صورت لینک `otpauth://`، چاپ می‌شود. دستور دوم
پنل را بالا می‌آورد. **http://127.0.0.1:8686/** را باز کنید و با نام، رمز و کد
شش‌رقمی برنامه وارد شوید.

آنچه به کانتینر داده می‌شود:

| | پیش‌فرض | |
|---|---|---|
| `/config` | `~/.config/p00rija-cryptography`، فقط‌خواندنی (`panel.sh` دربارهٔ یکی که در پوشهٔ جاری یا کنار اسکریپت پیدا کند می‌پرسد، و فقط با `yes` تایپ‌شده برش می‌دارد) | `deploy.conf`، و فایل‌های اپراتور اگر این کامپیوتر اپراتور است |
| `/ssh-src` | `~/.ssh`، فقط‌خواندنی (`panel.sh` پوشه‌ای در `~/.ssh` را برمی‌دارد که کلیدهای `deploy.conf` در آن است) | کلیدهای SSH که `deploy.conf` نام برده |
| `/state` | یک volume داکر | ورود، اپراتوری که تأیید کرده‌اید، چیدمان گراف، و گزارش کارها |

تنظیمات اختیاری فایل compose: `POORIJA_CONFIG_DIR`، `POORIJA_SSH_DIR`،
`POORIJA_PANEL_PORT` (۸۶۸۶)، و `POORIJA_CONFIG_ACCESS` (`ro`، یا `rw` روی کامپیوتری
که کلید اپراتور دارد؛ بخش [خوشه‌ها](#خوشهها) را ببینید). بدون داکر هم همین پنل با
`node tools/panel/setup-login.mjs` و سپس `node tools/panel/server.mjs` اجرا می‌شود.

هیچ پورتی روی سرورها برایش باز نمی‌شود: به پنل هر سرور از راه تونل SSH به
loopback خود آن سرور می‌رسد و رمز پنل هر سرور را از راه SSH فقط در حافظه نگه
می‌دارد. سروری که رمز `.env` آن دیگر درست نیست، در نمای کلی رمز را می‌پرسد، فقط برای
همین نشست.

### ورود

- رمز فقط به صورت هش scrypt نگه داشته می‌شود و کلید برنامه فقط در
  `/state/control-panel-login.json` (با دسترسی ۶۰۰).
- هر کد فقط یک بار پذیرفته می‌شود؛ کد یک قدم قبل یا بعد هم پذیرفته می‌شود تا ساعتی
  که کمی جلو یا عقب است مشکلی نسازد.
- پنج ورود ناموفق، آن نشانی را ۱۵ دقیقه قفل می‌کند (`POORIJA_PANEL_LOCK_MS`).
- نشست بعد از ۳۰ دقیقه بی‌کاری بسته می‌شود (`POORIJA_PANEL_SESSION_IDLE_MS`)؛
  خواندن خودکار عددهای تازه به‌حساب کار کردن با صفحه نمی‌آید.
- `setup-login --new-code` نام و رمز را نگه می‌دارد و کلید تازه‌ای برای برنامه
  می‌دهد؛ اجرای دوبارهٔ `setup-login` ورود را از نو می‌سازد.

### کلید در مرورگر

پنل هیچ کلید امضایی نگه نمی‌دارد. هر مرورگر در زبانهٔ **کلید این مرورگر** کلید خودش را
می‌سازد: کلید ECDSA P-256 با WebCrypto که نیمهٔ خصوصی‌اش بیرون‌بردنی نیست و در
IndexedDB همان مرورگر می‌ماند. این زبانه دو خطی را چاپ می‌کند که اپراتور روی
کامپیوتری که کلید اپراتور دارد اجرا می‌کند:

```bash
node tools/relay-directory.mjs admin-add "office-laptop" <public key>
node tools/relay-directory.mjs sign && node tools/relay-directory.mjs publish
```

بعد **دوباره بررسی کن** را بزنید تا کلید «در فهرست» نشان داده شود. از آن پس صفحه هر
کار حساس (کاربران، رمزها، شریک‌ها، Gatewayها، ری‌استارت، به‌روزرسانی، پشتیبان،
قفل سرور، و تغییر فهرست خانواده) را دقیقاً روی همان چیزی که می‌فرستد امضا می‌کند و
هر رله امضا را بررسی می‌کند. سرور قفل‌شده (`CHAT_REQUIRE_OPERATOR_SIGNATURE=1`) هیچ
کار حساسی را بی‌امضا نمی‌پذیرد.

**آنچه یک صفحهٔ وب نمی‌تواند تضمین کند.** اگر کامپیوتری که پنل روی آن اجرا می‌شود
نفوذ شود، کلید را نمی‌تواند ببرد، ولی تا وقتی صفحه در مرورگر شما باز است می‌تواند از
آن امضا بخواهد. برای همین پنل به‌طور پیش‌فرض روی کامپیوتر خودتان و فقط روی 127.0.0.1
اجرا می‌شود. اجرای آن روی سرور هم شدنی است (پایین‌تر)، با در نظر داشتن همین نکته.

### بخش‌ها

نوار کناری پنج گروه دارد: **اصلی** (نمای کلی، شبکه)، **مدیریت** (سرورها، خوشه‌ها،
خانواده، شریک‌ها، ربات تلگرام، کلید این مرورگر، حساب)، **پایش** (صف‌های پیام، کاربران،
رله‌ها، ترافیک، گزارش‌ها)، **عملیات** (ساخت و بسته‌بندی، عملیات سرورها) و **راهنما و
درباره** (راهنمای پنل، درباره پروژه). بخشی که چند قسمت دارد زیربخش دارد، و هر فهرست بلند
را می‌توان دسته‌بندی کرد (بر اساس سرور، خوشه، منطقه، یا آنچه همان فهرست دارد: اندازه یا عمر
صندوق، نوع رویداد، وضعیت لینک، کانتینر)، هر گروه را بست یا باز کرد و جستجو کرد؛ این
انتخاب‌ها در همان مرورگر می‌مانند. در هر جدول، سرور و خوشهٔ آن روی هر ردیف هست؛ نوار بالا
همهٔ خوشه‌ها یا یکی را نشان می‌دهد، و هر سروری که تیک بزنید.

- **روی هر ردیف:** سرور همان ردیف کار را انجام می‌دهد (اخراج کاربر، حذف میل‌باکس،
  بازگردانی پشتیبان، تأیید شریک، …).
- **بالای هر جدول:** همهٔ سرورهای نمایش‌داده‌شده یکی‌یکی کار را انجام می‌دهند و نتیجهٔ
  هر کدام زیر صفحه نوشته می‌شود (ارسال دوبارهٔ صف‌ها، پشتیبان‌گیری، آزمایش هشدار،
  ری‌استارت، به‌روزرسانی از گیت‌هاب یکی‌یکی که با اولین خطا می‌ایستد، …).
- **ردیف‌های تیک‌خورده:** اخراج، تعلیق یا حذف ردیف‌های انتخاب‌شده، هر کدام روی سرور خودش.
- **فرم‌ها:** مرکز پیام، اجازه‌نامه، لینک دستی، درخواست شراکت و رمز پنل به سرورهای
  نمایش‌داده‌شده یا سروری که انتخاب می‌کنید می‌روند.
- خروجی CSV کاربران، میل‌باکس‌ها، دفتر انقضا، لینک‌ها و ترافیک، با نام سرور در هر خط؛
  بقیهٔ خروجی‌ها در بخش گزارش‌ها است.

هر کاری که پنل یک رله می‌کند، پنل مرکزی هم می‌کند؛ مجموعهٔ آزمایش فهرست کارهای پنل
مرکزی را با فراخوانی‌های پنل رله مقایسه می‌کند.

### شبکه

زبانهٔ شبکه خانوادهٔ شما را به صورت گراف نشان می‌دهد:

- **گره‌ها:** هر رله به رنگ خوشه‌اش، با حلقهٔ نارنجی و شمارهٔ اولویت اگر Gateway
  باشد، قفل اگر قفل باشد، و حاشیهٔ خط‌چین اگر جواب ندهد؛ خانوادهٔ هر اپراتور دیگر
  به صورت یک گره؛ و رله‌ای بیرون از خانواده که دستی لینکش کرده‌اید.
- **قاب‌ها:** هر خوشه، و اینکه مستقل است یا نه (همهٔ اعضا با هم لینک دارند).
- **یال‌ها:** لینک خانواده (سبز وصل، قرمز خط‌چین قطع)، لینک دستی (بنفش)، لینک به
  شریک (نارنجی)، و شریکی که از راه شریک دیگر به آن می‌رسید (نقطه‌چین).

کارهایی که روی گراف می‌شود کرد، هر کدام بعد از پرسیدن و در صورت نیاز با امضا:

- کشیدن گره‌ها (چیدمان فقط روی همین کامپیوتر در `/state` می‌ماند)؛
- انداختن رله روی قاب خوشهٔ دیگر، یا انتخاب خوشه در جزئیاتش، برای بردن به آن خوشه؛
- تعیین نشانی‌های داخلی آن؛
- مرتب کردن Gatewayها با کشیدن فهرست و ذخیره روی همهٔ سرورها؛
- لینک دستی بین دو رله، یا برداشتن لینک دستی؛
- تأیید، رد یا قطع ارتباط با اپراتور دیگر، یا پیدا کردن یکی و درخواست شراکت.

### خوشه‌ها

خوشه گروهی نام‌دار از رله‌های خانوادهٔ شماست، مثلاً *ایران* و *خارج*. همهٔ رله‌ها مثل
قبل با هم لینک دارند و کاربران یک خوشه مثل قبل با کاربران خوشهٔ دیگر حرف می‌زنند؛
چیزی که خوشه اضافه می‌کند این است که رله‌های یک خوشه اول با **نشانی‌های داخلی** به هم
وصل می‌شوند، پس اگر خوشه از اینترنت بین‌الملل جدا شود، به‌تنهایی کار می‌کند.
[RELAY-NETWORK.md، خوشه‌ها](RELAY-NETWORK.md#خوشهها-از-نسخهٔ-29879) را ببینید.

تغییر خوشه یا نشانی داخلی فهرست خانواده را دوباره امضا می‌کند و کلید اپراتور
می‌خواهد. پنل فقط جایی می‌تواند این کار را بکند که آن کلید هست و پوشهٔ تنظیمات
نوشتنی است:

```bash
POORIJA_CONFIG_ACCESS=rw docker compose -f config/control-panel.compose.yaml up -d
```

پنل فهرست تازه را (با شمارهٔ یکی بیشتر) امضا می‌کند، مثل `relay-directory.mjs` کنار
`deploy.conf` ذخیره می‌کند و به همهٔ سرورها می‌دهد. هر تغییر امضای یک کلید مرورگرِ
در فهرست را هم می‌خواهد، تا نشستِ دزدیده‌شده به‌تنهایی نتواند خانوادهٔ شما را دوباره
امضا کند. هر جای دیگری خوشه‌ها فقط دیدنی‌اند.

### مدیریت همه‌چیز از داخل صفحه (از 2.98.85)

ساده‌ترین شروع لانچر است: `bash scripts/panel.sh`. این لانچر Docker را روشن
می‌کند و پورت، نشانی، و اینکه پنل با Docker بالا بیاید را می‌پرسد. کلید برنامهٔ
احراز هویت به شکل QR کد در ترمینال نشان داده می‌شود، و کلید و لینک
`otpauth://` آن زیرش. همهٔ کارهای زیر داخل صفحه انجام می‌شوند و هر تغییر یک کد
تازهٔ برنامهٔ احراز هویت می‌خواهد. هر کد یک بار به کار می‌رود، پس تغییر دوم در
همان نیم‌دقیقه منتظر کد بعدی می‌ماند.

**سرورها.** هر سرورِ deploy.conf یک ردیف دارد: نشانی SSH، کلید، مسیر جایگزین،
نشانی عمومی، خوشه و وضعیت زنده. سروری که وصل نمی‌شود، دلیلش را می‌گوید:

- کلید رد شد؛
- فایل کلید پیدا نشد؛
- نام پیدا نشد؛
- کلید خود سرور با کلیدی که بار اول دیده شد فرق دارد؛
- سرور جواب نمی‌دهد.

کلیدی که رد شده هرگز خودبه‌خود دوباره امتحان نمی‌شود، چون بعضی سرورها نشانی را
بعد از چند ورود ناموفق قفل می‌کنند. «اتصال دوباره» یک تلاش تازه می‌کند.

سروری که بار اول دیده می‌شود در همان ورود اول پذیرفته می‌شود و کلیدش در پوشهٔ
وضعیت پنل (`known_hosts`) نگه داشته می‌شود. اگر بعداً آن کلید عوض شود، پنل سرور
را نمی‌پذیرد و همین را می‌گوید: اگر سرور را از نو نصب نکرده‌اید، ممکن است کسی وسط
راه باشد. بعد از نصب دوبارهٔ واقعی، سطر آن سرور را از آن فایل (و از
`~/.ssh/known_hosts`) پاک کنید و «اتصال دوباره» را بزنید. کاربر SSH باید نوشته
شود؛ پنل آن را حدس نمی‌زند.

افزودن سرور تازه:

1. **افزودن سرور** را بزنید. یک نام کوتاه (`ir5`)، میزبان، کاربر و پورت SSH،
   کلید (از کلیدهایی که پنل می‌بیند)، مسیر جایگزین اختیاری از راه سروری دیگر،
   نشانی عمومی، منطقه و خوشه را بدهید.
2. **آزمایش اتصال** را بزنید. فقط یک ورود SSH است و نشان می‌دهد Docker و
   P00RIJA روی سرور هستند یا نه.
3. کد را وارد کنید و **ذخیره** را بزنید. سرور به deploy.conf اضافه می‌شود، با
   یک نسخهٔ پشتیبان تاریخ‌دار از آنچه بود، و پنل همان لحظه به آن وصل می‌شود.
   ری‌استارت لازم نیست و تراشه‌های بالای صفحه هم نشانش می‌دهند.
4. اگر P00RIJA هنوز آنجا نصب نیست، یکی از این دو:
   - **نصب** را بزنید: پنل نصب‌کننده و فایل compose خودش را با SSH می‌فرستد و
     با ایمیج‌های آمادهٔ Docker Hub اجرا می‌کند (برای سرور داخل ایران یک mirror
     رجیستری بدهید؛ فیلدش چند mirror امتحان‌شده از داخل ایران را پیشنهاد می‌دهد و
     هر mirror که دستی بنویسید برای دفعهٔ بعد نگه داشته می‌شود). گواهی‌ای که
     برنامه‌ای دیگر از قبل برای این دامنه روی سرور گرفته، مثل سروری که دستی راه
     افتاده، از همان‌جا به کار می‌رود: نصب‌کننده خودش پیدایش می‌کند (اول
     `/root/cert/<domain>/` مربوط به 3X-UI، بعد گواهی certbot، acme.sh، Caddy و
     دیگران)، یا پوشه‌ای را که خودتان بدهید به کار می‌برد. به‌طور پیش‌فرض از آن به
     بعد همین سرور آن را در همان پوشه تمدید می‌کند؛ اگر «صاحب فعلی‌اش» را انتخاب
     کنید، تمدید با همان برنامه‌ای می‌ماند که الان این کار را می‌کند. انبار خود یک
     برنامه، مثل `live/` در certbot، همیشه برای همان برنامه می‌ماند. گزینهٔ **یک
     گواهی تازه از Let’s Encrypt** آنچه را آنجاست کنار می‌گذارد و فیلد پوشه را
     پنهان می‌کند؛
   - یا فرمان **deploy.sh** را که پنل نشان می‌دهد روی کامپیوتر خودتان اجرا
     کنید.
5. در **فهرست خانواده**، دکمهٔ **+ نام** را بزنید تا به فهرست امضاشده اضافه
   شود. فهرست امضا می‌شود و به همهٔ سرورها می‌رسد.

ویرایش و حذف هم همین‌طورند. حذف، سرور را از deploy.conf (و اگر بخواهید از فهرست
خانواده) بیرون می‌برد؛ به خود سرور دست نمی‌زند. آنچه پنل در deploy.conf
می‌نویسد فقط نویسه‌های ساده است، پس هیچ‌چیزش وقتی deploy.sh آن را می‌خواند
فرمان نمی‌شود.

**خوشه‌ها.** در بخش خوشه‌ها:

- یک خوشه را با نام و سرورهایش بسازید؛
- نامش را عوض کنید (همهٔ اعضا جابه‌جا می‌شوند)؛
- اعضایش را با تیک‌ها تعیین کنید؛
- به هر عضو نشانی داخلی بدهید؛
- خوشه را حذف کنید.

هر تغییر با کلید ثبت‌شدهٔ همین مرورگر امضا می‌شود، به همهٔ سرورها می‌رسد، و
برای استقرار بعدی در deploy.conf نوشته می‌شود.

**فهرست خانواده و کلید اپراتور.** بخش فهرست خانواده این‌ها را نشان می‌دهد:

- فهرست امضاشده: شناسه، نشانی‌ها، منطقه، خوشه، Gateway و نشانی داخلی هر سرور؛
- کلیدهای ادمین؛
- نسخه‌ای که هر سرور دارد.

تا وقتی هیچ کلید ادمینی ثبت نیست، کلید همین مرورگر با یک کد ثبت می‌شود. از آن
به بعد هر تغییر امضای یک کلید ثبت‌شده را می‌خواهد. کلید اپراتور:

- وقتی نیست **ساخته** می‌شود؛
- از فایل پشتیبان **وارد** می‌شود؛
- از آن **پشتیبان** گرفته می‌شود (یک فایل، بعد از رمز و کد)؛
- از این کامپیوتر **برداشته** می‌شود (یک نسخه کنار deploy.conf می‌ماند)؛
- **عوض** می‌شود. اعتماد همهٔ سرورها یکی‌یکی به کلید تازه منتقل می‌شود: هر
  سرور کلید تازه‌اش را می‌گیرد و همان لحظه فهرستی که با آن امضا شده. اولین
  سروری که شکست بخورد به کلید قبلی برمی‌گردد و به بعدی‌ها دست زده نمی‌شود؛
  اجرای دوباره با همان کلید تازه ادامه می‌دهد.

**حساب من.**

- رمز پنل را عوض کنید؛ نشست‌های دیگر بسته می‌شوند.
- برنامهٔ احراز هویت را عوض کنید: QR و کلید تازه فقط بعد از وارد کردن یک کد از
  آن‌ها جایگزین می‌شوند، پس کسی قفل نمی‌شود.
- نشست‌های دیگر را ببندید.
- آخرین ورودها را ببینید.

نشست‌ها با ری‌استارت پنل از بین نمی‌روند.

**سیستم و رویدادها.** بخش سیستم با کارت همین پنل شروع می‌شود:

- نسخه، مدت روشن بودن و پوشهٔ تنظیمات (قابل نوشتن یا نه)؛
- اینکه کلید اپراتور هست یا نه؛
- راه نگه‌داری پنل.

بخش رویدادهای پنل نشان می‌دهد چه کسی چه کرد. هیچ رمز یا کلیدی هرگز در آن
نوشته نمی‌شود.

**نگه‌داری، از ترمینال:**

```bash
bash scripts/panel.sh doctor
```

```bash
bash scripts/panel.sh backup
```

```bash
bash scripts/panel.sh restore FILE
```

```bash
bash scripts/panel.sh update
```

```bash
bash scripts/panel.sh uninstall
```

- `doctor` این‌ها را بررسی می‌کند: Docker، deploy.conf، همهٔ کلیدها، یک ورود
  SSH به هر سرور، پورت و TLS.
- `backup` و `restore` ورود، اعتماد، چیدمان و نشست‌های پنل را در یک فایل
  می‌ریزند و برمی‌گردانند.
- `update` ایمیج تازه را با همان تنظیمات می‌گیرد.
- `uninstall` کانتینر و ایمیج را برمی‌دارد؛ `--purge` ورود و تنظیمات را هم.

### به‌روزرسانی سرورها (از 2.98.88)

در **سیستم ← به‌روزرسانی سرورها** پنل خودش سرورها را به‌روز می‌کند:

- **نسخهٔ تازه** از پوشهٔ برنامه می‌آید (فقط آنچه دیپلوی لازم دارد فرستاده
  می‌شود: `js`، `css`، `assets`، `fonts`، `vendor`، `scripts`، `config`،
  `tests` و فایل‌های بالای پوشه، هرگز `node_modules`)، یا از یک فایل فشردهٔ آن،
  یا بسته‌ای که قبلاً ساخته شده، یا آخرین انتشار گیت‌هاب که با `SHA256SUMS` آن
  سنجیده می‌شود.
- **ساختن بسته.** پنل ایمیج‌ها را یک بار روی همین کامپیوتر می‌سازد و بسته را با
  کلید اپراتور امضا می‌کند. برای این کار داکرِ همین کامپیوتر لازم است: پنل را با
  `bash scripts/panel.sh update --builds yes` راه بیندازید (ببینید
  [DOCKER.md](DOCKER.md)؛ این سوکت با دسترسی root روی همین کامپیوتر برابر است).
- **فرستادن** به سرورهای انتخاب‌شده، با زمان اعمال:
  - **هوشمند:** وقتی کمترین کاربر آنلاین است (کم‌ترافیک‌ترین یک‌دهم هفتهٔ
    گذشته)، و حداکثر تا یک روز بعد؛
  - **در تاریخ و ساعت مشخص؛**
  - **همین حالا.**

  سروری که هنوز به‌روزرسان ندارد همین یک بار از راه SSH به‌روز می‌شود و از آن به
  بعد به‌روزرسان دارد.
- **زنجیره.** هر سرور هر ده دقیقه از خانواده می‌پرسد چه نسخه‌ای دارند و نسخهٔ
  امضاشدهٔ تازه‌تر را از هر عضوی که به آن دسترسی دارد می‌گیرد؛ دو رله با کلیدهای
  خودشان هویتشان را ثابت می‌کنند. سروری که پنل مستقیم به آن نمی‌رسد از راه بقیه
  به‌روز می‌شود. زمان اعمال فقط وقتی همراه بسته می‌رود که اپراتور آن را امضا کرده
  باشد؛ وگرنه هر سرور منتظر ساعت خلوت خودش می‌ماند.
- **برای کاربران آنلاین،** دو دقیقه پیش از شروع، برنامه می‌گوید سرور در حال
  به‌روزرسانی است و چند دقیقه صبر کنند.
- **آنچه سرور نمی‌پذیرد:** بسته‌ای که با کلید اپراتور امضا نشده، یا از نسخهٔ
  فعلی تازه‌تر نیست. پیش از کار پشتیبان می‌گیرد. به‌روزرسانی ناموفق نسخهٔ قبلی را
  روشن نگه می‌دارد، گزارش می‌شود و خودبه‌خود دوباره تلاش نمی‌شود.
- **جدول** نسخهٔ هر سرور، به‌روزرسانی آماده، مرحله، زمان اعمال، کاربران آنلاین و
  آخرین نتیجه را نشان می‌دهد. **زمان به‌روزرسانی** زمان را عوض می‌کند و **انصراف**
  به‌روزرسانی آماده را کنار می‌گذارد.

### ربات تلگرام (از 2.98.88)

بخش **ربات تلگرام** ربات همهٔ سرورها را، در حالی که رله‌ها روشن‌اند، مدیریت می‌کند.

- **سرورها.** کدام یکی می‌فرستد (توکن و چت دارد)، کدام‌ها هشدارشان را از راه لینک
  رله می‌سپارند، توکن (پوشیده)، چت، زبان، صف و مشکل‌های باز. **آزمایش** از همان
  سرور یک پیام آزمایشی تا خود چت می‌فرستد.
- **تنظیمات سرور انتخاب‌شده:**
  - **ربات و چت:** روشن یا خاموش؛ توکن، که فقط تایپ می‌شود و با چند نویسهٔ آخرش
    نشان داده می‌شود یا برداشته می‌شود؛ شناسهٔ چت، با چت‌هایی که به ربات پیام
    داده‌اند برای انتخاب؛ نام روی کارت‌ها؛ فارسی یا انگلیسی؛ منطقهٔ زمانی؛ و
    شناسهٔ کاربرانی که اجازهٔ دستور دادن دارند؛
  - **دسته‌ها:** بحرانی، هشدار، برطرف شد، یادآوری مشکل باز، راه‌اندازی سرور، کار
    حساس امضاشده، شراکت‌ها، به‌روزرسانی سرور، آزمایش، گزارش روزانه و پیام رله‌های
    قدیمی؛ هر کدام فرستاده شود یا نه و بی‌صدا باشد یا نه (بحرانی همیشه با صداست و
    آزمایش همیشه فرستاده می‌شود)؛
  - **هشدارها و آستانه‌ها:** روشن یا خاموش بودن هر نوع (دیسک، حافظهٔ سرور، حافظهٔ
    رله، فایل‌های باز، خاموشی یا پر شدن TURN، پهنای باند، قطع یا دور زدن لینک یک
    رله)، همهٔ آستانه‌ها، فاصلهٔ بررسی، فاصلهٔ یادآوری و کمترین فاصلهٔ دو پیام؛
  - **ساعت سکوت،** با فرستادن بی‌صدا یا نگه داشتن تا پایانش (پیام بحرانی می‌تواند
    با صدا رد شود)، و **بی‌صدا** برای یک ساعت، هشت ساعت یا یک روز؛
  - **گزارش روزانه** و ساعتش، روشن یا خاموش بودن **هر دستور**، و دکمه‌های
    **بی‌صدا** و **وضعیت** زیر هر هشدار؛
  - **تاپیک‌های گروه:** یک تاپیک برای هشدارها، گزارش‌ها، کارهای حساس،
    به‌روزرسانی‌ها و بقیه، وقتی چت گروهی با تاپیک است؛
  - **کارت:** سطر پایانی با `{server}`، `{host}`، `{level}` و `{time}`، و اینکه
    مشخصات سرور و وضعیت آن روی کارت باشد یا نه.
- **پیش‌نمایش** هر کارتی را همان‌طور که تنظیمات می‌فرستد نشان می‌دهد و می‌گوید با
  صدا می‌رود، بی‌صدا، نگه داشته می‌شود یا اصلاً نمی‌رود.
- **پیام‌های اخیر** آنچه فرستاده شده و آنچه نشده و دلیلش را فهرست می‌کند.
- **ذخیره روی همهٔ سرورها** همین تنظیمات را، بدون توکن و نام، روی همه می‌نویسد.
  **بازگشت به .env** یک سرور را به `.env` خودش برمی‌گرداند.

آنچه پنل تغییر داده روی خود سرور، کنار داده‌هایش، نگه داشته می‌شود
(`telegram-settings.json`، و توکن در `telegram-token` فقط برای صاحبش)؛ برای هر
چیزی که پنل تغییر نداده، `.env` همچنان پیش‌فرض است. ذخیره یک درخواست امضاشده است،
پس روی رلهٔ قفل‌شده فقط کلید مرورگری که در فهرست است می‌تواند.

توکن فقط جای سرور خارجی است. سرور داخلی توکن لازم ندارد: هشدارهایش از راه لینک رله
به سروری که توکن دارد می‌رسد.

### نمودارهای زنده، ساخت و بخش‌ها به‌طور کامل (از 2.98.89)

**نمای کلی.** کاشی‌هایی با وضعیت همین حالا (سرورهای در دسترس، کاربران آنلاین، تماس‌ها،
لینک‌های وصل، پیام در دقیقه، پهنای باند، صف، میانگین پردازنده) و بعد نمودارهای زندهٔ هر
سرور. تا وقتی کسی پنل را باز دارد هر ۲۰ ثانیه همهٔ سرورها خوانده می‌شوند و بقیهٔ وقت هر پنج
دقیقه؛ دو ساعت با همین فاصله و یک هفته میانگین پنج‌دقیقه‌ای نگه داشته می‌شود و هفته در پوشهٔ
وضعیت پنل ذخیره می‌شود تا با راه‌اندازی دوباره از دست نرود. نمودارها تک‌سرور، بر اساس خوشه،
بر اساس منطقه یا همه با هم کشیده می‌شوند، در دسته‌های منابع (پردازنده، حافظه، سهم از سقف
کانتینر، دیسک)، ترافیک (پیام ورودی و خروجی در دقیقه، پهنای باند، رله‌شده)، کاربران (آنلاین،
تماس) و شبکه (لینک‌های وصل، صف و حجم آن، در دسترس بودن). برای گروهی از سرورها، جایی که جمع
معنا دارد خط جمع هم کشیده می‌شود. بازه از ۱۵ دقیقه تا ۷ روز است؛ نمودارها هر ۱۵ ثانیه خودشان
تازه می‌شوند بی‌آنکه بقیهٔ صفحه دوباره کشیده شود، و اشاره‌گر مقدار هر سرور را در همان لحظه
نشان می‌دهد. کارت‌های سرورها هم به همان شکل دسته‌بندی می‌شوند.

**شبکه.** زیربخش‌ها: نقشه، گره‌ها (هر رله، شریک و گرهٔ بیرونی با خوشه، منطقه، جای Gateway،
وضعیت، لینک‌های وصل و نشانی‌های داخلی)، پیوندها (بر اساس نوع، وضعیت یا جفت خوشه)، ترتیب
Gatewayها و جستجوی شریک. نقشه می‌تواند فقط یک خوشه، فقط پیوندهای قطع یا بدون شریک‌ها را نشان
دهد؛ «چیدمان از نو» جای ذخیره‌شدهٔ همهٔ گره‌ها را فراموش می‌کند و JSON نقشه را بیرون می‌دهد.

**خوشه‌ها.** هر خوشه در یک نگاه (سرورهای در دسترس، کاربران، لینک‌های درون خوشه و به خوشه‌های
دیگر، اینکه به‌تنهایی سرپا می‌ماند یا نه)، با اقدام روی همهٔ سرورهایش با هم (پشتیبان، بهینه‌سازی
حافظه، ارسال دوبارهٔ صف، آزمایش هشدار، راه‌اندازی دوباره) و «فقط همین را نشان بده». خوشه‌ها
ساخته، پر، تغییر نام داده، ادغام و حذف می‌شوند و سرور بین آن‌ها جابه‌جا می‌شود. **نشانی داخلی**
برای همهٔ سرورها هست، سرور خارج از ایران هم: سرور خارجی‌ای که نشانی با IP خالی دارد
(`https://<IP>:8585`) وقتی DNSها کلاً از دسترس خارج شوند باز هم برای هم‌خوشه‌ها و رله‌های دیگر
در دسترس است، و جدول نشان می‌دهد کدام سرورها بدون نام هم پیدا می‌شوند. دکمهٔ «نشانی SSH» این
نشانی را از deploy.conf پیشنهاد می‌دهد. جای Gateway هر رله در فهرست امضاشده هم همین‌جا تنظیم
می‌شود.

**شریک‌ها** بخش خودش را دارد: هر شریک یک بار (خانواده شریک‌ها را با هم دارد)، دسته‌بندی‌شده بر
اساس وضعیت، با پذیرش، رد و قطع؛ جستجو و درخواست شریک تازه؛ سمت ما (حمل بین شریک‌ها،
Gatewayهای ما)؛ و یادداشت خود مدیر دربارهٔ هر شریک (نام، راه تماس، برچسب، یادداشت) که فقط روی
همین پنل می‌ماند و به هیچ سروری فرستاده نمی‌شود.

**صف‌های پیام:** خلاصه با نمودار، جمع هر سرور، صندوق‌ها بر اساس سرور، خوشه، منطقه، اندازه یا عمر،
و دفتر انقضا بر اساس علت. **کاربران:** آنلاین‌ها دسته‌بندی‌شده؛ کاربران هر رله؛ رله‌های در
ارتباط (ماتریس همهٔ لینک‌ها با آنچه حمل کرده‌اند و کاربرانی که اخیراً از لینک گذشته‌اند)؛
محدودشده‌ها؛ اجازه‌نامه؛ و مرکز پیام که به همهٔ سرورها، یک خوشه، یک سرور (رله) یا سرورهای
انتخابی می‌فرستد. **رله‌ها:** خلاصه با نمودار، لینک‌ها بر اساس سرور، خوشه، وضعیت، نوع یا رلهٔ
مقابل، رله‌های خانواده و اینکه کدام سرور ما به هر کدام لینک دارد، و Gatewayها. **ترافیک:**
نمودارهای زندهٔ ترافیک بر اساس سرور، خوشه یا منطقه، سهم هر سرور، خوشه و منطقه، پرترافیک‌ترین
کاربران و ترافیک بین رله‌ها.

**گزارش‌ها:** هر سرور در سه سطح (خلاصه، معمولی، کامل)، تماس‌های زنده، رویدادهای سرورها (بر
اساس نوع، سرور، خوشه یا روز)، رویدادهای خود پنل (دفتر رویدادهای پنل که قبلاً بخش جدا بود) و
مرکز خروجی: هر کدام از پانزده جدول، برای همهٔ سرورهای نمایش‌داده‌شده، یک خوشه یا یک سرور، در یک
سطح، با قالب CSV، TSV، JSON، کتاب اکسل (هر جدول یک برگه)، گزارش HTML قابل چاپ (و در نتیجه PDF)
یا Markdown. فایل در خود صفحه ساخته می‌شود.

**عملیات سرورها** همان بخش‌های «سرور و پشتیبان»، «سیستم» و «نصب خام» است در یک بخش با
زیربخش‌ها: ماشین سرورها و اقدام روی همه، پشتیبان‌ها (دسته‌بندی‌شده)، به‌روزرسانی (از همین
کامپیوتر — یک ساخت، یک پوشه یا یک فایل فشرده — یا از گیت‌هاب، امضاشده و زنجیره‌ای در خلوت‌ترین
ساعت، و اعمال و برگرداندن خود گیت‌هاب)، کانتینرها (حافظه و پردازنده بر اساس سرور، خوشه یا
کانتینر، با نمودار و سقف‌ها)، ایمیج‌ها و پاک‌سازی، نصب و پیش‌نیازها، و سیستم.

**ساخت و بسته‌بندی.** پوشهٔ برنامه روی کامپیوتر اپراتور در صفحه داده می‌شود، بررسی می‌شود
(برنامهٔ P00RIJA هست یا نه، نسخه، کامیت و فایل‌ها) و در همان پوشه، در `dist/server/<نسخه>/`،
با `scripts/build-server-package.sh` ساخته می‌شود؛ این اسکریپت دستی هم در هر کلون اجرا می‌شود:

```bash
bash scripts/build-server-package.sh            # آرشیو و ایمیج‌های سرور
bash scripts/build-server-package.sh --all      # و ایمیج‌های Docker Hub
bash scripts/build-server-package.sh --push     # انتشار در Docker Hub (پس از docker login)
```

از صفحه: بستهٔ به‌روزرسانی امضاشده (با ایمیج‌های سرور و آرشیو)، ایمیج‌های Docker Hub به صورت
آرشیو (با بررسی نشت رشته‌های خصوصی `dockerhub-release.sh`) و انتشار در Docker Hub پس از ورودی
که در صفحه انجام می‌شود. هر فایل در `SHA256SUMS` و هر اجرا در `build.json` ثبت می‌شود. ساخته‌ها
بر اساس نسخه فهرست می‌شوند: هر فایل دانلود می‌شود، بستهٔ به‌روزرسانی از راه به‌روزرسانی سرورها
می‌رود، و آرشیو ایمیج روی سرورها کپی و با `docker load` بارگذاری می‌شود (سروری که با
`docker-install.sh` نصب شده با همان نسخه دوباره بالا می‌آید). پنل فقط پوشه‌ای را می‌بیند که به
آن داده شده: `bash scripts/panel.sh update --builds yes` همان کلونی را که اسکریپت در آن است با
همان مسیر می‌دهد، و `--source DIR` پوشهٔ دیگری را.

**پیش‌نیازها.** نصب روی سرور تازه اول داکر، افزونهٔ compose و ابزارهای کوچک را می‌گذارد
(`scripts/lib/server-prereqs.sh` که از راه SSH فرستاده می‌شود)، فقط آنچه نیست. داکر از مخزن
خود داکر، یا میرور آن (برای سرور داخل ایران اول میرورهای در دسترس آن‌جا)، یا از بسته‌های خود
توزیع لینوکس گرفته می‌شود. دو کلید امضای داکر داخل خود اسکریپت نوشته شده‌اند و مخزن با همان‌ها
تنظیم می‌شود؛ پس apt و dnf هر بسته را با کلید خود داکر می‌سنجند و هیچ میروری نمی‌تواند کلید یا
بستهٔ خودش را جا بزند. سروری که به هیچ‌کدام نرسد، فایل‌های
دودویی ایستای داکر و افزونهٔ compose را از خود پنل می‌گیرد که آن‌ها را دانلود و از همان SSH کپی
می‌کند؛ پس هر سروری که SSH به آن برسد داکر می‌گیرد. سرور داخل ایران اگر `/etc/docker/daemon.json`
هیچ میرور رجیستری نداشته باشد، میرورهای رجیستری هم می‌گیرد. «بررسی» و «نصب پیش‌نیازها» در
عملیات سرورها ← نصب و پیش‌نیازها و روی ردیف هر سرور در بخش سرورها هستند.

**راهنمای پنل** و **درباره پروژه** در انتهای نوار کناری‌اند: کار هر بخش، چند نکته، و شرح خود
پروژه همراه با شرح پنل.

### مدیران، طرح کارت، sudo و صفحه‌ای سریع‌تر (از 2.98.90)

**مدیران.** بخش مدیران فهرست مدیران خانواده را نشان می‌دهد، هر کدام با کلید امضای خودش (که در
مرورگر خودش، در «کلید این مرورگر»، ساخته)، و افزودن یا برداشتن مدیر فهرست امضاشدهٔ خانواده را
عوض می‌کند. هر مدیر یک **کلید جعبه** هم در مرورگر خودش می‌سازد («کلیدهای من»): نیمهٔ خصوصی آن
هرگز از آن مرورگر بیرون نمی‌رود و نیمهٔ عمومی‌اش سطر کوتاهی است که به بقیه می‌دهد؛ آن‌ها پیش از
گذاشتنش اثرانگشت را از راه دیگری با خودش تطبیق می‌دهند.

**فرستادن تنظیمات پنل برای مدیر دیگر.** در «فرستادن تنظیمات» مدیر و آنچه فرستاده می‌شود انتخاب
می‌شود: فهرست سرورها، میرورها، یادداشت شریک‌ها، چیدمان نقشه، انتخاب‌های صفحه، تنظیمات ربات (هرگز
توکن). کلید اپراتور، کلیدهای SSH، رمز داشبورد سرورها، توکن تلگرام و ورود پنل هرگز در آن نیست.
صفحه آن را در مرورگر فرستنده قفل می‌کند:

    ecdh   = ECDH(کلید تازه، کلید جعبهٔ گیرنده)
    pw     = PBKDF2-SHA-256(رمز، salt، ۶۰۰٬۰۰۰ دور)
    key    = HKDF-SHA-256(ecdh || pw، salt، "p00rija-share-v1|<to>|<from>")
    sealed = AES-256-GCM(key، iv، تنظیمات)، سرآیند به‌عنوان دادهٔ همراه
    sig    = ECDSA-P-256(کلید امضای فرستنده، همهٔ این‌ها)

رمز باید پیچیده باشد (دست‌کم ۱۶ نویسه، از همهٔ انواع، بی‌تکرار، بی‌واژهٔ آشنا)؛ «ساختن رمز قوی»
یکی می‌سازد. فایل از یک راه می‌رود و رمز از راهی دیگر. در «دریافت تنظیمات» گیرنده فایل را در
مرورگر خودش با رمز باز می‌کند: باز نمی‌شود مگر برای کلید جعبهٔ همان مرورگر قفل شده باشد، امضایش
درست باشد و کلید امضای فرستنده در فهرست مدیران خانواده باشد. اول محتوایش نشان داده می‌شود؛ اعمالش
کد دومرحله‌ای می‌خواهد، هر بخش دوباره روی پنل مثل چیزی که در صفحه تایپ شده بررسی می‌شود، و تنظیمات
ربات به سرورهای هم‌نام با امضای مرورگر خود گیرنده می‌رود.

**طرح کارت‌های تلگرام.** شش طرح: کلاسیک، کادردار (سرور و پیام در کادر، وضعیت در کادر جمع‌شونده)،
فشرده، ساده، کامل و طراحی خودتان؛ و برای هر کدام خط جداکننده، جهت متن، نمادها و کادر یا کادر
جمع‌شونده برای وضعیت سرور. طراحی خودتان قالبی است با جاها (`{icon} {kind} {server} {host} {title}
{body} {message} {identity} {snapshot} {time} {version} {cluster} {region} {users} {queue} {cpu}
{memory} {disk} {links} {footer} {rule}`) و نشانه‌ها (`**پررنگ**`، `__کج__`، `~~خط‌خورده~~`،
`` `کد` ``، `||پنهان||`، سطری که با `> ` شروع شود در کادر و با `>> ` در کادر جمع‌شونده)؛ هر چیز
دیگر در آن متن است. همهٔ طرح‌ها کنار هم دیده می‌شوند، با تنظیمات همان فرم و پیش از ذخیره، به
دست خود رله. تلگرام پیام ربات را خودش می‌کشد و هیچ رباتی رنگ، گوشه یا شفافیت آن را تعیین
نمی‌کند؛ کادر تلگرام همان جعبهٔ گوشه‌گرد و نیمه‌شفاف با لبهٔ رنگی است و طرح‌ها از آن استفاده
می‌کنند. هر سطر کارت با علامت جهت شروع می‌شود، پس کارت فارسی در هر تلگرامی راست به چپ و کارت
انگلیسی چپ به راست خوانده می‌شود. کارتی که بیش از اندازه بلند باشد از پیامش کوتاه می‌شود و هرگز از
میان نشانه‌گذاری‌اش بریده نمی‌شود (تلگرام کارت با نشانه‌گذاری شکسته را نمی‌پذیرد).

**رباتی که توکن دارد.** آزمایش هر سرور از کلید اصلی ربات همان سرور پیروی می‌کند. سروری که ربات
آن خاموش است، به‌جای فرستادن آزمایشی که می‌رسد در حالی که کارت‌های سپرده‌شده به آن دور ریخته
می‌شوند، می‌گوید خاموش است. پس از آزمایش سروری که توکن ندارد، پنل دفتر سرور صاحب توکن را می‌خواند
و می‌گوید کارت فرستاده شد یا چرا نه. وقتی ربات صاحب توکن خاموش باشد، بالای بخش تلگرام گفته می‌شود.

**sudo.** پنجرهٔ نصب گزینهٔ «کاربر SSH این سرور دسترسی sudo دارد» و جای رمز sudo دارد (برای sudo
که رمز می‌خواهد). «آزمایش دسترسی» می‌گوید کاربر آن‌جا چه می‌تواند: root، sudo بدون رمز، sudo با
همین رمز، sudo که رمز می‌خواهد، یا هیچ‌کدام. هر نصب با همین بررسی شروع می‌شود و اگر گفته شده کاربر
sudo دارد ولی sudo کار نکند، همان‌جا می‌ایستد. رمز درون اتصال SSH و در یک here-document نقل‌قول‌شده
می‌رود، sudo را یک بار برای همان نشست باز می‌کند و فراموش می‌شود: هرگز روی خط فرمان نیست و در هیچ
فایلی نوشته نمی‌شود. هر بررسی فقط یک بار امتحانش می‌کند (رمز اشتباهی که بارها امتحان شود می‌تواند
حساب را قفل کند). نصب پیش‌نیازها کاربر را به گروه docker هم اضافه می‌کند.

**نمودارهای زنده و صفحه.** نمای کلی هر ۱، ۳، ۵، ۱۰، ۳۰ یا ۶۰ ثانیه تازه می‌شود. پنل هم سرورها را با
همان سرعت می‌خواند: مسیر سبک هر بار و مسیرهای سنگین حداکثر هر ۵ ثانیه. هر پاسخ به اندازهٔ نقطه‌هایی
که نمودار جا دارد کوچک می‌شود. «سرور» یک سرور را به‌تنهایی نشان می‌دهد: همهٔ نمودارهایش، عددهایش و
کارتش. خواندن‌ها چند ثانیه بین بخش‌ها مشترک است و دادهٔ همهٔ بخش‌ها پس از ورود در پس‌زمینه خوانده
می‌شود، پس رفتن بین بخش‌ها فوری است. هنگام شروع صفحه یک صفحهٔ بارگذاری هست، و اگر طول بکشد دکمهٔ
بارگذاری دوباره دارد. بخشی که بار اول خوانده می‌شود چرخنده نشان می‌دهد، هنگام هر خواندن نوار باریکی
دیده می‌شود، و وقتی پنل پاسخ ندهد یک نوار هشدار می‌گوید. هر جدول سرورها تک‌تک، بر اساس خوشه یا بر
اساس منطقه نشان داده می‌شود، و سرورها، شریک‌ها و عملیات سرورها هم نمودار گرفته‌اند.

### اجرا روی سرور

شدنی است، با همان هشدار بالا. آن را با گواهی سرور روی HTTPS بالا بیاورید (همان
گواهی که 3X-UI استفاده می‌کند کار می‌کند) و نشانی‌ای را که مرورگرها باز می‌کنند به آن
بگویید:

```bash
POORIJA_PANEL_HOST=0.0.0.0 POORIJA_PANEL_PORT=8686 \
POORIJA_PANEL_ORIGINS=https://panel.example.com:8686 \
POORIJA_PANEL_TLS_CERT=/root/cert/example.com/fullchain.pem \
POORIJA_PANEL_TLS_KEY=/root/cert/example.com/privkey.pem \
node tools/panel/server.mjs
```

اگر پشت reverse proxy است، `POORIJA_PANEL_SECURE_COOKIE=1` و
`POORIJA_PANEL_TRUSTED_PROXY` را برابر نشانی پروکسی بگذارید تا ورودهای ناموفق
نشانی‌ای را قفل کنند که پروکسی نام می‌برد، نه همه را.

### آنچه نگه می‌دارد و آنچه هرگز نمی‌کند

- `control-panel.log` در `/state`: چه کسی چه کاری روی کدام سرور کرد و با امضا بود یا
  نه؛ هرگز رمز.
- رمز پنل‌ها را هرگز روی دیسک نمی‌نویسد، اپراتور خانواده را هرگز به گفتهٔ یک سرور
  نمی‌پذیرد (کلید اپراتور کنار `deploy.conf` یا شناسه‌ای که شما تأیید کرده‌اید)، و برای
  سروری که هویتش با فهرست امضاشدهٔ خانواده نمی‌خواند هرگز امضا نمی‌کند.
- صفحه هیچ اسکریپتی جز اسکریپت خودش اجرا نمی‌کند و هر مقداری که سرور می‌فرستد پیش
  از نمایش escape می‌شود.

متغیرهای محیطی همان جدول بخش انگلیسی‌اند.
