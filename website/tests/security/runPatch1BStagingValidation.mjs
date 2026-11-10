// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
import nodeAssert from "node:assert/strict";
import { lookup } from "node:dns/promises";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import postgres from "postgres";

const STAGING_REF = "portfoliofixtureaaaa";
const PRODUCTION_REF = "portfoliofixturebbbb";
const DATABASE_URL_ENV = "PATCH_1B_STAGING_DATABASE_URL";
const POOL_SIZE_ENV = "PATCH_1B_STAGING_POOL_SIZE";
const DEFAULT_SESSION_POOL_SIZE = 15;
const MAX_SAFE_SESSION_POOL_SIZE = 15;
const FREE_USER_ID = "11111111-1111-4111-8111-111111111111";
const PRO_USER_ID = "22222222-2222-4222-8222-222222222222";
const POSTGRES_FAILURES = Symbol("postgresFailures");
const CONCURRENCY_OBSERVATION = Symbol("concurrencyObservation");
let configuredPhysicalPoolSize = DEFAULT_SESSION_POOL_SIZE;
let sessionObservation = { active: 0, maximumObserved: 0 };

let assertionContext = {
  testName: "runner",
  related: {},
};

function executeAssertion(assertionName, assertionFunction, args) {
  try {
    return assertionFunction(...args);
  } catch (error) {
    if (error instanceof nodeAssert.AssertionError) {
      const callerFrame = String(error.stack || "")
        .split(/\r?\n/)
        .find((line) =>
          /\s+at (?:run|verify)[A-Za-z0-9_]* .*runPatch1BStagingValidation\.mjs:\d+:\d+/.test(
            line
          )
        );
      const caller = callerFrame?.match(
        /\s+at ([A-Za-z0-9_]+).*runPatch1BStagingValidation\.mjs:(\d+):(\d+)/
      );
      error.patch1BAssertion = {
        assertionName: caller
          ? `${assertionName} in ${caller[1]} at line ${caller[2]}`
          : assertionName,
        source:
          caller && {
            function: caller[1],
            line: Number(caller[2]),
            column: Number(caller[3]),
          },
        testName: assertionContext.testName,
        related: assertionContext.related,
      };
    }
    throw error;
  }
}

const assert = new Proxy(nodeAssert, {
  apply(target, thisArgument, args) {
    return executeAssertion(
      "assert",
      (...assertionArgs) => Reflect.apply(target, thisArgument, assertionArgs),
      args
    );
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (
      typeof value !== "function" ||
      property === "AssertionError" ||
      property === "CallTracker"
    ) {
      return value;
    }
    return (...args) =>
      executeAssertion(String(property), (...assertionArgs) => {
        return Reflect.apply(value, target, assertionArgs);
      }, args);
  },
});

async function withAssertionContext(testName, related, operation) {
  const previousContext = assertionContext;
  assertionContext = { testName, related };
  try {
    return await operation();
  } finally {
    assertionContext = previousContext;
  }
}

function collectSqlStates(value, states = new Set(), seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return states;
  }
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (
      (key === "sqlErrorCodes" || key === "connectionFailureCodes") &&
      child &&
      typeof child === "object"
    ) {
      for (const code of Object.keys(child)) {
        if (/^[0-9A-Z]{5}$/.test(code)) states.add(code);
      }
    }
    collectSqlStates(child, states, seen);
  }
  return states;
}

function maskSyntheticUserId(userId) {
  if (userId === FREE_USER_ID) return "11111111-…-1111";
  if (userId === PRO_USER_ID) return "22222222-…-2222";
  return "[MASKED_SYNTHETIC_USER_ID]";
}

