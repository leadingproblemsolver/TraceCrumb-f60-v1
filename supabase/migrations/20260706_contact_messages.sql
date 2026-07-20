-- Public TraceCrumb contact capture.
-- Safe to run after the existing schema. Anonymous users may insert but never read.
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  role text,
  company text,
  reason text not null default 'Product feedback',
  message text not null,
  branch text not null default 'first60',
  source_channel text not null default 'direct',
  created_at timestamptz not null default now()
);

alter table public.contact_messages enable row level security;

drop policy if exists contact_messages_anon_insert on public.contact_messages;
create policy contact_messages_anon_insert on public.contact_messages
for insert to anon, authenticated
with check (true);
