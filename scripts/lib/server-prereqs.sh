#!/usr/bin/env bash
# P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
# Copyright (C) 2026 Poorija <p00rija@tutamail.com>
# https://github.com/Poorija/P00RIJA-Cryptography
#
# Licensed under the GNU Affero General Public License, version 3 only.
# See LICENSE for the full text. Section 13 matters here: run a modified
# version as a network service and its users are entitled to your source.
# ---------------------------------------------------------------------------
# Makes a server ready for P00RIJA: Docker with its compose plugin, and the
# small tools the installer and the updates use (curl, tar, gzip, openssl).
# The central panel sends it over SSH before an install (tools/panel/provision.mjs);
# it also runs by hand:
#
#   bash server-prereqs.sh --check            what is there, as key=value lines
#   bash server-prereqs.sh                    install what is missing
#
# Where Docker comes from, in this order, each tried only if it answers:
#   1. Docker's own repository (download.docker.com)
#   2. a mirror of that repository (--docker-mirrors; on a server inside Iran
#      the mirrors reachable there come first). Docker's two signing keys are
#      written into this script, and the repository is set up here with
#      signed-by (apt) or gpgkey=file:// (dnf/yum) pointing at them: nothing a
#      mirror serves is ever trusted as a key or a repository file, and apt and
#      dnf check every package against Docker's own key.
#   3. the distribution's own packages (docker.io and its compose plugin)
#   4. files the panel downloaded itself and copied in (--files DIR): Docker's
#      static binaries and the compose plugin. The panel does this when the
#      script ends with exit code 3 ("need=" lines say what it needs), so a
#      server that reaches nothing outside still gets Docker as long as SSH works.
#
# A server inside Iran also gets registry mirrors in /etc/docker/daemon.json
# (--registry-mirrors), only when the file does not set any yet.
#
# Options:
#   --check                    only report, change nothing
#   --region inside-iran|outside-iran
#   --docker-mirrors "URL …"   mirrors of download.docker.com, tried in order
#   --registry-mirrors "HOST …"
#   --files DIR                docker-*.tgz and docker-compose from the panel
# Exit codes: 0 ready, 1 failed, 2 not allowed (needs root), 3 needs files.
# ---------------------------------------------------------------------------
set -u
{

say()  { printf '%s\n' "$*"; }
warn() { printf '! %s\n' "$*" >&2; }

CHECK=0 REGION="" DOCKER_MIRRORS="" REGISTRY_MIRRORS="" FILES=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) CHECK=1 ;;
    --region) REGION="${2:-}"; shift ;;
    --docker-mirrors) DOCKER_MIRRORS="${2:-}"; shift ;;
    --registry-mirrors) REGISTRY_MIRRORS="${2:-}"; shift ;;
    --files) FILES="${2:-}"; shift ;;
    *) warn "unknown option: $1"; exit 1 ;;
  esac
  shift
done

# The mirrors used when none were given. Each is asked for its key file first
# and skipped when it does not answer, so a list longer than needed costs a few
# seconds, never a broken install.
if [ -z "$DOCKER_MIRRORS" ]; then
  if [ "$REGION" = inside-iran ]; then
    DOCKER_MIRRORS="https://mirror-linux.runflare.com/docker-ce https://mirror.arvancloud.ir/docker-ce https://mirror.mobinhost.com/docker-ce https://mirror.iranserver.com/docker-ce https://download.docker.com https://mirrors.aliyun.com/docker-ce https://mirrors.tuna.tsinghua.edu.cn/docker-ce https://mirrors.hust.edu.cn/docker-ce"
  else
    DOCKER_MIRRORS="https://download.docker.com https://mirrors.aliyun.com/docker-ce"
  fi
fi
if [ -z "$REGISTRY_MIRRORS" ] && [ "$REGION" = inside-iran ]; then
  REGISTRY_MIRRORS="docker.mobinhost.com mirror-docker.runflare.com docker.arvancloud.ir focker.ir"
fi

