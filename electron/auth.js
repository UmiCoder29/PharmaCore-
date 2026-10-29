/**
 * PharmaCore – Authentication Layer (Multi-Tenant SaaS)
 *
 * Authenticates users against Supabase Auth. Passwords are never stored
 * locally — all credential verification happens server-side.
 *
 * The service role key is held ONLY in this main-process module and is
 * NEVER exposed to the renderer process (preload.js, src/).
 *
 * IPC channels exposed:
 *   auth:login               → { success, username?, role?, pharmacy?, error? }
 *   auth:logout              → void
 *   auth:create-user         → { success, error? }  (admin only)
 *   auth:update-username     → { success, error? }  (admin only)
 *   auth:update-user-branch  → { success, error? }  (admin only)
 *   auth:reset-user-password → { success, error? }  (admin only)
 *   auth:register-pharmacy   → { success, pharmacyId?, username?, error? }
 */

import os from 'os';
import {
  getSupabaseClient,
  setSession,
  clearSession as clearSupabaseSession,
} from './supabaseClient.js';

// ─── Session state ────────────────────────────────────────────────────────────

let _currentUser = null; // { id, username, name, role, pharmacyId, pharmacyName, branchId, subscription, ... }

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current session user, or null if nobody is logged in.
 */
export function getCurrentUser() {
  return _currentUser;
}

/**
 * Updates the current session user's pharmacy name and logo.
 */
export function updateCurrentUserPharmacyBranding({ name, logoUrl }) {
  if (_currentUser) {
    if (name) _currentUser.pharmacyName = name;
    if (logoUrl !== undefined) _currentUser.pharmacyLogo = logoUrl;
  }
}

/**
 * Logs in an existing user via Supabase Auth.
 * Option A: Authenticates using the registered email address.
 * Never reveals whether an email exists; all failures show "Invalid email or password."
 */
export async function loginUser(emailInput, password) {
  try {
    if (!emailInput || !password) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Cloud service not initialised. Check your internet connection.' };
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });

    if (authError || !authData?.user) {
      console.log('[Auth] Login failed for provided credentials');
      await logActivity(null, trimmed, 'login_failed', null, null, { reason: 'Authentication failed' });
      return { success: false, error: 'Invalid email or password.' };
    }

    // Set the session so all subsequent Supabase calls use this user's JWT
    const session = authData.session;
    if (session) {
      await setSession(session.access_token, session.refresh_token);
    }

    // Fetch the app_users row using the authenticated client
    const { data: appUser, error: appUserErr } = await supabase
      .from('app_users')
      .select('*')
      .eq('id', authData.user.id)
      .maybeSingle();

    if (appUserErr || !appUser) {
      console.log('[Auth] app_users profile not found for authenticated user');
      await clearSupabaseSession();
      return { success: false, error: 'Invalid email or password.' };
    }

    let pharmacyData = null;
    if (appUser.pharmacy_id) {
      const { data: pharm } = await supabase
        .from('pharmacies')
        .select('*')
        .eq('id', appUser.pharmacy_id)
        .maybeSingle();
      pharmacyData = pharm || null;
    }

    _currentUser = {
      id: appUser.id,
      username: appUser.username,
      name: appUser.display_name || appUser.username,
      role: appUser.role, // 'superadmin' | 'admin' | 'pharmacist'
      pharmacyId: appUser.pharmacy_id || null,
      pharmacyName: pharmacyData?.name || 'PharmaCore Platform',
      pharmacyLogo: pharmacyData?.logo_url || null,
      branchId: appUser.branch_id,
      canViewAllBranches: appUser.can_view_all_branches || appUser.role === 'superadmin',
      mustChangePassword: !!(appUser.must_change_password || authData.user.user_metadata?.must_change_password),
      subscription: pharmacyData ? {
        planTier: pharmacyData.plan_tier,
        status: pharmacyData.subscription_status,
        trialEndsAt: pharmacyData.trial_ends_at,
        subscriptionEndsAt: pharmacyData.subscription_ends_at,
        maxBranches: pharmacyData.max_branches,
        maxUsers: pharmacyData.max_users,
        isActive: pharmacyData.is_active
      } : null
    };

    // Log successful login
    await logActivity(appUser.id, appUser.username, 'login_success', null, null, {
      device: os.hostname(),
      pharmacyId: appUser.pharmacy_id,
      role: appUser.role
    });

    console.log('[Auth] Login successful:', appUser.username, `(${appUser.role})`, 'Pharmacy:', _currentUser.pharmacyName);
    return {
      success: true,
      id: _currentUser.id,
      username: _currentUser.username,
      name: _currentUser.name,
      role: _currentUser.role,
      pharmacyId: _currentUser.pharmacyId,
      pharmacyName: _currentUser.pharmacyName,
      pharmacyLogo: _currentUser.pharmacyLogo,
      branchId: _currentUser.branchId,
      canViewAllBranches: _currentUser.canViewAllBranches,
      mustChangePassword: _currentUser.mustChangePassword,
      subscription: _currentUser.subscription
    };
  } catch (err) {
    console.error('[Auth] loginUser error:', err.message);
    return { success: false, error: 'Invalid email or password.' };
  }
}

