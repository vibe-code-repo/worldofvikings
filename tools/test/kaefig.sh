#!/bin/bash
# Cage for the update-script probe (tools/test/vorschau-nicht-getrackt.ts).
#
# Called INSIDE fresh PID/net/IPC/UTS/mount namespaces (see kaefigBefehl in the
# test): as root by `unshare` directly, as a normal user by `unshare -r`.
# It builds a new root and runs the rest of the command line in it:
#   - the whole file system, bind-mounted recursively READ-ONLY (ro=recursive);
#   - /tmp and /run fresh tmpfs (the only writable places);
#   - /proc fresh, so it shows the cage's own PIDs only;
#   - no way back: bounding set without CAP_SYS_ADMIN (no remount, no mount),
#     no_new_privs.
# A command that escapes the text rules finds no network, no service manager
# socket, no pid file to signal and nothing to write to.
#
# Usage: kaefig.sh <cwd> <command> [args...]      (cwd is read-only, like everything else)
set -euo pipefail
cwd="$1"; shift
stage=/mnt
[ -d "$stage" ] || stage=/media
mount -t tmpfs -o size=1m tmpfs "$stage"
mkdir "$stage/wurzel"
mount --rbind -o ro=recursive / "$stage/wurzel"
w="$stage/wurzel"
mount -t tmpfs -o size=512m tmpfs "$w/tmp"
mount -t tmpfs -o size=8m tmpfs "$w/run"
mount -t proc proc "$w/proc"
exec chroot "$w" /usr/bin/setpriv --no-new-privs \
  --bounding-set=-all,+dac_override,+dac_read_search,+chown,+fowner,+fsetid,+setuid,+setgid,+kill \
  --inh-caps=-all \
  /bin/bash -c 'cd "$1" && shift && exec "$@"' kaefig "$cwd" "$@"
