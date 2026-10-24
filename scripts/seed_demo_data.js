import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('[seed_demo_data] Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in your .env file or environment.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function main() {
  console.log('--- PHARMACORE DEMO DATA SEED SCRIPT ---');
  console.log('Connecting to Supabase...');

  // 0. CLEANUP EXISTING DATA
  console.log('Cleaning up existing data...');
  // Clear main tables (Returns -> Sales -> Batches -> Medicines -> Categories/Suppliers)
  await supabase.from('return_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('returns').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('sale_items').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('sales').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('batches').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('medicines').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('categories').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('suppliers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  
  // Cleanup Users (excluding the current user running this if they exist, but we use service key so we can delete all)
  const { data: usersData, error: usersError } = await supabase.auth.admin.listUsers();
  if (usersData && usersData.users) {
    for (const u of usersData.users) {
      await supabase.auth.admin.deleteUser(u.id);
    }
  }
  
  // 1. CREATE BRANCH
  console.log('Creating Branch...');
  const branchId = crypto.randomUUID();
  await supabase.from('branches').insert([{ id: branchId, name: 'Karachi Main Branch' }]);

  // 2. CREATE USERS
  console.log('Creating Users...');
  const demoUsers = [
    { username: 'admin@pharmacore.local', email: 'admin@pharmacore.local', name: 'Pharmacore Admin', role: 'admin' },
    { username: 'ahmed@pharmacore.local', email: 'ahmed@pharmacore.local', name: 'Ahmed Ali', role: 'pharmacist' },
    { username: 'sara@pharmacore.local', email: 'sara@pharmacore.local', name: 'Sara Khan', role: 'pharmacist' }
  ];

  const userIds = {};
  for (const u of demoUsers) {
    const tempPassword = process.env.DEMO_USER_PASSWORD || crypto.randomBytes(12).toString('hex') + 'A1!';
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: u.role, name: u.name, must_change_password: true }
    });
    
    if (authError) {
      console.error('Error creating user:', u.email, authError.message);
      continue;
    }
    
    // The trigger might have created the app_user, but we should update it or insert if missing
    const { error: upsertError } = await supabase.from('app_users').upsert({
      id: authUser.user.id,
      username: u.username,
      display_name: u.name,
      role: u.role,
      branch_id: branchId
    });

    userIds[u.role === 'admin' ? 'admin' : u.name] = authUser.user.id;
  }
  
  const adminId = userIds['admin'];
  const pharmacist1 = userIds['Ahmed Ali'];
  const pharmacist2 = userIds['Sara Khan'];

  // 3. CREATE SUPPLIERS
  console.log('Creating Suppliers...');
  const suppliers = [
    { name: 'Muller & Phipps Pakistan', contact_phone: '+92 21 111 111 667', contact_email: 'info@mphiggs.pk', branch_id: branchId },
    { name: 'Ali Gohar & Company', contact_phone: '+92 21 3452 8765', contact_email: 'sales@aligohar.com', branch_id: branchId },
    { name: 'IBL HealthCare', contact_phone: '+92 21 3567 1234', contact_email: 'contact@iblhc.com', branch_id: branchId },
    { name: 'Popular Chemical Works', contact_phone: '+92 42 3765 4321', contact_email: 'info@popularchemicals.com', branch_id: branchId },
    { name: 'Fazal Din & Sons', contact_phone: '+92 42 111 111 337', contact_email: 'sales@fazaldin.pk', branch_id: branchId }
  ];

  const { data: insertedSuppliers } = await supabase.from('suppliers').insert(suppliers).select();
  const suppMap = insertedSuppliers.reduce((acc, s) => ({ ...acc, [s.name]: s.id }), {});

  // 4. CREATE CATEGORIES
  console.log('Creating Categories...');
  const categories = [
    { name: 'Analgesics', tax_rate: 0, branch_id: branchId },
    { name: 'Antibiotics', tax_rate: 0, branch_id: branchId },
    { name: 'Antacids/Gastro', tax_rate: 5, branch_id: branchId },
    { name: 'Allergy/Antihistamine', tax_rate: 5, branch_id: branchId },
    { name: 'Vitamins/Supplements', tax_rate: 17, branch_id: branchId },
    { name: 'Cough & Cold', tax_rate: 0, branch_id: branchId },
    { name: 'Diabetes', tax_rate: 0, branch_id: branchId },
    { name: 'Cardiac', tax_rate: 0, branch_id: branchId },
    { name: 'Topical/Antiseptic', tax_rate: 5, branch_id: branchId }
  ];

  const { data: insertedCategories } = await supabase.from('categories').insert(categories).select();
  const catMap = insertedCategories.reduce((acc, c) => ({ ...acc, [c.name]: c }), {});

  // 5. CREATE MEDICINES
  console.log('Creating Medicines...');
  const medicines = [
    { name: 'Panadol 500mg', generic_name: 'Paracetamol', barcode: '8961111222233', cat: 'Analgesics', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 20 },
    { name: 'Augmentin 625mg', generic_name: 'Amoxicillin/Clavulanate', barcode: '8961111222244', cat: 'Antibiotics', unit: 'Tablet', pack: 'Strip', packQty: 6, boxQty: 10 },
    { name: 'Risek 40mg', generic_name: 'Omeprazole', barcode: '8961111222255', cat: 'Antacids/Gastro', unit: 'Capsule', pack: 'Strip', packQty: 14, boxQty: 2 },
    { name: 'Rigix 10mg', generic_name: 'Cetirizine', barcode: '8961111222266', cat: 'Allergy/Antihistamine', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 30 },
    { name: 'Surbex Z', generic_name: 'Multivitamin', barcode: '8961111222277', cat: 'Vitamins/Supplements', unit: 'Tablet', pack: 'Bottle', packQty: 30, boxQty: 1 },
    { name: 'Hydryllin', generic_name: 'Aminophylline/Diphenhydramine', barcode: '8961111222288', cat: 'Cough & Cold', unit: 'ml', pack: 'Bottle', packQty: 120, boxQty: 1 },
    { name: 'Glucophage 500mg', generic_name: 'Metformin', barcode: '8961111222299', cat: 'Diabetes', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 50 },
    { name: 'Concor 5mg', generic_name: 'Bisoprolol', barcode: '8961111222300', cat: 'Cardiac', unit: 'Tablet', pack: 'Strip', packQty: 14, boxQty: 2 },
    { name: 'Pyodine Solution 10%', generic_name: 'Povidone Iodine', barcode: '8961111222311', cat: 'Topical/Antiseptic', unit: 'ml', pack: 'Bottle', packQty: 60, boxQty: 1 },
    { name: 'Brufen 400mg', generic_name: 'Ibuprofen', barcode: '8961111222322', cat: 'Analgesics', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 25 },
    { name: 'Cefspan 400mg', generic_name: 'Cefixime', barcode: '8961111222333', cat: 'Antibiotics', unit: 'Capsule', pack: 'Strip', packQty: 5, boxQty: 1 },
    { name: 'Gaviscon Liquid', generic_name: 'Sodium Alginate', barcode: '8961111222344', cat: 'Antacids/Gastro', unit: 'ml', pack: 'Bottle', packQty: 120, boxQty: 1 },
    { name: 'Arinac', generic_name: 'Ibuprofen/Pseudoephedrine', barcode: '8961111222355', cat: 'Cough & Cold', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 10 },
    { name: 'Amaryl 2mg', generic_name: 'Glimepiride', barcode: '8961111222366', cat: 'Diabetes', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 30 },
    { name: 'Lipget 20mg', generic_name: 'Atorvastatin', barcode: '8961111222377', cat: 'Cardiac', unit: 'Tablet', pack: 'Strip', packQty: 10, boxQty: 20 },
    { name: 'CAC-1000 Plus', generic_name: 'Calcium', barcode: '8961111222388', cat: 'Vitamins/Supplements', unit: 'Tablet', pack: 'Tube', packQty: 10, boxQty: 1 }
  ];

  const medInserts = medicines.map(m => ({
    name: m.name,
    generic_name: m.generic_name,
    barcode: m.barcode,
    category_id: catMap[m.cat].id,
    branch_id: branchId,
    unit_name: m.unit,
    packaging_name: m.pack,
    units_per_packaging: m.packQty,
    packaging_per_box: m.boxQty
  }));

  const { data: insertedMedicines } = await supabase.from('medicines').insert(medInserts).select();
  const medMap = insertedMedicines.reduce((acc, m) => ({ ...acc, [m.name]: m }), {});

  // 6. CREATE BATCHES
  console.log('Creating Batches...');
  const batches = [];
  const today = new Date();
  
  // Helper to generate dates
  const addDays = (d, days) => new Date(d.getTime() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  medicines.forEach(m => {
    const med = medMap[m.name];
    const supp = Object.values(suppMap)[Math.floor(Math.random() * 5)]; // Random supplier

    // First batch (older stock, expires sooner)
    batches.push({
      medicine_id: med.id,
      batch_number: `B-${m.barcode.slice(-4)}-1`,
      expiry_date: addDays(today, 30 + Math.floor(Math.random() * 60)), // Expires in 1-3 months
      supplier_id: supp,
      quantity_in_stock: m.packQty * 20, // 20 packs
      cost_per_unit: 5.5,
      selling_price: 7.0, // Per unit price
      date_purchased: addDays(today, -90)
    });

    // Second batch for FEFO demonstration (newer stock, expires later)
    if (Math.random() > 0.3) {
      batches.push({
        medicine_id: med.id,
        batch_number: `B-${m.barcode.slice(-4)}-2`,
        expiry_date: addDays(today, 300 + Math.floor(Math.random() * 100)), // Expires next year
        supplier_id: supp,
        quantity_in_stock: m.packQty * 50,
        cost_per_unit: 6.0,
        selling_price: 7.0,
        date_purchased: addDays(today, -10)
      });
    }
  });

  const { data: insertedBatches } = await supabase.from('batches').insert(batches).select();
  
  // Group batches by medicine
  const batchesByMed = {};
  insertedBatches.forEach(b => {
    if (!batchesByMed[b.medicine_id]) batchesByMed[b.medicine_id] = [];
    batchesByMed[b.medicine_id].push(b);
  });

  // 7. CREATE SALES (15 past sales)
  console.log('Creating Sales & Sale Items...');
  
  for (let i = 0; i < 15; i++) {
    const cashier = i % 3 === 0 ? pharmacist1 : (i % 3 === 1 ? pharmacist2 : adminId);
    if (!cashier) continue;

    const saleId = crypto.randomUUID();
    const saleDate = addDays(today, -Math.floor(Math.random() * 10)); // Past 10 days
    
    // Pick 2-4 random medicines
    const numItems = Math.floor(Math.random() * 3) + 2;
    const saleItems = [];
    let subtotal = 0;
    let totalTax = 0;
    
    const pickedMeds = [...insertedMedicines].sort(() => 0.5 - Math.random()).slice(0, numItems);

    for (const med of pickedMeds) {
      const medBatches = batchesByMed[med.id];
      if (!medBatches || medBatches.length === 0) continue;
      
      const batch = medBatches[0]; // Just take first batch for seeding
      const qtySold = Math.floor(Math.random() * 5) + 1; // Loose units sold (1 to 5)
      
      const cat = Object.values(catMap).find(c => c.id === med.category_id);
      const taxRate = cat ? cat.tax_rate : 0;
      
      const itemSubtotal = qtySold * batch.selling_price;
      const taxAmount = itemSubtotal * (taxRate / 100);
      
      saleItems.push({
        sale_id: saleId,
        medicine_id: med.id,
        batch_id: batch.id,
        batch_number: batch.batch_number,
        name: med.name,
        quantity: qtySold,
        price_at_sale: batch.selling_price,
        tax_rate_at_sale: taxRate,
        tax_amount: taxAmount,
        subtotal_item: itemSubtotal
      });
      
      subtotal += itemSubtotal;
      totalTax += taxAmount;
    }
    
    const totalAmount = subtotal + totalTax;
    
    // Using the RPC function `process_sale` would be better to ensure stock is deducted, but since we are seeding data directly via DB and we already set the stock to an arbitrary number, we can just insert them directly. Or we can just insert them into sales.
    // However, process_sale uses auth.uid() inside. The service role key bypasses RLS but `auth.uid()` will return null.
    // So we just insert them manually.
    
    await supabase.from('sales').insert([{
      id: saleId,
      date_time: saleDate,
      subtotal,
      total_tax: totalTax,
      total_amount: totalAmount,
      cashier_user_id: cashier,
      branch_id: branchId
    }]);

    await supabase.from('sale_items').insert(saleItems);
  }

  // 8. CREATE RETURNS
  console.log('Creating Returns...');
  const { data: recentSales } = await supabase.from('sales').select('id, cashier_user_id').limit(3);
  
  if (recentSales && recentSales.length > 0) {
    for (let i = 0; i < recentSales.length; i++) {
      const sale = recentSales[i];
      const { data: sItems } = await supabase.from('sale_items').select('*').eq('sale_id', sale.id);
      
      if (!sItems || sItems.length === 0) continue;
      
      const itemToReturn = sItems[0];
      const returnId = crypto.randomUUID();
      const returnQty = 1;
      const itemRefund = returnQty * (itemToReturn.subtotal_item / itemToReturn.quantity);
      
      const reason = i === 0 ? 'Wrong prescription' : (i === 1 ? 'Customer changed mind (unopened)' : 'Suspected counterfeit or quality issue');
      const condition = i === 1 ? 'unopened' : 'opened';
      const quarantined = condition === 'opened' || reason.includes('Suspected');
      const restored = !quarantined;

      await supabase.from('returns').insert([{
        id: returnId,
        sale_id: sale.id,
        return_date: addDays(today, 0), // Today
        refund_method: i % 2 === 0 ? 'Cash' : 'Store Credit',
        total_refund_amount: itemRefund,
        status: 'completed',
        processed_by_user_id: sale.cashier_user_id,
        branch_id: branchId
      }]);

      await supabase.from('return_items').insert([{
        return_id: returnId,
        sale_item_id: itemToReturn.id,
        medicine_id: itemToReturn.medicine_id,
        batch_id: itemToReturn.batch_id,
        quantity: returnQty,
        reason,
        condition,
        refund_amount: itemRefund,
        quarantined,
        restored_to_stock: restored
      }]);
    }
  }

  // 9. SUMMARY
  console.log('--- SEEDING COMPLETE ---');
  
  const getCount = async (table) => {
    const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
    return count;
  };
  
  console.log('Row Counts:');
  console.log(`- Suppliers: ${await getCount('suppliers')}`);
  console.log(`- Categories: ${await getCount('categories')}`);
  console.log(`- Medicines: ${await getCount('medicines')}`);
  console.log(`- Batches: ${await getCount('batches')}`);
  console.log(`- Sales: ${await getCount('sales')}`);
  console.log(`- Sale Items: ${await getCount('sale_items')}`);
  console.log(`- Returns: ${await getCount('returns')}`);
  console.log(`- Return Items: ${await getCount('return_items')}`);
  console.log(`- App Users: ${await getCount('app_users')}`);
  console.log('DONE!');
}

main().catch(console.error);
