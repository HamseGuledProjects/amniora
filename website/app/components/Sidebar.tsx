"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  User,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { createClient } from "../../lib/supabase/client";
import BrandLogo from "./BrandLogo";
import {
  authNavigationItems,
  isAuthNavigationItemActive,
} from "./navigation/authNavigation";

type SidebarMode = "all" | "mobile" | "desktop";

type SidebarProps = {
  mobileActions?: ReactNode;
  mode?: SidebarMode;
};

export default function Sidebar({ mobileActions, mode = "all" }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileCloseButtonRef = useRef<HTMLButtonElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  const [profile, setProfile] = useState({
    full_name: "User",
    plan: "Free Plan",
  });

  useEffect(() => {
    async function loadProfile() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("profiles")
        .select("full_name, plan")
        .eq("id", user.id)
        .single();

      if (data) {
        setProfile({
          full_name: data.full_name || "User",
          plan: data.plan || "Free Plan",
        });
      }
    }

    loadProfile();
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const mainRegion = document.querySelector<HTMLElement>(
      "[data-authenticated-main-region]"
    );
    const previousMainOverflowY = mainRegion?.style.overflowY ?? "";
    const previousMainOverscrollBehavior =
      mainRegion?.style.overscrollBehavior ?? "";

    document.body.style.overflow = "hidden";
    if (mainRegion) {
      mainRegion.style.overflowY = "hidden";
      mainRegion.style.overscrollBehavior = "contain";
    }
    mobileCloseButtonRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileOpen(false);
        requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
      }

      if (event.key === "Tab") {
        const drawer = mobileDrawerRef.current;
        if (!drawer) return;

        const focusable = Array.from(
          drawer.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((element) => element.offsetParent !== null);

        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      if (mainRegion) {
        mainRegion.style.overflowY = previousMainOverflowY;
        mainRegion.style.overscrollBehavior = previousMainOverscrollBehavior;
      }
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  function closeMobileMenu({ restoreFocus = true } = {}) {
    setMobileOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
    }
  }

  async function logout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  const initials = profile.full_name
    .split(" ")
    .map((name) => name[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const showMobileHeader = mode === "all" || mode === "mobile";
  const showDesktopSidebar = mode === "all" || mode === "desktop";

  return (
    <>
      {/* Mobile Top Bar */}
      {showMobileHeader && (
        <div
        className="flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-white/10 bg-sidebar px-[max(0.875rem,env(safe-area-inset-left))] pb-0 pr-[max(0.875rem,env(safe-area-inset-right))] pt-[env(safe-area-inset-top)] text-sidebar-text lg:hidden"
        data-authenticated-mobile-header
      >
        <Link href="/dashboard" aria-label="Amniora dashboard">
          <BrandLogo size="sm" theme="dark" />
        </Link>

        <div className="relative flex min-w-0 items-center gap-2" data-authenticated-mobile-actions>
          {mobileActions}
          <button
            ref={mobileMenuButtonRef}
            onClick={() => setMobileOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-ui-sm border border-white/10 bg-sidebar-elevated text-sidebar-text outline-none transition-colors hover:border-white/20 hover:bg-auth-surface-selected focus-visible:ring-2 focus-visible:ring-focus"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu size={20} />
          </button>
        </div>
        </div>
      )}

      {/* Mobile Drawer */}
      <AnimatePresence>
        {showMobileHeader && mobileOpen && (
          <>
            <motion.button
              onClick={() => closeMobileMenu()}
              className="fixed inset-0 z-[70] bg-slate-950/60 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-label="Close menu overlay"
            />

            <motion.aside
              ref={mobileDrawerRef}
              className="fixed left-0 top-0 z-[80] flex h-dvh w-[88dvw] max-w-[336px] flex-col overflow-hidden border-r border-cyan-200/10 bg-sidebar px-3 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-[max(0.875rem,env(safe-area-inset-top))] shadow-modal lg:hidden"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              role="dialog"
              aria-modal="true"
              aria-label="Authenticated navigation"
              data-authenticated-mobile-drawer
            >
              <div
                className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-white/10 pb-4"
                data-authenticated-mobile-drawer-brand
              >
                <div className="min-w-0 rounded-[3px]">
                  <BrandLogo size="md" theme="dark" />
                </div>

                <button
                  ref={mobileCloseButtonRef}
                  onClick={() => closeMobileMenu()}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.03] text-slate-300 outline-none transition-colors hover:border-cyan-200/20 hover:bg-sidebar-elevated hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
                  aria-label="Close menu"
                >
                  <X size={19} aria-hidden="true" />
                </button>
              </div>

              <nav
                className="mt-4 min-h-0 flex-[0_1_auto] space-y-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
                aria-label="Primary navigation"
                data-authenticated-mobile-drawer-nav
              >
                {authNavigationItems.map((link) => {
                  const active = isAuthNavigationItemActive(link, pathname);
                  const Icon = link.icon;

                  return (
                    <Link
                      key={link.id}
                      href={link.href}
                      onClick={() => closeMobileMenu({ restoreFocus: false })}
                      aria-current={active ? "page" : undefined}
                      data-authenticated-mobile-drawer-link={link.id}
                      data-authenticated-mobile-drawer-link-active={active ? "true" : "false"}
                      className={`type-navigation relative flex min-h-12 items-center gap-2.5 overflow-hidden rounded-[3px] border px-2.5 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                        active
                          ? "sidebar-active-line border-cyan-200/16 bg-cyan-100/[0.08] text-white"
                          : "border-transparent text-slate-300 hover:border-white/10 hover:bg-sidebar-elevated hover:text-white"
                      }`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                          active
                            ? "border-cyan-200/20 bg-cyan-200/10 text-cyan-100"
                            : "border-white/6 bg-white/[0.03] text-slate-400"
                        }`}
                        data-authenticated-mobile-drawer-icon
                      >
                        <Icon size={17} aria-hidden="true" />
                      </span>
                      <span className="min-w-0 truncate font-medium leading-5">{link.label}</span>
                    </Link>
                  );
                })}
              </nav>

              <div
                className="mt-auto shrink-0 border-t border-white/10 pt-3"
                data-authenticated-mobile-drawer-account
              >
                <div className="rounded-[4px] border border-white/10 bg-white/[0.035] p-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-cyan-200/15 bg-primary text-sm font-semibold text-white">
                    {initials || "U"}
                  </div>

                  <div className="min-w-0">
                    <p className="type-card-title truncate text-sidebar-text">
                      {profile.full_name}
                    </p>
                    <p className="truncate text-xs text-sidebar-text-muted">
                      {profile.plan}
                    </p>
                  </div>
                </div>
                </div>

                <button
                  onClick={logout}
                  className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-[4px] border border-red-400/25 bg-red-950/10 text-sm text-red-300 outline-none transition-colors hover:border-red-300/35 hover:bg-red-500/15 hover:text-red-200 focus-visible:ring-2 focus-visible:ring-focus"
                  aria-label="Log out"
                >
                  <LogOut size={16} aria-hidden="true" />
                  Log Out
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      {showDesktopSidebar && (
        <aside
          className={`hidden h-full min-h-0 shrink-0 flex-col border-r border-cyan-200/10 bg-sidebar px-3 py-4 shadow-[inset_-1px_0_0_rgba(125,211,252,0.04)] transition-[width] duration-200 lg:flex ${
          collapsed ? "w-[72px]" : "w-64"
        }`}
          data-authenticated-sidebar
          data-authenticated-sidebar-craft="phase-b2"
        >
        <div
          className={`flex border-b border-white/10 pb-4 ${
            collapsed
              ? "min-h-20 flex-col items-center justify-center gap-2"
              : "min-h-14 items-center justify-between gap-3"
          }`}
          data-authenticated-sidebar-brand
        >
          <Link
            href="/dashboard"
            aria-label="Amniora dashboard"
            className={`min-w-0 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              collapsed ? "inline-flex justify-center" : "inline-flex"
            }`}
          >
            <BrandLogo variant={collapsed ? "icon" : "full"} size="md" theme="dark" />
          </Link>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-white/10 bg-white/[0.03] text-slate-400 outline-none transition-colors hover:border-cyan-200/20 hover:bg-sidebar-elevated hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRight size={18} aria-hidden="true" />
            ) : (
              <ChevronLeft size={18} aria-hidden="true" />
            )}
          </button>
        </div>

        <nav
          className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]"
          data-authenticated-sidebar-nav
          aria-label="Primary navigation"
        >
          {authNavigationItems.map((link) => {
            const active = isAuthNavigationItemActive(link, pathname);
            const Icon = link.icon;

            return (
              <Link
                key={link.id}
                href={link.href}
                aria-current={active ? "page" : undefined}
                aria-label={collapsed ? link.label : undefined}
                title={collapsed ? link.label : undefined}
                data-authenticated-sidebar-link={link.id}
                data-authenticated-sidebar-link-active={active ? "true" : "false"}
                className={`type-navigation relative flex min-h-11 items-center overflow-hidden rounded-[3px] border px-2.5 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
                  collapsed ? "justify-center" : "gap-2.5"
                } ${
                  active
                    ? "sidebar-active-line border-cyan-200/16 bg-cyan-100/[0.08] text-white"
                    : "border-transparent text-slate-300 hover:border-white/10 hover:bg-sidebar-elevated hover:text-white"
                }`}
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border transition-colors ${
                    active
                      ? "border-cyan-200/20 bg-cyan-200/10 text-cyan-100"
                      : "border-white/6 bg-white/[0.03] text-slate-400"
                  }`}
                  data-authenticated-sidebar-icon
                >
                  <Icon size={17} aria-hidden="true" />
                </span>
                {!collapsed && <span className="min-w-0 truncate">{link.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div
          className="mt-4 shrink-0 border-t border-white/10 pt-3"
          data-authenticated-sidebar-account
        >
          {!collapsed && (
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="w-full rounded-[4px] border border-white/10 bg-white/[0.035] p-2.5 text-left outline-none transition-colors hover:border-cyan-200/20 hover:bg-sidebar-elevated focus-visible:ring-2 focus-visible:ring-focus"
                aria-expanded={profileOpen}
                data-authenticated-sidebar-profile
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[4px] border border-cyan-200/15 bg-primary text-sm font-semibold text-white">
                      {initials || "U"}
                    </div>

                    <div className="min-w-0">
                      <p className="type-card-title truncate text-sidebar-text">
                        {profile.full_name}
                      </p>
                      <p className="truncate text-xs text-sidebar-text-muted">
                        {profile.plan}
                      </p>
                    </div>
                  </div>

                  <ChevronDown
                    size={16}
                    className={`text-gray-400 transition ${
                      profileOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>

              {profileOpen && (
                <div className="absolute bottom-full left-0 mb-2 w-full rounded-[4px] border border-white/10 bg-sidebar-elevated p-1.5 shadow-modal">
                  <Link
                    href="/dashboard/settings"
                    className="flex items-center gap-3 rounded-ui-sm px-3 py-2 text-sm text-slate-300 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <User size={16} />
                    Profile
                  </Link>

                  <Link
                    href="/dashboard/settings"
                    className="flex items-center gap-3 rounded-ui-sm px-3 py-2 text-sm text-slate-300 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Settings size={16} />
                    Settings
                  </Link>

                  <Link
                    href="/dashboard/saved"
                    className="flex items-center gap-3 rounded-ui-sm px-3 py-2 text-sm text-slate-300 outline-none transition-colors hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <BookOpen size={16} />
                    Saved Investigations
                  </Link>

                  <button
                    onClick={logout}
                    className="flex w-full items-center gap-3 rounded-ui-sm px-3 py-2 text-left text-sm text-red-300 outline-none transition-colors hover:bg-red-500/10 focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <LogOut size={16} />
                    Log Out
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            onClick={logout}
            className="mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[4px] border border-red-400/25 bg-red-950/10 text-sm text-red-300 outline-none transition-colors hover:border-red-300/35 hover:bg-red-500/15 hover:text-red-200 focus-visible:ring-2 focus-visible:ring-focus"
            aria-label="Log out"
          >
            {collapsed ? (
              <LogOut size={18} className="mx-auto" aria-hidden="true" />
            ) : (
              <>
                <LogOut size={16} aria-hidden="true" />
                Log Out
              </>
            )}
          </button>
        </div>
        </aside>
      )}
    </>
  );
}
