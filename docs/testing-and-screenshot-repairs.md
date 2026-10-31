# October 31 screenshot repairs

Root cause verified by read-only live SQL: 11 pending legacy rides had NULL quote
IDs and NULL matching deadlines. The old expiry SQL did not match NULLs. Migration
014 falls back to created_at + 3 minutes, closes stale pending/assigned searches
with system audit events and adds an insert guard for future legacy requests.
It does not cancel accepted/started trips or mutate balances. History reads also
refresh expiry; My Bookings offers authenticated cancellation before trip start.

Messaging/calls now require an active shared assigned trip at every socket event.
Historical reads are separate from send permission. A message INSERT trigger
share-locks the active trip to serialize against cancellation/completion, and
legacy direct ride/message table and conversation RPC access is revoked (007
cutover included). A previously-open chat checks permission every 8 seconds;
server enforcement is immediate. Messages display only on server echo, failures
are surfaced through socket acknowledgements rather than fake optimistic success.
Rider unread counts and nullable timestamps are decoded defensively (null > 0
was causing a release-mode error widget). Both chat details show errors, not
perpetual spinners, and captain calls/input are no longer unconditionally enabled.

CARTO's key-required tiles are replaced with OSM standard raster tiles and visible
attribution. This is for modest interactive testing, not an unlimited production
map contract: respect OSM tile policy; no bulk/offline prefetch. Configure a
licensed production tile provider before scaling. GPS still requires device
permission/location service and an internet connection.

Both Android apps request notification permission and create incoming_trips_v2
with a bundled original two-second alert sound and vibration. Foreground socket
and FCM captain offers deduplicate by ride ID; polling can recover an offer if
socket delivery failed. Backend FCM uses high priority, 30s TTL, the matching
channel and sound. Background push needs working Firebase configuration, token
registration, user permission and allowed battery settings. Android silent/DND
or user-muted channels are not bypassed. Actual device sound/background delivery
must be checked; CI compilation is not phone verification.

## Razorpay test mode (no bank transfer)
Set on the backend via its secure environment settings, never in chat or APK:
- PAYMENT_MODE=test
- PAYMENTS_ENABLED=true
- RAZORPAY_KEY_ID: your provider **test** key (rzp_test_ prefix)
- RAZORPAY_KEY_SECRET: its matching secret
- RAZORPAY_WEBHOOK_SECRET: test webhook secret
- webhook: /api/wallet/webhook endpoint, payment_link.paid

Only use the
provider's supported test instruments, not real card/account credentials. A
signed event is not enough: the backend retrieves the payment and link, checks
captured status/amount/currency/order using the mode-specific provider credentials (Razorpay payments do not require a live boolean field). Failed or
merely authorized payments do not credit anything. Test orders have an explicit
mode and credit only sandbox_payment_credits, never profiles.wallet_balance or
transactions. Repeated webhooks credit once. The app shows an unspendable sandbox
balance in payment availability text. Test credits cannot pay real rides, enter
captain earnings or be withdrawn. Use cash to test operational trips, or a
separate staging database for end-to-end financial simulation.

No test merchant keys have been provisioned by this code and no actual provider
transaction has been performed here. Live activation uses PAYMENT_MODE=live,
matching rzp_live_ keys, live webhook configuration and approved merchant setup.
Keep test order history; never convert sandbox balances into live funds. Bank
payout/refund-provider integration is still not implemented by this sandbox.

Live verification after 014/015: 11 system-expiry events, 0 pending rides, 3 completed rides unchanged, direct authenticated message INSERT and ride UPDATE both denied, sandbox credits 0. No gateway test was performed or funds credited. 009/010 PIN/profile cutovers were subsequently applied live and ACL-verified: client wallet updates and core lifecycle execution are denied; profile/transaction/ride/message RLS is enabled. Provider/device acceptance remains unverified.
