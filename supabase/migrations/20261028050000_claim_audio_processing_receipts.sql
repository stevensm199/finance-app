alter table public.telegram_audio_jobs add column receipt_lease_expires_at timestamptz;

create or replace function public.claim_telegram_audio_receipt(p_update_id bigint, p_lease_seconds integer)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  with claimed as (
    update public.telegram_audio_jobs
    set
      receipt_lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
      updated_at = now()
    where update_id = p_update_id
      and receipt_sent_at is null
      and (receipt_lease_expires_at is null or receipt_lease_expires_at <= now())
    returning update_id
  )
  select exists (select 1 from claimed);
$$;

revoke all on function public.claim_telegram_audio_receipt(bigint, integer) from public, anon, authenticated;
grant execute on function public.claim_telegram_audio_receipt(bigint, integer) to service_role;
