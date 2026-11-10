import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import PublicContentPage from "../components/public/PublicContentPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Local Demo Privacy",
  description: "How information is handled in this local portfolio demonstration of a cancelled project.",
  path: "/privacy",
});

const sections = [
  {
    "title": "1. Project status",
    "content": "Amniora is cancelled. This portfolio runs as a local demonstration using a fictional learner and synthetic investigation examples. It does not create a real account."
  },
  {
    "title": "2. Local sample state",
    "content": "Changes to sample tables are kept in browser session storage. Tutor messages and feedback use the local server process memory. Existing theme and tour preferences may use browser local storage. Use sample information only."
  },
  {
    "title": "3. Hosted integrations",
    "content": "The source preserves the original Supabase, AI and runtime integrations for review. The portfolio demo does not connect to those services, send prompts to an AI provider or use a hosted account database."
  },
  {
    "title": "4. Monitoring and contact",
    "content": "External analytics and monitoring are disabled in this demo. The contact form is disabled and there is no payment flow or active product support inbox."
  },
  {
    "title": "5. Clearing local information",
    "content": "Clear this site’s browser storage to remove local sample state and preferences. Restart the local server to clear process memory. This demonstration is not intended to retain important work."
  }
];

export default function PrivacyPage() {
  return <PublicContentPage category="Portfolio information" title="Local Demo Privacy" description="How information is handled in this local portfolio demonstration of a cancelled project." lastUpdated="November 2026" sections={sections} note="This notice describes the portfolio configuration. The historical service policy has been replaced because it does not describe this local demo." />;
}
