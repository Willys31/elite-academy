\set ON_ERROR_STOP 0
\pset tuples_only on

-- Chaque essai s'exécute sous le rôle applicatif (soumis à la RLS) et
-- avec l'identité portée par `request.user`, comme le ferait un JWT.
create or replace function public.essai_creation(uid uuid, etiquette text)
returns text
language plpgsql
as $$
declare ok boolean;
begin
  perform set_config('request.user', uid::text, true);
  begin
    insert into public.courses (organization_id, owner_id, title, slug)
    values ('aaaaaaaa-0000-0000-0000-000000000001', uid, 'Essai ' || etiquette,
            'essai-' || replace(etiquette, ' ', '-') || '-' || substr(uid::text, 1, 8));
    ok := true;
  exception when insufficient_privilege or others then
    ok := false;
  end;
  return etiquette || ' : ' || case when ok then 'CRÉATION AUTORISÉE' else 'refusée' end;
end;
$$;
