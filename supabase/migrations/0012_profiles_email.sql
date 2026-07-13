-- The portal bridges ChatGPT email identities onto real auth.users rows.
-- profiles.email lets us resolve an email to its owning user without querying the auth schema.
alter table public.profiles add column if not exists email text;
create unique index if not exists profiles_email_key on public.profiles (lower(email)) where email is not null;
