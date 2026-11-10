import Link from "next/link";

export default function AdminNavigation({
  backHref = "/admin",
}: {
  backHref?: string;
}) {
  const links = [
    { href: "/admin", label: "Dashboard" },
    { href: "/admin/users", label: "Users" },
    { href: "/admin/beta", label: "Private Beta" },
    { href: "/admin/ai", label: "AI Usage" },
    { href: "/admin/feedback", label: "Feedback" },
  ];

  return (
    <div className="mb-6">
      <Link
        href={backHref}
        className="inline-flex min-h-11 items-center text-sm font-medium text-cyan-300 hover:text-cyan-200"
      >
        ← Back
      </Link>
      <nav
        aria-label="Admin navigation"
        className="mt-3 flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="min-h-10 shrink-0 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300 hover:border-cyan-400/40 hover:text-white"
          >
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}