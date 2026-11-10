import "server-only";
import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_DEMO } from "../portfolio-demo/config";
import { createDemoClient } from "../portfolio-demo/client";

export const supabaseAdmin = PORTFOLIO_DEMO ? createDemoClient() : createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
