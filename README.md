# Elite Academy

Plateforme éducative intelligente multi-domaines d'Elite Experience.
Conçue pour créer, diffuser, personnaliser, réviser, pratiquer, évaluer et
certifier des formations professionnelles en ligne, en présentiel ou en hybride.

## Stack technique

- **Next.js 15** (App Router) + **React 19** + **TypeScript**
- **Tailwind CSS 4** (interface responsive ordinateur / tablette / téléphone)
- **Supabase** : PostgreSQL, Auth, Row Level Security (Storage, Realtime et
  recherche documentaire arriveront dans les lots suivants)
- **Vitest** pour les tests unitaires

## Démarrage

### 1. Prérequis

- Node.js 20 ou plus récent
- Un projet Supabase (gratuit) : <https://supabase.com>

### 2. Configuration

```bash
npm install
cp .env.example .env.local
```

Renseigner dans `.env.local` :

- `NEXT_PUBLIC_SUPABASE_URL` : URL du projet (Supabase → Settings → API)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` : clé publique `anon`
- `SUPABASE_SERVICE_ROLE_KEY` : clé `service_role` (serveur uniquement,
  ne jamais l'exposer ni la committer)

### 3. Base de données

Dans l'éditeur SQL de Supabase, exécuter dans l'ordre :

1. `supabase/migrations/0001_socle_identite_organisations.sql`
2. `supabase/migrations/0002_competences_formations.sql`
3. `supabase/migrations/0003_correctif_rls_creation_formation.sql`
4. `supabase/migrations/0004_generation_ia.sql`
5. `supabase/migrations/0005_parcours_apprenant.sql`
6. `supabase/migrations/0006_sessions_presentielles.sql`
7. `supabase/migrations/0007_certificats.sql`
8. Créer votre compte via l'écran d'inscription de l'application
9. `supabase/seed/bootstrap_admin.sql` (après avoir remplacé l'e-mail)
   pour devenir administrateur Elite Experience

### 4. Lancer

```bash
npm run dev      # développement (http://localhost:3000)
npm run build    # compilation de production
npm run test     # tests unitaires
```

## Structure du projet

```
src/
  app/
    (auth)/         Écrans publics : connexion, inscription,
                    mot de passe oublié, réinitialisation
    (app)/          Écrans protégés : accueil, organisations…
    auth/callback/  Échange du code de confirmation / réinitialisation
  components/
    ui/             Composants d'interface réutilisables
    layout/         Shell applicatif responsive (navigation par rôle)
  lib/
    auth/           Rôles, permissions (logique pure testée), profil courant
    supabase/       Clients navigateur / serveur / admin / middleware
supabase/
  migrations/       Migrations SQL versionnées (RLS incluse)
  seed/             Script d'amorçage du premier administrateur
tests/              Tests unitaires Vitest
docs/               Documentation des lots livrés
```

## Règles de sécurité appliquées

- Toutes les tables sont protégées par **Row Level Security** ;
  l'interface n'est qu'une première barrière de confort.
- La clé `service_role` n'est utilisée que dans `src/lib/supabase/admin.ts`,
  protégé par `server-only` (la compilation échoue s'il est importé côté client).
- Les actions serveur vérifient identité, rôle et organisation **avant**
  toute lecture ou écriture privilégiée.
- Aucun secret dans le frontend, les logs ou le dépôt.

## Documentation des lots

- [Lot 1 – Socle : authentification, rôles, organisations](docs/lot-01-socle.md)
- [Lot 2 – Compétences, formations et catalogue](docs/lot-02-formations.md)
- [Lot 3 – Génération IA : assistant de création et validation](docs/lot-03-generation-ia.md)
- [Lot 4 – Parcours apprenant : inscription, lecteur, QCM, progression](docs/lot-04-parcours-apprenant.md)
- [Lot 5 – Sessions présentielles et temps réel](docs/lot-05-sessions.md)
- [Lot 6 – Certificats vérifiables](docs/lot-06-certificats.md)
- [Lot 7 – Page d'accueil publique et système visuel](docs/lot-07-accueil-design.md)
