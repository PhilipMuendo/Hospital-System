# Operations Runbook

For whoever is on call when this breaks. Written to be followed at 3am by
someone who did not build it.

Nothing here is theoretical: every procedure below should be rehearsed before
it is needed. A restore you have never tested is a hope, not a backup.

---

## Targets

| | Target | What it means |
|---|---|---|
| **RPO** — data loss tolerance | **15 minutes** | Continuous WAL archiving. Nightly dumps alone give a 24-hour RPO, which is a day of drug charts. |
| **RTO** — time to restore service | **2 hours** | Time to a working system, not to a perfect one. |
| **Degraded operation** | Indefinite | Ward tablets keep recording offline. Reception, pharmacy and the cash desk cannot. |

If you cannot meet RPO with nightly dumps alone — and you cannot — read
§6 before go-live.

---

## 1. Backups

### Taking one

```bash
export BACKUP_PASSPHRASE='…from the secrets manager, never from the backup volume…'
./scripts/backup.sh
```

Produces `backups/uzima-<UTC timestamp>.dump.enc` plus a `.sha256`.

The script **refuses to keep a backup it cannot verify**: it parses the archive
table of contents and rejects anything with fewer than 10 populated tables. A
backup that silently captured an empty database is worse than no backup,
because you will trust it.

### Schedule

```cron
# Nightly at 01:30 Nairobi, off-peak for a hospital.
30 1 * * *  cd /opt/uzima && BACKUP_PASSPHRASE_FILE=/run/secrets/backup_pass ./scripts/backup.sh >> /var/log/uzima-backup.log 2>&1
```

### The part people skip

`backups/` is **on the same machine as the database**. That protects against
`DROP TABLE`, not against fire, theft or ransomware — ransomware encrypts the
NAS too.

Replicate to object storage with **versioning and an object lock**, so an
attacker with valid credentials still cannot delete history:

```bash
aws s3 sync ./backups s3://uzima-backups/db/ --storage-class STANDARD_IA
```

Keep the passphrase somewhere the backup volume's credentials cannot reach.

---

## 2. Restoring

**Read this whole section before typing anything.**

### Verify first, always

```bash
export BACKUP_PASSPHRASE='…'
DRY_RUN=1 ./scripts/restore.sh backups/uzima-20260820T013000Z.dump.enc
```

Decrypts, checks the SHA-256, parses the archive and lists its tables. Writes
nothing. **Do this monthly** whether or not anything is wrong — see §5.

### Restoring for real

```bash
./scripts/restore.sh backups/uzima-20260820T013000Z.dump.enc
```

You will be asked to type the database name. That prompt is deliberate: a
restore over a live system destroys **everything recorded since the backup** —
observations, drug administrations, payments.

Restore runs in a single transaction, so a failure leaves the database
untouched rather than half-restored.

### Prefer restoring beside, not over

Where there is any doubt, restore into a new database and switch:

```bash
createdb uzima_hms_recovered
TARGET_DATABASE_URL=postgresql://uzima_app:***@localhost:5432/uzima_hms_recovered \
  ./scripts/restore.sh backups/<file>
# verify, then repoint DATABASE_URL and restart
```

The damaged database stays available for forensics, and rollback is a config
change rather than another restore.

---

## 3. After any restore — do not skip

```bash
psql "$DATABASE_URL" -c 'SELECT COUNT(*) FROM "Patient";'
psql "$DATABASE_URL" -c 'SELECT MAX("createdAt") FROM "AuditLog";'
psql "$DATABASE_URL" -c 'SELECT "key","value" FROM "Counter" ORDER BY "key";'
```

1. **Patient count** is roughly what you expect.
2. **Audit trail** runs up to the backup time — that is your data-loss boundary.
3. **Counters** are present. If `Counter` is empty but tickets and receipts
   exist, the next allocation starts at 1 and **collides with existing rows**.
   This has happened before; see ARCHITECTURE.md §4.2. Reseed them:

```sql
INSERT INTO "Counter" ("key","value")
SELECT 'ticket:' || "stationId" || ':' || "serviceDate", MAX("number")
FROM "QueueTicket" GROUP BY 1
ON CONFLICT ("key") DO UPDATE SET "value" = GREATEST("Counter"."value", EXCLUDED."value");
```

4. Sign in, open one patient chart, confirm allergies render.
5. **Reconcile the cash drawer** against the last revenue report. Payments in
   the lost window may have been taken but not recorded.
