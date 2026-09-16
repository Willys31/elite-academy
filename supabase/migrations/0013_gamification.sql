-- ============================================================
-- Elite Academy – Migration 0013
-- Gamification : points (XP), badges, compteurs, distinctions,
-- classement par formation.
-- Références : addendum Gamification §3 à §9, manuel complet §3.2 et §5.
--
-- Principe de sécurité : les tables « à valeur » (xp_events,
-- learner_badges, badge_progress) n'ont AUCUNE politique d'écriture
-- pour les utilisateurs. Avec une politique `user_id = auth.uid()`,
-- n'importe qui pourrait s'attribuer des points par un appel REST
-- direct. Les écritures passent par le client d'administration depuis
-- les actions serveur (src/lib/gamification/moteur.ts) ; RLS protège
-- les lectures.
-- ============================================================

-- ------------------------------------------------------------
-- 1. xp_events – journal des points
-- ------------------------------------------------------------

create table public.xp_events (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  course_id       uuid references public.courses (id) on delete set null,
  activity_id     uuid references public.activities (id) on delete set null,
  session_id      uuid references public.live_sessions (id) on delete set null,
  xp_type         text not null check (xp_type in (
                    'qcm','lecon_terminee','session_presence','session_ponctualite',
                    'session_activite','session_top3','session_completion',
                    'entraide_utile','situation_validee','badge','distinction',
                    'exercice_perso','deblocage','niveau_competence'
                  )),
  xp_amount       integer not null,
  -- Référence de l'événement source (tentative, leçon, session, vote…) :
  -- une seule attribution par (utilisateur, type, référence).
  reference_id    uuid,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create unique index uq_xp_reference
  on public.xp_events (user_id, xp_type, reference_id)
  where reference_id is not null;
create index idx_xp_user_date   on public.xp_events (user_id, created_at desc);
create index idx_xp_course_date on public.xp_events (course_id, created_at)
  where course_id is not null;

-- ------------------------------------------------------------
-- 2. badges – catalogue (copie de départ de CATALOGUE_BADGES)
-- ------------------------------------------------------------

create table public.badges (
  id           uuid primary key default gen_random_uuid(),
  badge_key    text not null unique,
  family       text not null check (family in (
                 'performance','regularite','maitrise','progression',
                 'session','communaute','distinction'
               )),
  name         text not null,
  description  text not null,
  counter_key  text,
  target_value integer,
  tier         text check (tier in ('bronze','argent','or','platine')),
  is_special   boolean not null default false,
  context_kind text check (context_kind in ('formation','competence','session','secteur','activite')),
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

insert into public.badges (badge_key, family, name, description, counter_key, target_value, tier, is_special, context_kind, sort_order) values
  ('reflexe_bronze',     'performance', 'Réflexe Bronze',      '1 QCM avec bonus de rapidité',                                   'reflexe', 1,  'bronze',  false, null, 10),
  ('reflexe_argent',     'performance', 'Réflexe Argent',      '5 QCM avec bonus de rapidité',                                   'reflexe', 5,  'argent',  false, null, 11),
  ('reflexe_or',         'performance', 'Réflexe Or',          '20 QCM avec bonus de rapidité',                                  'reflexe', 20, 'or',      false, null, 12),
  ('reflexe_platine',    'performance', 'Réflexe Platine',     '50 QCM avec bonus de rapidité',                                  'reflexe', 50, 'platine', false, null, 13),
  ('sans_faute_bronze',  'performance', 'Sans faute Bronze',   '1 activités réussies à 100 %',                                   'sans_faute', 1,  'bronze', false, null, 20),
  ('sans_faute_argent',  'performance', 'Sans faute Argent',   '5 activités réussies à 100 %',                                   'sans_faute', 5,  'argent', false, null, 21),
  ('sans_faute_or',      'performance', 'Sans faute Or',       '15 activités réussies à 100 %',                                  'sans_faute', 15, 'or',     false, null, 22),
  ('expert_bronze',      'performance', 'Expert Bronze',       '1 compétences avec un score moyen ≥ 90 %',                       'expert_competences', 1, 'bronze', false, null, 30),
  ('expert_argent',      'performance', 'Expert Argent',       '3 compétences avec un score moyen ≥ 90 %',                       'expert_competences', 3, 'argent', false, null, 31),
  ('expert_or',          'performance', 'Expert Or',           'Score moyen ≥ 90 % sur toutes les compétences d''une formation', null, null, 'or', false, 'formation', 32),
  ('serie_7',            'regularite',  'Série 7 jours',       '7 jours consécutifs d''activité',                                'serie_jours', 7,   'bronze',  false, null, 40),
  ('serie_30',           'regularite',  'Série 30 jours',      '30 jours consécutifs d''activité',                               'serie_jours', 30,  'argent',  false, null, 41),
  ('serie_100',          'regularite',  'Série 100 jours',     '100 jours consécutifs d''activité',                              'serie_jours', 100, 'or',      false, null, 42),
  ('serie_365',          'regularite',  'Série 365 jours',     'Une année entière d''activité quotidienne',                      'serie_jours', 365, 'platine', false, null, 43),
  ('operationnel_bronze','maitrise',    'Opérationnel Bronze', '1 compétences au niveau Opérationnel ou plus',                   'operationnel_competences', 1, 'bronze', false, null, 50),
  ('operationnel_argent','maitrise',    'Opérationnel Argent', '3 compétences au niveau Opérationnel ou plus',                   'operationnel_competences', 3, 'argent', false, null, 51),
  ('operationnel_or',    'maitrise',    'Opérationnel Or',     '5 compétences au niveau Opérationnel ou plus',                   'operationnel_competences', 5, 'or',     false, null, 52),
  ('avance_bronze',      'maitrise',    'Avancé Bronze',       '1 compétences au niveau Avancé ou plus',                         'avance_competences', 1, 'bronze', false, null, 55),
  ('avance_argent',      'maitrise',    'Avancé Argent',       '3 compétences au niveau Avancé ou plus',                         'avance_competences', 3, 'argent', false, null, 56),
  ('elite',              'maitrise',    'Elite',               'Niveau Elite validé sur une compétence',                         'elite_competences', 1, null, false, null, 58),
  ('polyvalent',         'maitrise',    'Polyvalent',          'Niveau Opérationnel ou plus dans 3 domaines de compétence différents', 'domaines_operationnels', 3, null, false, null, 59),
  ('progression',        'progression', 'Progression',         'Un niveau gagné sur une compétence',                             null, null, null, false, 'competence', 60),
  ('comeback',           'progression', 'Comeback',            'Remontée de moins de 50 % à plus de 80 % sur une activité',      null, null, null, false, 'activite', 61),
  ('eclaire',            'progression', 'Éclairé',             '10 blocages identifiés puis surmontés grâce aux exercices personnalisés', 'eclaire', 10, null, false, null, 62),
  ('problem_solver',     'progression', 'Problem Solver',      '5 situations de travail à résolution complexe validées',         'problem_solver', 5, null, false, null, 63),
  ('present_bronze',     'session',     'Présent Bronze',      '1 sessions présentielles suivies',                               'sessions_presentes', 1,  'bronze', false, null, 70),
  ('present_argent',     'session',     'Présent Argent',      '5 sessions présentielles suivies',                               'sessions_presentes', 5,  'argent', false, null, 71),
  ('present_or',         'session',     'Présent Or',          '20 sessions présentielles suivies',                              'sessions_presentes', 20, 'or',     false, null, 72),
  ('actif_session',      'session',     'Actif en session',    'A répondu à toutes les activités d''une session',                null, null, null, false, 'session', 73),
  ('roi_du_direct',      'session',     'Roi du direct',       'Premier du classement d''une session',                           null, null, null, false, 'session', 74),
  ('expert_contributor', 'communaute',  'Expert Contributor',  '20 aides votées « Utile » par au moins 2 pairs chacune',         'contributions_utiles', 20, null, false, null, 80),
  ('top_contributor',    'communaute',  'Top Contributor',     '500 votes « Utile » reçus sur vos aides et situations',          'votes_recus', 500, null, false, null, 81),
  ('storyteller',        'communaute',  'Storyteller',         '10 situations de travail validées, avec au moins 5 votes « Utile » en moyenne', 'situations_storyteller', 10, null, false, null, 82),
  ('expert_secteur',     'communaute',  'Expert de secteur',   '5 situations de travail validées dans un même secteur',          null, null, null, false, 'secteur', 83),
  ('elite_performer',    'distinction', 'Elite Performer',     'Top 1 du classement quatre semaines de suite, badge Expert Or et 100 % à toutes les activités', null, null, null, true, null, 90),
  ('rising_star',        'distinction', 'Rising Star',         'Remontée spectaculaire : de moins de 30 % à plus de 90 % sur une formation complète', null, null, null, true, 'formation', 91),
  ('excellence_award',   'distinction', 'Excellence Award',    'Toutes les compétences d''une formation au niveau Opérationnel ou plus, 100 % de réussite', null, null, null, true, 'formation', 92),
  ('commitment_award',   'distinction', 'Commitment Award',    '365 jours consécutifs d''activité et aucune absence aux sessions obligatoires', null, null, null, true, null, 93),
  ('mentor',             'distinction', 'Mentor',              'Expert Contributor, 20 aides validées et 5 situations de travail partagées', null, null, null, true, null, 94);

-- ------------------------------------------------------------
-- 3. learner_badges – badges obtenus
-- ------------------------------------------------------------

create table public.learner_badges (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  badge_id        uuid not null references public.badges (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Vide pour un badge unique ; identifiant du contexte (formation,
  -- compétence, session, secteur) pour un badge répétable.
  context_key     text not null default '',
  context         jsonb not null default '{}'::jsonb,
  earned_at       timestamptz not null default now(),
  unique (user_id, badge_id, context_key)
);

create index idx_learner_badges_user on public.learner_badges (user_id, earned_at desc);

-- ------------------------------------------------------------
-- 4. badge_progress – compteurs bruts
-- ------------------------------------------------------------

create table public.badge_progress (
  user_id       uuid not null references public.profiles (id) on delete cascade,
  counter_key   text not null,
  current_value integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, counter_key)
);

-- ------------------------------------------------------------
-- 5. special_mentions – distinctions proposées puis validées
-- ------------------------------------------------------------

create table public.special_mentions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  badge_id        uuid not null references public.badges (id) on delete cascade,
  course_id       uuid references public.courses (id) on delete set null,
  status          text not null default 'pending' check (status in ('pending','validated','rejected')),
  proposed_by     uuid references public.profiles (id) on delete set null,
  criteria        jsonb not null default '{}'::jsonb,
  comment         text,
  validated_by    uuid references public.profiles (id) on delete set null,
  validated_at    timestamptz,
  created_at      timestamptz not null default now()
);

create index idx_mentions_org_status on public.special_mentions (organization_id, status, created_at desc);
create index idx_mentions_user       on public.special_mentions (user_id, created_at desc);

-- ------------------------------------------------------------
-- 6. Row Level Security
-- ------------------------------------------------------------

alter table public.xp_events        enable row level security;
alter table public.badges           enable row level security;
alter table public.learner_badges   enable row level security;
alter table public.badge_progress   enable row level security;
alter table public.special_mentions enable row level security;

-- Points : soi-même, l'encadrement de la formation concernée, Elite.
create policy xp_events_select on public.xp_events
  for select using (
    user_id = auth.uid()
    or (course_id is not null and public.oversees_course(course_id))
    or public.is_elite_admin()
  );

-- Catalogue : lisible par tout utilisateur connecté, jamais modifiable.
create policy badges_select on public.badges
  for select using (auth.uid() is not null);

-- Badges obtenus : soi-même et les membres d'une organisation commune
-- (icône de profil dans les classements et l'entraide).
create policy learner_badges_select on public.learner_badges
  for select using (
    user_id = auth.uid()
    or public.shares_org_with(user_id)
  );

create policy badge_progress_select on public.badge_progress
  for select using (user_id = auth.uid());

-- Distinctions : l'apprenant concerné, l'encadrement de la formation,
-- l'encadrement de l'organisation.
create policy special_mentions_select on public.special_mentions
  for select using (
    user_id = auth.uid()
    or proposed_by = auth.uid()
    or (course_id is not null and public.oversees_course(course_id))
    or public.has_org_role(
         organization_id,
         array['admin','trainer','manager']::public.member_role[]
       )
    or public.is_elite_admin()
  );

-- Proposition manuelle par un encadrant de l'organisation.
create policy special_mentions_insert on public.special_mentions
  for insert with check (
    proposed_by = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(
           organization_id,
           array['admin','designer','trainer','manager']::public.member_role[]
         )
    )
  );

-- Validation / refus : mêmes rôles.
create policy special_mentions_update on public.special_mentions
  for update using (
    public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','designer','trainer','manager']::public.member_role[]
       )
  );

