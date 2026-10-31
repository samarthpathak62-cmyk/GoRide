# GoRide captain ecosystem — first delivery

This is an original GoRide implementation of common ride-hailing workflows,
not a claim of Rapido affiliation, legal eligibility or full feature parity.
Scope selected: Delhi/NCR; Bike, Auto and Car; secure admin review dashboard.

## Implemented in this delivery
- API-driven vehicle document checklists. Age 18+, six-digit PIN, Delhi/NCR
  operating-city validation, vehicle registration, consent and expiry checks.
- Government ID (masked where applicable; not Aadhaar-only), captain photo,
  licence front/back, RC, insurance, PUC, vehicle photos. Auto/Car operational
  checklists additionally request permit and fitness evidence. These are
  configurable operating requirements, NOT definitive legal advice; a qualified
  reviewer must assess the applicable city/state/vehicle rules and exemptions.
- Private captain-documents storage bucket, upload size/signature limits, owner
  folder policies, no overwrite/delete, 120-second admin document links.
- Applicant-owned server drafts restore form fields/document references after
  restart. Draft save is debounced; interrupted/in-flight uploads may need retry.
- Pending -> approved/rejected human review, mandatory reason, version check and
  audit row in the same transaction. Approved applicants must not self-edit the
  reviewed application. Rejected applicants can correct and resubmit.
- Admin dashboard at `/admin/`, server-controlled app_metadata.role=admin,
  mandatory enrolled TOTP / AAL2, login throttling, in-memory access token,
  no credential/document request-body logging. No admin account auto-created.
- Drivers cannot directly update approval/online state with their own DB JWT.
  Backend service-role operations enforce approval, permission confirmation,
  valid unexpired documents and location checks before going online.
- Matching Bike/Auto/Car categories, server-calculated fares (initial configurable
  values, not Rapido fares), eligible captain filtering and category-aware atomic
  ride claim. Existing `Ride` is treated as the legacy `Car` category.
- Rider AND captain wallets use authenticated verified payment-link checkout.
  Captain Top Up no longer has an empty click handler. Gateway availability is
  visible in both apps; checkout never pretends an unconfigured gateway is live.

## Payments: what is NOT live or implemented
No merchant account/KYC was supplied. UPI/cards/netbanking are offered through
an approved gateway's hosted checkout, subject to actual merchant eligibility.
They are not separate integrations with every bank or UPI app.
Read payments-rollout.md. PAYMENTS_ENABLED stays off until security review and
merchant configuration. Bank/UPI captain payouts require a separate approved
payout product/beneficiary onboarding; not implemented here. Cash ride ledger,
commission settlement, refunds/disputes, reconciliation operations and direct
ride payment checkout remain subsequent work. Top-up is not automatically a
complete ride-payment/payout ecosystem. No transaction with real funds was tested.

## Coordinated deployment — required, NOT performed by this delivery
1. Rotate the committed Firebase service-account credential and provision secrets
   out of source. Do not paste keys/passwords/MFA codes in chat.
2. Stage this backend and test migration
   `supabase/migrations/202610310003_captain_onboarding.sql` in a staging project.
   This migration enables driver RLS and revokes client writes. Do NOT apply it
   independently while the old backend still expects anonymous driver writes.
3. Provision SUPABASE_SERVICE_ROLE_KEY only in backend secrets, never in Flutter.
4. Create an administrator through a trusted operational process; set its role in
   app_metadata (not client-editable user_metadata) and enroll verified TOTP MFA
   using a trusted Supabase client. No MFA bypass/enrollment endpoint is provided
   by this dashboard. Sign in at /admin/ with email/password/authenticator code.
5. Deploy matching backend, apply migration in a coordinated maintenance window,
   install matching APKs. New onboarding depends on this schema. The migration
   intentionally does NOT auto-enable legacy approved captains; re-review their
   applications and documents before activation.
6. Test draft/restart, all three vehicle types, upload privacy, expiry failures,
   rejection/resubmission, approval, online/offline and two-captain ride race.
7. Complete the remaining production security review before enabling real funds.
   Legacy ride lifecycle/socket ownership, profiles/wallet/RPC access and npm
   dependency vulnerabilities are NOT fully remediated by this phase.

