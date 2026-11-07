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
let _passwordAlreadyChangedInSession = false;

const COMMON_WEAK_PASSWORDS = new Set([
  'password123',
  'password1234',
  '1234567890',
  'admin12345',
  'adminpassword',
  'pharmacore1',
  'pharmacore123',
  'welcome1234',
  'letmein1234',
  'changeme123',
  'iloveyou123'
]);

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
  _passwordAlreadyChangedInSession = false;
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
      mustChangePassword: !!appUser.must_change_password,
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
    _passwordAlreadyChangedInSession = false;
  }
}

/**
 * Admin-only: Creates a new user account in Supabase Auth & app_users with subscription quota enforcement.
 */
export async function createUserAccount(username, name, password, role, branchId) {
  try {
    if (!_currentUser) {
      return { success: false, error: 'Unauthorised. Only administrators can create accounts.' };
    }
    if (_currentUser.mustChangePassword) {
      return { success: false, error: 'Unauthorized: Password change required.' };
    }
    if (!['admin', 'superadmin'].includes(_currentUser.role)) {
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

    return {
      success: false,
      error: 'User creation requires a server-side function, not available yet.'
    };
  } catch (err) {
    console.error('[Auth] createUserAccount error:', err.message);
    return { success: false, error: 'Failed to create account. Please try again.' };
  }
}

/**
 * Generates a clean lowercase username from an owner's full name:
 * Lowercase, spaces and non-alphanumeric characters become underscores,
 * collapse repeated underscores, trim leading/trailing underscores, pad to at least 3 chars.
 * E.g., "Dr Tariq Khan" -> "dr_tariq_khan".
 */
export function generateUsername(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'admin';
  let clean = fullName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!clean) return 'admin';
  if (clean.length < 3) clean = clean.padEnd(3, '_');
  if (clean.length > 50) clean = clean.slice(0, 50).replace(/_+$/, '');
  return clean;
}

/**
 * Appends a short numeric suffix for username collision retry.
 */
export function appendNumericSuffix(username) {
  const clean = (username || 'admin').trim();
  const match = clean.match(/^(.*?)_?(\d+)$/);
  if (match) {
    const base = match[1];
    const nextNum = parseInt(match[2], 10) + 1;
    return `${base}_${nextNum}`.slice(0, 50);
  }
  return `${clean}_1`.slice(0, 50);
}

/**
 * Maps status code and server error message to a concise, user-friendly message.
 */
export function mapProvisioningError(statusCode, serverMessage) {
  const lower = (serverMessage || '').toLowerCase();
  if (statusCode === 429 || lower.includes('rate limit')) {
    return 'Provisioning rate limit reached (maximum 10 per hour). Please wait before trying again.';
  }
  if (statusCode === 403 || lower.includes('forbidden') || lower.includes('superadmin access required')) {
    return 'Access denied: SuperAdmin permission required.';
  }
  if (lower.includes('already taken') || lower.includes('username is already taken')) {
    return 'Admin username is already taken. Please choose a different username.';
  }
  if (lower.includes('invalid email') || lower.includes('email address format')) {
    return 'Invalid owner login email address format.';
  }
  if (lower.includes('plan') || lower.includes('subscription plan')) {
    return 'Invalid or inactive subscription plan selected.';
  }
  if (lower.includes('pharmacy name')) {
    return 'Pharmacy name must be between 2 and 100 characters.';
  }
  return 'Failed to provision pharmacy. The owner login email may already be registered, or input details are invalid.';
}

/**
 * Helper to invoke the provision-pharmacy Edge Function with exact allowed keys.
 */
async function callProvisionEdgeFunction(supabase, sessionToken, payload) {
  const { data, error } = await supabase.functions.invoke('provision-pharmacy', {
    body: payload,
    headers: {
      Authorization: `Bearer ${sessionToken}`
    }
  });

  if (error) {
    let statusCode = 500;
    let serverMessage = '';

    if (error.context) {
      if (typeof error.context.status === 'number') {
        statusCode = error.context.status;
      }
      if (typeof error.context.json === 'function') {
        try {
          const body = await error.context.json();
          serverMessage = body?.error || body?.message || '';
        } catch (_) {
          try {
            if (typeof error.context.text === 'function') {
              serverMessage = await error.context.text();
            }
          } catch (_) { }
        }
      }
    }
    if (!serverMessage) {
      serverMessage = error.message || '';
    }

    return { success: false, statusCode, serverMessage };
  }

  return { success: true, data };
}

/**
 * Registers a new pharmacy tenant via the provision-pharmacy Edge Function.
 * Strictly uses the superadmin session token; never uses service role keys.
 */
