import type { ReactNode } from "react";
import Badge from "./Badge";
import Card from "./Card";
import { cn } from "./utils";

type EvidenceKind = "log" | "config" | "policy" | "data";
type InvestigationTone = "verified" | "needsReview" | "blocked" | "neutral";

type EvidenceReferenceProps = {
  path: string;
  label?: ReactNode;
  kind?: EvidenceKind;
  className?: string;
};

const evidenceBadgeVariants: Record<
  EvidenceKind,
  "evidenceLog" | "evidenceConfig" | "evidencePolicy" | "evidenceData"
> = {
  log: "evidenceLog",
  config: "evidenceConfig",
  policy: "evidencePolicy",
  data: "evidenceData",
};

export function EvidenceReference({
  path,
  label,
  kind = "data",
  className,
}: EvidenceReferenceProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-ui-8 border border-border-subtle bg-paper px-2 py-1 text-text",
        className
      )}
    >
      <Badge variant={evidenceBadgeVariants[kind]}>{kind}</Badge>
      <span className="type-mono-metadata technical-value min-w-0 text-graphite">
        {label ?? path}
      </span>
    </span>
  );
}

type TaskRequirementProps = {
  index?: number;
  title: ReactNode;
  children: ReactNode;
  evidence?: Array<Pick<EvidenceReferenceProps, "path" | "label" | "kind">>;
  className?: string;
};

export function TaskRequirement({
  index,
  title,
  children,
  evidence = [],
  className,
}: TaskRequirementProps) {
  return (
    <article
      className={cn(
        "rounded-ui-md border border-border-subtle bg-paper p-space-4 text-text shadow-[var(--shadow-inset-line)]",
        className
      )}
    >
      <div className="flex items-start gap-space-3">
        {typeof index === "number" && (
          <span className="type-caption flex h-7 w-7 shrink-0 items-center justify-center rounded-ui-8 bg-surface-inset font-semibold text-graphite ring-1 ring-border-subtle">
            {index}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h3 className="type-task-title text-heading">{title}</h3>
          <div className="type-body mt-space-2 text-text-secondary">{children}</div>
          {evidence.length > 0 && (
            <div className="mt-space-3 flex flex-wrap gap-2" aria-label="Task evidence">
              {evidence.map((item) => (
                <EvidenceReference key={item.path} {...item} />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

type InvestigationStatusProps = {
  status: InvestigationTone;
  label: ReactNode;
  detail?: ReactNode;
  className?: string;
};

const statusBadgeVariants: Record<
  InvestigationTone,
  "verified" | "needsReview" | "blocked" | "neutral"
> = {
  verified: "verified",
  needsReview: "needsReview",
  blocked: "blocked",
  neutral: "neutral",
};

export function InvestigationStatus({
  status,
  label,
  detail,
  className,
}: InvestigationStatusProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-x-space-3 gap-y-space-1",
        className
      )}
    >
      <Badge variant={statusBadgeVariants[status]}>{label}</Badge>
      {detail && <span className="type-body-sm text-text-secondary">{detail}</span>}
    </div>
  );
}

type MetadataItem = {
  term: ReactNode;
  value: ReactNode;
};

type MetadataListProps = {
  items: MetadataItem[];
  density?: "compact" | "standard";
  className?: string;
};

export function MetadataList({
  items,
  density = "standard",
  className,
}: MetadataListProps) {
  return (
    <dl
      className={cn(
        "grid min-w-0 grid-cols-1 gap-x-space-4 sm:grid-cols-2",
        density === "compact" ? "gap-y-space-2" : "gap-y-space-3",
        className
      )}
    >
      {items.map((item, index) => (
        <div key={index} className="min-w-0">
          <dt className="type-caption text-text-muted">{item.term}</dt>
          <dd className="type-body-sm technical-value mt-0.5 font-medium text-text">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type FindingPanelProps = {
  title: ReactNode;
  summary: ReactNode;
  status?: InvestigationTone;
  metadata?: MetadataItem[];
  children?: ReactNode;
  className?: string;
};

export function FindingPanel({
  title,
  summary,
  status = "neutral",
  metadata = [],
  children,
  className,
}: FindingPanelProps) {
  return (
    <Card density="compact" surface="elevated" className={className}>
      <div className="flex min-w-0 flex-col gap-space-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-space-3">
          <div className="min-w-0">
            <h3 className="type-card-title text-heading">{title}</h3>
            <p className="type-body-sm mt-space-1 text-text-secondary">{summary}</p>
          </div>
          <Badge variant={statusBadgeVariants[status]}>{status}</Badge>
        </div>
        {metadata.length > 0 && <MetadataList items={metadata} density="compact" />}
        {children && <div className="case-divider pt-space-3">{children}</div>}
      </div>
    </Card>
  );
}

type BetaNoticeProps = {
  children: ReactNode;
  className?: string;
};

export function BetaNotice({ children, className }: BetaNoticeProps) {
  return (
    <aside
      className={cn(
        "rounded-ui-md border border-primary-line bg-private-beta-subtle px-space-4 py-space-3 text-private-beta",
        className
      )}
    >
      <p className="type-body-sm">{children}</p>
    </aside>
  );
}

type AdminDataTableColumn<Row> = {
  key: keyof Row & string;
  header: ReactNode;
  render?: (row: Row) => ReactNode;
};

type AdminDataTableProps<Row extends Record<string, ReactNode>> = {
  caption: ReactNode;
  columns: Array<AdminDataTableColumn<Row>>;
  rows: Row[];
  emptyMessage?: ReactNode;
  className?: string;
};

export function AdminDataTable<Row extends Record<string, ReactNode>>({
  caption,
  columns,
  rows,
  emptyMessage = "No records to display.",
  className,
}: AdminDataTableProps<Row>) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-ui-md border border-border bg-paper shadow-surface",
        className
      )}
    >
      <table className="min-w-full border-separate border-spacing-0 text-left">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-muted">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className="type-caption border-b border-border px-space-3 py-space-2 font-semibold uppercase text-text-secondary"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="type-body-sm px-space-3 py-space-5 text-center text-text-muted"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-paper even:bg-paper-muted">
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className="type-body-sm technical-value border-b border-border-subtle px-space-3 py-[var(--spacing-admin-row)] text-text"
                  >
                    {column.render ? column.render(row) : row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
