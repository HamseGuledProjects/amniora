"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "../components/Sidebar";
import { createClient } from "../../lib/supabase/client";
import NotificationBell from "../components/NotificationBell";
import AchievementToast from "../components/AchievementToast";
import AppShell from "../components/shell/AppShell";
import TopBar from "../components/shell/TopBar";
import { AuthLoadingState } from "../components/auth/AuthShell";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [desktopShell, setDesktopShell] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function checkUser() {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (error || !user) {
        await supabase.auth.signOut();
        router.replace("/login?reason=account_deleted");
        return;
      }

      setCheckingAuth(false);
    }

    checkUser();

    const interval = setInterval(checkUser, 30000);

    return () => clearInterval(interval);
  }, [router]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const syncShellMode = () => setDesktopShell(query.matches);

    syncShellMode();
    query.addEventListener("change", syncShellMode);

    return () => query.removeEventListener("change", syncShellMode);
  }, []);

  if (checkingAuth) {
    return <AuthLoadingState />;
  }

  return (
    <AppShell
      mobileHeader={
        <Sidebar
          mode="mobile"
          mobileActions={!desktopShell ? <NotificationBell /> : null}
        />
      }
      sidebar={<Sidebar mode="desktop" />}
      topBar={<TopBar />}
    >
      <AchievementToast />
      {children}
    </AppShell>
  );
}
