/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

/* The certificate keeper (scripts/cert-renewer.sh), in the image the servers
 * run it in, against folders laid out the way a server's are:
 *
 *   - a shared folder holding a new certificate beside an old key — what
 *     3X-UI was left with on one server — is repaired from Let's Encrypt's
 *     copy, and a placeholder self-signed certificate is replaced by it;
 *   - a folder that already serves Let's Encrypt's certificate is left alone;
 *   - someone else's folder is never written to: a broken pair or a near
 *     expiry is reported, and a key another account owns is not taken;
 *   - a change made from outside is noticed;
 *   - a self-signed certificate is made for every name and address, again
 *     when it runs low, and a CA's certificate in its place is not replaced;
 *   - the renewal window is ten days, or a third of a six-day certificate's
 *     life; an address is asked for on the short-lived profile; a private
 *     address is never sent to Let's Encrypt;
 *   - the installer finds the pair in a folder someone already has (3X-UI's,
 *     acme.sh's, certbot's) by its public key, not its name, and refuses a
 *     certificate beside a key that is not its own.
 *
 * Needs docker and the renewer image (config-cert-renewer, built by compose).
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n===== ${title} =====`);

const SCRIPT = fileURLToPath(new URL('../../scripts/cert-renewer.sh', import.meta.url));
const FOLDER_LIB = fileURLToPath(new URL('../../scripts/lib/cert-folder.sh', import.meta.url));
const IMAGE = process.env.CERT_RENEWER_IMAGE || 'config-cert-renewer';

if (spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status !== 0) {
  console.log(`docker or the ${IMAGE} image is missing — build it with: docker compose -f config/docker-compose.yaml build cert-renewer`);
  process.exit(1);
}

/* One shell run in a fresh container: the helpers below, then `body`. Each
   case gets its own empty /w. */
const HELPERS = String.raw`
set -u
cd /w
ago() { date -u -d @$(( $(date +%s) - $1 * 86400 )) +%Y%m%d%H%M%SZ; }
ahead() { date -u -d @$(( $(date +%s) + $1 * 86400 )) +%Y%m%d%H%M%SZ; }
mkdir -p ca/new && : > ca/index.txt && echo 1000 > ca/serial
cat > ca/ca.cnf <<'EOF'
[ ca ]
default_ca = d
[ d ]
dir = /w/ca
database = $dir/index.txt
new_certs_dir = $dir/new
serial = $dir/serial
default_md = sha256
policy = any
copy_extensions = copy
unique_subject = no
[ any ]
commonName = supplied
EOF
openssl req -x509 -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -days 30 -subj /CN=TestCA -keyout ca/ca.key -out ca/ca.pem >/dev/null 2>&1
# leaf <name> <days ago it began> <days ahead it ends>: <name>.pem + <name>.key, CA-signed
leaf() {
  openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -subj "/CN=relay.example" \
    -addext "subjectAltName=DNS:relay.example" -keyout "$1.key" -out "$1.csr" >/dev/null 2>&1
  openssl ca -batch -notext -config ca/ca.cnf -cert ca/ca.pem -keyfile ca/ca.key -in "$1.csr" -out "$1.pem" \
    -startdate "$(ago "$2")" -enddate "$(ahead "$3")" >/dev/null 2>&1
}
fp() { openssl x509 -noout -fingerprint -sha256 -in "$1" | cut -d= -f2; }
sum() { md5sum "$1" | cut -d' ' -f1; }
lineage() { # a Let's Encrypt lineage for relay.example from leaf $1
  mkdir -p le/live/relay.example le/renewal
  cat "$1.pem" ca/ca.pem > le/live/relay.example/fullchain.pem
  cp "$1.key" le/live/relay.example/privkey.pem
  printf 'version = 5.8.0\n[renewalparams]\nauthenticator = standalone\n' > le/renewal/relay.example.conf
}
mkdir -p folder
export CERT_DEPLOY_DIR=/w/folder LETSENCRYPT_DIR=/w/le SEEN_FILE=/w/seen CHECK_INTERVAL_SECONDS=1
run() { sh /r.sh "$@" 2>&1; }
`;

function inContainer(body, env = {}) {
  const args = ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'sh',
    '-v', `${SCRIPT}:/r.sh:ro`, '-v', `${FOLDER_LIB}:/lib.sh:ro`, '--tmpfs', '/w'];
  for (const [key, value] of Object.entries(env)) args.push('-e', `${key}=${value}`);
  args.push(IMAGE, '-s');
  const out = spawnSync('docker', args, { input: HELPERS + body, encoding: 'utf8', timeout: 120000 });
  return `${out.stdout || ''}${out.stderr || ''}`;
}
const line = (out, key) => (out.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1] || '';

