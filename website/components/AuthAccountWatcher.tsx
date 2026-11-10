"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthAccountWatcher() {
  const router = useRouter();

  useEffect(() => {
    async function checkAccount() {
      const res = await fetch("/api/auth/check-account");

      if (res.status === 401) {
        const supabase = createClient();
        await supabase.auth.signOut();

        router.replace("/login?reason=account_deleted");
      }
    }

    checkAccount();

    const interval = setInterval(checkAccount, 30000);

    return () => clearInterval(interval);
  }, [router]);

  return null;
}