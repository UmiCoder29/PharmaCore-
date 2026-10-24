const { app, ipcMain } = require('electron');
const path = require('path');
const { registerAppIpcHandlers } = require('../electron/api.js');

app.whenReady().then(async () => {
  console.log('--- REPRODUCING BUG IN ELECTRON ENV ---');
  registerAppIpcHandlers(ipcMain);
  
  // Mock login so requireAuth() passes
  const auth = require('../electron/auth.js');
  auth._currentUser = { id: 'mock-user-id', role: 'admin' };

  try {
    console.log('Sending api:process-sale with old payload format { items: cart, totalAmount: undefined }');
    // Simulate what the old broken code did:
    const oldPayloadFormat = undefined; 
    
    // We invoke the handler exactly as ipcRenderer would
    const handler = ipcMain._invokeHandlers.get('api:process-sale');
    await handler({}, oldPayloadFormat);
  } catch (err) {
    console.error('--- CAPTURED ERROR STACK TRACE ---');
    console.error(err.stack || err);
  }
  
  app.quit();
});
