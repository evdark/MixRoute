import path from "node:path";
import fs from "node:fs";

function env(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

const DATA_DIR = path.resolve(env("DATA_DIR", "./.data"));

export const config = {
  port: Number(env("PORT", "3000")),
  host: env("HOST", "0.0.0.0"),
  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, "mixroute.db"),
  keyFilePath: path.join(DATA_DIR, "encryption.key"),
  encryptionKeyHex: env("ENCRYPTION_KEY", ""),
  adminPassword: env("ADMIN_PASSWORD", "admin"),
  corsOrigins: env("CORS_ORIGINS", "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  bodyLimit: 4 * 1024 * 1024, // 4 MB request size limit
  env: env("NODE_ENV", "development"),
};

export function ensureDataDir(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
}