6. Write the data-loss window into the incident log and tell the wards what
   needs re-entering from paper.

---

## 4. Common incidents

### API is up, database unreachable

Symptom: every request 500s; logs show `Can't reach database server`.

```bash
docker ps --filter name=uzima-postgres          # or: systemctl status postgresql
pg_isready -h <host> -p <port> -U uzima_app
```

Usually the container or service, not the data. Restart it. **Do not restore** —
you will destroy good data to fix a stopped process.

If the port answers but the app cannot connect, suspect a stale port proxy over
a dead container. Restart the container runtime.

### Payments look wrong

1. `/reports/revenue` for the business date.
2. Reconcile against the Safaricom paybill statement.
3. Any receipt on the statement but not in the system means a callback did not
   arrive. Check the audit trail for `DENIED` on `/api/mpesa/callback` — a
   wrong callback secret or an IP outside the allowlist both land there.
4. **A payment is never settled by hand.** Use the status query, which asks
   Safaricom. Editing a billing row directly destroys the evidence trail that
   makes the figure defensible.

### Suspected compromise

```bash
# 1. Take the payment callback offline immediately — clinical work continues.
#    Rotating the secret invalidates the registered callback URL.
#    Edit MPESA_CALLBACK_SECRET in server/.env, then restart.

# 2. Sign everyone out. Rotating JWT_SECRET invalidates every session.
#    There is no session table, so this is the only revocation available.

# 3. Preserve evidence before anything else.
pg_dump "$DATABASE_URL" -t '"AuditLog"' -Fc -f /secure/audit-$(date -u +%FT%TZ).dump
```

Then read `SECURITY.md`. Note the accepted risk: JWTs cannot be revoked
individually, so rotation is all-or-nothing.

### Queue or board looks stuck

The board is driven by SSE. If it is stale but the API is healthy, the stream
dropped and the client is mid-reconnect — the board also polls every 20s as a
backstop, so give it that long.

`serviceDate` controls **token numbering only**. Waiting patients are selected
by ticket status, so nobody disappears at midnight. If patients do vanish at
midnight, that regression is back.

### Disk full

The two tables that grow without bound are `AuditLog` and `DeviceMessage`.

```sql
SELECT relname, pg_size_pretty(pg_total_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;
```

**Do not delete from `AuditLog`.** It is a legal record under the Data
Protection Act 2019. Archive it to cold storage, then delete the archived range
in one transaction. `DeviceMessage` raw payloads older than 90 days are safe to
drop once parsed.

`IdempotencyKey` is prunable — `pruneIdempotencyKeys()` should run daily.

---

## 5. Monthly drill

Diary it. Twenty minutes.

1. `DRY_RUN=1 ./scripts/restore.sh` against the newest backup — must pass.
2. Restore into a scratch database and run the verification queries in §3.
3. Confirm offsite copies exist and match their checksums.
4. Confirm the passphrase in the secrets manager actually decrypts them.
5. Run `npm --prefix server run test:all` against the test database.

Record who ran it and what failed. A drill that has never failed has probably
never been run properly.

---

## 6. Before go-live

- [ ] **WAL archiving to object storage.** Nightly dumps give a 24-hour RPO —
      a full day of drug charts and payments. Continuous archiving with
      point-in-time recovery is what makes the 15-minute target real. This is
      the single largest gap in the current setup.
- [ ] Backups replicated offsite, versioned, with an object lock.
- [ ] Backup passphrase in a secrets manager, never on the backup volume.
- [ ] A restore drill completed and signed off.
- [ ] Monitoring: disk, connection count, error rate, backup success. Right now
      you would learn about an outage from a phone call.
- [ ] Alerts on `LOGIN_FAILED` clusters, `DENIED` on the M-Pesa callback, and
      eTIMS invoices stuck `FAILED`.
- [ ] A read replica, or accept that maintenance means downtime.
- [ ] Everything in `SECURITY.md` § *Before production*.

---

## 7. Contacts

Fill this in before you need it. An empty table here is itself an incident.

| Role | Name | Phone | Escalate after |
|---|---|---|---|
| On-call engineer | | | — |
| Hospital IT lead | | | 30 min |
| Database administrator | | | 30 min |
| Safaricom Daraja support | | | 2 hr |
| Data Protection Officer | | | immediately on suspected breach |
