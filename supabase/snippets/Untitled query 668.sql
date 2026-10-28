insert into public.users (telegram_user_id)
values (714131512)
on conflict (telegram_user_id) do nothing;