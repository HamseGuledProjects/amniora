"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import BrandLogo from "./BrandLogo";

const primaryLinks = [
  { label: "Features", href: "/features", summary: "How Amniora works" },
  { label: "Labs", href: "/labs", summary: "Hands-on investigations" },
  { label: "Roadmap", href: "/roadmap", summary: "Original topic coverage" },
  { label: "Pricing", href: "/pricing", summary: "Historical plan design" },
] as const;

const secondaryLinks = [
  { label: "Development Log", href: "/development-log", summary: "Archived development milestones" },
  { label: "About", href: "/about", summary: "Purpose and principles" },
] as const;

const links = [...primaryLinks, ...secondaryLinks] as const;

function isCurrent(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function PublicNavbar() {
  const pathname = usePathname() || "/";
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const scrollPositionRef = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.dataset.publicNavigationOpen = open
      ? "true"
      : "false";
    window.dispatchEvent(
      new CustomEvent("amniora-public-navigation-open-change", {
        detail: { open },
      }),
    );

    return () => {
      document.documentElement.dataset.publicNavigationOpen = "false";
      window.dispatchEvent(
        new CustomEvent("amniora-public-navigation-open-change", {
          detail: { open: false },
        }),
      );
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    scrollPositionRef.current = window.scrollY;

    requestAnimationFrame(() => closeRef.current?.focus());

    function preventBackgroundScroll(event: TouchEvent | WheelEvent) {
      const target = event.target;
      if (target instanceof Node && menuPanelRef.current?.contains(target)) {
        return;
      }
      event.preventDefault();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = menuPanelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusable?.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("touchmove", preventBackgroundScroll, {
      passive: false,
    });
    document.addEventListener("wheel", preventBackgroundScroll, {
      passive: false,
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("touchmove", preventBackgroundScroll);
      document.removeEventListener("wheel", preventBackgroundScroll);
      if (window.scrollY !== scrollPositionRef.current) {
        window.scrollTo(0, scrollPositionRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    const desktopQuery = window.matchMedia("(min-width: 1024px)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };

    desktopQuery.addEventListener("change", closeAtDesktop);
    return () => desktopQuery.removeEventListener("change", closeAtDesktop);
  }, []);

  function closeMenu({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }

  const duration = reducedMotion ? 0 : 0.18;

  return (
    <header
      className="sticky top-0 z-50 border-b border-border bg-paper"
    >
      <nav
        aria-label="Public navigation"
        className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-space-4 px-4 sm:px-6 lg:px-8"
      >
        <Link href="/" aria-label="Amniora home" className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-focus">
          <BrandLogo size="md" theme="light" />
        </Link>

        <div className="hidden min-w-0 items-center justify-center gap-space-1 lg:flex" aria-label="Primary public pages">
          {primaryLinks.map((link, index) => {
            const current = isCurrent(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`type-navigation group relative inline-flex min-h-10 items-center gap-space-2 whitespace-nowrap border-b px-space-3 py-space-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${current ? "border-primary text-primary" : "border-transparent text-text-secondary hover:border-border-strong hover:text-heading"}`}
              >
                <span className="font-mono text-[0.68rem] text-text-muted group-hover:text-primary">{String(index + 1).padStart(2, "0")}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center justify-end gap-space-2 lg:flex">
          {secondaryLinks.map((link, index) => {
            const current = isCurrent(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={`type-navigation group inline-flex min-h-10 items-center gap-space-2 whitespace-nowrap border-b px-space-3 py-space-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${current ? "border-primary text-primary" : "border-transparent text-text-secondary hover:border-border-strong hover:text-heading"}`}
              >
                <span className="font-mono text-[0.68rem] text-text-muted group-hover:text-primary">{String(index + 5).padStart(2, "0")}</span>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>

        <div className="hidden items-center gap-space-2 md:flex">
          <Link
            href="/dashboard/saved"
            className="ui-action ui-action-secondary min-h-10 px-space-3 py-space-2 text-text-secondary"
          >
            <span className="font-mono text-[0.68rem] text-text-muted">Sample</span>
            <span className="ml-space-1">Labs</span>
          </Link>
          <Link
            href="/dashboard/tutor"
            className="rounded-ui-sm px-space-3 py-space-2 text-sm font-semibold text-text outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
          >
            Tutor demo
          </Link>
          <Link
            href="/dashboard"
            className="ui-action ui-action-primary min-h-10 px-space-4 py-space-2"
          >
            Explore workspace
          </Link>
        </div>

        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => (open ? closeMenu() : setOpen(true))}
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          aria-controls="public-mobile-menu"
          className="relative flex h-11 w-11 items-center justify-center rounded-ui-sm border border-border text-text outline-none transition-[border-color,background-color,transform] duration-150 hover:border-border-strong hover:bg-surface-muted active:scale-95 focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none lg:hidden"
        >
          <motion.span aria-hidden="true" className="absolute" animate={{ opacity: open ? 0 : 1, rotate: open ? 90 : 0, scale: open ? 0.8 : 1 }} transition={{ duration }}>
            <Menu size={20} />
          </motion.span>
          <motion.span aria-hidden="true" className="absolute" animate={{ opacity: open ? 1 : 0, rotate: open ? 0 : -90, scale: open ? 1 : 0.8 }} transition={{ duration }}>
            <X size={20} />
          </motion.span>
        </button>
      </nav>

      <AnimatePresence>
        {open && (
          <motion.div
            id="public-mobile-menu"
            className="absolute inset-x-0 top-full z-[60] h-[calc(100svh-var(--public-navbar-height))] overflow-hidden lg:hidden"
            initial={{ opacity: reducedMotion ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: reducedMotion ? 1 : 0 }}
            transition={{ duration }}
          >
            <motion.button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => closeMenu()}
              className="absolute inset-0 h-full w-full bg-ink/35"
              initial={{ opacity: reducedMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: reducedMotion ? 1 : 0 }}
              transition={{ duration }}
            />

            <motion.div
              ref={menuPanelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation menu"
              className="relative mx-3 mt-3 ml-auto flex max-h-[calc(100svh-var(--public-navbar-height)-1rem)] w-[calc(100%-1.5rem)] max-w-sm flex-col overflow-y-auto overscroll-contain rounded-ui-md border border-border bg-paper p-space-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-modal"
              initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -10, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 1 } : { opacity: 0, y: -8, scale: 0.99 }}
              transition={{ duration, ease: "easeOut" }}
            >
              <div className="flex items-start justify-between border-b border-border pb-space-3">
                <div>
                  <BrandLogo size="sm" theme="light" />
                  <p className="mt-space-2 font-mono text-xs uppercase text-text-muted">Explore Amniora</p>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => closeMenu()}
                  aria-label="Close navigation menu"
                  className="flex h-11 w-11 items-center justify-center rounded-ui-sm text-text outline-none transition-colors hover:bg-surface-muted active:bg-border focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </div>

              <motion.div className="mt-space-3 flex flex-col gap-space-1" initial="closed" animate="open" exit="closed" variants={{ open: { transition: { staggerChildren: reducedMotion ? 0 : 0.02, delayChildren: reducedMotion ? 0 : 0.03 } }, closed: { transition: { staggerChildren: reducedMotion ? 0 : 0.015, staggerDirection: -1 } } }}>
                {links.map((link, index) => {
                  const current = isCurrent(pathname, link.href);
                  return (
                    <motion.div key={link.href} variants={{ open: { opacity: 1, y: 0 }, closed: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : -4 } }} transition={{ duration: reducedMotion ? 0 : 0.16 }}>
                      <Link
                        href={link.href}
                        aria-current={current ? "page" : undefined}
                        onClick={() => closeMenu({ restoreFocus: false })}
                        className={`grid min-h-12 gap-0.5 border-l px-space-3 py-space-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${current ? "border-primary text-primary" : "border-border-subtle text-text hover:border-primary hover:bg-surface-muted"}`}
                      >
                        <span className="flex items-baseline gap-space-3 text-base font-medium"><span className="font-mono text-xs text-text-muted">{String(index + 1).padStart(2, "0")}</span>{link.label}</span>
                        <span className="pl-[2.05rem] text-xs text-text-muted">{link.summary}</span>
                      </Link>
                    </motion.div>
                  );
                })}

                <motion.div className="mt-space-3 grid gap-space-2 border-t border-border pt-space-4" variants={{ open: { opacity: 1, y: 0 }, closed: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : -4 } }} transition={{ duration: reducedMotion ? 0 : 0.16 }}>
                  <Link href="/dashboard/saved" onClick={() => closeMenu({ restoreFocus: false })} className="ui-action ui-action-secondary w-full py-space-2">
                    Sample investigations
                  </Link>
                  <Link href="/dashboard/tutor" onClick={() => closeMenu({ restoreFocus: false })} className="flex min-h-11 items-center justify-center rounded-ui-sm border border-border-strong px-space-4 py-space-2 text-center text-sm font-semibold text-text outline-none transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-focus">
                    Tutor demo
                  </Link>
                  <Link href="/dashboard" onClick={() => closeMenu({ restoreFocus: false })} className="ui-action ui-action-primary w-full py-space-2">
                    Explore workspace
                  </Link>
                </motion.div>
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
