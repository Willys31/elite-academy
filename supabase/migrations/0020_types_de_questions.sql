-- ============================================================
-- Elite Academy – Migration 0020
-- Types de questions (PRD §14) : vrai/faux, réponse courte et
-- question ouverte corrigée par un formateur.
--
-- Jusqu'ici `questions.type` valait toujours 'qcm' et une
-- tentative était notée à la soumission (`graded`). Une question
-- ouverte ne se corrige pas automatiquement : la tentative reste
-- « en attente de correction » (`pending_review`) jusqu'à ce qu'un
-- membre de l'encadrement la note, et seules les questions déjà
-- notées alimentent la maîtrise par compétence.
--
-- Forme de `expected_answer` selon le type (lecture : client
-- d'administration uniquement, migration 0019) :
--   qcm, true_false : { "index": 0 }            — index de la bonne option
--   short_answer    : { "accepted": ["…", "…"] } — réponses acceptées,
--                     comparées sans casse ni accents
--   open            : { "rubric": "…" }         — éléments attendus,
--                     affichés au correcteur seulement
-- ============================================================

-- ------------------------------------------------------------
-- 1. Statut de tentative « en attente de correction ».
--    Une valeur d'enum ajoutée n'est utilisable qu'après validation
--    de la transaction : cette migration ne s'en sert donc pas.
-- ------------------------------------------------------------

alter type public.attempt_status add value if not exists 'pending_review';

-- ------------------------------------------------------------
-- 2. Types de questions autorisés. Les lignes existantes valent
--    toutes 'qcm' (éditeur, import IA, exercices personnalisés).
-- ------------------------------------------------------------

alter table public.questions
  drop constraint if exists questions_type_check;

alter table public.questions
  add constraint questions_type_check
  check (type in ('qcm', 'true_false', 'short_answer', 'open'));

comment on column public.questions.type is
  'qcm (choix unique), true_false, short_answer (réponses acceptées dans expected_answer.accepted) ou open (corrigée par un formateur, grille dans expected_answer.rubric).';

-- Aucune colonne ajoutée à `questions` : le `grant select` colonne par
-- colonne de la migration 0019 reste exact. Il est rappelé ici pour que
-- la règle soit visible au prochain ajout de colonne : `expected_answer`
-- et `explanation` restent illisibles par les rôles applicatifs.

grant select (id, activity_id, type, prompt, options, difficulty, competency_id, position, created_at)
  on public.questions to authenticated;

-- ------------------------------------------------------------
-- 3. Traçabilité de la correction humaine : qui a noté, quand.
--    La note elle-même (score, verdict et commentaire par question)
--    vit dans `attempts.score` et `attempts.feedback`, écrits par le
--    client d'administration après vérification que l'appelant
--    encadre la formation (`oversees_activity`). Aucune politique
--    d'UPDATE n'est ajoutée : l'apprenant ne touche jamais à sa
--    tentative, le formateur non plus par appel direct.
-- ------------------------------------------------------------

alter table public.attempts
  add column if not exists graded_by uuid references public.profiles (id) on delete set null,
  add column if not exists graded_at timestamptz;

comment on column public.attempts.graded_by is
  'Membre de l''encadrement ayant noté les questions ouvertes (null pour une correction entièrement automatique).';
