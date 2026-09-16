import { describe, expect, it } from "vitest";
import {
  compteursCommunaute,
  entraideActive,
  filtrerBlocages,
  franchitSeuil,
  libelleAuteurAnonyme,
  LIMITE_BLOCAGE,
  LIMITE_CONTRIBUTION,
  peutVoter,
  validerBlocage,
  validerContribution,
  xpPourVote,
} from "@/lib/entraide/entraide";
import { PREFERENCES_PAR_DEFAUT } from "@/lib/profil/preferences";

describe("validation des textes", () => {
  it("borne le blocage à 200 caractères et normalise les espaces", () => {
    const ok = validerBlocage("  Je bloque   sur la marge\n\n\n\ncar je confonds.  ");
    expect(ok).toEqual({ ok: true, texte: "Je bloque sur la marge\n\ncar je confonds." });
    expect(validerBlocage("court").ok).toBe(false);
    expect(validerBlocage("x".repeat(LIMITE_BLOCAGE + 1)).ok).toBe(false);
    expect(validerBlocage("x".repeat(LIMITE_BLOCAGE)).ok).toBe(true);
  });

  it("borne la contribution à 500 caractères", () => {
    expect(validerContribution("trop court").ok).toBe(false);
    expect(validerContribution("x".repeat(LIMITE_CONTRIBUTION)).ok).toBe(true);
    expect(validerContribution("x".repeat(LIMITE_CONTRIBUTION + 1)).ok).toBe(false);
  });
});

describe("règles de participation", () => {
  it("est désactivée par défaut", () => {
    expect(entraideActive(PREFERENCES_PAR_DEFAUT)).toBe(false);
    expect(
      entraideActive({ ...PREFERENCES_PAR_DEFAUT, entraide: { actif: true, depuis: null } })
    ).toBe(true);
  });

  it("anonymise l'auteur derrière sa formation", () => {
    expect(libelleAuteurAnonyme("Gestion des conflits")).toBe(
      "Un apprenant de « Gestion des conflits »"
    );
    expect(libelleAuteurAnonyme(null)).toBe("Un apprenant");
  });

  it("interdit de voter pour soi", () => {
    expect(peutVoter({ votantId: "a", auteurContributionId: "a" })).toBe(false);
    expect(peutVoter({ votantId: "a", auteurContributionId: "b" })).toBe(true);
  });
});

describe("XP et seuils", () => {
  it("plafonne les votes rémunérés à 10 par jour", () => {
    expect(xpPourVote(0)).toBe(50);
    expect(xpPourVote(9)).toBe(50);
    expect(xpPourVote(10)).toBe(0);
  });

  it("détecte le premier seuil franchi", () => {
    expect(franchitSeuil(0, 1)).toBe(1);
    expect(franchitSeuil(2, 3)).toBe(3);
    expect(franchitSeuil(3, 4)).toBeNull();
    expect(franchitSeuil(4, 12)).toBe(5);
  });

  it("compte les contributions utiles (≥ 2 votes) et les votes reçus", () => {
    expect(
      compteursCommunaute({
        contributions: [{ votes: 0 }, { votes: 2 }, { votes: 7 }],
        votesSituations: 4,
      })
    ).toEqual({ contributions_utiles: 2, votes_recus: 13 });
  });
});

describe("filtrerBlocages", () => {
  const liste = [
    { id: 1, course_id: "c1", competency_id: "k1", status: "open", visibility_scope: "group" },
    { id: 2, course_id: "c1", competency_id: null, status: "resolved", visibility_scope: "organization" },
    { id: 3, course_id: "c2", competency_id: "k1", status: "open", visibility_scope: "group" },
  ];

  it("combine les filtres et ignore les filtres vides", () => {
    expect(filtrerBlocages(liste, {}).map((b) => b.id)).toEqual([1, 2, 3]);
    expect(filtrerBlocages(liste, { formation: "c1" }).map((b) => b.id)).toEqual([1, 2]);
    expect(filtrerBlocages(liste, { competence: "k1", statut: "open" }).map((b) => b.id)).toEqual([1, 3]);
    expect(filtrerBlocages(liste, { portee: "organization" }).map((b) => b.id)).toEqual([2]);
  });
});