/**
 * Logs the current user out.
 */
export async function logoutUser() {
  try {
    if (_currentUser) {
      await logActivity(_currentUser.id, _currentUser.username, 'logout', null, null, {
        device: os.hostname(),
      });
      console.log('[Auth] Logged out:', _currentUser.username);
    }
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.auth.signOut();
    }
  } catch (err) {
    console.error('[Auth] logoutUser error:', err.message);
  } finally {
    clearSupabaseSession();
    _currentUser = null;
  }
}

/**
 * Admin-only: Creates a new user account in Supabase Auth & app_users with subscription quota enforcement.
 */
export async function createUserAccount(username, name, password, role, branchId) {
  try {
    if (!_currentUser || !['admin', 'superadmin'].includes(_currentUser.role)) {
      return { success: false, error: 'Unauthorised. Only administrators can create accounts.' };
    }
    if (!username || username.trim().length < 3) {
      return { success: false, error: 'Username must be at least 3 characters.' };
    }
    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' };
    }
    if (!['superadmin', 'admin', 'pharmacist'].includes(role)) {
      return { success: false, error: 'Invalid role.' };
    }

    const trimmed = username.trim().toLowerCase();
    const actualName = (name && name.trim()) ? name.trim() : trimmed;
    return {
      success: false,
      error: 'User creation requires a server-side function, not available yet.'
    };

    // Check pharmacy user limits
    if (_currentUser.role !== 'superadmin' && _currentUser.pharmacyId) {
      const { data: pharm } = await adminClient
        .from('pharmacies')
        .select('max_users')
        .eq('id', _currentUser.pharmacyId)
        .single();
      
      const { count } = await adminClient
        .from('app_users')
        .select('id', { count: 'exact', head: true })
        .eq('pharmacy_id', _currentUser.pharmacyId);

      const maxUsers = pharm?.max_users || 3;
      if (count >= maxUsers) {
        return {
          success: false,
          error: `Staff account limit reached (${count}/${maxUsers}). Please upgrade your SaaS plan to add more staff.`
        };
      }
    }

    // Check for duplicate username in app_users
    const { data: existing } = await adminClient
      .from('app_users')
      .select('id')
      .ilike('username', trimmed)
      .limit(1);

    if (existing && existing.length > 0) {
      return { success: false, error: 'Username already exists.' };
    }

    // Step 1: Create Supabase Auth user
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      console.error('[Auth] Failed to create auth user:', authError.message);
      return { success: false, error: `Failed to create account: ${authError.message}` };
    }

    const userId = authData.user.id;
    let assignedBranchId = _currentUser.branchId || null;
    if (_currentUser.canViewAllBranches && branchId) {
      assignedBranchId = branchId;
    }

    // Step 2: Insert app_users row
    const { error: appUserError } = await adminClient
      .from('app_users')
      .insert({
        id: userId,
        pharmacy_id: _currentUser.pharmacyId || null,
        username: trimmed,
        display_name: actualName,
        role,
        branch_id: assignedBranchId,
        can_view_all_branches: role === 'admin',
      });

    if (appUserError) {
      console.error('[Auth] app_users insert failed, rolling back auth user:', appUserError.message);
      await adminClient.auth.admin.deleteUser(userId);
      return { success: false, error: `Failed to create user profile: ${appUserError.message}` };
    }

    await logActivity(_currentUser.id, _currentUser.username, 'user_created', 'app_users', userId, {
      newUsername: trimmed,
      role,
      pharmacyId: _currentUser.pharmacyId
    });

    console.log('[Auth] New account created by admin:', trimmed, `(${role})`);
    return { success: true };
  } catch (err) {
    console.error('[Auth] createUserAccount error:', err.message);
    return { success: false, error: 'Failed to create account. Please try again.' };
  }
}

