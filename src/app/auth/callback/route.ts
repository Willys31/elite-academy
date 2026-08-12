import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Callback d'authentification (confirmation d'e-mail,
 * lien de réinitialisation). Échange le code contre une session.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const suivant = searchParams.get("suivant") ?? "/accueil";
  const destination = suivant.startsWith("/") ? suivant : "/accueil";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(
    `${origin}/connexion?erreur=lien-invalide`
  );
}
