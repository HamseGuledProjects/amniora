/**
 * ==========================================================
 * CyberLab AI Safety Service
 * ==========================================================
 * Central safety checks before any AI request.
 * Every AI feature uses this.
 * ==========================================================
 */

export type SafetyResult = {
  allowed: boolean;
  reason?: string;
};

const BLOCKED_PATTERNS = [
  /rape/i,
  /sexual assault/i,
  /suicide/i,
  /self[-\s]?harm/i,
  /kill myself/i,
  /murder/i,
  /terror/i,
  /bomb/i,
  /school shooting/i,
  /child abuse/i,
  /csam/i,

  /create.*ransomware/i,
  /write.*malware/i,
  /build.*malware/i,
  /steal.*password/i,
  /steal.*credentials/i,
  /phishing.*kit/i,
  /bypass.*authentication/i,
  /ddos/i,
  /botnet/i,
  /keylogger/i,
  /persistence/i,
  /evade.*detection/i,
  /exploit.*real/i,
  /ignore.*instructions/i,
/ignore.*previous/i,
/ignore.*system/i,
/system.*prompt/i,
/developer.*message/i,
/jailbreak/i,
/prompt injection/i,
/act as/i,
/pretend/i,
/roleplay/i,
/dan mode/i,
/kill/i,
/harm.*people/i,
/hurt.*people/i,
/attack.*people/i,
];

const CYBER_KEYWORDS = [
  "cyber",
  "cybersecurity",
  "security",
  "linux",
  "network",
  "networking",
  "wireshark",
  "nmap",
  "web security",
  "sql",
  "xss",
  "csrf",
  "cryptography",
  "forensics",
  "osint",
  "cloud",
  "logs",
  "permissions",
  "firewall",
  "dns",
  "http",
  "https",
  "tcp",
  "udp",
  "ip",
  "malware analysis",
  "authentication",
  "authorization",
  "vulnerability",
  "threat",
  "risk",
  "incident",
  "soc",
  "siem",
  "encryption",
  "hashing",
  "password",
  "ssh",
  "ports",
  "subnet",
  "packet",
  "headers",
  "owasp",
  "burp",
  "defensive",
  "blue team",
  "red team",
  "ctf",
  "lab",
  "terminal",
  "bash",
  "powershell",
  "windows security",
  "active directory",
  "privilege",
  "access control",
  "hardening",
  "audit",
];

export function checkSafety(message: string): SafetyResult {
  const input = message.trim();

  if (!input) {
    return { allowed: false, reason: "Message cannot be empty." };
  }

  if (input.length > 8000) {
    return { allowed: false, reason: "Message is too long." };
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(input)) {
      return {
        allowed: false,
        reason: "This request violates CyberLab AI safety rules. Continuation of this could result in a permanent deletion of your account.",
      };
    }
  }

  return { allowed: true };
}

export function checkCybersecurityScope(message: string): SafetyResult {
  const input = message.toLowerCase();

  const isCyberRelated = CYBER_KEYWORDS.some((keyword) =>
    input.includes(keyword)
  );

  if (!isCyberRelated) {
    return {
      allowed: false,
      reason:
        "CyberLab AI only supports cybersecurity learning, labs, Linux, networking, web security, cloud security, forensics, cryptography, and defensive security topics.",
    };
  }

  return { allowed: true };
}