import { createBrowserClient } from "@supabase/ssr";
import { PORTFOLIO_DEMO } from "../portfolio-demo/config";
import { createDemoClient } from "../portfolio-demo/client";

export function createClient() {
  if (PORTFOLIO_DEMO) return createDemoClient();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
