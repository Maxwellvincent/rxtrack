-- 0004_add_lecture_column.sql
alter table public.anki_cards add column if not exists lecture text;
alter table public.recognition_items add column if not exists lecture text;
