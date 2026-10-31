alter table public.rides add column if not exists category text not null default 'Ride';

create or replace function public.get_user_conversations(p_user_id uuid)
returns table(other_user_id uuid, other_user_name text, other_user_pic text, last_message text, last_message_time timestamptz)
language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (case when m.sender_id = p_user_id then m.receiver_id else m.sender_id end)
      case when m.sender_id = p_user_id then m.receiver_id else m.sender_id end as other_id,
      m.text, m.created_at, m.id
    from public.messages m where m.sender_id = p_user_id or m.receiver_id = p_user_id
    order by (case when m.sender_id = p_user_id then m.receiver_id else m.sender_id end), m.created_at desc, m.id desc
  )
  select l.other_id, p.full_name, p.profile_pic, l.text, l.created_at
  from latest l join public.profiles p on p.id = l.other_id
  order by l.created_at desc, l.id desc;
$$;

-- Never credit wallets from a client-supplied amount without gateway proof.
create or replace function public.topup_wallet(p_user_id uuid, p_amount numeric)
returns numeric language plpgsql as $$
begin
  raise exception 'Direct top-up disabled. Use verified payment checkout.';
end;
$$;
revoke all on function public.topup_wallet(uuid,numeric) from public, anon, authenticated;

create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  amount_paise bigint not null check (amount_paise between 100 and 1000000),
  currency text not null default 'INR' check (currency = 'INR'),
  gateway_link_id text unique,
  gateway_payment_id text unique,
  status text not null default 'created' check (status in ('created','paid')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
alter table public.payment_orders enable row level security;
revoke all on public.payment_orders from anon, authenticated;
grant all on public.payment_orders to service_role;

create or replace function public.credit_verified_payment(p_link_id text, p_payment_id text)
returns numeric language plpgsql security definer set search_path = '' as $$
declare o public.payment_orders; balance numeric;
begin
  select * into o from public.payment_orders where gateway_link_id = p_link_id for update;
  if not found then raise exception 'Payment order not found'; end if;
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
notify pgrst, 'reload schema';
