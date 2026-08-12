-- ============================================================
-- Elite Academy – Migration 0007
-- Certificats vérifiables.
-- Référence : schéma Supabase §7, PRD §15, document global §16.
--
-- Principes :
-- - identifiant de vérification unique et public ;
-- - la vérification publique passe par une fonction dédiée qui
--   n'expose que le minimum (jamais la table complète) ;
-- - l'attestation de complétion peut être réclamée par l'apprenant,
--   mais la condition (inscription terminée) est vérifiée EN BASE ;
-- - certificats de réussite/compétence délivrés par l'encadrement.
-- ============================================================

create type public.certificate_type as enum (
  'participation',  -- attestation de participation
  'completion',     -- attestation de complétion
  'success',        -- certificat de réussite
  'skill'           -- preuve de compétence
);

create type public.certificate_status as enum (
  'valid',
  'revoked'
);

-- ------------------------------------------------------------
-- 1. certificates
-- ------------------------------------------------------------

create table public.certificates (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.profiles (id) on delete cascade,
  organization_id       uuid not null references public.organizations (id) on delete cascade,
  course_id             uuid not null references public.courses (id) on delete cascade,
  competency_id         uuid references public.competencies (id) on delete set null,
  level                 public.mastery_level,
  certificate_type      public.certificate_type not null,
  verification_code     text not null unique,
  requirements_snapshot jsonb not null default '{}'::jsonb,
  issued_by             uuid not null references public.profiles (id),
  issued_at             timestamptz not null default now(),
  status                public.certificate_status not null default 'valid',
  revoked_at            timestamptz
);

create index idx_certs_user on public.certificates (user_id);
create index idx_certs_course on public.certificates (course_id);
create index idx_certs_org on public.certificates (organization_id);
create index idx_certs_code on public.certificates (verification_code);

-- Une seule attestation de complétion par apprenant et formation.
create unique index uq_certs_completion
  on public.certificates (user_id, course_id, certificate_type)
  where certificate_type = 'completion';

-- ------------------------------------------------------------
-- 2. Row Level Security
-- ------------------------------------------------------------

alter table public.certificates enable row level security;

-- Lecture : le titulaire (condition directe, nécessaire au RETURNING),
-- l'encadrement de la formation, Elite Experience.
create policy certs_select on public.certificates
  for select using (
    user_id = auth.uid()
    or public.oversees_course(course_id)
    or public.is_elite_admin()
  );

-- Création :
-- (a) réclamation par l'apprenant : uniquement une attestation de
--     complétion pour lui-même, si son inscription est terminée —
--     condition vérifiée EN BASE, pas seulement dans l'application ;
-- (b) délivrance par l'encadrement de la formation.
create policy certs_insert on public.certificates
  for insert with check (
    (
      user_id = auth.uid()
      and issued_by = auth.uid()
      and certificate_type = 'completion'
      and exists (
        select 1 from public.enrollments e
        where e.course_id = certificates.course_id
          and e.user_id = auth.uid()
          and e.status = 'completed'
      )
    )
    or (
      issued_by = auth.uid()
      and public.oversees_course(course_id)
    )
  );

-- Révocation : encadrement ou Elite Experience (pas de suppression :
-- un certificat révoqué reste tracé).
create policy certs_update on public.certificates
  for update using (
    public.oversees_course(course_id)
    or public.is_elite_admin()
  );

-- ------------------------------------------------------------
-- 3. Vérification publique
--    Fonction SECURITY DEFINER accessible sans compte : elle ne
--    retourne que les informations nécessaires à la vérification.
-- ------------------------------------------------------------

create or replace function public.verifier_certificat(code text)
returns table (
  titulaire         text,
  formation         text,
  organisation      text,
  type_certificat   public.certificate_type,
  niveau            public.mastery_level,
  competence        text,
  delivre_le        timestamptz,
  statut            public.certificate_status,
  revoque_le        timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.full_name,
    c.title,
    o.name,
    cert.certificate_type,
    cert.level,
    comp.name,
    cert.issued_at,
    cert.status,
    cert.revoked_at
  from public.certificates cert
  join public.profiles p on p.id = cert.user_id
  join public.courses c on c.id = cert.course_id
  join public.organizations o on o.id = cert.organization_id
  left join public.competencies comp on comp.id = cert.competency_id
  where cert.verification_code = upper(trim(code));
$$;

-- Accessible aux visiteurs non connectés (page publique de vérification).
grant execute on function public.verifier_certificat(text) to anon;
grant execute on function public.verifier_certificat(text) to authenticated;
