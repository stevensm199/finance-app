create table public.users (
  id uuid primary key default gen_random_uuid(),
  telegram_user_id bigint not null unique check (telegram_user_id > 0),
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

do $$
begin
  if exists (select 1 from public.transactions) then
    raise exception 'Transactions exist; map their owners before changing owner_id to internal user IDs';
  end if;
end
$$;

drop index public.transactions_owner_registered_id_idx;
alter table public.transactions drop column owner_id;
alter table public.transactions add column owner_id uuid not null references public.users(id);

create index transactions_owner_registered_id_idx
  on public.transactions (owner_id, registered_at desc, id desc);
