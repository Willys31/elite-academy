-- ============================================================
-- Elite Academy – Migration 0022
-- Lot 28 : « Expliquer ce passage » — le tuteur IA dans la leçon.
--
-- Un apprenant sélectionne un mot ou une expression d'une leçon (ou le
-- saisit) et demande au tuteur de l'expliquer. L'événement rejoint
-- `tutor_help_events` (lot 18) : même quota journalier, même lecture
-- par l'encadrement, même écriture par le client d'administration.
--
-- Ce qui change : une aide peut porter sur une LEÇON et non plus
-- seulement sur une activité ; le passage demandé est conservé (signal
-- pour le concepteur : une notion mal expliquée revient souvent).
--
-- Le score de blocage (lot 18) n'est pas touché : il ne lit que les
-- aides rattachées à une compétence (`competency_id`), et une
-- explication de passage n'en a pas (brief lot 28, H3).
-- ============================================================

-- 1. Cible : activité OU leçon.
alter table public.tutor_help_events
  alter column activity_id drop not null;

alter table public.tutor_help_events
  add column lesson_id uuid references public.lessons (id) on delete cascade,
  add column passage   text check (passage is null or char_length(passage) between 1 and 300);

alter table public.tutor_help_events
  add constraint tutor_help_events_cible_check
  check (activity_id is not null or lesson_id is not null);

-- 2. Nouveau type d'aide.
alter table public.tutor_help_events
  drop constraint tutor_help_events_help_type_check;

alter table public.tutor_help_events
  add constraint tutor_help_events_help_type_check
  check (help_type in (
    'reformulate', 'dont_understand', 'hint', 'example', 'detailed_explanation',
    'explain_passage'
  ));

-- 3. Lecture des explications d'une leçon par l'apprenant (volet
--    « Explications précédentes ») et agrégats futurs par leçon.
create index idx_the_lesson on public.tutor_help_events (lesson_id, created_at desc)
  where lesson_id is not null;

comment on column public.tutor_help_events.lesson_id is
  'Leçon concernée (lot 28, help_type = explain_passage). Une aide porte sur une activité OU une leçon.';
comment on column public.tutor_help_events.passage is
  'Mot ou expression dont l''apprenant a demandé l''explication (lot 28), 300 caractères au plus.';
comment on column public.tutor_help_events.help_type is
  'reformulate, dont_understand, hint, example, detailed_explanation (lot 18, sur une activité) ; explain_passage (lot 28, sur une leçon).';

-- La politique de lecture (`tutor_help_events_select` : l''apprenant
-- lui-même ou l''encadrement de la formation via `course_id`) et
-- l''absence de politique d''écriture restent valables telles quelles.
