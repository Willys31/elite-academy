-- ============================================================
-- Elite Academy – Migration 0014
-- Entraide & communauté : points bloquants, contributions des pairs,
-- votes « Utile », signalements et modération.
-- Références : addendum Entraide §3, §5, §7 ; manuel complet §3.3, §6.
-- Dépend de 0012 (visibility_scope, can_see_scope) et 0013 (XP, badges).
--
-- Rappel de conception (leçon 0003) : prédicat direct sur la ligne en
-- tête de chaque politique SELECT pour que INSERT … RETURNING passe.
-- ============================================================

-- ------------------------------------------------------------
-- 1. peer_help_posts – points bloquants
-- ------------------------------------------------------------

create table public.peer_help_posts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  course_id        uuid not null references public.courses (id) on delete cascade,
  competency_id    uuid references public.competencies (id) on delete set null,
  activity_id      uuid references public.activities (id) on delete set null,
  visibility_scope public.visibility_scope not null default 'group',
  -- Secteur dénormalisé depuis organizations.sector (voir 0012).
  sector           text,
  description      text not null check (char_length(description) between 10 and 200),
  status           text not null default 'open' check (status in ('open','resolved','archived')),
  is_hidden        boolean not null default false,
  hidden_by        uuid references public.profiles (id) on delete set null,
  hidden_reason    text,
  resolved_at      timestamptz,
  created_at       timestamptz not null default now()
);

create index idx_php_course on public.peer_help_posts (course_id, status, created_at desc);
create index idx_php_user   on public.peer_help_posts (user_id, created_at desc);

-- ------------------------------------------------------------
-- 2. peer_help_contributions – aides proposées
-- ------------------------------------------------------------

create table public.peer_help_contributions (
  id                 uuid primary key default gen_random_uuid(),
  post_id            uuid not null references public.peer_help_posts (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  contribution_text  text not null check (char_length(contribution_text) between 20 and 500),
  -- Compteur dénormalisé, tenu par le serveur (client d'administration).
  useful_votes_count integer not null default 0,
  is_hidden          boolean not null default false,
  hidden_by          uuid references public.profiles (id) on delete set null,
  hidden_reason      text,
  created_at         timestamptz not null default now(),
  unique (post_id, user_id)   -- une contribution par blocage et par personne
);

create index idx_phc_post on public.peer_help_contributions (post_id, created_at);
create index idx_phc_user on public.peer_help_contributions (user_id);

-- ------------------------------------------------------------
-- 3. peer_help_votes – votes « Utile » (anonymes)
-- ------------------------------------------------------------

create table public.peer_help_votes (
  id              uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.peer_help_contributions (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (contribution_id, user_id)
);

create index idx_phv_contribution on public.peer_help_votes (contribution_id);

-- ------------------------------------------------------------
-- 4. peer_help_reports – signalements
-- ------------------------------------------------------------

create table public.peer_help_reports (
  id              uuid primary key default gen_random_uuid(),
  contribution_id uuid not null references public.peer_help_contributions (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  reason          text not null check (char_length(reason) between 3 and 300),
  status          text not null default 'pending' check (status in ('pending','reviewed','dismissed')),
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  unique (contribution_id, user_id)
);

create index idx_phr_status on public.peer_help_reports (status, created_at desc);

-- ------------------------------------------------------------
-- 5. Row Level Security
-- ------------------------------------------------------------

alter table public.peer_help_posts         enable row level security;
alter table public.peer_help_contributions enable row level security;
alter table public.peer_help_votes         enable row level security;
alter table public.peer_help_reports       enable row level security;

-- ----- Points bloquants -----

-- Lecture : l'auteur, l'encadrement de la formation, et — s'il n'est
-- pas masqué — toute personne dans le périmètre de partage.
create policy peer_help_posts_select on public.peer_help_posts
  for select using (
    user_id = auth.uid()
    or public.oversees_course(course_id)
    or (
      not is_hidden
      and public.can_see_scope(organization_id, visibility_scope, course_id, sector)
    )
  );

-- Publication : soi-même, sur une formation qu'on peut voir, toujours
-- ouvert et non masqué. L'opt-in Entraide est vérifié par l'action.
create policy peer_help_posts_insert on public.peer_help_posts
  for insert with check (
    user_id = auth.uid()
    and status = 'open'
    and is_hidden = false
    and public.can_view_course(course_id)
  );

-- Résoudre / archiver : l'auteur. Masquer : l'encadrement.
create policy peer_help_posts_update on public.peer_help_posts
  for update using (
    user_id = auth.uid()
    or public.oversees_course(course_id)
  );

-- ----- Contributions -----

-- Lecture : l'auteur de la contribution ; sinon toute personne qui voit
-- le blocage (la sous-requête s'exécute sous la RLS de peer_help_posts),
-- à condition que la contribution ne soit pas masquée — sauf pour
-- l'encadrement, qui voit ce qu'il a masqué.
create policy peer_help_contributions_select on public.peer_help_contributions
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.peer_help_posts p
      where p.id = post_id
        and (not peer_help_contributions.is_hidden or public.oversees_course(p.course_id))
    )
  );

-- Proposer une aide : soi-même, sur un blocage ouvert qui n'est pas le
-- sien (on ne s'aide pas soi-même).
create policy peer_help_contributions_insert on public.peer_help_contributions
  for insert with check (
    user_id = auth.uid()
    and is_hidden = false
    and useful_votes_count = 0
    and exists (
      select 1 from public.peer_help_posts p
      where p.id = post_id
        and p.status = 'open'
        and p.user_id <> auth.uid()
    )
  );

-- Masquer / démasquer : l'encadrement de la formation du blocage.
-- Le compteur de votes est écrit par le client d'administration.
create policy peer_help_contributions_update on public.peer_help_contributions
  for update using (
    exists (
      select 1 from public.peer_help_posts p
      where p.id = post_id and public.oversees_course(p.course_id)
    )
  );

-- ----- Votes -----

-- Un vote est anonyme : personne ne lit la liste des votants, chacun
-- ne voit que les siens (pour savoir s'il a déjà voté).
create policy peer_help_votes_select on public.peer_help_votes
  for select using (user_id = auth.uid());

-- Voter : soi-même, sur une contribution visible qui n'est pas la
-- sienne. Le doublon est bloqué par la contrainte d'unicité.
create policy peer_help_votes_insert on public.peer_help_votes
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.peer_help_contributions c
      where c.id = contribution_id and c.user_id <> auth.uid()
    )
  );

-- ----- Signalements -----

create policy peer_help_reports_select on public.peer_help_reports
  for select using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.peer_help_contributions c
      join public.peer_help_posts p on p.id = c.post_id
      where c.id = contribution_id and public.oversees_course(p.course_id)
    )
  );

create policy peer_help_reports_insert on public.peer_help_reports
  for insert with check (
    user_id = auth.uid()
    and status = 'pending'
    and exists (
      select 1 from public.peer_help_contributions c
      where c.id = contribution_id and c.user_id <> auth.uid()
    )
  );

create policy peer_help_reports_update on public.peer_help_reports
  for update using (
    exists (
      select 1
      from public.peer_help_contributions c
      join public.peer_help_posts p on p.id = c.post_id
      where c.id = contribution_id and public.oversees_course(p.course_id)
    )
  );