# ---- who may change the system -------------------------------------------------
# A user whose sudo asks for a password: the panel puts the password the
# admin typed in P00RIJA_SUDO_PASS at the top of this script (sent over the
# SSH connection, never on a command line, never written down); it unlocks
# sudo once, for this session, and is forgotten at once.
SUDO=""
if [ "$(id -u)" != 0 ] && command -v sudo >/dev/null 2>&1; then
  if sudo -n true 2>/dev/null; then SUDO="sudo -n"
  elif [ -n "${P00RIJA_SUDO_PASS:-}" ] && printf '%s\n' "$P00RIJA_SUDO_PASS" | sudo -S -p '' -v 2>/dev/null && sudo -n true 2>/dev/null; then SUDO="sudo -n"; fi
fi
unset P00RIJA_SUDO_PASS
as_root() { if [ "$(id -u)" = 0 ]; then "$@"; elif [ -n "$SUDO" ]; then $SUDO "$@"; else return 126; fi; }
may_change() { [ "$(id -u)" = 0 ] || [ -n "$SUDO" ]; }

# ---- what is there ---------------------------------------------------------------
OS_ID="" OS_LIKE="" OS_CODENAME="" OS_VERSION=""
if [ -r /etc/os-release ]; then
  OS_ID="$(. /etc/os-release; printf '%s' "${ID:-}")"
  OS_LIKE="$(. /etc/os-release; printf '%s' "${ID_LIKE:-}")"
  OS_CODENAME="$(. /etc/os-release; printf '%s' "${VERSION_CODENAME:-}")"
  OS_VERSION="$(. /etc/os-release; printf '%s' "${VERSION_ID:-}")"
fi
ARCH="$(uname -m 2>/dev/null || echo unknown)"
docker_version()  { docker version --format '{{.Server.Version}}' 2>/dev/null || as_root docker version --format '{{.Server.Version}}' 2>/dev/null || true; }
compose_version() { docker compose version --short 2>/dev/null || as_root docker compose version --short 2>/dev/null || true; }
has() { command -v "$1" >/dev/null 2>&1; }

report() {
  say "os=${OS_ID}${OS_VERSION:+ $OS_VERSION}"
  say "arch=$ARCH"
  say "root=$( [ "$(id -u)" = 0 ] && echo 1 || { [ -n "$SUDO" ] && echo sudo || echo 0; } )"
  say "sudoGroup=$(id -nG 2>/dev/null | tr ' ' '\n' | grep -qxE 'sudo|wheel|admin' && echo 1 || echo 0)"
  say "dockerGroup=$(id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker && echo 1 || echo 0)"
  say "docker=$(has docker && docker_version)"
  say "dockerBinary=$(has docker && echo 1 || echo 0)"
  say "compose=$(has docker && compose_version)"
  for tool in curl tar gzip openssl; do say "$tool=$(has "$tool" && echo 1 || echo 0)"; done
  say "daemonJson=$( [ -f /etc/docker/daemon.json ] && echo 1 || echo 0)"
  say "registryMirrors=$( [ -f /etc/docker/daemon.json ] && grep -c registry-mirrors /etc/docker/daemon.json 2>/dev/null || echo 0)"
}

if [ "$CHECK" = 1 ]; then report; exit 0; fi

say "▶ This server: ${OS_ID:-unknown} ${OS_VERSION} ($ARCH)"
if [ -n "$(has docker && docker_version)" ] && [ -n "$(has docker && compose_version)" ] && has curl && has tar && has gzip; then
  say "✓ Docker $(docker_version) with compose $(compose_version) is already here"
  READY_ALREADY=1
else
  READY_ALREADY=0
fi
if [ "$READY_ALREADY" = 0 ] && ! may_change; then
  warn "Installing needs root: log in as root, or give this user sudo without a password, then run it again."
  exit 2
fi

