import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  CERT_TYPE_LABELS,
  codeVerificationValide,
  normaliserCodeVerification,
} from "@/lib/certificats/certificats";
import { LEVEL_LABELS } from "@/lib/courses/statuts";

/* Le gabarit du layout racine ajoute déjà « – Elite Academy » : le titre
   ne le répète pas, sinon l'onglet affiche deux fois le nom du site. */
export const metadata: Metadata = { title: "Vérifier un certificat" };

interface ResultatVerification {
  titulaire: string;
  formation: string;
  organisation: string;
  type_certificat: string;
  niveau: string | null;
  competence: string | null;
  delivre_le: string;
  statut: string;
  revoque_le: string | null;
}

/** Ligne d'un certificat rendu : libellé discret, valeur affirmée. */
function LigneCertificat({ terme, children }: { terme: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-sand-200 py-2 last:border-0">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        {terme}
      </dt>
      <dd className="min-w-0 text-sm font-medium text-ink-900 sm:text-right">{children}</dd>
    </div>
  );
}

/** Encadré d'échec : format invalide, ou code inconnu de la base. */
function Echec({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-6 rounded-2xl border border-red-300/60 bg-red-50 p-5 sm:p-6"
    >
      <p className="flex items-center gap-2.5 font-display text-lg font-semibold text-red-900">
        <span
          aria-hidden
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-600 text-sm text-white"
        >
          ✕
        </span>
        {titre}
      </p>
      <p className="mt-2.5 text-sm leading-relaxed text-red-900/80">{children}</p>
    </div>
  );
}

/**
 * Page PUBLIQUE de vérification des certificats (aucun compte requis).
 * Interroge une fonction dédiée qui n'expose que le minimum nécessaire.
 *
 * C'est le seul écran du produit qu'un recruteur ou un client verra sans
 * jamais créer de compte : le résultat y est donc rendu comme un document
 * — un certificat posé sur la page — et non comme une ligne de statut.
 */