section('Let\'s Encrypt into a shared folder');
{
  const out = inContainer(String.raw`
leaf live 10 80
lineage live
leaf old 100 -10
# The folder 3X-UI was left with: the live certificate beside an old key.
cp le/live/relay.example/fullchain.pem folder/fullchain.pem
cp old.key folder/privkey.pem
run --once > log1
echo "LOG1=$(tr '\n' '|' < log1)"
echo "SAME=$([ "$(fp folder/fullchain.pem)" = "$(fp le/live/relay.example/fullchain.pem)" ] && echo yes)"
echo "PAIR=$(CERT_RENEWER_LIBRARY=1 sh -c '. /r.sh; pair_ok folder/fullchain.pem folder/privkey.pem && echo yes')"
echo "KEYMODE=$(stat -c '%u %a' folder/privkey.pem)"
echo "CERTMODE=$(stat -c '%a' folder/fullchain.pem)"
before=$(sum folder/fullchain.pem)
run --once > log2
echo "LOG2=$(tr '\n' '|' < log2)"
echo "UNTOUCHED=$([ "$before" = "$(sum folder/fullchain.pem)" ] && echo yes)"
`, { CERT_MODE: 'letsencrypt', DOMAIN: 'relay.example', CERT_FILE: 'fullchain.pem', KEY_FILE: 'privkey.pem' });
  check('a new certificate beside an old key is found broken and replaced', /do not belong together — replacing/.test(line(out, 'LOG1')), line(out, 'LOG1').slice(0, 200));
  check('the folder now holds Let\'s Encrypt\'s certificate with its own key', line(out, 'SAME') === 'yes' && line(out, 'PAIR') === 'yes');
  check('the key is readable by the TURN server\'s user only, the certificate by all', line(out, 'KEYMODE') === '65534 400' && line(out, 'CERTMODE') === '644', `${line(out, 'KEYMODE')} / ${line(out, 'CERTMODE')}`);
  check('the next pass finds it healthy and writes nothing', /certificate healthy — \d+d remaining/.test(line(out, 'LOG2')) && line(out, 'UNTOUCHED') === 'yes', line(out, 'LOG2').slice(0, 160));
}
{
  const out = inContainer(String.raw`
leaf live 10 80
lineage live
CERT_MODE=self-signed DOMAIN=relay.example run --once >/dev/null
echo "PLACEHOLDER=$(openssl x509 -noout -issuer -in folder/cert.pem)"
run --once > log
echo "LOG=$(tr '\n' '|' < log)"
echo "SAME=$([ "$(fp folder/cert.pem)" = "$(fp le/live/relay.example/fullchain.pem)" ] && echo yes)"
`, { CERT_MODE: 'letsencrypt', DOMAIN: 'relay.example' });
  check('a fresh install\'s placeholder is replaced by Let\'s Encrypt\'s certificate', /P00RIJA/.test(line(out, 'PLACEHOLDER')) && line(out, 'SAME') === 'yes', line(out, 'LOG').slice(0, 160));
}

section('someone else\'s folder');
{
  const out = inContainer(String.raw`
leaf a 10 80
leaf b 10 80
cp a.pem folder/cert.pem; cp b.key folder/key.pem
before="$(sum folder/cert.pem) $(sum folder/key.pem)"
run --once > log1
echo "LOG1=$(tr '\n' '|' < log1)"
echo "KEPT=$([ "$before" = "$(sum folder/cert.pem) $(sum folder/key.pem)" ] && echo yes)"
leaf soon 80 5
cp soon.pem folder/cert.pem; cp soon.key folder/key.pem; chown 1000:1000 folder/key.pem; chmod 600 folder/key.pem
run --once > log2
echo "LOG2=$(tr '\n' '|' < log2)"
echo "OWNER=$(stat -c '%u %a' folder/key.pem)"
`, { CERT_MODE: 'existing', DOMAIN: 'relay.example' });
  check('a broken pair is reported and nothing in the folder is written', /do not belong together/.test(line(out, 'LOG1')) && line(out, 'KEPT') === 'yes', line(out, 'LOG1').slice(0, 160));
  check('a near expiry is reported as the owner\'s to renew', /expires in [0-9]+d; whoever owns the folder renews it/.test(line(out, 'LOG2')), line(out, 'LOG2').slice(0, 200));
  check('a key another account owns is not taken from it', line(out, 'OWNER') === '1000 600' && /belongs to uid 1000/.test(line(out, 'LOG2')), line(out, 'OWNER'));
}
{
  const out = inContainer(String.raw`
leaf a 10 80
leaf b 10 80
cp a.pem folder/cert.pem; cp a.key folder/key.pem
run --once >/dev/null
cp b.pem folder/cert.pem; cp b.key folder/key.pem
run --once > log
echo "LOG=$(tr '\n' '|' < log)"
`, { CERT_MODE: 'existing', DOMAIN: 'relay.example' });
  check('a certificate changed from outside is noticed, and what reads it restarted', /changed — restarting what reads it/.test(line(out, 'LOG')), line(out, 'LOG').slice(0, 200));
}