# ---- small tools -------------------------------------------------------------------
pkg_install() {
  if has apt-get; then DEBIAN_FRONTEND=noninteractive as_root apt-get install -y -q "$@" >/dev/null 2>&1 \
      || { as_root apt-get update -q >/dev/null 2>&1; DEBIAN_FRONTEND=noninteractive as_root apt-get install -y -q "$@" >/dev/null 2>&1; }
  elif has dnf; then as_root dnf install -y -q "$@" >/dev/null 2>&1
  elif has yum; then as_root yum install -y -q "$@" >/dev/null 2>&1
  elif has apk; then as_root apk add --no-cache "$@" >/dev/null 2>&1
  elif has zypper; then as_root zypper -q -n install "$@" >/dev/null 2>&1
  else return 1; fi
}
missing=""
for tool in curl tar gzip openssl; do has "$tool" || missing="$missing $tool"; done
if [ -n "$missing" ]; then
  say "▶ Tools:$missing"
  # shellcheck disable=SC2086
  pkg_install $missing ca-certificates || warn "could not install:$missing (the distribution's package mirror did not answer)"
fi

# ---- Docker ------------------------------------------------------------------------
docker_ok() { [ -n "$(docker_version)" ] && [ -n "$(compose_version)" ]; }
start_docker() {
  if has systemctl; then as_root systemctl enable --now docker >/dev/null 2>&1 || as_root systemctl start docker >/dev/null 2>&1
  elif has service; then as_root service docker start >/dev/null 2>&1
  elif has rc-service; then as_root rc-update add docker default >/dev/null 2>&1; as_root rc-service docker start >/dev/null 2>&1; fi
  local tries=0
  while [ $tries -lt 20 ] && [ -z "$(docker_version)" ]; do sleep 1; tries=$((tries + 1)); done
}
answers() { has curl && curl -fsS --max-time 15 -o /dev/null "$1" 2>/dev/null; }
distro_path() {
  case "$OS_ID" in ubuntu|debian|raspbian|fedora|centos) printf '%s' "$OS_ID" ;; rhel|rocky|almalinux|ol) printf centos ;; *)
    case " $OS_LIKE " in *" ubuntu "*) printf ubuntu ;; *" debian "*) printf debian ;; *" fedora "*) printf fedora ;; *" rhel "*|*" centos "*) printf centos ;; *) printf '%s' "$OS_ID" ;; esac ;;
  esac
}
deb_codename() {
  local codename
  codename="$(. /etc/os-release; printf '%s' "${UBUNTU_CODENAME:-}")"
  [ "$(distro_path)" = ubuntu ] && [ -n "$codename" ] && { printf '%s' "$codename"; return; }
  printf '%s' "$OS_CODENAME"
}

