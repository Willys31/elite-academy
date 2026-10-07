"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Upload } from "tus-js-client";
import { createClient } from "@/lib/supabase/client";
import { creerTeleversementTus, messageErreurTus } from "@/lib/stockage/tus";
import {
  formaterTaille,
  validerDemande,
  TAILLE_MAX_FICHIER,
  type Destination,
} from "@/lib/stockage/limites";
import {
  annulerTeleversement,
  finaliserTeleversement,
  preparerTeleversement,
} from "@/app/(app)/sources/televersement";
import { Alert, BASE_BOUTON, BOUTON_SOBRE, Label } from "@/components/ui";
import { Jauge } from "@/components/app";

export interface FichierTermine {
  sourceId: string;
  nom: string;
  taille: number;
  mime: string;
}

type Etat =
  | "inactif"
  | "preparation"
  | "televersement"
  | "pause"
  | "finalisation"
  | "termine"
  | "erreur";

const CLASSES_CHAMP_FICHIER =
  "block w-full rounded-lg border border-sand-300 bg-white px-3.5 py-2.5 text-sm file:mr-3 file:rounded-lg " +
  "file:border-0 file:bg-sand-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink-900 " +
  "disabled:cursor-not-allowed disabled:bg-sand-100 disabled:text-slate-500";

/**
 * Champ de téléversement direct navigateur → Storage (lot 20).
 *
 * Le fichier ne passe jamais par le serveur Next.js : l'action
 * `preparerTeleversement` réserve un chemin, le navigateur envoie les
 * octets par TUS (morceaux de 6 Mo, reprise sur coupure), puis
 * `finaliserTeleversement` enregistre la taille réelle et, dans
 * l'éditeur, rattache le support à la leçon.
 *
 * Le `<input type="file">` n'a volontairement pas de `name` : posé
 * dans un formulaire, il n'est jamais soumis avec lui.
 */
