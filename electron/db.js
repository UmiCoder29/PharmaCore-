import { getSupabaseClient, getAdminClient, isOnline } from './supabaseClient.js';
import { setCacheData, getCacheData } from './localCache.js';
import { enqueueOfflineWrite, getQueueCount } from './offlineQueue.js';
import { getCurrentUser } from './auth.js';
import crypto from 'crypto';

const COLUMN_MAP = {
  pharmacies: {
    contactEmail: 'contact_email', contactPhone: 'contact_phone', taxNumber: 'tax_number',
    logoUrl: 'logo_url', planTier: 'plan_tier', subscriptionStatus: 'subscription_status',
    trialEndsAt: 'trial_ends_at', subscriptionEndsAt: 'subscription_ends_at',
    maxBranches: 'max_branches', maxUsers: 'max_users', isActive: 'is_active',
    createdAt: 'created_at', updatedAt: 'updated_at'
  },
  branches: {
    pharmacyId: 'pharmacy_id', isMainBranch: 'is_main_branch',
    createdAt: 'created_at', updatedAt: 'updated_at'
  },
  medicines: {
    pharmacyId: 'pharmacy_id', genericName: 'generic_name', categoryId: 'category_id',
    branchId: 'branch_id', unitName: 'unit_name', packagingName: 'packaging_name',
    unitsPerPackaging: 'units_per_packaging', packagingPerBox: 'packaging_per_box',
    prescriptionRequired: 'prescription_required', controlledSchedule: 'controlled_schedule',
    reorderLevel: 'reorder_level', created_at: 'created_at', updated_at: 'updated_at',
    isActive: 'is_active'
  },
  batches: {
    pharmacyId: 'pharmacy_id', medicineId: 'medicine_id', batchNumber: 'batch_number',
    expiryDate: 'expiry_date', supplierId: 'supplier_id', quantityInStock: 'quantity_in_stock',
    costPerUnit: 'cost_per_unit', sellingPrice: 'selling_price', dateAdded: 'date_added',
    datePurchased: 'date_purchased', isExpired: 'is_expired', updated_at: 'updated_at',
    branchId: 'branch_id', originalQuantity: 'original_quantity'
  },
  suppliers: {
    pharmacyId: 'pharmacy_id', contactPhone: 'contact_phone', contactEmail: 'contact_email',
    branchId: 'branch_id', updated_at: 'updated_at'
  },
  categories: {
    pharmacyId: 'pharmacy_id', taxRate: 'tax_rate', branchId: 'branch_id',
    updated_at: 'updated_at'
  },
  sales: {
    pharmacyId: 'pharmacy_id', dateTime: 'date_time', totalTax: 'total_tax',
    totalAmount: 'total_amount', cashierUserId: 'cashier_user_id', branchId: 'branch_id',
    customerId: 'customer_id', prescriptionId: 'prescription_id', paymentMethod: 'payment_method',
    discountAmount: 'discount_amount', cashReceived: 'cash_received', changeAmount: 'change_amount',
    invoiceNumber: 'invoice_number', fbrInvoiceNumber: 'fbr_invoice_number',
    fbrQrPayload: 'fbr_qr_payload', updated_at: 'updated_at'
  },
  sale_items: {
    pharmacyId: 'pharmacy_id', saleId: 'sale_id', medicineId: 'medicine_id',
    batchId: 'batch_id', batchNumber: 'batch_number', priceAtSale: 'price_at_sale',
    taxRateAtSale: 'tax_rate_at_sale', taxAmount: 'tax_amount', subtotalItem: 'subtotal_item',
    branchId: 'branch_id'
  },
  sale_payments: {
    pharmacyId: 'pharmacy_id', saleId: 'sale_id', method: 'method', amount: 'amount',
    reference: 'reference', createdAt: 'created_at'
  },
  returns: {
    pharmacyId: 'pharmacy_id', saleId: 'sale_id', returnDate: 'return_date',
    refundMethod: 'refund_method', totalRefundAmount: 'total_refund_amount',
    processedByUserId: 'processed_by_user_id', branchId: 'branch_id'
  },
  return_items: {
    pharmacyId: 'pharmacy_id', returnId: 'return_id', saleItemId: 'sale_item_id',
    medicineId: 'medicine_id', batchId: 'batch_id', refundAmount: 'refund_amount',
    restoredToStock: 'restored_to_stock', branchId: 'branch_id'
  },
  activity_logs: {
    pharmacyId: 'pharmacy_id', userId: 'user_id', targetTable: 'target_table',
    targetRecordId: 'target_record_id', deviceName: 'device_name', branchId: 'branch_id',
    created_at: 'created_at'
  },
  app_users: {
    pharmacyId: 'pharmacy_id', displayName: 'display_name', branchId: 'branch_id',
    canViewAllBranches: 'can_view_all_branches', created_at: 'created_at'
  },
  customers: {
    pharmacyId: 'pharmacy_id', fullName: 'full_name', dateOfBirth: 'date_of_birth',
    branchId: 'branch_id', createdAt: 'created_at', updatedAt: 'updated_at'
  },
  prescriptions: {
    pharmacyId: 'pharmacy_id', customerId: 'customer_id', prescriberName: 'prescriber_name',
    prescriberRegistrationNo: 'prescriber_registration_no', prescriptionDate: 'prescription_date',
    attachmentReference: 'attachment_reference', verifiedByUserId: 'verified_by_user_id',
    verifiedAt: 'verified_at', branchId: 'branch_id', createdAt: 'created_at', updatedAt: 'updated_at'
  },
  settings: {
    pharmacyId: 'pharmacy_id', branchId: 'branch_id'
  }
};

