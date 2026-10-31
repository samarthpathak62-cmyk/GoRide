# Integrated booking and operations batch

## Delivered in source
- Server-persisted, passenger-owned two-minute fare quotes. The client cannot set
  the fare. Quoted retries return the same ride instead of creating another trip.
- Bike/Auto/Car prices retain existing base/km rates. Fare card shows breakdown,
  currency and routing provenance. Optional **HTTPS OSRM-compatible**
  `ROUTING_BASE_URL` uses road distance/duration with timeout and bounded responses.
  Without it, the UI explicitly says **straight-line estimate** and invents no ETA.
  Provider duration is journey duration, not captain arrival ETA. Quotes restrict
  pickup/drop to the initial NCR operational envelope (27.8–29.5N, 76.5–78.1E),
  not an official legal/transport boundary. Configure a proper service polygon and
  category-legal routing before commercial launch.
- Cash or funded wallet selection before booking. Three-minute matching deadline,
  thirty-second captain offers and forty-five-second passenger-confirmation window.
  A periodic worker uses persisted offer claims, so repeated dispatch does not spam
  duplicate offers. Driver polling recovers missed offers. Rider polling recovers
  matching/assignment status. SQL enforces deadlines even if a worker is delayed.
- Captain acceptance requires a live offered trip; rejected/expired offers cannot
  be reused. Expiry/reassignment are system-audited, without attributing an
  automatic cancellation to a passenger action. Timeout does not debit a wallet.
- Explicit captain acknowledgement of actual cash collection. Cash never debits
  the rider wallet or credits captain wallet again. A dedicated ledger records
  physical cash received, captain net and commission **owed**, not transferred.
  Existing 80/20 economics are retained, not represented as a newly approved tariff.
  Commission collection, cash debt limits and settlement are still operator gates.
- Completed-trip receipts, marked as trip receipts, not GST tax invoices. Wallet
  receipts say wallet_paid; cash says captain-confirmed cash_collected, not bank
  verification. No automatic refund or fake bank payout is created.
- Both apps have own-account support tickets, refund-request category, responses,
  emergency dialler (112), safety alert record, expiring/revocable private trip
  sharing and receipt tools. Driver wallet has a separate cash-ledger viewer.
- Share links use random 256-bit capabilities; DB stores only hashes. They show
  pickup/destination, vehicle and status, not identity documents, PIN, phone,
  wallet balance or user IDs. Links stop working at trip end/expiry/revocation.
  Public page is not a GPS tracker; refresh fetches current persisted trip status.
  URL paths are redacted in request logs; pages are no-store/no-referrer/noindex.
- MFA-protected admin queue handles support replies, safety acknowledgements and
  cash ledger inspection. Resolving a refund ticket is **not** a gateway refund.
  An alert is not automatically reported to police and has no guaranteed staffed
  response SLA. The apps explicitly instruct emergency users to dial 112 directly.

## Database and deployment
Migration 013 has been applied LIVE, additively. It creates the six private/RLS
protected quote/offer/cash/support/safety/share tables, new ride fields and service-
only transactional booking/dispatch/settlement RPCs. No live rides, balances or
fake funds were created to test it. Matching worker runs in the backend process
and needs the server service-role key. Backend health version is now 5.

007 access cutover is now included in live migration 014 (screenshot repairs).
009/010 PIN/profile cutovers are now applied live and ACL-verified. In particular, legacy table/RPC permissions and profile/ledger RLS
are now closed at the database layer; broader production review remains required. New endpoints enforce ownership,
and legacy direct ride/message access is now revoked. See trip-pin-rollout.md.

Deploy backend + both apps together. The new booking endpoint requires quoteId;
old apps with client hardcoded fares intentionally cannot book through that new
endpoint. Verify the deployed commit, run migrations only once, and test with two
actual private accounts on physical devices. Builds are not deployment proof.

## Not represented as complete
Merchant/payout KYC, live provider eligibility, actual bank transfers, automatic
refunds, reconciliation/commission remittance, production transport compliance,
secure mobile token storage/refresh, production routing/map credentials, staffed
support/safety, large-scale matching, durable notification outbox, performance and
penetration testing. These require further implementation or real external setup;
no successful provider operation is fabricated.

Final UX checks also remove legacy fabricated pickup/drop coordinates in active
trip recovery and the unused search-card callback. Captain marker waits for actual
location updates, rather than being fabricated at pickup. Captain profile now
opens account-scoped trip history with receipts/support tools for completed trips.
