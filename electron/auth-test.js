import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, 'auth-test-data');
process.env._PHARMACORE_TEST_DATA_DIR = TEST_DATA_DIR;

// Clean slate
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

import { 
  checkFirstLaunch, 
  createAdminAccount, 
  loginUser, 
  logoutUser, 
  getCurrentUser 
} from './auth.js';

import { getData } from './db.js';

async function runTests() {
  console.log('--- Auth End-to-End Test ---');

  // 1. Check first launch
  console.log('1. Checking first launch...');
  const isFirst = checkFirstLaunch();
  if (!isFirst) throw new Error('Expected first launch to be true');
  console.log('✅ First launch correctly detected.');

  // 2. Create Admin Account
  const testPassword = 'TestPwd_' + Math.random().toString(36).slice(2) + 'A1!';
  console.log('\n2. Creating Admin Account (username: admin)...');
  const createResult = await createAdminAccount('admin', testPassword);
  if (!createResult.success) throw new Error(`Create admin failed: ${createResult.error}`);
  console.log('✅ Admin account created successfully.');
  
  const currentUser = getCurrentUser();
  if (currentUser?.username !== 'admin') throw new Error('Current user not set correctly after creation');
  console.log(`✅ Current user is ${currentUser.username} (${currentUser.role})`);

  // Verify db has the user
  const dbData = getData();
  if (dbData.users.length !== 1) throw new Error('User not found in DB');
  console.log('✅ User record securely saved in DB.');

  // 3. Simulate closing the app
  console.log('\n3. Simulating app close (logging out and clearing state)...');
  logoutUser();
  if (getCurrentUser() !== null) throw new Error('User should be null after logout');
  
  // Also clear module cache to force a real re-initialization if needed, but logoutUser() clears _db and _key, so it's fine.
  console.log('✅ App closed. Session cleared.');

  // 4. Reopen and try wrong password
  console.log('\n4. Reopening app and testing WRONG password...');
  const wrongLogin = await loginUser('admin', 'WrongPassword_' + Date.now());
  if (wrongLogin.success) throw new Error('Login should have failed!');
  console.log(`✅ Login correctly rejected. Error message: "${wrongLogin.error}"`);

  // 5. Try right password
  console.log('\n5. Testing CORRECT password...');
  const rightLogin = await loginUser('admin', testPassword);
  if (!rightLogin.success) throw new Error(`Login failed: ${rightLogin.error}`);
  console.log(`✅ Login successful! Welcome, ${rightLogin.username} (${rightLogin.role})`);

  // Verify db is accessible
  const reloadedData = getData();
  if (reloadedData.users.length !== 1) throw new Error('Failed to decrypt DB on login');
  console.log('✅ Database successfully decrypted and loaded after login.');

  console.log('\n✅ ALL AUTH TESTS PASSED END-TO-END!');

  // Cleanup
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
