\pset tuples_only on
\pset border 0

-- Essai générique : exécute une instruction sous une identité donnée et
-- dit si elle est passée. `others` est volontairement attrapé : une
-- politique RLS qui refuse un UPDATE ne lève pas d'erreur, elle ne
-- touche simplement aucune ligne — il faut donc aussi compter.
create or replace function public.essai(uid uuid, sql text, etiquette text)
returns text
language plpgsql
as $$
declare touche integer;
begin
  perform set_config('request.user', uid::text, true);
  begin
    execute sql;
    get diagnostics touche = row_count;
    return etiquette || ' : ' || case when touche > 0 then 'AUTORISÉ' else 'refusé (0 ligne)' end;
  exception when others then
    return etiquette || ' : refusé (' || sqlstate || ')';
  end;
end;
$$;
