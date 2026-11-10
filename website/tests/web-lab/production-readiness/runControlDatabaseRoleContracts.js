#!/usr/bin/env node
// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Scoped offline SQL contract. */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../..");
const migrations = path.join(ROOT, "supabase/migrations");
const name = fs.readdirSync(migrations)
  .find(file => file.endsWith("_web_lab_control_runtime_role.sql"));
assert.ok(name, "control database role migration exists");
const sql = fs.readFileSync(path.join(migrations, name), "utf8").toLowerCase();
const helper = fs.readFileSync(
  path.join(ROOT, "scripts/production/configure-phase9-shared-controls.zsh"),
  "utf8",
);

for (const required of [
  "nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls",
  "grant connect on database",
  "grant usage on schema public, web_lab_control",
  "grant select (id, plan) on table public.profiles",
  "grant select (id) on table public.labs",
  "grant update (resulting_lab_id, updated_at)",
  "web_lab_control.web_lab_builds",
  "web_lab_control.security_rate_limit_windows",
  "web_lab_control.security_rate_limit_requests",
  "to amniora_web_lab_control",
]) {
  assert.ok(sql.includes(required), `migration retains ${required}`);
}

for (const forbidden of [
  "grant all",
  "grant create",
  "grant temporary",
  "grant truncate",
  "grant delete",
  "grant references",
  "grant trigger",
  "service_role to amniora_web_lab_control",
  "authenticated to amniora_web_lab_control",
]) {
  assert.equal(sql.includes(forbidden), false, `migration excludes ${forbidden}`);
}
assert.equal(/(^|\s)bypassrls(\s|;)/.test(sql), false, "role cannot bypass RLS");
assert.equal(/(^|\s)superuser(\s|;)/.test(sql), false, "role is not superuser");

const policies = [...sql.matchAll(/create policy (amniora_control_[a-z_]+)/g)]
  .map(match => match[1]);
assert.equal(new Set(policies).size, 13, "thirteen exact role-scoped RLS policies");
assert.equal(policies.length, 13, "no duplicate role-scoped RLS policies");

for (const required of [
  "--clipboard-password",
  "openssl rand -base64 36",
  "printf '%s' \"$control_password\" | pbcopy",
  "[YOUR-PASSWORD]",
  "POOLER_TEMPLATE_READY",
  'open -a Safari "https://supabase.com/dashboard/project/${linked_project}"',
  ".pooler.supabase.com:",
  ":6543/",
  "postgresql://amniora_web_lab_control.",
  "postgres://amniora_web_lab_control.",
  "CONNECTION_URL_READY",
  "printf '' | pbcopy",
  "--force --yes --scope amniora --project amniora",
]) {
  assert.ok(helper.includes(required), `secure helper retains ${required}`);
}
assert.equal(
  helper.includes('echo "$control_password"'),
  false,
  "secure helper never prints the generated password",
);
assert.equal(
  helper.includes("\\/\\/amniora_web_lab_control."),
  false,
  "connection URL transformation never inserts literal backslashes",
);

process.stdout.write("Control database role contracts PASS (least privilege and RLS)\n");
