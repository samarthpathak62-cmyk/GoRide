-- Provider-verified test orders are NEVER spendable/withdrawable real funds.
alter table public.payment_orders add column mode text not null default 'live' check(mode in ('live','test'));
create table public.sandbox_payment_credits(
 order_id uuid primary key references public.payment_orders(id),user_id uuid not null references public.profiles(id),
 amount_paise bigint not null check(amount_paise>0),created_at timestamptz not null default now()
);
alter table public.sandbox_payment_credits enable row level security;
revoke all on public.sandbox_payment_credits from public,anon,authenticated;
grant all on public.sandbox_payment_credits to service_role;
create or replace function public.credit_verified_payment(p_link_id text, p_payment_id text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare o public.payment_orders; balance numeric;
begin
  select * into o from public.payment_orders where gateway_link_id = p_link_id for update;
  if not found then raise exception 'Payment order not found'; end if;
  if o.mode<>'live' then raise exception 'Test funds cannot credit real wallets';end if;
  if o.status = 'paid' then
    if o.gateway_payment_id <> p_payment_id then raise exception 'Payment conflict'; end if;
    select wallet_balance into balance from public.profiles where id = o.user_id;
    return balance;
  end if;
  update public.profiles set wallet_balance = coalesce(wallet_balance,0) + o.amount_paise / 100.0
    where id = o.user_id returning wallet_balance into balance;
  if not found then raise exception 'Wallet profile missing'; end if;
  insert into public.transactions(user_id,amount,type,category,description)
    values(o.user_id,o.amount_paise / 100.0,'credit','topup','Verified Razorpay payment');
  update public.payment_orders set status = 'paid', gateway_payment_id = p_payment_id, paid_at = now() where id = o.id;
  return balance;
end;
$$;
revoke all on function public.credit_verified_payment(text,text) from public, anon, authenticated;
grant execute on function public.credit_verified_payment(text,text) to service_role;

create function public.credit_verified_test_payment(p_link_id text,p_payment_id text)
returns bigint language plpgsql security definer set search_path='' as $$
declare o public.payment_orders;total bigint;
begin
 select * into o from public.payment_orders where gateway_link_id=p_link_id for update;
 if not found or o.mode<>'test' then raise exception 'Test order required';end if;
 if o.status='paid' then
  if o.gateway_payment_id<>p_payment_id then raise exception 'Payment conflict';end if;
 else
  insert into public.sandbox_payment_credits(order_id,user_id,amount_paise) values(o.id,o.user_id,o.amount_paise);
  update public.payment_orders set status='paid',gateway_payment_id=p_payment_id,paid_at=now() where id=o.id;
 end if;
 select coalesce(sum(amount_paise),0) into total from public.sandbox_payment_credits where user_id=o.user_id;
 return total;
end;$$;
revoke all on function public.credit_verified_test_payment(text,text) from public,anon,authenticated;
grant execute on function public.credit_verified_test_payment(text,text) to service_role;
notify pgrst,'reload schema';