section('self-signed');
{
  const out = inContainer(String.raw`
run --once > log1
echo "LOG1=$(tr '\n' '|' < log1)"
echo "SANS=$(openssl x509 -noout -ext subjectAltName -in folder/cert.pem | tail -1)"
echo "KEYMODE=$(stat -c '%u %a' folder/key.pem)"
first=$(fp folder/cert.pem)
run --once > log2
echo "STABLE=$([ "$first" = "$(fp folder/cert.pem)" ] && echo yes)"
run --renew-now > /dev/null
echo "REMADE=$([ "$first" != "$(fp folder/cert.pem)" ] && echo yes)"
`, { DOMAIN: '192.168.1.20', EXTERNAL_IP: '192.168.1.20', CERT_SANS: 'lan.example,IP:10.0.0.7' });
  const sans = line(out, 'SANS');
  check('an address with no CERT_MODE gets a self-signed certificate', /made a self-signed certificate/.test(line(out, 'LOG1')), line(out, 'LOG1').slice(0, 160));
  check('it names localhost, the address, and every extra name', ['DNS:localhost', 'IP Address:127.0.0.1', 'IP Address:192.168.1.20', 'DNS:lan.example', 'IP Address:10.0.0.7'].every((name) => sans.includes(name)), sans);
  check('its key is the TURN server\'s to read', line(out, 'KEYMODE') === '65534 400', line(out, 'KEYMODE'));
  check('a healthy one is kept; --renew-now makes a new one', line(out, 'STABLE') === 'yes' && line(out, 'REMADE') === 'yes');
}
{
  const out = inContainer(String.raw`
leaf ca 10 80
cp ca.pem folder/cert.pem; cp ca.key folder/key.pem
before=$(sum folder/cert.pem)
run --once > log
echo "KEPT=$([ "$before" = "$(sum folder/cert.pem)" ] && echo yes)"
`, { DOMAIN: 'localhost' });
  check('a CA\'s certificate put in a self-signed folder is not replaced', line(out, 'KEPT') === 'yes');
}

section('when, and for what');
{
  const out = inContainer(String.raw`
leaf far 70 20; leaf near 81 9; leaf short_ok 3 3; leaf short_due 5 1
for c in far near short_ok short_due; do
  echo "DUE_$c=$(CERT_RENEWER_LIBRARY=1 sh -c ". /r.sh; due $c.pem && echo due || echo kept")"
done
echo "HOLDER=$(CERT_RENEWER_LIBRARY=1 sh -c '. /r.sh
docker() { case "$1" in
  ps) printf "app\ncaddy\n" ;;
  port) [ "$2" = caddy ] && printf "80/tcp -> 0.0.0.0:80\n80/tcp -> [::]:80\n443/tcp -> 0.0.0.0:8443\n" || printf "8585/tcp -> 0.0.0.0:8585\n" ;;
  inspect) [ "$2" = caddy ] && echo "\"HostPort\": \"80\"" || echo "\"HostPort\": \"8585\"" ;;
esac; }
netstat() { :; }
printf "%s|%s|%s|%s" "$(port_holder 80)" "$(port_holder 443)" "$(port_holder 8585)" "$(port_holder 8080)"')"
echo "ID_NAME=$(DOMAIN=relay.example CERT_RENEWER_LIBRARY=1 sh -c '. /r.sh; le_identifier')"
echo "ID_IP=$(DOMAIN=203.0.113.10 CERT_RENEWER_LIBRARY=1 sh -c '. /r.sh; le_identifier')"
CERT_MODE=letsencrypt DOMAIN=10.1.2.3 run --once > log
echo "PRIVATE=$(tr '\n' '|' < log)"
echo "BADMODE=$( { CERT_MODE=whatever DOMAIN=x run --once; echo "exit $?"; } | tr '\n' '|')"
CERT_MODE=self-signed DOMAIN=localhost CERTS_DIR_ON_HOST=/root/cert/x SSL_CERT_PATH_ON_HOST=/home/other/cert.pem run --status > log3
echo "MISMATCH=$(tr '\n' '|' < log3)"
`);
  check('a 90-day certificate with 20 days left is kept', line(out, 'DUE_far') === 'kept');
  check('with 9 days left it is renewed', line(out, 'DUE_near') === 'due');
  check('a six-day certificate is kept with half its life left', line(out, 'DUE_short_ok') === 'kept');
  check('and renewed with less than a third left', line(out, 'DUE_short_due') === 'due');
  check('a container publishing port 80 is found, and only for the port it publishes',
    line(out, 'HOLDER') === 'container:caddy||container:app|', line(out, 'HOLDER'));
  check('a name is asked for as a name', line(out, 'ID_NAME') === '-d relay.example', line(out, 'ID_NAME'));
  check('an address is asked for on the short-lived profile', line(out, 'ID_IP') === '--ip-address 203.0.113.10 --required-profile shortlived', line(out, 'ID_IP'));
  check('a private address is never sent to Let\'s Encrypt', /cannot certify "10.1.2.3"/.test(line(out, 'PRIVATE')) && /self-signed/.test(line(out, 'PRIVATE')), line(out, 'PRIVATE').slice(0, 200));
  check('an unknown mode stops the keeper', /FATAL: CERT_MODE/.test(line(out, 'BADMODE')) && /exit 1/.test(line(out, 'BADMODE')));
  check('files nginx reads elsewhere than the kept folder are pointed out', /SSL_CERT_PATH .* is not CERTS_DIR\/CERT_FILE/.test(line(out, 'MISMATCH')), line(out, 'MISMATCH').slice(0, 200));
}

