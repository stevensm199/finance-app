create index telegram_audio_jobs_reply_ready_idx
  on public.telegram_audio_jobs (next_attempt_at, created_at)
  where status = 'reply_pending';

create or replace function public.claim_telegram_audio_job(p_lease_seconds integer)
returns setof public.telegram_audio_jobs
language sql
security definer
set search_path = public, pg_temp
as $$
  with candidate as (
    select update_id
    from public.telegram_audio_jobs
    where
      (status in ('queued', 'retry') and next_attempt_at <= now()) or
      (status = 'processing' and lease_expires_at <= now()) or
      (status = 'reply_pending' and next_attempt_at <= now() and (lease_expires_at is null or lease_expires_at <= now()))
    order by created_at
    for update skip locked
    limit 1
  )
  update public.telegram_audio_jobs as job
  set
    status = case when job.status in ('queued', 'retry') then 'processing' else job.status end,
    attempt_count = case when job.status = 'reply_pending' then job.attempt_count else job.attempt_count + 1 end,
    reply_attempt_count = case when job.status = 'reply_pending' then job.reply_attempt_count + 1 else job.reply_attempt_count end,
    lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 1)),
    updated_at = now()
  from candidate
  where job.update_id = candidate.update_id
  returning job.*;
$$;

revoke all on function public.claim_telegram_audio_job(integer) from public, anon, authenticated;
grant execute on function public.claim_telegram_audio_job(integer) to service_role;