/**
 * Maps a collection name to the corresponding Supabase table name.
 */
function getTableName(collectionName) {
  const map = {
    'loginActivity': 'activity_logs',
    'users': 'app_users'
  };
  return map[collectionName] || collectionName;
}

/**
 * Converts a record's keys to snake_case based on COLUMN_MAP.
 */
export function toSnakeCase(table, record) {
  if (!record || typeof record !== 'object') return record;
  const mapped = {};
  const tableMap = COLUMN_MAP[table] || {};
  for (const [key, value] of Object.entries(record)) {
    const newKey = tableMap[key] || key;
    mapped[newKey] = value;
  }
  return mapped;
}

/**
 * Converts a record's keys to camelCase based on COLUMN_MAP.
 */
export function toCamelCase(table, record) {
  if (!record || typeof record !== 'object') return record;
  const mapped = {};
  const tableMap = COLUMN_MAP[table] || {};
  
  // Create reverse map
  const reverseMap = {};
  for (const [camel, snake] of Object.entries(tableMap)) {
    reverseMap[snake] = camel;
  }

  for (const [key, value] of Object.entries(record)) {
    const newKey = reverseMap[key] || key;
    mapped[newKey] = value;
  }
  return mapped;
}

/**
 * Returns a snapshot object of all required data.
 */
