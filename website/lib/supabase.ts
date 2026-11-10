import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_DEMO } from "./portfolio-demo/config";
import { createDemoClient } from "./portfolio-demo/client";

export const supabase = PORTFOLIO_DEMO ? createDemoClient() : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
);
