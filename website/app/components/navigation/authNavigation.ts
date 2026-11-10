import {
  BookOpen,
  Bot,
  FlaskConical,
  House,
  Map,
  Settings,
  Trophy,
  type LucideIcon,
} from "lucide-react";

export type AuthNavigationMatch = "exact" | "prefix";

export type AuthNavigationItem = {
  id:
    | "dashboard"
    | "tutor"
    | "generate-investigation"
    | "saved-investigations"
    | "roadmap"
    | "progress"
    | "settings";
  label: string;
  href: string;
  icon: LucideIcon;
  match: AuthNavigationMatch;
  section?: "primary";
};

export const authNavigationItems = [
  {
    id: "dashboard",
    label: "Dashboard",
    href: "/dashboard",
    icon: House,
    match: "exact",
    section: "primary",
  },
  {
    id: "tutor",
    label: "AI Tutor",
    href: "/dashboard/tutor",
    icon: Bot,
    match: "prefix",
    section: "primary",
  },
  {
    id: "generate-investigation",
    label: "Generate Investigation",
    href: "/dashboard/labs",
    icon: FlaskConical,
    match: "prefix",
    section: "primary",
  },
  {
    id: "saved-investigations",
    label: "Saved Investigations",
    href: "/dashboard/saved",
    icon: BookOpen,
    match: "prefix",
    section: "primary",
  },
  {
    id: "roadmap",
    label: "Learning Roadmap",
    href: "/dashboard/roadmap",
    icon: Map,
    match: "prefix",
    section: "primary",
  },
  {
    id: "progress",
    label: "Progress",
    href: "/dashboard/progress",
    icon: Trophy,
    match: "prefix",
    section: "primary",
  },
  {
    id: "settings",
    label: "Settings",
    href: "/dashboard/settings",
    icon: Settings,
    match: "prefix",
    section: "primary",
  },
] as const satisfies readonly AuthNavigationItem[];

export function isAuthNavigationItemActive(
  item: AuthNavigationItem,
  pathname: string | null
) {
  if (!pathname) return false;
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
