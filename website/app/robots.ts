import type { MetadataRoute } from "next";
import { BRAND } from "../lib/brand";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/brand/", "/icons/", "/favicon.ico", "/manifest.webmanifest"],
      disallow: [
        "/admin/",
        "/api/",
        "/dashboard/",
        "/login",
        "/signup",
        "/forgot-password",
        "/reset-password",
        "/callback",
      ],
    },
    sitemap: `${BRAND.url}/sitemap.xml`,
    host: BRAND.url,
  };
}
