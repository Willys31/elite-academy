import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/profile";

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

/**
 * Aperçu affiché dans le héros. Trois compétences d'un même parcours,
 * à trois niveaux différents : c'est la démonstration visuelle de
 * l'argument « pas de moyenne générale », posée dès le premier écran.
 */
const APERCU_COMPETENCES = [
  { nom: "Communication en situation tendue", niveau: 3, palier: "Avancé" },
  { nom: "Cadrage d'un désaccord", niveau: 2, palier: "Opérationnel" },
  { nom: "Transmission des acquis", niveau: 4, palier: "Elite" },
];

const ACTES = [
  {
    numero: "01",
    titre: "Décrivez le besoin",
    texte:
      "« Former nos managers débutants à la gestion des conflits, avec des cas concrets. » Une phrase suffit : l'assistant conçoit un parcours complet — objectifs, compétences, modules, leçons — enregistré en brouillon.",
  },
  {
    numero: "02",
    titre: "Validez en équipe",
    texte:
      "Rien ne se publie tout seul. Vos experts relisent, corrigent, approuvent. Chaque décision est tracée, chaque contenu porte la signature d'une validation humaine.",
  },
  {
    numero: "03",
    titre: "Pratiquez, en ligne et en salle",
    texte:
      "Leçons, QCM corrigés avec feedback, et ateliers présentiels sans papier : un code affiché en salle, les participants répondent depuis leur téléphone, le formateur voit les résultats en direct.",
  },
  {
    numero: "04",
    titre: "Prouvez les compétences",
    texte:
      "La maîtrise se mesure compétence par compétence, pas à la moyenne. Au bout : un certificat à code unique, que n'importe quel employeur peut vérifier en ligne, sans compte.",
  },
];

const NIVEAUX = [
  { nom: "Fondamentaux", detail: "comprendre et appliquer avec guidage" },
  { nom: "Opérationnel", detail: "agir seul en situation courante" },
  { nom: "Avancé", detail: "analyser et traiter la complexité" },
  { nom: "Elite", detail: "maîtriser, améliorer, transmettre" },
];

