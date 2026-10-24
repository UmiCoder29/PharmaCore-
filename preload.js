/**
 * PharmaCore Preload Script (Multi-Tenant SaaS)
 *
 * Runs in the renderer process but has access to Node's contextBridge and
 * Electron's ipcRenderer. Exposes a safe, typed API under window.pharmacoreAPI.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pharmacoreAPI', {
  // ─── Settings ─────────────────────────────────────────────────────────────
  getDefaultTaxRate: () => ipcRenderer.invoke('api:getDefaultTaxRate'),
  setDefaultTaxRate: (rate) => ipcRenderer.invoke('api:setDefaultTaxRate', rate),
  getExpiryThreshold: () => ipcRenderer.invoke('api:getExpiryThreshold'),
  setExpiryThreshold: (threshold) => ipcRenderer.invoke('api:setExpiryThreshold', threshold),

  // ─── Generic invoke ───────────────────────────────────────────────────────
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),

  // ─── Auth ─────────────────────────────────────────────────────────────────
  getIsFirstRun: () => ipcRenderer.invoke('api:get-is-first-run'),
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  createUser: (username, name, password, role, branchId) =>
    ipcRenderer.invoke('auth:create-user', { username, name, password, role, branchId }),
  updateUsername: (userId, newUsername, newName) =>
    ipcRenderer.invoke('auth:update-username', { userId, newUsername, newName }),
  updateUserBranch: (userId, newBranchId) =>
    ipcRenderer.invoke('auth:update-user-branch', { userId, newBranchId }),
  resetUserPassword: (userId, newPassword) =>
    ipcRenderer.invoke('auth:reset-user-password', { userId, newPassword }),
  changePassword: (newPassword) =>
    ipcRenderer.invoke('auth:change-password', { newPassword }),
  register: (username, name, password, role, branchId, branchName) =>
    ipcRenderer.invoke('auth:register', { username, name, password, role, branchId, branchName }),
  registerPharmacy: (data) =>
    ipcRenderer.invoke('auth:register-pharmacy', data),

  getUsers: () => ipcRenderer.invoke('api:get-users'),

  // ─── SaaS SuperAdmin Platform Management ──────────────────────────────────
  getPharmacies: () => ipcRenderer.invoke('saas:get-pharmacies'),
  createPharmacy: (data) => ipcRenderer.invoke('saas:create-pharmacy', data),
  updatePharmacySubscription: (pharmacyId, updates) =>
    ipcRenderer.invoke('saas:update-pharmacy-subscription', { pharmacyId, updates }),
  togglePharmacyStatus: (pharmacyId, status) =>
    ipcRenderer.invoke('saas:toggle-pharmacy-status', { pharmacyId, status }),
  getPlatformStats: () => ipcRenderer.invoke('saas:get-platform-stats'),
  getSaasInquiries: () => ipcRenderer.invoke('saas:get-inquiries'),
  sendSaasReply: (pharmacyId, message, inquiryType) =>
    ipcRenderer.invoke('saas:send-reply', { pharmacyId, message, inquiryType }),
  markSaasInquiriesRead: (pharmacyId) =>
    ipcRenderer.invoke('saas:mark-inquiries-read', pharmacyId),
  getSubscriptionPlans: () => ipcRenderer.invoke('saas:get-plans'),
  createSubscriptionPlan: (data) => ipcRenderer.invoke('saas:create-plan', data),
  updateSubscriptionPlan: (id, updates) =>
    ipcRenderer.invoke('saas:update-plan', { id, updates }),
  deleteSubscriptionPlan: (id) => ipcRenderer.invoke('saas:delete-plan', id),
  getPlatformSettings: () => ipcRenderer.invoke('saas:get-platform-settings'),
  updatePlatformSettings: (key, value, category) =>
    ipcRenderer.invoke('saas:update-platform-settings', { key, value, category }),
  updatePlatformSetting: (key, value, category) =>
    ipcRenderer.invoke('saas:update-platform-settings', { key, value, category }),
  savePlatformSettings: (key, value, category) =>
    ipcRenderer.invoke('saas:update-platform-settings', { key, value, category }),
  savePlatformSetting: (key, value, category) =>
    ipcRenderer.invoke('saas:update-platform-settings', { key, value, category }),
  getPublicConfig: () => ipcRenderer.invoke('platform:get-public-config'),
  getDbConfig: () => ipcRenderer.invoke('saas:get-db-config'),
  saveDbConfig: (config) => ipcRenderer.invoke('saas:save-db-config', config),
  testDbConnection: (config) => ipcRenderer.invoke('saas:test-db-connection', config),

  // ─── Pharmacy Tenant Subscription & Profile ───────────────────────────────
  getCurrentSubscription: () => ipcRenderer.invoke('pharmacy:get-current-subscription'),
  updatePharmacyProfile: (updates) => ipcRenderer.invoke('pharmacy:update-profile', updates),
  savePharmacyProfile: (updates) => ipcRenderer.invoke('pharmacy:update-profile', updates),
  updatePharmacyBranding: (brandingData) => ipcRenderer.invoke('pharmacy:update-branding', brandingData),
  savePharmacyBranding: (brandingData) => ipcRenderer.invoke('pharmacy:update-branding', brandingData),
  getPharmacyInquiries: () => ipcRenderer.invoke('pharmacy:get-inquiries'),
  sendPharmacyInquiry: (message, inquiryType, requestedPlan) =>
    ipcRenderer.invoke('pharmacy:send-inquiry', { message, inquiryType, requestedPlan }),
  markPharmacyInquiriesRead: () => ipcRenderer.invoke('pharmacy:mark-inquiries-read'),

  // ─── Patients / Customers & Prescriptions ─────────────────────────────────
  getCustomers: (search) => ipcRenderer.invoke('api:get-customers', search),
  addCustomer: (data) => ipcRenderer.invoke('api:add-customer', data),
  updateCustomer: (id, updates) => ipcRenderer.invoke('api:update-customer', { id, updates }),
  deleteCustomer: (id) => ipcRenderer.invoke('api:delete-customer', id),
  getPrescriptions: (customerId) => ipcRenderer.invoke('api:get-prescriptions', customerId),
  addPrescription: (data) => ipcRenderer.invoke('api:add-prescription', data),

  // ─── Activity Log ─────────────────────────────────────────────────────────
  getLoginActivity: () => ipcRenderer.invoke('api:get-login-activity'),

  // ─── Branches ─────────────────────────────────────────────────────────────
  getBranches: () => ipcRenderer.invoke('api:get-branches'),
  addBranch: (data) => ipcRenderer.invoke('api:add-branch', data),

  // ─── Medicines ────────────────────────────────────────────────────────────
  getMedicines: (options) => ipcRenderer.invoke('api:get-medicines', options),
  addMedicine: (data) => ipcRenderer.invoke('api:add-medicine', data),
  updateMedicine: (id, updates) => ipcRenderer.invoke('api:update-medicine', { id, updates }),
  deleteMedicine: (id) => ipcRenderer.invoke('api:delete-medicine', id),

  // ─── Batches ──────────────────────────────────────────────────────────────
  addBatch: (data) => ipcRenderer.invoke('api:add-batch', data),
  updateBatch: (id, updates) => ipcRenderer.invoke('api:update-batch', { id, updates }),
  deleteBatch: (id) => ipcRenderer.invoke('api:delete-batch', id),
  getExpiredBatches: () => ipcRenderer.invoke('api:get-expired-batches'),

  // ─── Suppliers ────────────────────────────────────────────────────────────
  getSuppliers: () => ipcRenderer.invoke('api:get-suppliers'),
  addSupplier: (data) => ipcRenderer.invoke('api:add-supplier', data),
  updateSupplier: (id, updates) => ipcRenderer.invoke('api:update-supplier', { id, updates }),
  deleteSupplier: (id) => ipcRenderer.invoke('api:delete-supplier', id),

  // ─── Categories ───────────────────────────────────────────────────────────
  getCategories: () => ipcRenderer.invoke('api:get-categories'),
  addCategory: (data) => ipcRenderer.invoke('api:add-category', data),
  updateCategory: (id, updates) => ipcRenderer.invoke('api:update-category', { id, updates }),
  deleteCategory: (id) => ipcRenderer.invoke('api:delete-category', id),

  // ─── POS / Sales ──────────────────────────────────────────────────────────
  processSale: (saleData) => ipcRenderer.invoke('api:process-sale', saleData),
  getSales: () => ipcRenderer.invoke('api:get-sales'),
  deleteSale: (id) => ipcRenderer.invoke('api:delete-sale', id),

  // ─── Returns & Refunds ────────────────────────────────────────────────────
  processReturn: (returnData) => ipcRenderer.invoke('api:process-return', returnData),
  approveReturn: (returnId) => ipcRenderer.invoke('api:approve-return', returnId),
  getReturns: () => ipcRenderer.invoke('api:get-returns'),
  getQuarantine: () => ipcRenderer.invoke('api:get-quarantine'),

  // ─── Connection Status ────────────────────────────────────────────────────
  getConnectionStatus: () => ipcRenderer.invoke('api:get-connection-status'),
  getSupplierDashboard: () => ipcRenderer.invoke('api:get-supplier-dashboard'),
  getSupplierDetails: (id) => ipcRenderer.invoke('api:get-supplier-details', id),

  // ─── Native Hardware Printing ─────────────────────────────────────────────
  printReceipt: (options) => ipcRenderer.invoke('app:print', options),
});
