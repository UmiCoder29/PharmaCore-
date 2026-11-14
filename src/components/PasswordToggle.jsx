import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

/**
 * Reusable Show/Hide Password Eye Button
 *
 * Placed inside the input wrapper div on the right as a normal flex child.
 * Compensates internal button padding with -mr-1.5 so the 16px eye icon
 * aligns exactly 16px from the wrapper edge, matching the left icon.
 */
export default function PasswordToggle({
  isVisible,
  onToggle,
  disabled = false,
  inputRef,
  className = ''
}) {
  const handleClick = (e) => {
    // Stop propagation so clicking the button never triggers parent <label> default activation
    e.stopPropagation();

    if (disabled || typeof onToggle !== 'function') return;

    // Capture cursor selection range before toggle
    const input = inputRef?.current;
    const start = input ? input.selectionStart : null;
    const end = input ? input.selectionEnd : null;

    onToggle();

    // Restore cursor position if input was active
    if (input && start !== null && end !== null && typeof input.setSelectionRange === 'function') {
      requestAnimationFrame(() => {
        try {
          input.setSelectionRange(start, end);
        } catch {
          // Ignore if input type change momentarily disallows setSelectionRange
        }
      });
    }
  };

  const handleMouseDown = (e) => {
    // Prevent mouse click from stealing focus from the input element
    e.preventDefault();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseDown={handleMouseDown}
      disabled={disabled}
      aria-label={isVisible ? 'Hide password' : 'Show password'}
      aria-pressed={isVisible}
      tabIndex={0}
      className={`ml-2 -mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink/40 transition-colors hover:text-emerald focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald/40 focus-visible:text-emerald disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {isVisible ? (
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Eye className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  );
}

