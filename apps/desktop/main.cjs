const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fsSync = require("node:fs");
const fs = require("node:fs/promises");
const path = require("node:path");

const devServerUrl = process.env.FARMACIA_WEB_URL || "http://localhost:5173";
const apiPort = Number.parseInt(process.env.FARMACIA_API_PORT || "4000", 10) || 4000;
const apiHealthUrl = `http://127.0.0.1:${apiPort}/health`;

let apiProcess = null;

function resolvePackagedDirectory(relativePath) {
  const appPath = app.isPackaged ? app.getAppPath() : null;
  const candidates = [
    appPath ? path.join(appPath, relativePath) : null,
    path.join(path.dirname(process.execPath), relativePath),
    path.join(process.resourcesPath, relativePath),
  ].filter(Boolean);

  const found = candidates.find((candidate) => fsSync.existsSync(candidate));
  return found ?? candidates[0];
}

function resolvePackagedApiDirectory() {
  const runtimeApiDirectory = resolvePackagedDirectory("runtime/api");
  if (runtimeApiDirectory && fsSync.existsSync(runtimeApiDirectory)) {
    return runtimeApiDirectory;
  }

  return resolvePackagedDirectory("api");
}

function resolveApiSpawnCwd(runtimeDirectory) {
  if (runtimeDirectory.includes(".asar")) {
    return path.dirname(process.execPath);
  }

  return runtimeDirectory;
}

function toApiEnv(overrides = {}) {
  return {
    ...process.env,
    API_HOST: "127.0.0.1",
    PORT: String(apiPort),
    WEB_ORIGINS: "http://localhost:5173,http://127.0.0.1:5173,file://,null",
    ...overrides,
  };
}

function attachApiLifecycleLogging(childProcess, label) {
  childProcess.on("error", (error) => {
    console.error(`[api:${label}] Proceso API fallo al iniciar:`, error);
  });

  childProcess.on("exit", (code, signal) => {
    if (code !== 0) {
      console.error(`[api:${label}] API detenida. code=${code ?? "null"} signal=${signal ?? "null"}`);
    }

    if (apiProcess === childProcess) {
      apiProcess = null;
    }
  });
}

function logApiOutput(childProcess, label) {
  childProcess.stdout?.on("data", (chunk) => {
    process.stdout.write(`[api:${label}] ${chunk}`);
  });

  childProcess.stderr?.on("data", (chunk) => {
    process.stderr.write(`[api:${label}] ${chunk}`);
  });
}

async function waitForApiReady(maxAttempts = 25) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const response = await fetch(apiHealthUrl, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {
      // API aun no esta lista.
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 300);
    });
  }

  return false;
}

async function ensurePackagedDatabase(runtimeDirectory) {
  const userDataDir = app.getPath("userData");
  await fs.mkdir(userDataDir, { recursive: true });

  const userDatabasePath = path.join(userDataDir, "farmacia.db");
  try {
    await fs.access(userDatabasePath);
    return userDatabasePath;
  } catch {
    const seededDatabasePath = path.join(runtimeDirectory, "prisma", "dev.db");
    if (fsSync.existsSync(seededDatabasePath)) {
      try {
        await fs.copyFile(seededDatabasePath, userDatabasePath);
        return userDatabasePath;
      } catch (error) {
        console.warn("No se pudo copiar base seed. Se creara una nueva DB local.", error);
      }
    }

    await fs.writeFile(userDatabasePath, "");

    return userDatabasePath;
  }
}

async function startApiIfRequired() {
  if (await waitForApiReady(2)) {
    return;
  }

  if (!app.isPackaged) {
    const rootDirectory = path.resolve(__dirname, "..", "..");
    apiProcess = spawn("npm", ["run", "dev", "--workspace", "@farmacia/api"], {
      cwd: rootDirectory,
      shell: true,
      env: toApiEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    logApiOutput(apiProcess, "dev");
    attachApiLifecycleLogging(apiProcess, "dev");
    return;
  }

  const runtimeDirectory = resolvePackagedApiDirectory();
  const apiEntryCandidates = [
    path.join(runtimeDirectory, "dist", "index.cjs"),
    path.join(runtimeDirectory, "dist", "index.js"),
  ];
  const apiEntry = apiEntryCandidates.find((candidate) => fsSync.existsSync(candidate));

  if (!apiEntry) {
    throw new Error(
      `No se encontro la API empaquetada en: ${apiEntryCandidates.join(" o ")}`,
    );
  }

  const databasePath = await ensurePackagedDatabase(runtimeDirectory);
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  await fs.mkdir(backupDirectory, { recursive: true });

  apiProcess = spawn(process.execPath, [apiEntry], {
    cwd: resolveApiSpawnCwd(runtimeDirectory),
    shell: false,
    env: toApiEnv({
      ELECTRON_RUN_AS_NODE: "1",
      DATABASE_URL: `file:${databasePath}`,
      BACKUP_DIRECTORY: backupDirectory,
    }),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  logApiOutput(apiProcess, "packaged");
  attachApiLifecycleLogging(apiProcess, "packaged");
}

function stopApiIfOwned() {
  if (!apiProcess || apiProcess.killed) {
    return;
  }

  apiProcess.kill("SIGTERM");
  apiProcess = null;
}

async function createMainWindow() {
  try {
    await startApiIfRequired();
    const ready = await waitForApiReady();
    if (!ready) {
      console.warn("La API local no estuvo lista a tiempo. La UI intentara reconectar.");
    }
  } catch (error) {
    console.error("No fue posible iniciar la API local:", error);
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#f2f6f5",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!app.isPackaged) {
    window.loadURL(devServerUrl).catch((error) => {
      console.error("No se pudo cargar la interfaz web en modo desarrollo:", error);
    });
    return;
  }

  const webDirectory = resolvePackagedDirectory("web");
  const productionHtml = path.join(webDirectory, "index.html");
  if (!fsSync.existsSync(productionHtml)) {
    const html = `
      <html>
        <body style="font-family: Segoe UI, sans-serif; padding: 20px;">
          <h2>Error al iniciar Farmacia</h2>
          <p>No se encontro la interfaz web empaquetada.</p>
          <p>Ruta esperada: ${productionHtml}</p>
        </body>
      </html>
    `;
    window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return;
  }

  window.loadFile(productionHtml).catch((error) => {
    console.error("No se pudo cargar la interfaz web empaquetada:", error);
  });
}

app.whenReady().then(() => {
  void createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  stopApiIfOwned();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopApiIfOwned();
});
