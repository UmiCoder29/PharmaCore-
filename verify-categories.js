import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createAdminAccount, loginUser } from './electron/auth.js';
import { addRecord, getData } from './electron/db.js';

async function runTest() {
  console.log("=== Category Verification Test ===");
  
  // 1. Set up temporary isolated DB paths for the test
  const testDir = path.join(process.cwd(), '.test_db_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  process.env._PHARMACORE_TEST_DATA_DIR = testDir;
  console.log("Test DB Directory:", testDir);

  try {
    const testPwd = crypto.randomUUID();
    console.log("Creating admin account...");
    const createRes = await createAdminAccount("testadmin", testPwd);
    if (!createRes.success) throw new Error("Failed to create admin: " + createRes.error);
    
    console.log("Logging in...");
    const loginRes = await loginUser("testadmin", testPwd);
    if (!loginRes.success) throw new Error("Failed to log in: " + loginRes.error);
    
    // 3. Create 2-3 categories
    console.log("Creating Categories...");
    const cat1 = await addRecord('categories', { id: crypto.randomUUID(), name: 'Painkillers', description: 'Pain relief' });
    const cat2 = await addRecord('categories', { id: crypto.randomUUID(), name: 'Antibiotics', description: 'Fights bacterial infections' });
    const cat3 = await addRecord('categories', { id: crypto.randomUUID(), name: 'Vitamins', description: 'Supplements' });
    console.log(`Created categories: ${cat1.name}, ${cat2.name}, ${cat3.name}`);

    // 4. Create medicines and assign categories
    console.log("Creating Medicines...");
    const med1 = await addRecord('medicines', { 
      id: crypto.randomUUID(), name: 'Ibuprofen', categoryId: cat1.id, 
      costPerUnit: 2, sellingPrice: 5, quantityInStock: 100 
    });
    const med2 = await addRecord('medicines', { 
      id: crypto.randomUUID(), name: 'Amoxicillin', categoryId: cat2.id, 
      costPerUnit: 5, sellingPrice: 15, quantityInStock: 50 
    });
    const med3 = await addRecord('medicines', { 
      id: crypto.randomUUID(), name: 'Band-Aid', categoryId: null, // Uncategorized
      costPerUnit: 1, sellingPrice: 2, quantityInStock: 200 
    });
    console.log(`Created medicines: ${med1.name} (Cat: ${cat1.name}), ${med2.name} (Cat: ${cat2.name}), ${med3.name} (Uncategorized)`);

    // 5. Test filtering logic (simulating what the UI does)
    console.log("Testing filter logic...");
    const allMeds = getData().medicines;
    
    const filterCat1 = allMeds.filter(m => m.categoryId === cat1.id);
    if (filterCat1.length !== 1 || filterCat1[0].name !== 'Ibuprofen') {
      throw new Error("Filter by Painkillers failed");
    }
    console.log(`Filter by '${cat1.name}' correctly narrowed list to: ${filterCat1.map(m=>m.name).join(', ')}`);

    const filterCat2 = allMeds.filter(m => m.categoryId === cat2.id);
    if (filterCat2.length !== 1 || filterCat2[0].name !== 'Amoxicillin') {
      throw new Error("Filter by Antibiotics failed");
    }
    console.log(`Filter by '${cat2.name}' correctly narrowed list to: ${filterCat2.map(m=>m.name).join(', ')}`);
    
    const filterUncategorized = allMeds.filter(m => !m.categoryId);
    if (filterUncategorized.length !== 1 || filterUncategorized[0].name !== 'Band-Aid') {
      throw new Error("Filter by Uncategorized failed");
    }
    console.log(`Uncategorized medicines correctly displayed: ${filterUncategorized.map(m=>m.name).join(', ')} without errors.`);

    console.log("=== All Category tests PASSED! ===");

  } finally {
    // Cleanup
    fs.rmSync(testDir, { recursive: true, force: true });
    console.log("Cleaned up test DB directory.");
  }
}

runTest().catch(console.error);
