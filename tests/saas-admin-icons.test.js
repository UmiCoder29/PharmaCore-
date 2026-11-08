import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { scanSource } from '../scripts/scan-undefined-identifiers.mjs';

describe('SaasAdminScreen Icons & Undefined Identifiers', () => {
  it('verifies SaasAdminScreen.jsx has no undefined identifiers or unimported JSX elements', () => {
    const filePath = path.resolve('src/components/SaasAdminScreen.jsx');
    const code = fs.readFileSync(filePath, 'utf-8');
    const issues = scanSource(code, 'src/components/SaasAdminScreen.jsx');

    assert.deepEqual(
      issues,
      [],
      `Expected zero undefined identifiers in SaasAdminScreen.jsx, but found: ${JSON.stringify(issues)}`
    );
  });
});

