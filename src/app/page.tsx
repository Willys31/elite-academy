import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";
import { BASE_BOUTON, BOUTON_PRINCIPAL, BOUTON_SOBRE } from "@/components/ui";
import { Icone, type NomIcone } from "@/components/icons";
import { Marque } from "@/components/Marque";
import { Iphone } from "@/components/public/Iphone";
import { ReponsesEnDirect } from "@/components/public/ReponsesEnDirect";

export const metadata: Metadata = {
  title: "Elite Academy — La formation professionnelle qui se prouve",
  description:
    "Concevez, diffusez et certifiez des formations professionnelles dans tous les domaines : management, santé, banque, restauration… En ligne, en salle, ou les deux. Certificats vérifiables en ligne.",
};

const DOMAINES = [
  "Management",
  "Gestion de projet",
  "Ressources humaines",
  "Santé",
  "Banque",
  "Restauration",
  "Éducation",
  "Entrepreneuriat",
  "Télécommunications",
  "Compétences numériques",
  "Vente & retail",
  "Administration publique",
];

const ETAPES = [
  {
    titre: "Décrivez le besoin",
    texte:
      "« Former nos managers débutants à la gestion des conflits, avec des cas concrets. » Une phrase suffit : l'assistant conçoit un parcours complet — objectifs, compétences, modules, leçons — enregistré en brouillon.",
  },
  {
    titre: "Validez en équipe",
    texte:
      "Rien ne se publie tout seul. Vos experts relisent, corrigent, approuvent. Chaque décision est tracée, chaque contenu porte la signature d'une validation humaine.",
  },
  {
    titre: "Pratiquez, en ligne et en salle",
    texte:
      "Leçons, QCM corrigés avec explications, et ateliers présentiels sans papier : un code affiché en salle, les participants répondent depuis leur téléphone.",
  },
  {
    titre: "Prouvez les compétences",
    texte:
      "La maîtrise se mesure compétence par compétence, pas à la moyenne. Au bout : un certificat à code unique, que n'importe quel employeur peut vérifier en ligne.",
  },
];

const NIVEAUX = [
  { nom: "Fondamentaux", detail: "Comprendre et appliquer avec guidage" },
  { nom: "Opérationnel", detail: "Agir seul en situation courante" },
  { nom: "Avancé", detail: "Analyser et traiter la complexité" },
  { nom: "Elite", detail: "Maîtriser, améliorer, transmettre" },
];

const PUBLICS: Array<{
  icone: NomIcone;
  titre: string;
  accroche: string;
  points: string[];
}> = [
  {
    icone: "formation",
    titre: "Apprenants",
    accroche: "Un parcours qui s'adapte à vous",
    points: [
      "Progression visible, compétence par compétence",
      "QCM corrigés immédiatement, avec explications",
      "Seul votre meilleur résultat compte",
      "Vos certificats, imprimables et vérifiables",
    ],
  },
  {
    icone: "session",
    titre: "Formateurs",
    accroche: "La salle, sans les copies",
    points: [
      "Session ouverte en une minute, code et QR à l'écran",
      "Présences enregistrées automatiquement",
      "Réponses et statistiques en temps réel",
      "Résultats conservés pour le débriefing",
    ],
  },
  {
    icone: "organisation",
    titre: "Organisations",
    accroche: "Votre savoir-faire, protégé",
    points: [
      "Entreprises, écoles, institutions : chacun son espace",
      "Contenus internes isolés, jamais partagés",
      "Rôles précis : admin, concepteur, formateur, responsable",
      "Certificats délivrés sous votre autorité",
    ],
  },
];

/* ------------------------------------------------------------------
   Aperçus du produit (illustrations, données d'exemple)
   ------------------------------------------------------------------ */

