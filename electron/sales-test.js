import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DATA_DIR = path.join(__dirname, 'sales-test-data');
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

import { getData, updateRecord, addRecord } from './db.js';

// Mock ipcMain to register and invoke handlers locally
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
  console.log('=== PharmaCore Sales History Backend E2E Test ===\n');

  // 1. Admin Setup
  console.log('1. Setting up admin account...');
  await createAdminAccount('admin', 'AdminPass123!');
  console.log('✅ Admin logged in.');

  // 2. Add Supplier & Medicine
  console.log('\n2. Admin adding supplier and medicines...');
  const supplier = await mockIpc.invoke('api:add-supplier', {
    name: 'PharmaDistributors Inc',
    contactPhone: '555-9876',
    contactEmail: 'orders@pharmadist.com'
  });

  const aspirin = await mockIpc.invoke('api:add-medicine', {
    name: 'Aspirin 500mg',
    batchNumber: 'ASP-990',
    expiryDate: '2026-10-31',
    costPerUnit: 1.50,
    sellingPrice: 4.00,
    quantityInStock: 50,
    supplierId: supplier.id,
    barcode: 'ASP123'
  });

  const paracetamol = await mockIpc.invoke('api:add-medicine', {
    name: 'Paracetamol 500mg',
    batchNumber: 'PAR-440',
    expiryDate: '2027-01-15',
    costPerUnit: 1.00,
    sellingPrice: 3.00,
    quantityInStock: 100,
    supplierId: supplier.id,
    barcode: 'PAR456'
  });
  console.log('✅ Medicines successfully created.');

  // 3. Process Sale as Admin (Sale 1)
  console.log('\n3. Processing Sale 1 as Admin...');
  const sale1 = await mockIpc.invoke('api:process-sale', {
    items: [
      { medicineId: aspirin.id, name: aspirin.name, quantity: 2, priceAtSale: 4.00 },
      { medicineId: paracetamol.id, name: paracetamol.name, quantity: 3, priceAtSale: 3.00 }
    ],
    totalAmount: 17.00
  });
  console.log('✅ Sale 1 processed. Total:', sale1.totalAmount, 'Cashier:', sale1.cashierUserId);

  // 4. Create Pharmacist & Login
  console.log('\n4. Admin creating pharmacist account...');
  await createUserAccount('pharmacist_jane', 'PharmPass789!', 'pharmacist');
  
  console.log('Logging out admin, logging in pharmacist...');
  logoutUser();
  await loginUser('pharmacist_jane', 'PharmPass789!');
  console.log('✅ Pharmacist logged in.');

  // 5. Process Sale as Pharmacist (Sale 2)
  console.log('\n5. Processing Sale 2 as Pharmacist...');
  const sale2 = await mockIpc.invoke('api:process-sale', {
    items: [
      { medicineId: aspirin.id, name: aspirin.name, quantity: 5, priceAtSale: 4.00 }
    ],
    totalAmount: 20.00
  });
  console.log('✅ Sale 2 processed. Total:', sale2.totalAmount, 'Cashier:', sale2.cashierUserId);

  // 6. Test date range filtering by creating an older sale record
  console.log('\n6. Injecting a historical sale record (from 5 days ago) to test date filtering...');
  // We temporarily log in admin to make direct writes/updates to test older sale if needed, 
  // or we can just mock db write or log back in admin. Actually let's login admin.
  logoutUser();
  await loginUser('admin', 'AdminPass123!');
  
  // Directly append an older sale for test purposes
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  
  const historicalSale = {
    id: 'historical-sale-uuid',
    dateTime: fiveDaysAgo.toISOString(),
    items: [{ medicineId: paracetamol.id, name: paracetamol.name, quantity: 10, priceAtSale: 3.00 }],
    totalAmount: 30.00,
    cashierUserId: 'admin',
    fbrSynced: false,
    fbrInvoiceNumber: null
  };
  await addRecord('sales', historicalSale);
  console.log('✅ Historical sale injected for date:', historicalSale.dateTime);

  // 7. Verify Sales History Retrieval for both Roles
  const verifySalesAccess = async (roleName) => {
    console.log(`\n--- Verifying sales history data for role: ${roleName} ---`);
    const salesList = await mockIpc.invoke('api:get-sales');
    
    console.log('Total sales records in database:', salesList.length);
    if (salesList.length !== 3) {
      throw new Error(`Expected 3 sales, found ${salesList.length}`);
    }

    // Verify cashier usernames are present
    const cashiers = salesList.map(s => s.cashierUserId);
    console.log('Cashiers found in sales records:', cashiers);
    if (!cashiers.includes('admin') || !cashiers.includes('pharmacist_jane')) {
      throw new Error('Missing cashier usernames in retrieved sales.');
    }

    // Test Today's Sales Filtering (Local Time)
    const todayStr = new Date().toISOString().split('T')[0];
    const todayStart = new Date(`${todayStr}T00:00:00`);
    const todayEnd = new Date(`${todayStr}T23:59:59.999`);

    const todaySales = salesList.filter(s => {
      const d = new Date(s.dateTime);
      return d >= todayStart && d <= todayEnd;
    });

    console.log(`Today's Sales Count:`, todaySales.length);
    const todayTotal = todaySales.reduce((sum, s) => sum + s.totalAmount, 0);
    console.log(`Today's Sales Total Sum: $${todayTotal}`);

    if (todaySales.length !== 2) {
      throw new Error(`Expected 2 sales for today, got ${todaySales.length}`);
    }
    if (todayTotal !== 37.00) {
      throw new Error(`Expected today's total to be $37.00, got $${todayTotal}`);
    }

    // Test Full Range Filtering
    const allTotal = salesList.reduce((sum, s) => sum + s.totalAmount, 0);
    console.log('All-time Sales Total Sum:', allTotal);
    if (allTotal !== 67.00) {
      throw new Error(`Expected all-time total to be $67.00, got $${allTotal}`);
    }

    console.log(`✅ Data access and logic validated for ${roleName}.`);
  };

  // Run access checks for Admin
  await verifySalesAccess('admin');

  // Run access checks for Pharmacist
  logoutUser();
  await loginUser('pharmacist_jane', 'PharmPass789!');
  await verifySalesAccess('pharmacist');

  console.log('\n✅ ALL SALES HISTORY E2E TESTS PASSED!');
  
  // Cleanup
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('\n❌ Test failed:', err);
  process.exit(1);
});
