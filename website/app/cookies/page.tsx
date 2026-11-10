import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import PublicContentPage from "../components/public/PublicContentPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Local Storage and Preferences",
  description: "Browser storage used by the local portfolio demo.",
  path: "/cookies",
});

const sections = [
  {
    "title": "1. No hosted sign-in",
    "content": "The demo uses a fictional learner, so no real authentication session or Supabase account is required."
  },
  {
    "title": "2. Sample state",
    "content": "Browser session storage keeps changes to the synthetic sample tables for the local session. It is separate from any real learner record."
  },
  {
    "title": "3. Preferences",
    "content": "Theme and product-tour preferences may use browser local storage so the interface can remember those choices. Browser settings can remove this storage."
  },
  {
    "title": "4. External tracking",
    "content": "The portfolio configuration disables external analytics and monitoring. It has no advertising, marketing or payment integration."
  },
  {
    "title": "5. Project status",
    "content": "Amniora is cancelled. This page describes the local demonstration, not a current hosted service or a plan to introduce tracking."
  }
];

export default function CookiesPage() {
  return <PublicContentPage category="Portfolio information" title="Local Storage and Preferences" description="Browser storage used by the local portfolio demo." lastUpdated="November 2026" sections={sections} note="Clearing browser storage resets local sample data and preferences." />;
}
