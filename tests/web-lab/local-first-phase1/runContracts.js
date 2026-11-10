#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated Phase 1 contract harness. */
"use strict";
const assert = require("node:assert/strict");
const { generateKeyPairSync, randomBytes, sign } = require("node:crypto");
const { inspect } = require("node:util");
const phase1 = require("./loadLocalFirstRunner");

const ACCOUNT_A = "account_phase1_alpha";
const ACCOUNT_B = "account_phase1_bravo";

function identity() {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return { ...pair, publicKeyPem: publicKey, installationId: phase1.installationIdForPublicKey(publicKey) };
}

function codeValue() { return randomBytes(32).toString("base64url"); }

function pair(pairings, runner, accountId) {
  const codeVerifier = codeValue();
  const state = codeValue();
  const started = pairings.begin({
    protocolVersion: phase1.LOCAL_FIRST_PROTOCOL_VERSION,
    audience: phase1.LOCAL_FIRST_AUDIENCE,
    installationId: runner.installationId,
    publicKey: runner.publicKeyPem,
    codeChallenge: phase1.pkceChallenge(codeVerifier),
    state,
    redirectUri: "com.amniora.runner:/pair",
  });
  const approved = pairings.approve({
    authorizationRequestId: started.authorizationRequestId,
    authenticatedAccountId: accountId,
    approved: true,
  });
  return pairings.complete({
    protocolVersion: phase1.LOCAL_FIRST_PROTOCOL_VERSION,
    audience: phase1.LOCAL_FIRST_AUDIENCE,
    authorizationRequestId: started.authorizationRequestId,
    authorizationCode: approved.authorizationCode,
    installationId: runner.installationId,
    codeVerifier,
    state,
    redirectUri: approved.redirectUri,
  });
}

function ticketFrom(issue) {
  assert.ok(issue.activationUri);
  const uri = new URL(issue.activationUri);
  assert.equal(uri.protocol, "com.amniora.runner:");
  assert.equal(uri.pathname, "/activate");
  assert.deepEqual([...uri.searchParams.keys()], ["ticket"]);
  assert.match(uri.searchParams.get("ticket"), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Buffer.byteLength(issue.activationUri) <= phase1.LOCAL_FIRST_MAX_URI_BYTES);
  for (const forbidden of ["account", "operation", "build", "runtime", "host", "port", "credential"]) {
    assert.equal(issue.activationUri.toLowerCase().includes(forbidden), false, `URI exposed ${forbidden}`);
  }
  return uri.searchParams.get("ticket");
}

function redeemRequest(runner, ticket, now, overrides = {}) {
  const request = {
    protocolVersion: phase1.LOCAL_FIRST_PROTOCOL_VERSION,
    audience: phase1.LOCAL_FIRST_AUDIENCE,
    ticket,
    installationId: runner.installationId,
    clientNonce: codeValue(),
    signedAt: now,
  };
  return { ...request, proof: sign(null, phase1.redeemProofBytes(request), runner.privateKey).toString("base64url"), ...overrides };
}

function resultRequest(runner, command, now, overrides = {}) {
  const request = {
    protocolVersion: phase1.LOCAL_FIRST_PROTOCOL_VERSION,
    audience: phase1.LOCAL_FIRST_AUDIENCE,
    requestId: command.requestId,
    commandId: command.commandId,
    installationId: runner.installationId,
    operation: command.operation,
    nonce: command.nonce,
    completedAt: now,
    result: { status: "AVAILABLE", runnerVersion: "0.1.0-phase1", platform: "macOS" },
    ...overrides,
  };
  return { ...request, proof: sign(null, phase1.resultProofBytes(request), runner.privateKey).toString("base64url") };
}

async function expectCode(operation, code) {
  await assert.rejects(Promise.resolve().then(operation), error => error?.code === code, code);
}

