#!/usr/bin/env bash
# Restarts a systemd user service when one of its processes still maps a
# system file that a package update has since replaced. A long-running process
# keeps using the old copy (of a shared library, or of Node itself) until it
# restarts, so security updates do not reach it before then.
# Usage: restart-if-libs-replaced.sh <user unit> [--dry-run]
set -euo pipefail

unit=${1:?usage: restart-if-libs-replaced.sh <user unit> [--dry-run]}
dry_run=${2:-}

cgroup=$(systemctl --user show -p ControlGroup --value "$unit")
procs=/sys/fs/cgroup$cgroup/cgroup.procs
if [ -z "$cgroup" ] || [ ! -r "$procs" ]; then
    echo "$unit is not running"
    exit 0
fi

# Only system paths count: memfd regions and temporary files are deleted by
# design and say nothing about updates.
replaced=$(
    while read -r pid; do
        grep -oE ' /(usr|lib|lib64|bin|sbin)/[^ ]+ \(deleted\)$' "/proc/$pid/maps" 2>/dev/null || true
    done < "$procs" | sed -E 's/^ //; s/ \(deleted\)$//' | sort -u
)

if [ -z "$replaced" ]; then
    echo "$unit: no replaced system files"
    exit 0
fi
echo "$unit maps replaced files: $(paste -sd' ' <<<"$replaced")"
if [ "$dry_run" = --dry-run ]; then
    exit 0
fi
systemctl --user restart "$unit"
echo "$unit restarted"
