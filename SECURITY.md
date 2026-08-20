# Security

What was found when the system was reviewed as an attacker would see it, what
was fixed, and what still has to be true before this handles real money or real
patients.

---

## Threat model

Who we are actually defending against, in rough order of likelihood:

1. **A dishonest insider with a valid login.** The clerk who takes cash and
   marks the bill paid. The commonest fraud in a facility, and the one a
   permission system alone cannot stop — it needs evidence.
2. **Someone on the hospital LAN.** Biomedical VLANs are flat, printers get
   plugged into the wrong port, and a device with a static IP is not an
   identity.
3. **The public internet reaching a callback URL.** Payment webhooks are
   internet-facing by necessity.
4. **A lost or shared device.** Ward tablets are shared and rarely locked.

Not defended against, and out of scope: a compromised database host, a
malicious administrator, or a nation-state.

---

## Findings

### CRITICAL — forged M-Pesa callbacks settled real bills · **fixed**

The callback endpoint was unauthenticated by design, on the reasoning that
"Daraja carries no credentials". It trusted the caller to be Safaricom.

**Reproduced end to end.** A clerk starts a genuine STK push; the `202`
response handed the browser the `CheckoutRequestID`; an unauthenticated `POST`
to `/api/mpesa/callback` carrying that ID and `ResultCode: 0` marked a **KES
15,500 radiology bill `PAID`** with receipt `FAKE12345` — while the forged
payload claimed **KES 1** had been paid. No cookie, no signature, nothing.

That is a complete fraud path for any clerk who can start a payment, and for
anyone who can reach the endpoint and guess an ID.

**Fixed** with four independent controls, because Daraja offers no signature:

| Control | Detail |
|---|---|
| Secret in the URL | `/api/mpesa/callback/<MPESA_CALLBACK_SECRET>`. Wrong secret → **404, not 403** |
| Source IP allowlist | `MPESA_ALLOWED_IPS`, enforced in code, not delegated to the proxy |
| Amount verification | Callback amount must match the pushed amount, else the transaction fails and is logged |
| Secret not leaked | `CheckoutRequestID` no longer returned to the browser |

The process **refuses to start** under `NODE_ENV=production` without the
secret and allowlist.

*Verified after the fix:* the old path returns 404, a wrong secret returns 404,
a correct secret with a mismatched amount leaves the bill `PENDING`.

### HIGH — unlimited credential attempts · **fixed**

Twelve wrong passwords in a row all returned `401`. No throttling, no lockout,
no alerting — free offline-speed brute force against a system holding PHI.

**Fixed:** 10 attempts per 15 minutes, keyed on **IP *and* the email being
tried**. Keying on IP alone would let one attacker lock every user out from a
shared clinic NAT address; keying on email alone would ignore password
spraying. Rate-limit hits are audited.

*Verified:* attempts 11–15 return `429`; a different account from the same IP
still signs in normally.

### MEDIUM — information disclosure and resource limits · **fixed**

- `X-Powered-By: Express` advertised the stack. Now disabled, `helmet` added
  (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`).
- JSON bodies were unbounded and a 200KB body produced a stray `500`. Now
  capped at 256KB answering `413`.
- `trust proxy` is explicit. A wrong value either collapses rate limiting into
  one bucket or lets `X-Forwarded-For` spoof it.

### Checked and found sound

- **Role boundaries hold.** A `LAB_TECH` gets `403` on audit, billing, cashier,
  users and M-Pesa endpoints.
- **SQL injection.** Prisma parameterises everything; the one `$queryRaw`
  (`lib/sequence.ts`) uses a tagged template, which is parameterised.
- **CSRF.** Session cookie is `httpOnly` + `SameSite=Lax`, which blocks
  cross-site state-changing POSTs. CORS is an explicit allowlist.
- **Public board.** Exposes token, room and at most a first name; private
  clinics render token-only. No surname, no clinic name that discloses a
  condition.
- **Audit redaction.** Credentials are stripped at any depth; failed logins
  record the email tried, never the password attempt.

### Accepted risks

**Clinical staff can read any patient chart.** Correct for a hospital — ward
cover, night shifts and emergencies all depend on it. Controlled by the audit
trail rather than by blocking access. Every chart read is logged with actor,
role, IP and timestamp.

**JWTs cannot be revoked.** 12-hour expiry, no `jti`, no deny-list. A stolen
token is valid until it expires. Fixing it properly means a session table or
short-lived tokens with refresh; not done, and it should be before this is
public-facing.

---

## Before production

Non-negotiable:

- [ ] `MPESA_CALLBACK_SECRET` — 24+ random chars, registered with Safaricom as
      part of the callback URL. **The server will not start without it.**
- [ ] `MPESA_ALLOWED_IPS` — Safaricom's published source addresses.
- [ ] `JWT_SECRET` — long and random. Rotating it signs everyone out, which is
      the correct behaviour after a suspected compromise.
- [ ] `TRUST_PROXY_HOPS` — match your actual proxy depth.
- [ ] TLS everywhere. Session cookies are `secure` only when
      `NODE_ENV=production`.
- [ ] `HL7_ALLOWED_IPS` if the MLLP listener is enabled, and bind it only to
      the biomedical VLAN.
- [ ] Confirm no adapter is in mock mode. Each throws under
      `NODE_ENV=production`, but check rather than trust.

Strongly recommended:

- [ ] Database encryption at rest, and encrypted backups held separately.
- [ ] Ship `AuditLog` to append-only external storage. An attacker with
      database access can delete rows the application cannot.
- [ ] Alert on `LOGIN_FAILED` clusters, `DENIED` on the M-Pesa callback, and
      any eTIMS invoice stuck `FAILED`.
- [ ] Schedule `pruneIdempotencyKeys()` daily.
- [ ] Penetration test before go-live. This review was one engineer for one
      session; it is not an assurance engagement.

---

## Reporting

Found something? Do not open a public issue. Contact the facility's IT lead
directly. If it involves payments, assume it is being exploited and disable
the M-Pesa callback by rotating `MPESA_CALLBACK_SECRET` — that takes the
endpoint offline immediately without touching anything clinical.
