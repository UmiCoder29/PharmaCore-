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
 * Registers a new pharmacy tenant (SaaS Onboarding / Self-Registration).
 */
export async function registerPharmacy({
  pharmacyName,
  username,
  password,
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
