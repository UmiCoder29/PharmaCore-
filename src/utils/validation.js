/**
 * PharmaCore Form Validation Utilities
 */

/**
 * Checks if the email is a valid format.
 * Allows empty strings (if email is optional), so check for emptiness separately if required.
 */
export function isValidEmail(email) {
  if (!email || email.trim() === '') return true; // Optional field behavior
  // Standard basic email regex
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(String(email).toLowerCase());
}

/**
 * Checks if the contact/phone number contains only allowed characters.
 * Allows digits, spaces, plus, dash, and parentheses. No letters.
 */
export function isValidPhone(phone) {
  if (!phone || phone.trim() === '') return true; // Optional field behavior
  // Allowed: digits, +, -, (, ), and space. No letters.
  const re = /^[0-9+\-() ]+$/;
  return re.test(String(phone));
}

/**
 * Checks if the input is a valid alphanumeric barcode (letters and numbers only, no special characters other than dash).
 */
export function isValidBarcode(barcode) {
  if (!barcode || barcode.trim() === '') return true; // Optional
  const re = /^[a-zA-Z0-9\-]+$/;
  return re.test(String(barcode));
}

/**
 * Validates a positive number (e.g. for prices, quantities).
 */
export function isPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  return !isNaN(num) && num >= 0;
}

/**
 * Validates a STRICTLY positive number (greater than zero).
 * Use this for prices, packaging units, and batch quantities where 0 is meaningless.
 * Use isPositiveNumber (>= 0) only for fields where 0 is a legitimate value (e.g. displayed stock counts).
 */
export function isStrictlyPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const num = Number(value);
  return !isNaN(num) && num > 0;
}
