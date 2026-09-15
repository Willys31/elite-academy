import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  CERT_TYPE_LABELS,
  codeVerificationValide,
  normaliserCodeVerification,
} from "@/lib/certificats/certificats";
import { LEVEL_LABELS } from "@/lib/courses/statuts";
import { BASE_BOUTON, BOUTON_PRINCIPAL } from "@/components/ui";
import { Icone } from "@/components/icons";
import { Marque } from "@/components/Marque";

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

const FORMAT_DATE: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "long",
  year: "numeric",
};

/** Ligne d'un certificat rendu : libellé discret, valeur affirmée. */
function LigneCertificat({ terme, children }: { terme: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-slate-500">{terme}</dt>
      <dd className="min-w-0 text-sm font-medium text-ink-900">{children}</dd>
    </div>
  );
}

/** Encadré d'échec : format invalide, ou code inconnu de la base. */
function Echec({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <div role="alert" className="mt-6 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 sm:p-5">
      <Icone nom="croix" className="mt-0.5 size-5 shrink-0 text-red-600" />
      <div className="min-w-0">
        <p className="font-semibold text-red-900">{titre}</p>
        <p className="mt-1 text-sm leading-relaxed text-red-900/80">{children}</p>
      </div>
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
    <div className="min-h-dvh bg-sand-50">
      <header className="border-b border-sand-200 bg-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" className="rounded-lg transition-opacity duration-150 hover:opacity-80">
            <Marque />
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center rounded-lg px-2.5 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-sand-100 hover:text-ink-900"
          >
            Découvrir la plateforme
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6 sm:py-16">
        {/* ---------- Présentation ---------- */}
        <div className="text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-xl border border-sand-200 bg-white text-brand-700 shadow-[0_1px_2px_rgba(17,20,18,0.05)]">
            <Icone nom="bouclier" className="size-6" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.035em] text-ink-950 sm:text-[2.25rem]">
            Vérifier un certificat
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-slate-600">
            Saisissez le code figurant sur le certificat. La réponse est immédiate,
            publique, et ne demande aucun compte.
          </p>
        </div>

        {/* ---------- Saisie du code ---------- */}
        <form
          method="get"
          className="mt-8 rounded-xl border border-sand-200 bg-white p-4 shadow-[0_1px_2px_rgba(17,20,18,0.04)] sm:p-5"
        >
          <label htmlFor="code" className="mb-1.5 block text-sm font-medium text-ink-900">
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
            className="block min-h-14 w-full rounded-lg border border-sand-300 bg-white px-3 py-3 text-center font-mono text-base uppercase tracking-[0.1em] text-ink-900 shadow-[0_1px_2px_rgba(17,20,18,0.04)] outline-none transition duration-150 placeholder:text-slate-300 hover:border-slate-300 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15 sm:px-4 sm:text-xl sm:tracking-[0.16em]"
          />
          <button
            type="submit"
            className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} mt-3 min-h-12 w-full text-[15px]`}
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
            <span className="font-mono font-semibold">EA-XXXX-XXXX-XXXX</span>. Il
            n&apos;utilise jamais <span className="font-mono font-semibold">0</span>,{" "}
            <span className="font-mono font-semibold">1</span>,{" "}
            <span className="font-mono font-semibold">I</span>,{" "}
            <span className="font-mono font-semibold">L</span> ni{" "}
            <span className="font-mono font-semibold">O</span>, qui se confondent trop
            facilement à la lecture. Si vous avez lu l&apos;un de ces caractères, c&apos;est
            très probablement un <span className="font-mono font-semibold">Q</span>, un{" "}
            <span className="font-mono font-semibold">D</span>, un{" "}
            <span className="font-mono font-semibold">J</span> ou un{" "}
            <span className="font-mono font-semibold">7</span>.
          </Echec>
        ) : null}

        {introuvable ? (
          <Echec titre="Aucun certificat ne porte ce code">
            Vérifiez d&apos;abord la saisie. Si le code a bien été recopié depuis un
            document, ce document n&apos;a pas été délivré par Elite Academy.
          </Echec>
        ) : null}

        {/* ---------- Certificat rendu ---------- */}
        {resultat ? (
          <div className="mt-8 overflow-hidden rounded-xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.05),0_24px_48px_-28px_rgba(17,20,18,0.25)]">
            {/* Verdict d'abord, en pleine largeur : c'est la seule chose que
                certains visiteurs liront avant de refermer la page. */}
            <div
              role="status"
              className={`flex items-center gap-3 px-5 py-4 ${
                valide ? "bg-brand-700 text-white" : "bg-red-700 text-white"
              }`}
            >
              <Icone nom={valide ? "bouclier" : "croix"} className="size-6 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {valide ? "Certificat authentique" : "Certificat révoqué"}
                </p>
                <p className="text-sm text-white/80">
                  {valide
                    ? "Délivré par Elite Academy et toujours valide."
                    : "Ce certificat a été retiré par l'organisation émettrice."}
                </p>
              </div>
            </div>

            {/* Le document lui-même. Un certificat révoqué reste affiché
                mais désaturé : masquer ses informations empêcherait de
                comprendre de quel document il s'agit. */}
            <div className={`p-6 sm:p-8 ${valide ? "" : "grayscale-[0.6]"}`}>
              <p className="text-sm text-slate-500">
                {CERT_TYPE_LABELS[resultat.type_certificat]} décerné à
              </p>
              <p className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-ink-950 sm:text-3xl">
                {resultat.titulaire}
              </p>

              <dl className="mt-6 divide-y divide-sand-200 border-y border-sand-200">
                <LigneCertificat terme="Formation">{resultat.formation}</LigneCertificat>
                <LigneCertificat terme="Organisation">{resultat.organisation}</LigneCertificat>
                {resultat.competence ? (
                  <LigneCertificat terme="Compétence">{resultat.competence}</LigneCertificat>
                ) : null}
                {resultat.niveau ? (
                  <LigneCertificat terme="Niveau">
                    {LEVEL_LABELS[resultat.niveau] ?? resultat.niveau}
                  </LigneCertificat>
                ) : null}
                <LigneCertificat terme="Délivré le">
                  {new Date(resultat.delivre_le).toLocaleDateString("fr-FR", FORMAT_DATE)}
                </LigneCertificat>
                {resultat.revoque_le ? (
                  <LigneCertificat terme="Révoqué le">
                    <span className="text-red-700">
                      {new Date(resultat.revoque_le).toLocaleDateString("fr-FR", FORMAT_DATE)}
                    </span>
                  </LigneCertificat>
                ) : null}
              </dl>

              <p className="mt-5 font-mono text-sm font-semibold tracking-[0.12em] text-slate-600">
                {code}
              </p>
            </div>
          </div>
        ) : null}

        {/* ---------- Bas de page ---------- */}
        <p className="mt-10 text-center text-xs leading-relaxed text-slate-500">
          Cette page n&apos;expose que les informations portées par le certificat
          lui-même. Aucun compte n&apos;est requis, aucune donnée n&apos;est conservée.
        </p>
      </main>
    </div>
  );
}
