# Grille de notation humaine — banc d'essai IA (lot 25)

Chaque plan généré est lu en entier par un relecteur pédagogique (concepteur ou
expert métier) qui note six critères de 1 à 5. Les notes sont reportées dans la
section « Notation humaine » du `rapport.md` du jour. Les mesures automatiques
(durée, jetons, coût, contrôles) sont déjà dans le rapport : la grille mesure ce
qu'une machine ne voit pas.

Sources : instructions projet §10 (validation des contenus IA) et workflows IA
§27 (contrôle qualité obligatoire).

| Critère | 1 | 3 | 5 |
|---|---|---|---|
| **Exactitude** | Erreurs de fond (règle fausse, chiffre inventé, procédure dangereuse) | Globalement juste, quelques approximations à corriger | Juste et à jour ; les incertitudes sont signalées dans `warnings` plutôt qu'inventées |
| **Adéquation au public** | Vocabulaire, exemples ou durée inadaptés au public et au contexte décrits | Adapté dans l'ensemble, quelques passages trop abstraits ou trop longs | Exemples, ton, difficulté et durée pensés pour ce public précis (métier, contexte ivoirien ou africain quand demandé) |
| **Lien avec les compétences** | Compétences théoriques ou activités sans rapport avec elles | Compétences observables mais lien activité ↔ compétence parfois flou | Compétences formulées en comportements observables, chaque activité en travaille une et le dit ; niveaux cohérents et progressifs |
| **Qualité du français** | Fautes fréquentes, anglicismes, phrases confuses | Correct, quelques lourdeurs | Clair, professionnel, prêt à publier après relecture légère |
| **Pertinence des exemples** | Exemples génériques, hors métier, ou méthode commerciale plaquée sur un sujet non commercial | Exemples plausibles mais interchangeables | Exemples professionnels concrets, situés, réutilisables en formation |
| **Exercices** | Consignes vagues, pas de résultat attendu ni de critères ; trop ou trop peu d'exercices | Consignes claires, évaluation sommaire | Consigne, résultat attendu, critères d'évaluation et difficulté cohérents ; QCM avec distracteurs plausibles et explications qui enseignent |

Total sur 30. Repères : moins de 18, le plan n'est pas exploitable sans
réécriture ; 18 à 23, exploitable après relecture ; 24 et plus, proche d'un
brouillon prêt pour la validation.

## Consignes au relecteur

1. Lire le brief (dossier `briefs/`) avant le plan, pour juger l'adéquation.
2. Noter chaque plan sans connaître la configuration qui l'a produit si possible
   (les fichiers JSON portent le nom de la configuration : faites-les renommer
   par une autre personne pour une lecture en aveugle).
3. Signaler dans « Remarques » toute méthode commerciale injustifiée, tout
   contenu réglementaire ou de sécurité à faire vérifier par un expert, et
   tout passage qui semble recopié d'une source.
4. Les plans restent des brouillons : rien de ce banc d'essai n'est publié.
