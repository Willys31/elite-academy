-- ============================================================
-- Elite Academy – Migration 0010
-- Affectation des formateurs aux formations.
--
-- Problème corrigé : jusqu'ici, les seuls liens entre une personne et
-- une formation étaient `courses.owner_id` (« je l'ai créée ») et
-- `enrollments` (« je la suis comme apprenant »). Un formateur qui
-- n'avait pas créé la formation n'avait donc aucun moyen d'y être
-- rattaché autrement qu'en s'y INSCRIVANT — c'est-à-dire en empruntant
-- le lien de l'apprenant. L'interface s'en trouvait absurde : elle
-- proposait à un formateur de s'inscrire aux formations qu'il anime.
--
-- Trois relations distinctes existent en réalité. Cette migration
-- complète la deuxième :
--   1. concevoir  → courses.owner_id
--   2. animer     → course_trainers        (ajouté ici)
--   3. suivre     → enrollments
--
-- Deux décisions validées avec Elite Experience :
--   a) un formateur peut CRÉER une formation (il en devient
--      propriétaire) et la soumettre à validation, mais ne peut
--      toujours pas l'approuver ni la publier : la règle « aucun
--      contenu publié sans validation humaine » (document global §19)
--      reste entière, elle est portée par les transitions de statut ;
--   b) un formateur AFFECTÉ à une formation qu'il n'a pas créée
--      l'anime sans pouvoir en modifier le contenu. `can_edit_course`
--      n'est donc volontairement PAS élargie : on n'écrit pas par-dessus
--      le travail d'un concepteur.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Qui peut affecter un formateur à une formation ?
--
--    L'affectation est un acte d'organisation, pas de pédagogie :
--    elle revient à l'administrateur et au responsable
--    d'organisation. Un formateur ne s'auto-affecte pas, sinon
--    l'affectation ne prouverait plus rien.
-- ------------------------------------------------------------

create or replace function public.can_assign_trainers(cid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.courses c
    where c.id = cid
      and (
        public.is_elite_admin()
        or public.has_org_role(
             c.organization_id,
             array['admin','manager']::public.member_role[]
           )
      )
  );
$$;

-- ------------------------------------------------------------
-- 2. course_trainers – qui anime quoi
--
--    Clé primaire composite : une personne est affectée une fois ou
--    zéro fois à une formation, jamais deux. `assigned_by` garde la
--    trace de qui a décidé (document global §13, traçabilité).
-- ------------------------------------------------------------

create table public.course_trainers (
  course_id   uuid not null references public.courses (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (course_id, user_id)
);

-- Index sur l'utilisateur : « quelles formations est-ce que j'anime ? »
-- est la question posée à chaque affichage de l'écran « Mes formations ».
-- La clé primaire ne couvre que le sens inverse.
create index idx_course_trainers_user on public.course_trainers (user_id);

alter table public.course_trainers enable row level security;

-- Lecture : quiconque peut déjà voir la formation. L'équipe qui anime
-- n'est pas une information sensible, et l'apprenant a un intérêt
-- légitime à savoir qui encadre.
create policy course_trainers_select on public.course_trainers
  for select using (public.can_view_course(course_id));

create policy course_trainers_insert on public.course_trainers
  for insert with check (public.can_assign_trainers(course_id));

-- Pas de mise à jour : une affectation se crée ou se retire, elle ne
-- se modifie pas. Changer de formateur, c'est retirer l'un et ajouter
-- l'autre — et les deux gestes restent tracés.
create policy course_trainers_delete on public.course_trainers
  for delete using (public.can_assign_trainers(course_id));

comment on table public.course_trainers is
  'Formateurs affectés à une formation. Le lien « anime », distinct de owner_id (« a conçu ») et de enrollments (« suit »).';

-- ------------------------------------------------------------
-- 3. Ouverture de la création aux formateurs
--
--    Le formateur rejoint admin et concepteur pour la création. Il
--    devient propriétaire de ce qu'il crée, donc `can_edit_course`
--    l'autorise déjà à le modifier — aucune autre règle à changer.
--    La publication, elle, ne bouge pas d'un pouce.
-- ------------------------------------------------------------

drop policy if exists courses_insert on public.courses;

create policy courses_insert on public.courses
  for insert with check (
    owner_id = auth.uid()
    and (
      public.is_elite_admin()
      or public.has_org_role(
           organization_id,
           array['admin','designer','trainer']::public.member_role[]
         )
    )
  );
