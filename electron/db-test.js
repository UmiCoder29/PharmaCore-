/**
 * PharmaCore – Data Layer Smoke Test
 *
 * Run from the project root:
 *   node electron/db-test.js
 *
 * Uses _PHARMACORE_TEST_DATA_DIR to redirect files to ./electron/test-data/
 * instead of %APPDATA%\pharmacore — no Electron process required.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Point the DB at a local test directory so this script works without Electron
const TEST_DATA_DIR = path.join(__dirname, 'test-data');
process.env._PHARMACORE_TEST_DATA_DIR = TEST_DATA_DIR;

// Clean slate on every test run
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

// Now import — safe because _PHARMACORE_TEST_DATA_DIR is already set
import { loadData, saveData, addRecord, getData } from './db.js';

// ── Helpers ────────────────────────────────────────────────────────────────────
const uid  = () => crypto.randomUUID();
const pass = test => { console.log('   ✅', test); };
const fail = (test, reason) => { throw new Error(`❌ ${test}: ${reason}`); };

function assert(condition, label) {
  if (!condition) fail(label, 'assertion failed');
  pass(label);
}

// ── Test runner ────────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  PharmaCore DB Smoke Test');
  console.log('══════════════════════════════════════════════════════\n');

  const PASSWORD = 'Str0ng-T3st-P@$$w0rd!';

  // ── 1. First loadData() — creates salt + empty encrypted DB ─────────────────
  console.log('▶ Step 1: loadData() — first launch (creates salt + DB)');
  await loadData(PASSWORD);
  assert(fs.existsSync(path.join(TEST_DATA_DIR, 'pharmacore.salt')),  'pharmacore.salt created');
  assert(fs.existsSync(path.join(TEST_DATA_DIR, 'pharmacore_db.enc')), 'pharmacore_db.enc created');

  const encBytes = fs.readFileSync(path.join(TEST_DATA_DIR, 'pharmacore_db.enc'));
  assert(encBytes.length > 0, 'Encrypted file is non-empty');
  // Verify the file does NOT start with '{' (would indicate unencrypted JSON)
  assert(encBytes[0] !== 0x7B, 'File does not start with { — confirms data is encrypted');
  console.log();

  // ── 2. addRecord — supplier ─────────────────────────────────────────────────
  console.log('▶ Step 2: addRecord() — supplier');
  const supplier = await addRecord('suppliers', {
    id:           uid(),
    name:         'MediSupply Co.',
    contactPhone: '+92-300-1234567',
    contactEmail: 'orders@medisupply.pk',
  });
  assert(!!supplier.id, 'Supplier record returned with id');
  console.log();

  // ── 3. addRecord — medicine ─────────────────────────────────────────────────
  console.log('▶ Step 3: addRecord() — medicine');
  const medicine = await addRecord('medicines', {
    id:              uid(),
    name:            'Paracetamol 500mg',
    batchNumber:     'BATCH-2026-001',
    expiryDate:      '2028-06-30',
    costPerUnit:     8.50,
    sellingPrice:    15.00,
    quantityInStock: 500,
    supplierId:      supplier.id,
  });
  assert(!!medicine.id, 'Medicine record returned with id');
  assert(medicine.batchNumber === 'BATCH-2026-001', 'batchNumber correct');
  assert(medicine.supplierId  === supplier.id,      'supplierId linked correctly');
  console.log();

  // ── 4. addRecord — prescription ─────────────────────────────────────────────
  console.log('▶ Step 4: addRecord() — prescription');
  const prescription = await addRecord('prescriptions', {
    id:          uid(),
    patientName: 'Ahmed Khan',
    doctorName:  'Dr. Sara Malik',
    dateIssued:  new Date().toISOString().split('T')[0],
    medicineIds: [medicine.id],
    notes:       'Take twice daily after meals.',
  });
  assert(prescription.medicineIds.includes(medicine.id), 'medicineIds links to medicine');
  console.log();

  // ── 5. addRecord — sale (critical: FBR placeholder fields) ──────────────────
  console.log('▶ Step 5: addRecord() — sale (FBR field check)');
  const sale = await addRecord('sales', {
    id:              uid(),
    dateTime:        new Date().toISOString(),
    items: [
      { medicineId: medicine.id, quantity: 3, priceAtSale: medicine.sellingPrice },
    ],
    totalAmount:      medicine.sellingPrice * 3,
    cashierUserId:   'user-admin-001',
    fbrSynced:        false,   // ← FBR placeholder — not yet implemented
    fbrInvoiceNumber: null,    // ← FBR placeholder — not yet implemented
  });
  assert(sale.fbrSynced        === false, 'fbrSynced is false');
  assert(sale.fbrInvoiceNumber === null,  'fbrInvoiceNumber is null');
  assert(sale.items.length     === 1,     'Sale has 1 line item');
  console.log();

  // ── 6. Encrypt→decrypt round-trip ───────────────────────────────────────────
  console.log('▶ Step 6: Round-trip — reload from encrypted file using same password');
  await loadData(PASSWORD);
  const data = getData();

  assert(data.suppliers.length     === 1, 'Decrypted: 1 supplier');
  assert(data.medicines.length     === 1, 'Decrypted: 1 medicine');
  assert(data.prescriptions.length === 1, 'Decrypted: 1 prescription');
  assert(data.sales.length         === 1, 'Decrypted: 1 sale');

  const savedSale = data.sales[0];
  assert(savedSale.fbrSynced        === false, 'fbrSynced survived round-trip as false');
  assert(savedSale.fbrInvoiceNumber === null,  'fbrInvoiceNumber survived round-trip as null');
  console.log();

  // ── 7. Wrong password should fail to decrypt (auth tag mismatch) ────────────
  console.log('▶ Step 7: Wrong password — should throw (tamper/wrong-key detection)');
  let threw = false;
  try {
    await loadData('WRONG-PASSWORD-INTENTIONALLY');
  } catch (e) {
    threw = true;
  }
  assert(threw, 'Wrong password correctly rejected by GCM auth tag');
  console.log();

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log('══════════════════════════════════════════════════════');
  console.log('  ✅  All 7 tests passed.');
  console.log('══════════════════════════════════════════════════════\n');

  // Cleanup test data
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

runTests().catch(err => {
  console.error('\n❌ Smoke test FAILED:', err.message);
  process.exit(1);
});
