/** Fixed-code production Web Lab alerts delivered through the existing Sentry provider. */
import "server-only";
import * as Sentry from "@sentry/nextjs";
import {
  EARLY_ACCESS_SECURITY_EVENT_CODES,
  EARLY_ACCESS_SECURITY_SURFACES,
  type EarlyAccessSecurityEvent,
  type WebLabAlertSink,
} from "./production-security-controls";

const STAGES = [
  "generation",
  "reconciliation",
  "runner",
  "launch_exchange",
  "runtime",
  "admission",
  "security_control",
] as const;
const RUNTIME_MODES = ["local_runner", "byo_runtime", "amniora_hosted"] as const;

type SentryAlertClient = Readonly<{
  captureMessage: typeof Sentry.captureMessage;
  flush: typeof Sentry.flush;
}>;

function validEvent(event: EarlyAccessSecurityEvent): boolean {
  return !!event && EARLY_ACCESS_SECURITY_EVENT_CODES.includes(event.code) &&
    STAGES.includes(event.stage) &&
    (event.surface === undefined || EARLY_ACCESS_SECURITY_SURFACES.includes(event.surface)) &&
    (event.runtimeMode === undefined || RUNTIME_MODES.includes(event.runtimeMode));
}

export class SentryWebLabAlertSink implements WebLabAlertSink {
  readonly production = true as const;
  private readonly client: SentryAlertClient;

  constructor(options: Readonly<{
    configured?: boolean;
    client?: SentryAlertClient;
  }> = {}) {
    const configured = options.configured ?? Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN);
    if (!configured) throw new Error("web_lab_alert_provider_unconfigured");
    this.client = options.client ?? Sentry;
  }

  async notify(event: EarlyAccessSecurityEvent): Promise<void> {
    if (!validEvent(event)) throw new Error("web_lab_alert_event_invalid");
    const surface = event.surface ?? "none";
    const runtimeMode = event.runtimeMode ?? "none";
    try {
      this.client.captureMessage(
        `WEB_LAB_SECURITY_EVENT:${event.code}:${event.stage}:${surface}:${runtimeMode}`,
        {
          level: "warning",
          tags: {
            subsystem: "web_lab_runtime",
            error_category: event.code.toLowerCase(),
            route_family: `${event.stage}:${surface}:${runtimeMode}`,
          },
        },
      );
      if (!(await this.client.flush(2_000))) {
        throw new Error("sentry_flush_failed");
      }
    } catch {
      throw new Error("web_lab_alert_delivery_failed");
    }
  }
}
