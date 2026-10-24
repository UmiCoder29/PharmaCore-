const Database = require('better-sqlite3-multiple-ciphers');
const path = require('path');
const fs = require('fs');

const appData = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME + '/.config');
const pharmacoreDir = path.join(appData, 'pharmacore');
const dbPath = path.join(pharmacoreDir, 'pharmacore.db');
const keystorePath = path.join(pharmacoreDir, 'keystore.json');

try {
  const ks = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  const masterKey = ks.masterKey;

  const db = new Database(dbPath);
  db.pragma(`key = '${masterKey}'`);
  
  const pending = db.prepare('SELECT * FROM sync_queue').all();
  console.log('SYNC QUEUE:');
  console.log(JSON.stringify(pending, null, 2));

} catch (err) {
  console.error(err);
}
