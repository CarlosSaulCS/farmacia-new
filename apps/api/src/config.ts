import "dotenv/config";

const parsedPort = Number.parseInt(process.env.PORT ?? "4000", 10);
const parsedHost = process.env.API_HOST?.trim();
const parsedBackupInterval = Number.parseInt(
  process.env.BACKUP_INTERVAL_MINUTES ?? "30",
  10,
);
const parsedBackupRetention = Number.parseInt(
  process.env.BACKUP_RETENTION_DAYS ?? "15",
  10,
);

export const config = {
  apiHost: parsedHost && parsedHost.length > 0 ? parsedHost : "127.0.0.1",
  port: Number.isNaN(parsedPort) ? 4000 : parsedPort,
  webOrigins:
    process.env.WEB_ORIGINS ??
    "http://localhost:5173,http://127.0.0.1:5173,file://,null",
  databaseUrl: process.env.DATABASE_URL ?? "file:./dev.db",
  aionUrl: process.env.AION_URL?.trim() ?? "",
  aionApiKey: process.env.AION_API_KEY?.trim() ?? "",
  backupEnabled: process.env.BACKUP_ENABLED?.trim().toLowerCase() !== "false",
  backupDirectory: process.env.BACKUP_DIRECTORY?.trim() ?? "",
  backupIntervalMinutes: Number.isNaN(parsedBackupInterval)
    ? 30
    : Math.max(1, parsedBackupInterval),
  backupRetentionDays: Number.isNaN(parsedBackupRetention)
    ? 15
    : Math.max(1, parsedBackupRetention),
};
