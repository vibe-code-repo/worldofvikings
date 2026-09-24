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
# Nested calls: sperre.sh puts the names it holds into WOV_SPERRE_GEHALTEN for the child. A call
# on a name that is already held runs its command directly (the inherited descriptor holds
# the place already), so a commit inside `sperre.sh build -- ...` whose hook asks for `build`
# again cannot deadlock against itself or against a second such commit. Such a call first
# tries, without waiting, for a free place and takes it like any call; only when every
# place is busy does it run its command directly, and then it always says so on stderr
# ("held by caller, running nested without a place"), so the pass is never silent.
# WOV_SPERRE_GEHALTEN is set by this tool only, never by hand: whoever sets it lets calls
# run past a full lock (visibly, but past it).
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
#   * Nesting on a name you hold: see above. NEVER take one lock under the other (build under
#     test, test under build): two of each, crossed, wait on each other forever. The tool does
#     not refuse it, because the commit hook (build) must still work under a caller.
#   * The lock files are part of the contract: deleting one lifts the lock.
#   * Exit status is the command's. Exit 64 is also this tool's usage error; every usage
#     error prints a line starting "sperre: usage:" and a command that exits 64 itself
#     prints "sperre: command exited 64", so the two can be told apart on stderr.
#
# Directory: $WOV_SPERREN (default /opt/wov-worktrees/.slots); set it for probes only.
# WOV_SPERREN_PLAETZE_<NAME> (upper case, - as _) overrides the table. It exists only for
# --selbsttest and is honoured only when BOTH hold: the mark _SPERRE_SELBSTTEST=1, which
# only selbsttest() sets, and a canonical WOV_SPERREN (readlink -f) that is not the real
# directory, also by device:inode (stat), which sees through a bind mount. So it cannot loosen the real limit, neither by a trailing slash nor by `/./`.
# It also allows names outside the table.
set -u

STANDARD=/opt/wov-worktrees/.slots
VERZ=${WOV_SPERREN:-$STANDARD}

# Number of places for a name; empty when unknown.
plaetze_von() {
  local name=$1 var
  var=WOV_SPERREN_PLAETZE_$(echo "$name" | tr 'a-z-' 'A-Z_')
  if [ "${_SPERRE_SELBSTTEST:-}" = 1 ] && [ "$(readlink -f "$VERZ")" != "$(readlink -f "$STANDARD")" ] && [ "$(stat -c %d:%i "$VERZ" 2>/dev/null)" != "$(stat -c %d:%i "$STANDARD" 2>/dev/null)" ] && [ -n "${!var:-}" ]; then
    [[ ${!var} =~ ^[0-9]+$ ]] && [ "${!var}" -ge 1 ] && [ "${!var}" -le 16 ] || usage "bad override $var"
    echo "${!var}"; return
  fi
  case $name in
    build) echo 2 ;;
    test) echo 2 ;;
    measure) echo 1 ;;
  esac
}

usage() { echo "sperre: usage: $* (sperre.sh <name> -- <command...>; names: build test measure)" >&2; exit 64; }
# Environment failures are not the caller's typing: another marker, another code.
fehler() { echo "sperre: error: $*" >&2; exit 70; }

