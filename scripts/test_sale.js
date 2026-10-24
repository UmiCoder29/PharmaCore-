import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const TEST_PASSWORD = process.env.TEST_USER_PASSWORD || process.env.INITIAL_ADMIN_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('[test_sale] Error: SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be set in your .env file or environment.');
  process.exit(1);
}

if (!TEST_PASSWORD) {
  console.error('[test_sale] Error: TEST_USER_PASSWORD must be provided in environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runTest() {
  console.log('--- TESTING PROCESS SALE RPC ---');

  // 1. Sign in as pharmacist
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: process.env.TEST_USER_EMAIL || 'admin@pharmacore.local',
    password: TEST_PASSWORD
  });

  if (authErr) {
    console.error('Failed to authenticate:', authErr.message);
    return;
  }

  console.log('Authenticated successfully as', authData.user.email);

  // 2. Get a random active batch
  const { data: batches } = await supabase.from('batches').select('*, medicines(*)').limit(1);
  if (!batches || batches.length === 0) {
    console.log('No batches found for testing.');
    return;
  }
  const batch = batches[0];
  const med = batch.medicines;

  console.log(`\nTesting with Medicine: ${med.name}, Batch: ${batch.batch_number}`);
  const initialQty = batch.quantity_in_stock;
  console.log(`Initial stock: ${initialQty}`);

  const p_sale_id = crypto.randomUUID();
  const quantityToSell = 2; // Loose units
  const p_subtotal = quantityToSell * batch.selling_price;
  const p_total_tax = 0; 
  const p_total_amount = p_subtotal + p_total_tax;

  const p_items = [{
    medicine_id: med.id,
    batch_id: batch.id,
    batch_number: batch.batch_number,
    name: med.name,
    quantity: quantityToSell,
    price_at_sale: batch.selling_price,
    tax_rate_at_sale: 0,
    tax_amount: 0,
    subtotal_item: p_subtotal
  }];

  console.log('Executing process_sale RPC...');
  
  const { data, error } = await supabase.rpc('process_sale', {
    p_sale_id,
    p_items,
    p_subtotal,
    p_total_tax,
    p_total_amount
  });

  if (error) {
    console.error('RPC Error:', error);
    return;
  }
  
  console.log('RPC Success! Returned sale ID:', data);

  // Verify stock deduction
  const { data: updatedBatch } = await supabase.from('batches').select('quantity_in_stock').eq('id', batch.id).single();
  console.log(`Updated stock: ${updatedBatch.quantity_in_stock}`);
  if (initialQty - quantityToSell === updatedBatch.quantity_in_stock) {
    console.log('✅ Stock deducted correctly.');
  } else {
    console.log('❌ Stock deduction mismatch!');
  }

  // Verify sale and items exist
  const { data: sale } = await supabase.from('sales').select('*').eq('id', p_sale_id).single();
  const { data: saleItems } = await supabase.from('sale_items').select('*').eq('sale_id', p_sale_id);
  
  if (sale && saleItems && saleItems.length === 1) {
    console.log('✅ Sale and Sale Items verified in database.');
  } else {
    console.log('❌ Missing sale or sale items in database!');
  }

}

runTest().catch(console.error);
