export type LinuxLocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function isValidLinuxTimeZone(timezone: string | undefined) {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function localFormatter(timezone: string) {
  if (!isValidLinuxTimeZone(timezone)) {
    throw new Error(`Invalid Linux timezone: ${timezone}`);
  }
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function parseLinuxLocalDateTime(value: string | undefined): LinuxLocalDateTimeParts | undefined {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6]),
  };
}

export function formatLinuxUtcTimestamp(date: Date | number) {
  const value = typeof date === "number" ? new Date(date) : date;
  return value.toISOString().slice(0, 19).replace("T", " ");
}

export function formatLinuxInstantInTimeZone(date: Date | number, timezone: string) {
  const value = typeof date === "number" ? new Date(date) : date;
  const parts = Object.fromEntries(localFormatter(timezone).formatToParts(value).map((part) => [part.type, part.value]));
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day} ${hour}:${parts.minute}:${parts.second}`;
}

export function linuxUtcTimestampToMs(value: string) {
  const normalized = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(normalized)) {
    const ms = Date.parse(`${normalized.replace(" ", "T")}Z`);
    return Number.isFinite(ms) ? ms : Number.NaN;
  }
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export function formatLinuxLearnerDocumentDateTime(
  utcTimestamp: string | Date | number,
  timezone: string,
  options: { includeSeconds?: boolean; includeWeekday?: boolean; includeOffset?: boolean } = {}
) {
  if (!isValidLinuxTimeZone(timezone)) {
    throw new Error(`Invalid Linux timezone: ${timezone}`);
  }
  const instant = typeof utcTimestamp === "string" ? linuxUtcTimestampToMs(utcTimestamp) : utcTimestamp;
  const value = typeof instant === "number" ? new Date(instant) : instant;
  if (!value || !Number.isFinite(value.getTime())) {
    throw new Error(`Invalid Linux UTC timestamp: ${String(utcTimestamp)}`);
  }
  const rendered = formatLinuxInstantInTimeZone(value, timezone);
  const [date, time] = rendered.split(" ");
  const clock = options.includeSeconds ? time : time.slice(0, 5);
  const weekday = options.includeWeekday
    ? `${Object.fromEntries(localFormatter(timezone).formatToParts(value).map((part) => [part.type, part.value])).weekday} `
    : "";
  const offset = options.includeOffset ? ` ${linuxTimeZoneOffsetLabel(value, timezone)}` : "";
  return `${weekday}${date} ${clock} ${timezone}${offset}`;
}

export function formatLinuxLearnerDocumentWindow(
  startUtcTimestamp: string,
  endUtcTimestamp: string,
  timezone: string,
  options: { includeSeconds?: boolean; includeWeekday?: boolean; includeOffset?: boolean } = {}
) {
  const startMs = linuxUtcTimestampToMs(startUtcTimestamp);
  const endMs = linuxUtcTimestampToMs(endUtcTimestamp);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    throw new Error(`Invalid Linux learner document window: ${startUtcTimestamp} to ${endUtcTimestamp}`);
  }
  const startLocal = formatLinuxInstantInTimeZone(startMs, timezone);
  const endLocal = formatLinuxInstantInTimeZone(endMs, timezone);
  const [startDate, startTime] = startLocal.split(" ");
  const [endDate, endTime] = endLocal.split(" ");
  const startClock = options.includeSeconds ? startTime : startTime.slice(0, 5);
  const endClock = options.includeSeconds ? endTime : endTime.slice(0, 5);
  const startPrefix = options.includeWeekday
    ? `${Object.fromEntries(localFormatter(timezone).formatToParts(new Date(startMs)).map((part) => [part.type, part.value])).weekday} `
    : "";
  const endPrefix = options.includeWeekday && endDate !== startDate
    ? `${Object.fromEntries(localFormatter(timezone).formatToParts(new Date(endMs)).map((part) => [part.type, part.value])).weekday} `
    : "";
  const offset = options.includeOffset ? ` ${linuxTimeZoneOffsetLabel(startMs, timezone)}` : "";
  if (startDate === endDate) {
    return `${startPrefix}${startDate} ${startClock}-${endClock} ${timezone}${offset}`;
  }
  return `${startPrefix}${startDate} ${startClock} to ${endPrefix}${endDate} ${endClock} ${timezone}${offset}`;
}
export function linuxTimeZoneOffsetMinutes(date: Date | number, timezone: string) {
  const value = typeof date === "number" ? new Date(date) : date;
  const local = parseLinuxLocalDateTime(formatLinuxInstantInTimeZone(value, timezone));
  if (!local) throw new Error(`Unable to render Linux timezone parts for ${timezone}`);
  const renderedAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return Math.round((renderedAsUtc - value.getTime()) / 60_000);
}

export function linuxTimeZoneOffsetLabel(date: Date | number, timezone: string) {
  const minutes = linuxTimeZoneOffsetMinutes(date, timezone);
  const sign = minutes >= 0 ? "+" : "-";
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const mins = absolute % 60;
  return `${sign}${String(hours).padStart(2, "0")}${String(mins).padStart(2, "0")}`;
}

export function linuxLocalDateTimeToUtcMs(value: string, timezone = "UTC") {
  if (!isValidLinuxTimeZone(timezone)) return Number.NaN;
  const parsed = parseLinuxLocalDateTime(value);
  if (!parsed) return Number.NaN;
  const target = `${String(parsed.year).padStart(4, "0")}-${String(parsed.month).padStart(2, "0")}-${String(parsed.day).padStart(2, "0")} ${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}:${String(parsed.second).padStart(2, "0")}`;
  const approximate = Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute, parsed.second);
  const matches: number[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 15) {
    const candidate = approximate - offsetMinutes * 60_000;
    if (formatLinuxInstantInTimeZone(candidate, timezone) === target) matches.push(candidate);
  }
  if (matches.length === 0) return Number.NaN;
  return Math.min(...matches);
}

export function linuxLocalTimestampPlusSeconds(value: string, seconds: number, timezone = "UTC") {
  const instant = linuxLocalDateTimeToUtcMs(value, timezone);
  if (!Number.isFinite(instant)) return "";
  return formatLinuxInstantInTimeZone(instant + seconds * 1000, timezone);
}

export function linuxLocalCaseTimeToUtcTimestamp(
  context: { incidentDate: string; timezone?: string },
  clock: string
) {
  const withSeconds = /^\d\d:\d\d$/.test(clock) ? `${clock}:00` : clock;
  const instant = linuxLocalDateTimeToUtcMs(`${context.incidentDate} ${withSeconds}`, context.timezone || "UTC");
  if (!Number.isFinite(instant)) {
    throw new Error(`Invalid Linux local timestamp ${context.incidentDate} ${withSeconds} ${context.timezone || "UTC"}`);
  }
  return formatLinuxUtcTimestamp(instant);
}
