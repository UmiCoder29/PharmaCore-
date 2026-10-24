import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

import { setApp } from './electron/paths.js';
import { prepareAdminAccount, finalizeAdminAccount, checkFirstLaunch } from './electron/auth.js';

setApp({
  getPath: (name) => {
    return 'C:\\Users\\OCS\\AppData\\Roaming\\pharmacore';
  }
});

async function run() {
  try {
    // 1. Clean up first
    const dataDir = 'C:\\Users\\OCS\\AppData\\Roaming\\pharmacore';
    if (fs.existsSync(path.join(dataDir, 'keystore.json'))) {
      fs.unlinkSync(path.join(dataDir, 'keystore.json'));
    }
    if (fs.existsSync(path.join(dataDir, 'pharmacore.db'))) {
      fs.unlinkSync(path.join(dataDir, 'pharmacore.db'));
      if (fs.existsSync(path.join(dataDir, 'pharmacore.db-wal'))) fs.unlinkSync(path.join(dataDir, 'pharmacore.db-wal'));
      if (fs.existsSync(path.join(dataDir, 'pharmacore.db-shm'))) fs.unlinkSync(path.join(dataDir, 'pharmacore.db-shm'));
    }

    console.log('First launch?', checkFirstLaunch());

    const testPwd = crypto.randomUUID();
    console.log('Preparing admin...');
    const prep = await prepareAdminAccount('adminuser', testPwd, 'Main Branch');
    console.log('Prep result:', prep);

    if (prep.success) {
      console.log('Finalizing admin...');
      const final = await finalizeAdminAccount('adminuser', 'Main Branch');
      console.log('Final result:', final);
    }
  } catch (err) {
    console.error('Test crashed:');
    console.error(err.stack);
  }
}

run();
