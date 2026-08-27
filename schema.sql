-- =====================================================================
--  Week-ends Riethmuller — schéma Supabase
--  À coller dans Supabase → SQL Editor → New query → Run.
--  Ce script est idempotent : on peut le relancer sans casser l'existant.
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table if not exists public.activites (
  id         uuid primary key,
  jour       date not null,
  qui        text not null check (qui in ('gael', 'ingrid', 'thomas', 'famille')),
  texte      text not null check (char_length(texte) between 1 and 500),
  statut     text not null default 'confirme' check (statut in ('confirme', 'a_confirmer')),
  origine    text,                                   -- 'scout' = programme pré-rempli
  maj_le     timestamptz not null default now(),
  maj_par    uuid references auth.users on delete set null
);

create index if not exists activites_jour_idx on public.activites (jour);

create table if not exists public.weekends_reserves (
  samedi     date primary key,
  cree_le    timestamptz not null default now(),
  cree_par   uuid references auth.users on delete set null
);

-- ------------------------------------------------------- horodatage auto
create or replace function public.touche_maj()
returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  new.maj_par := auth.uid();
  return new;
end $$;

drop trigger if exists activites_maj on public.activites;
create trigger activites_maj
  before insert or update on public.activites
  for each row execute function public.touche_maj();

-- ------------------------------------------------------------------ RLS
-- Seuls les comptes créés à la main dans Authentication → Users ont accès.
-- L'inscription libre doit rester désactivée (voir le README).
alter table public.activites enable row level security;
alter table public.weekends_reserves enable row level security;

drop policy if exists "famille lit les activites"      on public.activites;
drop policy if exists "famille ajoute des activites"   on public.activites;
drop policy if exists "famille modifie les activites"  on public.activites;
drop policy if exists "famille supprime les activites" on public.activites;

create policy "famille lit les activites"
  on public.activites for select to authenticated using (true);
create policy "famille ajoute des activites"
  on public.activites for insert to authenticated with check (true);
create policy "famille modifie les activites"
  on public.activites for update to authenticated using (true) with check (true);
create policy "famille supprime les activites"
  on public.activites for delete to authenticated using (true);

drop policy if exists "famille lit les reserves"      on public.weekends_reserves;
drop policy if exists "famille ajoute des reserves"   on public.weekends_reserves;
drop policy if exists "famille supprime les reserves" on public.weekends_reserves;

create policy "famille lit les reserves"
  on public.weekends_reserves for select to authenticated using (true);
create policy "famille ajoute des reserves"
  on public.weekends_reserves for insert to authenticated with check (true);
create policy "famille supprime les reserves"
  on public.weekends_reserves for delete to authenticated using (true);

-- ------------------------------------------------------------ temps réel
-- Chaque modification est poussée aux autres écrans ouverts.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'activites'
  ) then
    alter publication supabase_realtime add table public.activites;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'weekends_reserves'
  ) then
    alter publication supabase_realtime add table public.weekends_reserves;
  end if;
end $$;
