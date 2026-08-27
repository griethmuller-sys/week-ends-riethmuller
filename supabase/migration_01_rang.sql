-- =====================================================================
--  Week-ends Riethmuller — migration 01 : ordre des activités dans la journée
--  À coller dans Supabase → SQL Editor → New query → Run.
--  Relançable sans risque.
-- =====================================================================

-- Rang de l'activité au sein de sa journée : 0 en haut, puis 1, 2…
alter table public.activites
  add column if not exists rang integer not null default 0;

-- Classement initial des lignes déjà présentes : ordre de création.
with ordonne as (
  select id, row_number() over (partition by jour order by maj_le, id) - 1 as position
  from public.activites
)
update public.activites a
   set rang = o.position
  from ordonne o
 where o.id = a.id
   and a.rang is distinct from o.position;

create index if not exists activites_jour_rang_idx on public.activites (jour, rang);
