-- ============================================================
-- Elite Academy – Migration 0009
-- Suppression d'éléments : générations IA, sessions présentielles,
-- et garde-fou de suppression d'une formation.
-- Référence : document global §13 (traçabilité), PRD §17.
--
-- Principe retenu : une formation ne se supprime que si elle n'a
-- laissé aucune trace chez un apprenant. Dès qu'une inscription ou
-- un certificat existe, la suppression est refusée et l'archivage
-- (déjà présent dans le cycle de statuts) prend le relais. Un
-- certificat doit rester vérifiable à vie par son code public : il
-- ne doit jamais disparaître par effet de bord d'un ménage dans le
-- catalogue.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Garde-fou : ce qui empêche de supprimer une formation
--
--    `security definer` est nécessaire : un administrateur
--    d'organisation ne voit pas forcément toutes les inscriptions
--    ni tous les certificats par RLS. Sans cette fonction, le
--    décompte remonterait à zéro et le garde-fou serait
--    silencieusement contourné. L'accès est donc vérifié
--    explicitement en tête de fonction.
-- ------------------------------------------------------------

create or replace function public.course_deletion_blockers(cid uuid)
returns table (
  inscriptions bigint,
  certificats  bigint,
  sessions     bigint,
  supports     bigint
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not public.can_edit_course(cid) then
    raise exception 'Accès refusé à la formation %', cid
      using errcode = '42501';
  end if;

  return query
    select
      (select count(*) from public.enrollments   e where e.course_id = cid),
      (select count(*) from public.certificates  c where c.course_id = cid),
      (select count(*) from public.live_sessions s where s.course_id = cid),
      (select count(*)
         from public.activities a
         join public.lessons    l on l.id = a.lesson_id
         join public.modules    m on m.id = l.module_id
         join public.course_versions v on v.id = m.course_version_id
        where v.course_id = cid
          and a.type = 'file');
end;
$$;

revoke all on function public.course_deletion_blockers(uuid) from public;
grant execute on function public.course_deletion_blockers(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2. Générations IA : suppression de l'historique
--
--    L'historique sert au diagnostic et à la traçabilité ; le
--    purger reste un geste d'administration, réservé aux mêmes
--    rôles que la création de contenu.
-- ------------------------------------------------------------

create policy ai_gen_delete on public.ai_generations
  for delete using (
    public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin','designer']::public.member_role[]
       )
  );

-- ------------------------------------------------------------
-- 3. Sessions présentielles
--
--    Présences (`session_participants`) et événements
--    (`live_events`) partent en cascade par leur clé étrangère.
--    Les résultats de QCM (`attempts`) ne sont pas rattachés à la
--    session : ils restent acquis à l'apprenant.
-- ------------------------------------------------------------

create policy sessions_delete on public.live_sessions
  for delete using (
    trainer_id = auth.uid()
    or public.is_elite_admin()
    or public.has_org_role(
         organization_id,
         array['admin']::public.member_role[]
       )
  );