/**
 * Registers a new pharmacy tenant (SaaS Onboarding / Self-Registration).
 */
export async function registerPharmacy({
  pharmacyName,
  city = '',
  phone = '',
  email = '',
  address = '',
  username,
  name,
  password,
  branchName = 'Main Branch',
  planTier = 'trial'
}) {
  try {
    if (!pharmacyName || pharmacyName.trim().length < 2) {
      return { success: false, error: 'Pharmacy business name is required.' };
    }
    if (!username || username.trim().length < 3) {
      return { success: false, error: 'Admin username must be at least 3 characters.' };
    }
    if (!password || password.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' };
    }

    return {
      success: false,
      error: 'Pharmacy onboarding registration requires a server-side function, not available yet.'
    };

    const cleanUsername = username.trim().toLowerCase();
    const authEmail = `${cleanUsername}@pharmacore.local`;
    const cleanPharmName = pharmacyName.trim();
    const cleanBranchName = branchName.trim() || 'Main Branch';
    const slugBase = cleanPharmName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const slug = `${slugBase}-${randomSuffix}`;

    // Check duplicate username
    const { data: existingUser } = await adminClient
      .from('app_users')
      .select('id')
      .ilike('username', cleanUsername)
      .limit(1);

    if (existingUser && existingUser.length > 0) {
      return { success: false, error: 'Username already in use. Please choose another username.' };
    }

    // Set plan parameters
    let maxBranches = 1;
    let maxUsers = 3;
    let daysValid = 14;
    let subStatus = 'trial';

    if (planTier === 'professional') {
      maxBranches = 5;
      maxUsers = 15;
      daysValid = 30;
      subStatus = 'active';
    } else if (planTier === 'enterprise') {
      maxBranches = 50;
      maxUsers = 100;
      daysValid = 365;
      subStatus = 'active';
    } else if (planTier === 'starter') {
      maxBranches = 1;
      maxUsers = 3;
      daysValid = 30;
      subStatus = 'active';
    }

    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysValid);

    // 1. Create Pharmacy Tenant
    const { data: newPharm, error: pharmErr } = await adminClient
      .from('pharmacies')
      .insert({
        name: cleanPharmName,
        slug,
        contact_email: email.trim() || null,
        contact_phone: phone.trim() || null,
        address: address.trim() || null,
        city: city.trim() || null,
        plan_tier: planTier,
        subscription_status: subStatus,
        trial_ends_at: expiryDate.toISOString(),
        subscription_ends_at: expiryDate.toISOString(),
        max_branches: maxBranches,
        max_users: maxUsers,
        is_active: true
      })
      .select()
      .single();

    if (pharmErr || !newPharm) {
      console.error('[Auth] Failed to create pharmacy record:', pharmErr);
      return { success: false, error: `Failed to create pharmacy tenant: ${pharmErr?.message || 'Unknown error'}` };
    }

    const pharmacyId = newPharm.id;

    // 2. Create Initial Main Branch
    const { data: newBranch, error: branchErr } = await adminClient
      .from('branches')
      .insert({
        pharmacy_id: pharmacyId,
        name: cleanBranchName,
        address: address.trim() || null,
        phone: phone.trim() || null,
        is_main_branch: true
      })
      .select()
      .single();

    if (branchErr || !newBranch) {
      console.error('[Auth] Failed to create main branch:', branchErr);
      // Cleanup pharmacy
      await adminClient.from('pharmacies').delete().eq('id', pharmacyId);
      return { success: false, error: `Failed to create main branch: ${branchErr?.message}` };
    }

    // 3. Create Default Categories for Pharmacy
    const defaultCategories = [
      { name: 'Antibiotics', description: 'Anti-infective & antibacterial medicines', tax_rate: 0 },
      { name: 'Pain Relief & Analgesics', description: 'Painkillers, NSAIDs and antipyretics', tax_rate: 0 },
      { name: 'Cardiovascular & Blood Pressure', description: 'Heart and hypertension medications', tax_rate: 0 },
      { name: 'Gastrointestinal & Antacids', description: 'Stomach, digestion & acid reflux', tax_rate: 0 },
      { name: 'Vitamins & Supplements', description: 'Nutritional dietary supplements', tax_rate: 0 },
      { name: 'First Aid & Surgical Supplies', description: 'Bandages, antiseptic & medical supplies', tax_rate: 0 }
    ];

    await adminClient.from('categories').insert(
      defaultCategories.map(cat => ({
        pharmacy_id: pharmacyId,
        branch_id: newBranch.id,
        ...cat
      }))
    );

    // 4. Create Pharmacy Settings
    await adminClient.from('settings').insert([
      { pharmacy_id: pharmacyId, branch_id: newBranch.id, key: 'pharmacy_name', value: cleanPharmName },
      { pharmacy_id: pharmacyId, branch_id: newBranch.id, key: 'currency_symbol', value: 'PKR' },
      { pharmacy_id: pharmacyId, branch_id: newBranch.id, key: 'refund_approval_threshold', value: '5000' },
      { pharmacy_id: pharmacyId, branch_id: newBranch.id, key: 'expiry_alert_threshold', value: '30' }
    ]);

    // 5. Create Supabase Auth User
    const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true
    });

    if (authError || !authData?.user) {
      console.error('[Auth] Failed to create auth user:', authError);
      await adminClient.from('pharmacies').delete().eq('id', pharmacyId);
      return { success: false, error: `Failed to create admin user: ${authError?.message}` };
    }

    const userId = authData.user.id;

    // 6. Create app_users Profile
    const { error: appUserErr } = await adminClient.from('app_users').insert({
      id: userId,
      pharmacy_id: pharmacyId,
      username: cleanUsername,
      display_name: (name && name.trim()) ? name.trim() : cleanPharmName + ' Admin',
      role: 'admin',
      branch_id: newBranch.id,
      can_view_all_branches: true
    });

    if (appUserErr) {
      console.error('[Auth] Failed to create app_users record:', appUserErr);
      await adminClient.auth.admin.deleteUser(userId);
      await adminClient.from('pharmacies').delete().eq('id', pharmacyId);
      return { success: false, error: `Failed to setup user profile: ${appUserErr.message}` };
    }

    console.log(`[Auth] Pharmacy registered successfully: "${cleanPharmName}" (${slug}) with owner "${cleanUsername}"`);
    return {
      success: true,
      pharmacyId,
      pharmacyName: cleanPharmName,
      username: cleanUsername,
      branchId: newBranch.id
    };
  } catch (err) {
    console.error('[Auth] registerPharmacy error:', err);
    return { success: false, error: err.message || 'Registration encountered an error.' };
  }
}

