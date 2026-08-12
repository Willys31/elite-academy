import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

/** Chemins accessibles sans être connecté. */
const PUBLIC_PATHS = [
  "/connexion",
  "/inscription",
  "/mot-de-passe-oublie",
  "/reinitialisation",
  "/auth",
  "/verifier", // vérification publique des certificats, sans compte
];

function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true; // page d'accueil publique
  return PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
}

/**
 * Rafraîchit la session Supabase et protège les routes privées.
 * La vérification fine des permissions reste assurée par RLS
 * et par les vérifications des actions serveur : le middleware
 * n'est qu'une première barrière de confort.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Important : ne pas insérer de logique entre la création du client
  // et getUser(), sinon la session peut être perdue.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/connexion";
    url.searchParams.set("suivant", pathname);
    return NextResponse.redirect(url);
  }

  if (user && (isPublicPath(pathname) || pathname === "/")) {
    // Un utilisateur connecté n'a pas besoin des écrans d'authentification.
    // /verifier reste accessible à tous (page publique de vérification).
    if (
      pathname !== "/reinitialisation" &&
      !pathname.startsWith("/auth") &&
      !pathname.startsWith("/verifier")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/accueil";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
