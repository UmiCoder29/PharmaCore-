/**
 * PharmaCore – Shared path resolver
 *
 * Centralises the logic that decides WHERE on disk to store data files.
 * Both electron/offlineQueue.js and electron/localCache.js import from here so the
 * resolution logic is defined exactly once.
 *
 *   Production  →  Electron app.getPath('userData')
 *                  e.g.  C:\Users\<user>\AppData\Roaming\pharmacore\
 *   Tests       →  process.env._PHARMACORE_TEST_DATA_DIR
 */

let _app = null;

/**
 * Must be called from main.js with the Electron `app` object before any
 * data-layer functions are invoked.
 * In unit tests the env-var override makes this call optional.
 *
 * @param {import('electron').App} electronApp
 */
export function setApp(electronApp) {
  _app = electronApp;
}

/**
 * @returns {string}  Absolute path to the directory that holds all data files.
 */
export function getDataDir() {
  if (process.env._PHARMACORE_TEST_DATA_DIR) {
    return process.env._PHARMACORE_TEST_DATA_DIR;
  }
  if (!_app) {
    throw new Error(
      '[PharmaCore] paths.setApp(app) must be called from main.js before ' +
      'any data-layer function is used.'
    );
  }
  return _app.getPath('userData');
}