selbsttest() {
  local self t r n=0 s0 s1
  self=$(readlink -f "$0"); t=$(mktemp -d "${TMPDIR:-/tmp}/sperre-selbst-$$-XXXXXX")
  export _SPERRE_SELBSTTEST=1
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
  [ "$(env -u _SPERRE_SELBSTTEST WOV_SPERREN_PLAETZE_BUILD=9 "$self" --plaetze build)" = 2 ] || fail "override worked without the self-test mark"
  # the real directory under other spellings (t6-B1): a copy of the tool whose STANDARD is a temp dir
  mkdir -p "$t/echt"; sed "s|^STANDARD=.*|STANDARD=$t/echt|" "$self" > "$t/kopie.sh"; chmod +x "$t/kopie.sh"
  for schreibweise in "$t/echt" "$t/echt/" "$t/./echt" "$t//echt/"; do
    [ "$(WOV_SPERREN=$schreibweise WOV_SPERREN_PLAETZE_BUILD=9 "$t/kopie.sh" --plaetze build)" = 2 ] || fail "override honoured on the real directory spelled '$schreibweise'"
  done
  ln -s "$t/echt" "$t/link"
  [ "$(WOV_SPERREN=$t/link WOV_SPERREN_PLAETZE_BUILD=9 "$t/kopie.sh" --plaetze build)" = 2 ] || fail "override honoured through a symlink to the real directory"
  ok "table build=2 test=2 measure=1; other numbers and unknown names exit 64; override ignored without the mark and on the real directory (4 spellings + symlink)"
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
  # 10. nesting on a held name runs directly and never deadlocks (t6-B2); other names still wait
  s0=$(date +%s)
  WOV_SPERREN_PLAETZE_N=1 timeout 10 "$self" n -- "$self" n -- true 2>/dev/null; r=$?
  [ "$r" = 0 ] || fail "one place, nested on the same name: exit $r (deadlock?)"
  for i in 1 2; do
    ( WOV_SPERREN_PLAETZE_M=2 timeout 15 "$self" m -- bash -c "sleep 1; WOV_SPERREN_PLAETZE_M=2 '$self' m -- true" 2>/dev/null; echo $? > "$t/nest.$i" ) &
  done
  wait
  [ "$(cat "$t/nest.1")" = 0 ] && [ "$(cat "$t/nest.2")" = 0 ] || fail "two nested callers in two outer locks hung or failed ($(cat "$t/nest.1") $(cat "$t/nest.2"))"
  WOV_SPERREN_PLAETZE_A=1 WOV_SPERREN_PLAETZE_B=1 timeout 10 "$self" a -- bash -c "flock -n '$t/b.lock' -c true; echo \$? > '$t/nb'; WOV_SPERREN_PLAETZE_B=1 '$self' b -- true 2>/dev/null; echo \$? >> '$t/nb'" 2>/dev/null
  [ "$(tr -d '\n' < "$t/nb")" = 00 ] || fail "nesting on another name did not take its own place ($(cat "$t/nb"))"
  ok "nesting on a held name runs directly (one place, two outer locks); another name takes its own place"
  # 11. infrastructure errors are not usage errors (t6-B6), --plaetze checks the name (t6-B7)
  e=$(WOV_SPERREN=/proc/gibt/es/nicht "$self" build -- true 2>&1 >/dev/null); r=$?
  [ "$r" = 70 ] && case $e in *"sperre: error:"*) true;; *) false;; esac || fail "unwritable directory: rc $r, '$e'"
  e=$("$self" --plaetze 'a b' 2>&1); r=$?
  [ "$r" = 64 ] && case $e in *"invalid variable"*) false;; *) true;; esac || fail "--plaetze with a bad name: rc $r, '$e'"
  e=$(WOV_SPERREN_PLAETZE_X=abc "$self" x -- true 2>&1 >/dev/null); r=$?
  [ "$r" = 64 ] || fail "non-numeric override: rc $r"
  ok "unwritable directory exits 70 with 'sperre: error:'; bad names and overrides exit 64 cleanly"
  # 12. WOV_SPERRE_GEHALTEN set from outside (t9-B1): free places are taken, a full lock is passed only loudly
  local o
  o=$(WOV_SPERRE_GEHALTEN=" build" "$self" build -- bash -c "flock -n '$t/build.lock' -c true; echo held=\$?" 2>&1)
  case $o in *"build place 1/2 taken"*"held=1"*) ;; *) fail "foreign mark with free places did not take a place: $o";; esac
  for i in 1 2 3 4 5; do
    ( WOV_SPERRE_GEHALTEN=" build" "$self" build -- sleep 2 > /dev/null 2> "$t/fm.$i" ) &
  done
  wait
  local taken direkt
  taken=$(cat "$t"/fm.* | grep -c 'place [0-9]/2 taken'); direkt=$(cat "$t"/fm.* | grep -c 'held by caller, running nested without a place')
  [ "$taken" = 2 ] && [ "$direkt" = 3 ] || fail "5 foreign-marked calls: $taken took a place, $direkt ran nested (want 2 and 3, none silent)"
  ok "foreign WOV_SPERRE_GEHALTEN: free place is taken (held=1), of 5 calls 2 hold places and 3 pass loudly"
  # 13. the nested pass says so, the command still runs and its status passes
  ( "$self" build -- sleep 3 2>/dev/null ) & ( "$self" build -- sleep 3 2>/dev/null ) & sleep 1
  o=$(WOV_SPERRE_GEHALTEN=" build" "$self" build -- bash -c 'exit 5' 2>&1); r=$?
  wait
  [ "$r" = 5 ] && case $o in *"held by caller, running nested without a place"*) true;; *) false;; esac || fail "full-lock pass: rc $r, '$o'"
  ok "all places busy: nested call runs its command with a stderr line, status passes"
  echo "selftest: $n directions ok"
}

if [ "${1:-}" = --selbsttest ]; then selbsttest; exit $?; fi
if [ "${1:-}" = --plaetze ]; then
  [ $# = 2 ] || usage "--plaetze <name>"
  [[ $2 =~ ^[A-Za-z0-9_-]+$ ]] || usage "bad name '$2'"
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
genistet=0
case " ${WOV_SPERRE_GEHALTEN:-} " in
  *" $NAME "*) genistet=1 ;;   # held by an outer sperre.sh: take a free place, else run past the full lock, loudly
esac
mkdir -p "$VERZ" || fehler "cannot create $VERZ"

gemeldet=
while :; do
  for ((i = 1; i <= PLAETZE; i++)); do
    if [ "$i" = 1 ]; then datei=$VERZ/$NAME.lock; else datei=$VERZ/$NAME.$i.lock; fi
    exec {fd}>>"$datei" || fehler "cannot open $datei"
    if flock -n "$fd"; then
      echo "sperre: $NAME place $i/$PLAETZE taken" >&2
      WOV_SPERRE_GEHALTEN="${WOV_SPERRE_GEHALTEN:-} $NAME" "$@"; r=$?
      [ "$r" = 64 ] && echo "sperre: command exited 64" >&2
      exit $r
    fi
    exec {fd}>&-
  done
  if [ "$genistet" = 1 ]; then
    echo "sperre: $NAME held by caller, running nested without a place" >&2
    exec "$@"
  fi
  [ -n "$gemeldet" ] || { echo "sperre: all $PLAETZE places of $NAME busy, waiting" >&2; gemeldet=1; }
  sleep "1.$((RANDOM % 9))"
done