The migration was exercised in a transaction with submit/review/audit/permission
assertions, then fully rolled back. Live new policies/schema were NOT deployed.
No live user/account was permanently added or deleted in this delivery.

## Next phases, not completed work
- All ride lifecycle endpoints/socket rooms authenticated and owner-authorised;
  request/claim/arrive/OTP/start/cancel/complete validated atomically and idempotently.
- Atomic cash/online ride ledger, commission/debt, refunds, genuine bank payouts,
  settlement reports, provider reconciliation and fraud controls.
- Captain beneficiary onboarding using provider tokens and audited reviewer roles.
- Jurisdiction-specific launch approval, document verification provider integration,
  consent/retention/deletion policy, incident/SOS operations and support escalation.
- Full end-to-end device and real provider testing in staging before launch.

## Validation
`cd goride_backend && npm ci --ignore-scripts && npm test`
Unit/HTTP tests cover checklist validation, cross-user documents, age/expiry,
consent, region restriction, activation gates, admin role/AAL2 and unauthenticated
HTTP denial, in addition to existing payment and ownership tests. They do not
replace provider, browser, physical-device, regulatory or penetration testing.

## First administrator and account invitations (31 October 2026)

Migration `202610310004_admin_accounts.sql` adds private trusted email reservations,
activation on **verified** ownership, and account-management auditing. It does not
ship a password or silently create a verified owner. The authorised owner's email
reservation was inserted separately in the live project; it is not embedded in SQL.

After deploying this branch, open `https://goride-phjs.onrender.com/admin/`:
1. Select **First admin / invited admin: create your account**.
2. Enter the authorised email and choose a private password (12+ characters).
3. Confirm the email, then sign in. First sign-in displays a QR code/setup key for
   an authenticator app; verify its six-digit code. Later sign-ins require that code.
4. In **Accounts & admin access**, invite riders/captains/admins, or grant admin
   access to an existing verified account. Recipients choose their own passwords.
   Existing accounts are not overwritten. Admins must still complete MFA.

Only server-side trusted `app_metadata.role=admin` plus an AAL2 session permits
account listing, invitations, captain review and payments-status access. Enrollment
and invitation tokens remain in memory; fragments are cleared immediately. No
browser token persistence is used. An account operation requires the backend's
`SUPABASE_SERVICE_ROLE_KEY`, never an APK or browser setting. Failed email sending
must be resolved in Supabase email/SMTP configuration; no delivery is promised.
The production root and `/admin/` must remain allowed auth redirects. Email
confirmation must remain enabled. An administrator can consume another verified
admin grant only after signing in again to obtain updated trusted claims.

### Onboarding load failure
The live project was missing the draft/private-document/application RPC schema,
not merely an old server deploy. Migration 003 has now been applied. Verified live:
`driver_application_drafts` and `captain_review_audit` have RLS enabled, the
`captain-documents` bucket is private, and the submit RPC exists. New client errors
identify requirements vs saved-draft vs status loading; a missing draft schema
returns `ONBOARDING_SCHEMA_MISSING` instead of the generic black-page message.
`GET /health` now reports `apiVersion: 2` and Render's deployed commit, if supplied.
Live schema checks do not replace a real device submission and admin review test.

### Verified-owner login repair and simpler MFA flow
A live verified owner was found with an active, correctly bound grant but no trusted
`app_metadata.role`. Migration 005 repairs bound verified active grants and includes
metadata updates in the activation trigger, so an auth-provider metadata rewrite
cannot silently erase a reserved admin role. This repair was applied live and the
authorised owner was rechecked as verified + admin + correctly bound. It does not
change any password, disable verification, or remove MFA.

The initial login page now asks only email/password. Both new enrollment and an
existing authenticator use a separate second step, with AAL1 credentials kept only
in memory. New users get same-phone manual-key instructions as well as a QR;
returning users see neither a QR nor a setup key. The text explicitly distinguishes
authenticator codes from SMS/email OTP. Successful password login without admin
access is reported separately from incorrect credentials. Actual password login
and authenticator completion must still be performed privately by the user.
