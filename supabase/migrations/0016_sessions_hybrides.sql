-- ============================================================
-- Elite Academy – Migration 0016
-- Sessions hybrides : niveau de partage, présence et ponctualité
-- calculées à la clôture, consentement à l'enregistrement, avis des
-- participants, transcriptions (tl;dv par webhook ou import manuel),
-- observations d'interventions issues de l'analyse IA.
-- Références : addendum Sessions hybrides §3 à §12 ; manuel §3.5, §8.
-- Dépend de 0006 (sessions), 0012 (visibility_scope, can_see_scope),
-- 0013 (XP), 0004 (ai_generations).
-- ============================================================

-- ------------------------------------------------------------
-- 1. live_sessions – enrichissement
-- ------------------------------------------------------------

alter table public.live_sessions
  add column description        text,
  add column location           text,
  add column visibility_scope   public.visibility_scope not null default 'organization',
  add column sector             text,
  add column recording_enabled  boolean not null default false,
  add column tldv_meeting_id    text unique,
  add column analysis_status    text not null default 'none'
    check (analysis_status in ('none','pending','running','done','failed')),
  -- `ends_at` (0006) reste la fin PRÉVUE ; `closed_at` est la clôture réelle.
  add column closed_at          timestamptz;

-- Les sessions déjà clôturées ont `ends_at` posé par l'ancienne action
-- de clôture : on le reprend comme clôture réelle.
update public.live_sessions
  set closed_at = ends_at
  where status = 'closed' and closed_at is null;

-- ------------------------------------------------------------
-- 2. session_participants – présence calculée à la clôture
--    `attendance_status` (0006, défaut 'present') garde le sens
--    « état en direct » : present = dans la salle, left = parti.
--    `presence_status` est l'état FINAL, calculé à la clôture.
-- ------------------------------------------------------------

alter table public.session_participants
  add column presence_status      text
    check (presence_status in ('present','partial','late','left_early','absent')),
  add column punctuality_status   text
    check (punctuality_status in ('on_time','late_ok','late')),
  add column presence_seconds     integer,
  add column xp_awarded           integer not null default 0,
  add column recording_consent    boolean not null default false,
  add column justification        text,
  add column justification_status text
    check (justification_status in ('pending','accepted','refused')),
  add column validated_by         uuid references public.profiles (id) on delete set null;

-- ------------------------------------------------------------
-- 3. session_feedbacks – avis après la session (un par participant)
-- ------------------------------------------------------------

create table public.session_feedbacks (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references public.live_sessions (id) on delete cascade,
  user_id            uuid not null references public.profiles (id) on delete cascade,
  satisfaction_score integer check (satisfaction_score between 1 and 5),
  clarity_score      integer check (clarity_score between 1 and 5),
  usefulness_score   integer check (usefulness_score between 1 and 5),
  comment            text check (char_length(comment) <= 500),
  created_at         timestamptz not null default now(),
  unique (session_id, user_id)
);

create index idx_feedbacks_session on public.session_feedbacks (session_id);

-- ------------------------------------------------------------
-- 4. meeting_transcripts – transcription + analyse
-- ------------------------------------------------------------

create table public.meeting_transcripts (
  id                     uuid primary key default gen_random_uuid(),
  session_id             uuid not null references public.live_sessions (id) on delete cascade,
  source                 text not null check (source in ('tldv','manual')),
  tldv_transcript_id     text unique,
  transcript_text        text not null,
  segments               jsonb not null default '[]'::jsonb,
  speakers               jsonb not null default '[]'::jsonb,
  summary                text,
  key_points             jsonb,
  keywords               text[],
  insights               jsonb,
  analysis_generation_id uuid references public.ai_generations (id) on delete set null,
  analyzed_at            timestamptz,
  created_at             timestamptz not null default now()
);

create index idx_transcripts_session on public.meeting_transcripts (session_id, created_at desc);

-- ------------------------------------------------------------
-- 5. intervention_observations – analyse des prises de parole
-- ------------------------------------------------------------

