-- Unverified client top-ups are intentionally disabled.
CREATE OR REPLACE FUNCTION public.topup_wallet(p_user_id UUID, p_amount NUMERIC)
RETURNS NUMERIC LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Direct top-up disabled. Use verified payment checkout.';
END;
$$;
REVOKE ALL ON FUNCTION public.topup_wallet(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
