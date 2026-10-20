import type { CorrectionQuestion } from "@/lib/courses/progression";
import { lireTypeQuestion, type TypeQuestion } from "@/lib/courses/questions";

/**
 * Saisie et restitution d'une réponse selon le type de question (lot 23).
 * Composants serveur, sans état : la page qui les emploie reste un
 * composant serveur et la correction ne quitte jamais le serveur.
 */

/** Champ de réponse d'une question, selon son type. */
export function ChampReponse({
  question,
  placeholder,
}: {
  question: { id: string; type?: unknown; options?: unknown };
  /** Texte d'aide d'une réponse rédigée (activité rédigée, lot 26). */
  placeholder?: string;
}) {
  const type: TypeQuestion = lireTypeQuestion(question.type);
  const nom = `q_${question.id}`;

  if (type === "short_answer") {
    return (
      <input
        type="text"
        name={nom}
        maxLength={300}
        autoComplete="off"
        placeholder="Votre réponse en quelques mots"
        className="block min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-ink-900 outline-none transition duration-200 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15"
      />
    );
  }

  if (type === "open") {
    return (
      <textarea
        name={nom}
        rows={5}
        maxLength={4000}
        placeholder={placeholder ?? "Rédigez votre réponse. Un formateur la lira et la notera."}
        className="block w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink-900 outline-none transition duration-200 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15"
      />
    );
  }

  const options = Array.isArray(question.options) ? (question.options as string[]) : [];
  return (
    <div className="space-y-1.5">
      {options.map((opt, j) => (
        <label
          key={j}
          className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-slate-200 px-3 py-2.5 text-sm hover:bg-slate-50 has-checked:border-brand-400 has-checked:bg-brand-50"
        >
          <input
            type="radio"
            name={nom}
            value={j}
            className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
          />
          {opt}
        </label>
      ))}
    </div>
  );
}

/**
 * Ligne de feedback d'une question corrigée : juste, fausse ou en
 * attente de la note du formateur. Les corrigés affichés ici ont déjà
 * été renvoyés par le serveur après soumission.
 */
export function LigneFeedback({
  detail,
  numero,
  libelle,
}: {
  detail: CorrectionQuestion;
  numero: number;
  /** Remplace « Question N » (activité rédigée : « Votre réponse »). */
  libelle?: string;
}) {
  const enAttente = detail.correcte === null;
  const ouverte = detail.type === "open";
  const ton = enAttente
    ? "bg-sand-100 text-slate-700"
    : detail.correcte
      ? "bg-green-50 text-green-900"
      : "bg-red-50 text-red-900";
  return (
    <li className={`rounded-lg px-3 py-2 ${ton}`}>
      {libelle ?? `Question ${numero}`} :{" "}
      {enAttente
        ? "en attente de la note du formateur ⏳"
        : detail.correcte
          ? ouverte
            ? "acquise ✓"
            : "correcte ✓"
          : ouverte
            ? "non acquise ✗"
            : "incorrecte ✗"}
      {detail.type === "short_answer" && typeof detail.reponseDonnee === "string" ? (
        <span className="mt-1 block text-slate-600">
          Votre réponse : « {detail.reponseDonnee} »
          {!detail.correcte && detail.reponseAttendue
            ? ` · réponse attendue : « ${detail.reponseAttendue} »`
            : ""}
        </span>
      ) : null}
      {detail.type === "open" && typeof detail.reponseDonnee === "string" ? (
        <span className="mt-1 block whitespace-pre-line text-slate-600">{detail.reponseDonnee}</span>
      ) : null}
      {detail.commentaire ? (
        <span className="mt-1 block border-l-2 border-brand-300 pl-3 text-slate-700">
          Commentaire du formateur : {detail.commentaire}
        </span>
      ) : null}
      {detail.explication && !enAttente ? (
        <span className="mt-1 block text-slate-600">{detail.explication}</span>
      ) : null}
    </li>
  );
}
