const { app } = require('electron');
const path = require('path');
const { createRequire } = require('module');
const fs = require('fs');

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3-multiple-ciphers');
    const dbPath = path.join(app.getPath('userData'), 'pharmacore-test.db');
    const db = new Database(dbPath);
    console.log('ELECTRON TEST SUCCESS');
    app.quit();
  } catch (err) {
    console.error('ELECTRON TEST FAILED:', err.message);
    app.quit();
    process.exit(1);
  }
});
