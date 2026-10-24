import crypto from 'crypto';
import { Notification } from 'electron';
import {
  addRecord,
  updateRecord,
  deleteRecord,
  setSetting,
  getSetting,
  runExpiryCheck,
  processSaleAtomic,
  toSnakeCase
} from './db.js';
import { 
  getSupabaseClient, 
  getConnectionStatus, 
  getAdminClient,
  loadDatabaseConfig,
  saveDatabaseConfig,
  testDatabaseConnection
} from './supabaseClient.js';
import { getCacheData, setCacheData } from './localCache.js';
import { getCurrentUser, updateCurrentUserPharmacyBranding } from './auth.js';

/**
 * Converts snake_case object keys to camelCase.
 * @param {any} obj 
 * @returns {any}
 */
function toCamelCase(obj) {
  if (Array.isArray(obj)) {
    return obj.map(v => toCamelCase(v));
  } else if (obj !== null && obj.constructor === Object) {
    return Object.keys(obj).reduce((result, key) => {
      const camelKey = key.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
      result[camelKey] = toCamelCase(obj[key]);
      return result;
    }, {});
  }
  return obj;
}

/**
 * Ensures the user is logged in.
 * @returns {Object} The current user.
 * @throws {Error} If no user is logged in.
 */
function requireAuth() {
  const user = getCurrentUser();
  if (!user) throw new Error('Unauthorized: Please log in.');
  return user;
}

/**
 * Ensures the user is logged in and has admin or superadmin role.
 * @returns {Object} The current admin user.
 * @throws {Error} If user is not admin.
 */
function requireAdmin() {
  const user = requireAuth();
  if (!['admin', 'superadmin'].includes(user.role)) {
    throw new Error('Forbidden: Admin access required.');
  }
  return user;
}

/**
 * Ensures the user is logged in and is the SaaS SuperAdmin (Platform Owner).
 * @returns {Object} The current superadmin user.
 * @throws {Error} If user is not superadmin.
 */
function requireSuperAdmin() {
  const user = requireAuth();
  if (user.role !== 'superadmin') {
    throw new Error('Forbidden: SaaS Platform SuperAdmin access required.');
  }
  return user;
}

/**
 * Registers application IPC handlers for all SaaS and POS features.
 * @param {import('electron').IpcMain} ipcMain 
 */