# Docker's repository signing keys, as download.docker.com publishes them
# (fingerprints 9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88 for apt,
# 060A 61C5 1B55 8A7F 742B 77AA C52F EB6B 621E 9F35 for dnf/yum).
docker_deb_key() {
  cat <<'KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBFit2ioBEADhWpZ8/wvZ6hUTiXOwQHXMAlaFHcPH9hAtr4F1y2+OYdbtMuth
lqqwp028AqyY+PRfVMtSYMbjuQuu5byyKR01BbqYhuS3jtqQmljZ/bJvXqnmiVXh
38UuLa+z077PxyxQhu5BbqntTPQMfiyqEiU+BKbq2WmANUKQf+1AmZY/IruOXbnq
L4C1+gJ8vfmXQt99npCaxEjaNRVYfOS8QcixNzHUYnb6emjlANyEVlZzeqo7XKl7
UrwV5inawTSzWNvtjEjj4nJL8NsLwscpLPQUhTQ+7BbQXAwAmeHCUTQIvvWXqw0N
cmhh4HgeQscQHYgOJjjDVfoY5MucvglbIgCqfzAHW9jxmRL4qbMZj+b1XoePEtht
ku4bIQN1X5P07fNWzlgaRL5Z4POXDDZTlIQ/El58j9kp4bnWRCJW0lya+f8ocodo
vZZ+Doi+fy4D5ZGrL4XEcIQP/Lv5uFyf+kQtl/94VFYVJOleAv8W92KdgDkhTcTD
G7c0tIkVEKNUq48b3aQ64NOZQW7fVjfoKwEZdOqPE72Pa45jrZzvUFxSpdiNk2tZ
XYukHjlxxEgBdC/J3cMMNRE1F4NCA3ApfV1Y7/hTeOnmDuDYwr9/obA8t016Yljj
q5rdkywPf4JF8mXUW5eCN1vAFHxeg9ZWemhBtQmGxXnw9M+z6hWwc6ahmwARAQAB
tCtEb2NrZXIgUmVsZWFzZSAoQ0UgZGViKSA8ZG9ja2VyQGRvY2tlci5jb20+iQI3
BBMBCgAhBQJYrefAAhsvBQsJCAcDBRUKCQgLBRYCAwEAAh4BAheAAAoJEI2BgDwO
v82IsskP/iQZo68flDQmNvn8X5XTd6RRaUH33kXYXquT6NkHJciS7E2gTJmqvMqd
tI4mNYHCSEYxI5qrcYV5YqX9P6+Ko+vozo4nseUQLPH/ATQ4qL0Zok+1jkag3Lgk
jonyUf9bwtWxFp05HC3GMHPhhcUSexCxQLQvnFWXD2sWLKivHp2fT8QbRGeZ+d3m
6fqcd5Fu7pxsqm0EUDK5NL+nPIgYhN+auTrhgzhK1CShfGccM/wfRlei9Utz6p9P
XRKIlWnXtT4qNGZNTN0tR+NLG/6Bqd8OYBaFAUcue/w1VW6JQ2VGYZHnZu9S8LMc
FYBa5Ig9PxwGQOgq6RDKDbV+PqTQT5EFMeR1mrjckk4DQJjbxeMZbiNMG5kGECA8
g383P3elhn03WGbEEa4MNc3Z4+7c236QI3xWJfNPdUbXRaAwhy/6rTSFbzwKB0Jm
ebwzQfwjQY6f55MiI/RqDCyuPj3r3jyVRkK86pQKBAJwFHyqj9KaKXMZjfVnowLh
9svIGfNbGHpucATqREvUHuQbNnqkCx8VVhtYkhDb9fEP2xBu5VvHbR+3nfVhMut5
G34Ct5RS7Jt6LIfFdtcn8CaSas/l1HbiGeRgc70X/9aYx/V/CEJv0lIe8gP6uDoW
FPIZ7d6vH+Vro6xuWEGiuMaiznap2KhZmpkgfupyFmplh0s6knymuQINBFit2ioB
EADneL9S9m4vhU3blaRjVUUyJ7b/qTjcSylvCH5XUE6R2k+ckEZjfAMZPLpO+/tF
M2JIJMD4SifKuS3xck9KtZGCufGmcwiLQRzeHF7vJUKrLD5RTkNi23ydvWZgPjtx
Q+DTT1Zcn7BrQFY6FgnRoUVIxwtdw1bMY/89rsFgS5wwuMESd3Q2RYgb7EOFOpnu
w6da7WakWf4IhnF5nsNYGDVaIHzpiqCl+uTbf1epCjrOlIzkZ3Z3Yk5CM/TiFzPk
z2lLz89cpD8U+NtCsfagWWfjd2U3jDapgH+7nQnCEWpROtzaKHG6lA3pXdix5zG8
eRc6/0IbUSWvfjKxLLPfNeCS2pCL3IeEI5nothEEYdQH6szpLog79xB9dVnJyKJb
VfxXnseoYqVrRz2VVbUI5Blwm6B40E3eGVfUQWiux54DspyVMMk41Mx7QJ3iynIa
1N4ZAqVMAEruyXTRTxc9XW0tYhDMA/1GYvz0EmFpm8LzTHA6sFVtPm/ZlNCX6P1X
zJwrv7DSQKD6GGlBQUX+OeEJ8tTkkf8QTJSPUdh8P8YxDFS5EOGAvhhpMBYD42kQ
pqXjEC+XcycTvGI7impgv9PDY1RCC1zkBjKPa120rNhv/hkVk/YhuGoajoHyy4h7
ZQopdcMtpN2dgmhEegny9JCSwxfQmQ0zK0g7m6SHiKMwjwARAQABiQQ+BBgBCAAJ
BQJYrdoqAhsCAikJEI2BgDwOv82IwV0gBBkBCAAGBQJYrdoqAAoJEH6gqcPyc/zY
1WAP/2wJ+R0gE6qsce3rjaIz58PJmc8goKrir5hnElWhPgbq7cYIsW5qiFyLhkdp
YcMmhD9mRiPpQn6Ya2w3e3B8zfIVKipbMBnke/ytZ9M7qHmDCcjoiSmwEXN3wKYI
mD9VHONsl/CG1rU9Isw1jtB5g1YxuBA7M/m36XN6x2u+NtNMDB9P56yc4gfsZVES
KA9v+yY2/l45L8d/WUkUi0YXomn6hyBGI7JrBLq0CX37GEYP6O9rrKipfz73XfO7
JIGzOKZlljb/D9RX/g7nRbCn+3EtH7xnk+TK/50euEKw8SMUg147sJTcpQmv6UzZ
cM4JgL0HbHVCojV4C/plELwMddALOFeYQzTif6sMRPf+3DSj8frbInjChC3yOLy0
6br92KFom17EIj2CAcoeq7UPhi2oouYBwPxh5ytdehJkoo+sN7RIWua6P2WSmon5
U888cSylXC0+ADFdgLX9K2zrDVYUG1vo8CX0vzxFBaHwN6Px26fhIT1/hYUHQR1z
VfNDcyQmXqkOnZvvoMfz/Q0s9BhFJ/zU6AgQbIZE/hm1spsfgvtsD1frZfygXJ9f
irP+MSAI80xHSf91qSRZOj4Pl3ZJNbq4yYxv0b1pkMqeGdjdCYhLU+LZ4wbQmpCk
SVe2prlLureigXtmZfkqevRz7FrIZiu9ky8wnCAPwC7/zmS18rgP/17bOtL4/iIz
QhxAAoAMWVrGyJivSkjhSGx1uCojsWfsTAm11P7jsruIL61ZzMUVE2aM3Pmj5G+W
9AcZ58Em+1WsVnAXdUR//bMmhyr8wL/G1YO1V3JEJTRdxsSxdYa4deGBBY/Adpsw
24jxhOJR+lsJpqIUeb999+R8euDhRHG9eFO7DRu6weatUJ6suupoDTRWtr/4yGqe
dKxV3qQhNLSnaAzqW/1nA3iUB4k7kCaKZxhdhDbClf9P37qaRW467BLCVO/coL3y
Vm50dwdrNtKpMBh3ZpbB1uJvgi9mXtyBOMJ3v8RZeDzFiG8HdCtg9RvIt/AIFoHR
H3S+U79NT6i0KPzLImDfs8T7RlpyuMc4Ufs8ggyg9v3Ae6cN3eQyxcK3w0cbBwsh
/nQNfsA6uu+9H7NhbehBMhYnpNZyrHzCmzyXkauwRAqoCbGCNykTRwsur9gS41TQ
M8ssD1jFheOJf3hODnkKU+HKjvMROl1DK7zdmLdNzA1cvtZH/nCC9KPj1z8QC47S
xx+dTZSx4ONAhwbS/LN3PoKtn8LPjY9NP9uDWI+TWYquS2U+KHDrBDlsgozDbs/O
jCxcpDzNmXpWQHEtHU7649OXHP7UeNST1mCUCH5qdank0V1iejF6/CfTFU4MfcrG
YT90qFF93M3v01BbxP+EIY2/9tiIPbrd
=0YYh
-----END PGP PUBLIC KEY BLOCK-----
KEY
}
docker_rpm_key() {
  cat <<'KEY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

mQINBFit5IEBEADDt86QpYKz5flnCsOyZ/fk3WwBKxfDjwHf/GIflo+4GWAXS7wJ
1PSzPsvSDATV10J44i5WQzh99q+lZvFCVRFiNhRmlmcXG+rk1QmDh3fsCCj9Q/yP
w8jn3Hx0zDtz8PIB/18ReftYJzUo34COLiHn8WiY20uGCF2pjdPgfxE+K454c4G7
gKFqVUFYgPug2CS0quaBB5b0rpFUdzTeI5RCStd27nHCpuSDCvRYAfdv+4Y1yiVh
KKdoe3Smj+RnXeVMgDxtH9FJibZ3DK7WnMN2yeob6VqXox+FvKYJCCLkbQgQmE50
uVK0uN71A1mQDcTRKQ2q3fFGlMTqJbbzr3LwnCBE6hV0a36t+DABtZTmz5O69xdJ
WGdBeePCnWVqtDb/BdEYz7hPKskcZBarygCCe2Xi7sZieoFZuq6ltPoCsdfEdfbO
+VBVKJnExqNZCcFUTEnbH4CldWROOzMS8BGUlkGpa59Sl1t0QcmWlw1EbkeMQNrN
spdR8lobcdNS9bpAJQqSHRZh3cAM9mA3Yq/bssUS/P2quRXLjJ9mIv3dky9C3udM
+q2unvnbNpPtIUly76FJ3s8g8sHeOnmYcKqNGqHq2Q3kMdA2eIbI0MqfOIo2+Xk0
rNt3ctq3g+cQiorcN3rdHPsTRSAcp+NCz1QF9TwXYtH1XV24A6QMO0+CZwARAQAB
tCtEb2NrZXIgUmVsZWFzZSAoQ0UgcnBtKSA8ZG9ja2VyQGRvY2tlci5jb20+iQI3
BBMBCgAhBQJYrep4AhsvBQsJCAcDBRUKCQgLBRYCAwEAAh4BAheAAAoJEMUv62ti
Hp816C0P/iP+1uhSa6Qq3TIc5sIFE5JHxOO6y0R97cUdAmCbEqBiJHUPNQDQaaRG
VYBm0K013Q1gcJeUJvS32gthmIvhkstw7KTodwOM8Kl11CCqZ07NPFef1b2SaJ7l
TYpyUsT9+e343ph+O4C1oUQw6flaAJe+8ATCmI/4KxfhIjD2a/Q1voR5tUIxfexC
/LZTx05gyf2mAgEWlRm/cGTStNfqDN1uoKMlV+WFuB1j2oTUuO1/dr8mL+FgZAM3
ntWFo9gQCllNV9ahYOON2gkoZoNuPUnHsf4Bj6BQJnIXbAhMk9H2sZzwUi9bgObZ
XO8+OrP4D4B9kCAKqqaQqA+O46LzO2vhN74lm/Fy6PumHuviqDBdN+HgtRPMUuao
xnuVJSvBu9sPdgT/pR1N9u/KnfAnnLtR6g+fx4mWz+ts/riB/KRHzXd+44jGKZra
IhTMfniguMJNsyEOO0AN8Tqcl0eRBxcOArcri7xu8HFvvl+e+ILymu4buusbYEVL
GBkYP5YMmScfKn+jnDVN4mWoN1Bq2yMhMGx6PA3hOvzPNsUoYy2BwDxNZyflzuAi
g59mgJm2NXtzNbSRJbMamKpQ69mzLWGdFNsRd4aH7PT7uPAURaf7B5BVp3UyjERW
5alSGnBqsZmvlRnVH5BDUhYsWZMPRQS9rRr4iGW0l+TH+O2VJ8aQ
=0Zqq
-----END PGP PUBLIC KEY BLOCK-----
KEY
}