export async function getData() {
  console.log('[DB] Fetching data snapshot');
  try {
    const currentUser = getCurrentUser();
    const isSuperAdmin = currentUser?.role === 'superadmin';
    const pharmacyId = currentUser?.pharmacyId;

    if (!isOnline()) {
      console.log('[DB] Offline, serving from cache');
      const cacheKey = pharmacyId ? `db_snapshot_${pharmacyId}` : 'db_snapshot';
      const cached = await getCacheData(cacheKey);
      return cached || {};
    }

    const supabase = getSupabaseClient();
    const result = {};

    const tablesToFetch = ['medicines', 'batches', 'suppliers', 'categories', 'sales', 'app_users', 'activity_logs', 'settings'];
    
    for (const table of tablesToFetch) {
      let query = supabase.from(table).select('*');
      
      // Multi-tenant filter for non-superadmin users
      if (!isSuperAdmin && pharmacyId && table !== 'settings') {
        query = query.eq('pharmacy_id', pharmacyId);
      } else if (!isSuperAdmin && pharmacyId && table === 'settings') {
        query = query.eq('pharmacy_id', pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      
      const mappedData = (data || []).map(record => toCamelCase(table, record));
      
      if (table === 'app_users') result['users'] = mappedData;
      else if (table === 'activity_logs') result['loginActivity'] = mappedData;
      else if (table !== 'settings') result[table] = mappedData;
      
      if (table === 'settings') {
        const settingsMap = {};
        for (const s of mappedData) {
          settingsMap[s.key] = s.value;
        }
        result.defaultTaxRate = settingsMap.defaultTaxRate || 0;
        result.expiryAlertThreshold = settingsMap.expiryAlertThreshold || 30;
        result.branch = settingsMap.branch || null;
        result.apiConfig = settingsMap.apiConfig || null;
      }
    }

    // Fetch sale_items and attach to sales
    let itemsQuery = supabase.from('sale_items').select('*');
    if (!isSuperAdmin && pharmacyId) {
      itemsQuery = itemsQuery.eq('pharmacy_id', pharmacyId);
    }
    const { data: saleItemsData, error: saleItemsError } = await itemsQuery;
    if (saleItemsError) throw saleItemsError;
    
    const mappedSaleItems = (saleItemsData || []).map(item => toCamelCase('sale_items', item));
    const salesWithItems = (result.sales || []).map(sale => {
      return {
        ...sale,
        items: mappedSaleItems.filter(item => item.saleId === sale.id)
      };
    });
    result.sales = salesWithItems;

    const cacheKey = pharmacyId ? `db_snapshot_${pharmacyId}` : 'db_snapshot';
    await setCacheData(cacheKey, result);
    return result;
  } catch (error) {
    console.error('[DB] Error in getData:', error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Inserts a record into Supabase with automatic tenant attribution.
 */
export async function addRecord(collectionName, record) {
  const table = getTableName(collectionName);
  const currentUser = getCurrentUser();
  
  // Automatically inject pharmacy_id if not present and table supports it
  const recordWithTenant = { ...record };
  if (!recordWithTenant.pharmacyId && currentUser?.pharmacyId && table !== 'pharmacies') {
    recordWithTenant.pharmacyId = currentUser.pharmacyId;
  }

  const snakeRecord = toSnakeCase(table, recordWithTenant);
  console.log(`[DB] addRecord to ${table}`);

  try {
    if (!isOnline()) {
      await enqueueOfflineWrite('INSERT', table, { record: snakeRecord });
      return;
    }

    const supabase = getSupabaseClient();
    let currentPayload = { ...snakeRecord };
    let data = null;
    let error = null;

    // Retry loop in case remote database is missing newer schema columns
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await supabase.from(table).insert([currentPayload]).select();
      data = res.data;
      error = res.error;

      if (!error) break;

      const missingColMatch = error.message?.match(/Could not find the '([^']+)' column/i);
      if (missingColMatch && missingColMatch[1] && currentPayload[missingColMatch[1]] !== undefined) {
        const missingCol = missingColMatch[1];
        console.warn(`[DB] Schema missing column "${missingCol}" on table "${table}". Retrying insert without this column.`);
        delete currentPayload[missingCol];
        continue;
      }
      break;
    }

    if (error) throw new Error(error.message || JSON.stringify(error));
    return data && data[0] ? toCamelCase(table, data[0]) : null;
  } catch (error) {
    console.error(`[DB] Error in addRecord for ${collectionName}:`, error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Updates a record in Supabase.
 */
export async function updateRecord(collectionName, id, updates) {
  const table = getTableName(collectionName);
  const snakeUpdates = toSnakeCase(table, updates);
  console.log(`[DB] updateRecord in ${table} id ${id}`);

  try {
    if (!isOnline()) {
      await enqueueOfflineWrite('UPDATE', table, { id, updates: snakeUpdates });
      return;
    }

    const supabase = getSupabaseClient();
    let currentPayload = { ...snakeUpdates };
    let data = null;
    let error = null;

    // Retry loop in case remote database is missing newer schema columns
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await supabase.from(table).update(currentPayload).eq('id', id).select();
      data = res.data;
      error = res.error;

      if (!error) break;

      const missingColMatch = error.message?.match(/Could not find the '([^']+)' column/i);
      if (missingColMatch && missingColMatch[1] && currentPayload[missingColMatch[1]] !== undefined) {
        const missingCol = missingColMatch[1];
        console.warn(`[DB] Schema missing column "${missingCol}" on table "${table}". Retrying update without this column.`);
        delete currentPayload[missingCol];
        continue;
      }
      break;
    }

    if (error) throw new Error(error.message || JSON.stringify(error));
    return data && data[0] ? toCamelCase(table, data[0]) : null;
  } catch (error) {
    console.error(`[DB] Error in updateRecord for ${collectionName}:`, error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Deletes a record from Supabase.
 */
export async function deleteRecord(collectionName, id) {
  const table = getTableName(collectionName);
  console.log(`[DB] deleteRecord from ${table} id ${id}`);

  try {
    if (!isOnline()) {
      await enqueueOfflineWrite('DELETE', table, { id });
      return;
    }

    const supabase = getSupabaseClient();
    
    // For sales, delete items first if we aren't using database cascades
    if (table === 'sales') {
      const { error: itemsError } = await supabase.from('sale_items').delete().eq('sale_id', id);
      if (itemsError) throw itemsError;
    }

    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw new Error(error.message || JSON.stringify(error));
  } catch (error) {
    console.error(`[DB] Error in deleteRecord for ${collectionName}:`, error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Indicates if the database is ready.
 */
export function isReady() {
  return true;
}

/**
 * Upserts a setting value per pharmacy.
 */
export async function setSetting(key, value) {
  console.log(`[DB] setSetting ${key}`);
  try {
    const currentUser = getCurrentUser();
    const pharmacyId = currentUser?.pharmacyId;

    if (!pharmacyId && currentUser?.role !== 'superadmin') {
      throw new Error('Cannot set setting without an active pharmacy context.');
    }

    if (!isOnline()) {
      await enqueueOfflineWrite('UPSERT', 'settings', { record: { pharmacy_id: pharmacyId, key, value } });
      return;
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from('settings').upsert(
      { pharmacy_id: pharmacyId, key, value },
      { onConflict: 'pharmacy_id,key,branch_id' }
    );
    if (error) throw new Error(error.message || JSON.stringify(error));
  } catch (error) {
    console.error(`[DB] Error in setSetting for ${key}:`, error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Retrieves a setting value per pharmacy.
 */
export async function getSetting(key) {
  console.log(`[DB] getSetting ${key}`);
  try {
    const currentUser = getCurrentUser();
    const pharmacyId = currentUser?.pharmacyId;

    if (!isOnline()) {
      const cacheKey = pharmacyId ? `db_snapshot_${pharmacyId}` : 'db_snapshot';
      const cached = await getCacheData(cacheKey);
      if (cached && cached[key] !== undefined) return cached[key];
      return null;
    }

    const supabase = getSupabaseClient();
    let query = supabase.from('settings').select('value').eq('key', key);
    if (pharmacyId) {
      query = query.eq('pharmacy_id', pharmacyId);
    }
    const { data, error } = await query.maybeSingle();
    if (error && error.code !== 'PGRST116') throw new Error(error.message || JSON.stringify(error));
    return data ? data.value : null;
  } catch (error) {
    console.error(`[DB] Error in getSetting for ${key}:`, error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Runs the expiry check RPC.
 */
export async function runExpiryCheck() {
  console.log('[DB] runExpiryCheck');
  try {
    if (!isOnline()) {
      console.log('[DB] Offline, skipping runExpiryCheck');
      return;
    }
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('update_expired_batches');
    if (error) throw new Error(error.message || JSON.stringify(error));
  } catch (error) {
    console.error('[DB] Error in runExpiryCheck:', error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Processes a sale transaction atomically with multi-tenant pharmacy scoping.
 */
export async function processSaleAtomic(saleData) {
  console.log('[DB] processSaleAtomic (SaaS)');
  try {
    const currentUser = getCurrentUser();
    const pharmacyId = currentUser?.pharmacyId;
    const p_sale_id = crypto.randomUUID();
    const p_total_tax = saleData.totalTax || 0;
    const p_total_amount = saleData.totalAmount || 0;
    const p_subtotal = saleData.subtotal || (p_total_amount - p_total_tax);
    
    const p_items = (saleData.items || []).map(item => {
      return {
        medicine_id: item.medicineId,
        batch_id: item.batchId,
        batch_number: item.batchNumber,
        name: item.name,
        quantity: item.quantity,
        price_at_sale: item.priceAtSale,
        tax_rate_at_sale: item.taxRateAtSale,
        tax_amount: item.taxAmount,
        subtotal_item: item.subtotalItem
      };
    });

    const p_metadata = {
      customer_id: saleData.customerId || null,
      prescription_id: saleData.prescriptionId || null,
      payment_method: saleData.paymentMethod || 'cash',
      payments: saleData.payments || [{ method: saleData.paymentMethod || 'cash', amount: p_total_amount }],
      discount_amount: saleData.discountAmount || 0,
      cash_received: saleData.cashReceived ?? null,
      change_amount: saleData.changeAmount || 0,
      notes: saleData.notes || null
    };

    if (!isOnline()) {
      await enqueueOfflineWrite('RPC', 'process_sale', { 
        args: { p_sale_id, p_items, p_subtotal, p_total_tax, p_total_amount, p_metadata } 
      });
      return {
        id: p_sale_id,
        dateTime: new Date().toISOString(),
        subtotal: p_subtotal,
        totalTax: p_total_tax,
        totalAmount: p_total_amount,
        customerId: saleData.customerId || null,
        paymentMethod: p_metadata.payment_method,
        payments: p_metadata.payments,
        discountAmount: p_metadata.discount_amount,
        cashReceived: p_metadata.cash_received,
        changeAmount: p_metadata.change_amount,
        items: saleData.items
      };
    }

    const supabase = getSupabaseClient();
    const adminClient = getAdminClient();
    const dbClient = adminClient || supabase;

    // 1. Resolve branch ID reliably
    let branchId = currentUser?.branchId || null;
    if (!branchId && currentUser?.id) {
      const { data: uRow } = await dbClient.from('app_users').select('branch_id').eq('id', currentUser.id).single();
      branchId = uRow?.branch_id || null;
    }
    if (!branchId && pharmacyId) {
      const { data: bRow } = await dbClient.from('branches').select('id').eq('pharmacy_id', pharmacyId).order('created_at', { ascending: true }).limit(1).maybeSingle();
      branchId = bRow?.id || null;
    }

    // 2. Insert parent sale record
    const { error: saleErr } = await dbClient.from('sales').insert({
      id: p_sale_id,
      pharmacy_id: pharmacyId,
      date_time: new Date().toISOString(),
      subtotal: p_subtotal,
      total_tax: p_total_tax,
      total_amount: p_total_amount,
      cashier_user_id: currentUser?.id || null,
      branch_id: branchId,
      customer_id: saleData.customerId || null,
      prescription_id: saleData.prescriptionId || null,
      payment_method: p_metadata.payment_method,
      discount_amount: p_metadata.discount_amount,
      cash_received: p_metadata.cash_received,
      change_amount: p_metadata.change_amount,
      notes: p_metadata.notes
    });
    if (saleErr) {
      console.error('[DB] Failed to insert parent sale:', saleErr);
      throw new Error(`Failed to create sale: ${saleErr.message || JSON.stringify(saleErr)}`);
    }

    // 3. Batch insert all sale items
    if (p_items.length > 0) {
      const saleItemRows = p_items.map(item => ({
        id: crypto.randomUUID(),
        pharmacy_id: pharmacyId,
        sale_id: p_sale_id,
        medicine_id: item.medicine_id,
        batch_id: item.batch_id,
        batch_number: item.batch_number,
        name: item.name,
        quantity: item.quantity,
        price_at_sale: item.price_at_sale,
        tax_rate_at_sale: item.tax_rate_at_sale,
        tax_amount: item.tax_amount,
        subtotal_item: item.subtotal_item,
        branch_id: branchId
      }));

      const { error: itemsErr } = await dbClient.from('sale_items').insert(saleItemRows);
      if (itemsErr) {
        console.error('[DB] Failed to insert sale items, rolling back sale:', itemsErr);
        await dbClient.from('sales').delete().eq('id', p_sale_id);
        throw new Error(`Failed to save sale items: ${itemsErr.message || JSON.stringify(itemsErr)}`);
      }

      // 4. Update batch stock for each sold item
      for (const item of p_items) {
        if (item.batch_id) {
          const { data: bRow } = await dbClient.from('batches').select('quantity_in_stock').eq('id', item.batch_id).single();
          if (bRow) {
            const newStock = Math.max(0, (bRow.quantity_in_stock || 0) - item.quantity);
            await dbClient.from('batches').update({ quantity_in_stock: newStock }).eq('id', item.batch_id);
          }
        }
      }
    }
    
    return {
      id: p_sale_id,
      dateTime: new Date().toISOString(),
      subtotal: p_subtotal,
      totalTax: p_total_tax,
      totalAmount: p_total_amount,
      customerId: saleData.customerId || null,
      paymentMethod: p_metadata.payment_method,
      payments: p_metadata.payments,
      discountAmount: p_metadata.discount_amount,
      cashReceived: p_metadata.cash_received,
      changeAmount: p_metadata.change_amount,
      items: saleData.items
    };
  } catch (error) {
    console.error('--- processSaleAtomic ERROR ---', error);
    throw new Error(error.message || JSON.stringify(error));
  }
}

/**
 * Returns connection status and offline queue count.
 */
export async function getConnectionStatus() {
  let count = 0;
  try {
    count = await getQueueCount();
  } catch (e) {
    console.error('[DB] Error getting queue count:', e);
  }
  
  return {
    isOnline: isOnline(),
    offlineQueueCount: count
  };
}

export async function saveData() {
  console.log('[DB] saveData called (no-op in cloud-first)');
}
