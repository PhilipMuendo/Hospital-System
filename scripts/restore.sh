#!/usr/bin/env bash
#
# Restore from an encrypted backup.
#
# Deliberately awkward to run against a live database. Restoring over a
# working hospital system destroys everything recorded since the backup was
# taken — every observation, dose and payment in between. The confirmation
# prompt exists to make that a decision rather than a keystroke.
#
# Usage:
#   ./scripts/restore.sh backups/uzima-20260820T170000Z.dump.enc
#   TARGET_DATABASE_URL=postgresql://... ./scripts/restore.sh <file>   # restore elsewhere
#   DRY_RUN=1 ./scripts/restore.sh <file>                              # verify only
#
# Read RUNBOOK.md before using this in anger.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:-}"

if [ -z "$ARCHIVE" ]; then
  echo "Usage: $0 <backup.dump.enc>" >&2
  echo >&2
  echo "Available backups:" >&2
  ls -1t "$ROOT/backups"/uzima-*.dump.enc 2>/dev/null | head -10 >&2 || echo "  (none found)" >&2
  exit 1
fi

[ -f "$ARCHIVE" ] || { echo "ERROR: $ARCHIVE not found" >&2; exit 1; }

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_PASSPHRASE is not set." >&2
  exit 1
fi

TARGET="${TARGET_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$TARGET" ] && [ -f "$ROOT/server/.env" ]; then
  TARGET="$(grep -E '^DATABASE_URL=' "$ROOT/server/.env" | head -1 | cut -d= -f2- | tr -d '"')"
fi
[ -n "$TARGET" ] || { echo "ERROR: no target database URL" >&2; exit 1; }

DB_NAME="$(echo "$TARGET" | sed 's#.*/##; s#?.*##')"

# --- integrity -------------------------------------------------------------

if [ -f "$ARCHIVE.sha256" ]; then
  echo -n "Checking integrity… "
  ACTUAL="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
  EXPECTED="$(cat "$ARCHIVE.sha256")"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "FAILED"
    echo "ERROR: checksum mismatch — the archive is corrupt or was tampered with." >&2
    exit 1
  fi
  echo "ok"
else
  echo "WARNING: no .sha256 alongside the archive; integrity not verified." >&2
fi

# --- decrypt ---------------------------------------------------------------

TMP="${RESTORE_TMPDIR:-$(mktemp -d)}"
mkdir -p "$TMP"
trap 'rm -rf "$TMP"' EXIT
DUMP="$TMP/restore.dump"

# A full disk makes openssl fail in exactly the same way a wrong passphrase
# does, and "wrong passphrase" is a very expensive thing to believe during a
# recovery. Check first and say which it is.
NEED_KB=$(( $(wc -c < "$ARCHIVE") / 1024 * 3 ))
AVAIL_KB="$(df -Pk "$TMP" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt "$NEED_KB" ]; then
  echo "ERROR: not enough space to decrypt." >&2
  echo "       Need ~${NEED_KB}KB in $TMP, have ${AVAIL_KB}KB." >&2
  echo "       Free space, or set RESTORE_TMPDIR to a volume that has room." >&2
  exit 1
fi

echo -n "Decrypting… "
if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
      -in "$ARCHIVE" -out "$DUMP" -pass env:BACKUP_PASSPHRASE 2>/dev/null; then
  echo "FAILED"
  echo "ERROR: decryption failed." >&2
  echo "       Most likely a wrong passphrase or a damaged archive." >&2
  echo "       Disk space was checked, so it is not that." >&2
  exit 1
fi
echo "ok"

echo -n "Verifying archive… "
pg_restore --list "$DUMP" > "$TMP/toc" 2>/dev/null || {
  echo "FAILED"
  echo "ERROR: archive is unreadable." >&2
  exit 1
}
TABLES="$(grep -c 'TABLE DATA' "$TMP/toc" || true)"
echo "ok ($TABLES tables)"

if [ "${DRY_RUN:-}" = "1" ]; then
  echo
  echo "DRY_RUN — archive is valid and restorable. Nothing was written."
  echo "Contents:"
  grep 'TABLE DATA' "$TMP/toc" | awk '{print "  " $(NF-1)}' | head -40
  exit 0
fi

# --- confirmation ----------------------------------------------------------

echo
echo "================================================================"
echo "  About to restore into:  $DB_NAME"
echo "  From:                   $(basename "$ARCHIVE")"
echo
echo "  This DROPS existing objects and replaces them. Everything"
echo "  recorded since this backup was taken will be LOST — including"
echo "  observations, drug administrations and payments."
echo "================================================================"
echo
read -r -p "Type the database name ($DB_NAME) to proceed: " CONFIRM
if [ "$CONFIRM" != "$DB_NAME" ]; then
  echo "Aborted."
  exit 1
fi

# --- restore ---------------------------------------------------------------

echo
echo "Restoring…"

# --clean --if-exists so a partial previous restore does not block this one.
# --single-transaction so a failure leaves the database untouched rather than
# half-restored, which is the worst possible state to be in.
pg_restore \
  --dbname="$TARGET" \
  --clean --if-exists \
  --no-owner --no-privileges \
  --single-transaction \
  --exit-on-error \
  "$DUMP"

echo
echo "Restore complete. Now, before letting anyone back in:"
echo "  1. psql \"\$DATABASE_URL\" -c 'SELECT COUNT(*) FROM \"Patient\";'"
echo "  2. Sign in and open one patient chart."
echo "  3. Check the audit trail has entries up to the backup time."
echo "  4. Reconcile the cash drawer against the last revenue report."
echo
echo "Record the data-loss window in the incident log: anything between the"
echo "backup timestamp and the outage is gone and may need re-entering from"
echo "paper."
