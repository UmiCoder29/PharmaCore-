import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import { scanSource } from '../scripts/scan-undefined-identifiers.mjs';

describe('Undefined Identifier & JSX Element Scanner Tests', () => {
  describe('Scanner Fixture Tests: Detecting Unimported JSX Elements', () => {
    it('reports unimported standalone JSX component element', () => {
      const code = `
        import React from 'react';
        export function Sample() {
          return <UnimportedIcon className="w-4 h-4" />;
        }
      `;
      const issues = scanSource(code, 'Sample.jsx');
      assert.equal(issues.length, 1);
      assert.equal(issues[0].name, 'UnimportedIcon');
      assert.equal(issues[0].line, 4);
    });

    it('reports unimported member-expression root tag regardless of case (e.g. motion in <motion.div>)', () => {
      const code = `
        import React from 'react';
        export function AnimatedCard() {
          return (
            <motion.div animate={{ opacity: 1 }}>
              <Icons.CustomWidget />
            </motion.div>
          );
        }
      `;
      const issues = scanSource(code, 'AnimatedCard.jsx');
      assert.equal(issues.length, 2);
      assert.equal(issues[0].name, 'motion');
      assert.equal(issues[1].name, 'Icons');
    });
  });

  describe('Scanner False-Positive Guards', () => {
    it('does NOT report native lowercase HTML or SVG tags', () => {
      const code = `
        import React from 'react';
        export function Form() {
          return (
            <div className="container">
              <span id="title">Hello</span>
              <input type="text" defaultValue="test" />
              <select><option value="1">1</option></select>
              <button type="submit">Submit</button>
              <svg><path d="M0 0" /></svg>
            </div>
          );
        }
      `;
      const issues = scanSource(code, 'Form.jsx');
      assert.deepEqual(issues, [], 'Native lowercase HTML/SVG tags must never be reported');
    });

    it('does NOT report React.Fragment or empty <> fragments', () => {
      const code = `
        import React from 'react';
        export function Fragments() {
          return (
            <>
              <React.Fragment>
                <div>Fragment content</div>
              </React.Fragment>
            </>
          );
        }
      `;
      const issues = scanSource(code, 'Fragments.jsx');
      assert.deepEqual(issues, [], 'Fragments must never be reported');
    });

    it('does NOT report namespace imported components (import * as Icons)', () => {
      const code = `
        import React from 'react';
        import * as Icons from 'lucide-react';
        export function Card() {
          return (
            <div>
              <Icons.Building2 className="w-4 h-4" />
              <Icons.Check className="w-4 h-4" />
            </div>
          );
        }
      `;
      const issues = scanSource(code, 'Card.jsx');
      assert.deepEqual(issues, [], 'Imported namespace member expressions must never be reported');
    });

    it('does NOT report components defined in the same file', () => {
      const code = `
        import React from 'react';

        function LocalHeader({ title }) {
          return <h1>{title}</h1>;
        }

        const LocalFooter = () => <footer>Footer</footer>;

        export function Page() {
          return (
            <div>
              <LocalHeader title="Test" />
              <LocalFooter />
            </div>
          );
        }
      `;
      const issues = scanSource(code, 'Page.jsx');
      assert.deepEqual(issues, [], 'Components defined in scope within the same file must never be reported');
    });
  });

  describe('SaasAdminScreen.jsx Undefined JSX Element Verification', () => {
    it('detects unimported Building icon in SaasAdminScreen.jsx if present', () => {
      const filePath = path.resolve('src/components/SaasAdminScreen.jsx');
      const code = fs.readFileSync(filePath, 'utf-8');
      const issues = scanSource(code, 'src/components/SaasAdminScreen.jsx');

      // The pre-fix code contains <Building /> at line 928.
      // Once fixed with <Building2 />, issues must be empty.
      const buildingIssues = issues.filter(i => i.name === 'Building');
      const isFixed = !code.includes('<Building ');

      if (isFixed) {
        assert.equal(buildingIssues.length, 0, 'Building should not be reported once replaced with Building2');
      } else {
        assert.equal(buildingIssues.length, 1, 'Building should be reported on pre-fix code');
        assert.equal(buildingIssues[0].line, 928);
      }
    });
  });
});