# Docker CE from one repository (Docker's own or a mirror of it), the
# repository written here with the key above: true when Docker answers.
install_from_repo() {
  local mirror="$1" path codename arch
  path="$(distro_path)"
  if has apt-get; then
    codename="$(deb_codename)"
    [ -n "$codename" ] || return 1
    answers "$mirror/linux/$path/dists/$codename/Release" || { say "  $mirror has no $path $codename"; return 1; }
    say "▶ Docker from $mirror ($path $codename)"
    arch="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
    as_root install -m 0755 -d /etc/apt/keyrings
    docker_deb_key | as_root tee /etc/apt/keyrings/docker.asc >/dev/null
    as_root chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] %s/linux/%s %s stable\n' "$arch" "$mirror" "$path" "$codename" | as_root tee /etc/apt/sources.list.d/docker.list >/dev/null
    if as_root apt-get update -q >/tmp/p00rija-docker-repo.log 2>&1 \
      && DEBIAN_FRONTEND=noninteractive as_root apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >>/tmp/p00rija-docker-repo.log 2>&1; then
      start_docker
      docker_ok && return 0
    fi
    warn "  that did not finish: $(tail -n 2 /tmp/p00rija-docker-repo.log 2>/dev/null | tr '\n' ' ')"
    as_root rm -f /etc/apt/sources.list.d/docker.list
    return 1
  fi
  if has dnf || has yum; then
    case "$path" in fedora|centos) ;; *) return 1 ;; esac
    answers "$mirror/linux/$path/" || { say "  $mirror does not answer"; return 1; }
    say "▶ Docker from $mirror ($path)"
    as_root mkdir -p /etc/pki/rpm-gpg
    docker_rpm_key | as_root tee /etc/pki/rpm-gpg/docker-ce.asc >/dev/null
    printf '[docker-ce-stable]\nname=Docker CE Stable\nbaseurl=%s/linux/%s/$releasever/$basearch/stable\nenabled=1\ngpgcheck=1\ngpgkey=file:///etc/pki/rpm-gpg/docker-ce.asc\n' "$mirror" "$path" | as_root tee /etc/yum.repos.d/docker-ce.repo >/dev/null
    local tool=dnf; has dnf || tool=yum
    if as_root "$tool" install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/tmp/p00rija-docker-repo.log 2>&1; then
      start_docker
      docker_ok && return 0
    fi
    warn "  that did not finish: $(tail -n 2 /tmp/p00rija-docker-repo.log 2>/dev/null | tr '\n' ' ')"
    as_root rm -f /etc/yum.repos.d/docker-ce.repo
    return 1
  fi
  return 1
}

