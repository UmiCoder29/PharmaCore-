/**
 * Pure business logic & testable handler orchestration for create-staff-user Edge Function.
 * Shared between index.ts and Node test suite.
 */

export const STAFF_EMAIL_DOMAIN = 'staff.pharmacore.invalid';
export const STAFF_USERNAME_REGEX = /^[a-z0-9_]{3,50}$/;
export const RATE_LIMIT_MAX_ATTEMPTS = 10;
export const RATE_LIMIT_COUNTED_OUTCOME = 'attempted';

export const UNIFORM_FORBIDDEN_ERROR = 'You are not authorized to create this user account.';
export const UNIFORM_BRANCH_ERROR = 'Invalid or unavailable branch assignment.';
export const SELF_CHANGE_REQUIRED_ERROR = 'Password change required before creating staff accounts.';
export const DUPLICATE_USERNAME_ERROR = 'Username is already taken. Please choose a different username.';
export const QUOTA_REACHED_ERROR = 'Staff quota reached for this pharmacy plan.';
export const SUSPENDED_PHARMACY_ERROR = 'Cannot create staff accounts while the pharmacy subscription is suspended or inactive.';

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const ALLOWED_KEYS = ['username', 'displayName', 'role', 'branchId'] as const;

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

export interface CallerProfile {
  id: string;
  username: string;
  role: string;
  pharmacy_id: string | null;
  branch_id: string | null;
  can_view_all_branches?: boolean;
  must_change_password?: boolean;
}

export interface PharmacyRecord {
  id: string;
  is_active: boolean;
  subscription_status: string;
  max_users: number;
}

export interface BranchRecord {
  id: string;
  pharmacy_id: string;
}

export interface ParsedStaffPayload {
  username: string;
  displayName: string;
  role: string;
  branchId: string;
}

export interface AttemptRecord {
  caller_id: string;
  target_username?: string | null;
  outcome: string;
  created_at: string;
}

export function buildStaffEmail(username: string): string {
  return `${username.trim().toLowerCase()}@${STAFF_EMAIL_DOMAIN}`;
}

/**
 * Validates raw JSON payload shape and field values.
 * Rejects extra or missing keys strictly (only username, displayName, role, branchId).
 */
export function validateCreateStaffInput(body: unknown): {
  valid: boolean;
  httpStatus?: number;
  error?: string;
  data?: ParsedStaffPayload;
} {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, httpStatus: 400, error: 'Request body must be a JSON object.' };
  }

  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  const allowedSet = new Set<string>(ALLOWED_KEYS);

  for (const k of keys) {
    if (!allowedSet.has(k)) {
      return { valid: false, httpStatus: 400, error: 'Request contains unexpected fields.' };
    }
  }
  for (const requiredKey of ALLOWED_KEYS) {
    if (!(requiredKey in record)) {
      return { valid: false, httpStatus: 400, error: 'Missing required fields.' };
    }
  }

  if (typeof record.username !== 'string') {
    return { valid: false, httpStatus: 400, error: 'Username must be a string.' };
  }
  const username = record.username.trim().toLowerCase();
  if (!STAFF_USERNAME_REGEX.test(username)) {
    return {
      valid: false,
      httpStatus: 400,
      error: 'Username must be 3 to 50 lowercase letters, numbers, or underscores.',
    };
  }

  if (typeof record.displayName !== 'string') {
    return { valid: false, httpStatus: 400, error: 'Full name must be a string.' };
  }
  const displayName = record.displayName.trim();
  if (displayName.length < 2 || displayName.length > 100) {
    return { valid: false, httpStatus: 400, error: 'Full name must be between 2 and 100 characters.' };
  }

  if (typeof record.role !== 'string' || !record.role.trim()) {
    return { valid: false, httpStatus: 400, error: 'Role must be a valid string.' };
  }
  const role = record.role.trim().toLowerCase();

  // Unknown, missing, or malformed branchId must return the exact same message as a foreign branch
  if (typeof record.branchId !== 'string' || !UUID_REGEX.test(record.branchId.trim())) {
    return { valid: false, httpStatus: 400, error: UNIFORM_BRANCH_ERROR };
  }
  const branchId = record.branchId.trim();

  return {
    valid: true,
    data: { username, displayName, role, branchId },
  };
}

