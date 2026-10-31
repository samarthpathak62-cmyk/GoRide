# GoRide ecosystem delivery plan

Target: Delhi/NCR Bike, Auto and Car; GoRide branding. Functional comparability,
not a claim to copy Rapido's proprietary implementation or to have completed parity.

## Milestone 1 — secure trip foundation (this changeset)
- Authenticated HTTP lifecycle and session-owned active/history reads; arbitrary
  query-string account IDs are not authority.
- Service-only, actor-bound database functions with row/advisory locks, legal
  transitions, one active trip per participant, single captain assignment, event
  audit and idempotent completion. Passenger confirmation cannot be forged by a
  captain; a trip cannot skip directly from pending to completed.
- Wallet settlement locks both accounts and rejects insufficient funds before
  invoking the existing ledger routine. Existing **80% captain share is retained**;
  this is not a newly approved commission policy or bank payout.
- Restricted public driver projection; no captain application documents/DOB in
  passenger trip joins. Static API promotion and fabricated acceptance rating removed.
- Session-authenticated sockets in both apps, expiry disconnect, participant room
  checks, assigned-captain location updates, identity-bound trip messaging/calls,
  limited message sizes/event rate. Rejected captains are removed from trip rooms.
- MFA-protected admin trip list and event timeline; events begin at this upgrade.
- Delhi map centres; missing captain GPS permission is explained, not fabricated.

### Verification and rollout status
Migration 006 (additive functions + private ride_events) has been applied live.
Migration **007 is deliberately staged, NOT applied live**. It revokes legacy ride
CRUD and the unauthorised old completion RPC. Apply it only after the matching
backend is confirmed deployed with a server-side service-role key and new APKs
are available. Without this cutover, legacy direct-database access remains a
security gap; **do not enable real-money production operations**. New functions
are already denied to anon/authenticated roles.

The automated PostgreSQL tests execute the repository's legacy settlement routine
and both migrations using PGlite. Tests cover actors, state order, duplicate booking,
single assignment, completion retry, balanced ledger count, permission grants and
rollback on insufficient funds. Geography is a text-domain fixture: these tests do
not verify PostGIS, actual road routing, provider transfers or concurrent connections.
Do staging tests with real PostgreSQL/PostGIS and simultaneous clients before launch.
No accounts, balances or rides are fabricated in the live project to run tests.

Rollout checklist:
1. Check CI backend and BOTH APK builds for the exact pushed commit.
2. Deploy backend with SUPABASE_SERVICE_ROLE_KEY only in server environment.
3. Upgrade both clients (old unauthenticated socket clients are intentionally rejected).
4. Privately exercise request → accept → passenger confirm → arrive → start →
   complete with two actual test accounts; retry completion and inspect ledger.
5. Apply 007, verify grants, then check HTTP + socket ownership with unrelated users.
6. Payment enablement stays blocked by the remaining hardening and provider gates below.

## Milestone 2 — authentication/privacy completion (next priority)
- Remove shared mutable auth-client sessions; implement secure refresh/expiry and
  server-verified social providers; move mobile tokens to secure OS storage.
- Profile/wallet/transaction/message table RLS and column-level grants; audit all
  SECURITY DEFINER RPCs, conversation access, device token registration and uploads.
- Credential rotation (including tracked Firebase credential history), dependency
  vulnerabilities, request limits, logging/PII retention and per-account abuse controls.
- OTP/PIN trip-start contract (rider-only secret, hash, expiry, retry lockout), full
  device UX in both apps. Current start action checks captain/state, NOT a trip PIN.

## Milestone 3 — booking, pricing and dispatch
- NCR service polygons and operational/legal vehicle eligibility; route-provider
  distance/ETA, versioned fare quotes, transparent breakdown and expiry. Current
  pricing uses straight-line distance, not road distance; no live ETA claims.
- Matching radius/attempts, captain offer expiry, no-driver timeout, reassignment,
  booking idempotency keys, persistent reconnect and state reconciliation.
- Saved places, map search, pickup notes, honest loading/error/no-driver states,
  accessible Hindi/English flows and tested permission recovery.

## Milestone 4 — money lifecycle
- Merchant KYC/live account verification; hosted UPI/cards/netbanking eligibility,
  signed/captured payments, webhook reconciliation and explicit settlement status.
- Cash collection acknowledgement, commission/debt accounting, ledger invariants,
  cancellations/refunds/disputes; captain bank payouts with approved payout provider.
- Direct ride checkout, receipts/tax handling and finance/export operations.
- No fake wallet topups, fake successful transfers or unapproved credit/BNPL claims.

## Milestone 5 — operations, safety and launch
- Captain earnings/availability, document renewal queues and permission revocation.
- Support tickets, accountable ride assistance, share-trip, SOS escalation with a
  real staffed response process (a button alone is not emergency-service integration).
- Reviews/moderation, cancellation policies, notifications with transactional outbox,
  observability/alerting, backup/restore drills and scoped admin permissions.
- Physical Android device matrix, network loss/background location/battery tests,
  simultaneous booking load tests, penetration review and payment sandbox/live tests.

## External gates, not solvable by source code alone
Approved merchant/payout accounts and KYC, routing/geocoding/map provider access,
reliable SMTP/OTP delivery and associated billing, valid transport permissions,
operational safety/support staff, release signing and store distribution. Enter
credentials only in the relevant provider/server settings, never chat/Git/APKs.

## Milestone 2 progress update
Trip-start PIN, isolated password/signup sessions, actor-bound device/logout,
scoped profile access and tested profile/ledger privacy migrations are now in
source. See [trip-pin-rollout.md](trip-pin-rollout.md) for exact live vs staged
migration state, cryptographic contract and device acceptance checklist. Secure
mobile token storage/refresh and the other launch gates remain outstanding.
