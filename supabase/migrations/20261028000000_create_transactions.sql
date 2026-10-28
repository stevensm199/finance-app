create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  type text not null check (type in ('expense', 'income')),
  description text not null,
  amount numeric not null check (amount > 0),
  registered_at timestamptz not null default now(),
  telegram_update_id bigint unique
);

create index transactions_owner_registered_id_idx
  on public.transactions (owner_id, registered_at desc, id desc);

alter table public.transactions enable row level security;
