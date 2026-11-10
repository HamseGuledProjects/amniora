import Link from "next/link";
import BrandLogo from "./BrandLogo";

const groups = [
  {
    title: "Explore",
    links: [
      ["Features", "/features"],
      ["Labs", "/labs"],
      ["Roadmap", "/roadmap"],
      ["Pricing", "/pricing"],
    ],
  },
  {
    title: "Project archive",
    links: [
      ["Development Log", "/development-log"],
      ["Sample investigations", "/dashboard/saved"],
      ["About", "/about"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Information & demo",
    links: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Cookies", "/cookies"],
      ["Tutor demo", "/dashboard/tutor"],
      ["Explore workspace", "/dashboard"],
    ],
  },
] as const;

export default function PublicFooter() {
  return (
    <footer className="border-t border-border bg-paper">
      <div className="mx-auto grid max-w-7xl gap-space-7 px-4 py-space-8 sm:px-6 md:grid-cols-[1.25fr_2fr] lg:px-8">
        <div>
          <BrandLogo size="md" theme="light" />
          <p className="mt-space-3 max-w-sm text-sm leading-6 text-text-secondary">
            Hands-on cybersecurity practice with synthetic investigations,
            guided tasks and clear feedback.
          </p>
          <p className="mt-space-4 border-l border-border-strong pl-space-3 text-xs leading-5 text-text-muted">
            Product development cancelled. Local portfolio uses synthetic data only.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-space-5 gap-y-space-6 pt-space-4 sm:grid-cols-3 md:pt-0">
          {groups.map((group) => (
            <div key={group.title}>
              <h2 className="type-label font-semibold text-text">{group.title}</h2>
              <ul className="mt-space-3 grid gap-space-2">
                {group.links.map(([label, href]) => (
                  <li key={label}>
                    <Link
                      href={href}
                      className="text-sm leading-5 text-text-secondary outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-border px-4 py-space-4 text-center type-caption text-text-muted">
        © {new Date().getFullYear()} Amniora. All rights reserved.
      </div>
    </footer>
  );
}
