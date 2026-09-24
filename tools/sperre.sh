#!/bin/bash
# Counting semaphore on top of flock: run a command while holding one of N places.
#
#   tools/sperre.sh <name> -- <command...>
#   tools/sperre.sh --plaetze <name>       print the number of places of <name>
#   tools/sperre.sh --selbsttest
#
# The number of places is NOT the caller's choice. It comes from the table below:
#     build = 2   (typecheck, build, npm ci)
#     test  = 2   (full test run, each in its own worktree)
#     measure = 1 (frame-time measurements)
# An unknown name exits 64. The old form `<name> <n> -- <command>` is still accepted
# for the changeover, but only when <n> equals the table; anything else exits 64.
#
# Place 1 is the file `<name>.lock` (so a plain `flock <name>.lock ...` still holds
# place 1); places 2..N are `<name>.<i>.lock`. Waiting is a poll (1 s plus jitter), not
# a queue: an old `flock <name>.lock` waiter that sits in the kernel wins against the
# poll when the place is freed. From the merge of this tool on, use only sperre.sh.
#
# Things to know (AGENTS.md 3.3):
#   * The command is a child, not an exec. The place belongs to the command and to
#     everything that inherits the lock descriptor: a daemon started under the lock
#     (`setsid server &`) keeps the place after the command ends. Never start
#     servers or watchers under the lock.
#   * `kill -9` on sperre.sh ends the wrapper, not the child; the orphaned child keeps
#     the place until it ends.
#   * Nesting on the same name needs a free second place: with one place
#     (measure) it deadlocks.
#   * The lock files are part of the contract: deleting one lifts the lock.
#   * Exit status is the command's. Exit 64 is also this tool's usage error; every usage
#     error prints a line starting "sperre: usage:" and a command that exits 64 itself
#     prints "sperre: command exited 64", so the two can be told apart on stderr.
#
# Directory: $WOV_SPERREN (default /opt/wov-worktrees/.slots).
# WOV_SPERREN_PLAETZE_<NAME> (upper case, - as _) overrides the table. It exists only
# for --selbsttest and is honoured only when WOV_SPERREN points elsewhere than the
# default, so it cannot loosen the real limit. It also allows names outside the table.
set -u

STANDARD=/opt/wov-worktrees/.slots
VERZ=${WOV_SPERREN:-$STANDARD}

# Number of places for a name; empty when unknown.
plaetze_von() {
  local name=$1 var
  var=WOV_SPERREN_PLAETZE_$(echo "$name" | tr 'a-z-' 'A-Z_')
  if [ "$VERZ" != "$STANDARD" ] && [ -n "${!var:-}" ]; then echo "${!var}"; return; fi
  case $name in
    build) echo 2 ;;
    test) echo 2 ;;
    measure) echo 1 ;;
  esac
}

usage() { echo "sperre: usage: $* (sperre.sh <name> -- <command...>; names: build test measure)" >&2; exit 64; }

