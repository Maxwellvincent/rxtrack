-- supabase/migrations/0003_ungenerated_cards.sql
-- Cards for a user/block that have NO recognition_items yet, ordered stably.
-- Anti-join replaces the client-side filter + stuck `.limit(50)`.
create or replace function public.ungenerated_cards(p_user uuid, p_block text, p_limit int)
returns setof public.anki_cards
language sql
stable
as $$
  select c.*
  from public.anki_cards c
  where c.user_id = p_user
    and (p_block is null or c.block_id = p_block)
    and not exists (
      select 1 from public.recognition_items r
      where r.user_id = c.user_id and r.source_card_id = c.card_id
    )
  order by c.card_id
  limit p_limit;
$$;

-- Count of remaining un-generated cards for a user/block.
create or replace function public.ungenerated_count(p_user uuid, p_block text)
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.anki_cards c
  where c.user_id = p_user
    and (p_block is null or c.block_id = p_block)
    and not exists (
      select 1 from public.recognition_items r
      where r.user_id = c.user_id and r.source_card_id = c.card_id
    );
$$;
