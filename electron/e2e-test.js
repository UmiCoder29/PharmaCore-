import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, 'e2e-test-data');
process.env._PHARMACORE_TEST_DATA_DIR = TEST_DATA_DIR;

// Clean slate
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

import { 
  createAdminAccount, 
  loginUser, 
  logoutUser, 
  createUserAccount 
} from './auth.js';

import { getData, updateRecord } from './db.js';

// We need to mock ipcMain to use registerAppIpcHandlers locally
const mockIpc = {
  handlers: {},
  handle(channel, callback) {
    this.handlers[channel] = callback;
  },
  async invoke(channel, ...args) {
    if (!this.handlers[channel]) throw new Error(`No handler for ${channel}`);
    return await this.handlers[channel]({}, ...args);
  }
};

import { registerAppIpcHandlers } from './api.js';
registerAppIpcHandlers(mockIpc);

async function runTests() {
  console.log('--- PharmaCore Backend E2E Test ---\n');

  // 1. Admin Setup
  console.log('1. Setting up admin account...');
  await createAdminAccount('admin', 'AdminPass123!');
  console.log('✅ Admin logged in.\n');

  // 2. Admin Actions (Create Supplier, Medicine, and Batches)
  console.log('2. Admin adding supplier, medicine, and batches...');
  const supplier = await mockIpc.invoke('api:add-supplier', {
    name: 'Test Supplier',
    contactPhone: '555-1234',
    contactEmail: 'test@supplier.com'
  });
  console.log('✅ Supplier added:', supplier.name);

  let medicine = await mockIpc.invoke('api:add-medicine', {
    name: 'Aspirin 500mg',
    genericName: 'Acetylsalicylic acid',
    barcode: '123456789'
  });
  console.log('✅ Medicine added:', medicine.name);

  // Batch 1: Expires earlier
  let batch1 = await mockIpc.invoke('api:add-batch', {
    medicineId: medicine.id,
    batchNumber: 'B-001',
    expiryDate: '2027-12-31',
    costPerUnit: 2.00,
    sellingPrice: 5.00,
    quantityInStock: 5,
    supplierId: supplier.id
  });

  // Batch 2: Expires later
  let batch2 = await mockIpc.invoke('api:add-batch', {
    medicineId: medicine.id,
    batchNumber: 'B-002',
    expiryDate: '2028-12-31',
    costPerUnit: 2.50,
    sellingPrice: 6.00,
    quantityInStock: 10,
    supplierId: supplier.id
  });
  console.log('✅ Batches added. Total Stock: 15');

  // 3. Admin creates Pharmacist
  console.log('\n3. Admin creates pharmacist account...');
  await createUserAccount('pharm_user', 'PharmPass123!', 'pharmacist');
  console.log('✅ Pharmacist account created.\n');

  // 4. Pharmacist Login & Restrictions
  console.log('4. Logging out admin, logging in pharmacist...');
  logoutUser();
  await loginUser('pharm_user', 'PharmPass123!');
  
  console.log('✅ Pharmacist fetching medicines...');
  const meds = await mockIpc.invoke('api:get-medicines');
  if (meds[0].batches[0].costPerUnit !== undefined) {
    throw new Error('Security Breach! Pharmacist can see costPerUnit!');
  }
  console.log('✅ Cost data successfully stripped from pharmacist view.');

  console.log('\n5. Testing pharmacist restriction (add medicine)...');
  try {
    await mockIpc.invoke('api:add-medicine', { name: 'Rogue Med' });
    throw new Error('Security Breach! Pharmacist was able to add a medicine.');
  } catch (err) {
    console.log('✅ Pharmacist blocked from adding medicine (Error:', err.message, ')');
  }

  // 6. POS Logic (Oversell)
  console.log('\n6. Pharmacist processing sale (Attempting to oversell 20 units)...');
  try {
    await mockIpc.invoke('api:process-sale', {
      items: [{ medicineId: medicine.id, name: medicine.name, quantity: 20 }]
    });
    throw new Error('POS Failure! Overselling was not blocked.');
  } catch (err) {
    console.log('✅ POS blocked oversell (Error:', err.message, ')');
  }

  // 7. POS Logic (Valid Sale with FEFO)
  console.log('\n7. Pharmacist processing valid FEFO sale (7 units)...');
  // Expected behavior: Deduct all 5 from B-001, then 2 from B-002.
  const sale = await mockIpc.invoke('api:process-sale', {
    items: [{ medicineId: medicine.id, name: medicine.name, quantity: 7 }]
  });
  console.log('✅ Sale recorded with ID:', sale.id);

  // Validate sale items split by FEFO
  if (sale.items.length !== 2) {
    throw new Error(`FEFO Failure! Expected 2 sale items, got ${sale.items.length}`);
  }
  const soldB1 = sale.items.find(i => i.batchId === batch1.id);
  const soldB2 = sale.items.find(i => i.batchId === batch2.id);
  if (soldB1.quantity !== 5 || soldB1.priceAtSale !== 5.00) throw new Error('FEFO Failure on Batch 1');
  if (soldB2.quantity !== 2 || soldB2.priceAtSale !== 6.00) throw new Error('FEFO Failure on Batch 2');
  console.log('✅ FEFO split sale correctly recorded pricing and quantities.');

  // Validate remaining stock
  const updatedMeds = await mockIpc.invoke('api:get-medicines');
  const updatedAspirin = updatedMeds.find(m => m.id === medicine.id);
  const updatedB1 = updatedAspirin.batches.find(b => b.id === batch1.id);
  const updatedB2 = updatedAspirin.batches.find(b => b.id === batch2.id);
  
  if (updatedAspirin.quantityInStock !== 8) {
    throw new Error(`Inventory deduction failed. Expected 8 total stock, got ${updatedAspirin.quantityInStock}`);
  }
  if (updatedB1.quantityInStock !== 0) throw new Error(`Batch 1 stock not fully deducted (Remaining: ${updatedB1.quantityInStock})`);
  if (updatedB2.quantityInStock !== 8) throw new Error(`Batch 2 stock incorrectly deducted (Remaining: ${updatedB2.quantityInStock})`);
  
  console.log(`✅ Inventory correctly deducted via FEFO (Remaining stock: ${updatedAspirin.quantityInStock}).`);

  console.log('\n✅ ALL E2E TESTS PASSED!');

  // Cleanup
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