function sanitizeDiagnosticText(value) {
  if (typeof value !== "string") return value ?? null;
  let sanitized = value
    .replace(/postgres(?:ql)?:\/\/[^\s"'`]+/gi, "[REDACTED_DATABASE_URL]")
    .replaceAll(FREE_USER_ID, maskSyntheticUserId(FREE_USER_ID))
    .replaceAll(PRO_USER_ID, maskSyntheticUserId(PRO_USER_ID));

  const connectionString = process.env[DATABASE_URL_ENV];
  if (connectionString) {
    sanitized = sanitized.replaceAll(
      connectionString,
      "[REDACTED_DATABASE_URL]"
    );
    try {
      const parsed = new URL(connectionString);
      const sensitiveValues = [
        parsed.password,
        decodeURIComponent(parsed.password),
        parsed.username,
        decodeURIComponent(parsed.username),
      ].filter(Boolean);
      for (const sensitiveValue of sensitiveValues) {
        sanitized = sanitized.replaceAll(sensitiveValue, "[REDACTED]");
      }
    } catch {
      // Environment validation reports malformed URLs before SQL can execute.
    }
  }
  return sanitized;
}

function readPostgresField(error, ...fieldNames) {
  for (const fieldName of fieldNames) {
    if (error?.[fieldName] !== undefined && error[fieldName] !== null) {
      return sanitizeDiagnosticText(String(error[fieldName]));
    }
  }
  return null;
}

function serializePostgresFailure(error) {
  const operation = error?.patch1BOperation || {};
  return {
    testName: operation.testName || assertionContext.testName,
    operation: operation.operation || "unknown",
    reservationUuidPrefix: operation.reservationId
      ? String(operation.reservationId).slice(0, 8)
      : null,
    syntheticUserId: operation.userId
      ? maskSyntheticUserId(operation.userId)
      : null,
    feature: operation.feature || null,
    sqlstate: readPostgresField(error, "code"),
    message: readPostgresField(error, "message"),
    severity: readPostgresField(error, "severity"),
    detail: readPostgresField(error, "detail"),
    hint: readPostgresField(error, "hint"),
    position: readPostgresField(error, "position"),
    internalPosition: readPostgresField(
      error,
      "internal_position",
      "internalPosition"
    ),
    internalQuery: readPostgresField(error, "internal_query", "internalQuery"),
    where: readPostgresField(error, "where"),
    schemaName: readPostgresField(error, "schema_name", "schemaName"),
    tableName: readPostgresField(error, "table_name", "tableName"),
    columnName: readPostgresField(error, "column_name", "columnName"),
    constraintName: readPostgresField(
      error,
      "constraint_name",
      "constraintName"
    ),
    routine: readPostgresField(error, "routine"),
    sourceFile: readPostgresField(error, "file"),
    sourceLine: readPostgresField(error, "line"),
  };
}

function serializeAssertion(error) {
  if (!(error instanceof nodeAssert.AssertionError)) return null;
  const postgresFailures = error.actual?.[POSTGRES_FAILURES] || [];
  const sqlStates = [
    ...collectSqlStates(error.actual),
    ...postgresFailures
      .map(({ diagnostic }) => diagnostic.sqlstate)
      .filter((code) => /^[0-9A-Z]{5}$/.test(code)),
  ];
  if (typeof error.cause?.code === "string" && /^[0-9A-Z]{5}$/.test(error.cause.code)) {
    sqlStates.push(error.cause.code);
  }
  return {
    assertionName: error.patch1BAssertion?.assertionName || error.operator,
    testName: error.patch1BAssertion?.testName || "unknown",
    expected: error.expected,
    actual: error.actual,
    assertionMessage: error.message,
    operator: error.operator,
    source: error.patch1BAssertion?.source || null,
    stackTrace: error.stack,
    sqlstate: [...new Set(sqlStates)],
    postgresFailures: postgresFailures.map(({ diagnostic }) => diagnostic),
    concurrency: error.actual?.[CONCURRENCY_OBSERVATION] || null,
    related: error.patch1BAssertion?.related || {},
  };
}

class PreflightError extends Error {
  constructor(code, reason) {
    super(reason);
    this.name = "PreflightError";
    this.code = code;
    this.publicReason = reason;
  }
}

function validateEnvironment() {
  const connectionString = process.env[DATABASE_URL_ENV];
  const requestedPoolSize = process.env[POOL_SIZE_ENV];

  if (!connectionString) {
    throw new PreflightError(
      "MISSING_DATABASE_URL",
      `${DATABASE_URL_ENV} is not present in this process.`
    );
  }
  if (connectionString.includes(PRODUCTION_REF)) {
    throw new PreflightError(
      "PRODUCTION_REFERENCE_DETECTED",
      "The URI contains the prohibited production project reference."
    );
  }
  if (!connectionString.includes(STAGING_REF)) {
    throw new PreflightError(
      "STAGING_REFERENCE_MISSING",
      "The URI does not contain the required staging project reference."
    );
  }

  let parsed;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new PreflightError(
      "INVALID_DATABASE_URL",
      "The value is not a syntactically valid URL."
    );
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new PreflightError(
      "INVALID_PROTOCOL",
      "The URI protocol must be postgres or postgresql."
    );
  }
  if (!parsed.hostname) {
    throw new PreflightError(
      "HOSTNAME_MISSING",
      "The URI does not contain a hostname."
    );
  }
  if (!parsed.username) {
    throw new PreflightError(
      "USERNAME_MISSING",
      "The URI does not contain a PostgreSQL username."
    );
  }
  if (!parsed.password) {
    throw new PreflightError(
      "PASSWORD_MISSING",
      "The URI does not contain a PostgreSQL password."
    );
  }

  let username;
  let databaseName;
  try {
    username = decodeURIComponent(parsed.username);
    databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch {
    throw new PreflightError(
      "INVALID_PERCENT_ENCODING",
      "The URI contains invalid percent-encoded username or database data."
    );
  }
  if (!databaseName || databaseName.includes("/")) {
    throw new PreflightError(
      "DATABASE_NAME_INVALID",
      "The URI must contain exactly one database name in its path."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const port = Number(parsed.port || "5432");
  const directHostname = `db.${STAGING_REF}.supabase.co`;
  const sessionPoolerHostname =
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/;
  const isDirect =
    hostname === directHostname && username === "postgres" && port === 5432;
  const isSessionPooler =
    sessionPoolerHostname.test(hostname) &&
    username === `postgres.${STAGING_REF}` &&
    port === 5432;

  if (
    !hostname.includes(STAGING_REF) &&
    !username.includes(STAGING_REF)
  ) {
    throw new PreflightError(
      "STAGING_IDENTITY_NOT_IN_ENDPOINT",
      "The staging reference must be present in the database host or username."
    );
  }
  if (!isDirect && !isSessionPooler) {
    throw new PreflightError(
      "UNSUPPORTED_SUPABASE_ENDPOINT",
      [
        "The URI does not match an Amniora Staging Supabase Direct or",
        "Shared Pooler Session endpoint. Direct requires",
        `db.${STAGING_REF}.supabase.co:5432 with username postgres; Session`,
        "Pooler requires aws-<number>-<region>.pooler.supabase.com:5432",
        `with username postgres.${STAGING_REF}.`,
      ].join(" ")
    );
  }

  const poolSize =
    requestedPoolSize === undefined || requestedPoolSize === ""
      ? DEFAULT_SESSION_POOL_SIZE
      : Number(requestedPoolSize);
  if (
    !Number.isInteger(poolSize) ||
    poolSize < 2 ||
    poolSize > MAX_SAFE_SESSION_POOL_SIZE
  ) {
    throw new PreflightError(
      "INVALID_POOL_SIZE",
      `${POOL_SIZE_ENV} must be an integer between 2 and ${MAX_SAFE_SESSION_POOL_SIZE}.`
    );
  }
  configuredPhysicalPoolSize = poolSize;

  return {
    connectionString,
    publicReport: {
      variablePresent: true,
      stagingReferenceMatched: true,
      productionReferenceAbsent: true,
      protocol: parsed.protocol.replace(":", ""),
      hostname,
      port,
      databaseName,
      usernameExists: true,
      username: "[MASKED]",
      passwordExists: true,
      password: "[MASKED]",
      endpointFormat: isDirect ? "supabase_direct" : "supabase_session_pooler",
      endpointFormatValid: true,
      configuredPhysicalPoolSize: poolSize,
      physicalPoolSizeSource:
        requestedPoolSize === undefined || requestedPoolSize === ""
          ? "safe_default"
          : "environment",
      credentialsPersisted: false,
    },
  };
}

async function verifyDns(hostname) {
  try {
    const addresses = await lookup(hostname, {
      all: true,
      verbatim: true,
    });
    if (addresses.length === 0) {
      throw new PreflightError(
        "DNS_NO_ADDRESSES",
        "The validated hostname returned no DNS addresses."
      );
    }
    return {
      attempted: true,
      resolved: true,
      addressCount: addresses.length,
      addressFamilies: [...new Set(addresses.map(({ family }) => family))].sort(),
      authenticationAttempted: false,
    };
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    const dnsCode =
      typeof error?.code === "string" && error.code.length <= 16
        ? error.code
        : "UNKNOWN";
    throw new PreflightError(
      "DNS_LOOKUP_FAILED",
      `The validated hostname did not resolve. DNS error code: ${dnsCode}.`
    );
  }
}

async function verifyPostgresTls(hostname, port) {
  return new Promise((resolve, reject) => {
    const sslRequest = Buffer.alloc(8);
    sslRequest.writeInt32BE(8, 0);
    sslRequest.writeInt32BE(80877103, 4);

    let settled = false;
    let rawSocket;
    let tlsSocket;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      rawSocket?.setTimeout(0);
      tlsSocket?.setTimeout(0);
      if (error) {
        tlsSocket?.destroy();
        rawSocket?.destroy();
        reject(error);
      } else {
        resolve(result);
        tlsSocket?.end();
      }
    };

    const fail = (error) => {
      const code =
        typeof error?.code === "string" && error.code.length <= 64
          ? error.code
          : "UNKNOWN";
      finish(
        new PreflightError(
          "TLS_NEGOTIATION_FAILED",
          `PostgreSQL TLS negotiation failed before authentication. Error code: ${code}.`
        )
      );
    };

    rawSocket = connectTcp({ host: hostname, port });
    rawSocket.setTimeout(10_000, () => {
      fail({ code: "TLS_PROBE_TIMEOUT" });
    });
    rawSocket.once("error", fail);
    rawSocket.once("connect", () => {
      rawSocket.write(sslRequest);
    });
    rawSocket.once("data", (response) => {
      if (response[0] !== 83) {
        finish(
          new PreflightError(
            "TLS_NOT_SUPPORTED",
            "The PostgreSQL endpoint rejected the SSLRequest instead of negotiating TLS."
          )
        );
        return;
      }

      rawSocket.removeAllListeners();
      rawSocket.setTimeout(0);
      tlsSocket = connectTls({
        socket: rawSocket,
        servername: hostname,
        rejectUnauthorized: false,
      });
      tlsSocket.setTimeout(10_000, () => {
        fail({ code: "TLS_HANDSHAKE_TIMEOUT" });
      });
      tlsSocket.once("error", fail);
      tlsSocket.once("secureConnect", () => {
        const cipher = tlsSocket.getCipher();
        finish(null, {
          attempted: true,
          negotiated: tlsSocket.encrypted === true,
          certificateAuthorized: tlsSocket.authorized === true,
          certificateAuthorizationError:
            typeof tlsSocket.authorizationError === "string"
              ? tlsSocket.authorizationError
              : null,
          verificationMode: "require",
          protocol: tlsSocket.getProtocol(),
          cipher: cipher?.standardName || cipher?.name || null,
          authenticationAttempted: false,
        });
      });
    });
  });
}

function reservationId(prefix, index) {
  return `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function safeError(error) {
  const code =
    typeof error?.code === "string" && error.code.length <= 64
      ? error.code
      : "UNKNOWN";
  const sqlError = /^[0-9A-Z]{5}$/.test(code);
  const connectionFailure =
    /^(E(?:CONN|HOST|NET|PIPE|TIMEDOUT)|ENOTFOUND)/.test(code) ||
    /connection/i.test(String(error?.name || ""));
  return {
    category: sqlError
      ? "sql_error"
      : error instanceof PreflightError
        ? "preflight_failure"
      : connectionFailure
        ? "connection_failure"
        : "validation_failure",
    code,
    name:
      typeof error?.name === "string" && error.name.length <= 64
        ? error.name
        : "Error",
    ...(error instanceof PreflightError
      ? { reason: error.publicReason }
      : {}),
  };
}

function summarizeReserveResults(settled, valueSelector = (value) => value) {
  const summary = {
    attempted: settled.length,
    accepted: 0,
    denied: 0,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  };
  const postgresFailures = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      const value = valueSelector(result.value);
      if (value?.allowed === true) summary.accepted += 1;
      else if (value?.allowed === false) summary.denied += 1;
      else throw new Error("Reservation RPC returned an unexpected value.");
      continue;
    }

    const detail = safeError(result.reason);
    postgresFailures.push({
      diagnostic: serializePostgresFailure(result.reason),
      reservationId: result.reason?.patch1BOperation?.reservationId || null,
    });
    const key =
      detail.category === "sql_error"
        ? "sqlErrorCodes"
        : "connectionFailureCodes";
    const countKey =
      detail.category === "sql_error" ? "sqlErrors" : "connectionFailures";
    summary[countKey] += 1;
    summary[key][detail.code] = (summary[key][detail.code] || 0) + 1;
  }

  Object.defineProperty(summary, POSTGRES_FAILURES, {
    value: postgresFailures,
    enumerable: false,
  });
  return summary;
}

function summarizeBooleanResults(settled) {
  const summary = {
    attempted: settled.length,
    trueResults: 0,
    falseResults: 0,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  };
  const postgresFailures = [];

  for (const result of settled) {
    if (result.status === "fulfilled") {
      if (result.value === true) summary.trueResults += 1;
      else if (result.value === false) summary.falseResults += 1;
      else throw new Error("Terminal-state RPC returned an unexpected value.");
      continue;
    }

    const detail = safeError(result.reason);
    postgresFailures.push({
      diagnostic: serializePostgresFailure(result.reason),
      reservationId: result.reason?.patch1BOperation?.reservationId || null,
    });
    const key =
      detail.category === "sql_error"
        ? "sqlErrorCodes"
        : "connectionFailureCodes";
    const countKey =
      detail.category === "sql_error" ? "sqlErrors" : "connectionFailures";
    summary[countKey] += 1;
    summary[key][detail.code] = (summary[key][detail.code] || 0) + 1;
  }

  Object.defineProperty(summary, POSTGRES_FAILURES, {
    value: postgresFailures,
    enumerable: false,
  });
  return summary;
}

function resetSessionObservation() {
  sessionObservation = { active: 0, maximumObserved: 0 };
}

function attachConcurrencyObservation(summary, logicalOperations) {
  const observation = {
    logicalConcurrentOperations: logicalOperations,
    configuredPhysicalPoolSize,
    maximumObservedActiveConnections: sessionObservation.maximumObserved,
    queuedOperationsAtCapacity: Math.max(
      logicalOperations - configuredPhysicalPoolSize,
      0
    ),
  };
  Object.defineProperty(summary, CONCURRENCY_OBSERVATION, {
    value: observation,
    enumerable: false,
  });
  return observation;
}

function reportSummary(summary) {
  return {
    ...summary,
    concurrency: summary[CONCURRENCY_OBSERVATION],
  };
}

async function withIndependentSession(sql, operation) {
  return sql.begin(async (tx) => {
    sessionObservation.active += 1;
    sessionObservation.maximumObserved = Math.max(
      sessionObservation.maximumObserved,
      sessionObservation.active
    );
    try {
      await tx`set local statement_timeout = '15s'`;
      await tx`set local lock_timeout = '10s'`;
      await tx`set local role service_role`;
      return await operation(tx);
    } finally {
      sessionObservation.active -= 1;
    }
  });
}

async function reserve(sql, id, userId, feature, limit, plan) {
  try {
    return await withIndependentSession(sql, async (tx) => {
      const [row] = await tx`
        select public.reserve_ai_usage(
          ${id}::uuid,
          ${userId}::uuid,
          ${feature}::text,
          ${limit}::integer,
          ${plan}::text
        ) as result
      `;
      return row.result;
    });
  } catch (error) {
    error.patch1BOperation = {
      testName: assertionContext.testName,
      operation: "reserve_ai_usage",
      reservationId: id,
      userId,
      feature,
    };
    throw error;
  }
}

async function finalize(sql, id, inputTokens, outputTokens, cost) {
  try {
    return await withIndependentSession(sql, async (tx) => {
      const [row] = await tx`
        select public.finalize_ai_usage_reservation(
          ${id}::uuid,
          ${inputTokens}::integer,
          ${outputTokens}::integer,
          ${cost}::numeric
        ) as result
      `;
      return row.result;
    });
  } catch (error) {
    error.patch1BOperation = {
      testName: assertionContext.testName,
      operation: "finalize_ai_usage_reservation",
      reservationId: id,
    };
    throw error;
  }
}

async function release(sql, id) {
  try {
    return await withIndependentSession(sql, async (tx) => {
      const [row] = await tx`
        select public.release_ai_usage_reservation(${id}::uuid) as result
      `;
      return row.result;
    });
  } catch (error) {
    error.patch1BOperation = {
      testName: assertionContext.testName,
      operation: "release_ai_usage_reservation",
      reservationId: id,
    };
    throw error;
  }
}

async function cleanupSyntheticData(sql) {
  await sql.begin(async (tx) => {
    await tx`set local statement_timeout = '15s'`;
    await tx`
      delete from public.ai_usage_reservations
      where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
    `;
    await tx`
      delete from public.ai_usage
      where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
    `;
    await tx`
      delete from public.profiles
      where id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
    `;
    await tx`
      delete from auth.users
      where id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
    `;
  });
}

async function verifyCleanup(sql) {
  const [row] = await sql`
    select
      (select count(*)::integer from auth.users
        where id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)) as users,
      (select count(*)::integer from public.profiles
        where id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)) as profiles,
      (select count(*)::integer from public.ai_usage
        where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)) as usage,
      (select count(*)::integer from public.ai_usage_reservations
        where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid))
        as reservations
  `;
  assert.deepEqual(row, {
    users: 0,
    profiles: 0,
    usage: 0,
    reservations: 0,
  });
  return { confirmed: true, ...row };
}

async function seedSyntheticUsers(sql) {
  await cleanupSyntheticData(sql);
  await sql.begin(async (tx) => {
    await tx`set local statement_timeout = '15s'`;
    await tx`
      insert into auth.users (
        id, aud, role, is_sso_user, is_anonymous, created_at, updated_at
      ) values
        (${FREE_USER_ID}::uuid, 'authenticated', 'authenticated',
          false, false, now(), now()),
        (${PRO_USER_ID}::uuid, 'authenticated', 'authenticated',
          false, false, now(), now())
    `;
    await tx`
      insert into public.profiles (id, plan) values
        (${FREE_USER_ID}::uuid, 'free'),
        (${PRO_USER_ID}::uuid, 'pro')
    `;
  });
}

async function clearUserState(sql, userId, plan, tutor = 0, labs = 0) {
  await sql.begin(async (tx) => {
    await tx`set local statement_timeout = '15s'`;
    await tx`
      delete from public.ai_usage_reservations where user_id = ${userId}::uuid
    `;
    await tx`delete from public.ai_usage where user_id = ${userId}::uuid`;
    await tx`
      insert into public.ai_usage (
        user_id, week_start, tutor_prompts_used, lab_generations_used,
        total_tokens, estimated_cost, plan_snapshot
      ) values (
        ${userId}::uuid,
        date_trunc('week', timezone('UTC', now()))::date,
        ${tutor}, ${labs}, 0, 0, ${plan}
      )
    `;
  });
}

async function getUsage(sql, userId) {
  const [row] = await sql`
    select
      tutor_prompts_used,
      lab_generations_used,
      total_tokens,
      estimated_cost::text
    from public.ai_usage
    where user_id = ${userId}::uuid
  `;
  return row;
}

async function getReservation(sql, id) {
  const [row] = await sql`
    select
      status,
      finalized_at is not null as has_finalized_at,
      released_at is not null as has_released_at
    from public.ai_usage_reservations
    where id = ${id}::uuid
  `;
  return row;
}

async function runReservationConcurrency(sql) {
  await clearUserState(sql, FREE_USER_ID, "free", 14);
  resetSessionObservation();
  const oneRemaining = await Promise.allSettled(
    Array.from({ length: 10 }, (_, index) =>
      reserve(
        sql,
        reservationId("d1000000", index + 1),
        FREE_USER_ID,
        "tutor_prompt",
        15,
        "free"
      )
    )
  );
  const oneRemainingSummary = summarizeReserveResults(oneRemaining);
  attachConcurrencyObservation(oneRemainingSummary, oneRemaining.length);
  assert.deepEqual(oneRemainingSummary, {
    attempted: 10,
    accepted: 1,
    denied: 9,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });
  assert.equal((await getUsage(sql, FREE_USER_ID)).tutor_prompts_used, 15);

  await clearUserState(sql, FREE_USER_ID, "free");
  resetSessionObservation();
  const fullAllowance = await Promise.allSettled(
    Array.from({ length: 16 }, (_, index) =>
      reserve(
        sql,
        reservationId("d2000000", index + 1),
        FREE_USER_ID,
        "tutor_prompt",
        15,
        "free"
      )
    )
  );
  const fullAllowanceSummary = summarizeReserveResults(fullAllowance);
  attachConcurrencyObservation(fullAllowanceSummary, fullAllowance.length);
  assert.deepEqual(fullAllowanceSummary, {
    attempted: 16,
    accepted: 15,
    denied: 1,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });
  assert.equal((await getUsage(sql, FREE_USER_ID)).tutor_prompts_used, 15);

  return {
    oneRemaining: reportSummary(oneRemainingSummary),
    fullAllowance: reportSummary(fullAllowanceSummary),
  };
}

async function runMultipleUsersConcurrency(sql) {
  await clearUserState(sql, FREE_USER_ID, "free", 14);
  await clearUserState(sql, PRO_USER_ID, "pro", 499);

  resetSessionObservation();
  const operations = [
    ...Array.from({ length: 10 }, (_, index) => ({
      user: "free",
      promise: reserve(
        sql,
        reservationId("d3000000", index + 1),
        FREE_USER_ID,
        "tutor_prompt",
        15,
        "free"
      ),
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      user: "pro",
      promise: reserve(
        sql,
        reservationId("d4000000", index + 1),
        PRO_USER_ID,
        "tutor_prompt",
        500,
        "pro"
      ),
    })),
  ];
  const settled = await Promise.allSettled(
    operations.map(async ({ user, promise }) => ({
      user,
      result: await promise,
    }))
  );
  const summary = summarizeReserveResults(settled, (value) => value.result);
  attachConcurrencyObservation(summary, settled.length);
  assert.deepEqual(summary, {
    attempted: 20,
    accepted: 2,
    denied: 18,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });

  const acceptedByUser = { free: 0, pro: 0 };
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.result.allowed) {
      acceptedByUser[result.value.user] += 1;
    }
  }
  assert.deepEqual(acceptedByUser, { free: 1, pro: 1 });
  assert.equal((await getUsage(sql, FREE_USER_ID)).tutor_prompts_used, 15);
  assert.equal((await getUsage(sql, PRO_USER_ID)).tutor_prompts_used, 500);

  return { ...reportSummary(summary), acceptedByUser };
}

async function runMultipleFeaturesConcurrency(sql) {
  await clearUserState(sql, FREE_USER_ID, "free");
  resetSessionObservation();
  const operations = [
    ...Array.from({ length: 16 }, (_, index) => ({
      feature: "tutor_prompt",
      promise: reserve(
        sql,
        reservationId("d5000000", index + 1),
        FREE_USER_ID,
        "tutor_prompt",
        15,
        "free"
      ),
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      feature: "lab_generation",
      promise: reserve(
        sql,
        reservationId("d6000000", index + 1),
        FREE_USER_ID,
        "lab_generation",
        2,
        "free"
      ),
    })),
  ];
  const settled = await Promise.allSettled(
    operations.map(async ({ feature, promise }) => ({
      feature,
      result: await promise,
    }))
  );
  const summary = summarizeReserveResults(settled, (value) => value.result);
  attachConcurrencyObservation(summary, settled.length);
  assert.deepEqual(summary, {
    attempted: 19,
    accepted: 17,
    denied: 2,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });

  const acceptedByFeature = { tutor_prompt: 0, lab_generation: 0 };
  for (const result of settled) {
    if (result.status === "fulfilled" && result.value.result.allowed) {
      acceptedByFeature[result.value.feature] += 1;
    }
  }
  assert.deepEqual(acceptedByFeature, {
    tutor_prompt: 15,
    lab_generation: 2,
  });
  const usage = await getUsage(sql, FREE_USER_ID);
  assert.equal(usage.tutor_prompts_used, 15);
  assert.equal(usage.lab_generations_used, 2);

  return { ...reportSummary(summary), acceptedByFeature };
}

async function runDuplicateReservationConcurrency(sql) {
  await clearUserState(sql, FREE_USER_ID, "free");
  const duplicateId = "d7000000-0000-4000-8000-000000000001";
  resetSessionObservation();
  const settled = await Promise.allSettled(
    Array.from({ length: 10 }, () =>
      reserve(
        sql,
        duplicateId,
        FREE_USER_ID,
        "tutor_prompt",
        15,
        "free"
      )
    )
  );
  const summary = summarizeReserveResults(settled);
  attachConcurrencyObservation(summary, settled.length);
  assert.equal(summary.attempted, 10);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.denied, 0);
  assert.equal(summary.sqlErrors, 9);
  assert.equal(summary.connectionFailures, 0);
  assert.deepEqual(summary.sqlErrorCodes, { "23505": 9 });
  assert.equal((await getUsage(sql, FREE_USER_ID)).tutor_prompts_used, 1);

  const [row] = await sql`
    select count(*)::integer as count
    from public.ai_usage_reservations
    where id = ${duplicateId}::uuid
  `;
  assert.equal(row.count, 1);

  return {
    ...reportSummary(summary),
    reservationRows: row.count,
    consumedQuota: 1,
  };
}

async function runFinalizeVsRelease(sql) {
  await clearUserState(sql, FREE_USER_ID, "free");
  const id = "e1000000-0000-4000-8000-000000000001";
  assert.equal(
    (await reserve(sql, id, FREE_USER_ID, "tutor_prompt", 15, "free")).allowed,
    true
  );
  resetSessionObservation();
  const settled = await Promise.allSettled([
    finalize(sql, id, 20, 10, 0.5),
    release(sql, id),
  ]);
  const summary = summarizeBooleanResults(settled);
  attachConcurrencyObservation(summary, settled.length);
  assert.deepEqual(summary, {
    attempted: 2,
    trueResults: 1,
    falseResults: 1,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });

  const reservation = await getReservation(sql, id);
  const usage = await getUsage(sql, FREE_USER_ID);
  assert.ok(["finalized", "released"].includes(reservation.status));
  if (reservation.status === "finalized") {
    assert.equal(usage.tutor_prompts_used, 1);
    assert.equal(usage.total_tokens, 30);
    assert.equal(Number(usage.estimated_cost), 0.5);
  } else {
    assert.equal(usage.tutor_prompts_used, 0);
    assert.equal(usage.total_tokens, 0);
    assert.equal(Number(usage.estimated_cost), 0);
  }
  return {
    ...reportSummary(summary),
    terminalStatus: reservation.status,
    usage,
  };
}

async function runFinalizeVsFinalize(sql) {
  await clearUserState(sql, FREE_USER_ID, "free");
  const id = "e2000000-0000-4000-8000-000000000001";
  assert.equal(
    (await reserve(sql, id, FREE_USER_ID, "tutor_prompt", 15, "free")).allowed,
    true
  );
  resetSessionObservation();
  const settled = await Promise.allSettled([
    finalize(sql, id, 20, 10, 0.5),
    finalize(sql, id, 20, 10, 0.5),
  ]);
  const summary = summarizeBooleanResults(settled);
  attachConcurrencyObservation(summary, settled.length);
  assert.deepEqual(summary, {
    attempted: 2,
    trueResults: 1,
    falseResults: 1,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });
  const reservation = await getReservation(sql, id);
  const usage = await getUsage(sql, FREE_USER_ID);
  assert.equal(reservation.status, "finalized");
  assert.equal(usage.tutor_prompts_used, 1);
  assert.equal(usage.total_tokens, 30);
  assert.equal(Number(usage.estimated_cost), 0.5);
  return {
    ...reportSummary(summary),
    terminalStatus: reservation.status,
    usage,
  };
}

async function runReleaseVsRelease(sql) {
  await clearUserState(sql, FREE_USER_ID, "free");
  const id = "e3000000-0000-4000-8000-000000000001";
  assert.equal(
    (await reserve(sql, id, FREE_USER_ID, "tutor_prompt", 15, "free")).allowed,
    true
  );
  resetSessionObservation();
  const settled = await Promise.allSettled([
    release(sql, id),
    release(sql, id),
  ]);
  const summary = summarizeBooleanResults(settled);
  attachConcurrencyObservation(summary, settled.length);
  assert.deepEqual(summary, {
    attempted: 2,
    trueResults: 1,
    falseResults: 1,
    sqlErrors: 0,
    connectionFailures: 0,
    sqlErrorCodes: {},
    connectionFailureCodes: {},
  });
  const reservation = await getReservation(sql, id);
  const usage = await getUsage(sql, FREE_USER_ID);
  assert.equal(reservation.status, "released");
  assert.equal(usage.tutor_prompts_used, 0);
  assert.equal(usage.total_tokens, 0);
  assert.equal(Number(usage.estimated_cost), 0);
  return {
    ...reportSummary(summary),
    terminalStatus: reservation.status,
    usage,
  };
}

async function releasePendingReservations(sql) {
  const rows = await sql`
    select id
    from public.ai_usage_reservations
    where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
      and status = 'reserved'
  `;
  for (const row of rows) {
    await release(sql, row.id);
  }
  return rows.length;
}

async function runIntegrityChecks(sql) {
  const [usage] = await sql`
    select
      count(*)::integer as rows,
      count(distinct (user_id, week_start))::integer as distinct_rows,
      count(*) filter (
        where tutor_prompts_used < 0
           or lab_generations_used < 0
           or total_tokens < 0
           or estimated_cost < 0
      )::integer as negative_rows
    from public.ai_usage
    where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
  `;
  const [reservations] = await sql`
    select
      count(*) filter (where status = 'reserved')::integer as pending,
      count(*) filter (
        where status = 'finalized'
          and (finalized_at is null or released_at is not null)
      )::integer as invalid_finalized,
      count(*) filter (
        where status = 'released'
          and (released_at is null or finalized_at is not null)
      )::integer as invalid_released,
      count(*)::integer as rows,
      count(distinct id)::integer as distinct_ids
    from public.ai_usage_reservations
    where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
  `;
  assert.equal(usage.rows, usage.distinct_rows);
  assert.equal(usage.negative_rows, 0);
  assert.equal(reservations.pending, 0);
  assert.equal(reservations.invalid_finalized, 0);
  assert.equal(reservations.invalid_released, 0);
  assert.equal(reservations.rows, reservations.distinct_ids);
  return { usage, reservations };
}

function getFailedReservationIds(error) {
  if (error?.patch1BOperation?.reservationId) {
    return [error.patch1BOperation.reservationId];
  }
  return [
    ...new Set(
      (error?.actual?.[POSTGRES_FAILURES] || [])
        .map(({ reservationId }) => reservationId)
        .filter(Boolean)
    ),
  ];
}

async function captureFailureDatabaseState(sql, error) {
  const usageRows = await sql`
    select
      user_id,
      week_start::text,
      tutor_prompts_used,
      lab_generations_used,
      total_tokens,
      estimated_cost::text,
      plan_snapshot
    from public.ai_usage
    where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
    order by user_id, week_start
  `;
  const [reservationSummary] = await sql`
    select
      count(*)::integer as rows,
      count(distinct id)::integer as distinct_ids,
      count(*) filter (where status = 'reserved')::integer as reserved,
      count(*) filter (where status = 'finalized')::integer as finalized,
      count(*) filter (where status = 'released')::integer as released
    from public.ai_usage_reservations
    where user_id in (${FREE_USER_ID}::uuid, ${PRO_USER_ID}::uuid)
  `;
  const failedReservationAttempts = [];
  for (const reservationId of getFailedReservationIds(error)) {
    const [row] = await sql`
      select
        count(*)::integer as rows,
        count(*) filter (where status = 'reserved')::integer as reserved,
        count(*) filter (where status = 'finalized')::integer as finalized,
        count(*) filter (where status = 'released')::integer as released
      from public.ai_usage_reservations
      where id = ${reservationId}::uuid
    `;
    failedReservationAttempts.push({
      reservationUuidPrefix: reservationId.slice(0, 8),
      ...row,
      inserted: row.rows > 0,
    });
  }

  return {
    usage: usageRows.map(({ user_id: userId, ...row }) => ({
      syntheticUserId: maskSyntheticUserId(userId),
      ...row,
    })),
    reservations: {
      ...reservationSummary,
      allReservationIdsUnique:
        reservationSummary.rows === reservationSummary.distinct_ids,
    },
    failedReservationAttempts,
  };
}

async function verifyConnection(sql, tlsVerification) {
  const [row] = await sql`
    select
      current_database() as database,
      current_user as role
  `;
  assert.equal(
    tlsVerification.negotiated,
    true,
    "The PostgreSQL connection must use SSL."
  );
  return {
    connected: true,
    ssl: {
      requiredByDriver: true,
      negotiatedWithEndpoint: tlsVerification.negotiated,
      certificateAuthorized: tlsVerification.certificateAuthorized,
      certificateAuthorizationError:
        tlsVerification.certificateAuthorizationError,
      verificationMode: tlsVerification.verificationMode,
      protocol: tlsVerification.protocol,
      cipher: tlsVerification.cipher,
    },
    database: row.database,
    role: row.role,
    stagingReferenceMatchedBeforeConnection: true,
  };
}

async function main() {
  const environment = validateEnvironment();
  let dns;
  try {
    dns = await verifyDns(environment.publicReport.hostname);
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          mode: "preflight",
          environment: environment.publicReport,
          dns: {
            attempted: true,
            resolved: false,
            authenticationAttempted: false,
            error: safeError(error),
          },
          summary: "FAIL",
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--preflight-only")) {
    let tls;
    try {
      tls = await verifyPostgresTls(
        environment.publicReport.hostname,
        environment.publicReport.port
      );
    } catch (error) {
      console.error(
        JSON.stringify(
          {
            mode: "preflight-only",
            environment: environment.publicReport,
            dns,
            tls: {
              attempted: true,
              negotiated: false,
              authenticationAttempted: false,
              error: safeError(error),
            },
            authenticationAttempted: false,
            summary: "FAIL",
          },
          null,
          2
        )
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      JSON.stringify(
        {
          mode: "preflight-only",
          environment: environment.publicReport,
          dns,
          tls,
          authenticationAttempted: false,
          summary: "PASS",
        },
        null,
        2
      )
    );
    return;
  }

  let tlsVerification;
  try {
    tlsVerification = await verifyPostgresTls(
      environment.publicReport.hostname,
      environment.publicReport.port
    );
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          mode: "preflight",
          environment: environment.publicReport,
          dns,
          tls: {
            attempted: true,
            negotiated: false,
            authenticationAttempted: false,
            error: safeError(error),
          },
          authenticationAttempted: false,
          summary: "FAIL",
        },
        null,
        2
      )
    );
    process.exitCode = 1;
    return;
  }

  const sql = postgres(environment.connectionString, {
    max: configuredPhysicalPoolSize,
    connect_timeout: 10,
    idle_timeout: 5,
    max_lifetime: 60,
    prepare: false,
    ssl: "require",
    connection: {
      application_name: "amniora_patch_1b4_validation",
    },
  });
  const report = {
    environment: environment.publicReport,
    dns,
    tls: tlsVerification,
    connection: null,
    configuredPhysicalPoolSize,
    tests: {},
    integrity: null,
    cleanup: null,
    summary: "FAIL",
  };
  let failure;

  try {
    report.connection = await withAssertionContext(
      "connection-verification",
      {},
      () => verifyConnection(sql, tlsVerification)
    );
    await seedSyntheticUsers(sql);
    report.tests.reservationConcurrency = await withAssertionContext(
      "reservation-concurrency",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationPrefixes: ["d1000000", "d2000000"],
      },
      () => runReservationConcurrency(sql)
    );
    report.tests.multipleUsers = await withAssertionContext(
      "multiple-users-concurrency",
      {
        syntheticUserIds: [FREE_USER_ID, PRO_USER_ID],
        reservationPrefixes: ["d3000000", "d4000000"],
      },
      () => runMultipleUsersConcurrency(sql)
    );
    report.tests.multipleFeatures = await withAssertionContext(
      "multiple-feature-types-concurrency",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationPrefixes: ["d5000000", "d6000000"],
      },
      () => runMultipleFeaturesConcurrency(sql)
    );
    report.tests.duplicateReservation = await withAssertionContext(
      "duplicate-reservation-uuid-concurrency",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationIds: ["d7000000-0000-4000-8000-000000000001"],
      },
      () => runDuplicateReservationConcurrency(sql)
    );
    report.tests.finalizeVsRelease = await withAssertionContext(
      "finalize-vs-release",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationIds: ["e1000000-0000-4000-8000-000000000001"],
      },
      () => runFinalizeVsRelease(sql)
    );
    report.tests.finalizeVsFinalize = await withAssertionContext(
      "finalize-vs-finalize",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationIds: ["e2000000-0000-4000-8000-000000000001"],
      },
      () => runFinalizeVsFinalize(sql)
    );
    report.tests.releaseVsRelease = await withAssertionContext(
      "release-vs-release",
      {
        syntheticUserIds: [FREE_USER_ID],
        reservationIds: ["e3000000-0000-4000-8000-000000000001"],
      },
      () => runReleaseVsRelease(sql)
    );
    await releasePendingReservations(sql);
    report.integrity = await withAssertionContext(
      "counter-and-reservation-integrity",
      { syntheticUserIds: [FREE_USER_ID, PRO_USER_ID] },
      () => runIntegrityChecks(sql)
    );
    report.summary = "PASS";
  } catch (error) {
    failure = error;
    report.failure = safeError(error);
    if (/^[0-9A-Z]{5}$/.test(String(error?.code || ""))) {
      report.postgresFailure = serializePostgresFailure(error);
    }
    const assertion = serializeAssertion(error);
    if (assertion) report.assertion = assertion;
    try {
      report.failureDatabaseState = await captureFailureDatabaseState(
        sql,
        error
      );
    } catch (stateError) {
      report.failureDatabaseState = {
        captured: false,
        error: {
          ...safeError(stateError),
          postgresFailure: serializePostgresFailure(stateError),
        },
      };
    }
  } finally {
    try {
      await cleanupSyntheticData(sql);
      report.cleanup = await withAssertionContext(
        "synthetic-data-cleanup-verification",
        { syntheticUserIds: [FREE_USER_ID, PRO_USER_ID] },
        () => verifyCleanup(sql)
      );
    } catch (cleanupError) {
      report.cleanup = {
        confirmed: false,
        error: safeError(cleanupError),
        postgresFailure: serializePostgresFailure(cleanupError),
        ...(serializeAssertion(cleanupError)
          ? { assertion: serializeAssertion(cleanupError) }
          : {}),
      };
      failure ||= cleanupError;
      report.summary = "FAIL";
    }
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  console.log(JSON.stringify(report, null, 2));
  if (failure || report.summary !== "PASS") process.exitCode = 1;
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        summary: "FAIL",
        environmentVerified: false,
        authenticationAttempted: false,
        error: safeError(error),
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
