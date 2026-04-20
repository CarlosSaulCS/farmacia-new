import fsSync from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

declare const require: NodeJS.Require | undefined;

const localRequire =
  typeof require === "function" ? require : createRequire(import.meta.url);

export function loadPrismaClientPackage(): typeof import("@prisma/client") {
  const packagedCandidate = path.resolve(
    process.cwd(),
    "api",
    "node_modules",
    "@prisma",
    "client",
  );
  const packagedCandidateEntry = path.join(packagedCandidate, "index.js");

  if (fsSync.existsSync(packagedCandidateEntry)) {
    return localRequire(packagedCandidate) as typeof import("@prisma/client");
  }

  return localRequire("@prisma/client") as typeof import("@prisma/client");
}
