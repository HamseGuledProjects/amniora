import type { MetadataRoute } from "next";
import { BRAND } from "../lib/brand";

const publicRoutes = [
  { path: "", lastModified: "2026-08-21", changeFrequency: "weekly", priority: 1 },
  { path: "/about", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.7 },
  { path: "/features", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.8 },
  { path: "/labs", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.8 },
  { path: "/pricing", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.7 },
  { path: "/roadmap", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.7 },
  { path: "/development-log", lastModified: "2026-08-21", changeFrequency: "weekly", priority: 0.7 },
  { path: "/contact", lastModified: "2026-08-21", changeFrequency: "monthly", priority: 0.5 },
  { path: "/privacy", lastModified: "2026-08-21", changeFrequency: "yearly", priority: 0.4 },
  { path: "/terms", lastModified: "2026-08-21", changeFrequency: "yearly", priority: 0.4 },
  { path: "/cookies", lastModified: "2026-08-21", changeFrequency: "yearly", priority: 0.4 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${BRAND.url}${route.path}`,
    lastModified: route.lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
