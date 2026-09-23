#!/bin/bash
# Counting semaphore on top of flock: run a command while holding one of N places.
#
#   tools/sperre.sh <name> <places> -- <command...>
#   tools/sperre.sh --selbsttest
#
# Place 1 is the file `<name>.lock` (so a plain `flock <name>.lock ...` still holds
# place 1 and stays correct during a changeover); places 2..N are `<name>.<i>.lock`.
# The command is a child, not an exec: the lock lives as long as it and its
# descendants hold the descriptor. Waiting is a poll (1 s plus jitter), not a queue.
# Exit status is the command's; 64 = bad usage.
#
#   flock /opt/wov-worktrees/.slots/build.lock npm run typecheck      # old, one place
#   tools/sperre.sh build 2 -- npm run typecheck                      # two at a time
#
# Directory: $WOV_SPERREN (default /opt/wov-worktrees/.slots).
set -u

VERZ=${WOV_SPERREN:-/opt/wov-worktrees/.slots}

selbsttest() {
  local self t r n=0
  self=$(readlink -f "$0"); t=$(mktemp -d "${TMPDIR:-/tmp}/sperre-selbst-$$-XXXXXX")
  trap 'rm -rf "$t"' RETURN
  fail() { echo "SELFTEST FAIL: $*" >&2; rm -rf "$t"; exit 1; }
  ok() { n=$((n + 1)); echo "  ok: $*"; }
  # 1. exit status passes through
  WOV_SPERREN=$t "$self" x 2 -- bash -c 'exit 7'; r=$?
  [ "$r" = 7 ] || fail "exit status 7 became $r"; ok "exit status passes through"
  # 2. three 2-second jobs on two places: never more than two at once, >= 4 s in total
  local s0 s1
  s0=$(date +%s)
  for i in 1 2 3; do
    ( WOV_SPERREN=$t "$self" y 2 -- bash -c "echo \$\$ > $t/run.$i; sleep 2; rm $t/run.$i" ) &
  done
  local maxn=0 c
  while [ "$(jobs -r | wc -l)" -gt 0 ]; do c=$(ls "$t" | grep -c '^run\.'); [ "$c" -gt "$maxn" ] && maxn=$c; sleep 0.1; done
  wait; s1=$(date +%s)
  [ "$maxn" = 2 ] || fail "max concurrent = $maxn, expected exactly 2"
  [ $((s1 - s0)) -ge 4 ] || fail "three 2 s jobs on two places took $((s1 - s0)) s (<4)"; ok "2 places: max 2 concurrent (saw $maxn), $((s1 - s0)) s for 3 jobs"
  # 3. one place is the classic <name>.lock: a plain flock holder blocks us
  ( flock "$t/z.lock" sleep 3 ) &
  sleep 0.3; s0=$(date +%s)
  WOV_SPERREN=$t "$self" z 1 -- true; s1=$(date +%s)
  wait
  [ $((s1 - s0)) -ge 2 ] || fail "place 1 did not wait for a plain flock holder ($((s1 - s0)) s)"; ok "place 1 is <name>.lock, waits for a plain flock holder"
  # 4. with place 1 held, the second place is taken at once
  ( flock "$t/w.lock" sleep 3 ) &
  sleep 0.3; s0=$(date +%s)
  WOV_SPERREN=$t "$self" w 2 -- true; s1=$(date +%s)
  [ $((s1 - s0)) -le 1 ] || fail "second place not taken while place 1 held ($((s1 - s0)) s)"; ok "place 2 free while place 1 held"
  wait
  # 5. bad usage
  "$self" x 0 -- true 2>/dev/null; [ $? = 64 ] || fail "0 places accepted"
  "$self" 'a/b' 2 -- true 2>/dev/null; [ $? = 64 ] || fail "path in name accepted"
  "$self" x 2 true 2>/dev/null; [ $? = 64 ] || fail "missing -- accepted"
  ok "bad usage exits 64"
  echo "selftest: $n directions ok"
}

if [ "${1:-}" = --selbsttest ]; then selbsttest; exit $?; fi

usage() { echo "usage: sperre.sh <name> <places 1-16> -- <command...>" >&2; exit 64; }
[ $# -ge 4 ] || usage
NAME=$1; PLAETZE=$2; [ "$3" = -- ] || usage
shift 3
[[ $NAME =~ ^[A-Za-z0-9_-]+$ ]] || usage
[[ $PLAETZE =~ ^[0-9]+$ ]] && [ "$PLAETZE" -ge 1 ] && [ "$PLAETZE" -le 16 ] || usage
mkdir -p "$VERZ" || exit 64

gemeldet=
while :; do
  for ((i = 1; i <= PLAETZE; i++)); do
    if [ "$i" = 1 ]; then datei=$VERZ/$NAME.lock; else datei=$VERZ/$NAME.$i.lock; fi
    exec {fd}>>"$datei" || exit 64
    if flock -n "$fd"; then
      echo "sperre: $NAME place $i/$PLAETZE taken" >&2
      "$@"; r=$?
      exit $r
    fi
    exec {fd}>&-
  done
  [ -n "$gemeldet" ] || { echo "sperre: all $PLAETZE places of $NAME busy, waiting" >&2; gemeldet=1; }
  sleep "1.$((RANDOM % 9))"
done
