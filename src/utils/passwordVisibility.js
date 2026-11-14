/**
 * Password Visibility State Logic for PharmaCore LoginScreen
 *
 * Pure reducer and state helpers for managing independent show/hide toggles
 * across sign-in, new password, and confirm password fields.
 * Contains no JSX and zero external dependencies.
 */

export const INITIAL_VISIBILITY = Object.freeze({
  signIn: false,
  newPassword: false,
  confirmPassword: false
});

/**
 * Pure reducer for password visibility state.
 *
 * - Toggling one field leaves the other two strictly unchanged.
 * - Resetting hides all three fields.
 * - Unknown actions or unknown field names leave state unchanged.
 *
 * @param {typeof INITIAL_VISIBILITY} state - Current visibility state
 * @param {{ type: 'toggle' | 'reset', field?: 'signIn' | 'newPassword' | 'confirmPassword' }} action
 * @returns {typeof INITIAL_VISIBILITY}
 */
export function passwordVisibilityReducer(state = INITIAL_VISIBILITY, action) {
  if (!action || typeof action !== 'object') {
    return state;
  }

  if (action.type === 'reset') {
    return {
      signIn: false,
      newPassword: false,
      confirmPassword: false
    };
  }

  if (action.type === 'toggle') {
    const field = action.field;
    if (field === 'signIn' || field === 'newPassword' || field === 'confirmPassword') {
      return {
        ...state,
        [field]: !state[field]
      };
    }
    // Unknown field name: return state unchanged
    return state;
  }

  // Unknown action type: return state unchanged
  return state;
}

