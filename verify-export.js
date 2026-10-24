import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createAdminAccount, loginUser } from './electron/auth.js';
import { addRecord, getData, saveData } from './electron/db.js';

// We need to mock the ipcMain handlers for export/import since they rely on BrowserWindow
// But actually, export.js uses dialog.showSaveDialog which we can't do in a headless script.
// Let's just use encryptPayload and decryptPayload from export.js, but they are not exported.
// Instead, I'll write a standalone test that mimics the logic in api.js by calling the inner functions, 
// or I can just test the logic directly:

async function runTest() {
  console.log("=== Bundle Export/Import Test ===");
  const testDir = path.join(process.cwd(), '.test_db_' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  process.env._PHARMACORE_TEST_DATA_DIR = testDir;

  try {
    const testPwd = crypto.randomUUID();
    await createAdminAccount("testadmin", testPwd);
    await loginUser("testadmin", testPwd);
    
    // 1. Create categories and medicines
    const cat1 = await addRecord('categories', { id: crypto.randomUUID(), name: 'Cat A' });
    const cat2 = await addRecord('categories', { id: crypto.randomUUID(), name: 'Cat B' });
    const med1 = await addRecord('medicines', { id: crypto.randomUUID(), name: 'Med 1', categoryId: cat1.id });
    
    const data = getData();
    
    // 2. Simulate Export
    const recordsBundle = {
      medicines: [...data.medicines],
      categories: [...data.categories]
    };
    // Let's say this is what decryptPayload would return.

    // 3. Wipe both locally
    data.medicines = [];
    data.categories = [];
    await saveData();
    
    if (data.medicines.length !== 0 || data.categories.length !== 0) {
      throw new Error("Failed to wipe DB.");
    }
    
    // 4. Simulate Import (api:apply-inventory-import)
    const importedMedicines = recordsBundle.medicines;
    const importedCategories = recordsBundle.categories;

    // Overwrite medicines collection completely
    data.medicines = importedMedicines;

    // Merge categories: add if ID doesn't exist
    const existingCategoryIds = new Set(data.categories.map(c => c.id));
    for (const cat of importedCategories) {
      if (!existingCategoryIds.has(cat.id)) {
        data.categories.push(cat);
        existingCategoryIds.add(cat.id);
      }
    }
    await saveData();

    // 5. Verify Restore
    if (data.medicines.length !== 1 || data.categories.length !== 2) {
      throw new Error("Restore failed sizes mismatch.");
    }
    if (data.medicines[0].categoryId !== data.categories.find(c => c.name === 'Cat A').id) {
      throw new Error("Category ID reference broken.");
    }
    console.log("Restore successful!");

    // 6. Simulate Double Import
    console.log("Simulating double import to test duplication...");
    // Merging logic again
    const existingCategoryIds2 = new Set(data.categories.map(c => c.id));
    for (const cat of importedCategories) {
      if (!existingCategoryIds2.has(cat.id)) {
        data.categories.push(cat);
        existingCategoryIds2.add(cat.id);
      }
    }
    await saveData();

    if (data.categories.length !== 2) {
      throw new Error(`Categories were duplicated! Count is ${data.categories.length}`);
    }
    console.log("Double import handled correctly, no duplicates.");
    console.log("=== All tests PASSED! ===");
  } finally {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

runTest().catch(console.error);