async function pairingContracts() {
  let clock = 1_800_000_000_000;
  const pairings = new phase1.InMemoryPairingService(() => clock, 2_000);
  const runner = identity();
  const verifier = codeValue();
  const state = codeValue();
  const started = pairings.begin({
    protocolVersion: "1.0", audience: phase1.LOCAL_FIRST_AUDIENCE,
    installationId: runner.installationId, publicKey: runner.publicKeyPem,
    codeChallenge: phase1.pkceChallenge(verifier), state, redirectUri: "com.amniora.runner:/pair",
  });
  const approval = pairings.approve({ authorizationRequestId: started.authorizationRequestId,
    authenticatedAccountId: ACCOUNT_A, approved: true });
  await expectCode(() => pairings.complete({ protocolVersion: "1.0", audience: phase1.LOCAL_FIRST_AUDIENCE,
    authorizationRequestId: started.authorizationRequestId, authorizationCode: approval.authorizationCode,
    installationId: runner.installationId, codeVerifier: codeValue(), state,
    redirectUri: "com.amniora.runner:/pair" }), "PKCE_INVALID");
  const paired = pairings.complete({ protocolVersion: "1.0", audience: phase1.LOCAL_FIRST_AUDIENCE,
    authorizationRequestId: started.authorizationRequestId, authorizationCode: approval.authorizationCode,
    installationId: runner.installationId, codeVerifier: verifier, state,
    redirectUri: "com.amniora.runner:/pair" });
  assert.equal(paired.accountId, ACCOUNT_A);
  assert.equal(paired.publicKey, runner.publicKeyPem);
  assert.equal(inspect(pairings, { depth: 6 }).includes(approval.authorizationCode), false,
    "raw authorization code retained");
  await expectCode(() => pairings.complete({ protocolVersion: "1.0", audience: phase1.LOCAL_FIRST_AUDIENCE,
    authorizationRequestId: started.authorizationRequestId, authorizationCode: approval.authorizationCode,
    installationId: runner.installationId, codeVerifier: verifier, state,
    redirectUri: "com.amniora.runner:/pair" }), "PAIRING_REPLAYED");

  const expiring = identity();
  const expiringVerifier = codeValue();
  const expiringState = codeValue();
  const expiringRequest = pairings.begin({ protocolVersion: "1.0", audience: phase1.LOCAL_FIRST_AUDIENCE,
    installationId: expiring.installationId, publicKey: expiring.publicKeyPem,
    codeChallenge: phase1.pkceChallenge(expiringVerifier), state: expiringState,
    redirectUri: "com.amniora.runner:/pair" });
  clock += 2_000;
  await expectCode(() => pairings.approve({ authorizationRequestId: expiringRequest.authorizationRequestId,
    authenticatedAccountId: ACCOUNT_A, approved: true }), "PAIRING_EXPIRED");
  return { pairings, runner };
}

