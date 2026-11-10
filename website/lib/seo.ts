import type { Metadata } from "next";
import { BRAND } from "@/lib/brand";

const defaultImage = {
  url: `${BRAND.url}/brand/amniora-logo.png`,
  width: 1536,
  height: 1024,
  alt: "Amniora logo",
};

export function canonicalUrl(path = "/") {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${BRAND.url}${normalizedPath === "/" ? "" : normalizedPath}`;
}

export function publicPageMetadata({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}): Metadata {
  const url = canonicalUrl(path);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title: title === BRAND.name ? BRAND.name : `${title} | ${BRAND.name}`,
      description,
      url,
      siteName: BRAND.name,
      locale: "en_GB",
      images: [defaultImage],
    },
    twitter: {
      card: "summary_large_image",
      title: title === BRAND.name ? BRAND.name : `${title} | ${BRAND.name}`,
      description,
      images: [defaultImage],
    },
  };
}

export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: BRAND.name,
  url: BRAND.url,
  logo: `${BRAND.url}/brand/amniora-logo.png`,
  description: BRAND.description,
};

export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: BRAND.name,
  url: BRAND.url,
  description: BRAND.description,
  inLanguage: "en-GB",
};
