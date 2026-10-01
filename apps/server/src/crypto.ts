import crypto from "node:crypto";
import fs from "node:fs";
import { config, ensureDataDir } from "./config.js";

/**
 * Provider API keys are encrypted at rest with AES-256-GCM.
 * Key comes from ENCRYPTION_KEY (32-byte hex) or is generated once
 * into DATA_DIR/encryption.key for zero-config local development.
 */
let keyBuffer: Buffer | null = null;

function loadKey(): Buffer {
  if (keyBuffer) return keyBuffer;
  ensureDataDir();

  if (config.encryptionKeyHex) {
    const buf = Buffer.from(config.encryptionKeyHex, "hex");
    if (buf.length !== 32) {
      throw new Error("ENCRYPTION_KEY must be a 32-byte hex string (64 hex chars)");
    }
    keyBuffer = buf;
    return keyBuffer;
  }

  if (fs.existsSync(config.keyFilePath)) {
    keyBuffer = Buffer.from(fs.readFileSync(config.keyFilePath, "utf8").trim(), "hex");
    if (keyBuffer.length !== 32) throw new Error("Corrupt encryption key file");
    return keyBuffer;
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(config.keyFilePath, generated.toString("hex"), { mode: 0o600 });
  keyBuffer = generated;
  return keyBuffer;
}

/** Encrypt a secret -> `iv:tag:ciphertext` (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", loadKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64url"), tag.toString("base64url"), enc.toString("base64url")].join(":");
}

export function decryptSecret(payload: string): string {
  const [ivB, tagB, dataB] = payload.split(":");
  // empty ciphertext is valid (encryptSecret("")) — only missing parts are malformed
  if (!ivB || !tagB || dataB === undefined) throw new Error("Malformed encrypted secret");
  const decipher = crypto.createDecipheriv("aes-256-gcm", loadKey(), Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataB, "base64url")), decipher.final()]).toString("utf8");
}

/** Masked display form: sk-***************abcd */
export function maskKey(plain: string): string {
  if (!plain) return "";
  if (plain.length <= 8) return "•".repeat(plain.length);
  const tail = plain.slice(-4);
  return `${plain.slice(0, 3)}${"•".repeat(13)}${tail}`;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function randomId(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}
