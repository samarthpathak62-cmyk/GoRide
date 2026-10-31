> Current status (2026-10-31 screenshot repair): 009/010 cutovers are now LIVE, as is 007 via migration 014. Do not reapply them. Client wallet updates, core lifecycle execution and direct ride/message access are denied. The rollout checklist below is historical guidance; live phone/provider/deployment acceptance remains to be established.

# Trip verification and account privacy — 31 October 2026

## Implemented in source
- Passenger-only `POST /api/rides/:rideId/start-pin`, `rotate: true` for explicit
  replacement; responses are no-store. The PIN never appears in the ride row,
  driver response, socket broadcast, notification payload or persisted mobile cache.
- Four-digit cryptographically random PIN, keyed HMAC digest and AES-256-GCM
  encrypted recovery envelope. HKDF separates verification/encryption keys. Envelope
  context binds the ride, rider and assigned captain. A dedicated TRIP_PIN_SECRET
  is optional; otherwise the **server-only** service-role key derives the keys.
  Rotating the root key invalidates recovery of existing PINs; request replacements.
  Never put either secret in a mobile build, Git or chat.
- DB transaction locks ride/PIN, validates assigned captain and arrival state,
  commits failed attempts even when the API rejects the attempt, locks after 5
  wrong codes, expires after 15 minutes, requires a 60-second replacement cooldown,
  caps generations at 5. Successful retries do not restart the trip or create a
  second start event. RPCs and the PIN table are service-only with RLS enabled.
- Rider PIN card/replacement controls and captain PIN dialog; error feedback and
  disabled verification button while awaiting response. Recovered started trips
  hydrate state from the actor-owned active-trip endpoint and hide the PIN card.
- Socket start/completion events no longer reissue start/completion HTTP mutations.
- Signup/password login use independent ephemeral auth clients. Profile operations
  verify token identity, use scoped clients and explicitly allow name/avatar/device
  fields only. FCM/logout controllers ignore supplied userId. MFA/device/logout
  routes require a verified session (MFA assurance is separately enforced by GoTrue).
- Profile photos use a dedicated intentionally public avatar bucket, JPEG/PNG byte
  checks and a 2 MB limit; private identity documents stay in captain-documents.
- Profile/transaction RLS and column grants are prepared and PostgreSQL-tested:
  self-only reads/edits, no client wallet_balance/ownership changes or ledger writes.
  Notification lookup uses a service client rather than another user's mutable
  login session. JSON request cap is 4 MB; auth/PIN endpoints are rate limited.
- Legacy payout SQL is disabled. A fake ledger debit is not a bank transfer; negative
  payout amounts cannot manufacture credits through that old function.

## Live vs staged — do not conflate
Already applied LIVE this milestone:
- 008 trip_start_pin (additive private PIN storage + RPCs)
- 011 disable_legacy_payout (safe independently; public payout API was already disabled)
- 012 profile_photos (additive avatar bucket + owner-only insert policy)

NOT applied live in this milestone:
- 007 ride_access_cutover (legacy ride/chat table and RPC lockdown)
- 009 trip_pin_cutover (blocks old actor-bound action=start route in the DB)
- 010 profile_privacy (profile/ledger RLS and column restrictions)

Stage 007/009/010 only after confirming the deployed backend is this version,
server service-role configuration works, and both updated APKs are available.
The source APIs require PIN verification, but older deployed endpoints/direct DB
permissions remain a security gap until the coordinated cutover. In particular,
**profile/ledger client access is NOT production-safe before 010**. Keep real-money
production disabled. Backend API version is now 4; health build must match the
pushed commit. Source/build success is not Render or physical-device verification.

## Verification
Automated tests use actual PostgreSQL (PGlite) for PIN ownership, persisted failed
attempts, lockout, expiry, replacement, idempotent start, event count, RPC permissions,
legacy bypass denial, profile/ledger RLS, protected columns and disabled payout.
Node tests cover AES-GCM tampering/context binding, HMAC scope, concurrent login
isolation and forged device/logout account IDs. Geography and storage are schema
fixtures; these tests do not prove PostGIS routing, provider operations or Android UX.

Before launch, exercise with two real private test accounts on physical devices:
1. Book, accept and confirm; only passenger can fetch PIN, captain cannot fetch it.
2. Verify wrong attempts persist; passenger replaces after cooldown; old PIN fails.
3. Arrive and enter correct PIN; rider hides code; captain shows in-progress state.
4. Reload/reconnect both apps; do not replay start/completion requests on events.
5. Expire/cancel/replace and try unrelated users. No PIN should appear in logs,
   notifications, admin timelines or driver/ride API data.
6. Apply and verify cutover grants/RLS, then repeat cross-user/negative-amount tests.

Still pending: secure OS token storage and automatic refresh/revocation handling,
provider/social setup, credential rotation, dependency vulnerabilities, avatar
metadata sanitisation/retention, road-distance quotes/dispatch expiry and full
cash/refund/payout/payment reconciliation. This is not full Rapido parity or a
physical-device/real-money acceptance sign-off.
