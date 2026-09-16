-- ============================================================
-- Elite Academy – Migration 0015
-- Situations de travail : récits CSRR (Contexte, Situation, Résolution,
-- Résultat) soumis par les apprenants, validés par l'encadrement,
-- partagés selon un niveau de visibilité, votés « Utile ».
-- Références : addendum Situations de travail §3 à §9 ; manuel §3.4, §7.
-- Dépend de 0012 (visibility_scope, can_see_scope), 0013 (XP, badges),
-- 0014 (peer_help_posts, pour les liens blocage ↔ situation).
-- ============================================================

-- ------------------------------------------------------------
-- 1. work_situations
-- ------------------------------------------------------------

create table public.work_situations (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  course_id          uuid not null references public.courses (id) on delete cascade,
  visibility_scope   public.visibility_scope not null default 'organization',
  sector             text not null,
  title              text not null check (char_length(title) between 5 and 120),
  context            text not null check (char_length(context) between 100 and 500),
  situation          text not null check (char_length(situation) between 150 and 800),
  resolution         text not null check (char_length(resolution) between 150 and 800),
  result             text not null check (char_length(result) between 100 and 500),
  is_anonymized      boolean not null default false,
  status             text not null default 'submitted' check (status in ('submitted','validated','rejected')),
  -- Coché par le formateur à la validation : résolution d'un problème
  -- complexe (badge Problem Solver).
  is_complex_problem boolean not null default false,
  useful_votes_count integer not null default 0,
  validated_by       uuid references public.profiles (id) on delete set null,
  validated_at       timestamptz,
  rejection_reason   text,
  featured_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create trigger trg_work_situations_updated
  before update on public.work_situations
  for each row execute function public.set_updated_at();

create index idx_ws_status  on public.work_situations (status, created_at desc);
create index idx_ws_course  on public.work_situations (course_id, status);
create index idx_ws_user    on public.work_situations (user_id, created_at desc);
create index idx_ws_sector  on public.work_situations (sector) where status = 'validated';
create index idx_ws_votes   on public.work_situations (useful_votes_count desc) where status = 'validated';

-- ------------------------------------------------------------
-- 2. situation_competencies – compétences mobilisées (1 à 5)
--    Table de jointure plutôt que `uuid[] references` (invalide en
--    PostgreSQL) : intégrité référentielle, index, embeds PostgREST,
--    même patron que course_competencies / activity_competencies.
-- ------------------------------------------------------------

create table public.situation_competencies (
  situation_id  uuid not null references public.work_situations (id) on delete cascade,
  competency_id uuid not null references public.competencies (id) on delete cascade,
  primary key (situation_id, competency_id)
);

create index idx_sc_competency on public.situation_competencies (competency_id);

-- ------------------------------------------------------------
-- 3. situation_votes – votes « Utile » (anonymes)
-- ------------------------------------------------------------

create table public.situation_votes (
  id           uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.work_situations (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (situation_id, user_id)
);

-- ------------------------------------------------------------
-- 4. situation_tags – mots-clés
-- ------------------------------------------------------------

create table public.situation_tags (
  situation_id uuid not null references public.work_situations (id) on delete cascade,
  tag          text not null check (char_length(tag) between 2 and 30),
  primary key (situation_id, tag)
);

-- ------------------------------------------------------------
-- 5. situation_blocking_links – une situation illustre un blocage
-- ------------------------------------------------------------

create table public.situation_blocking_links (
  situation_id uuid not null references public.work_situations (id) on delete cascade,
  post_id      uuid not null references public.peer_help_posts (id) on delete cascade,
  linked_by    uuid not null references public.profiles (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (situation_id, post_id)
);

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table public.work_situations          enable row level security;
alter table public.situation_competencies   enable row level security;
alter table public.situation_votes          enable row level security;
alter table public.situation_tags           enable row level security;
alter table public.situation_blocking_links enable row level security;

-- Lecture : l'auteur, l'encadrement de la formation, et — une fois
-- validée — toute personne dans le périmètre de partage.
create policy work_situations_select on public.work_situations
  for select using (
    user_id = auth.uid()
    or public.oversees_course(course_id)
    or (
      status = 'validated'
      and public.can_see_scope(organization_id, visibility_scope, course_id, sector)
    )
  );

-- Soumission : soi-même, toujours en attente, sur une formation visible.
create policy work_situations_insert on public.work_situations
  for insert with check (
    user_id = auth.uid()
    and status = 'submitted'
    and public.can_view_course(course_id)
  );

-- Correction par l'auteur tant que la situation n'est pas traitée ;
-- validation / refus / mise en avant par l'encadrement. Le `with check`
-- empêche l'auteur de passer lui-même sa ligne à `validated`.
create policy work_situations_update_auteur on public.work_situations
  for update using (user_id = auth.uid() and status = 'submitted')
  with check (user_id = auth.uid() and status = 'submitted');

create policy work_situations_update_encadrement on public.work_situations
  for update using (public.oversees_course(course_id));

-- Retrait par l'auteur, sauf si déjà validée (elle appartient alors à
-- la base de connaissances).
create policy work_situations_delete on public.work_situations
  for delete using (user_id = auth.uid() and status <> 'validated');

-- Compétences et tags : suivent la visibilité de la situation.
create policy situation_competencies_select on public.situation_competencies
  for select using (
    exists (select 1 from public.work_situations s where s.id = situation_id)
  );
create policy situation_competencies_write on public.situation_competencies
  for all using (
    exists (
      select 1 from public.work_situations s
      where s.id = situation_id and s.user_id = auth.uid() and s.status = 'submitted'
    )
  );

create policy situation_tags_select on public.situation_tags
  for select using (
    exists (select 1 from public.work_situations s where s.id = situation_id)
  );
create policy situation_tags_write on public.situation_tags
  for all using (
    exists (
      select 1 from public.work_situations s
      where s.id = situation_id and s.user_id = auth.uid() and s.status = 'submitted'
    )
  );

-- Votes : chacun ne voit que les siens ; on vote sur une situation
-- validée qui n'est pas la sienne. Le compteur est écrit par le client
-- d'administration.
create policy situation_votes_select on public.situation_votes
  for select using (user_id = auth.uid());

create policy situation_votes_insert on public.situation_votes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.work_situations s
      where s.id = situation_id and s.status = 'validated' and s.user_id <> auth.uid()
    )
  );

-- Liens : visibles si les deux parents le sont ; posés par l'auteur du
-- blocage (« cette situation illustre mon blocage »).
create policy situation_blocking_links_select on public.situation_blocking_links
  for select using (
    exists (select 1 from public.work_situations s where s.id = situation_id)
    and exists (select 1 from public.peer_help_posts p where p.id = post_id)
  );

create policy situation_blocking_links_insert on public.situation_blocking_links
  for insert with check (
    linked_by = auth.uid()
    and exists (select 1 from public.peer_help_posts p where p.id = post_id and p.user_id = auth.uid())
    and exists (select 1 from public.work_situations s where s.id = situation_id and s.status = 'validated')
  );

create policy situation_blocking_links_delete on public.situation_blocking_links
  for delete using (linked_by = auth.uid());