export default async function VerifierPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const params = await searchParams;
  const saisie = params.code ?? "";
  const code = normaliserCodeVerification(saisie);

  let resultat: ResultatVerification | null = null;
  let formatInvalide = false;
  let introuvable = false;

  if (saisie) {
    if (!codeVerificationValide(code)) {
      formatInvalide = true;
    } else {
      const supabase = await createClient();
      const { data } = await supabase.rpc("verifier_certificat", { code });
      const ligne = Array.isArray(data) ? data[0] : null;
      if (ligne) resultat = ligne as ResultatVerification;
      else introuvable = true;
    }
  }

  const valide = resultat?.statut === "valid";

  return (
    <main className="relative min-h-dvh overflow-hidden bg-ink-950 px-4 py-10 sm:px-6 sm:py-16">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-brand-700/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[-25%] right-[-15%] h-[420px] w-[420px] rounded-full bg-gold-500/10 blur-3xl"
      />

      <div className="relative mx-auto w-full max-w-xl">
        {/* ---------- Marque ---------- */}
        <div className="text-center">
          <Link
            href="/"
            className="inline-flex items-baseline gap-2.5 rounded transition duration-200 hover:opacity-80"
          >
            <span className="font-display text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              Elite Academy
            </span>
          </Link>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-gold-300">
            Vérification officielle
          </p>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-white/60">
            Saisissez le code figurant sur le certificat. La réponse est
            immédiate, publique, et ne demande aucun compte.
          </p>
        </div>

        {/* ---------- Saisie du code ---------- */}
        <form
          method="get"
          className="mt-9 rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur sm:p-6"
        >
          <label
            htmlFor="code"
            className="mb-2.5 block text-center text-xs font-semibold uppercase tracking-[0.2em] text-white/50"
          >
            Code de vérification
          </label>
          <input
            id="code"
            name="code"
            defaultValue={saisie}
            placeholder="EA-XXXX-XXXX-XXXX"
            autoComplete="off"
            spellCheck={false}
            /* La saisie est monospace, large et espacée : un code se relit
               caractère par caractère, et l'utilisateur le recopie souvent
               depuis un papier ou une photo.
               Taille et interlettrage réduits sous 640 px : à 18 px espacé de
               0,18 em, les dix-sept caractères de EA-XXXX-XXXX-XXXX
               dépassaient le champ sur un écran de 320 px. 16 px reste le
               minimum sous lequel iOS zoome tout seul à la mise au point. */
            className="block min-h-14 w-full rounded-xl border border-white/15 bg-ink-900/60 px-3 py-3 text-center font-mono text-base uppercase tracking-[0.1em] text-white placeholder:text-white/25 outline-none transition duration-200 focus:border-gold-400 focus:bg-ink-900 focus:ring-4 focus:ring-gold-300/20 sm:px-4 sm:text-xl sm:tracking-[0.18em]"
          />
          <button
            type="submit"
            className="mt-3.5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-gold-400 px-5 py-3 text-sm font-semibold text-ink-950 shadow-[0_8px_24px_-8px_rgba(211,160,50,0.7)] transition duration-200 hover:bg-gold-300 active:translate-y-px"
          >
            Vérifier ce certificat
          </button>
        </form>

        {/* ---------- Échecs ---------- */}
        {/* La cause la plus fréquente n'est pas le tiret oublié mais un
            caractère exclu : les codes n'utilisent ni 0, ni 1, ni I, L ou O,
            justement parce qu'on les confond en recopiant. Le message le dit
            plutôt que de renvoyer l'utilisateur à un format abstrait. */}
        {formatInvalide ? (
          <Echec titre="Format de code invalide">
            Un code de certificat ressemble à{" "}
            <span className="font-mono font-semibold">EA-XXXX-XXXX-XXXX</span>.
            Il n&apos;utilise jamais{" "}
            <span className="font-mono font-semibold">0</span>,{" "}
            <span className="font-mono font-semibold">1</span>,{" "}
            <span className="font-mono font-semibold">I</span>,{" "}
            <span className="font-mono font-semibold">L</span> ni{" "}
            <span className="font-mono font-semibold">O</span>, qui se
            confondent trop facilement à la lecture. Si vous avez lu
            l&apos;un de ces caractères, c&apos;est très probablement un{" "}
            <span className="font-mono font-semibold">Q</span>, un{" "}
            <span className="font-mono font-semibold">D</span>, un{" "}
            <span className="font-mono font-semibold">J</span> ou un{" "}
            <span className="font-mono font-semibold">7</span>.
          </Echec>
        ) : null}

        {introuvable ? (
          <Echec titre="Aucun certificat ne porte ce code">
            Vérifiez d&apos;abord la saisie. Si le code a bien été recopié
            depuis un document, ce document n&apos;a pas été délivré par Elite
            Academy.
          </Echec>
        ) : null}

        {/* ---------- Certificat rendu ---------- */}
        {resultat ? (
          <div className="mt-8">
            {/* Verdict d'abord, en pleine largeur : c'est la seule chose que
                certains visiteurs liront avant de refermer la page. */}
            <div
              role="status"
              className={`flex items-center gap-3 rounded-t-2xl px-5 py-3.5 ${
                valide ? "bg-emerald-600" : "bg-red-700"
              }`}
            >
              <span
                aria-hidden
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-base text-white"
              >
                {valide ? "✓" : "✕"}
              </span>
              <div className="min-w-0">
                <p className="font-display text-base font-semibold text-white">
                  {valide ? "Certificat authentique" : "Certificat révoqué"}
                </p>
                <p className="text-xs text-white/75">
                  {valide
                    ? "Délivré par Elite Academy et toujours valide."
                    : "Ce certificat a été retiré par l'organisation émettrice."}
                </p>
              </div>
            </div>

            {/* Le document lui-même. Un certificat révoqué reste affiché
                mais désaturé : masquer ses informations empêcherait de
                comprendre de quel document il s'agit. */}
            <div
              className={`rounded-b-2xl border-x-4 border-b-4 border-double bg-sand-50 p-6 shadow-2xl sm:p-8 ${
                valide ? "border-gold-400/70" : "border-slate-300 grayscale-[0.55]"
              }`}
            >
              <p className="text-center text-[10px] uppercase tracking-[0.3em] text-slate-400">
                Elite Academy
              </p>
              <p className="mt-3 text-center font-display text-lg font-semibold text-brand-800">
                {CERT_TYPE_LABELS[resultat.type_certificat]}
              </p>

              <p className="mt-6 text-center text-xs text-slate-500">décerné à</p>
              <p className="mt-1 text-center font-display text-2xl font-semibold text-ink-900 sm:text-3xl">
                {resultat.titulaire}
              </p>

              <div className="mx-auto mt-6 h-px w-24 bg-sand-200" />

              <dl className="mt-6">
                <LigneCertificat terme="Formation">{resultat.formation}</LigneCertificat>
                <LigneCertificat terme="Organisation">
                  {resultat.organisation}
                </LigneCertificat>
                {resultat.competence ? (
                  <LigneCertificat terme="Compétence">
                    {resultat.competence}
                  </LigneCertificat>
                ) : null}
                {resultat.niveau ? (
                  <LigneCertificat terme="Niveau">
                    {LEVEL_LABELS[resultat.niveau] ?? resultat.niveau}
                  </LigneCertificat>
                ) : null}
                <LigneCertificat terme="Délivré le">
                  {new Date(resultat.delivre_le).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </LigneCertificat>
                {resultat.revoque_le ? (
                  <LigneCertificat terme="Révoqué le">
                    <span className="text-red-700">
                      {new Date(resultat.revoque_le).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                  </LigneCertificat>
                ) : null}
              </dl>

              <p className="mt-6 text-center font-mono text-sm font-semibold tracking-[0.14em] text-slate-600">
                {code}
              </p>
            </div>
          </div>
        ) : null}

        {/* ---------- Bas de page ---------- */}
        <div className="mt-10 border-t border-white/10 pt-6 text-center">
          <p className="text-xs leading-relaxed text-white/40">
            Cette page n&apos;expose que les informations portées par le
            certificat lui-même. Aucun compte n&apos;est requis, aucune donnée
            n&apos;est conservée.
          </p>
          <p className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-white/60 transition duration-200 hover:text-white"
            >
              <span aria-hidden>←</span> Découvrir Elite Academy
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