/**
 * Evaluates caller eligibility and target role ('pharmacist' only).
 * Returns uniform 403 for any unauthorized role/caller mismatch.
 */
export function evaluateCreateStaffPermission(
  caller: CallerProfile | null | undefined,
  requestedRole: string
): { allowed: boolean; httpStatus: number; error?: string } {
  if (!caller) {
    return { allowed: false, httpStatus: 401, error: 'Unauthorized.' };
  }
  if (caller.must_change_password) {
    return { allowed: false, httpStatus: 403, error: SELF_CHANGE_REQUIRED_ERROR };
  }
  if (caller.role !== 'admin' || !caller.pharmacy_id) {
    return { allowed: false, httpStatus: 403, error: UNIFORM_FORBIDDEN_ERROR };
  }
  if (requestedRole !== 'pharmacist') {
    return { allowed: false, httpStatus: 403, error: UNIFORM_FORBIDDEN_ERROR };
  }
  return { allowed: true, httpStatus: 200 };
}

/**
 * Validates branch membership & single-branch admin restriction.
 */
export function evaluateBranchAssignment(
  caller: CallerProfile,
  branch: BranchRecord | null | undefined
): { valid: boolean; httpStatus: number; error?: string } {
  if (!branch || !caller.pharmacy_id || branch.pharmacy_id !== caller.pharmacy_id) {
    return { valid: false, httpStatus: 400, error: UNIFORM_BRANCH_ERROR };
  }
  if (!caller.can_view_all_branches && caller.branch_id !== branch.id) {
    return { valid: false, httpStatus: 400, error: UNIFORM_BRANCH_ERROR };
  }
  return { valid: true, httpStatus: 200 };
}

/**
 * Validates pharmacy active status and subscription status.
 */
export function evaluatePharmacyEligibility(
  pharmacy: PharmacyRecord | null | undefined
): { allowed: boolean; httpStatus: number; error?: string } {
  if (!pharmacy) {
    return { allowed: false, httpStatus: 403, error: UNIFORM_FORBIDDEN_ERROR };
  }
  if (!pharmacy.is_active || pharmacy.subscription_status === 'suspended' || pharmacy.subscription_status === 'cancelled') {
    return { allowed: false, httpStatus: 403, error: SUSPENDED_PHARMACY_ERROR };
  }
  return { allowed: true, httpStatus: 200 };
}

export function countRateLimitedAttempts(
  attempts: AttemptRecord[],
  callerId: string,
  windowStartIso: string
): number {
  return attempts.filter(
    (row) =>
      row.caller_id === callerId &&
      row.outcome === RATE_LIMIT_COUNTED_OUTCOME &&
      row.created_at >= windowStartIso
  ).length;
}

export function isRateLimitExceeded(attemptCount: number): boolean {
  return attemptCount >= RATE_LIMIT_MAX_ATTEMPTS;
}

/**
 * Distinguishes auth.admin.createUser errors from DB username collisions.
 * Must NEVER return DUPLICATE_USERNAME_ERROR.
 */
export function classifyStaffAuthCreateError(error: { message?: string; status?: number; code?: string } | null | undefined): {
  httpStatus: number;
  code: string;
  error: string;
} {
  const msg = (error?.message || '').toLowerCase();
  const code = (error?.code || '').toLowerCase();
  if (
    code === 'email_exists' ||
    msg.includes('already registered') ||
    msg.includes('already exists')
  ) {
    return {
      httpStatus: 409,
      code: 'auth_account_exists',
      error: 'An authentication account for this staff identifier already exists.',
    };
  }
  return {
    httpStatus: 500,
    code: 'auth_create_failed',
    error: 'Unable to create authentication credentials for this staff account.',
  };
}