/**
 * Admin-only: Updates a user's username and/or display name.
 */
export async function updateUsername(userId, newUsername, newName) {
  try {
    if (!_currentUser || !['admin', 'superadmin'].includes(_currentUser.role)) {
      return { success: false, error: 'Unauthorised. Only administrators can edit usernames.' };
    }

    const trimmed = newUsername?.trim()?.toLowerCase();
    if (!trimmed || trimmed.length < 3) {
      return { success: false, error: 'Username must be at least 3 characters.' };
    }

    const actualName = (newName && newName.trim()) ? newName.trim() : trimmed;
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Database service unavailable.' };
    }

    // Duplicate check
    const { data: existing, error: checkErr } = await supabase
      .from('app_users')
      .select('id')
      .ilike('username', trimmed)
      .neq('id', userId)
      .limit(1);

    if (checkErr) {
      return { success: false, error: checkErr.message };
    }

    if (existing && existing.length > 0) {
      return { success: false, error: 'Username already exists.' };
    }

    const { error: updateError } = await supabase
      .from('app_users')
      .update({ username: trimmed, display_name: actualName })
      .eq('id', userId);

    if (updateError) {
      return { success: false, error: `Failed to update: ${updateError.message}` };
    }

    if (userId === _currentUser.id) {
      _currentUser.username = trimmed;
      _currentUser.name = actualName;
    }

    await logActivity(_currentUser.id, _currentUser.username, 'user_updated', 'app_users', userId, {
      newUsername: trimmed,
      newName: actualName,
    });

    return { success: true };
  } catch (err) {
    console.error('[Auth] updateUsername error:', err.message);
    return { success: false, error: 'Failed to update username. Please try again.' };
  }
}

/**
 * Admin-only: Updates a user's assigned branch.
 */
