-- ============================================================
-- Elite Academy – Migration 0018
-- Visio Google Meet et mode hybride : mode de la session
-- (présentiel, visio, hybride), salle Meet rattachée, fenêtre réelle
-- de la visio, canal de chaque participant (sur place / à distance).
-- Références : réunion « Remarque Elite Academy » du 24/09/2026.
-- Dépend de 0006 (sessions), 0016 (sessions hybrides).
-- ============================================================

alter table public.live_sessions
  add column mode              text not null default 'onsite'
    check (mode in ('onsite','remote','hybrid')),
  -- Ressource Meet (`spaces/…`) si la salle a été créée par l'API ;
  -- null pour un lien collé à la main (pas de reprise de présence).
  add column meet_space_name   text unique,
  add column meet_uri          text
    check (meet_uri is null or meet_uri ~ '^https://meet\.google\.com/[a-z]{3}-[a-z]{4}-[a-z]{3}$'),
  add column meet_code         text,
  -- Fenêtre réelle de la visio (première arrivée, dernier départ),
  -- reprise de Google Meet : base du futur relevé d'heures formateur.
  add column visio_started_at  timestamptz,
  add column visio_ended_at    timestamptz,
  add column visio_synced_at   timestamptz,
  -- Noms vus dans Meet sans correspondance avec un inscrit.
  add column visio_unmatched   jsonb not null default '[]'::jsonb;

alter table public.session_participants
  add column channel text not null default 'onsite'
    check (channel in ('onsite','remote'));

-- Les sessions existantes avec un lien Meet dans `location` restent en
-- présentiel : le formateur choisit le mode explicitement.
