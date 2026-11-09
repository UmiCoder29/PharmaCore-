import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const saasAdminPath = path.join(projectRoot, 'src', 'components', 'SaasAdminScreen.jsx');

describe('Provision Modal Error Display Structural & Behavior Tests', () => {
  it('Structural check: SaasAdminScreen renders in-modal role="alert" error box (structural check; does not prove runtime pixel layout)', () => {
    const code = fs.readFileSync(saasAdminPath, 'utf8');

    // Structural check that does not prove runtime pixel layout:
    // Confirms SaasAdminScreen declares an in-modal error box with role="alert"
    // rather than relying only on page-level toast notifications behind modal backdrop
    assert.match(
      code,
      /role=["']alert["']/,
      'SaasAdminScreen must declare an accessible in-modal error box with role="alert"'
    );
    assert.match(
      code,
      /modalError/,
      'SaasAdminScreen must maintain in-modal error state (modalError)'
    );
  });

  it('Structural check: Owner email input is marked with error border and inline message (structural check; does not prove runtime pixel layout)', () => {
    const code = fs.readFileSync(saasAdminPath, 'utf8');

    // Structural check: Confirms the email input displays an error border and inline helper text
    assert.match(
      code,
      /border-rose-500/,
      'Owner email field must be styled with border-rose-500 when duplicate email conflict occurs'
    );
    assert.match(
      code,
      /fieldErrors/,
      'SaasAdminScreen must maintain field-level error state (fieldErrors)'
    );
  });

  it('Break attempt 3 (structural check): SaasAdminScreen renders modalError without dangerouslySetInnerHTML to prevent XSS injection', () => {
    const code = fs.readFileSync(saasAdminPath, 'utf8');

    // Structural check: Confirms dangerouslySetInnerHTML is not used for modalError or fieldErrors
    assert.doesNotMatch(
      code,
      /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*(modalError|fieldErrors)/,
      'modalError and fieldErrors must never be injected via dangerouslySetInnerHTML'
    );
    assert.match(
      code,
      /\{modalError\}/,
      'modalError must be rendered as a safe JSX child expression'
    );
  });
});