function getSecureChar(source: string): string {
  const len = source.length;
  const maxValidByte = 256 - (256 % len);
  const buffer = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < maxValidByte) {
      return source[buffer[0] % len];
    }
  }
}

export function generateTemporaryPassword(): string {
  const charsets = [UPPERCASE, LOWERCASE, DIGITS, SYMBOLS];
  const chars: string[] = [];

  for (let i = 0; i < charsets.length; i++) {
    chars.push(getSecureChar(charsets[i]));
  }

  const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;
  const TARGET_LENGTH = 16;
  while (chars.length < TARGET_LENGTH) {
    chars.push(getSecureChar(ALL_CHARS));
  }

  for (let i = chars.length - 1; i > 0; i--) {
    const range = i + 1;
    const maxValidByte = 256 - (256 % range);
    const buffer = new Uint8Array(1);
    while (true) {
      crypto.getRandomValues(buffer);
      if (buffer[0] < maxValidByte) {
        const j = buffer[0] % range;
        const tmp = chars[i];
        chars[i] = chars[j];
        chars[j] = tmp;
        break;
      }
    }
  }

  return chars.join('');
}

export interface CreateStaffDeps {
  getEnv: () => { url?: string; serviceRoleKey?: string; anonKey?: string };
  verifyToken: (token: string) => Promise<{ userId: string | null; error?: string }>;
  getCallerProfile: (userId: string) => Promise<CallerProfile | null>;
  countAttempts: (callerId: string, windowStartIso: string) => Promise<{ count: number | null; error?: string }>;
  recordAttempt: (callerId: string, targetUsername: string | null, outcome: string) => Promise<void>;
  getPharmacy: (pharmacyId: string) => Promise<PharmacyRecord | null>;
  getBranch: (branchId: string) => Promise<BranchRecord | null>;
  findUserByUsername: (username: string) => Promise<{ id: string } | null>;
  createAuthUser: (email: string, password: string) => Promise<{ userId?: string; error?: { message?: string; status?: number; code?: string } }>;
  deleteAuthUser: (userId: string) => Promise<{ error?: { message?: string } | null }>;
  callCreateStaffRpc: (params: {
    p_new_user_id: string;
    p_pharmacy_id: string;
    p_branch_id: string;
    p_username: string;
    p_display_name: string;
    p_caller_user_id: string;
    p_caller_username: string;
  }) => Promise<{ data?: Record<string, unknown>; error?: { message?: string; code?: string } | null }>;
  findAppUserById: (userId: string) => Promise<{ data?: { id: string } | null; error?: { message?: string } | null }>;
  sleep?: (ms: number) => Promise<void>;
  logError?: (msg: string) => void;
}

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

function makeResult(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return { status, headers: { ...RESPONSE_HEADERS, ...extraHeaders }, body };
}

/**
 * Full server-side request orchestration for create-staff-user.
 * Executed both by index.ts (Deno runtime) and unit/integration tests (Node).
 */
