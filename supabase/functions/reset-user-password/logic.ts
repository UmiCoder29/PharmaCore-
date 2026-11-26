/**
 * Pure business logic module for reset-user-password Edge Function.
 * Shared between the Edge Function handler (index.ts) and node test runner.
 */

export const UNIFORM_INELIGIBLE_ERROR = 'Target user not found or not eligible for reset.';
export const SELF_RESET_ERROR = 'Self-reset is not allowed through administrative reset. Use standard password change.';
export const RATE_LIMIT_MAX_ATTEMPTS = 10;
export const RATE_LIMIT_COUNTED_OUTCOME = 'attempted';

export interface AttemptRecord {
  caller_id: string;
  target_id?: string | null;
  outcome: string;
  created_at: string;
}

/**
 * Counts rate-limit-consuming attempts for a caller within the active window.
 */
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

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

/**
 * Validates the raw request body.
 * Whitelists strictly { userId } with valid UUID format and rejects all extra keys.
 */
export function validateResetInput(body: unknown): { valid: boolean; error?: string; userId?: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Request body must be a JSON object containing only userId.' };
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'userId') {
    return { valid: false, error: 'Request body must contain only the userId key.' };
  }

  const userId = (body as Record<string, unknown>).userId;
  if (typeof userId !== 'string' || !UUID_REGEX.test(userId.trim())) {
    return { valid: false, error: 'userId must be a valid UUID.' };
  }

  return { valid: true, userId: userId.trim() };
}

export interface UserProfile {
  id: string;
  role: string;
  pharmacy_id?: string | null;
  username?: string;
}

/**
 * Pure evaluation of the reset permission matrix.
 * Enforces uniform 403 for ineligible targets and dedicated message for self-reset.
 */
export function evaluateResetPermission(
  caller: UserProfile | null | undefined,
  target: UserProfile | null | undefined
): { allowed: boolean; httpStatus: number; error?: string } {
  if (!caller) {
    return { allowed: false, httpStatus: 401, error: 'Unauthorized.' };
  }

  // Self-reset check (own message)
  if (target && caller.id === target.id) {
    return { allowed: false, httpStatus: 403, error: SELF_RESET_ERROR };
  }

  // Pharmacists cannot reset anyone
  if (caller.role !== 'superadmin' && caller.role !== 'admin') {
    return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
  }

  // Nonexistent target
  if (!target) {
    return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
  }

  // Superadmins can NEVER be reset administratively
  if (target.role === 'superadmin') {
    return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
  }

  // Admin callers: may reset ONLY pharmacists in the SAME pharmacy
  if (caller.role === 'admin') {
    if (target.role !== 'pharmacist') {
      return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
    }
    if (!caller.pharmacy_id || !target.pharmacy_id || caller.pharmacy_id !== target.pharmacy_id) {
      return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
    }
    return { allowed: true, httpStatus: 200 };
  }

  // Superadmin callers: may reset ONLY pharmacy admins (owners)
  if (caller.role === 'superadmin') {
    if (target.role !== 'admin') {
      return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
    }
    return { allowed: true, httpStatus: 200 };
  }

  return { allowed: false, httpStatus: 403, error: UNIFORM_INELIGIBLE_ERROR };
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

/**
 * Generates an unbiased 16-character temporary password meeting PharmaCore policy.
 */
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
