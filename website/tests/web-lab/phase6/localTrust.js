// Historical regression source. Not run by portfolio scripts; see tests/README.md for requirements and limits.
/* eslint-disable @typescript-eslint/no-require-imports -- Phase 6 test-only trust fixture. */
const { createHmac, randomBytes, timingSafeEqual, randomUUID } = require("node:crypto");

// This signer belongs to the synthetic main app. Only verify is passed to the control service.
function localControlTrust(now) {
  const key = randomBytes(32);
  const digest = command => createHmac("sha256", key).update(JSON.stringify({
    audience: command.audience, operation: command.operation, ownerId: command.ownerId,
    sessionId: command.sessionId, resourceId: command.resourceId, requestId: command.requestId,
    idempotencyKey: command.idempotencyKey, issuedAt: command.issuedAt, expiresAt: command.expiresAt,
  })).digest();
  return {
    sign(operation, ownerId, sessionId, resourceId, idempotencyKey = randomUUID()) {
      const issuedAt = now();
      const command = {
        audience: "web-lab-control", operation, ownerId, sessionId, resourceId,
        requestId: randomUUID(), idempotencyKey, issuedAt, expiresAt: issuedAt + 30_000,
      };
      return { ...command, signature: digest(command).toString("base64url") };
    },
    verify(command) {
      if (!command || typeof command.signature !== "string") return false;
      const received = Buffer.from(command.signature, "base64url");
      const expected = digest(command);
      return received.length === expected.length && timingSafeEqual(received, expected);
    },
  };
}

module.exports = { localControlTrust };
