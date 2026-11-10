// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated real product-package fixture. */
"use strict";
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { generateKeyPairSync, randomBytes } = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const { promisify } = require("node:util");
const postgres = require("postgres");

const originalLoad = Module._load;
Module._load = function serverOnlyFixture(specifier, parent, isMain) {
  if (specifier === "server-only") return {};
  return originalLoad.call(this, specifier, parent, isMain);
};

require("../phase15a/loadRunner");
const {
  learnerSavedLab,
  planExecutableWebSpec,
  saveExecutableWebGeneration,
} = require("../../../lib/web-lab/generated-executable-lab.ts");
const { PostgresExecutableWebSaveStore } = require("../../../lib/web-lab/generated-executable-postgres.ts");
const { PostgresWebLabControlRepository } = require("../../../lib/web-lab/postgres-control-repository.ts");
const { LocalRunnerProductService } = require("../../../lib/web-lab/local-runner-product-service.ts");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../../..");
const DATABASE_NAME = "amniora_phase16a2b1_test";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const JOB_ID = "a28f4371-4a6e-459e-882c-1efc96f23f89";
const KEY_ID = "phase16a2b1-ephemeral-ed25519";

async function docker(...args) {
  const result = await execFileAsync("docker", args, { cwd: ROOT, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

async function waitForPostgres(containerName) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await docker("exec", containerName, "pg_isready", "-U", "postgres", "-d", DATABASE_NAME);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("disposable_postgres_not_ready");
}

async function applySchema(db) {
  await db.unsafe(`
    create extension if not exists pgcrypto;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table auth.users (id uuid primary key);
    create table public.labs (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references auth.users(id) on delete cascade,
      title text not null default 'Fixture lab',
      topic text not null,
      difficulty text not null default 'Beginner',
      estimated_time text not null default '30 mins',
      objective text not null default '',
      scenario text not null default '',
      tasks jsonb not null default '[]'::jsonb,
      hints jsonb not null default '[]'::jsonb,
      outcomes jsonb not null default '[]'::jsonb,
      completed boolean not null default false
    );
    create table public.ai_usage_reservations (id uuid primary key default gen_random_uuid());
  `);
  for (const relative of [
    "supabase/migrations/20260901090000_lab_generation_jobs.sql",
    "supabase/migrations/20260922211651_web_lab_control_plane_persistence.sql",
    "supabase/migrations/20260922215508_web_lab_launch_grant_exchange.sql",
  ]) await db.unsafe(fs.readFileSync(path.join(ROOT, relative), "utf8"));
}

async function waitForExternalDatabase(db) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      await db`select 1 as ready`;
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  throw lastError || new Error("disposable_postgres_external_connection_not_ready");
}

async function issueRealProductPackage() {
  const suffix = randomBytes(6).toString("hex");
  const containerName = `amniora-phase16a2b1-postgres-${process.pid}-${suffix}`;
  const password = randomBytes(24).toString("base64url");
  let db;
  try {
    await docker("run", "-d", "--name", containerName,
      "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${DATABASE_NAME}`,
      "-p", "127.0.0.1::5432", "postgres:17-alpine");
    await waitForPostgres(containerName);
    const binding = await docker("port", containerName, "5432/tcp");
    const match = /^127\.0\.0\.1:(\d+)$/.exec(binding);
    if (!match) throw new Error("disposable_postgres_not_loopback");
    db = postgres(`postgres://postgres:${password}@127.0.0.1:${match[1]}/${DATABASE_NAME}`, {
      max: 6,
      prepare: false,
      connect_timeout: 5,
    });
    await waitForExternalDatabase(db);
    await applySchema(db);
    await db`insert into auth.users (id) values (${OWNER_ID})`;
    await db`
      insert into public.lab_generation_jobs (id, user_id, category, difficulty, duration, status, started_at)
      values (${JOB_ID}, ${OWNER_ID}, 'Web Security', 'Beginner', '30 mins', 'generating', now())
    `;
    const expectedSpec = planExecutableWebSpec(JOB_ID, OWNER_ID);
    assert.equal(expectedSpec.templateId, "ecommerce");
    assert.equal(expectedSpec.vulnerability.moduleId, "stored-xss");
    const saveStore = new PostgresExecutableWebSaveStore(db);
    const saved = await saveExecutableWebGeneration(saveStore, JOB_ID, OWNER_ID);
    assert.equal(saved.replayed, false);
    await db`
      update public.lab_generation_jobs
      set status = 'completed', completed_at = now(), updated_at = now()
      where id = ${JOB_ID} and user_id = ${OWNER_ID} and resulting_lab_id = ${saved.savedLabId}
    `;
    const repository = new PostgresWebLabControlRepository(db);
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const service = new LocalRunnerProductService({
      repository,
      signingAuthority: () => ({ keyId: KEY_ID, privateKey }),
    });
    const actor = { userId: OWNER_ID, sessionId: "phase16a2b1-product-session" };
    const pkg = await service.issuePackage(actor, saved.savedLabId);
    assert.equal(pkg.buildId, saved.build.id);
    assert.equal(pkg.buildFingerprint, saved.build.buildFingerprint);
    assert.equal(pkg.templateId, "ecommerce");
    assert.equal(pkg.vulnerabilityModuleId, "stored-xss");
    assert.deepEqual(learnerSavedLab(OWNER_ID, expectedSpec).user_id, OWNER_ID);
    return {
      ownerId: OWNER_ID,
      savedLabId: saved.savedLabId,
      build: saved.build,
      expectedSpec,
      package: pkg,
      verificationConfig: {
        schemaVersion: 1,
        keys: [{ keyId: KEY_ID, publicKey: publicKey.export({ type: "spki", format: "pem" }).toString() }],
      },
      async cleanup() {
        if (db) await db.end({ timeout: 5 }).catch(() => undefined);
        await docker("rm", "-f", containerName).catch(() => undefined);
      },
    };
  } catch (error) {
    if (db) await db.end({ timeout: 5 }).catch(() => undefined);
    await docker("rm", "-f", containerName).catch(() => undefined);
    throw error;
  }
}

module.exports = { issueRealProductPackage };
