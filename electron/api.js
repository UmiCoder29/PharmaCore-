import crypto from 'crypto';
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
  getConnectionStatus
} from './supabaseClient.js';
import { getCacheData, setCacheData } from './localCache.js';
import { getCurrentUser, updateCurrentUserPharmacyBranding, registerPharmacy } from './auth.js';

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
export function requireSuperAdmin() {
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
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { data: pharmacies, error: pharmErr } = await supabase
        .from('pharmacies')
        .select('*')
        .order('created_at', { ascending: false });

      if (pharmErr) return { success: false, error: pharmErr.message };

      // Enrich with branch, user, and sales counts using count queries (no row fetching)
      const enriched = await Promise.all(
        (pharmacies || []).map(async (pharm) => {
          const [branchesRes, usersRes, salesRes] = await Promise.all([
            supabase.from('branches').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharm.id),
            supabase.from('app_users').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharm.id),
            supabase.from('sales').select('id', { count: 'exact', head: true }).eq('pharmacy_id', pharm.id)
          ]);

          return {
            ...toCamelCase(pharm),
            branchCount: branchesRes.count || 0,
            userCount: usersRes.count || 0,
            salesCount: salesRes.count || 0,
            totalSalesVolume: 0 // Do not total from fetched rows (PostgREST limit)
          };
        })
      );

      return { success: true, data: enriched };
    } catch (error) {
      console.error('[SaaS API] Error getting pharmacies:', error);
      return { success: false, error: error.message || 'Failed to get pharmacies.' };
    }
  });

  // Provision new pharmacy tenant manually
  ipcMain.handle('saas:create-pharmacy', async (_event, pharmacyData) => {
    try {
      requireSuperAdmin();
      return await registerPharmacy(pharmacyData);
    } catch (error) {
      console.error('[SaaS API] Error creating pharmacy:', error);
      return { success: false, error: error.message || 'Failed to create pharmacy tenant.' };
    }
  });

  // Update a pharmacy's subscription, plan, validity or quotas
  ipcMain.handle('saas:update-pharmacy-subscription', async (_event, { pharmacyId, updates }) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client unavailable.' };

      const payload = {};
      if (updates.planTier !== undefined) payload.plan_tier = updates.planTier;
      if (updates.subscriptionStatus !== undefined) payload.subscription_status = updates.subscriptionStatus;
      if (updates.subscriptionEndsAt !== undefined) payload.subscription_ends_at = updates.subscriptionEndsAt;
      if (updates.maxBranches !== undefined) payload.max_branches = parseInt(updates.maxBranches, 10);
      if (updates.maxUsers !== undefined) payload.max_users = parseInt(updates.maxUsers, 10);
      if (updates.isActive !== undefined) payload.is_active = updates.isActive;
      payload.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('pharmacies')
        .update(payload)
        .eq('id', pharmacyId)
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, data: toCamelCase(data) };
    } catch (error) {
      console.error('[SaaS API] Error updating subscription:', error);
      return { success: false, error: error.message || 'Failed to update subscription.' };
    }
  });

  // Toggle active / suspend pharmacy tenant
  ipcMain.handle('saas:toggle-pharmacy-status', async (_event, { pharmacyId, status }) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client unavailable.' };

      const { data, error } = await supabase
        .from('pharmacies')
        .update({
          subscription_status: status,
          is_active: status === 'active' || status === 'trial',
          updated_at: new Date().toISOString()
        })
        .eq('id', pharmacyId)
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, data: toCamelCase(data) };
    } catch (error) {
      console.error('[SaaS API] Error toggling status:', error);
      return { success: false, error: error.message || 'Failed to toggle status.' };
    }
  });

  // Platform-wide metrics for SaaS Owner Dashboard
  ipcMain.handle('saas:get-platform-stats', async () => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client unavailable.' };

      // Fetch plan pricing dynamically from subscription_plans (no hardcoded prices)
      const { data: plans } = await supabase
        .from('subscription_plans')
        .select('slug, price_monthly');

      // Use count queries with head: true to avoid capping at PostgREST 1000 row limit
      const [
        totalPharmRes,
        activePharmRes,
        trialPharmRes,
        suspendedPharmRes,
        usersRes,
        branchRes,
        salesCountRes,
        tierCounts
      ] = await Promise.all([
        supabase.from('pharmacies').select('id', { count: 'exact', head: true }),
        supabase.from('pharmacies').select('id', { count: 'exact', head: true }).eq('subscription_status', 'active'),
        supabase.from('pharmacies').select('id', { count: 'exact', head: true }).eq('subscription_status', 'trial'),
        supabase.from('pharmacies').select('id', { count: 'exact', head: true }).in('subscription_status', ['suspended', 'past_due', 'cancelled']),
        supabase.from('app_users').select('id', { count: 'exact', head: true }),
        supabase.from('branches').select('id', { count: 'exact', head: true }),
        supabase.from('sales').select('id', { count: 'exact', head: true }),
        // MRR dynamically calculated per plan from subscription_plans table
        Promise.all(
          (plans || []).map(async (plan) => {
            const { count } = await supabase
              .from('pharmacies')
              .select('id', { count: 'exact', head: true })
              .eq('subscription_status', 'active')
              .eq('plan_tier', plan.slug);
            return (count || 0) * (Number(plan.price_monthly) || 0);
          })
        )
      ]);

      const mrr = (tierCounts || []).reduce((sum, val) => sum + val, 0);

      // Attempt to compute total sales revenue via server-side RPC get_platform_sales_revenue.
      // If the function does not exist in the database, return null (never return 0 for uncomputed data).
      let totalSalesRevenue = null;
      try {
        const { data: revData, error: revErr } = await supabase.rpc('get_platform_sales_revenue');
        if (!revErr && revData !== null && revData !== undefined) {
          totalSalesRevenue = Number(revData);
        }
      } catch {
        totalSalesRevenue = null;
      }

      return {
        success: true,
        data: {
          totalPharmacies: totalPharmRes.count || 0,
          activeSubscriptions: activePharmRes.count || 0,
          trialSubscriptions: trialPharmRes.count || 0,
          suspendedSubscriptions: suspendedPharmRes.count || 0,
          totalUsers: usersRes.count || 0,
          totalBranches: branchRes.count || 0,
          totalSalesCount: salesCountRes.count || 0,
          totalSalesRevenue, // null if function does not exist yet; UI displays "Not available yet"
          estimatedMRR: mrr,
          currency: 'PKR'
        }
      };
    } catch (error) {
      console.error('[SaaS API] Error calculating platform stats:', error);
      return { success: false, error: error.message || 'Failed to calculate platform stats.' };
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
      const dbClient = getSupabaseClient();

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
      const dbClient = getSupabaseClient();
      if (!dbClient) throw new Error('Database client unavailable.');
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
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { data, error } = await supabase
        .from('subscription_inquiries')
        .select('*, pharmacies(id, name, slug, contact_phone, contact_email, plan_tier, subscription_status)')
        .order('created_at', { ascending: true });

      if (error) return { success: false, error: error.message };

      const list = (data || []).map(row => ({
        ...toCamelCase(row),
        pharmacy: row.pharmacies ? toCamelCase(row.pharmacies) : null
      }));

      return { success: true, data: list };
    } catch (err) {
      console.error('[SaaS API] Error getting inquiries:', err);
      return { success: false, error: err.message || 'Failed to get inquiries.' };
    }
  });

  // SuperAdmin: Send reply message to a pharmacy
  ipcMain.handle('saas:send-reply', async (_event, { pharmacyId, message, inquiryType = 'general' }) => {
    try {
      const user = requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const newMsg = {
        id: crypto.randomUUID(),
        pharmacy_id: pharmacyId,
        sender_id: user.id,
        sender_name: user.name || 'Platform Support',
        sender_role: 'superadmin',
        message: message.trim(),
        inquiry_type: inquiryType || 'general',
        requested_plan: null,
        is_read_by_superadmin: true,
        is_read_by_pharmacy: false,
        created_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('subscription_inquiries')
        .insert([newMsg])
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, data: toCamelCase(data) };
    } catch (err) {
      console.error('[SaaS API] Error sending reply:', err);
      return { success: false, error: err.message || 'Failed to send reply.' };
    }
  });

  // SuperAdmin: Mark inquiries from a pharmacy as read
  ipcMain.handle('saas:mark-inquiries-read', async (_event, pharmacyId) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { error } = await supabase
        .from('subscription_inquiries')
        .update({ is_read_by_superadmin: true })
        .eq('pharmacy_id', pharmacyId);

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err) {
      console.error('[SaaS API] Error marking inquiries read:', err);
      return { success: false, error: err.message || 'Failed to mark inquiries read.' };
    }
  });

  // Pharmacy: Get conversation history with SuperAdmin
  ipcMain.handle('pharmacy:get-inquiries', async () => {
    const user = requireAuth();
    if (!user.pharmacyId) return [];

    try {
      const dbClient = getSupabaseClient();
      if (dbClient) {
        const { data, error } = await dbClient
          .from('subscription_inquiries')
          .select('*')
          .eq('pharmacy_id', user.pharmacyId)
          .order('created_at', { ascending: true });
        if (!error && data) {
          return data.map(r => toCamelCase(r));
        }
      }
    } catch (err) {
      console.warn('[Pharmacy API] Error getting inquiries:', err.message);
    }
    return [];
  });

  // Pharmacy: Send inquiry or upgrade message to SuperAdmin (Free for all users)
  ipcMain.handle('pharmacy:send-inquiry', async (_event, { message, inquiryType = 'general', requestedPlan = null }) => {
    const user = requireAuth();
    if (!user.pharmacyId) throw new Error('No pharmacy associated with user.');

    const newMsg = {
      id: crypto.randomUUID(),
      pharmacy_id: user.pharmacyId,
      sender_id: user.id,
      sender_name: user.name || user.username,
      sender_role: user.role,
      message: message.trim(),
      inquiry_type: inquiryType || 'general',
      requested_plan: requestedPlan || null,
      is_read_by_superadmin: false,
      is_read_by_pharmacy: true,
      created_at: new Date().toISOString()
    };

    const dbClient = getSupabaseClient();
    if (dbClient) {
      const { data, error } = await dbClient
        .from('subscription_inquiries')
        .insert([newMsg])
        .select()
        .single();
      if (!error && data) {
        return toCamelCase(data);
      }
      if (error) {
        throw new Error(error.message);
      }
    }

    return toCamelCase(newMsg);
  });

  // Pharmacy: Mark inquiries as read
  ipcMain.handle('pharmacy:mark-inquiries-read', async () => {
    const user = requireAuth();
    if (!user.pharmacyId) return { success: true };

    try {
      const dbClient = getSupabaseClient();
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
    try {
      const user = getCurrentUser();
      const isSuperAdmin = user?.role === 'superadmin';
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      let query = supabase.from('subscription_plans').select('*');
      if (!isSuperAdmin) {
        query = query.eq('is_active', true);
      }
      query = query.order('sort_order', { ascending: true }).order('price_monthly', { ascending: true });

      const { data, error } = await query;
      if (error) return { success: false, error: error.message };

      const plans = (data || []).map(r => toCamelCase(r));
      return { success: true, data: plans };
    } catch (err) {
      console.error('[SaaS API] Error getting plans:', err);
      return { success: false, error: err.message || 'Failed to get plans.' };
    }
  });

  // Create new subscription plan
  ipcMain.handle('saas:create-plan', async (_event, planData) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const slug = (planData.slug || planData.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const newPlan = {
        id: crypto.randomUUID(),
        name: planData.name.trim(),
        slug,
        description: planData.description?.trim() || null,
        price_monthly: parseFloat(planData.priceMonthly) || 0,
        price_annual: parseFloat(planData.priceAnnual) || 0,
        currency: planData.currency || 'PKR',
        max_branches: parseInt(planData.maxBranches, 10) || 1,
        max_users: parseInt(planData.maxUsers, 10) || 3,
        features: Array.isArray(planData.features) ? planData.features : (planData.features || '').split('\n').filter(Boolean),
        badge: planData.badge?.trim() || null,
        is_public: planData.isPublic !== false,
        is_active: planData.isActive !== false,
        sort_order: parseInt(planData.sortOrder, 10) || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase.from('subscription_plans').insert([newPlan]).select().single();
      if (error) return { success: false, error: error.message };
      return { success: true, plan: toCamelCase(data), data: toCamelCase(data) };
    } catch (err) {
      console.error('[SaaS API] Error creating plan:', err);
      return { success: false, error: err.message || 'Failed to create plan.' };
    }
  });

  // Update existing subscription plan
  ipcMain.handle('saas:update-plan', async (_event, { id, updates }) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const payload = {};
      if (updates.name !== undefined) payload.name = updates.name.trim();
      if (updates.slug !== undefined) payload.slug = updates.slug.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (updates.description !== undefined) payload.description = updates.description.trim();
      if (updates.priceMonthly !== undefined) payload.price_monthly = parseFloat(updates.priceMonthly);
      if (updates.priceAnnual !== undefined) payload.price_annual = parseFloat(updates.priceAnnual);
      if (updates.currency !== undefined) payload.currency = updates.currency;
      if (updates.maxBranches !== undefined) payload.max_branches = parseInt(updates.maxBranches, 10);
      if (updates.maxUsers !== undefined) payload.max_users = parseInt(updates.maxUsers, 10);
      if (updates.features !== undefined) {
        payload.features = Array.isArray(updates.features) ? updates.features : updates.features.split('\n').filter(Boolean);
      }
      if (updates.badge !== undefined) payload.badge = updates.badge.trim();
      if (updates.isPublic !== undefined) payload.is_public = updates.isPublic;
      if (updates.isActive !== undefined) payload.is_active = updates.isActive;
      if (updates.sortOrder !== undefined) payload.sort_order = parseInt(updates.sortOrder, 10);
      payload.updated_at = new Date().toISOString();

      const { data, error } = await supabase
        .from('subscription_plans')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, plan: toCamelCase(data), data: toCamelCase(data) };
    } catch (err) {
      console.error('[SaaS API] Error updating plan:', err);
      return { success: false, error: err.message || 'Failed to update plan.' };
    }
  });

  // Delete subscription plan
  ipcMain.handle('saas:delete-plan', async (_event, id) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { error } = await supabase
        .from('subscription_plans')
        .delete()
        .eq('id', id);

      if (error) return { success: false, error: error.message };
      return { success: true };
    } catch (err) {
      console.error('[SaaS API] Error deleting plan:', err);
      return { success: false, error: err.message || 'Failed to delete plan.' };
    }
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
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { data, error } = await supabase
        .from('platform_settings')
        .select('*');

      if (error) return { success: false, error: error.message };

      const remoteSettings = {};
      (data || []).forEach(row => {
        let val = row.value;
        if (typeof val === 'string') {
          try { val = JSON.parse(val); } catch (_) {}
        }
        remoteSettings[row.key] = val;
      });

      return { success: true, data: remoteSettings };
    } catch (err) {
      console.error('[SaaS API] Error fetching platform settings:', err);
      return { success: false, error: err.message || 'Failed to get platform settings.' };
    }
  });

  // SuperAdmin: Update platform setting key
  ipcMain.handle('saas:update-platform-settings', async (_event, { key, value, category = 'general' }) => {
    try {
      requireSuperAdmin();
      const supabase = getSupabaseClient();
      if (!supabase) return { success: false, error: 'Database client not initialized.' };

      const { data, error } = await supabase
        .from('platform_settings')
        .upsert({
          key,
          value,
          category,
          updated_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) return { success: false, error: error.message };
      return { success: true, setting: { key, value }, data: { key, value } };
    } catch (err) {
      console.error('[SaaS API] Error updating platform settings:', err);
      return { success: false, error: err.message || 'Failed to update platform settings.' };
    }
  });

  // Public: Get platform public config (Branding, Support, Active Announcement, etc.)
  // Runs BEFORE login using anon Supabase client. RLS returns ONLY the platform_identity row.
  ipcMain.handle('platform:get-public-config', async () => {
    let remoteSettings = {};
    try {
      const dbClient = getSupabaseClient();
      if (dbClient) {
        const { data, error } = await dbClient.from('platform_settings').select('key, value');
        if (!error && Array.isArray(data)) {
          data.forEach(row => {
            let val = row.value;
            if (typeof val === 'string') {
              try { val = JSON.parse(val); } catch (_) {}
            }
            remoteSettings[row.key] = val;
          });
        }
      }
    } catch (err) {
      console.warn('[Platform API] Error fetching public config:', err.message);
    }

    const localSettings = getLocalPlatformSettings();
    const merged = { ...localSettings, ...remoteSettings };

    return {
      identity: merged.platform_identity || DEFAULT_SETTINGS.platform_identity,
      billing: merged.billing_instructions || DEFAULT_SETTINGS.billing_instructions,
      broadcast: merged.broadcast_announcement || DEFAULT_SETTINGS.broadcast_announcement
    };
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
      const dbClient = getSupabaseClient();

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
    return false;
  });

  // ============================================================================
  // --- BRANCHES ---
  // ============================================================================
  ipcMain.handle('api:get-branches', async () => {
    try {
      const user = getCurrentUser();
      const dbClient = getSupabaseClient();
      if (!dbClient) return [];
      
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
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: pharm } = await supabase
          .from('pharmacies')
          .select('max_branches')
          .eq('id', user.pharmacyId)
          .maybeSingle();

        const { count } = await supabase
          .from('branches')
          .select('id', { count: 'exact', head: true })
          .eq('pharmacy_id', user.pharmacyId);

        const maxAllowed = pharm?.max_branches || 1;
        if (count >= maxAllowed) {
          throw new Error(`Branch limit reached (${count}/${maxAllowed}). Please upgrade your SaaS plan to add more branch locations.`);
        }
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
