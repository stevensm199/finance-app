create table public.telegram_audio_jobs (
  update_id bigint primary key check (update_id >= 0),
  telegram_file_id text,
  telegram_user_id bigint,
  chat_id bigint,
  duration_seconds integer,
  file_size_bytes bigint,
  mime_type text,
  file_name text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'retry', 'reply_pending', 'completed', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  reply_attempt_count integer not null default 0 check (reply_attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  deduplicate_until timestamptz not null,
  outbound_message text,
  outbound_type text,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint telegram_audio_jobs_active_metadata check (
    status in ('completed', 'failed') or
    (telegram_file_id is not null and telegram_user_id is not null and chat_id is not null and duration_seconds is not null and file_size_bytes is not null)
  ),
  constraint telegram_audio_jobs_reply_payload check (
    (status = 'reply_pending' and outbound_message is not null and outbound_type is not null) or
    (status <> 'reply_pending' and outbound_message is null and outbound_type is null)
  )
);

create index telegram_audio_jobs_ready_idx
  on public.telegram_audio_jobs (next_attempt_at, created_at)
  where status in ('queued', 'retry');

create index telegram_audio_jobs_expired_lease_idx
  on public.telegram_audio_jobs (lease_expires_at, created_at)
  where status in ('processing', 'reply_pending');

create index telegram_audio_jobs_deduplicate_until_idx
  on public.telegram_audio_jobs (deduplicate_until)
  where status in ('completed', 'failed');

alter table public.telegram_audio_jobs enable row level security;
revoke all on public.telegram_audio_jobs from anon, authenticated;
grant select, insert, update, delete on public.telegram_audio_jobs to service_role;

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
      (status in ('processing', 'reply_pending') and lease_expires_at <= now())
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

create or replace function public.delete_expired_telegram_audio_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.telegram_audio_jobs
  where status in ('completed', 'failed') and deduplicate_until <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.claim_telegram_audio_job(integer) from public, anon, authenticated;
revoke all on function public.delete_expired_telegram_audio_jobs() from public, anon, authenticated;
grant execute on function public.claim_telegram_audio_job(integer) to service_role;
grant execute on function public.delete_expired_telegram_audio_jobs() to service_role;