install_from_mirrors() {
  local mirror
  for mirror in $DOCKER_MIRRORS; do
    install_from_repo "${mirror%/}" && return 0
  done
  return 1
}

install_from_distro() {
  say "▶ Docker from the distribution's own packages"
  if has apt-get; then
    pkg_install docker.io || return 1
    pkg_install docker-compose-v2 || pkg_install docker-compose-plugin || true
  elif has dnf || has yum; then
    pkg_install docker || pkg_install moby-engine || return 1
    pkg_install docker-compose-plugin || true
  elif has apk; then
    pkg_install docker docker-cli-compose || return 1
  else
    return 1
  fi
  start_docker
  [ -n "$(docker_version)" ]
}

install_compose_plugin() {
  local target=/usr/local/lib/docker/cli-plugins/docker-compose arch_name
  case "$ARCH" in x86_64|amd64) arch_name=x86_64 ;; aarch64|arm64) arch_name=aarch64 ;; armv7l) arch_name=armv7 ;; *) arch_name="$ARCH" ;; esac
  as_root mkdir -p /usr/local/lib/docker/cli-plugins
  if [ -n "$FILES" ] && [ -s "$FILES/docker-compose" ]; then
    as_root install -m 0755 "$FILES/docker-compose" "$target" && [ -n "$(compose_version)" ] && return 0
  fi
  local url="https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$arch_name"
  if answers "https://github.com"; then
    say "▶ The compose plugin from GitHub"
    as_root curl -fsSL --max-time 300 "$url" -o "$target" 2>/dev/null && as_root chmod 0755 "$target" && [ -n "$(compose_version)" ] && return 0
  fi
  return 1
}

