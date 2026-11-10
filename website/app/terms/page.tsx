import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/seo";
import PublicContentPage from "../components/public/PublicContentPage";

export const metadata: Metadata = publicPageMetadata({
  title: "Portfolio Scope",
  description: "What this cancelled-project demonstration includes.",
  path: "/terms",
});

const sections = [
  {
    "title": "1. Cancelled project",
    "content": "Amniora is preserved as a portfolio project. Development has ended and there is no current beta, signup, subscription, checkout or promised release."
  },
  {
    "title": "2. Local demonstration",
    "content": "The interface uses synthetic examples and fixed responses. It does not provide a hosted learning account, live AI generation or an installed Runner connection."
  },
  {
    "title": "3. Educational material",
    "content": "Investigation examples and source code illustrate lawful cybersecurity learning. Use them only with systems and materials you are authorised to inspect."
  },
  {
    "title": "4. Sample results",
    "content": "Progress, feedback, plans and investigation results in the demo are illustrative. They are not certifications, current service offers or evidence of a live production deployment."
  },
  {
    "title": "5. Source and licensing",
    "content": "The repository documents source scope, validation limits and third-party dependencies. The portfolio does not add an open-source licence to the original Amniora code; see the repository licence-status and third-party notices."
  },
  {
    "title": "6. Local information",
    "content": "Use synthetic inputs only. Local sample state is not a durable record or a substitute for your own files."
  }
];

export default function TermsPage() {
  return <PublicContentPage category="Portfolio information" title="Portfolio Scope" description="What this cancelled-project demonstration includes." lastUpdated="November 2026" sections={sections} note="This page explains the portfolio scope. It replaces the historical hosted-service terms, which do not describe this demo." />;
}