export async function registerPharmacy(pharmacyData) {
  try {
    if (!pharmacyData || typeof pharmacyData !== 'object' || Array.isArray(pharmacyData)) {
      return { success: false, error: 'Invalid pharmacy data payload.' };
    }

    const pharmacyName = (pharmacyData.pharmacyName || '').trim();
    const adminEmail = (pharmacyData.adminEmail || pharmacyData.email || '').trim().toLowerCase();
    const adminUsername = (pharmacyData.adminUsername || pharmacyData.username || '').trim();
    const planTier = (pharmacyData.planTier || 'trial').trim();
    const branchName = (pharmacyData.branchName || 'Main Branch').trim();
    const city = (pharmacyData.city || 'Karachi').trim();
    const phone = pharmacyData.phone ? String(pharmacyData.phone).trim() : null;
    const adminDisplayName = (pharmacyData.adminDisplayName || pharmacyData.name || '').trim() || null;

    if (pharmacyName.length < 2 || pharmacyName.length > 100) {
      return { success: false, error: 'Pharmacy business name must be between 2 and 100 characters.' };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (adminEmail.length < 5 || adminEmail.length > 255 || !emailRegex.test(adminEmail)) {
      return { success: false, error: 'Invalid owner login email address format.' };
    }
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (adminUsername.length < 3 || adminUsername.length > 50 || !usernameRegex.test(adminUsername)) {
      return { success: false, error: 'Admin username must be between 3 and 50 characters (letters, numbers, underscores only).' };
    }
    if (planTier.length < 2 || planTier.length > 50) {
      return { success: false, error: 'Subscription plan tier must be between 2 and 50 characters.' };
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Cloud service not initialized. Check your internet connection.' };
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const sessionToken = sessionData?.session?.access_token;
    if (!sessionToken) {
      return { success: false, error: 'Access denied: SuperAdmin permission required.' };
    }

    // Build payload with ONLY the accepted keys expected by provision-pharmacy Edge Function
    // Do NOT send password or address (address cannot be stored by the Edge Function).
    const payload = {
      pharmacyName,
      adminEmail,
      adminUsername,
      planTier,
      branchName,
      city
    };
    if (phone) payload.phone = phone;
    if (adminDisplayName) payload.adminDisplayName = adminDisplayName;

    let res = await callProvisionEdgeFunction(supabase, sessionToken, payload);

    // If username is taken, retry ONCE with a short numeric suffix
    let usernameAdjusted = false;
    let finalUsername = adminUsername;
    if (!res.success && (res.serverMessage.toLowerCase().includes('already taken') || res.serverMessage.toLowerCase().includes('username'))) {
      finalUsername = appendNumericSuffix(adminUsername);
      const retryPayload = { ...payload, adminUsername: finalUsername };
      const retryRes = await callProvisionEdgeFunction(supabase, sessionToken, retryPayload);
      if (retryRes.success) {
        res = retryRes;
        usernameAdjusted = true;
      }
    }

    if (!res.success) {
      return {
        success: false,
        error: mapProvisioningError(res.statusCode, res.serverMessage)
      };
    }

    // Success response: returns pharmacy, admin, and one-time temporaryPassword
    return {
      success: true,
      pharmacy: res.data.pharmacy,
      admin: res.data.admin,
      temporaryPassword: res.data.temporaryPassword,
      usernameAdjusted,
      originalUsername: adminUsername,
      finalUsername,
      note: usernameAdjusted ? `Username was already taken; provisioned as "${finalUsername}" instead.` : null
    };
  } catch (err) {
    console.error('[Auth] registerPharmacy error:', err.message);
    return { success: false, error: 'Failed to provision pharmacy. Please verify details and try again.' };
  }
}

/**
 * Admin-only: Updates a user's username and/or display name.
 */
export async function updateUsername(userId, newUsername, newName) {
  try {
    if (!_currentUser) {
      return { success: false, error: 'Unauthorised. Only administrators can edit usernames.' };
    }
    if (_currentUser.mustChangePassword) {
      return { success: false, error: 'Unauthorized: Password change required.' };
    }
    if (!['admin', 'superadmin'].includes(_currentUser.role)) {
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
    if (!_currentUser) {
      return { success: false, error: 'Unauthorised. Only owners can reassign branches.' };
    }
    if (_currentUser.mustChangePassword) {
      return { success: false, error: 'Unauthorized: Password change required.' };
    }
    if (!_currentUser.canViewAllBranches) {
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

    const supabase = getSupabaseClient();
    if (!supabase) {
      return { success: false, error: 'Database service unavailable.' };
    }

    if (!_passwordAlreadyChangedInSession) {
      if (typeof newPassword !== 'string') {
        return { success: false, error: 'Password must be a valid string.' };
      }
      if (!newPassword.trim()) {
        return { success: false, error: 'Password cannot be blank or made only of spaces.' };
      }
      if (newPassword.length < 10) {
        return { success: false, error: 'Password must be at least 10 characters long.' };
      }
      if (Buffer.byteLength(newPassword, 'utf8') > 72) {
        return { success: false, error: 'Password cannot exceed 72 bytes in length.' };
      }
      if (COMMON_WEAK_PASSWORDS.has(newPassword.toLowerCase())) {
        return { success: false, error: 'Password is too common or weak. Please choose a more secure password.' };
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) {
        return { success: false, error: updateError.message };
      }
      _passwordAlreadyChangedInSession = true;
    }

    const { data: flagCleared, error: rpcError } = await supabase.rpc('fn_clear_own_must_change_password');
    if (rpcError || flagCleared !== true) {
      return {
        success: false,
        passwordAlreadyChanged: true,
        error: rpcError?.message || 'Password was updated, but failed to complete setup. Please click Finish Setup to retry.'
      };
    }

    _currentUser.mustChangePassword = false;
    _passwordAlreadyChangedInSession = false;
    await logActivity(_currentUser.id, _currentUser.username, 'password_change', 'app_users', _currentUser.id, {});
    return { success: true };
  } catch (err) {
    console.error('[Auth] changeOwnPassword error:', err.message);
    if (_passwordAlreadyChangedInSession) {
      return {
        success: false,
        passwordAlreadyChanged: true,
        error: 'Password was updated, but setup did not finish. Please click Finish Setup to retry.'
      };
    }
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
  _passwordAlreadyChangedInSession = false;
}

export function _getPasswordAlreadyChangedForTesting() {
  return _passwordAlreadyChangedInSession;
}

export function _setPasswordAlreadyChangedForTesting(val) {
  _passwordAlreadyChangedInSession = val;
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
