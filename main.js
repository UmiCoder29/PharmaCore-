import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { app, BrowserWindow, ipcMain, dialog } from 'electron';

import { setApp, getDataDir }   from './electron/paths.js';
import { initAppConfig }        from './electron/config.js';
import { registerIpcHandlers }  from './electron/auth.js';
import { registerAppIpcHandlers } from './electron/api.js';
import { initSupabase }         from './electron/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Register the Electron app object with the shared path resolver so
// localCache.js and offlineQueue.js can find the correct userData directory.
setApp(app);

// At startup, if an old db-config.json exists in the user data folder, delete it.
try {
  const legacyDbConfig = path.join(getDataDir(), 'db-config.json');
  if (fs.existsSync(legacyDbConfig)) {
    fs.unlinkSync(legacyDbConfig);
    console.log('[Startup] Removed legacy db-config.json from userData directory.');
  }
} catch (err) {
  console.warn('[Startup] Could not remove legacy db-config.json:', err.message);
}

function startApplication() {
  // Register all auth IPC handlers (auth:login, auth:logout, auth:create-user, etc.)
  registerIpcHandlers(ipcMain);

  // Register app business logic IPC handlers (Medicines, Suppliers, Users, POS)
  registerAppIpcHandlers(ipcMain);

  function createWindow() {
    const mainWindow = new BrowserWindow({
      width: 1280,
      height: 820,
      icon: path.join(__dirname, 'electron', 'assets', 'icon.png'),
      webPreferences: {
        preload:          path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
      },
      title: 'PharmaCore ERP + POS',
    });

    const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

    if (isDev) {
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools();
    } else {
      mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
    }
  }

  app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// ─── Supabase Configuration & Initialisation ─────────────────────────────────
// If initAppConfig or initSupabase throws, stop startup completely:
// do not register any IPC handler or create any window; show error dialog, then exit(1).
try {
  initAppConfig(app.isPackaged);
  initSupabase();
  startApplication();
} catch (err) {
  console.error('\n[PharmaCore Startup Error]', err.message);
  dialog.showErrorBox('PharmaCore Configuration Error', err.message);
  app.exit(1);
}
