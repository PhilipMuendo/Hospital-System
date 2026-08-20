#!/usr/bin/env bash
#
# Encrypted database backup.
#
# A hospital that loses its database loses every patient's history: allergies,
# drug charts, results, the audit trail that proves who saw what. There is no
# reconstructing that from paper.
#
# Design decisions:
#   - Custom format (-Fc), not plain SQL. It is compressed, and pg_restore can
#     do selective and parallel restores from it, which matters when you are
#     recovering one corrupted table at 3am rather than the whole database.
#   - Encrypted at rest. The dump contains every patient record in the
#     facility; an unencrypted copy on a NAS is a breach waiting to be found.
#   - The backup is verified immediately. An unverified backup is a hope, not a
#     backup, and the failure mode is discovering it at the worst moment.
#
# Usage:
#   ./scripts/backup.sh                 # uses DATABASE_URL from server/.env
#   BACKUP_DIR=/mnt/nas ./scripts/backup.sh
#
# Restore with ./scripts/restore.sh — and read RUNBOOK.md first.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
RETAIN_DAYS="${RETAIN_DAYS:-30}"

# --- configuration ---------------------------------------------------------

if [ -z "${DATABASE_URL:-}" ] && [ -f "$ROOT/server/.env" ]; then
  # shellcheck disable=SC1091
  DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ROOT/server/.env" | head -1 | cut -d= -f2- | tr -d '"')"
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set and server/.env has none." >&2
  exit 1
fi

# BACKUP_PASSPHRASE must NOT live next to the backups. If an attacker who
# reaches the backup volume also finds the key, the encryption bought nothing.
if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
  echo "ERROR: BACKUP_PASSPHRASE is not set." >&2
  echo "       The dump contains every patient record. It is not written unencrypted." >&2
  echo "       Store the passphrase in a secrets manager, never on the backup volume." >&2
  exit 1
fi

command -v pg_dump >/dev/null || { echo "ERROR: pg_dump not on PATH" >&2; exit 1; }
command -v openssl >/dev/null || { echo "ERROR: openssl not on PATH" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASENAME="uzima-$STAMP"
DUMP="$BACKUP_DIR/$BASENAME.dump"
ENCRYPTED="$DUMP.enc"

echo "Backing up to $ENCRYPTED"

# --- dump ------------------------------------------------------------------

# --no-owner / --no-privileges so the dump restores onto a host where the role
# names differ, which is the normal case in a disaster.
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-privileges \
  --file="$DUMP"

SIZE_BYTES="$(wc -c < "$DUMP")"
if [ "$SIZE_BYTES" -lt 4096 ]; then
  echo "ERROR: dump is only $SIZE_BYTES bytes — refusing to keep a likely-empty backup." >&2
  rm -f "$DUMP"
  exit 1
fi

# --- verify BEFORE encrypting ----------------------------------------------

# pg_restore --list parses the archive's table of contents. If this fails the
# dump is corrupt, and it is far better to know now than during a recovery.
if ! pg_restore --list "$DUMP" > "$DUMP.toc" 2>/dev/null; then
  echo "ERROR: dump failed verification — archive is unreadable." >&2
  rm -f "$DUMP" "$DUMP.toc"
  exit 1
fi

TABLE_COUNT="$(grep -c 'TABLE DATA' "$DUMP.toc" || true)"
if [ "$TABLE_COUNT" -lt 10 ]; then
  echo "ERROR: dump contains only $TABLE_COUNT tables with data — that is not a full backup." >&2
  rm -f "$DUMP" "$DUMP.toc"
  exit 1
fi
rm -f "$DUMP.toc"

# --- encrypt ---------------------------------------------------------------

# AES-256 with PBKDF2. -salt is default but stated for clarity.
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in "$DUMP" -out "$ENCRYPTED" \
  -pass env:BACKUP_PASSPHRASE

shred -u "$DUMP" 2>/dev/null || rm -f "$DUMP"

sha256sum "$ENCRYPTED" | awk '{print $1}' > "$ENCRYPTED.sha256"

# --- retention -------------------------------------------------------------

# Local retention only. This is NOT offsite: ransomware encrypts the NAS too.
# Sync $BACKUP_DIR to immutable object storage separately — see RUNBOOK.md.
find "$BACKUP_DIR" -name 'uzima-*.dump.enc' -mtime "+$RETAIN_DAYS" -print -delete 2>/dev/null || true
find "$BACKUP_DIR" -name 'uzima-*.dump.enc.sha256' -mtime "+$RETAIN_DAYS" -delete 2>/dev/null || true

echo "OK  $(du -h "$ENCRYPTED" | cut -f1)  $TABLE_COUNT tables  sha256 $(cut -c1-16 < "$ENCRYPTED.sha256")…"
echo
echo "Reminder: this copy is on the same machine as the database."
echo "Replicate it offsite, and test a restore monthly — see RUNBOOK.md."
