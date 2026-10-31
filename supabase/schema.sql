
-- Tables
\i tables/all_tables.sql

-- Functions
\i functions/complete_ride_transaction.sql
\i functions/topup_wallet.sql
\i functions/request_payout.sql
\i functions/get_nearby_drivers.sql
\i functions/get_user_conversations.sql

-- Ordered repairs and verified-payment ledger
\i migrations/202610310001_create_auth_profiles.sql
\i migrations/202610310002_user_wallet_repairs.sql

-- Captain onboarding and private review (coordinate backend deployment)
\i migrations/202610310003_captain_onboarding.sql
\i migrations/202610310004_admin_accounts.sql
\i migrations/202610310005_admin_claim_repair.sql
\i migrations/202610310006_secure_ride_lifecycle.sql
\i migrations/202610310007_ride_access_cutover.sql