export function registerAppIpcHandlers(ipcMain) {
  // ============================================================================
  // --- SAAS SUPERADMIN CONTROL PANEL ENDPOINTS ---
  // ============================================================================

  // Get all registered pharmacies (Tenants)
  ipcMain.handle('saas:get-pharmacies', async () => {
    requireSuperAdmin();
    try {
      const adminClient = getAdminClient();
      if (!adminClient) throw new Error('Admin client not initialized.');

      const { data: pharmacies, error: pharmErr } = await adminClient
        .from('pharmacies')
        .select('*')
        .order('created_at', { ascending: false });

      if (pharmErr) throw pharmErr;

      // Enrich with branch, user, and sales counts
      const enriched = await Promise.all(
        (pharmacies || []).map(async (pharm) => {
          const [branchesRes, usersRes, salesRes] = await Promise.all([
            adminClient.from('branches').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharm.id),
            adminClient.from('app_users').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharm.id),
            adminClient.from('sales').select('total_amount').eq('pharmacy_id', pharm.id)
          ]);

          const totalRevenue = (salesRes.data || []).reduce((acc, s) => acc + (parseFloat(s.total_amount) || 0), 0);

          return {
            ...toCamelCase(pharm),
            branchCount: branchesRes.count || 0,
            userCount: usersRes.count || 0,
            totalSalesVolume: totalRevenue
          };
        })
      );

      return enriched;
    } catch (error) {
      console.error('[SaaS API] Error getting pharmacies:', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // Provision new pharmacy tenant manually
  ipcMain.handle('saas:create-pharmacy', async (_event, pharmacyData) => {
    requireSuperAdmin();
    return await registerPharmacy(pharmacyData);
  });

  // Update a pharmacy's subscription, plan, validity or quotas
  ipcMain.handle('saas:update-pharmacy-subscription', async (_event, { pharmacyId, updates }) => {
    requireSuperAdmin();
    try {
      const adminClient = getAdminClient();
      if (!adminClient) throw new Error('Admin client unavailable.');

      const payload = {};
      if (updates.planTier !== undefined) payload.plan_tier = updates.planTier;
      if (updates.subscriptionStatus !== undefined) payload.subscription_status = updates.subscriptionStatus;
      if (updates.subscriptionEndsAt !== undefined) payload.subscription_ends_at = updates.subscriptionEndsAt;
      if (updates.maxBranches !== undefined) payload.max_branches = parseInt(updates.maxBranches, 10);
      if (updates.maxUsers !== undefined) payload.max_users = parseInt(updates.maxUsers, 10);
      if (updates.isActive !== undefined) payload.is_active = updates.isActive;
      payload.updated_at = new Date().toISOString();

      const { data, error } = await adminClient
        .from('pharmacies')
        .update(payload)
        .eq('id', pharmacyId)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase(data);
    } catch (error) {
      console.error('[SaaS API] Error updating subscription:', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // Toggle active / suspend pharmacy tenant
  ipcMain.handle('saas:toggle-pharmacy-status', async (_event, { pharmacyId, status }) => {
    requireSuperAdmin();
    try {
      const adminClient = getAdminClient();
      const { data, error } = await adminClient
        .from('pharmacies')
        .update({
          subscription_status: status,
          is_active: status === 'active' || status === 'trial',
          updated_at: new Date().toISOString()
        })
        .eq('id', pharmacyId)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase(data);
    } catch (error) {
      console.error('[SaaS API] Error toggling status:', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // Platform-wide metrics for SaaS Owner Dashboard
  ipcMain.handle('saas:get-platform-stats', async () => {
    requireSuperAdmin();
    try {
      const adminClient = getAdminClient();
      if (!adminClient) throw new Error('Admin client unavailable.');

      const [pharmRes, usersRes, branchRes, salesRes] = await Promise.all([
        adminClient.from('pharmacies').select('*'),
        adminClient.from('app_users').select('id', { count: 'exact', head: true }),
        adminClient.from('branches').select('id', { count: 'exact', head: true }),
        adminClient.from('sales').select('total_amount, created_at')
      ]);

      const pharmacies = pharmRes.data || [];
      const totalPharmacies = pharmacies.length;
      const activeSubscriptions = pharmacies.filter(p => p.subscription_status === 'active').length;
      const trialSubscriptions = pharmacies.filter(p => p.subscription_status === 'trial').length;
      const suspendedSubscriptions = pharmacies.filter(p => ['suspended', 'past_due', 'cancelled'].includes(p.subscription_status)).length;

      // Estimated Monthly Recurring Revenue based on active plan tiers
      const mrr = pharmacies.reduce((sum, p) => {
        if (p.subscription_status !== 'active') return sum;
        if (p.plan_tier === 'starter') return sum + 3000;
        if (p.plan_tier === 'professional') return sum + 8000;
        if (p.plan_tier === 'enterprise') return sum + 20000;
        return sum;
      }, 0);

      const totalSalesRevenue = (salesRes.data || []).reduce((acc, s) => acc + (parseFloat(s.total_amount) || 0), 0);

      return {
        totalPharmacies,
        activeSubscriptions,
        trialSubscriptions,
        suspendedSubscriptions,
        totalUsers: usersRes.count || 0,
        totalBranches: branchRes.count || 0,
        totalSalesRevenue,
        estimatedMRR: mrr,
        currency: 'PKR'
      };
    } catch (error) {
      console.error('[SaaS API] Error calculating platform stats:', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- PHARMACY TENANT & SUBSCRIPTION CONSUMER ENDPOINTS ---
  // ============================================================================

  // Get current pharmacy tenant's subscription status & quota meters
  ipcMain.handle('pharmacy:get-current-subscription', async () => {
    const user = requireAuth();
    const pharmacyId = user.pharmacyId || '11111111-1111-1111-1111-111111111111';

    let pharmData = null;
    let branchCount = 1;
    let userCount = 1;

    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();

      if (dbClient) {
        const { data: pharm, error: pharmErr } = await dbClient
          .from('pharmacies')
          .select('*')
          .eq('id', pharmacyId)
          .single();

        if (!pharmErr && pharm) {
          pharmData = toCamelCase(pharm);
        }

        const [branchCountRes, userCountRes] = await Promise.all([
          dbClient.from('branches').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId),
          dbClient.from('app_users').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharmacyId)
        ]);
        branchCount = branchCountRes.count || 1;
        userCount = userCountRes.count || 1;
      }
    } catch (error) {
      console.warn('[Pharmacy API] Supabase get-current-subscription error:', error.message);
    }

    // Merge cached branding
    const cachedBranding = getCacheData(`pharmacy_branding_${pharmacyId}`);
    const brandingObj = (cachedBranding && cachedBranding.data) ? cachedBranding.data : {};

    const base = pharmData || {
      id: pharmacyId,
      name: user.pharmacyName || 'My Pharmacy Store',
      logoUrl: user.pharmacyLogo || null,
      planTier: 'professional',
      subscriptionStatus: 'active',
      maxBranches: 5,
      maxUsers: 15
    };

    const daysRemaining = base.subscriptionEndsAt
      ? Math.max(0, Math.ceil((new Date(base.subscriptionEndsAt) - new Date()) / (1000 * 60 * 60 * 24)))
      : 365;

    return {
      ...base,
      ...brandingObj,
      name: brandingObj.name || base.name,
      logoUrl: brandingObj.logoUrl !== undefined ? brandingObj.logoUrl : base.logoUrl,
      usedBranches: branchCount,
      maxBranches: base.maxBranches || 5,
      usedUsers: userCount,
      maxUsers: base.maxUsers || 15,
      daysRemaining,
      isExpired: daysRemaining <= 0 && base.subscriptionStatus !== 'active'
    };
  });

  // Update pharmacy profile
  ipcMain.handle('pharmacy:update-profile', async (_event, updates) => {
    const user = requireAdmin();
    if (!user.pharmacyId) throw new Error('No pharmacy associated with user.');

    try {
      const dbClient = getAdminClient() || getSupabaseClient();
      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.contactEmail !== undefined) payload.contact_email = updates.contactEmail.trim();
      if (updates.contactPhone !== undefined) payload.contact_phone = updates.contactPhone.trim();
      if (updates.address !== undefined) payload.address = updates.address.trim();
      if (updates.city !== undefined) payload.city = updates.city.trim();
      if (updates.taxNumber !== undefined) payload.tax_number = updates.taxNumber.trim();
      payload.updated_at = new Date().toISOString();

      const { data, error } = await dbClient
        .from('pharmacies')
        .update(payload)
        .eq('id', user.pharmacyId)
        .select()
        .single();

      if (error) throw error;
      return toCamelCase(data);
    } catch (error) {
      console.error('[Pharmacy API] Error updating profile:', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- SAAS CHAT, INQUIRIES & DUMMY PLANS (HYBRID CLOUD + LOCAL CACHE) ---
  // ============================================================================

  const DEFAULT_PLANS = [
    {
      id: '10000000-0000-0000-0000-000000000001',
      name: '14-Day Free Trial',
      slug: 'trial',
      description: 'Full feature access for newly registered pharmacies to test before purchasing.',
      priceMonthly: 0,
      priceAnnual: 0,
      currency: 'PKR',
      maxBranches: 1,
      maxUsers: 3,
      features: ['1 Store Branch', 'Up to 3 Staff Logins', 'Full POS & Barcode Scanning', 'Batch & Expiry Tracking', 'Thermal Receipt Printing'],
      badge: 'Trial',
      isPublic: true,
      isActive: true,
      sortOrder: 0
    },
    {
      id: '10000000-0000-0000-0000-000000000002',
      name: 'Starter Plan',
      slug: 'starter',
      description: 'Designed for single-counter independent retail pharmacy stores.',
      priceMonthly: 3000,
      priceAnnual: 30000,
      currency: 'PKR',
      maxBranches: 1,
      maxUsers: 3,
      features: ['1 Store Branch', 'Up to 3 Staff Accounts', 'Fast POS Register', 'Batch Expiry & Low Stock Alerts', 'Local Offline Mode & Cloud Sync', 'Customer Ledger'],
      badge: 'Single Store',
      isPublic: true,
      isActive: true,
      sortOrder: 1
    },
    {
      id: '10000000-0000-0000-0000-000000000003',
      name: 'Professional Plan',
      slug: 'professional',
      description: 'For busy pharmacies and growing multi-branch store networks.',
      priceMonthly: 8000,
      priceAnnual: 80000,
      currency: 'PKR',
      maxBranches: 5,
      maxUsers: 15,
      features: ['Up to 5 Branch Locations', 'Up to 15 Staff Accounts', 'Cross-Branch Stock Transfers', 'Supplier Profitability & Analytics', 'FBR Digital POS Invoicing', 'Priority Support'],
      badge: 'Most Popular',
      isPublic: true,
      isActive: true,
      sortOrder: 2
    },
    {
      id: '10000000-0000-0000-0000-000000000004',
      name: 'Enterprise Tier',
      slug: 'enterprise',
      description: 'For hospital networks, chain pharmacies, and wholesale distributor networks.',
      priceMonthly: 20000,
      priceAnnual: 200000,
      currency: 'PKR',
      maxBranches: 50,
      maxUsers: 100,
      features: ['Unlimited Branch Locations', 'Unlimited Staff Accounts', 'Custom ERP & Accounting APIs', '99.9% Uptime Guarantee', 'Dedicated Account Manager', 'Custom Role Permissions'],
      badge: 'Enterprise',
      isPublic: true,
      isActive: true,
      sortOrder: 3
    },
    {
      id: '10000000-0000-0000-0000-000000000005',
      name: 'Ultimate Chain ERP',
      slug: 'ultimate_chain',
      description: 'All-inclusive multi-city pharmacy empire management suite with AI forecasting.',
      priceMonthly: 45000,
      priceAnnual: 450000,
      currency: 'PKR',
      maxBranches: 200,
      maxUsers: 500,
      features: ['Unlimited Multi-City Branches', 'Automated Central Warehouse Restocking', 'Custom White-label Mobile App', '24/7 Dedicated Technical Engineer', 'Direct FBR Automated Gateway'],
      badge: 'Best Value',
      isPublic: true,
      isActive: true,
      sortOrder: 4
    }
  ];

  function getLocalInquiries() {
    const cached = getCacheData('subscription_inquiries');
    return (cached && Array.isArray(cached.data)) ? cached.data : [];
  }

  function saveLocalInquiry(item) {
    const list = getLocalInquiries();
    const existingIdx = list.findIndex(m => m.id === item.id);
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...item };
    } else {
      list.push(item);
    }
    setCacheData('subscription_inquiries', list);
    return item;
  }

  function getLocalPlans() {
    const cached = getCacheData('subscription_plans');
    if (cached && Array.isArray(cached.data) && cached.data.length > 0) {
      return cached.data;
    }
    setCacheData('subscription_plans', DEFAULT_PLANS);
    return DEFAULT_PLANS;
  }

  function saveLocalPlan(plan) {
    const list = getLocalPlans();
    const existingIdx = list.findIndex(p => p.id === plan.id || p.slug === plan.slug);
    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...plan };
    } else {
      list.push(plan);
    }
    setCacheData('subscription_plans', list);
    return plan;
  }

  function deleteLocalPlan(id) {
    const list = getLocalPlans().filter(p => p.id !== id && p.slug !== id);
    setCacheData('subscription_plans', list);
  }

  // SuperAdmin: Get all upgrade inquiries / chat messages across all pharmacies
  ipcMain.handle('saas:get-inquiries', async () => {
    requireSuperAdmin();
    let remoteList = [];
    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        const { data, error } = await adminClient
          .from('subscription_inquiries')
          .select('*, pharmacies(id, name, slug, contact_phone, contact_email, plan_tier, subscription_status)')
          .order('created_at', { ascending: true });
        if (!error && data) {
          remoteList = data.map(row => ({
            ...toCamelCase(row),
            pharmacy: row.pharmacies ? toCamelCase(row.pharmacies) : null
          }));
        }
      }
    } catch (_) {}

    const localList = getLocalInquiries();
    const map = new Map();
    [...remoteList, ...localList].forEach(item => {
      map.set(item.id, item);
    });

    const merged = Array.from(map.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return merged;
  });

  // SuperAdmin: Send reply message to a pharmacy
  ipcMain.handle('saas:send-reply', async (_event, { pharmacyId, message, inquiryType = 'general' }) => {
    const user = requireSuperAdmin();
    const newMsg = {
      id: crypto.randomUUID(),
      pharmacyId,
      senderId: user.id,
      senderName: user.name || 'Platform Support',
      senderRole: 'superadmin',
      message: message.trim(),
      inquiryType: inquiryType || 'general',
      requestedPlan: null,
      isReadBySuperadmin: true,
      isReadByPharmacy: false,
      createdAt: new Date().toISOString()
    };

    saveLocalInquiry(newMsg);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        await adminClient.from('subscription_inquiries').insert([{
          id: newMsg.id,
          pharmacy_id: newMsg.pharmacyId,
          sender_id: newMsg.senderId,
          sender_name: newMsg.senderName,
          sender_role: newMsg.senderRole,
          message: newMsg.message,
          inquiry_type: newMsg.inquiryType,
          is_read_by_superadmin: true,
          is_read_by_pharmacy: false,
          created_at: newMsg.createdAt
        }]);
      }
    } catch (err) {
      console.warn('[SaaS API] Supabase reply fallback to local store:', err.message);
    }

    return newMsg;
  });

  // SuperAdmin: Mark inquiries from a pharmacy as read
  ipcMain.handle('saas:mark-inquiries-read', async (_event, pharmacyId) => {
    requireSuperAdmin();
    const localList = getLocalInquiries();
    localList.forEach(m => {
      if (m.pharmacyId === pharmacyId) m.isReadBySuperadmin = true;
    });
    setCacheData('subscription_inquiries', localList);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        await adminClient
          .from('subscription_inquiries')
          .update({ is_read_by_superadmin: true })
          .eq('pharmacy_id', pharmacyId);
      }
    } catch (_) {}

    return { success: true };
  });

  // Pharmacy: Get conversation history with SuperAdmin
  ipcMain.handle('pharmacy:get-inquiries', async () => {
    const user = requireAuth();
    if (!user.pharmacyId) return [];

    let remoteList = [];
    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      if (dbClient) {
        const { data, error } = await dbClient
          .from('subscription_inquiries')
          .select('*')
          .eq('pharmacy_id', user.pharmacyId)
          .order('created_at', { ascending: true });
        if (!error && data) {
          remoteList = data.map(r => toCamelCase(r));
        }
      }
    } catch (_) {}

    const localList = getLocalInquiries().filter(m => m.pharmacyId === user.pharmacyId);
    const map = new Map();
    [...remoteList, ...localList].forEach(item => {
      map.set(item.id, item);
    });

    const merged = Array.from(map.values()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return merged;
  });

  // Pharmacy: Send inquiry or upgrade message to SuperAdmin (Free for all users)
  ipcMain.handle('pharmacy:send-inquiry', async (_event, { message, inquiryType = 'general', requestedPlan = null }) => {
    const user = requireAuth();
    if (!user.pharmacyId) throw new Error('No pharmacy associated with user.');

    const newMsg = {
      id: crypto.randomUUID(),
      pharmacyId: user.pharmacyId,
      senderId: user.id,
      senderName: user.name || user.username,
      senderRole: user.role,
      message: message.trim(),
      inquiryType: inquiryType || 'general',
      requestedPlan: requestedPlan || null,
      isReadBySuperadmin: false,
      isReadByPharmacy: true,
      createdAt: new Date().toISOString()
    };

    // Save in local persistent cache immediately
    saveLocalInquiry(newMsg);

    // Also attempt saving to remote Supabase if available
    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      if (dbClient) {
        await dbClient.from('subscription_inquiries').insert([{
          id: newMsg.id,
          pharmacy_id: newMsg.pharmacyId,
          sender_id: newMsg.senderId,
          sender_name: newMsg.senderName,
          sender_role: newMsg.senderRole,
          message: newMsg.message,
          inquiry_type: newMsg.inquiryType,
          requested_plan: newMsg.requestedPlan,
          is_read_by_superadmin: false,
          is_read_by_pharmacy: true,
          created_at: newMsg.createdAt
        }]);
      }
    } catch (err) {
      console.warn('[Pharmacy API] Supabase inquiry stored locally:', err.message);
    }

    return newMsg;
  });

  // Pharmacy: Mark inquiries as read
  ipcMain.handle('pharmacy:mark-inquiries-read', async () => {
    const user = requireAuth();
    if (!user.pharmacyId) return { success: true };

    const localList = getLocalInquiries();
    localList.forEach(m => {
      if (m.pharmacyId === user.pharmacyId) m.isReadByPharmacy = true;
    });
    setCacheData('subscription_inquiries', localList);

    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      if (dbClient) {
        await dbClient
          .from('subscription_inquiries')
          .update({ is_read_by_pharmacy: true })
          .eq('pharmacy_id', user.pharmacyId);
      }
    } catch (_) {}

    return { success: true };
  });

  // ============================================================================
  // --- SAAS SUBSCRIPTION PLANS (DYNAMIC & DUMMY PLANS CRUD) ---
  // ============================================================================

  // Get all subscription plans
  ipcMain.handle('saas:get-plans', async () => {
    const user = getCurrentUser();
    const isSuperAdmin = user?.role === 'superadmin';

    let remotePlans = [];
    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      if (dbClient) {
        let query = dbClient.from('subscription_plans').select('*');
        if (!isSuperAdmin) {
          query = query.eq('is_active', true);
        }
        query = query.order('sort_order', { ascending: true }).order('price_monthly', { ascending: true });

        const { data, error } = await query;
        if (!error && data && data.length > 0) {
          remotePlans = data.map(r => toCamelCase(r));
        }
      }
    } catch (_) {}

    const localPlans = getLocalPlans();
    const map = new Map();
    [...DEFAULT_PLANS, ...localPlans, ...remotePlans].forEach(p => {
      map.set(p.slug, p);
    });

    let allPlans = Array.from(map.values());
    if (!isSuperAdmin) {
      allPlans = allPlans.filter(p => p.isActive !== false);
    }
    allPlans.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || (a.priceMonthly || 0) - (b.priceMonthly || 0));
    return allPlans;
  });

  // Create new subscription plan
  ipcMain.handle('saas:create-plan', async (_event, planData) => {
    requireSuperAdmin();
    const slug = (planData.slug || planData.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
    const newPlan = {
      id: crypto.randomUUID(),
      name: planData.name.trim(),
      slug,
      description: planData.description?.trim() || null,
      priceMonthly: parseFloat(planData.priceMonthly) || 0,
      priceAnnual: parseFloat(planData.priceAnnual) || 0,
      currency: planData.currency || 'PKR',
      maxBranches: parseInt(planData.maxBranches, 10) || 1,
      maxUsers: parseInt(planData.maxUsers, 10) || 3,
      features: Array.isArray(planData.features) ? planData.features : (planData.features || '').split('\n').filter(Boolean),
      badge: planData.badge?.trim() || null,
      isPublic: planData.isPublic !== false,
      isActive: planData.isActive !== false,
      sortOrder: parseInt(planData.sortOrder, 10) || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    saveLocalPlan(newPlan);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        await adminClient.from('subscription_plans').insert([{
          id: newPlan.id,
          name: newPlan.name,
          slug: newPlan.slug,
          description: newPlan.description,
          price_monthly: newPlan.priceMonthly,
          price_annual: newPlan.priceAnnual,
          currency: newPlan.currency,
          max_branches: newPlan.maxBranches,
          max_users: newPlan.maxUsers,
          features: newPlan.features,
          badge: newPlan.badge,
          is_public: newPlan.isPublic,
          is_active: newPlan.isActive,
          sort_order: newPlan.sortOrder,
          updated_at: newPlan.updatedAt
        }]);
      }
    } catch (err) {
      console.warn('[SaaS API] Plan created in local store:', err.message);
    }

    return { success: true, plan: newPlan };
  });

  // Update existing subscription plan
  ipcMain.handle('saas:update-plan', async (_event, { id, updates }) => {
    requireSuperAdmin();
    const localList = getLocalPlans();
    let plan = localList.find(p => p.id === id || p.slug === id);
    if (!plan) {
      plan = DEFAULT_PLANS.find(p => p.id === id || p.slug === id) || { id, slug: id };
    }

    const updatedPlan = {
      ...plan,
      ...updates,
      priceMonthly: updates.priceMonthly !== undefined ? parseFloat(updates.priceMonthly) : plan.priceMonthly,
      priceAnnual: updates.priceAnnual !== undefined ? parseFloat(updates.priceAnnual) : plan.priceAnnual,
      maxBranches: updates.maxBranches !== undefined ? parseInt(updates.maxBranches, 10) : plan.maxBranches,
      maxUsers: updates.maxUsers !== undefined ? parseInt(updates.maxUsers, 10) : plan.maxUsers,
      sortOrder: updates.sortOrder !== undefined ? parseInt(updates.sortOrder, 10) : plan.sortOrder,
      features: updates.features !== undefined ? (Array.isArray(updates.features) ? updates.features : updates.features.split('\n').filter(Boolean)) : plan.features,
      updatedAt: new Date().toISOString()
    };

    saveLocalPlan(updatedPlan);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        const payload = {};
        if (updates.name !== undefined) payload.name = updates.name.trim();
        if (updates.slug !== undefined) payload.slug = updates.slug.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (updates.description !== undefined) payload.description = updates.description.trim();
        if (updates.priceMonthly !== undefined) payload.price_monthly = parseFloat(updates.priceMonthly);
        if (updates.priceAnnual !== undefined) payload.price_annual = parseFloat(updates.priceAnnual);
        if (updates.currency !== undefined) payload.currency = updates.currency;
        if (updates.maxBranches !== undefined) payload.max_branches = parseInt(updates.maxBranches, 10);
        if (updates.maxUsers !== undefined) payload.max_users = parseInt(updates.maxUsers, 10);
        if (updates.features !== undefined) payload.features = updatedPlan.features;
        if (updates.badge !== undefined) payload.badge = updates.badge.trim();
        if (updates.isPublic !== undefined) payload.is_public = updates.isPublic;
        if (updates.isActive !== undefined) payload.is_active = updates.isActive;
        if (updates.sortOrder !== undefined) payload.sort_order = parseInt(updates.sortOrder, 10);
        payload.updated_at = new Date().toISOString();

        await adminClient
          .from('subscription_plans')
          .update(payload)
          .eq('id', id);
      }
    } catch (err) {
      console.warn('[SaaS API] Plan updated in local store:', err.message);
    }

    return { success: true, plan: updatedPlan };
  });

  // Delete subscription plan
  ipcMain.handle('saas:delete-plan', async (_event, id) => {
    requireSuperAdmin();
    deleteLocalPlan(id);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        await adminClient
          .from('subscription_plans')
          .delete()
          .eq('id', id);
      }
    } catch (_) {}

    return { success: true };
  });

  // ============================================================================
  // --- CORE PLATFORM SETTINGS (GLOBAL CONFIGURATION) ---
  // ============================================================================

  const DEFAULT_SETTINGS = {
    platform_identity: {
      platformName: 'PharmaCore Cloud ERP',
      tagline: 'Modern Pharmacy SaaS & POS Suite',
      supportEmail: 'support@pharmacore.pk',
      supportPhone: '+92 300 1234567',
      companyName: 'PharmaCore Technologies Pvt Ltd',
      version: '2.4.0',
      logoUrl: null
    },
    trial_policy: {
      defaultDurationDays: 14,
      defaultMaxBranches: 1,
      defaultMaxUsers: 3,
      allowPublicRegistration: true,
      autoLockExpired: true
    },
    billing_instructions: {
      bankName: 'Meezan Bank Ltd',
      accountTitle: 'PharmaCore Technologies',
      accountNumber: '02010108765432',
      iban: 'PK36MEZN0002010108765432',
      jazzcashNumber: '03001234567',
      easypaisaNumber: '03001234567',
      paymentInstructions: 'Please send screenshot of transfer on WhatsApp to +92 300 1234567 with your Pharmacy Name for instant activation.'
    },
    broadcast_announcement: {
      enabled: false,
      type: 'info',
      message: '',
      dismissible: true
    },
    security_policy: {
      minPasswordLength: 8,
      sessionTimeoutMinutes: 480,
      enforceStrongPassword: true,
      maxFailedLoginAttempts: 5
    }
  };

  function getLocalPlatformSettings() {
    const cached = getCacheData('platform_settings');
    if (cached && cached.data) {
      return { ...DEFAULT_SETTINGS, ...cached.data };
    }
    setCacheData('platform_settings', DEFAULT_SETTINGS);
    return DEFAULT_SETTINGS;
  }

  // SuperAdmin: Get all platform settings
  ipcMain.handle('saas:get-platform-settings', async () => {
    requireSuperAdmin();
    let remoteSettings = {};
    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        const { data, error } = await adminClient
          .from('platform_settings')
          .select('*');
        if (!error && data) {
          data.forEach(row => {
            remoteSettings[row.key] = row.value;
          });
        }
      }
    } catch (_) {}

    const localSettings = getLocalPlatformSettings();
    return { ...localSettings, ...remoteSettings };
  });

  // SuperAdmin: Update platform setting key
  ipcMain.handle('saas:update-platform-settings', async (_event, { key, value, category = 'general' }) => {
    requireSuperAdmin();
    const current = getLocalPlatformSettings();
    current[key] = value;
    setCacheData('platform_settings', current);

    try {
      const adminClient = getAdminClient();
      if (adminClient) {
        await adminClient
          .from('platform_settings')
          .upsert({
            key,
            value,
            category,
            updated_at: new Date().toISOString()
          });
      }
    } catch (err) {
      console.warn('[SaaS API] Setting updated in local store:', err.message);
    }

    return { success: true, setting: { key, value } };
  });

  // Public: Get platform public config (Branding, Support, Active Announcement, etc.)
  ipcMain.handle('platform:get-public-config', async () => {
    let remoteSettings = {};
    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      if (dbClient) {
        const { data, error } = await dbClient.from('platform_settings').select('*');
        if (!error && data) {
          data.forEach(row => {
            remoteSettings[row.key] = row.value;
          });
        }
      }
    } catch (_) {}

    const localSettings = getLocalPlatformSettings();
    const merged = { ...localSettings, ...remoteSettings };

    return {
      identity: merged.platform_identity || DEFAULT_SETTINGS.platform_identity,
      billing: merged.billing_instructions || DEFAULT_SETTINGS.billing_instructions,
      broadcast: merged.broadcast_announcement || DEFAULT_SETTINGS.broadcast_announcement
    };
  });

  // ============================================================================
  // --- DATABASE & API ENVIRONMENT SETTINGS ---
  // ============================================================================

  // SuperAdmin: Get active database & API environment keys
  ipcMain.handle('saas:get-db-config', async () => {
    requireSuperAdmin();
    return loadDatabaseConfig();
  });

  // SuperAdmin: Save active database & API environment keys
  ipcMain.handle('saas:save-db-config', async (_event, config) => {
    requireSuperAdmin();
    try {
      const res = await saveDatabaseConfig(config);
      return res;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // SuperAdmin: Test database connectivity with specified URL/Keys
  ipcMain.handle('saas:test-db-connection', async (_event, config) => {
    requireSuperAdmin();
    return testDatabaseConnection(config);
  });

  // Pharmacy: Update branding & store profile (Name, Logo URL/Data, City, Address, Phone, Tax Number)
  ipcMain.handle('pharmacy:update-branding', async (_event, brandingData) => {
    const user = requireAuth();
    const pharmacyId = user.pharmacyId || '11111111-1111-1111-1111-111111111111';

    const payload = {};
    if (brandingData.name !== undefined) payload.name = brandingData.name.trim();
    if (brandingData.logoUrl !== undefined) payload.logo_url = brandingData.logoUrl;
    if (brandingData.city !== undefined) payload.city = brandingData.city.trim();
    if (brandingData.address !== undefined) payload.address = brandingData.address.trim();
    if (brandingData.contactPhone !== undefined) payload.contact_phone = brandingData.contactPhone.trim();
    if (brandingData.contactEmail !== undefined) payload.contact_email = brandingData.contactEmail.trim();
    if (brandingData.taxNumber !== undefined) payload.tax_number = brandingData.taxNumber.trim();
    payload.updated_at = new Date().toISOString();

    // Cache locally immediately
    setCacheData(`pharmacy_branding_${pharmacyId}`, { ...brandingData, updatedAt: payload.updated_at });
    updateCurrentUserPharmacyBranding({ 
      name: payload.name || brandingData.name, 
      logoUrl: payload.logo_url !== undefined ? payload.logo_url : brandingData.logoUrl 
    });

    try {
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();

      if (dbClient) {
        const { data, error } = await dbClient
          .from('pharmacies')
          .update(payload)
          .eq('id', pharmacyId)
          .select()
          .single();

        if (!error && data) {
          return { success: true, pharmacy: toCamelCase(data) };
        }
      }
    } catch (error) {
      console.warn('[Pharmacy API] Supabase update-branding fallback to local cache:', error.message);
    }

    return { 
      success: true, 
      pharmacy: {
        id: pharmacyId,
        name: payload.name || brandingData.name,
        logoUrl: payload.logo_url !== undefined ? payload.logo_url : brandingData.logoUrl,
        city: payload.city || brandingData.city,
        address: payload.address || brandingData.address,
        contactPhone: payload.contact_phone || brandingData.contactPhone,
        contactEmail: payload.contact_email || brandingData.contactEmail,
        taxNumber: payload.tax_number || brandingData.taxNumber
      }
    };
  });



  // ============================================================================
  // --- MEDICINES ---
  // ============================================================================
  ipcMain.handle('api:get-medicines', async (event, { includeArchived = false } = {}) => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('medicines').select('*, batches(*)');
      
      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }
      
      if (!includeArchived) {
        query = query.eq('is_active', true);
      }
      
      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting medicines:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:add-medicine', async (event, medicine) => {
    const user = requireAdmin();
    if (!medicine.branchId) medicine.branchId = user.branchId;
    if (!medicine.pharmacyId && user.pharmacyId) medicine.pharmacyId = user.pharmacyId;
    return await addRecord('medicines', medicine);
  });

  ipcMain.handle('api:update-medicine', async (event, { id, updates }) => {
    requireAdmin();
    return await updateRecord('medicines', id, updates);
  });

  ipcMain.handle('api:delete-medicine', async (event, id) => {
    requireAdmin();
    return await updateRecord('medicines', id, { isActive: false });
  });

  // ============================================================================
  // --- BATCHES ---
  // ============================================================================
  ipcMain.handle('api:add-batch', async (event, batch) => {
    const user = requireAdmin();
    if (!batch.branchId) batch.branchId = user.branchId;
    if (!batch.pharmacyId && user.pharmacyId) batch.pharmacyId = user.pharmacyId;
    batch.originalQuantity = batch.quantityInStock;
    const result = await addRecord('batches', batch);
    
    if (batch.quantity < 10) {
      new Notification({
        title: 'Low Stock Alert',
        body: `Low stock added for batch ${batch.batchNumber}`
      }).show();
    }
    
    return result;
  });

  ipcMain.handle('api:update-batch', async (event, { id, updates }) => {
    requireAdmin();
    return await updateRecord('batches', id, updates);
  });

  ipcMain.handle('api:delete-batch', async (event, id) => {
    requireAdmin();
    return await deleteRecord('batches', id);
  });

  ipcMain.handle('api:get-expired-batches', async () => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('batches')
        .select('*, medicine:medicines(name)')
        .eq('is_expired', true);

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting expired batches:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- ONBOARDING & FIRST RUN ---
  // ============================================================================
  ipcMain.handle('api:get-is-first-run', async () => {
    try {
      const adminClient = getAdminClient();
      if (!adminClient) return false;
      const { count, error } = await adminClient.from('pharmacies').select('id', { count: 'exact', head: true });
      if (error) {
        console.error('[API] Error checking first run:', error.message);
        return false;
      }
      return count === 0;
    } catch (err) {
      console.error('[API] getIsFirstRun error:', err.message);
      return false;
    }
  });

  // ============================================================================
  // --- BRANCHES ---
  // ============================================================================
  ipcMain.handle('api:get-branches', async () => {
    try {
      const user = getCurrentUser();
      const adminClient = getAdminClient();
      const dbClient = adminClient || getSupabaseClient();
      
      let query = dbClient.from('branches').select('*');
      if (user && user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }
      
      const { data, error } = await query;
      if (error) {
        console.error('[API] Error fetching branches:', error.message);
        return [];
      }
      return toCamelCase(data);
    } catch (err) {
      console.error('[API] getBranches error:', err.message);
      return [];
    }
  });

  ipcMain.handle('api:add-branch', async (event, branch) => {
    const user = requireAdmin();
    if (!user.canViewAllBranches && user.role !== 'superadmin') {
      throw new Error('Unauthorised: Only owners can create branches.');
    }

    // Check branch quota against pharmacy plan
    if (user.role !== 'superadmin' && user.pharmacyId) {
      const adminClient = getAdminClient();
      const { data: pharm } = await adminClient
        .from('pharmacies')
        .select('max_branches')
        .eq('id', user.pharmacyId)
        .single();

      const { count } = await adminClient
        .from('branches')
        .select('id', { count: 'exact', head: true })
        .eq('pharmacy_id', user.pharmacyId);

      const maxAllowed = pharm?.max_branches || 1;
      if (count >= maxAllowed) {
        throw new Error(`Branch limit reached (${count}/${maxAllowed}). Please upgrade your SaaS plan to add more branch locations.`);
      }
    }

    try {
      const branchPayload = {
        ...branch,
        pharmacy_id: user.pharmacyId || branch.pharmacyId
      };
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.from('branches').insert([toSnakeCase('branches', branchPayload)]).select();
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data[0]);
    } catch (error) {
      console.error('[api] Error adding branch:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- SUPPLIERS ---
  // ============================================================================
  ipcMain.handle('api:get-suppliers', async () => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('suppliers').select('*');
      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting suppliers:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:add-supplier', async (event, supplier) => {
    const user = requireAdmin();
    if (!supplier.branchId) supplier.branchId = user.branchId;
    if (!supplier.pharmacyId && user.pharmacyId) supplier.pharmacyId = user.pharmacyId;
    return await addRecord('suppliers', supplier);
  });

  ipcMain.handle('api:update-supplier', async (event, { id, updates }) => {
    requireAdmin();
    return await updateRecord('suppliers', id, updates);
  });

  ipcMain.handle('api:delete-supplier', async (event, id) => {
    requireAdmin();
    return await deleteRecord('suppliers', id);
  });

  // ============================================================================
  // --- CATEGORIES ---
  // ============================================================================
  ipcMain.handle('api:get-categories', async () => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('categories').select('*');
      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting categories:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:add-category', async (event, category) => {
    const user = requireAdmin();
    if (!category.branchId) category.branchId = user.branchId;
    if (!category.pharmacyId && user.pharmacyId) category.pharmacyId = user.pharmacyId;
    return await addRecord('categories', category);
  });

  ipcMain.handle('api:update-category', async (event, { id, updates }) => {
    requireAdmin();
    return await updateRecord('categories', id, updates);
  });

  ipcMain.handle('api:delete-category', async (event, id) => {
    requireAdmin();
    return await deleteRecord('categories', id);
  });

  // ============================================================================
  // --- USERS & AUTH ---
  // ============================================================================
  ipcMain.handle('api:get-users', async () => {
    const user = requireAdmin();
    try {
      const supabase = getSupabaseClient();
      let query = supabase.from('app_users').select('*');
      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting users:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:get-login-activity', async () => {
    const user = requireAdmin();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('activity_logs')
        .select('*, app_users(role)')
        .order('created_at', { ascending: false });

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting login activity:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:reset-user-password', async (event, { userId, newPassword }) => {
    requireAdmin();
    return await resetUserPassword(userId, newPassword);
  });

  // ============================================================================
  // --- PATIENTS / CUSTOMERS & PRESCRIPTIONS ---
  // ============================================================================
  ipcMain.handle('api:get-customers', async (_event, search = '') => {
    const user = requireAuth();
    const supabase = getSupabaseClient();
    let query = supabase.from('customers').select('*').order('full_name').limit(50);
    
    if (user.role !== 'superadmin' && user.pharmacyId) {
      query = query.eq('pharmacy_id', user.pharmacyId);
    }
    
    if (search?.trim()) {
      query = query.or(`full_name.ilike.%${search.trim()}%,phone.ilike.%${search.trim()}%`);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return toCamelCase(data);
  });

  ipcMain.handle('api:add-customer', async (_event, customer) => {
    const user = requireAuth();
    if (!customer.fullName?.trim()) throw new Error('Customer name is required.');
    const { data, error } = await getSupabaseClient().from('customers').insert([{
      pharmacy_id: user.pharmacyId || customer.pharmacyId,
      full_name: customer.fullName.trim(),
      phone: customer.phone || null,
      cnic: customer.cnic || null,
      address: customer.address || null,
      branch_id: customer.branchId || user.branchId
    }]).select().single();
    if (error) throw new Error(error.message);
    return toCamelCase(data);
  });

  ipcMain.handle('api:update-customer', async (_event, { id, updates }) => {
    requireAuth();
    if (!id) throw new Error('Customer ID is required.');
    const payload = {};
    if (updates.fullName !== undefined) payload.full_name = updates.fullName.trim();
    if (updates.phone !== undefined) payload.phone = updates.phone || null;
    if (updates.cnic !== undefined) payload.cnic = updates.cnic || null;
    if (updates.address !== undefined) payload.address = updates.address || null;
    payload.updated_at = new Date().toISOString();

    const { data, error } = await getSupabaseClient().from('customers')
      .update(payload)
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return toCamelCase(data);
  });

  ipcMain.handle('api:delete-customer', async (_event, id) => {
    requireAuth();
    if (!id) throw new Error('Customer ID is required.');
    const { error } = await getSupabaseClient().from('customers').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return { success: true };
  });

  ipcMain.handle('api:get-prescriptions', async (_event, customerId) => {
    const user = requireAuth();
    if (!customerId) return [];
    let query = getSupabaseClient().from('prescriptions').select('*').eq('customer_id', customerId);
    if (user.role !== 'superadmin' && user.pharmacyId) {
      query = query.eq('pharmacy_id', user.pharmacyId);
    }
    const { data, error } = await query.order('prescription_date', { ascending: false });
    if (error) throw new Error(error.message);
    return toCamelCase(data);
  });

  ipcMain.handle('api:add-prescription', async (_event, prescription) => {
    const user = requireAuth();
    if (!prescription.customerId || !prescription.prescriberName || !prescription.prescriptionDate) {
      throw new Error('Customer, prescriber name, and prescription date are required.');
    }
    const { data, error } = await getSupabaseClient().from('prescriptions').insert([{
      pharmacy_id: user.pharmacyId || prescription.pharmacyId,
      customer_id: prescription.customerId,
      prescriber_name: prescription.prescriberName.trim(),
      prescriber_registration_no: prescription.prescriberRegistrationNo || null,
      prescription_date: prescription.prescriptionDate,
      attachment_reference: prescription.attachmentReference || null,
      branch_id: prescription.branchId || user.branchId,
      status: 'verified',
      verified_by_user_id: user.id,
      verified_at: new Date().toISOString()
    }]).select().single();
    if (error) throw new Error(error.message);
    return toCamelCase(data);
  });

  // ============================================================================
  // --- SALES & POS ---
  // ============================================================================
  ipcMain.handle('api:process-sale', async (event, saleData) => {
    try {
      requireAuth();
      return await processSaleAtomic(saleData);
    } catch (error) {
      console.error('[api:process-sale ERROR]', error);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:get-sales', async () => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('sales')
        .select('*, sale_items(*), customer:customers(full_name, phone, cnic)')
        .order('created_at', { ascending: false });

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      const formatted = (data || []).map(row => {
        const mapped = toCamelCase(row);
        if (row.customer) {
          mapped.customerName = row.customer.full_name;
          mapped.customerPhone = row.customer.phone;
          mapped.customerCnic = row.customer.cnic;
        }
        return mapped;
      });
      return formatted;
    } catch (error) {
      console.error('[api] Error getting sales:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:delete-sale', async (event, id) => {
    requireAdmin();
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('delete_sale_restore_stock', { p_sale_id: id });
      if (error) throw new Error(error.message || JSON.stringify(error));
      return data;
    } catch (error) {
      console.error('[api] Error deleting sale:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- RETURNS & REFUNDS ---
  // ============================================================================
  ipcMain.handle('api:process-return', async (event, returnData) => {
    requireAuth();
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('process_return', {
        p_return_id: returnData.returnId,
        p_sale_id: returnData.saleId,
        p_items: returnData.items,
        p_refund_method: returnData.refundMethod
      });
      if (error) throw new Error(error.message || JSON.stringify(error));
      return { success: true, returnId: data };
    } catch (error) {
      console.error('[api] Error processing return:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:approve-return', async (event, returnId) => {
    requireAdmin();
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('approve_return', { p_return_id: returnId });
      if (error) throw new Error(error.message || JSON.stringify(error));
      return { success: true, data };
    } catch (error) {
      console.error('[api] Error approving return:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:get-returns', async () => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('returns')
        .select('*, return_items(*), sales(date_time)')
        .order('created_at', { ascending: false });

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting returns:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:get-quarantine', async () => {
    const user = requireAdmin();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('return_items')
        .select('*, returns(return_date, processed_by_user_id), medicines(name)')
        .eq('quarantined', true)
        .order('id', { ascending: false });

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting quarantine items:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  // ============================================================================
  // --- SETTINGS ---
  // ============================================================================
  ipcMain.handle('api:getDefaultTaxRate', async () => {
    requireAuth();
    return await getSetting('default_tax_rate') || 0;
  });

  ipcMain.handle('api:setDefaultTaxRate', async (event, rate) => {
    requireAdmin();
    return await setSetting('default_tax_rate', rate);
  });

  ipcMain.handle('api:getExpiryThreshold', async () => {
    requireAuth();
    return await getSetting('expiry_threshold_days') || 30;
  });

  ipcMain.handle('api:setExpiryThreshold', async (event, days) => {
    requireAdmin();
    return await setSetting('expiry_threshold_days', days);
  });

  // ============================================================================
  // --- STATUS & DASHBOARDS ---
  // ============================================================================
  ipcMain.handle('api:get-connection-status', async () => {
    return getConnectionStatus();
  });

  ipcMain.handle('api:get-supplier-dashboard', async () => {
    requireAuth();
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase.rpc('get_supplier_dashboard_stats');
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting supplier dashboard:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('api:get-supplier-details', async (event, supplierId) => {
    const user = requireAuth();
    try {
      const supabase = getSupabaseClient();
      let query = supabase
        .from('batches')
        .select('*, medicine:medicines(*)')
        .eq('supplier_id', supplierId);

      if (user.role !== 'superadmin' && user.pharmacyId) {
        query = query.eq('pharmacy_id', user.pharmacyId);
      }

      const { data, error } = await query;
      if (error) throw new Error(error.message || JSON.stringify(error));
      return toCamelCase(data);
    } catch (error) {
      console.error('[api] Error getting supplier details:', error.message);
      throw new Error(error.message || JSON.stringify(error));
    }
  });

  ipcMain.handle('app:print', async (event, options = {}) => {
    try {
      const { BrowserWindow } = await import('electron');
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win) return { success: false, error: 'No active window found for printing.' };

      return new Promise((resolve) => {
        win.webContents.print({
          silent: false,
          printBackground: true,
          margins: { marginType: 'none' },
          ...options
        }, (success, failureReason) => {
          if (!success && failureReason !== 'cancelled') {
            console.warn('[Print] Print cancelled or failed:', failureReason);
            resolve({ success: false, error: failureReason });
          } else {
            resolve({ success: true });
          }
        });
      });
    } catch (err) {
      console.error('[Print] app:print error:', err.message);
      return { success: false, error: err.message };
    }
  });

  // Start periodic expiry check
  console.log('[api] Starting hourly expiry check schedule');
  setInterval(() => {
    runExpiryCheck().catch(err => console.error('[api] Expiry check failed:', err.message));
  }, 60 * 60 * 1000);
}