-- ------------------------------------------------------------
-- 7. Classement d'une formation sur une fenêtre
--    Calculé à la volée (pas de snapshot) ; réservé aux inscrits et à
--    l'encadrement ; exclut les apprenants qui ont masqué leur
--    classement ; ne renvoie jamais l'adresse e-mail.
-- ------------------------------------------------------------

create or replace function public.classement_formation(
  cid   uuid,
  debut timestamptz,
  fin   timestamptz
)
returns table (
  user_id     uuid,
  nom_affiche text,
  xp_total    bigint,
  nb_badges   bigint,
  score_moyen numeric,
  inscrit_le  timestamptz
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not (
    exists (
      select 1 from public.enrollments e
      where e.course_id = cid
        and e.user_id = auth.uid()
        and e.status in ('active','completed')
    )
    or public.oversees_course(cid)
  ) then
    raise exception 'Classement réservé aux inscrits et à l''encadrement de la formation'
      using errcode = '42501';
  end if;

  return query
  select
    e.user_id,
    coalesce(
      nullif(trim(p.preferences -> 'classement' ->> 'pseudo'), ''),
      nullif(p.full_name, ''),
      'Apprenant'
    ) as nom_affiche,
    coalesce((
      select sum(x.xp_amount)
      from public.xp_events x
      where x.user_id = e.user_id
        and x.course_id = cid
        and x.created_at >= debut and x.created_at < fin
    ), 0)::bigint as xp_total,
    (
      select count(*)
      from public.learner_badges b
      where b.user_id = e.user_id
        and b.earned_at >= debut and b.earned_at < fin
    )::bigint as nb_badges,
    (
      select round(avg(a.score), 1)
      from public.attempts a
      join public.activities ac on ac.id = a.activity_id
      join public.lessons l on l.id = ac.lesson_id
      join public.modules m on m.id = l.module_id
      join public.course_versions v on v.id = m.course_version_id
      where a.user_id = e.user_id
        and v.course_id = cid
        and a.submitted_at >= debut and a.submitted_at < fin
    ) as score_moyen,
    coalesce(e.started_at, e.created_at) as inscrit_le
  from public.enrollments e
  join public.profiles p on p.id = e.user_id
  where e.course_id = cid
    and e.status in ('active','completed')
    and coalesce(p.preferences -> 'classement' ->> 'visible', 'true') <> 'false';
end;
$$;

revoke all on function public.classement_formation(uuid, timestamptz, timestamptz) from public;
grant execute on function public.classement_formation(uuid, timestamptz, timestamptz) to authenticated;