function Crans({ rang, taille = "h-2 w-5" }: { rang: number; taille?: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      {[1, 2, 3, 4].map((cran) => (
        <span
          key={cran}
          className={`${taille} rounded-[3px] ${
            cran <= rang ? (cran === 4 ? "bg-gold-500" : "bg-brand-600") : "bg-sand-200"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Tableau de bord apprenant dans une fenêtre de navigateur. Reprend la
 * structure réelle de l'écran `/accueil` : ce qu'on voit ici est ce
 * qu'on obtient après inscription.
 */
function FenetreTableauDeBord() {
  const nav: Array<[NomIcone, string, boolean]> = [
    ["accueil", "Accueil", true],
    ["livre", "Catalogue", false],
    ["formation", "Mes formations", false],
    ["progression", "Ma progression", false],
    ["revision", "Ma révision", false],
    ["certificat", "Mes certificats", false],
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-sand-300/80 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.05),0_40px_80px_-32px_rgba(17,20,18,0.28)]">
      {/* Barre du navigateur */}
      <div className="flex items-center gap-3 border-b border-sand-200 bg-sand-100/70 px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-sand-300" />
          <span className="size-2.5 rounded-full bg-sand-300" />
          <span className="size-2.5 rounded-full bg-sand-300" />
        </span>
        <span className="mx-auto w-full max-w-xs truncate rounded-md border border-sand-200 bg-white px-3 py-1 text-center text-xs text-slate-500">
          elite-academy.app/accueil
        </span>
        <span className="w-[42px]" />
      </div>

      <div className="grid md:grid-cols-[200px_1fr]">
        {/* Barre latérale */}
        <div className="hidden border-r border-sand-200 p-3 md:block">
          <div className="px-2 py-2">
            <Marque className="[&_span]:text-[15px]" />
          </div>
          <ul className="mt-3 space-y-0.5">
            {nav.map(([icone, libelle, actif]) => (
              <li
                key={libelle}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium ${
                  actif ? "bg-brand-50 text-brand-800" : "text-slate-600"
                }`}
              >
                <Icone
                  nom={icone}
                  className={`size-4 ${actif ? "text-brand-700" : "text-slate-400"}`}
                />
                {libelle}
              </li>
            ))}
          </ul>
        </div>

        {/* Contenu */}
        <div className="bg-sand-50 p-5 sm:p-7">
          <p className="text-xs font-medium text-slate-500">Espace apprenant · Groupe Horizon</p>
          <p className="mt-0.5 text-xl font-semibold tracking-[-0.025em] text-ink-950">
            Bonjour Awa
          </p>

          <div className="mt-5 flex flex-col gap-4 rounded-lg bg-brand-900 p-5 text-white">
            <div className="min-w-0">
              <p className="text-xs font-medium text-brand-200">Reprendre où vous en étiez</p>
              <p className="mt-1 text-base font-semibold">Gestion des conflits en équipe</p>
              <div className="mt-3 h-1.5 w-56 max-w-full overflow-hidden rounded-full bg-white/15">
                <div className="h-full w-[64%] rounded-full bg-gold-400" />
              </div>
              <p className="mt-1.5 text-[11px] text-white/60">64 % des leçons terminées</p>
            </div>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-brand-900">
              Continuer
              <Icone nom="flecheDroite" className="size-3.5" epaisseur={2.25} />
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["En cours", "3"],
              ["Leçons", "27"],
              ["Compétences", "8"],
              ["Certificats", "2"],
            ].map(([libelle, valeur]) => (
              <div key={libelle} className="rounded-lg border border-sand-200 bg-white p-3">
                <p className="text-[11px] font-medium text-slate-500">{libelle}</p>
                <p className="mt-1 text-lg font-semibold tabular-nums tracking-tight text-ink-950">
                  {valeur}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-sand-200 bg-white p-4">
            <p className="text-[13px] font-semibold text-ink-900">Mes compétences</p>
            <ul className="mt-2 divide-y divide-sand-100">
              {[
                ["Communication en situation tendue", "Avancé", 3],
                ["Cadrage d'un désaccord", "Opérationnel", 2],
                ["Transmission des acquis", "Elite", 4],
              ].map(([nom, palier, rang]) => (
                <li key={nom} className="flex items-center justify-between gap-4 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13px] text-ink-900">{nom}</p>
                    <p className="text-[11px] text-slate-500">{palier}</p>
                  </div>
                  <Crans rang={rang as number} taille="h-1.5 w-4" />
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Écran participant d'un atelier, tel qu'il s'affiche sur un téléphone. */
function EcranParticipant() {
  return (
    <div className="flex h-full flex-col bg-sand-50 px-[7%] pt-[16%] text-ink-900">
      <p className="text-[10px] font-medium text-slate-500">Atelier en cours</p>
      <p className="mt-0.5 text-[13px] font-semibold leading-tight">Gestion des conflits</p>
      <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-brand-700">
        <Icone nom="coche" className="size-3" epaisseur={2.5} />
        Présence enregistrée à 09:12
      </p>

      <div className="mt-3 rounded-lg border border-sand-200 bg-white p-2.5">
        <p className="text-[9px] font-medium text-slate-500">Question 3 sur 5</p>
        <p className="mt-1 text-[11px] font-semibold leading-snug">
          Deux collaborateurs s&apos;opposent en réunion. Par quoi commencer ?
        </p>
        <ul className="mt-2.5 space-y-1.5">
          {[
            ["A", "Rappeler le règlement", false],
            ["B", "Écouter chaque partie", true],
            ["C", "Trancher rapidement", false],
            ["D", "Attendre", false],
          ].map(([lettre, texte, choisi]) => (
            <li
              key={lettre as string}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[10px] ${
                choisi
                  ? "border-brand-600 bg-brand-50 font-medium text-brand-900"
                  : "border-sand-200 text-slate-600"
              }`}
            >
              <span
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] ${
                  choisi ? "border-brand-600 bg-brand-600 text-white" : "border-sand-300"
                }`}
              >
                {choisi ? "✓" : ""}
              </span>
              {texte}
            </li>
          ))}
        </ul>
      </div>
      <span className="mt-2.5 rounded-md bg-brand-700 py-2 text-center text-[11px] font-semibold text-white">
        Valider ma réponse
      </span>
    </div>
  );
}

/** Certificat tel qu'il est délivré, avec son code de vérification. */
function DocumentCertificat() {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-2 shadow-[0_1px_2px_rgba(17,20,18,0.05),0_32px_64px_-32px_rgba(17,20,18,0.3)]">
      <div className="rounded-lg border border-sand-200 px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex items-center justify-between gap-4">
          <Marque className="[&_span]:text-[15px]" />
          <span className="text-xs text-slate-500">N° 2026-0412</span>
        </div>
        <p className="mt-10 text-sm text-slate-500">Certificat de réussite décerné à</p>
        <p className="mt-1 text-3xl font-semibold tracking-[-0.03em] text-ink-950">Awa Koné</p>
        <p className="mt-4 max-w-sm text-sm leading-relaxed text-slate-600">
          pour avoir validé le parcours{" "}
          <span className="font-medium text-ink-900">Gestion des conflits en équipe</span>, au
          niveau <span className="font-medium text-ink-900">Avancé</span>.
        </p>
        <div className="mt-10 flex flex-wrap items-end justify-between gap-4 border-t border-sand-200 pt-5">
          <div>
            <p className="text-[11px] text-slate-500">Code de vérification</p>
            <p className="mt-0.5 font-mono text-sm font-semibold tracking-[0.1em] text-ink-900">
              EA-7K2M-4XQ9-VB3D
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700 ring-1 ring-inset ring-brand-200">
            <Icone nom="bouclier" className="size-3.5" />
            Authentique
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
   Page
   ------------------------------------------------------------------ */

export default async function PageAccueilPublique() {
  const user = await getCurrentUser();
  if (user) redirect("/accueil");

  return (
    <div className="bg-sand-50 text-ink-900">
      {/* ---------- En-tête ---------- */}
      <header className="sticky top-0 z-30 border-b border-sand-200/80 bg-sand-50/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="Elite Academy, accueil" className="rounded-lg">
            {/* Sous 640 px, le monogramme seul laisse la place aux deux
                actions : « Créer un compte » doit toujours rester entier. */}
            <span className="sm:hidden">
              <Marque texte={false} />
            </span>
            <span className="hidden sm:inline-flex">
              <Marque />
            </span>
          </Link>

          <nav aria-label="Sections de la page" className="hidden items-center gap-1 lg:flex">
            {[
              ["#methode", "Méthode"],
              ["#en-salle", "En salle"],
              ["#certificats", "Certificats"],
              ["/verifier", "Vérifier un certificat"],
            ].map(([href, libelle]) => (
              <Link
                key={href}
                href={href}
                className="rounded-md px-3 py-2 text-sm text-slate-600 transition-colors duration-150 hover:text-ink-900"
              >
                {libelle}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-1 sm:gap-2">
            <Link
              href="/connexion"
              className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink-900 transition-colors duration-150 hover:bg-sand-100"
            >
              Connexion
            </Link>
            <Link href="/inscription" className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} px-3.5`}>
              Créer un compte
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ---------- Héros ---------- */}
        <section className="overflow-hidden border-b border-sand-200">
          <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20 lg:pt-24">
            <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:gap-16">
              <div>
                <p className="lever text-sm font-medium text-brand-700">
                  Formation professionnelle · en ligne et en salle
                </p>
                <h1
                  className="lever mt-4 text-[2.6rem] font-semibold leading-[1.02] tracking-[-0.04em] text-ink-950 sm:text-6xl lg:text-[4.25rem]"
                  style={{ animationDelay: "0.06s" }}
                >
                  La formation professionnelle qui se prouve.
                </h1>
              </div>
              <div className="lg:pb-1.5">
                <p
                  className="lever text-lg leading-relaxed text-slate-600"
                  style={{ animationDelay: "0.12s" }}
                >
                  Elite Academy transforme un besoin exprimé en une phrase en un parcours
                  structuré, pratiqué en ligne comme en salle, mesuré compétence par
                  compétence — et conclu par un certificat que chacun peut vérifier.
                </p>
                <div
                  className="lever mt-7 flex flex-wrap gap-3"
                  style={{ animationDelay: "0.18s" }}
                >
                  <Link
                    href="/inscription"
                    className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} min-h-12 px-5 text-[15px]`}
                  >
                    Créer un compte
                    <Icone nom="flecheDroite" className="size-4" epaisseur={2.25} />
                  </Link>
                  <Link
                    href="/verifier"
                    className={`${BASE_BOUTON} ${BOUTON_SOBRE} min-h-12 px-5 text-[15px]`}
                  >
                    Vérifier un certificat
                  </Link>
                </div>
              </div>
            </div>

            {/* Aperçu du produit. `aria-hidden` : ce sont des données
                d'exemple qui reprennent l'argument déjà écrit plus haut. */}
            <div
              aria-hidden
              className="lever relative mx-auto mt-14 max-w-5xl pb-16 sm:mt-16 sm:pb-32"
              style={{ animationDelay: "0.26s" }}
            >
              <div className="hidden sm:block sm:pr-28 lg:pr-32">
                <FenetreTableauDeBord />
              </div>
              {/* Le téléphone déborde sous la fenêtre : il couvre la liste des
                  compétences, jamais le bouton ni les chiffres. */}
              <div className="mx-auto w-[220px] sm:absolute sm:bottom-6 sm:right-0 sm:w-[200px] lg:w-[230px]">
                <Iphone className="drop-shadow-[0_30px_40px_rgba(17,20,18,0.3)]">
                  <EcranParticipant />
                </Iphone>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Domaines ---------- */}
        <section className="border-b border-sand-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:gap-10">
            <p className="shrink-0 text-sm font-medium text-slate-500">
              Conçu pour tous les métiers
            </p>
            <ul className="flex flex-wrap gap-2">
              {DOMAINES.map((d) => (
                <li
                  key={d}
                  className="rounded-md border border-sand-200 bg-sand-50 px-2.5 py-1 text-sm text-slate-700"
                >
                  {d}
                </li>
              ))}
              <li className="rounded-md border border-dashed border-sand-300 px-2.5 py-1 text-sm text-slate-500">
                et le vôtre
              </li>
            </ul>
          </div>
        </section>

        {/* ---------- Trois publics ---------- */}
        <section className="bg-sand-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
            <h2 className="reveal max-w-xl text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-950 sm:text-[2.5rem]">
              Chacun son écran, tous la même exigence.
            </h2>
            <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-sand-200">
              {PUBLICS.map((p, i) => (
                <article
                  key={p.titre}
                  className={`reveal ${i === 0 ? "md:pr-8" : i === 1 ? "md:px-8" : "md:pl-8"}`}
                >
                  <span className="flex size-10 items-center justify-center rounded-lg border border-sand-200 bg-white text-brand-700 shadow-[0_1px_2px_rgba(17,20,18,0.05)]">
                    <Icone nom={p.icone} className="size-5" />
                  </span>
                  <p className="mt-5 text-sm font-medium text-slate-500">{p.titre}</p>
                  <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink-950">
                    {p.accroche}
                  </h3>
                  <ul className="mt-5 space-y-2.5">
                    {p.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-[15px] text-slate-600">
                        <Icone
                          nom="coche"
                          className="mt-[3px] size-4 shrink-0 text-brand-600"
                          epaisseur={2.25}
                        />
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Méthode ---------- */}
        <section id="methode" className="border-y border-sand-200 bg-white">
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
            <div className="reveal lg:sticky lg:top-28 lg:self-start">
              <p className="text-sm font-medium text-brand-700">Méthode</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-950 sm:text-[2.5rem]">
                Du besoin exprimé au certificat vérifié.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-600">
                L&apos;intelligence artificielle propose, vos experts disposent. Aucun
                contenu ne se publie sans validation humaine — c&apos;est une règle de la
                plateforme, pas une option.
              </p>
            </div>

            <ol className="border-b border-sand-200">
              {ETAPES.map((etape, i) => (
                <li
                  key={etape.titre}
                  className="reveal grid gap-2 border-t border-sand-200 py-7 sm:grid-cols-[4rem_1fr] sm:gap-4"
                >
                  <span className="text-sm font-medium tabular-nums text-slate-400">
                    Étape {i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-semibold tracking-[-0.015em] text-ink-950">
                      {etape.titre}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
                      {etape.texte}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- En salle ---------- */}
        <section id="en-salle" className="bg-sand-50">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16">
            <div className="reveal">
              <p className="text-sm font-medium text-brand-700">Ateliers présentiels</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-950 sm:text-[2.5rem]">
                La salle, sans les copies.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-600">
                Le formateur ouvre une session et affiche son code. Les participants
                rejoignent depuis leur téléphone, répondent, et les résultats arrivent à
                l&apos;écran pendant qu&apos;ils répondent.
              </p>
              <ul className="mt-8 space-y-5">
                {(
                  [
                    ["qrcode", "Un code et un QR à l'écran", "Pas d'application à installer, pas de compte à créer sur place."],
                    ["validation", "Présences enregistrées d'elles-mêmes", "Rejoindre la session vaut émargement, à l'heure près."],
                    ["graphique", "Résultats en direct, puis conservés", "La répartition des réponses guide le débriefing et reste consultable."],
                  ] as Array<[NomIcone, string, string]>
                ).map(([icone, titre, texte]) => (
                  <li key={titre} className="flex gap-4">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-sand-200 bg-white text-brand-700">
                      <Icone nom={icone} className="size-[18px]" />
                    </span>
                    <div>
                      <p className="font-medium text-ink-900">{titre}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{texte}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div aria-hidden className="reveal">
              <ReponsesEnDirect />
            </div>
          </div>
        </section>

        {/* ---------- Niveaux ---------- */}
        <section className="border-y border-sand-200 bg-white">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
            <div className="reveal">
              <p className="text-sm font-medium text-brand-700">Niveaux de maîtrise</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-950 sm:text-[2.5rem]">
                Pas de moyenne générale. Des compétences, une à une.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-600">
                On peut être Avancé en communication et Fondamentaux en gestion des
                conflits. La plateforme mesure chaque compétence séparément, sur quatre
                niveaux — et le dernier ne s&apos;automatise pas.
              </p>
            </div>

            <ol className="reveal divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(17,20,18,0.04)]">
              {NIVEAUX.map((n, i) => (
                <li key={n.nom} className="flex items-center gap-4 px-5 py-4">
                  <Crans rang={i + 1} />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink-900">{n.nom}</p>
                    <p className="text-sm text-slate-500">{n.detail}</p>
                  </div>
                  {i === 3 ? (
                    <span className="hidden shrink-0 rounded-md bg-gold-300/25 px-2 py-0.5 text-xs font-medium text-gold-600 ring-1 ring-inset ring-gold-400/40 xs:inline">
                      Validé par un humain
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Certificats ---------- */}
        <section id="certificats" className="bg-sand-50">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.05fr] lg:gap-16">
            <div className="reveal">
              <p className="text-sm font-medium text-brand-700">Certificats vérifiables</p>
              <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-[-0.035em] text-ink-950 sm:text-[2.5rem]">
                Un code, dix secondes, aucun compte.
              </h2>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-slate-600">
                Chaque certificat porte un code unique et un QR code. Un recruteur, un
                client ou un partenaire le saisit ici et sait immédiatement si le document
                est authentique, et s&apos;il est toujours valide.
              </p>

              {/* Vrai formulaire : il mène au résultat, pas à une page de plus. */}
              <form action="/verifier" method="get" className="mt-8 max-w-md">
                <label htmlFor="code-accueil" className="text-sm font-medium text-ink-900">
                  Code de vérification
                </label>
                <div className="mt-1.5 flex flex-col gap-2 xs:flex-row">
                  <input
                    id="code-accueil"
                    name="code"
                    placeholder="EA-XXXX-XXXX-XXXX"
                    autoComplete="off"
                    spellCheck={false}
                    className="block min-h-11 w-full min-w-0 rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 font-mono text-base uppercase tracking-[0.06em] text-ink-900 shadow-[0_1px_2px_rgba(17,20,18,0.04)] outline-none transition duration-150 placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-600 focus:ring-4 focus:ring-brand-600/15 sm:text-sm"
                  />
                  <button type="submit" className={`${BASE_BOUTON} ${BOUTON_PRINCIPAL} shrink-0`}>
                    Vérifier
                  </button>
                </div>
              </form>
            </div>

            <div aria-hidden className="reveal">
              <DocumentCertificat />
            </div>
          </div>
        </section>

        {/* ---------- Appel final ---------- */}
        <section className="bg-sand-50 px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="reveal mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-2xl bg-brand-900 px-6 py-12 text-white sm:px-12 sm:py-14 lg:flex-row lg:items-center">
            <div>
              <h2 className="text-3xl font-semibold leading-tight tracking-[-0.035em] sm:text-4xl">
                Prêt à former autrement ?
              </h2>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-white/70">
                Créez votre compte, décrivez votre premier besoin de formation, et jugez sur
                pièce.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/inscription"
                className={`${BASE_BOUTON} min-h-12 bg-white px-5 text-[15px] text-brand-900 hover:bg-brand-50 focus-visible:ring-white focus-visible:ring-offset-brand-900`}
              >
                Créer un compte
              </Link>
              <Link
                href="/connexion"
                className={`${BASE_BOUTON} min-h-12 border border-white/25 px-5 text-[15px] font-medium text-white hover:border-white/50 hover:bg-white/5 focus-visible:ring-white focus-visible:ring-offset-brand-900`}
              >
                Se connecter
              </Link>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Pied de page ---------- */}
      <footer className="border-t border-sand-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Marque />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-600">
              La plateforme éducative d&apos;Elite Experience : concevoir, diffuser et
              certifier des formations professionnelles multi-domaines.
            </p>
          </div>

          <nav aria-label="Plateforme">
            <p className="text-sm font-medium text-ink-900">Plateforme</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              {[
                ["/inscription", "Créer un compte"],
                ["/connexion", "Connexion"],
                ["/verifier", "Vérifier un certificat"],
              ].map(([href, libelle]) => (
                <li key={href}>
                  <Link href={href} className="transition-colors duration-150 hover:text-ink-900">
                    {libelle}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="text-sm font-medium text-ink-900">Elite Experience</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Abidjan, Côte d&apos;Ivoire
              <br />
              Formation professionnelle multi-domaines
            </p>
          </div>
        </div>
        <div className="border-t border-sand-200">
          <p className="mx-auto max-w-6xl px-4 py-5 text-xs text-slate-500 sm:px-6">
            © {new Date().getFullYear()} Elite Experience — Abidjan, Côte d&apos;Ivoire
          </p>
        </div>
      </footer>
    </div>
  );
}