install_static() {
  local tgz
  tgz="$(ls "$FILES"/docker-*.tgz 2>/dev/null | head -1)"
  [ -n "$tgz" ] || return 1
  say "▶ Docker's static binaries, copied in by the panel ($(basename "$tgz"))"
  local tmp; tmp="$(mktemp -d)"
  tar xzf "$tgz" -C "$tmp" || return 1
  as_root install -m 0755 "$tmp"/docker/* /usr/local/bin/ || return 1
  rm -rf "$tmp"
  as_root groupadd -f docker 2>/dev/null || true
  if has systemctl; then
    as_root tee /etc/systemd/system/containerd.service >/dev/null <<'UNIT'
[Unit]
Description=containerd (P00RIJA static install)
After=network.target
[Service]
ExecStart=/usr/local/bin/containerd
Restart=always
Delegate=yes
KillMode=process
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
    as_root tee /etc/systemd/system/docker.service >/dev/null <<'UNIT'
[Unit]
Description=Docker (P00RIJA static install)
After=network-online.target containerd.service
Wants=network-online.target
Requires=containerd.service
[Service]
ExecStart=/usr/local/bin/dockerd --containerd=/run/containerd/containerd.sock
Restart=always
LimitNOFILE=1048576
Delegate=yes
KillMode=process
[Install]
WantedBy=multi-user.target
UNIT
    as_root systemctl daemon-reload
    as_root systemctl enable --now containerd >/dev/null 2>&1
  else
    as_root sh -c 'nohup /usr/local/bin/dockerd >/var/log/dockerd.log 2>&1 &'
  fi
  start_docker
  [ -n "$(docker_version)" ]
}

if [ "$READY_ALREADY" = 0 ]; then
  if [ -z "$(docker_version)" ]; then
    if has docker && ! docker_ok; then start_docker; fi
  fi
  if [ -z "$(docker_version)" ]; then
    install_from_mirrors || install_from_distro || install_static || true
  fi
  if [ -n "$(docker_version)" ] && [ -z "$(compose_version)" ]; then
    install_compose_plugin || true
  fi
  if ! docker_ok; then
    need=""
    [ -n "$(docker_version)" ] || need="docker-static"
    [ -n "$(compose_version)" ] || need="$need compose"
    if [ -z "$FILES" ]; then
      for item in $need; do say "need=$item"; done
      say "arch=$ARCH"
      warn "Docker could not be installed from anything this server reaches; the panel can copy the files in itself."
      exit 3
    fi
    warn "Docker could not be installed, even from the files copied in."
    exit 1
  fi
  say "✓ Docker $(docker_version) with compose $(compose_version)"
fi

# ---- the user may use Docker without sudo -------------------------------------
# (from its next login on: the install that follows is a new SSH session).
if [ "$(id -u)" != 0 ] && may_change && ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx docker; then
  as_root groupadd -f docker 2>/dev/null || true
  as_root usermod -aG docker "$(id -un)" && say "✓ $(id -un) may use Docker (from its next login)"
fi

# ---- registry mirrors (a server inside Iran) -----------------------------------
if [ -n "$REGISTRY_MIRRORS" ] && may_change; then
  if [ -f /etc/docker/daemon.json ] && grep -q registry-mirrors /etc/docker/daemon.json 2>/dev/null; then
    say "  /etc/docker/daemon.json already names registry mirrors; left as it is"
  else
    list=""
    for host in $REGISTRY_MIRRORS; do list="$list${list:+, }\"https://${host#https://}\""; done
    if [ -s /etc/docker/daemon.json ]; then
      if has python3; then
        as_root python3 - "$list" <<'PY' && changed=1 || changed=0
import json, sys
path = '/etc/docker/daemon.json'
with open(path) as handle:
    config = json.load(handle)
config['registry-mirrors'] = json.loads('[' + sys.argv[1] + ']')
with open(path, 'w') as handle:
    json.dump(config, handle, indent=2)
PY
      else
        changed=0
        say "  /etc/docker/daemon.json has other settings and there is no python3 to merge into it; registry mirrors not set"
      fi
    else
      as_root mkdir -p /etc/docker
      printf '{\n  "registry-mirrors": [%s]\n}\n' "$list" | as_root tee /etc/docker/daemon.json >/dev/null && changed=1 || changed=0
    fi
    if [ "${changed:-0}" = 1 ]; then
      say "✓ Registry mirrors: $REGISTRY_MIRRORS"
      if has systemctl; then as_root systemctl restart docker >/dev/null 2>&1; else as_root service docker restart >/dev/null 2>&1 || true; fi
      start_docker
    fi
  fi
fi

say "ready=1"
exit 0
}
