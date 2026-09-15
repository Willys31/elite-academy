# Tester les politiques RLS hors de Supabase

Les règles de sécurité les plus importantes d'Elite Academy vivent dans
PostgreSQL : qui peut créer une formation, qui peut la publier, qui peut
affecter un formateur. Les tests Vitest ne les touchent pas — ils ne
vérifient que les fonctions TypeScript, c'est-à-dire l'affichage des
boutons. Une règle peut donc être fausse en base sans qu'aucun test ne
le dise.

Ces fichiers permettent de rejouer toutes les migrations dans un
PostgreSQL nu et d'éprouver les politiques pour de vrai. C'est ainsi
qu'a été découverte la faille corrigée par la migration 0011 : un
concepteur, puis un formateur, pouvait publier sa propre formation d'un
simple `update courses set status = 'published'`, la règle de cycle
n'existant qu'en TypeScript.

## Mise en route

Il faut PostgreSQL 16 en local (pas Supabase, pas Docker).

```bash
export PATH=/usr/lib/postgresql/16/bin:$PATH
initdb -D /tmp/ea-test -A trust
pg_ctl -D /tmp/ea-test -l /tmp/ea-test/log -o '-p 5433 -k /tmp' start

createdb -h /tmp -p 5433 -U postgres ea
psql -h /tmp -p 5433 -U postgres -d ea -f shim_local.sql
psql -h /tmp -p 5433 -U postgres -d ea \
  -c "alter table auth.users add column if not exists raw_user_meta_data jsonb default '{}'::jsonb;"

for f in ../migrations/0*.sql; do
  psql -h /tmp -p 5433 -U postgres -d ea -v ON_ERROR_STOP=1 -q -f "$f" || echo "ÉCHEC $f"
done

psql -h /tmp -p 5433 -U postgres -d ea -f jeu_essai.sql
psql -h /tmp -p 5433 -U postgres -d ea -f fonctions_essai.sql
psql -h /tmp -p 5433 -U postgres -d ea -f fonctions_essai_generique.sql
psql -h /tmp -p 5433 -U postgres -d ea -f test_creation.sql
```

## Les deux pièces qui font que le test prouve quelque chose

**`shim_local.sql`** reproduit le strict minimum de ce que Supabase
fournit d'office : le schéma `auth`, la table `auth.users`, les rôles
`authenticated`, `anon` et `service_role`, la publication temps réel,
et les colonnes de quota des buckets de stockage. Sans lui, les
migrations ne s'appliquent pas hors de Supabase.

**`auth.uid()`** y est remplacée par une lecture de
`current_setting('request.user')`. Un test prend donc l'identité de
quelqu'un avec :

```sql
select set_config('request.user', '<uuid>', true);
```

C'est l'équivalent local du jeton JWT.

## Le piège à ne pas reproduire

Les essais doivent tourner sous `set role authenticated`. Le rôle
`postgres` est superutilisateur : il **contourne la RLS**. Un test
exécuté sous `postgres` passe toujours et ne prouve rien.

## Jeu d'essai

`jeu_essai.sql` crée une organisation et un compte par rôle :

| Rôle | UUID |
|---|---|
| administrateur | `1111…` |
| concepteur | `2222…` |
| formateur | `3333…` |
| responsable | `4444…` |
| apprenant | `5555…` |
| formateur d'une autre organisation | `6666…` |

Les fichiers `fonctions_essai*.sql` fournissent `essai_creation()` et
`essai()`, qui exécutent une instruction sous une identité donnée et
répondent « autorisé » ou « refusé ». Attention : une politique RLS qui
refuse un `UPDATE` ne lève aucune erreur — elle ne touche simplement
aucune ligne. `essai()` compte donc les lignes affectées en plus
d'attraper les exceptions.
