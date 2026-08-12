-- ============================================================
-- Elite Academy – Migration 0006
-- Sessions présentielles et temps réel : sessions, participants,
-- événements. Référence : schéma Supabase §6, PRD §13,
-- architecture §14, UX/UI §4.3-§4.4.
--
-- Rappel de conception (leçon 0003) : conditions directes sur la
-- ligne dans les politiques SELECT des tables utilisées avec
-- INSERT ... RETURNING.
-- ============================================================

create type public.session_status as enum (
  'scheduled',  -- programmée
  'open',       -- ouverte (inscriptions/présence possibles)
  'closed'      -- clôturée
);

-- ------------------------------------------------------------
-- 1. live_sessions
-- ------------------------------------------------------------

create table public.live_sessions (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations (id) on delete cascade,
  course_id           uuid references public.courses (id) on delete set null,
  module_id           uuid references public.modules (id) on delete set null,
  trainer_id          uuid not null references public.profiles (id),
  title               text not null,
  session_code        text not null unique,
  qr_token            uuid not null default gen_random_uuid(),
  current_activity_id uuid references public.activities (id) on delete set null,
  starts_at           timestamptz,
  ends_at             timestamptz,
  status              public.session_status not null default 'open',
  created_at          timestamptz not null default now()
);

create index idx_sessions_org on public.live_sessions (organization_id, created_at desc);
create index idx_sessions_trainer on public.live_sessions (trainer_id);
create index idx_sessions_code on public.live_sessions (session_code);

-- ------------------------------------------------------------
-- 2. session_participants
-- ------------------------------------------------------------

create table public.session_participants (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.live_sessions (id) on delete cascade,
  user_id           uuid not null references public.profiles (id) on delete cascade,
  attendance_status text not null default 'present',
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,
  unique (session_id, user_id)  -- pas de doublon de présence
);

create index idx_participants_session on public.session_participants (session_id);
create index idx_participants_user on public.session_participants (user_id);

-- ------------------------------------------------------------
-- 3. live_events – journal temps réel de la session
-- ------------------------------------------------------------

create table public.live_events (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions (id) on delete cascade,
  type       text not null,
  payload    jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create index idx_events_session on public.live_events (session_id, created_at);

-- ------------------------------------------------------------
-- 4. Fonctions d'aide
-- ------------------------------------------------------------

-- L'utilisateur est-il participant de la session ?
create or replace function public.is_session_participant(sid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.session_participants p
    where p.session_id = sid and p.user_id = auth.uid()
  );
$$;

-- L'utilisateur encadre-t-il la session (formateur créateur,
-- encadrement de l'organisation ou admin Elite Experience) ?
create or replace function public.oversees_session(sid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.live_sessions s
    where s.id = sid
      and (
        s.trainer_id = auth.uid()
        or public.is_elite_admin()
        or public.has_org_role(
             s.organization_id,
             array['admin','designer','trainer','manager']::public.member_role[]
           )
      )
  );
$$;

-- ------------------------------------------------------------
-- 5. Row Level Security
-- ------------------------------------------------------------

alter table public.live_sessions        enable row level security;
alter table public.session_participants enable row level security;
alter table public.live_events          enable row level security;

-- ----- live_sessions -----

-- Lecture : le formateur créateur (condition directe, nécessaire au
-- RETURNING), les membres de l'organisation (pour rejoindre par code),
-- Elite Experience.
create policy sessions_select on public.live_sessions
  for select using (
    trainer_id = auth.uid()
    or public.is_org_member(organization_id)
    or public.is_elite_admin()
  );

-- Création : formateur/concepteur/admin de l'organisation,
-- toujours comme créateur de la session.
create policy sessions_insert on public.live_sessions
  for insert with check (
    trainer_id = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(
           organization_id,
           array['admin','designer','trainer']::public.member_role[]
         )
    )
  );

-- Mise à jour (activité en cours, statut, clôture) : encadrement.
create policy sessions_update on public.live_sessions
  for update using (
    trainer_id = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin']::public.member_role[]
       )
  );

-- ----- session_participants -----

-- Lecture : soi-même (condition directe) ou l'encadrement de la session.
create policy participants_select on public.session_participants
  for select using (
    user_id = auth.uid()
    or public.oversees_session(session_id)
  );

-- Adhésion : soi-même, à une session OUVERTE de son organisation.
create policy participants_insert on public.session_participants
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions s
      where s.id = session_id
        and s.status = 'open'
        and public.is_org_member(s.organization_id)
    )
  );

-- Mise à jour (départ) : soi-même ou l'encadrement.
create policy participants_update on public.session_participants
  for update using (
    user_id = auth.uid()
    or public.oversees_session(session_id)
  );

-- ----- live_events -----

-- Lecture : participants et encadrement de la session.
create policy events_select on public.live_events
  for select using (
    created_by = auth.uid()
    or public.is_session_participant(session_id)
    or public.oversees_session(session_id)
  );

-- Écriture : soi-même, en tant que participant ou encadrant.
create policy events_insert on public.live_events
  for insert with check (
    created_by = auth.uid()
    and (
      public.is_session_participant(session_id)
      or public.oversees_session(session_id)
    )
  );

-- Journal immuable : ni modification ni suppression.

-- ------------------------------------------------------------
-- 6. Temps réel : publication Supabase Realtime
--    (les politiques RLS s'appliquent aussi aux flux temps réel)
-- ------------------------------------------------------------

alter publication supabase_realtime add table public.session_participants;
alter publication supabase_realtime add table public.live_events;
alter publication supabase_realtime add table public.live_sessions;
