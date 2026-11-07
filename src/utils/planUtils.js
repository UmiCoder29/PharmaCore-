/**
 * Unwraps the subscription plans response returned by the IPC handler (saas:get-plans).
 * Guarantees an array is returned in all cases (success, error, bare array, null, undefined).
 *
 * @param {any} response The IPC response from window.pharmacoreAPI.getSubscriptionPlans()
 * @returns {{ plans: Array, error: string | null }}
 */
export function unwrapPlansResponse(response) {
  if (!response) {
    return { plans: [], error: null };
  }

  if (Array.isArray(response)) {
    return { plans: response, error: null };
  }

  if (typeof response === 'object') {
    if (response.success === false) {
      return {
        plans: [],
        error: response.error || 'Failed to load subscription plans.'
      };
    }
    if (Array.isArray(response.data)) {
      return { plans: response.data, error: null };
    }
  }

  return { plans: [], error: null };
}
