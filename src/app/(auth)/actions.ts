"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
  success?: string;
}

/** Traduction des erreurs Supabase les plus fréquentes. */
function messageErreur(message: string): string {
  const table: Record<string, string> = {
    "Invalid login credentials":
      "E-mail ou mot de passe incorrect. Vérifiez vos identifiants et réessayez.",
    "Email not confirmed":
      "Votre adresse e-mail n'est pas encore confirmée. Consultez votre boîte de réception.",
    "User already registered":
      "Un compte existe déjà avec cette adresse e-mail. Essayez de vous connecter.",
    "Password should be at least 6 characters":
      "Le mot de passe doit contenir au moins 6 caractères.",
  };
  return (
    table[message] ??
    "Une erreur est survenue. Réessayez ou contactez votre responsable."
  );
}

async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

export async function seConnecter(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Veuillez saisir votre e-mail et votre mot de passe." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: messageErreur(error.message) };

  const suivant = String(formData.get("suivant") ?? "") || "/accueil";
  redirect(suivant.startsWith("/") ? suivant : "/accueil");
}

export async function sInscrire(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!fullName) return { error: "Veuillez saisir votre nom complet." };
  if (!email) return { error: "Veuillez saisir votre adresse e-mail." };
  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }
  if (password !== confirm) {
    return { error: "Les deux mots de passe ne sont pas identiques." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${await baseUrl()}/auth/callback`,
    },
  });
  if (error) return { error: messageErreur(error.message) };

  return {
    success:
      "Compte créé. Si la confirmation par e-mail est activée, consultez votre boîte de réception pour valider votre adresse, puis connectez-vous.",
  };
}

export async function demanderReinitialisation(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Veuillez saisir votre adresse e-mail." };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await baseUrl()}/auth/callback?suivant=/reinitialisation`,
  });
  if (error) return { error: messageErreur(error.message) };

  // Message identique que le compte existe ou non (pas de fuite d'information).
  return {
    success:
      "Si un compte existe avec cette adresse, un e-mail de réinitialisation vient d'être envoyé.",
  };
}

export async function reinitialiserMotDePasse(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères." };
  }
  if (password !== confirm) {
    return { error: "Les deux mots de passe ne sont pas identiques." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: messageErreur(error.message) };

  redirect("/accueil");
}

export async function seDeconnecter(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/connexion");
}
