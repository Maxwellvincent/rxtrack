-- supabase/migrations/0001_anki_cards.sql
create table if not exists public.anki_cards (
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null,
  block_id text not null,
  term_id text,
  subject text,
  text text not null,
  tags text[] default '{}',
  has_media boolean default false,
  source_deck text,
  updated_at timestamptz default now(),
  primary key (user_id, card_id)
);

create index if not exists anki_cards_block_idx on public.anki_cards (user_id, block_id, subject);

alter table public.anki_cards enable row level security;

create policy "anki_cards owner read" on public.anki_cards
  for select using (auth.uid() = user_id);
create policy "anki_cards owner write" on public.anki_cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