section('finding the certificate in a folder someone already has');
{
  const out = inContainer(String.raw`
leaf live 10 80
leaf old 100 -10
find_in() { bash -c ". /lib.sh; if cert_find_pair \"\$1\" \"\$2\"; then echo \"\$CERT_PAIR_CERT \$CERT_PAIR_KEY covers=\$CERT_PAIR_COVERS days=\$CERT_PAIR_DAYS self=\$CERT_PAIR_SELF_SIGNED\"; else echo \"NONE \$CERT_PAIR_REASON\"; fi" _ "$1" "$2"; }
mkdir -p xui acme plain broken empty
cat live.pem ca/ca.pem > xui/fullchain.pem; cp live.key xui/privkey.pem; echo hi > xui/README
echo "XUI=$(find_in /w/xui relay.example)"
echo "OTHER=$(find_in /w/xui other.example)"
cp live.pem acme/relay.example.cer; cat live.pem ca/ca.pem > acme/fullchain.cer; cp ca/ca.pem acme/ca.cer
cp live.key acme/relay.example.key; cp live.csr acme/relay.example.csr; echo "Le_Domain='relay.example'" > acme/relay.example.conf
echo "ACME=$(find_in /w/acme relay.example)"
cp live.pem plain/server.crt; cp live.key plain/server.key
echo "PLAIN=$(find_in /w/plain relay.example)"
cat live.pem ca/ca.pem > broken/fullchain.pem; cp old.key broken/privkey.pem
echo "BROKEN=$(find_in /w/broken relay.example)"
echo "EMPTY=$(find_in /w/empty relay.example)"
echo "MISSING=$(find_in /w/nowhere relay.example)"
echo "PUBLIC=$(bash -c '. /lib.sh; for h in relay.example 203.0.113.10 2001:db8::1 fdroid.org localhost 192.168.1.5 10.0.0.1 100.64.1.1 fd00::1 box.local intranet; do cert_publicly_certifiable "$h" && printf "%s:yes " "$h" || printf "%s:no " "$h"; done')"
`);
  check('3X-UI\'s folder: fullchain.pem with privkey.pem, and it names the host',
    /^fullchain\.pem privkey\.pem covers=yes days=(79|80) self=no$/.test(line(out, 'XUI')), line(out, 'XUI'));
  check('a certificate for another name is said not to cover it', /covers=no/.test(line(out, 'OTHER')), line(out, 'OTHER'));
  check('acme.sh\'s folder: the full chain and the domain key, not the CA or the request',
    /^fullchain\.cer relay\.example\.key /.test(line(out, 'ACME')), line(out, 'ACME'));
  check('any names, matched by the key they hold', /^server\.crt server\.key /.test(line(out, 'PLAIN')), line(out, 'PLAIN'));
  check('a certificate beside a key that is not its own is refused, and why', /^NONE .*no key belongs to any certificate/.test(line(out, 'BROKEN')), line(out, 'BROKEN'));
  check('an empty folder and a missing one are said to be so', /^NONE No certificate and private key/.test(line(out, 'EMPTY')) && /^NONE There is no folder/.test(line(out, 'MISSING')));
  check('only public names and addresses are offered Let\'s Encrypt',
    line(out, 'PUBLIC').trim() === 'relay.example:yes 203.0.113.10:yes 2001:db8::1:yes fdroid.org:yes localhost:no 192.168.1.5:no 10.0.0.1:no 100.64.1.1:no fd00::1:no box.local:no intranet:no', line(out, 'PUBLIC'));
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n===== ${failed} failed of ${results.length} =====`);
process.exit(failed ? 1 : 0);