create table public.intervention_observations (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.live_sessions (id) on delete cascade,
  transcript_id     uuid not null references public.meeting_transcripts (id) on delete cascade,
  user_id           uuid references public.profiles (id) on delete set null,
  speaker_label     text not null,
  speaker_type      text not null default 'unknown' check (speaker_type in ('trainer','learner','unknown')),
  start_seconds     integer,
  end_seconds       integer,
  snippet           text,
  intervention_type text check (intervention_type in ('question','answer','remark')),
  quality_score     integer check (quality_score between 1 and 5),
  created_at        timestamptz not null default now()
);

create index idx_observations_session on public.intervention_observations (session_id, start_seconds);
create index idx_observations_user    on public.intervention_observations (user_id) where user_id is not null;

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table public.session_feedbacks         enable row level security;
alter table public.meeting_transcripts       enable row level security;
alter table public.intervention_observations enable row level security;

-- Sessions : la lecture suit désormais le niveau de partage. Avec la
-- valeur par défaut 'organization', rien ne change pour l'existant.
drop policy if exists sessions_select on public.live_sessions;
create policy sessions_select on public.live_sessions
  for select using (
    trainer_id = auth.uid()
    or public.oversees_session(id)
    or public.is_session_participant(id)
    or public.can_see_scope(organization_id, visibility_scope, course_id, sector)
  );

-- Rejoindre : une session ouverte visible dans mon périmètre.
drop policy if exists participants_insert on public.session_participants;
create policy participants_insert on public.session_participants
  for insert with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.live_sessions s
      where s.id = session_id
        and s.status = 'open'
        and public.can_see_scope(s.organization_id, s.visibility_scope, s.course_id, s.sector)
    )
  );

-- Avis : soi-même ou l'encadrement ; un seul, après clôture, jamais modifié.
create policy feedbacks_select on public.session_feedbacks
  for select using (
    user_id = auth.uid()
    or public.oversees_session(session_id)
  );

create policy feedbacks_insert on public.session_feedbacks
  for insert with check (
    user_id = auth.uid()
    and public.is_session_participant(session_id)
    and exists (
      select 1 from public.live_sessions s
      where s.id = session_id and s.status = 'closed'
    )
  );

-- Transcriptions : l'encadrement, et les participants qui ont consenti
-- à l'enregistrement. Import manuel par l'encadrement ; le webhook
-- passe par le client d'administration.
create policy transcripts_select on public.meeting_transcripts
  for select using (
    public.oversees_session(session_id)
    or exists (
      select 1 from public.session_participants p
      where p.session_id = meeting_transcripts.session_id
        and p.user_id = auth.uid()
        and p.recording_consent
    )
  );

create policy transcripts_insert on public.meeting_transcripts
  for insert with check (public.oversees_session(session_id));

create policy transcripts_update on public.meeting_transcripts
  for update using (public.oversees_session(session_id));

create policy transcripts_delete on public.meeting_transcripts
  for delete using (public.oversees_session(session_id));

-- Observations : la personne concernée et l'encadrement ; écriture par
-- le client d'administration (analyse IA).
create policy observations_select on public.intervention_observations
  for select using (
    user_id = auth.uid()
    or public.oversees_session(session_id)
  );

-- Générations IA : un formateur peut déclencher l'analyse d'une session
-- (type 'session_analysis') sans être concepteur.
drop policy if exists ai_gen_insert on public.ai_generations;
create policy ai_gen_insert on public.ai_generations
  for insert with check (
    requested_by = auth.uid()
    and (
      public.is_elite_admin()
      or (
        generation_type in ('course_plan', 'document_structuring')
        and public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
      )
      or (
        generation_type = 'session_analysis'
        and public.has_org_role(organization_id, array['admin','designer','trainer','manager']::public.member_role[])
      )
    )
  );

drop policy if exists ai_gen_select on public.ai_generations;
create policy ai_gen_select on public.ai_generations
  for select using (
    requested_by = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
    or (
      generation_type = 'session_analysis'
      and public.has_org_role(organization_id, array['trainer','manager']::public.member_role[])
    )
  );
