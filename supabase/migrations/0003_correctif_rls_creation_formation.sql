-- ============================================================
-- Elite Academy – Migration 0003
-- Correctif : échec de la création de formation.
--
-- Cause : la politique de lecture de `courses` reposait uniquement
-- sur la fonction can_view_course(), déclarée STABLE. Lors d'un
-- INSERT ... RETURNING (utilisé par l'application pour récupérer
-- l'identifiant de la formation créée), une fonction STABLE ne voit
-- pas encore la ligne insérée par l'instruction en cours : la
-- politique refusait donc le retour de la ligne et l'insertion
-- échouait, même pour un administrateur.
--
-- Correctif : ajouter à la politique une condition directe
-- `owner_id = auth.uid()`, évaluée sur la ligne elle-même (sans
-- sous-requête). Le créateur voit ainsi immédiatement sa propre
-- formation, y compris dans le RETURNING de l'insertion.
-- ============================================================

drop policy courses_select on public.courses;

create policy courses_select on public.courses
  for select using (
    owner_id = auth.uid()
    or public.can_view_course(id)
  );
