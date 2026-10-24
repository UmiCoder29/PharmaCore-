import dotenv from 'dotenv';
dotenv.config();

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

import { setApp }              from './electron/paths.js';
import { registerIpcHandlers } from './electron/auth.js';
import { registerAppIpcHandlers } from './electron/api.js';
import { initSupabase }        from './electron/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Register the Electron app object with the shared path resolver so
// localCache.js and offlineQueue.js can find the correct userData directory.
setApp(app);

// ─── Supabase Initialisation ──────────────────────────────────────────────────
// Initialise the Supabase client using environment variables (publishable/anon key only).
initSupabase();

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
