-- ============================================================
-- Elite Academy – Migration 0021
-- Lot 26 : activités rédigées (exercice, étude de cas, simulation)
-- et pré-correction par l'IA, validée par le formateur.
--
-- Rien ne change dans `activities` ni `questions` : une activité
-- rédigée est une ligne `activities` de type 'exercise', 'case_study'
-- ou 'simulation' (valeurs présentes depuis la 0005) qui porte UNE
-- question de type 'open' (lot 23). Le circuit des tentatives, de la
-- file « Copies à corriger » et de la maîtrise par compétence est donc
-- réutilisé tel quel.
--
-- Forme documentée de `activities.content` pour ces types :
--   { "expected_outcome": "…", "evaluation": "… critères observables …",
--     "situation_type": "etude_de_cas", "competency_refs": ["…"],
--     "media_brief": { "kind", "purpose", "description" } | null,
--     "generated_by_ai": true, "prompt_version": "plan-formation/v2" }
-- `expected_outcome` et `evaluation` sont VISIBLES de l'apprenant
-- (critères annoncés avant la réponse, hypothèse H4 du brief) ; le
-- corrigé type reste dans `questions.expected_answer.rubric`, illisible
-- par les rôles applicatifs (0019).
--
-- La proposition de l'IA (verdict, critères, feedback) ne peut pas vivre
-- dans `attempts.feedback` : l'apprenant lit sa propre tentative. Elle
-- est rangée dans une table réservée à l'encadrement, `attempt_ai_reviews`,
-- écrite par le client d'administration, et n'atteint `attempts.feedback`
-- qu'une fois validée (ou modifiée) par un humain (`noterTentative`).
-- ============================================================

comment on column public.activities.content is
  'JSON libre selon le type. quiz : { placement? } ; file : { source_id, file_path… } ; exercise / case_study / simulation (lot 26) : { expected_outcome, evaluation, situation_type, competency_refs, media_brief, generated_by_ai, prompt_version }.';

-- ------------------------------------------------------------
-- 1. Qui encadre une tentative ? Même règle qu'au lot 23 : la
--    tentative est visible sous RLS sans être la sienne.
-- ------------------------------------------------------------

create or replace function public.oversees_attempt(tid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.attempts t
    where t.id = tid
      and t.user_id <> auth.uid()
      and public.oversees_activity(t.activity_id)
  );
$$;

-- ------------------------------------------------------------
-- 2. Propositions de correction de l'IA, une par tentative.
-- ------------------------------------------------------------

create table public.attempt_ai_reviews (
  id               uuid primary key default gen_random_uuid(),
  attempt_id       uuid not null unique references public.attempts (id) on delete cascade,
  generation_id    uuid references public.ai_generations (id) on delete set null,
  model_name       text not null,
  prompt_version   text not null,
  -- Proposition : { verdict, confiance, criteres[], type_difficulte,
  -- points_forts[], a_travailler[], feedback_apprenant,
  -- commentaire_formateur, warnings[] } par question ouverte, indexée
  -- par l'identifiant de la question.
  proposal         jsonb not null default '{}'::jsonb,
  -- Décision humaine, renseignée par `noterTentative` : sert à mesurer
  -- la fiabilité de l'IA (collecte pour un ajustement ultérieur).
  validated_as_is  boolean,
  final_verdicts   jsonb,
  decided_by       uuid references public.profiles (id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);

comment on table public.attempt_ai_reviews is
  'Pré-correction par l''IA d''une copie contenant des réponses rédigées. Réservée à l''encadrement ; jamais lisible par l''apprenant ; écrite par le client d''administration.';

create index idx_attempt_ai_reviews_attempt on public.attempt_ai_reviews (attempt_id);

alter table public.attempt_ai_reviews enable row level security;

-- Lecture : l'encadrement de la formation, jamais l'auteur de la copie.
create policy attempt_ai_reviews_select on public.attempt_ai_reviews
  for select using (public.oversees_attempt(attempt_id));

-- Aucune politique d'insert / update / delete : table « à valeur »
-- alimentée par la plateforme (client d'administration), comme
-- `attempts` depuis la 0019.

grant select on public.attempt_ai_reviews to authenticated;

-- ------------------------------------------------------------
-- 3. Trace `ai_generations` d'une pré-correction.
--    `generation_type = 'answer_precorrection'`, `requested_by` =
--    l'apprenant (c'est sa copie qui déclenche l'appel). Comme il peut
--    LIRE ses propres lignes `ai_generations` (politique ai_gen_select,
--    0004), la colonne `result` ne doit contenir que la référence de la
--    revue ({ "review_id": … }), jamais la proposition elle-même.
--    L'insertion passe par le client d'administration : la politique
--    ai_gen_insert n'a pas besoin d'être étendue.
-- ------------------------------------------------------------

comment on column public.ai_generations.generation_type is
  'course_plan, document_structuring, session_analysis, tutor_help, tutor_exercises, answer_precorrection (lot 26 : result = { review_id } seulement).';