const PUBLICS = [
  {
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
    titre: "Formateurs",
    accroche: "La salle, sans les copies",
    points: [
      "Session ouverte en une minute, code et QR à l'écran",
      "Présences enregistrées automatiquement",
      "Réponses et statistiques en temps réel",
      "Résultats conservés, prêts pour le débriefing",
    ],
  },
  {
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

/**
 * Jauge de maîtrise à quatre crans. Les crans atteints sont en or,
 * les autres restent en creux : la lecture se fait d'un coup d'œil,
 * sans pourcentage ni légende.
 */
function JaugeNiveau({ niveau }: { niveau: number }) {
  return (
    <span aria-hidden className="flex shrink-0 gap-1">
      {[1, 2, 3, 4].map((cran) => (
        <span
          key={cran}
          className={`h-1.5 w-5 rounded-full ${
            cran <= niveau ? "bg-gold-400" : "bg-white/15"
          }`}
        />
      ))}
    </span>
  );
}

export default async function PageAccueilPublique() {
  const user = await getCurrentUser();
  if (user) redirect("/accueil");

  return (
    <div className="bg-sand-50 text-slate-900">
      {/* ---------- En-tête ---------- */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-950/90 backdrop-blur">
        {/* Marque + trois actions ne tiennent sur une seule ligne qu'à partir
            de 640 px. En dessous, l'en-tête tient deux rangées centrées : la
            marque, puis les actions. C'est la seule mise en page qui garde le
            bouton « Créer un compte » entier — auparavant il sortait de
            l'écran entre 400 et 480 px. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-2 gap-y-1 px-4 py-2.5 sm:flex-nowrap sm:justify-between sm:gap-3 sm:px-6 sm:py-3">
          <Link
            href="/"
            className="flex w-full shrink-0 items-baseline justify-center gap-2 sm:w-auto sm:justify-start"
          >
            <span className="whitespace-nowrap font-display text-lg font-semibold tracking-tight text-white transition duration-200 hover:text-gold-300 sm:text-xl">
              Elite Academy
            </span>
            <span className="hidden text-[11px] uppercase tracking-[0.2em] text-white/50 lg:inline">
              par Elite Experience
            </span>
          </Link>
          <nav className="flex w-full shrink-0 items-center justify-center gap-1 pb-1 sm:w-auto sm:gap-3 sm:pb-0">
            {/* La vérification reste accessible sur téléphone : c'est
                justement là qu'un recruteur ouvre un lien de certificat.
                Seuls les libellés se raccourcissent. */}
            <Link
              href="/verifier"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2 py-2 text-sm text-white/70 transition duration-200 hover:bg-white/5 hover:text-white sm:px-3"
            >
              <span className="lg:hidden">Vérifier</span>
              <span className="hidden lg:inline">Vérifier un certificat</span>
            </Link>
            <Link
              href="/connexion"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium text-white/90 transition duration-200 hover:bg-white/10 sm:px-3"
            >
              <span className="sm:hidden">Connexion</span>
              <span className="hidden sm:inline">Se connecter</span>
            </Link>
            <Link
              href="/inscription"
              className="inline-flex min-h-11 items-center whitespace-nowrap rounded-lg bg-gold-400 px-3 py-2 text-sm font-semibold text-ink-950 transition duration-200 hover:bg-gold-300 hover:shadow-[0_8px_20px_-8px_rgba(211,160,50,0.8)] active:translate-y-px sm:px-4"
            >
              <span className="sm:hidden">S&apos;inscrire</span>
              <span className="hidden sm:inline">Créer un compte</span>
            </Link>
          </nav>
        </div>
      </header>

      <main>
        {/* ---------- Héros ---------- */}
        <section className="relative overflow-hidden bg-ink-950 text-white">
          {/* halos discrets */}
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full bg-brand-700/30 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-[-30%] left-[-10%] h-[420px] w-[420px] rounded-full bg-gold-500/10 blur-3xl"
          />

          <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-20">
            <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
              {/* Colonne de gauche : la promesse */}
              <div>
                <p
                  className="lever text-xs font-medium uppercase tracking-[0.28em] text-gold-300"
                  style={{ animationDelay: "0.05s" }}
                >
                  Formation professionnelle · Abidjan → Afrique
                </p>

                <h1
                  /* Trois tailles, choisies pour que « Le savoir se transmet. »
                     tienne toujours sur une ligne dans la colonne de gauche :
                     48 px suffisent tant que l'aperçu occupe la droite, 52 px
                     seulement à partir de 1280 px où la colonne s'élargit. */
                  className="lever mt-5 font-display text-[2.15rem] font-semibold leading-[1.08] tracking-tight sm:mt-6 sm:text-5xl xl:text-[3.25rem]"
                  style={{ animationDelay: "0.15s" }}
                >
                  Le savoir se transmet.
                  <br />
                  La compétence,{" "}
                  <em className="font-display italic text-gold-300">
                    elle se prouve.
                  </em>
                </h1>

                <p
                  className="lever mt-5 max-w-xl text-base leading-relaxed text-white/70 sm:mt-6 sm:text-lg"
                  style={{ animationDelay: "0.25s" }}
                >
                  Elite Academy transforme un besoin exprimé en une phrase en un
                  parcours de formation structuré, pratiqué en ligne comme en
                  salle, mesuré compétence par compétence — et conclu par un
                  certificat que chacun peut vérifier.
                </p>

                <div
                  className="lever mt-8 flex flex-wrap items-center gap-3"
                  style={{ animationDelay: "0.35s" }}
                >
                  <Link
                    href="/inscription"
                    className="inline-flex min-h-12 items-center rounded-xl bg-gold-400 px-6 py-3 text-sm font-semibold text-ink-950 shadow-[0_10px_30px_-10px_rgba(211,160,50,0.8)] transition duration-200 hover:bg-gold-300 hover:shadow-[0_14px_36px_-10px_rgba(211,160,50,0.9)] active:translate-y-px"
                  >
                    Créer un compte gratuitement
                  </Link>
                  <Link
                    href="/verifier"
                    className="inline-flex min-h-12 items-center rounded-xl border border-white/25 px-6 py-3 text-sm font-medium text-white transition duration-200 hover:border-white/50 hover:bg-white/5"
                  >
                    Vérifier un certificat
                  </Link>
                </div>
              </div>

              {/* Colonne de droite : l'aperçu du produit.
                  `aria-hidden` : c'est une illustration composée de données
                  d'exemple, elle n'apporte rien à un lecteur d'écran et
                  reprendrait mot pour mot l'argument déjà écrit à gauche. */}
              {/* Le bas de la colonne est réservé à la vignette du certificat,
                  qui déborde sous la carte : sans cette réserve, elle
                  recouvrirait la dernière ligne de la carte. */}
              {/* Masqué sous `lg` : là, l'aperçu ne tient plus à côté du texte,
                  il s'empile dessous et repousse le bouton d'inscription hors
                  de l'écran. Sur téléphone, la promesse et l'action priment. */}
              <div
                aria-hidden
                className="lever relative hidden pb-28 lg:block"
                style={{ animationDelay: "0.45s" }}
              >
                {/* Carte de progression, au premier plan */}
                <div className="relative rounded-2xl border border-white/10 bg-white/[0.06] p-5 shadow-2xl backdrop-blur-sm sm:p-6">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-white/40">
                      Progression
                    </p>
                    <p className="truncate text-xs text-white/50">
                      Gestion des conflits
                    </p>
                  </div>

                  <ul className="mt-5 space-y-4">
                    {APERCU_COMPETENCES.map((c) => (
                      <li key={c.nom}>
                        <div className="flex items-center justify-between gap-3">
                          <p className="min-w-0 truncate text-sm text-white/85">
                            {c.nom}
                          </p>
                          <JaugeNiveau niveau={c.niveau} />
                        </div>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-gold-300/70">
                          {c.palier}
                        </p>
                      </li>
                    ))}
                  </ul>

                </div>

                {/* Certificat en second plan, débordant sous la carte */}
                <div className="absolute bottom-0 right-2 w-48 rotate-6 rounded-lg border-[3px] border-double border-gold-400/70 bg-sand-50 p-4 text-center shadow-2xl sm:right-4 sm:w-56">
                  <p className="text-[8px] uppercase tracking-[0.28em] text-slate-400">
                    Elite Academy
                  </p>
                  <p className="mt-1.5 font-display text-sm font-semibold text-brand-800">
                    Certificat de réussite
                  </p>
                  <div className="mx-auto mt-2.5 h-px w-14 bg-sand-200" />
                  {/* Code d'exemple conforme à l'alphabet réel des codes de
                      vérification : ni 0, ni 1, ni I, L ou O — ces caractères
                      sont exclus parce qu'ils se confondent à la lecture. */}
                  <p className="mt-2.5 font-mono text-[11px] font-semibold tracking-[0.12em] text-slate-600">
                    EA-7K2M-4XQ9-VB3D
                  </p>
                </div>
              </div>
            </div>

            {/* Bandeau factuel */}
            <dl
              /* Deux colonnes jusqu'à 1024 px : sur tablette, quatre colonnes
                 cassaient « 12 domaines » et « 100 % vérifiables » en deux
                 lignes chacun, ce qui rendait le bandeau illisible. */
              className="lever mt-14 grid grid-cols-2 gap-x-6 gap-y-8 border-t border-white/10 pt-8 lg:grid-cols-4"
              style={{ animationDelay: "0.55s" }}
            >
              {[
                ["4 niveaux", "de maîtrise, par compétence"],
                ["12 domaines", "et aucun modèle imposé"],
                ["0 papier", "en atelier : QR code et direct"],
                ["100 % vérifiables", "certificats à code unique"],
              ].map(([chiffre, legende]) => (
                <div key={chiffre}>
                  <dt className="font-display text-2xl font-semibold text-white sm:text-3xl">
                    {chiffre}
                  </dt>
                  <dd className="mt-1 text-sm text-white/55">{legende}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ---------- Domaines ---------- */}
        <section className="relative border-b border-sand-200 bg-sand-50 grain">
          <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
            <div className="reveal grid items-start gap-10 lg:grid-cols-[1fr_1.4fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-700">
                  Multi-domaines par conception
                </p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  La santé n&apos;est pas la vente.
                  <br />
                  La banque n&apos;est pas le retail.
                </h2>
                <p className="mt-4 text-slate-600">
                  Chaque sujet reçoit les méthodes pédagogiques qui lui
                  conviennent — jamais un gabarit commercial plaqué sur un
                  métier qui n&apos;en veut pas.
                </p>
              </div>
              {/* Tous les domaines ont le même poids : en souligner
                  arbitrairement quelques-uns laissait croire à une
                  hiérarchie qui n'existe pas. */}
              <ul className="flex flex-wrap gap-2.5 pt-2">
                {DOMAINES.map((d) => (
                  <li
                    key={d}
                    className="rounded-full border border-sand-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition duration-200 hover:-translate-y-0.5 hover:border-gold-400 hover:text-ink-900 hover:shadow-[0_6px_16px_-8px_rgba(12,16,43,0.35)]"
                  >
                    {d}
                  </li>
                ))}
                <li className="rounded-full border border-dashed border-slate-300 px-4 py-2 text-sm text-slate-400">
                  … et le vôtre
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* ---------- Le parcours en quatre actes ---------- */}
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
            <div className="reveal">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-700">
                Du besoin à la preuve
              </p>
              <h2 className="mt-3 max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                Quatre actes, une méthode.
              </h2>
            </div>

            {/* Deux colonnes seulement à partir de 768 px : à 640, chaque acte
                n'avait plus que ~250 px utiles une fois le numéro déduit. */}
            <ol className="mt-10 grid gap-x-10 gap-y-10 sm:mt-12 md:grid-cols-2 md:gap-y-12">
              {ACTES.map((acte) => (
                <li key={acte.numero} className="reveal relative pl-16">
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 font-display text-4xl font-semibold text-sand-200"
                  >
                    {acte.numero}
                  </span>
                  <h3 className="font-display text-xl font-semibold">
                    {acte.titre}
                  </h3>
                  <p className="mt-2 leading-relaxed text-slate-600">
                    {acte.texte}
                  </p>
                </li>
              ))}
            </ol>

            <p className="reveal mt-10 border-l-2 border-gold-400 pl-4 text-sm text-slate-500 sm:mt-12">
              L&apos;intelligence artificielle propose. Vos experts disposent.
              Aucun contenu ne se publie sans validation humaine — c&apos;est
              une règle de la plateforme, pas une option.
            </p>
          </div>
        </section>

        {/* ---------- Trois publics ---------- */}
        <section className="relative border-y border-sand-200 bg-sand-50 grain">
          <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
            <h2 className="reveal max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Chacun son écran,
              <br />
              tous la même exigence.
            </h2>
            <div className="mt-10 grid gap-6 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
              {PUBLICS.map((p) => (
                <article
                  key={p.titre}
                  className="reveal rounded-2xl border border-sand-200 bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 hover:border-gold-400/60 hover:shadow-[0_18px_40px_-20px_rgba(12,16,43,0.45)]"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-700">
                    {p.titre}
                  </p>
                  <h3 className="mt-2 font-display text-xl font-semibold">
                    {p.accroche}
                  </h3>
                  <ul className="mt-4 space-y-2.5">
                    {p.points.map((point) => (
                      <li key={point} className="flex gap-2.5 text-sm text-slate-600">
                        <span aria-hidden className="mt-0.5 text-gold-500">
                          ◆
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- Niveaux ---------- */}
        <section className="bg-white">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
            <div className="reveal grid items-center gap-10 lg:grid-cols-[1fr_1.2fr]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-brand-700">
                  Niveaux de maîtrise
                </p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  Pas de moyenne générale.
                  <br />
                  Des compétences, une à une.
                </h2>
                <p className="mt-4 text-slate-600">
                  On peut être Avancé en communication et Fondamentaux en
                  gestion des conflits. La plateforme mesure chaque compétence
                  séparément, sur quatre niveaux — et le dernier ne
                  s&apos;automatise pas.
                </p>
              </div>
              <ol className="space-y-3">
                {NIVEAUX.map((n, i) => (
                  <li
                    key={n.nom}
                    className={`flex items-center gap-4 rounded-xl border p-4 transition duration-200 hover:translate-x-1 ${
                      i === 3
                        ? "border-gold-400 bg-gold-300/10"
                        : "border-sand-200 bg-sand-50"
                    }`}
                  >
                    <span
                      className={`font-display text-lg font-semibold ${
                        i === 3 ? "text-gold-600" : "text-brand-700"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold">{n.nom}</p>
                      <p className="text-sm text-slate-500">{n.detail}</p>
                    </div>
                    {i === 3 ? (
                      <span className="ml-auto shrink-0 rounded-full bg-gold-400 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-950">
                        validation humaine
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ---------- Certificat ---------- */}
        <section className="relative overflow-hidden bg-ink-950 text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 right-[-8%] h-[380px] w-[380px] rounded-full bg-gold-500/10 blur-3xl"
          />
          <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-24">
            <div className="reveal grid items-center gap-12 lg:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-gold-300">
                  Certificats vérifiables
                </p>
                <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  Un code. N&apos;importe qui.
                  <br />
                  En dix secondes.
                </h2>
                <p className="mt-4 max-w-md text-white/70">
                  Chaque certificat porte un code unique et un QR code. Un
                  recruteur, un client, un partenaire le saisit sur la page de
                  vérification — sans compte — et sait immédiatement si le
                  document est authentique, et s&apos;il est toujours valide.
                </p>
                <Link
                  href="/verifier"
                  className="group mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-gold-300 transition duration-200 hover:text-gold-400"
                >
                  Essayer la page de vérification
                  <span
                    aria-hidden
                    className="transition-transform duration-200 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </Link>
              </div>

              {/* Maquette de certificat */}
              <div
                aria-hidden
                className="mx-auto w-full max-w-sm rotate-1 transition duration-500 hover:rotate-0 hover:scale-[1.02]"
              >
                <div className="rounded-xl border-4 border-double border-gold-400/70 bg-sand-50 p-8 text-center text-slate-900 shadow-2xl">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">
                    Elite Academy
                  </p>
                  <p className="mt-3 font-display text-lg font-semibold text-brand-800">
                    Certificat de réussite
                  </p>
                  <p className="mt-4 text-xs text-slate-500">décerné à</p>
                  <p className="font-display text-xl">— votre nom —</p>
                  <div className="mx-auto mt-5 h-px w-24 bg-sand-200" />
                  <p className="mt-4 font-mono text-sm font-semibold tracking-wider text-slate-700">
                    EA-XXXX-XXXX-XXXX
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    vérifiable en ligne · sans compte
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- Appel final ---------- */}
        <section className="relative bg-sand-50 grain">
          <div className="relative mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-24">
            <div className="reveal">
              <h2 className="mx-auto max-w-2xl font-display text-3xl font-semibold tracking-tight sm:text-5xl">
                Prêt à former{" "}
                <em className="italic text-brand-700">autrement</em> ?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-slate-600">
                Créez votre compte, décrivez votre premier besoin de formation,
                et jugez sur pièce.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                {/* L'action principale porte la même couleur qu'en haut de
                    page : l'or est la couleur d'action du site, l'encre
                    celle des surfaces. */}
                <Link
                  href="/inscription"
                  className="inline-flex min-h-12 items-center rounded-xl bg-gold-400 px-7 py-3 text-sm font-semibold text-ink-950 shadow-[0_10px_30px_-10px_rgba(211,160,50,0.8)] transition duration-200 hover:bg-gold-300 hover:shadow-[0_14px_36px_-10px_rgba(211,160,50,0.9)] active:translate-y-px"
                >
                  Créer un compte
                </Link>
                <Link
                  href="/connexion"
                  className="inline-flex min-h-12 items-center rounded-xl border border-sand-200 bg-white px-7 py-3 text-sm font-medium text-slate-700 transition duration-200 hover:border-slate-300 hover:bg-white"
                >
                  Se connecter
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- Pied de page ---------- */}
      <footer className="border-t border-white/10 bg-ink-950 text-white/60">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <p className="font-display text-lg font-semibold text-white">
              Elite Academy
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed">
              La plateforme éducative d&apos;Elite Experience : concevoir,
              diffuser et certifier des formations professionnelles
              multi-domaines.
            </p>
          </div>

          <nav aria-label="Plateforme">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
              Plateforme
            </p>
            <ul className="mt-3 space-y-2 text-sm">
              <li>
                <Link href="/inscription" className="transition duration-200 hover:text-white">
                  Créer un compte
                </Link>
              </li>
              <li>
                <Link href="/connexion" className="transition duration-200 hover:text-white">
                  Connexion
                </Link>
              </li>
              <li>
                <Link href="/verifier" className="transition duration-200 hover:text-white">
                  Vérifier un certificat
                </Link>
              </li>
            </ul>
          </nav>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/35">
              Elite Experience
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Abidjan, Côte d&apos;Ivoire
              <br />
              Formation professionnelle
              <br />
              multi-domaines
            </p>
          </div>
        </div>
        <div className="border-t border-white/10 py-4 text-center text-xs text-white/40">
          © {new Date().getFullYear()} Elite Experience — Abidjan, Côte d&apos;Ivoire
        </div>
      </footer>
    </div>
  );
}
