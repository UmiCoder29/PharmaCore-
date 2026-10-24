import fs from 'fs';
import path from 'path';
import { getDataDir } from './paths.js';

/**
 * Gets the path to the local cache JSON file.
 * @returns {string} The path to the cache file.
 */
function getCacheFilePath() {
  return path.join(getDataDir(), 'pharmacore_cache.json');
}

/**
 * Reads the entire cache file.
 * @returns {Object} The cache object.
 */
function readCache() {
  try {
    const filePath = getCacheFilePath();
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[LocalCache] Error reading cache file:', error);
    return {};
  }
}

/**
 * Saves data to the cache under a specific key.
 * @param {string} key The cache key (e.g., 'medicines', 'batches').
 * @param {any} data The data to cache.
 */
export function setCacheData(key, data) {
  try {
    const cache = readCache();
    cache[key] = {
      data,
      lastSynced: new Date().toISOString()
    };
    
    fs.writeFileSync(getCacheFilePath(), JSON.stringify(cache, null, 2), 'utf8');
    console.log(`[LocalCache] Cache updated for key: ${key}`);
  } catch (error) {
    console.error('[LocalCache] Error setting cache data:', error);
    throw error;
  }
}

/**
 * Retrieves data from the cache for a specific key.
 * @param {string} key The cache key.
 * @returns {Object|null} The cached data object containing { data, lastSynced }, or null if not found.
 */
export function getCacheData(key) {
  const cache = readCache();
  if (cache[key]) {
    return cache[key];
  }
  return null;
}

/**
 * Empties the entire cache.
 */
export function clearCache() {
  try {
    fs.writeFileSync(getCacheFilePath(), JSON.stringify({}), 'utf8');
    console.log('[LocalCache] Cache cleared');
  } catch (error) {
    console.error('[LocalCache] Error clearing cache:', error);
    throw error;
  }
}

/**
 * Gets the last sync time for a specific cache key.
 * @param {string} key The cache key.
 * @returns {string|null} The ISO timestamp of the last sync, or null if not found.
 */
export function getLastSyncTime(key) {
  const cacheData = getCacheData(key);
  if (cacheData && cacheData.lastSynced) {
    return cacheData.lastSynced;
  }
  return null;
}
