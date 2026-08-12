-- ============================================================
-- Elite Academy – Migration 0004
-- Traçabilité des générations IA et de leurs validations.
-- Référence : schéma Supabase §8, architecture §8 et §11,
-- workflows IA §29-§30.
--
-- Note de conception : les politiques SELECT contiennent une
-- condition directe sur la ligne (requested_by = auth.uid())
-- pour que INSERT ... RETURNING fonctionne (leçon du correctif
-- de la migration 0003 : une fonction STABLE ne voit pas la
-- ligne insérée par l'instruction en cours).
-- ============================================================

create type public.generation_status as enum (
  'pending',    -- en attente
  'running',    -- en cours
  'succeeded',  -- terminé
  'failed'      -- échoué
);

-- ------------------------------------------------------------
-- 1. ai_generations – chaque appel au LLM est tracé
-- ------------------------------------------------------------

create table public.ai_generations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  requested_by     uuid not null references public.profiles (id),
  generation_type  text not null default 'course_plan',
  brief            jsonb not null default '{}'::jsonb,
  context          jsonb not null default '{}'::jsonb,
  source_ids       jsonb not null default '[]'::jsonb,
  prompt_version   text not null,
  model_name       text not null,
  input_tokens     integer,
  output_tokens    integer,
  result           jsonb,
  result_course_id uuid references public.courses (id) on delete set null,
  status           public.generation_status not null default 'pending',
  error_message    text,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

create index idx_ai_gen_org     on public.ai_generations (organization_id, created_at desc);
create index idx_ai_gen_user    on public.ai_generations (requested_by);
create index idx_ai_gen_course  on public.ai_generations (result_course_id);
create index idx_ai_gen_status  on public.ai_generations (status);

-- ------------------------------------------------------------
-- 2. ai_validations – décisions humaines sur les générations
-- ------------------------------------------------------------

create table public.ai_validations (
  id            uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.ai_generations (id) on delete cascade,
  reviewer_id   uuid not null references public.profiles (id),
  decision      text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  comments      text,
  created_at    timestamptz not null default now()
);

create index idx_ai_val_generation on public.ai_validations (generation_id);

-- ------------------------------------------------------------
-- 3. Row Level Security
-- ------------------------------------------------------------

alter table public.ai_generations enable row level security;
alter table public.ai_validations enable row level security;

-- ----- ai_generations -----

-- Lecture : le demandeur (condition directe, indispensable au
-- RETURNING), les admins/concepteurs de l'organisation et
-- l'admin Elite Experience.
create policy ai_gen_select on public.ai_generations
  for select using (
    requested_by = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
  );

-- Création : le demandeur lui-même, s'il a le droit de créer des
-- formations dans l'organisation (admin/concepteur ou Elite).
create policy ai_gen_insert on public.ai_generations
  for insert with check (
    requested_by = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(organization_id, array['admin','designer']::public.member_role[])
    )
  );

-- Mise à jour (statut, résultat, erreurs) : le demandeur ou
-- l'admin Elite Experience.
create policy ai_gen_update on public.ai_generations
  for update using (
    requested_by = auth.uid()
    or public.is_elite_admin()
  );

-- Pas de suppression : l'historique des générations est conservé.

-- ----- ai_validations -----

-- Lecture : le validateur (condition directe), le demandeur de la
-- génération, les admins/concepteurs de l'organisation, Elite.
create policy ai_val_select on public.ai_validations
  for select using (
    reviewer_id = auth.uid()
    or public.is_elite_admin()
    or exists (
      select 1 from public.ai_generations g
      where g.id = generation_id
        and (
          g.requested_by = auth.uid()
          or public.has_org_role(g.organization_id, array['admin','designer']::public.member_role[])
        )
    )
  );

-- Création : le validateur lui-même, s'il est admin de
-- l'organisation de la génération ou admin Elite Experience.
create policy ai_val_insert on public.ai_validations
  for insert with check (
    reviewer_id = auth.uid()
    and exists (
      select 1 from public.ai_generations g
      where g.id = generation_id
        and (
          public.is_elite_admin()
          or public.has_org_role(g.organization_id, array['admin']::public.member_role[])
        )
    )
  );

-- Pas de modification ni suppression : les décisions sont définitives
-- (une nouvelle décision crée une nouvelle ligne).
