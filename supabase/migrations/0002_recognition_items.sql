-- supabase/migrations/0002_recognition_items.sql
create table if not exists public.recognition_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  block_id text not null,
  subject text,
  source_card_id text not null,
  kind text not null check (kind in ('vignette','mcq','mechanism')),
  data jsonb not null,
  difficulty int default 2,
  weak_for text[] default '{}',
  generated_at timestamptz default now()
);

create index if not exists recog_serve_idx on public.recognition_items (user_id, block_id, subject);
create index if not exists recog_card_idx on public.recognition_items (user_id, source_card_id);
create index if not exists recog_weak_idx on public.recognition_items using gin (weak_for);

alter table public.recognition_items enable row level security;

create policy "recog owner read" on public.recognition_items
  for select using (auth.uid() = user_id);
create policy "recog owner write" on public.recognition_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
