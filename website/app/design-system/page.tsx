import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Card from "../components/ui/Card";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Textarea from "../components/ui/Textarea";
import PageHeader from "../components/ui/PageHeader";
import {
  AdminDataTable,
  BetaNotice,
  EvidenceReference,
  FindingPanel,
  InvestigationStatus,
  MetadataList,
  TaskRequirement,
} from "../components/ui/Foundations";

const QA_ENABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.AMNIORA_ENABLE_DESIGN_SYSTEM_QA === "1";

export const metadata: Metadata = {
  title: "Amniora Design System QA",
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

const sampleEvidence = [
  { path: "assets/logs/auth.log", kind: "log" as const },
  { path: "assets/configs/service.conf", kind: "config" as const },
  { path: "assets/docs/change_request.md", kind: "policy" as const },
];

export default function DesignSystemQaPage() {
  if (!QA_ENABLED) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-app-bg py-space-10 text-text">
      <div className="layout-workspace space-y-space-8">
        <PageHeader
          eyebrow="Internal visual QA"
          title="Amniora foundations"
          description="Synthetic interface samples for checking tokens, primitives, domain surfaces, density, focus states, and responsive behavior."
          actions={
            <>
              <Button variant="secondary">Secondary</Button>
              <Button>Primary</Button>
            </>
          }
        />

        <BetaNotice>
          Private beta surfaces should remain visible, concise, and calm across public and signed-in layouts.
        </BetaNotice>

        <section className="grid gap-space-4 lg:grid-cols-[1fr_0.8fr]">
          <Card className="space-y-space-5">
            <div className="flex flex-wrap items-center gap-space-2">
              <Badge>Neutral</Badge>
              <Badge variant="primary">Primary</Badge>
              <Badge variant="verified">Verified</Badge>
              <Badge variant="needsReview">Needs review</Badge>
              <Badge variant="blocked">Blocked</Badge>
              <Badge variant="beta">Private beta</Badge>
            </div>
            <div className="grid gap-space-3 sm:grid-cols-3">
              <Input aria-label="Sample input" placeholder="Search saved labs" />
              <Select aria-label="Sample select" defaultValue="intermediate">
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </Select>
              <Button variant="outline">Apply filters</Button>
            </div>
            <Textarea
              aria-label="Sample textarea"
              placeholder="Synthetic learner note preview"
              defaultValue="Summarize the observed activity, the supporting evidence, and one evidence gap."
            />
          </Card>

          <FindingPanel
            title="Finding review"
            summary="Evidence-backed status presentation with dense metadata and no nested card layout."
            status="needsReview"
            metadata={[
              { term: "Difficulty", value: "Intermediate" },
              { term: "Duration", value: "30 minutes" },
              { term: "Evidence", value: "3 files" },
              { term: "State", value: "Synthetic" },
            ]}
          >
            <InvestigationStatus
              status="verified"
              label="Evidence linked"
              detail="All references shown here are synthetic QA examples."
            />
          </FindingPanel>
        </section>

        <section className="grid gap-space-4 xl:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <TaskRequirement
              key={index}
              index={index}
              title={`Task ${index}: Correlate observed activity`}
              evidence={sampleEvidence.slice(0, index)}
            >
              Produce a concise answer using only the listed evidence and note one boundary the evidence cannot prove.
            </TaskRequirement>
          ))}
        </section>

        <section className="grid gap-space-4 lg:grid-cols-[0.7fr_1fr]">
          <Card density="compact" surface="inset">
            <h2 className="type-section-title text-heading">Metadata density</h2>
            <MetadataList
              className="mt-space-4"
              items={[
                { term: "Investigation", value: "linux-synthetic-qa" },
                { term: "Status", value: "Ready for review" },
                { term: "Owner", value: "Quality team" },
                { term: "Updated", value: "23 Aug 2026" },
              ]}
            />
          </Card>

          <AdminDataTable
            caption="Synthetic admin queue"
            columns={[
              { key: "case", header: "Case" },
              { key: "status", header: "Status" },
              { key: "age", header: "Age" },
            ]}
            rows={[
              {
                case: <span className="type-mono-metadata">qa-case-001</span>,
                status: <Badge variant="verified">Closed</Badge>,
                age: "2m",
              },
              {
                case: <span className="type-mono-metadata">qa-case-002</span>,
                status: <Badge variant="needsReview">Review</Badge>,
                age: "9m",
              },
            ]}
          />
        </section>

        <section className="flex flex-wrap gap-space-2" aria-label="Evidence examples">
          <EvidenceReference path="assets/logs/audit.log" kind="log" />
          <EvidenceReference path="assets/scheduled/cron.d/example" kind="config" />
          <EvidenceReference path="assets/docs/policy.md" kind="policy" />
          <EvidenceReference path="assets/csv/process_history.csv" kind="data" />
        </section>
      </div>
    </main>
  );
}
