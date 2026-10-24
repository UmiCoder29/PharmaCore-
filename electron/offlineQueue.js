import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDataDir } from './paths.js';

/**
 * Gets the path to the offline queue JSON file.
 * @returns {string} The path to the queue file.
 */
function getQueueFilePath() {
  return path.join(getDataDir(), 'pharmacore_offline_queue.json');
}

/**
 * Gets all queued offline writes.
 * @returns {Array<Object>} The array of queued writes.
 */
export function getQueuedWrites() {
  try {
    const filePath = getQueueFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[OfflineQueue] Error reading queue file:', error);
    return [];
  }
}

/**
 * Enqueues an operation to the offline write queue.
 * @param {string} table The database table name.
 * @param {string} operation The operation type (e.g., 'INSERT', 'UPDATE', 'DELETE').
 * @param {Object} payload The data payload.
 * @returns {Object} The queued item.
 */
export function enqueueOfflineWrite(table, operation, payload) {
  try {
    const queue = getQueuedWrites();
    const item = {
      id: crypto.randomUUID(),
      table,
      operation,
      payload,
      timestamp: new Date().toISOString()
    };
    queue.push(item);
    
    fs.writeFileSync(getQueueFilePath(), JSON.stringify(queue, null, 2), 'utf8');
    console.log(`[OfflineQueue] Enqueued offline write for table ${table}, operation ${operation}, id ${item.id}`);
    
    return item;
  } catch (error) {
    console.error('[OfflineQueue] Error enqueueing write:', error);
    throw error;
  }
}

/**
 * Empties the offline write queue.
 */
export function clearQueue() {
  try {
    fs.writeFileSync(getQueueFilePath(), JSON.stringify([]), 'utf8');
    console.log('[OfflineQueue] Queue cleared');
  } catch (error) {
    console.error('[OfflineQueue] Error clearing queue:', error);
    throw error;
  }
}

/**
 * Removes a specific item from the queue by ID.
 * @param {string} id The queue item ID.
 * @returns {boolean} True if removed, false otherwise.
 */
export function removeQueueItem(id) {
  try {
    const queue = getQueuedWrites();
    const initialLength = queue.length;
    const newQueue = queue.filter(item => item.id !== id);
    
    if (newQueue.length !== initialLength) {
      fs.writeFileSync(getQueueFilePath(), JSON.stringify(newQueue, null, 2), 'utf8');
      console.log(`[OfflineQueue] Removed queue item ${id}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error('[OfflineQueue] Error removing queue item:', error);
    return false;
  }
}

/**
 * Gets the count of pending queue items.
 * @returns {number} The count of items in the queue.
 */
export function getQueueCount() {
  const queue = getQueuedWrites();
  return queue.length;
}
