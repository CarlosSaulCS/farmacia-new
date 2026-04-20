const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

function loadEsbuild(projectRoot) {
  const localEsbuild = path.join(projectRoot, "node_modules", "esbuild");
  return require(localEsbuild);
}

async function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`No se encontro el directorio requerido: ${source}`);
  }

  await fsp.cp(source, destination, {
    recursive: true,
    force: true,
  });
}

async function copyFile(source, destination) {
  if (!fs.existsSync(source)) {
    throw new Error(`No se encontro el archivo requerido: ${source}`);
  }

  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function main() {
  const desktopRoot = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(desktopRoot, "..", "..");
  const apiRoot = path.join(projectRoot, "apps", "api");
  const rootNodeModules = path.join(projectRoot, "node_modules");
  const esbuild = loadEsbuild(projectRoot);

  const runtimeRoot = path.join(desktopRoot, "runtime");
  const runtimeApiRoot = path.join(runtimeRoot, "api");
  const runtimeApiNodeModules = path.join(runtimeApiRoot, "node_modules");

  const apiPrisma = path.join(apiRoot, "prisma");
  const apiPackageJson = path.join(apiRoot, "package.json");
  const prismaClientPackage = path.join(rootNodeModules, "@prisma", "client");
  const generatedPrismaClient = path.join(rootNodeModules, ".prisma");

  await fsp.rm(runtimeApiRoot, { recursive: true, force: true });
  await fsp.mkdir(runtimeApiRoot, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(apiRoot, "src", "index.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    outfile: path.join(runtimeApiRoot, "dist", "index.cjs"),
    external: ["@prisma/client"],
    logLevel: "silent",
  });

  await copyDirectory(apiPrisma, path.join(runtimeApiRoot, "prisma"));
  await copyFile(apiPackageJson, path.join(runtimeApiRoot, "package.json"));
  await copyDirectory(
    prismaClientPackage,
    path.join(runtimeApiNodeModules, "@prisma", "client"),
  );
  await copyDirectory(
    generatedPrismaClient,
    path.join(runtimeApiNodeModules, ".prisma"),
  );

  console.log("Runtime API preparado en apps/desktop/runtime/api");
}

main().catch((error) => {
  console.error("No se pudo preparar runtime desktop:", error);
  process.exit(1);
});