export function TeleverseurFichier({
  organizationId,
  destination,
  accept,
  libelle,
  aide,
  rattacherAFinalisation = false,
  usageOctets,
  quotaOctets,
  surTermine,
  surReinitialisation,
  surDebut,
}: {
  organizationId: string;
  destination: Destination;
  accept: string;
  libelle: string;
  aide?: string;
  /** Dans l'éditeur : la finalisation crée l'activité et rafraîchit la page. */
  rattacherAFinalisation?: boolean;
  usageOctets?: number;
  quotaOctets?: number;
  surTermine?: (fichier: FichierTermine) => void;
  surReinitialisation?: () => void;
  /** Appelé dès que l'envoi commence (pour verrouiller d'autres champs). */
  surDebut?: () => void;
}) {
  const router = useRouter();
  const idChamp = useId();
  const [etat, setEtat] = useState<Etat>("inactif");
  const [fichier, setFichier] = useState<File | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [progression, setProgression] = useState({ envoye: 0, total: 0 });
  const [debit, setDebit] = useState<number | null>(null);
  const [resultat, setResultat] = useState<FichierTermine | null>(null);

  const uploadRef = useRef<Upload | null>(null);
  const sourceIdRef = useRef<string | null>(null);
  const champRef = useRef<HTMLInputElement>(null);
  const mesureRef = useRef<{ t: number; octets: number } | null>(null);

  const enCours = etat === "preparation" || etat === "televersement" || etat === "finalisation";

  // Fermer l'onglet pendant l'envoi perd le travail en cours : prévenir.
  useEffect(() => {
    if (etat !== "televersement") return;
    const avertir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", avertir);
    return () => window.removeEventListener("beforeunload", avertir);
  }, [etat]);

  const reinitialiser = useCallback(() => {
    uploadRef.current = null;
    sourceIdRef.current = null;
    mesureRef.current = null;
    setFichier(null);
    setErreur(null);
    setProgression({ envoye: 0, total: 0 });
    setDebit(null);
    setResultat(null);
    setEtat("inactif");
    if (champRef.current) champRef.current.value = "";
    surReinitialisation?.();
  }, [surReinitialisation]);

  const finaliser = useCallback(
    async (f: File) => {
      const sourceId = sourceIdRef.current;
      if (!sourceId) return;
      setEtat("finalisation");
      const reponse = await finaliserTeleversement({
        sourceId,
        rattachement:
          rattacherAFinalisation && destination.type === "lecon"
            ? { courseId: destination.courseId, lessonId: destination.lessonId }
            : undefined,
      });
      if (!reponse.ok) {
        setErreur(reponse.erreur);
        setEtat("erreur");
        return;
      }
      const termine: FichierTermine = {
        sourceId,
        nom: f.name,
        taille: reponse.taille,
        mime: f.type,
      };
      setResultat(termine);
      setEtat("termine");
      surTermine?.(termine);
      if (rattacherAFinalisation) router.refresh();
    },
    [destination, rattacherAFinalisation, router, surTermine]
  );

  const demarrer = useCallback(
    async (f: File) => {
      setErreur(null);
      setFichier(f);

      // Refus immédiat, sans aller-retour, pour ce que le navigateur
      // peut déjà juger : vide, trop gros, format, quota connu.
      const refus = validerDemande({
        nom: f.name,
        taille: f.size,
        destination,
        usageOctets: usageOctets ?? 0,
        quotaOctets: quotaOctets ?? Number.MAX_SAFE_INTEGER,
      });
      if (refus) {
        setErreur(refus);
        setEtat("erreur");
        return;
      }

      setEtat("preparation");
      surDebut?.();
      const preparation = await preparerTeleversement({
        organizationId,
        nomFichier: f.name,
        taille: f.size,
        destination,
      });
      if (!preparation.ok) {
        setErreur(preparation.erreur);
        setEtat("erreur");
        return;
      }
      sourceIdRef.current = preparation.sourceId;

      const supabase = createClient();
      const obtenirJeton = async () => {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Session expirée.");
        return session.access_token;
      };

      try {
        const upload = creerTeleversementTus({
          fichier: f,
          chemin: preparation.chemin,
          mime: preparation.mime,
          obtenirJeton,
          surProgression: (envoye, total) => {
            setProgression({ envoye, total });
            const maintenant = Date.now();
            const precedent = mesureRef.current;
            if (precedent && maintenant - precedent.t >= 1000) {
              const instantane = ((envoye - precedent.octets) * 1000) / (maintenant - precedent.t);
              // Moyenne glissante : un débit qui saute à chaque morceau
              // rendrait l'estimation illisible.
              setDebit((d) => (d === null ? instantane : d * 0.7 + instantane * 0.3));
              mesureRef.current = { t: maintenant, octets: envoye };
            } else if (!precedent) {
              mesureRef.current = { t: maintenant, octets: envoye };
            }
          },
          surSucces: () => void finaliser(f),
          surErreur: (e) => {
            setErreur(messageErreurTus(e));
            setEtat("erreur");
          },
        });
        uploadRef.current = upload;
        setEtat("televersement");
        upload.start();
      } catch (e) {
        setErreur(e instanceof Error ? e.message : "Le téléversement n'a pas pu démarrer.");
        setEtat("erreur");
      }
    },
    [destination, finaliser, organizationId, quotaOctets, surDebut, usageOctets]
  );

  const mettreEnPause = () => {
    void uploadRef.current?.abort();
    setEtat("pause");
  };

  const reprendre = () => {
    if (!uploadRef.current) return;
    setErreur(null);
    setEtat("televersement");
    uploadRef.current.start();
  };

  const annuler = async () => {
    const upload = uploadRef.current;
    const sourceId = sourceIdRef.current;
    try {
      await upload?.abort(true);
    } catch {
      /* l'objet partiel est purgé côté serveur au besoin */
    }
    if (sourceId) await annulerTeleversement({ sourceId });
    reinitialiser();
  };

  const reessayer = () => {
    if (uploadRef.current && fichier) {
      // Reprise à l'octet près : TUS interroge le serveur sur l'offset
      // déjà reçu avant de continuer.
      setErreur(null);
      setEtat("televersement");
      uploadRef.current.start();
    } else if (fichier) {
      void demarrer(fichier);
    }
  };

  const pourcent = progression.total > 0 ? (progression.envoye / progression.total) * 100 : 0;
  const restantSecondes =
    debit && debit > 0 && progression.total > 0
      ? Math.max(0, (progression.total - progression.envoye) / debit)
      : null;

  return (
    <div className="space-y-3">
      <div>
        <Label htmlFor={idChamp}>{libelle}</Label>
        <input
          ref={champRef}
          id={idChamp}
          type="file"
          accept={accept}
          disabled={etat !== "inactif" && etat !== "erreur"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void demarrer(f);
          }}
          className={CLASSES_CHAMP_FICHIER}
        />
        <p className="mt-1 text-xs text-slate-500">
          {aide ?? `Jusqu'à ${formaterTaille(TAILLE_MAX_FICHIER)} par fichier. L'envoi reprend seul après une coupure.`}
        </p>
      </div>

      {erreur ? <Alert kind="error">{erreur}</Alert> : null}

      {fichier && etat !== "inactif" && etat !== "termine" ? (
        <div className="rounded-lg border border-sand-200 bg-sand-50 px-3.5 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 truncate font-medium text-ink-900">{fichier.name}</span>
            <span className="text-xs text-slate-500">{formaterTaille(fichier.size)}</span>
          </div>

          <div className="mt-2">
            <Jauge
              pourcent={pourcent}
              libelle={
                etat === "preparation"
                  ? "Préparation…"
                  : etat === "finalisation"
                    ? "Enregistrement…"
                    : etat === "pause"
                      ? `En pause · ${formaterTaille(progression.envoye)} envoyés`
                      : etat === "erreur"
                        ? `Interrompu à ${Math.round(pourcent)} %`
                        : `${Math.round(pourcent)} % · ${formaterTaille(progression.envoye)} sur ${formaterTaille(progression.total)}` +
                          (debit ? ` · ${formaterTaille(debit)}/s` : "") +
                          (restantSecondes !== null ? ` · ${formaterDuree(restantSecondes)} restantes` : "")
              }
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {etat === "televersement" ? (
              <button type="button" onClick={mettreEnPause} className={`${BASE_BOUTON} ${BOUTON_SOBRE}`}>
                Pause
              </button>
            ) : null}
            {etat === "pause" ? (
              <button type="button" onClick={reprendre} className={`${BASE_BOUTON} ${BOUTON_SOBRE}`}>
                Reprendre
              </button>
            ) : null}
            {etat === "erreur" && fichier ? (
              <button type="button" onClick={reessayer} className={`${BASE_BOUTON} ${BOUTON_SOBRE}`}>
                Réessayer
              </button>
            ) : null}
            {etat !== "finalisation" ? (
              <button
                type="button"
                onClick={() => void annuler()}
                disabled={etat === "preparation"}
                className={`${BASE_BOUTON} border border-red-300 bg-white font-medium text-red-700 hover:bg-red-50`}
              >
                Annuler
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {etat === "termine" && resultat ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Alert kind="success">
            « {resultat.nom} » ({formaterTaille(resultat.taille)}) est téléversé.
          </Alert>
          <button
            type="button"
            onClick={reinitialiser}
            className={`${BASE_BOUTON} ${BOUTON_SOBRE} shrink-0`}
          >
            Changer de fichier
          </button>
        </div>
      ) : null}

      {enCours ? (
        <p className="text-xs text-slate-500" aria-live="polite">
          Gardez cet onglet ouvert jusqu&apos;à la fin de l&apos;envoi.
        </p>
      ) : null}
    </div>
  );
}

function formaterDuree(secondes: number): string {
  if (secondes < 60) return "moins d'une minute";
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste > 0 ? `${heures} h ${reste} min` : `${heures} h`;
}