export async function updateUserBranch(userId, newBranchId) {
  try {
    if (!_currentUser || !_currentUser.canViewAllBranches) {
      return { success: false, error: 'Unauthorised. Only owners can reassign branches.' };
    }
    
    if (!newBranchId) {
      return { success: false, error: 'Branch ID is required.' };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Database service unavailable.' };
    }

    const { error: updateError } = await supabase
      .from('app_users')
      .update({ branch_id: newBranchId })
      .eq('id', userId);

    if (updateError) {
      return { success: false, error: `Failed to update branch: ${updateError.message}` };
    }

    await logActivity(_currentUser.id, _currentUser.username, 'user_branch_updated', 'app_users', userId, {
      newBranchId,
    });

    return { success: true };
  } catch (err) {
    console.error('[Auth] updateUserBranch error:', err.message);
    return { success: false, error: 'Failed to update branch.' };
  }
}

/**
 * Admin-only: Resets a user's password.
 * Modifying another user's credentials in auth.users requires admin API / server-side function.
 */
export async function resetUserPassword(userId, newPassword) {
  return {
    success: false,
    error: 'Administrative password reset requires a server-side function, not available yet.'
  };
}

/**
 * Updates the current logged-in user's own password (used for forced first-login change or profile update).
 */
export async function changeOwnPassword(newPassword) {
  try {
    if (!_currentUser) {
      return { success: false, error: 'Not authenticated.' };
    }
    if (!newPassword || newPassword.length < 8) {
      return { success: false, error: 'Password must be at least 8 characters.' };
    }
    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Database service unavailable.' };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { success: false, error: error.message };
    }
    await supabase.from('app_users').update({ must_change_password: false }).eq('id', _currentUser.id);
    _currentUser.mustChangePassword = false;
    await logActivity(_currentUser.id, _currentUser.username, 'password_change', 'app_users', _currentUser.id, {});
    return { success: true };
  } catch (err) {
    console.error('[Auth] changeOwnPassword error:', err.message);
    return { success: false, error: 'Failed to update password.' };
  }
}

/**
 * Records an activity log entry.
 */
async function logActivity(userId, username, action, targetTable, targetRecordId, details) {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    await supabase.from('activity_logs').insert({
      pharmacy_id: _currentUser?.pharmacyId || null,
      user_id: userId,
      username: username || 'unknown',
      action,
      target_table: targetTable,
      target_record_id: targetRecordId,
      details: details || {},
      device_name: os.hostname(),
      branch_id: _currentUser?.branchId || null,
    });
  } catch (err) {
    console.error('[Auth] Failed to log activity:', err.message);
  }
}

/**
 * Test helper to set the current user without network calls.
 * Used exclusively for testing role validation functions like requireSuperAdmin.
 */
export function _setCurrentUserForTesting(user) {
  _currentUser = user;
}

/**
 * Registers all auth-related IPC handlers.
 */
export function registerIpcHandlers(ipcMain) {
  ipcMain.handle('auth:login', async (_event, { username, password }) =>
    loginUser(username, password)
  );

  ipcMain.handle('auth:logout', async () => {
    await logoutUser();
  });

  ipcMain.handle('auth:create-user', async (_event, { username, name, password, role, branchId }) =>
    createUserAccount(username, name, password, role, branchId)
  );

  ipcMain.handle('auth:register-pharmacy', async (_event, data) =>
    registerPharmacy(data)
  );

  ipcMain.handle('auth:update-username', async (_event, { userId, newUsername, newName }) =>
    updateUsername(userId, newUsername, newName)
  );

  ipcMain.handle('auth:update-user-branch', async (_event, { userId, newBranchId }) =>
    updateUserBranch(userId, newBranchId)
  );

  ipcMain.handle('auth:reset-user-password', async (_event, { userId, newPassword }) =>
    resetUserPassword(userId, newPassword)
  );

  ipcMain.handle('auth:change-password', async (_event, { newPassword }) =>
    changeOwnPassword(newPassword)
  );

  ipcMain.handle('auth:register', async (_event, { username, name, password, role, branchId, branchName }) => {
    // If branches are empty, redirect or handle as pharmacy registration
    return registerPharmacy({
      pharmacyName: branchName || 'My Pharmacy',
      username,
      name,
      password,
      branchName: branchName || 'Main Branch',
      planTier: 'trial'
    });
  });
}