export async function processCreateStaffRequest(
  method: string,
  authHeader: string,
  rawBodyResult: { ok: true; body: unknown } | { ok: false },
  deps: CreateStaffDeps
): Promise<{ status: number; headers: Record<string, string>; body: Record<string, unknown> }> {
  if (method !== 'POST') {
    return makeResult(405, { success: false, error: 'Method Not Allowed. Use POST.' }, { Allow: 'POST' });
  }

  const env = deps.getEnv();
  if (!env.url || !env.serviceRoleKey || !env.anonKey) {
    return makeResult(500, { success: false, error: 'Server configuration error.' });
  }

  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return makeResult(401, { success: false, error: 'Missing or malformed Authorization header.' });
  }

  const authCheck = await deps.verifyToken(token);
  if (!authCheck.userId) {
    return makeResult(401, { success: false, error: 'Invalid or expired session token.' });
  }

  if (!rawBodyResult.ok) {
    return makeResult(400, { success: false, error: 'Malformed JSON payload.' });
  }

  const inputCheck = validateCreateStaffInput(rawBodyResult.body);
  if (!inputCheck.valid || !inputCheck.data) {
    return makeResult(inputCheck.httpStatus || 400, {
      success: false,
      error: inputCheck.error || 'Invalid request payload.',
    });
  }

  const payload = inputCheck.data;
  const caller = await deps.getCallerProfile(authCheck.userId);
  if (!caller) {
    return makeResult(401, { success: false, error: 'Caller user profile not found.' });
  }

  // Permission matrix before recording rate-limit-consuming attempt
  const permission = evaluateCreateStaffPermission(caller, payload.role);
  if (!permission.allowed) {
    await deps.recordAttempt(caller.id, payload.username, 'permission_denied');
    return makeResult(permission.httpStatus, {
      success: false,
      error: permission.error || UNIFORM_FORBIDDEN_ERROR,
    });
  }

  // Pharmacy eligibility check (is_active + subscription_status)
  const pharmacy = await deps.getPharmacy(caller.pharmacy_id!);
  const pharmCheck = evaluatePharmacyEligibility(pharmacy);
  if (!pharmCheck.allowed) {
    await deps.recordAttempt(caller.id, payload.username, 'pharmacy_ineligible');
    return makeResult(pharmCheck.httpStatus, {
      success: false,
      error: pharmCheck.error || UNIFORM_FORBIDDEN_ERROR,
    });
  }

  // Branch ownership & single-branch restriction check
  const branch = await deps.getBranch(payload.branchId);
  const branchCheck = evaluateBranchAssignment(caller, branch);
  if (!branchCheck.valid) {
    await deps.recordAttempt(caller.id, payload.username, 'branch_invalid');
    return makeResult(branchCheck.httpStatus, {
      success: false,
      error: branchCheck.error || UNIFORM_BRANCH_ERROR,
    });
  }

  // Rate limit check (counts ONLY outcome = 'attempted' in last hour)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: attemptCount, error: countErr } = await deps.countAttempts(caller.id, oneHourAgo);
  if (countErr) {
    return makeResult(500, {
      success: false,
      error: 'Rate limit check failed. Request aborted for safety.',
    });
  }

  if (isRateLimitExceeded(attemptCount ?? 0)) {
    await deps.recordAttempt(caller.id, payload.username, 'rate_limited');
    return makeResult(429, {
      success: false,
      error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_ATTEMPTS} staff creation attempts per hour.`,
    });
  }

  // Record rate-limit-consuming attempt BEFORE username probe so probing consumes slots
  await deps.recordAttempt(caller.id, payload.username, RATE_LIMIT_COUNTED_OUTCOME);

  // Username pre-check (platform-wide unique)
  const existingUser = await deps.findUserByUsername(payload.username);
  if (existingUser) {
    await deps.recordAttempt(caller.id, payload.username, 'username_taken');
    return makeResult(409, {
      success: false,
      error: DUPLICATE_USERNAME_ERROR,
    });
  }

  const temporaryPassword = generateTemporaryPassword();
  const staffEmail = buildStaffEmail(payload.username);

  // Phase 1: Create Auth user first
  const authResult = await deps.createAuthUser(staffEmail, temporaryPassword);
  if (authResult.error || !authResult.userId) {
    await deps.recordAttempt(caller.id, payload.username, 'auth_failed');
    deps.logError?.(`[create-staff-user] Auth createUser failed: ${authResult.error?.message || 'unknown'}`);
    const classified = classifyStaffAuthCreateError(authResult.error);
    return makeResult(classified.httpStatus, {
      success: false,
      code: classified.code,
      error: classified.error,
    });
  }

  const newAuthUserId = authResult.userId;

  async function rollbackAuthUser(authId: string): Promise<boolean> {
    const sleepFn = deps.sleep || ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= 3; attempt++) {
      const delRes = await deps.deleteAuthUser(authId);
      if (!delRes.error) {
        return true;
      }
      if (attempt < 3) {
        await sleepFn(attempt === 1 ? 500 : 1500);
      }
    }
    deps.logError?.(JSON.stringify({
      level: 'ERROR',
      event: 'ORPHAN_AUTH_USER_CREATION_FAILURE',
      message: 'Failed to rollback auth user after DB creation failure',
      auth_user_id: authId,
      timestamp: new Date().toISOString(),
    }));
    return false;
  }

  // Phase 2: Transactional DB RPC (enforces max_users + inserts app_users + writes activity_logs)
  const rpcRes = await deps.callCreateStaffRpc({
    p_new_user_id: newAuthUserId,
    p_pharmacy_id: caller.pharmacy_id!,
    p_branch_id: payload.branchId,
    p_username: payload.username,
    p_display_name: payload.displayName,
    p_caller_user_id: caller.id,
    p_caller_username: caller.username,
  });

  if (rpcRes.error) {
    const hasDefiniteCode = typeof rpcRes.error.code === 'string' && rpcRes.error.code.trim().length > 0;
    if (hasDefiniteCode) {
      await deps.recordAttempt(caller.id, payload.username, 'rpc_failed');
      const rolledBack = await rollbackAuthUser(newAuthUserId);
      if (!rolledBack) {
        await deps.recordAttempt(caller.id, payload.username, 'rollback_failed');
      }

      const lowerMsg = (rpcRes.error.message || '').toLowerCase();
      if (rpcRes.error.code === '23505' || lowerMsg.includes('already taken')) {
        return makeResult(409, { success: false, error: DUPLICATE_USERNAME_ERROR });
      }
      if (lowerMsg.includes('user limit reached')) {
        return makeResult(403, { success: false, error: QUOTA_REACHED_ERROR });
      }
      if (lowerMsg.includes('suspended') || lowerMsg.includes('inactive')) {
        return makeResult(403, { success: false, error: SUSPENDED_PHARMACY_ERROR });
      }
      if (lowerMsg.includes('branch')) {
        return makeResult(400, { success: false, error: UNIFORM_BRANCH_ERROR });
      }
      return makeResult(500, {
        success: false,
        error: 'Failed to create staff profile in database.',
      });
    }

    // Ambiguous failure (no Postgres error code, e.g., timeout/network): inspect app_users before deleting Auth user
    await deps.recordAttempt(caller.id, payload.username, 'ambiguous_rpc_failure');
    const lookup = await deps.findAppUserById(newAuthUserId);
    if (lookup.error) {
      deps.logError?.(JSON.stringify({
        level: 'ERROR',
        event: 'POSSIBLE_ORPHAN_AUTH_USER',
        message: 'Lookup failed after ambiguous RPC failure; auth user NOT deleted',
        auth_user_id: newAuthUserId,
        timestamp: new Date().toISOString(),
      }));
      return makeResult(500, {
        success: false,
        error: 'An ambiguous error occurred while creating staff. Please check the user list before retrying.',
      });
    }
    if (lookup.data) {
      deps.logError?.(JSON.stringify({
        level: 'ERROR',
        event: 'STAFF_CREATION_UNCERTAIN_COMPLETED',
        message: 'app_users row exists after ambiguous RPC failure; auth user NOT deleted',
        auth_user_id: newAuthUserId,
        timestamp: new Date().toISOString(),
      }));
      return makeResult(500, {
        success: false,
        error: 'Staff creation may have completed despite a network error. Please refresh the user list before retrying.',
      });
    }

    const rolledBack = await rollbackAuthUser(newAuthUserId);
    if (!rolledBack) {
      await deps.recordAttempt(caller.id, payload.username, 'rollback_failed');
    }
    return makeResult(500, {
      success: false,
      error: 'Failed to create staff profile in database.',
    });
  }

  await deps.recordAttempt(caller.id, payload.username, 'success');

  return makeResult(200, {
    success: true,
    temporaryPassword,
    user: {
      id: newAuthUserId,
      username: payload.username,
      displayName: payload.displayName,
      role: 'pharmacist',
      branchId: payload.branchId,
      mustChangePassword: true,
    },
  });
}
