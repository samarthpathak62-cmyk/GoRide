# User-app repairs and payments rollout

## Applied live in Supabase
- Added `rides.category` with safe default `Ride`; schema cache reload requested.
- Fixed `get_user_conversations` sorting by the actual message timestamp.
- Disabled `topup_wallet` and revoked client execution. Existing fake/demo credits
  were NOT silently deleted or presented as proof of real payment.
- Added private payment_orders ledger and service-role-only atomic credit RPC.
  Replay of an already credited payment returns balance without crediting again.
- Atomic credit/replay integration test ran in a transaction and was rolled back;
  no test balance, order or test user was retained.

## Implemented in source (backend deployment + APK updates required)
- Wallet endpoints authenticate and derive ownership from req.user, not userId.
  Both apps attach Bearer tokens for wallet reads and operations.
- Profile payment sheet reads the same WalletBloc/API balance instead of Rs 0.00.
- A ride fare can exceed INR 100; rejection now shows the actual fare and balance.
  The insufficient-funds check is not bypassed and no free rides are fabricated.
- User Add Money requests a hosted Razorpay payment link and opens the browser.
  Browser return / opening checkout is NOT treated as successful payment.
  Wallet refreshes on resume; delayed webhook can require another pull-to-refresh.
- Wallet credit requires a raw-body HMAC signed payment_link.paid webhook AND
  authenticated Razorpay API confirmation of matching order, INR amount, linked
  payment ID and captured payment status. Credit/ledger insert is transactional.
- Old `/api/wallet/topup` returns 410; new app uses `/api/wallet/payment-link` so it
  cannot accidentally call the old backend's unsafe fake credit endpoint.
- Send explicitly reports unavailable; history now opens transaction history.
- Card/mobile-wallet/cash support is not falsely advertised as already enabled.
- Bank payouts explicitly fail closed; the old RPC debit was not a bank transfer.

## Razorpay setup — NOT done automatically
An approved India merchant account/KYC and enabled Payment Links are required.
Do not put keys in Git, the APK, screenshots or chat. Set these in Render secrets:
- SUPABASE_SERVICE_ROLE_KEY (backend only)
- RAZORPAY_KEY_ID (live rzp_live_ key; test keys deliberately do not enable real top-up)
- RAZORPAY_KEY_SECRET
- RAZORPAY_WEBHOOK_SECRET
- PAYMENTS_ENABLED=true (leave unset until the security review below is complete)

Set Razorpay webhook URL:
https://goride-phjs.onrender.com/api/wallet/webhook
Subscribe to payment_link.paid; configure the exact same webhook secret. Deploy
this backend before installing/enabling checkout. Reconcile payments in Razorpay
against payment_orders/transactions; payment disputes/refunds need a separate
workflow and are NOT implemented. External Razorpay calls cannot be exercised
from this sandbox due network restrictions; no real merchant transaction tested.

## Production security gate — important
This is a gateway integration, NOT a claim the whole legacy platform is safe for
real money. Earlier inspection found RLS disabled on profiles/drivers, unauthenticated
legacy ride mutations and privileged wallet/ride RPCs. The repository also contains
a Firebase service-account credential needing revocation/rotation. Do not enable
live payments until a comprehensive RLS/permissions, ride-ownership, RPC and secret
rotation review is complete. Disabling the fake top-up endpoint does not remediate
all those pre-existing routes. PAYMENTS_ENABLED defaults off intentionally.

## Validation
`node --test goride_backend/test/*.test.js`
Covers signatures/tampering, amounts, missing config, captured-vs-authorized funds,
amount mismatch and wallet ownership. Successful APK compilation is separate from
physical device, actual acquiring bank, webhook delivery and Render deploy tests.
