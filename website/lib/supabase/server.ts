import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { PORTFOLIO_DEMO } from "../portfolio-demo/config";
import { createDemoClient } from "../portfolio-demo/client";

export async function createClient() {
  if (PORTFOLIO_DEMO) return createDemoClient();
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // This can happen when called from a Server Component.
            // Middleware / Server Actions / Route Handlers can still set cookies.
          }
        },
      },
    }
  );
}
