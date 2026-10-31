-- A balance debit is NOT a bank transfer. Keep legacy payouts disabled until a
-- real provider, authenticated destination and reconciliation are implemented.
create or replace function public.request_payout(p_user_id uuid,p_amount numeric)
returns numeric language plpgsql security definer set search_path='' as $$
begin
 raise exception 'Bank payouts are not configured. No funds were deducted.';
end; $$;
revoke all on function public.request_payout(uuid,numeric) from public,anon,authenticated,service_role;