selbsttest() {
  local self t r n=0 s0 s1
  self=$(readlink -f "$0"); t=$(mktemp -d "${TMPDIR:-/tmp}/sperre-selbst-$$-XXXXXX")
  trap 'rm -rf "$t"' RETURN
  fail() { echo "SELFTEST FAIL: $*" >&2; rm -rf "$t"; exit 1; }
  ok() { n=$((n + 1)); echo "  ok: $*"; }
  export WOV_SPERREN=$t
  # 1. exit status passes through
  WOV_SPERREN_PLAETZE_X=2 "$self" x -- bash -c 'exit 7' 2>/dev/null; r=$?
  [ "$r" = 7 ] || fail "exit status 7 became $r"; ok "exit status passes through"
  # 2. three 2-second jobs on two places: never more than two at once, >= 4 s in total
  s0=$(date +%s)
  for i in 1 2 3; do
    ( WOV_SPERREN_PLAETZE_Y=2 "$self" y -- bash -c "echo \$\$ > $t/run.$i; sleep 2; rm $t/run.$i" 2>/dev/null ) &
  done
  local maxn=0 c
  while [ "$(jobs -r | wc -l)" -gt 0 ]; do c=$(ls "$t" | grep -c '^run\.'); [ "$c" -gt "$maxn" ] && maxn=$c; sleep 0.1; done
  wait; s1=$(date +%s)
  [ "$maxn" = 2 ] || fail "max concurrent = $maxn, expected exactly 2"
  [ $((s1 - s0)) -ge 4 ] || fail "three 2 s jobs on two places took $((s1 - s0)) s (<4)"; ok "2 places: max 2 concurrent (saw $maxn), $((s1 - s0)) s for 3 jobs"
  # 3. one place is the classic <name>.lock: a plain flock holder blocks us
  ( flock "$t/z.lock" sleep 3 ) &
  sleep 0.3; s0=$(date +%s)
  WOV_SPERREN_PLAETZE_Z=1 "$self" z -- true 2>/dev/null; s1=$(date +%s)
  wait
  [ $((s1 - s0)) -ge 2 ] || fail "place 1 did not wait for a plain flock holder ($((s1 - s0)) s)"; ok "place 1 is <name>.lock, waits for a plain flock holder"
  # 4. with place 1 held, the second place is taken at once
  ( flock "$t/w.lock" sleep 3 ) &
  sleep 0.3; s0=$(date +%s)
  WOV_SPERREN_PLAETZE_W=2 "$self" w -- true 2>/dev/null; s1=$(date +%s)
  [ $((s1 - s0)) -le 1 ] || fail "second place not taken while place 1 held ($((s1 - s0)) s)"; ok "place 2 free while place 1 held"
  wait
  # 5. bad usage
  "$self" build 2>/dev/null; [ $? = 64 ] || fail "missing -- accepted"
  "$self" 'a/b' -- true 2>/dev/null; [ $? = 64 ] || fail "path in name accepted"
  "$self" build 2 true 2>/dev/null; [ $? = 64 ] || fail "old form without -- accepted"
  ok "bad usage exits 64"
  # 6. the table decides (B3): unknown names, wrong numbers, the old form
  "$self" gibtsnicht -- true 2>/dev/null; [ $? = 64 ] || fail "unknown name accepted"
  "$self" build 3 -- true 2>/dev/null; [ $? = 64 ] || fail "build 3 accepted (table says 2)"
  "$self" test 1 -- true 2>/dev/null; [ $? = 64 ] || fail "test 1 accepted (table says 2)"
  "$self" measure 2 -- true 2>/dev/null; [ $? = 64 ] || fail "measure 2 accepted (table says 1)"
  [ "$("$self" --plaetze build)" = 2 ] && [ "$("$self" --plaetze test)" = 2 ] && [ "$("$self" --plaetze measure)" = 1 ] || fail "table is not build=2 test=2 measure=1"
  [ "$(WOV_SPERREN_PLAETZE_BUILD=9 "$self" --plaetze build)" = 9 ] || fail "test override not honoured with WOV_SPERREN set"
  [ "$(env -u WOV_SPERREN WOV_SPERREN_PLAETZE_BUILD=9 "$self" --plaetze build)" = 2 ] || fail "override loosened the real limit"
  ok "table build=2 test=2 measure=1; other numbers and unknown names exit 64; override ignored on the real directory"
  # 7. from the table: three 2 s jobs on `build` (2 places) never overlap by more than two
  s0=$(date +%s); maxn=0
  for i in 1 2 3; do
    ( "$self" build -- bash -c "echo \$\$ > $t/tb.$i; sleep 2; rm $t/tb.$i" 2>/dev/null ) &
  done
  while [ "$(jobs -r | wc -l)" -gt 0 ]; do c=$(ls "$t" | grep -c '^tb\.'); [ "$c" -gt "$maxn" ] && maxn=$c; sleep 0.1; done
  wait; s1=$(date +%s)
  [ "$maxn" = 2 ] && [ $((s1 - s0)) -ge 4 ] || fail "build from the table: max $maxn concurrent, $((s1 - s0)) s"; ok "sperre.sh build -- ...: table gives 2 places (max $maxn, $((s1 - s0)) s)"
  # 8. an old-form call with the table's number still works
  "$self" build 2 -- true 2>/dev/null || fail "old form build 2 refused"; ok "old form with the table's number is accepted"
  # 9. usage error vs a command that exits 64 itself
  e=$("$self" build 3 -- true 2>&1 >/dev/null); case $e in *"sperre: usage:"*) ;; *) fail "usage error without its marker: $e";; esac
  e=$("$self" build -- bash -c 'exit 64' 2>&1 >/dev/null); r=$?
  case $e in *"sperre: command exited 64"*) ;; *) fail "command exit 64 without marker: $e";; esac
  case $e in *"sperre: usage:"*) fail "command exit 64 looks like a usage error";; esac
  ok "exit 64 from the command is told apart on stderr"
  echo "selftest: $n directions ok"
}

if [ "${1:-}" = --selbsttest ]; then selbsttest; exit $?; fi
if [ "${1:-}" = --plaetze ]; then
  [ $# = 2 ] || usage "--plaetze <name>"
  p=$(plaetze_von "$2"); [ -n "$p" ] || usage "unknown name '$2'"
  echo "$p"; exit 0
fi

[ $# -ge 3 ] || usage "too few arguments"
NAME=$1; shift
[[ $NAME =~ ^[A-Za-z0-9_-]+$ ]] || usage "bad name '$NAME'"
PLAETZE=$(plaetze_von "$NAME")
[ -n "$PLAETZE" ] || usage "unknown name '$NAME'"
if [ "$1" != -- ]; then
  # old form: <name> <n> -- <command>
  [[ $1 =~ ^[0-9]+$ ]] || usage "expected -- after the name"
  [ "$1" = "$PLAETZE" ] || usage "$NAME has $PLAETZE places, not $1 (the table decides, not the caller)"
  shift
  [ "${1:-}" = -- ] || usage "expected -- after the number"
fi
shift
[ $# -ge 1 ] || usage "no command after --"
mkdir -p "$VERZ" || usage "cannot create $VERZ"

gemeldet=
while :; do
  for ((i = 1; i <= PLAETZE; i++)); do
    if [ "$i" = 1 ]; then datei=$VERZ/$NAME.lock; else datei=$VERZ/$NAME.$i.lock; fi
    exec {fd}>>"$datei" || usage "cannot open $datei"
    if flock -n "$fd"; then
      echo "sperre: $NAME place $i/$PLAETZE taken" >&2
      "$@"; r=$?
      [ "$r" = 64 ] && echo "sperre: command exited 64" >&2
      exit $r
    fi
    exec {fd}>&-
  done
  [ -n "$gemeldet" ] || { echo "sperre: all $PLAETZE places of $NAME busy, waiting" >&2; gemeldet=1; }
  sleep "1.$((RANDOM % 9))"
done
