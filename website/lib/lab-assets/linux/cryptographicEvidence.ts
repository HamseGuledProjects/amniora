import { createHash } from "crypto";

const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function hashBytes(seed: string, length: number) {
  let state = 2166136261;
  for (const char of seed) {
    state ^= char.charCodeAt(0);
    state = Math.imul(state, 16777619);
  }
  const bytes: number[] = [];
  for (let index = 0; index < length; index += 1) {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    bytes.push((value ^ (value >>> 14)) & 0xff);
  }
  return bytes;
}

export function deterministicPublicKeyBody(seed: string, minLength = 96) {
  const bytes = hashBytes(seed, minLength);
  return bytes.map((byte) => KEY_ALPHABET[byte % KEY_ALPHABET.length]).join("");
}

function sshString(value: string | Buffer) {
  const body = typeof value === "string" ? Buffer.from(value, "ascii") : value;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

function sshMpint(bytes: Buffer) {
  let normalized = Buffer.from(bytes);
  while (normalized.length > 1 && normalized[0] === 0 && (normalized[1] & 0x80) === 0) {
    normalized = normalized.subarray(1);
  }
  if (normalized[0] & 0x80) normalized = Buffer.concat([Buffer.from([0]), normalized]);
  return sshString(normalized);
}

function deterministicBytes(seed: string, length: number) {
  return Buffer.from(hashBytes(seed, length));
}

export function deterministicOpenSshPublicBlob(type: "ssh-ed25519" | "ssh-rsa", seed: string) {
  if (type === "ssh-ed25519") {
    return Buffer.concat([
      sshString(type),
      sshString(deterministicBytes(`ed25519:${seed}`, 32)),
    ]);
  }

  const exponent = Buffer.from([0x01, 0x00, 0x01]);
  const modulus = deterministicBytes(`rsa:${seed}`, 256);
  modulus[0] |= 0x80;
  modulus[modulus.length - 1] |= 0x01;
  return Buffer.concat([
    sshString(type),
    sshMpint(exponent),
    sshMpint(modulus),
  ]);
}

export function fingerprintForPublicBlob(blob: Buffer) {
  return `SHA256:${createHash("sha256").update(blob).digest("base64").replace(/=+$/g, "")}`;
}

export function deterministicFingerprint(type: "ssh-ed25519" | "ssh-rsa", seed: string) {
  return fingerprintForPublicBlob(deterministicOpenSshPublicBlob(type, seed));
}

export function deterministicPublicKey(type: "ssh-ed25519" | "ssh-rsa", seed: string, comment: string) {
  const publicBlob = deterministicOpenSshPublicBlob(type, seed);
  return `${type} ${publicBlob.toString("base64")} ${comment}`;
}

function readSshString(buffer: Buffer, offset: number) {
  if (offset + 4 > buffer.length) return undefined;
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  if (length < 0 || end > buffer.length) return undefined;
  return { value: buffer.subarray(start, end), nextOffset: end };
}

export type ParsedOpenSshPublicKey = {
  algorithm: "ssh-ed25519" | "ssh-rsa";
  blob: Buffer;
  comment: string;
  fingerprintSha256: string;
  options: string[];
};

export function parseOpenSshPublicKeyLine(line: string): ParsedOpenSshPublicKey | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const tokens = trimmed.split(/\s+/);
  const algorithmIndex = tokens.findIndex((token) => token === "ssh-ed25519" || token === "ssh-rsa");
  if (algorithmIndex < 0 || !tokens[algorithmIndex + 1]) return undefined;
  const options = algorithmIndex === 0 ? [] : tokens.slice(0, algorithmIndex);
  if (options.some((option) => !/^(?:[a-z0-9-]+(?:=(?:"[^"]*"|[^,\s]+))?,?)+$/i.test(option))) return undefined;

  let blob: Buffer;
  try {
    blob = Buffer.from(tokens[algorithmIndex + 1], "base64");
  } catch {
    return undefined;
  }
  if (blob.length === 0 || blob.toString("base64").replace(/=+$/g, "") !== tokens[algorithmIndex + 1].replace(/=+$/g, "")) return undefined;

  const algorithmField = readSshString(blob, 0);
  if (!algorithmField) return undefined;
  const internalAlgorithm = algorithmField.value.toString("ascii");
  const externalAlgorithm = tokens[algorithmIndex] as "ssh-ed25519" | "ssh-rsa";
  if (internalAlgorithm !== externalAlgorithm) return undefined;

  if (externalAlgorithm === "ssh-ed25519") {
    const key = readSshString(blob, algorithmField.nextOffset);
    if (!key || key.value.length !== 32 || key.nextOffset !== blob.length) return undefined;
  } else {
    const exponent = readSshString(blob, algorithmField.nextOffset);
    const modulus = exponent ? readSshString(blob, exponent.nextOffset) : undefined;
    if (!exponent || !modulus || exponent.value.length === 0 || modulus.value.length < 128 || modulus.nextOffset !== blob.length) return undefined;
  }

  return {
    algorithm: externalAlgorithm,
    blob,
    comment: tokens.slice(algorithmIndex + 2).join(" "),
    fingerprintSha256: fingerprintForPublicBlob(blob),
    options,
  };
}

export function validatePublicKeyLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/\b(?:KnownHost|ExampleKey|DummyKey|GeneratedKey|Placeholder|AAAAC3NzaShort|WebKey|DbKey|BackupKey)\b/i.test(trimmed)) {
    return false;
  }
  return Boolean(parseOpenSshPublicKeyLine(trimmed));
}
