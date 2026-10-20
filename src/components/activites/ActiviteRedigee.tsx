import { Badge, Card } from "@/components/ui";
import {
  lireContenuActiviteRedigee,
  TYPE_ACTIVITE_REDIGEE_LABELS,
  type TypeActiviteRedigee,
} from "@/lib/courses/activites-redigees";

/**
 * En-tête d'une activité rédigée pour l'apprenant (lot 26) : consigne,
 * résultat attendu, critères d'évaluation (annoncés avant la réponse,
 * hypothèse H4 du brief), difficulté, compétences, média à venir.
 * Composant serveur, sans état. Le corrigé type (grille du concepteur)
 * n'est jamais transmis ici.
 */
export function ActiviteRedigee({
  type,
  instructions,
  content,
  difficulty,
  competences,
}: {
  type: TypeActiviteRedigee;
  instructions: string | null;
  content: unknown;
  difficulty: number;
  competences: string[];
}) {
  const c = lireContenuActiviteRedigee(content);
  return (
    <>
      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Badge>✍️ {TYPE_ACTIVITE_REDIGEE_LABELS[type]}</Badge>
        <Badge>Difficulté {difficulty}/5</Badge>
        {competences.map((nom) => (
          <Badge key={nom}>{nom}</Badge>
        ))}
      </div>

      <Card className="mb-6">
        <div className="space-y-4 text-sm text-slate-800">
          {instructions ? <p className="whitespace-pre-line leading-relaxed">{instructions}</p> : null}
          {c.expected_outcome ? (
            <p>
              <span className="font-medium text-ink-900">Résultat attendu : </span>
              {c.expected_outcome}
            </p>
          ) : null}
          {c.evaluation ? (
            <div className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Critères d&apos;évaluation</p>
              <p className="mt-1 whitespace-pre-line">{c.evaluation}</p>
            </div>
          ) : null}
          {c.media_brief ? (
            <p className="text-xs text-slate-500">
              Un support ({c.media_brief.kind}) accompagnera cette activité : {c.media_brief.purpose || c.media_brief.description}.
            </p>
          ) : null}
          <p className="text-xs text-slate-500">
            Votre réponse écrite est pré-corrigée par l&apos;IA puis validée par un formateur : vous recevrez son verdict et
            son commentaire, jamais une correction automatique seule.
          </p>
        </div>
      </Card>
    </>
  );
}
