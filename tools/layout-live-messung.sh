#!/usr/bin/env bash
# Timing of the whole guard tick at the limit of live-applied changes (Editor E2, K5.0 N4; before: part of the full run).
#
# Runs server/test/layout-live-grenze.ts with WOV_GRENZE_MESSEN=1: besides the receipts (which the full run
# checks too) every case must have a MEDIAN <= 250 ms over 12 ticks; the median, the maximum and the machine load
# (1-minute loadavg) are printed with every case. The limit `AENDERUNGEN_MAX` is only worth what this measures.
#
# It takes the `measure` place of tools/sperre.sh (one at a time on the machine) and is meant for a quiet machine:
# under load 8-14 case 7 measured 416-515 ms (attack on N3). Say the load with every result.
#
# Usage: tools/layout-live-messung.sh        (from any directory of the worktree)
# Exit:  0 all ok; 1 a receipt or a median failed
set -u
wurzel=$(cd "$(dirname "$0")/.." && pwd)
cd "$wurzel/server" || exit 70
export WOV_GRENZE_MESSEN=1
exec "$wurzel/tools/sperre.sh" measure -- npx tsx test/layout-live-grenze.ts
