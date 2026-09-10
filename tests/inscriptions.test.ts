import { describe, expect, it } from "vitest";
import {
  donneAcces,
  ENROLLMENT_STATUS_LABELS,
  peutSeDesinscrire,
  STATUTS_AVEC_ACCES,
} from "@/lib/courses/inscriptions";

describe("donneAcces", () => {
  it("une inscription en cours ou terminée donne accès au contenu", () => {
    expect(donneAcces("active")).toBe(true);
    expect(donneAcces("completed")).toBe(true);
  });

  it("une inscription retirée ou suspendue ne donne plus accès", () => {
    expect(donneAcces("withdrawn")).toBe(false);
    expect(donneAcces("suspended")).toBe(false);
  });

  it("sans inscription ou avec un statut inconnu, aucun accès", () => {
    expect(donneAcces(null)).toBe(false);
    expect(donneAcces(undefined)).toBe(false);
    expect(donneAcces("")).toBe(false);
    expect(donneAcces("autre")).toBe(false);
  });

  it("reste cohérent avec la liste des statuts donnant accès", () => {
    expect(STATUTS_AVEC_ACCES.every((s) => donneAcces(s))).toBe(true);
  });
});

describe("peutSeDesinscrire", () => {
  it("autorisé pour une inscription en cours et volontaire", () => {
    expect(peutSeDesinscrire({ statut: "active", assigneePar: null })).toEqual({ ok: true });
  });

  it("refusé pour une formation terminée (historique et attestation)", () => {
    const verdict = peutSeDesinscrire({ statut: "completed", assigneePar: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/terminée/);
  });

  it("refusé si l'apprenant est déjà désinscrit", () => {
    expect(peutSeDesinscrire({ statut: "withdrawn", assigneePar: null }).ok).toBe(false);
  });

  it("refusé si l'inscription est suspendue par l'encadrement", () => {
    const verdict = peutSeDesinscrire({ statut: "suspended", assigneePar: null });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/suspendue/);
  });

  it("refusé pour un parcours attribué par l'organisation", () => {
    const verdict = peutSeDesinscrire({ statut: "active", assigneePar: "responsable-1" });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.raison).toMatch(/attribuée/);
  });
});

describe("ENROLLMENT_STATUS_LABELS", () => {
  it("chaque statut de l'enum a un libellé", () => {
    for (const statut of ["active", "completed", "withdrawn", "suspended"]) {
      expect(ENROLLMENT_STATUS_LABELS[statut]).toBeTruthy();
    }
  });
});