async function ticketContracts() {
  let clock = 1_900_000_000_000;
  const pairings = new phase1.InMemoryPairingService(() => clock);
  const runnerA = identity();
  const runnerB = identity();
  const attacker = identity();
  pair(pairings, runnerA, ACCOUNT_A);
  pair(pairings, runnerB, ACCOUNT_B);
  const tickets = new phase1.InMemoryCommandTicketService(pairings, () => clock, 45_000);

  const issueInput = { accountId: ACCOUNT_A, installationId: runnerA.installationId, operation: "STATUS",
    buildId: null, runtimeId: null, generation: null, idempotencyKey: "phase1-status-idempotency-0001" };
  const first = await tickets.issue(issueInput);
  const firstTicket = ticketFrom(first);
  assert.equal(inspect(tickets, { depth: 8 }).includes(firstTicket), false, "raw command ticket retained");

  const retry = await tickets.issue(issueInput);
  assert.equal(retry.requestId, first.requestId, "idempotency retry retained logical request");
  const activeTicket = ticketFrom(retry);
  await expectCode(() => tickets.redeem(redeemRequest(runnerA, firstTicket, clock)), "TICKET_INVALID");
  await expectCode(() => tickets.issue({ ...issueInput, buildId: "build_tampered_0001" }), "IDEMPOTENCY_CONFLICT");
  await expectCode(() => tickets.issue({ ...issueInput, operation: "LAUNCH", idempotencyKey: "phase1-launch-disabled-001" }),
    "OPERATION_NOT_ENABLED");

  const randomTicket = codeValue();
  await expectCode(() => tickets.redeem(redeemRequest(runnerA, randomTicket, clock)), "TICKET_INVALID");
  await expectCode(() => tickets.redeem(redeemRequest(runnerB, activeTicket, clock)), "RUNNER_MISMATCH");
  await expectCode(() => tickets.redeem(redeemRequest(attacker, activeTicket, clock,
    { installationId: runnerA.installationId })), "PROOF_INVALID");
  await expectCode(() => tickets.redeem({ ...redeemRequest(runnerA, activeTicket, clock), accountId: ACCOUNT_B }),
    "REQUEST_INVALID");
  await expectCode(() => tickets.redeem({ ...redeemRequest(runnerA, activeTicket, clock), operation: "LAUNCH" }),
    "REQUEST_INVALID");
  await expectCode(() => tickets.redeem({ ...redeemRequest(runnerA, activeTicket, clock), buildId: "build_changed_0001" }),
    "REQUEST_INVALID");
  await expectCode(() => tickets.redeem({ ...redeemRequest(runnerA, activeTicket, clock), runtimeId: "runtime_changed_01",
    generation: 2 }), "REQUEST_INVALID");
  await expectCode(() => tickets.redeem({ ...redeemRequest(runnerA, activeTicket, clock), protocolVersion: "99.0" }),
    "PROTOCOL_VERSION_UNSUPPORTED");

  const valid = redeemRequest(runnerA, activeTicket, clock);
  const raced = await Promise.allSettled([tickets.redeem(valid), tickets.redeem(valid)]);
  assert.equal(raced.filter(item => item.status === "fulfilled").length, 1, "exactly one atomic redemption succeeded");
  assert.equal(raced.filter(item => item.status === "rejected" && item.reason?.code === "TICKET_REPLAYED").length, 1,
    "the racing redemption was denied as replay");
  const command = raced.find(item => item.status === "fulfilled").value;
  assert.deepEqual({ operation: command.operation, buildId: command.buildId, runtimeId: command.runtimeId,
    generation: command.generation }, { operation: "STATUS", buildId: null, runtimeId: null, generation: null });
  assert.equal((await tickets.issue(issueInput)).activationUri, null, "idempotent retry cannot reactivate consumed ticket");

  const result = resultRequest(runnerA, command, clock + 1);
  await expectCode(() => tickets.submitResult({ ...result, operation: "LAUNCH" }), "RESULT_INVALID");
  await expectCode(() => tickets.submitResult({ ...result, runtimeId: "runtime_changed_01" }), "RESULT_INVALID");
  const completed = await tickets.submitResult(result);
  assert.equal(completed.state, "completed");
  assert.equal((await tickets.submitResult(result)).state, "completed", "identical signed result replay is idempotent");
  const changedResult = resultRequest(runnerA, command, clock + 2,
    { result: { status: "AVAILABLE", runnerVersion: "0.1.1-phase1", platform: "macOS" } });
  await expectCode(() => tickets.submitResult(changedResult), "RESULT_REPLAYED");
  assert.deepEqual(tickets.observe(ACCOUNT_A, command.requestId).result, result.result);
  await expectCode(() => tickets.observe(ACCOUNT_B, command.requestId), "ACCOUNT_MISMATCH");

  const expiredIssue = await tickets.issue({ ...issueInput, idempotencyKey: "phase1-expired-ticket-0001" });
  const expiredTicket = ticketFrom(expiredIssue);
  clock += 45_000;
  await expectCode(() => tickets.redeem(redeemRequest(runnerA, expiredTicket, clock)), "TICKET_EXPIRED");

  const revokedIssue = await tickets.issue({ ...issueInput, idempotencyKey: "phase1-revoked-ticket-0001" });
  const revokedTicket = ticketFrom(revokedIssue);
  pairings.revoke(ACCOUNT_A, runnerA.installationId);
  await expectCode(() => tickets.redeem(redeemRequest(runnerA, revokedTicket, clock)), "PAIRING_REVOKED");
}

async function main() {
  await pairingContracts();
  await ticketContracts();
  process.stdout.write("Local-first Phase 1 protocol contracts: PASS (PKCE pairing, Ed25519 proof, atomic one-use tickets, replay/tamper/cross-account denial, revocation)\n");
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
