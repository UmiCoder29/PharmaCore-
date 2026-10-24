/**
 * PharmaCore – Real-Time Sync Engine
 *
 * Handles bidirectional sync between the local SQLite database and Supabase:
 *   - PUSH: Drains the sync_queue table (local changes → Supabase)
 *   - PULL: Subscribes to Supabase Realtime for changes from other branches
 *
 * Sync strategy:
 *   - Every local mutation (INSERT/UPDATE/DELETE) enqueues a sync_queue entry
 *   - The engine polls the queue every 5 seconds and pushes to Supabase
 *   - On success, the queue entry is deleted
 *   - On failure, the attempt counter is incremented (max 5 retries)
 *   - Supabase Realtime channels listen for changes from other branches
 *   - Incoming changes are written to local SQLite (skip if same branch)
 */

import { getPendingSyncs, markSynced, markSyncFailed, getBranch, getSupabaseConfig, getFailedSyncsCount } from './db.js';
import { getSupabaseClient, initSupabase, clearSupabase } from './supabaseClient.js';

let _pushInterval = null;
let _realtimeChannel = null;
let _isRunning = false;
let _syncStatus = { online: false, lastPush: null, lastPull: null, pendingCount: 0, error: null };

const TABLE_MAP = {
  medicines: 'medicines',
  batches: 'batches',
  suppliers: 'suppliers',
  categories: 'categories',
  prescriptions: 'prescriptions',
  sales: 'sales',
  sale_items: 'sale_items',
  login_activity: 'login_activity',
  settings: 'settings',
  users: 'users',
  branch: 'branch',
};

// ─── Push: Local → Cloud ────────────────────────────────────────────────────

async function pushPendingChanges() {
  const client = getSupabaseClient();
  if (!client) return;

  const pending = getPendingSyncs(20);
  
  if (pending.length === 0) {
    if (_syncStatus.pendingCount > 0) _syncStatus.pendingCount = 0;
    return;
  }

  _syncStatus.pendingCount = pending.length;

  for (const entry of pending) {
    const supabaseTable = TABLE_MAP[entry.table_name];
    if (!supabaseTable) {
      markSynced(entry.id); // Unknown table, skip
      continue;
    }

    try {
      const payload = JSON.parse(entry.payload || '{}');
      let result;

      switch (entry.operation) {
        case 'INSERT':
          result = await client.from(supabaseTable).upsert(payload, { onConflict: 'id' });
          break;
        case 'UPDATE':
          result = await client.from(supabaseTable).upsert(payload, { onConflict: 'id' });
          break;
        case 'DELETE':
          result = await client.from(supabaseTable).delete().eq('id', entry.record_id);
          break;
        default:
          console.warn('[Sync] Unknown operation:', entry.operation);
          markSynced(entry.id);
          continue;
      }

      if (result.error) {
        console.error('[Sync] Push error:', result.error.message);
        markSyncFailed(entry.id);
        _syncStatus.error = result.error.message;
      } else {
        markSynced(entry.id);
        _syncStatus.lastPush = new Date().toISOString();
        _syncStatus.error = null;
      }
    } catch (err) {
      console.error('[Sync] Push exception:', err.message);
      markSyncFailed(entry.id);
      _syncStatus.error = err.message;
    }
  }
}

// ─── Pull: Cloud → Local (Realtime) ─────────────────────────────────────────

function subscribeToPull() {
  const client = getSupabaseClient();
  if (!client) return;

  const branch = getBranch();
  const branchId = branch?.id;

  // Subscribe to all table changes
  const tables = Object.values(TABLE_MAP);

  _realtimeChannel = client
    .channel('pharmacore-sync')
    .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
      // Skip changes from our own branch
      if (payload.new?.branchId === branchId || payload.old?.branchId === branchId) {
        return;
      }

      console.log('[Sync] Received change from cloud:', payload.table, payload.eventType);
      _syncStatus.lastPull = new Date().toISOString();

      // NOTE: Writing incoming changes to local SQLite would be done here.
      // For now, we log the change. A full implementation would:
      // 1. Map the Supabase table name back to the local table
      // 2. INSERT/UPDATE/DELETE in local SQLite (without re-enqueueing to sync_queue)
      // 3. Emit an IPC event to refresh the React UI
    })
    .subscribe((status) => {
      console.log('[Sync] Realtime subscription status:', status);
      _syncStatus.online = (status === 'SUBSCRIBED');
    });
}

// ─── Engine Lifecycle ────────────────────────────────────────────────────────

/**
 * Starts the sync engine. Call after login when the DB is open.
 */
export function startSync() {
  const config = getSupabaseConfig();
  if (!config || !config.enabled) {
    console.log('[Sync] Cloud sync is disabled. Skipping.');
    return;
  }

  if (_isRunning) {
    console.log('[Sync] Already running.');
    return;
  }

  // Initialise Supabase client
  const client = initSupabase();
  if (!client) return;

  _isRunning = true;

  // Start push polling (every 5 seconds)
  _pushInterval = setInterval(() => {
    pushPendingChanges().catch(err => console.error('[Sync] Push cycle error:', err.message));
  }, 5000);

  // Start realtime pull subscription
  subscribeToPull();

  // Run an immediate push
  pushPendingChanges().catch(err => console.error('[Sync] Initial push error:', err.message));

  console.log('[Sync] Engine started.');
}

/**
 * Stops the sync engine. Call on logout.
 */
export function stopSync() {
  if (_pushInterval) {
    clearInterval(_pushInterval);
    _pushInterval = null;
  }

  if (_realtimeChannel) {
    const client = getSupabaseClient();
    if (client) {
      client.removeChannel(_realtimeChannel);
    }
    _realtimeChannel = null;
  }

  clearSupabase();
  _isRunning = false;
  _syncStatus = { online: false, lastPush: null, lastPull: null, pendingCount: 0, error: null };
  console.log('[Sync] Engine stopped.');
}

/**
 * Returns the current sync status for the UI.
 */
export function getSyncStatus() {
  const failedCount = getFailedSyncsCount();
  return { ..._syncStatus, running: _isRunning, failedCount };
}
