# Authentication fixes and remaining rollout

## Implemented
- Supabase GoRide Site URL / redirect allowlist updated from localhost to
  https://goride-phjs.onrender.com/. Email confirmation remains required.
- Signup without a session no longer writes a logged-in cached user in either app.
- Cached sessions missing a token, expired, malformed, or not MFA-verified are
  cleared locally. Users must log in again (automatic refresh is not implemented).
- Driver status requests time out after 30 seconds. Initial status errors render
  a Retry action rather than mounting the document screen, which itself fetches
  status and previously could create a fetch/loading/remount loop.
- Driver login routes through DriverStatusWrapper instead of always routing to
  document submission, including for already-approved drivers.
- Backend root renders email confirmation/error guidance and clears URL fragments.
- Social buttons now explain the unavailable configuration; they do NOT perform
  OAuth yet. Google, Facebook and Apple are disabled in the live Supabase project,
  with no client IDs/secrets configured as inspected on 2026-10-31.

## Deployment required
1. Deploy the changed backend to Render. The branch is not main; do not assume
   Render automatically deploys it.
2. Build and install updated user and driver APKs from this branch.
3. Request a fresh confirmation email; an old email may retain its old redirect
   or be expired/consumed. After confirming, return to the app and log in.
4. Test fresh signup, unconfirmed signup/restart, normal login, approved driver
   login, document submission/restart, expired cache and offline status/Retry.

## Remaining social login work
Configure Google Cloud / Meta developer OAuth apps using Supabase callback:
https://bcpqfckhceiepslwlycz.supabase.co/auth/v1/callback
Store provider secrets in Supabase dashboard, not chat or source control.
Then implement mobile browser OAuth + app-specific callbacks, backend validation
of provider sessions, rider/driver role enforcement, MFA challenge handling and
secure refresh-token storage/rotation. An alert is not an OAuth implementation.

## Validation
`node --test goride_backend/test/auth-signup.test.js`
Backend JavaScript syntax and git whitespace checks passed. Flutter tools and an
Android device are unavailable here: no compiled APK or device test is claimed.

## Separate security follow-up
The repository contains goride_backend/firebase-service-account.json. Treat any
committed private service-account key as exposed: rotate/revoke it in Google
Cloud and use deployment secret storage instead. No private key is reproduced
in this report.

## Driver status follow-up (2026-10-31)
- Live inspection found 3 auth users, but 0 profiles and 0 drivers. Missing
  verification rows caused `/drivers/status` to return `data: null`; the app
  indexed null and entered its generic error screen on every retry.
- Driver app now treats null as `not_submitted`/pending onboarding, including
  when connecting to the older backend. Updated backend also returns explicit
  onboarding status. Actual database errors remain errors, not fake onboarding.
- All REST/socket/wallet backend origins now use BackendConfig per app. Wallet
  had still referenced a private LAN address. External map/social URLs are kept.
- Profile creation trigger is applied live and recorded as a migration. Driver
  services use the authenticated request's scoped client and upsert by user_id.
- All 3 auth users deleted at user's explicit request. Cascading deletion scope
  was checked; profiles/drivers/rides/transactions/messages were empty beforehand.
- New APK installation AND Render backend deployment remain required. This
  workspace cannot verify device behavior or the live Render deployment.
- Live drivers/profiles tables have RLS disabled. This is a separate production
  security gap; comprehensive RLS and wallet endpoint authorization need review
  before storing real driver documents or money. No blanket policy is added.
