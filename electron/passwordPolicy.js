/**
 * Shared Password Policy for PharmaCore
 *
 * Single source of truth for password validation when setting/changing passwords.
 * Applies to forced first-login password changes and password resets.
 * Never applied during login, allowing legacy accounts with older passwords to authenticate.
 */

// Blocklist of common weak passwords.
// Includes the original 11 legacy entries plus extended variants (>= 12 characters, letters and digits)
// that reach the exact-match check without being rejected earlier by length or banned-word checks.
export const COMMON_WEAK_PASSWORDS = new Set([
  // Legacy entries
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
  'iloveyou123',
  // Extended entries that reach the exact-match check under the 12-character policy
  'welcome12345',
  'letmein12345',
  'changeme1234',
  'iloveyou1234',
  'admin1234567'
]);

export const BLOCKED_WORDS = ['password', 'pharmacore', 'qwerty'];

const textEncoder = new TextEncoder();

/**
 * Normalizes a string for personal info matching:
 * Converts to lowercase and removes spaces and punctuation, keeping only Unicode letters and numbers.
 */
function normalizeForComparison(val) {
  if (typeof val !== 'string') return '';
  return val.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Validates a candidate password according to the PharmaCore password policy.
 * Returns the first failing rule, or { valid: true } if all checks pass.
 *
 * @param {unknown} password - Candidate password string.
 * @param {object} [context] - Session context values (username, email, pharmacyName).
 * @param {string} [context.username] - User's username.
 * @param {string} [context.email] - User's email address.
 * @param {string} [context.pharmacyName] - User's pharmacy business name.
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePassword(password, context = {}) {
  // 1. Must be a string
  if (typeof password !== 'string') {
    return { valid: false, error: 'Password must be a valid string.' };
  }

  // 2. Cannot be blank or whitespace-only
  if (!password.trim()) {
    return {
      valid: false,
      error: 'Password cannot be blank or made only of spaces.'
    };
  }

  // 3. Must contain at least one letter (any language, Unicode letters)
  if (!/\p{L}/u.test(password)) {
    return {
      valid: false,
      error: 'Password must include at least one letter. A password with only numbers is not allowed.'
    };
  }

  // 4. Must contain at least one digit (ASCII 0-9 only).
  // Kept as ASCII [0-9] specifically so non-ASCII numeral lookalikes or symbols are not counted as digits.
  if (!/[0-9]/.test(password)) {
    return {
      valid: false,
      error: 'Password must include at least one number as well as letters.'
    };
  }

  // 5. Length checks:
  // Minimum length: 12 characters (character count)
  if (password.length < 12) {
    return {
      valid: false,
      error: 'Password must be at least 12 characters long.'
    };
  }

  // Maximum length: 72 bytes (Bcrypt maximum key length in Supabase GoTrue Auth)
  // Measured in UTF-8 bytes using TextEncoder (works in both Node.js and browser)
  const byteLength = textEncoder.encode(password).length;
  if (byteLength > 72) {
    return {
      valid: false,
      error: 'Password cannot exceed 72 bytes in length. Non-English letters use more than one byte each.'
    };
  }

  // 6. Must have at least 6 distinct characters (avoids repetitive passwords like aaaaaaaaaaaa1)
  if (new Set(password).size < 6) {
    return {
      valid: false,
      error: 'Password is too repetitive. Use a wider mix of characters.'
    };
  }

  // 7. Blocked substrings and blocklist exact match (case-insensitive)
  const lower = password.toLowerCase();
  for (const blocked of BLOCKED_WORDS) {
    if (lower.includes(blocked)) {
      return {
        valid: false,
        error: 'That password is too easy to guess. Choose something less common.'
      };
    }
  }

  if (COMMON_WEAK_PASSWORDS.has(lower)) {
    return {
      valid: false,
      error: 'That password is too easy to guess. Choose something less common.'
    };
  }

  // 8. Must not contain personal information (username, email prefix before @, pharmacy name)
  // Compare after lowercasing and removing spaces and punctuation. Skip any value shorter than 4 characters.
  const normalizedPassword = normalizeForComparison(password);
  const targetsToCheck = [];

  if (context && typeof context.username === 'string') {
    targetsToCheck.push(context.username);
  }

  if (context && typeof context.email === 'string') {
    const emailPrefix = context.email.split('@')[0];
    targetsToCheck.push(emailPrefix);
  }

  if (context && typeof context.pharmacyName === 'string') {
    targetsToCheck.push(context.pharmacyName);
  }

  for (const rawTarget of targetsToCheck) {
    const normalizedTarget = normalizeForComparison(rawTarget);
    if (normalizedTarget.length >= 4 && normalizedPassword.includes(normalizedTarget)) {
      return {
        valid: false,
        error: 'Password must not contain your username, email name or pharmacy name.'
      };
    }
  }

  return { valid: true };
}

