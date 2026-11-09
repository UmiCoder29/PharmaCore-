/**
 * Classification logic for auth.admin.createUser failures in provision-pharmacy Edge Function.
 *
 * Superadmin-only endpoint: Returning an explicit duplicate-email code here is safe because
 * this function is restricted to verified platform superadmins and is strictly rate-limited.
 * This allows the desktop admin UI to pinpoint the conflict and guide the superadmin without
 * generic guesswork. This does not apply to public (anon) endpoints where user enumeration must be prevented.
 */

export interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

export interface ClassifiedCreateUserError {
  isEmailTaken: boolean;
  httpStatus: number;
  code: string;
  error: string;
}

/**
 * Classifies an error returned by auth.admin.createUser().
 *
 * 1. Checks machine-readable error code: 'email_exists' or 'user_already_exists'.
 * 2. If code is absent, falls back to HTTP 422 combined with the known message substring "already been registered".
 * 3. All other errors (weak password, invalid arguments, network errors, undefined) are treated as generic failures.
 */
export function classifyCreateUserError(err: unknown): ClassifiedCreateUserError {
  if (!err || typeof err !== 'object') {
    return {
      isEmailTaken: false,
      httpStatus: 400,
      code: 'auth_user_failed',
      error: 'Unable to provision pharmacy with the provided information. Please verify input details and try again.'
    };
  }

  const e = err as AuthErrorLike;
  const code = typeof e.code === 'string' ? e.code.toLowerCase().trim() : '';
  const status = typeof e.status === 'number' ? e.status : 0;
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  // 1. Primary check: machine-readable code
  if (code === 'email_exists' || code === 'user_already_exists') {
    return {
      isEmailTaken: true,
      httpStatus: 409,
      code: 'email_taken',
      error: 'An account with this email address already exists.'
    };
  }

  // 2. Secondary fallback: status 422 with known duplicate message
  if (status === 422 && message.includes('already been registered')) {
    return {
      isEmailTaken: true,
      httpStatus: 409,
      code: 'email_taken',
      error: 'An account with this email address already exists.'
    };
  }

  // 3. Generic fallback: never leaks internal errors, tokens, or passwords
  return {
    isEmailTaken: false,
    httpStatus: 400,
    code: 'auth_user_failed',
    error: 'Unable to provision pharmacy with the provided information. Please verify input details and try again.'
  };
}

