import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const indexCssPath = path.join(projectRoot, 'src', 'index.css');

/**
 * Splits comma-separated CSS selectors respecting nested parentheses (e.g., :where(...))
 */
function splitTopLevelSelectors(selectorStr) {
  const result = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < selectorStr.length; i++) {
    const ch = selectorStr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/**
 * Calculates W3C CSS selector specificity: [IDs (a), Classes/Attributes/Pseudo-classes (b), Elements/Pseudo-elements (c)]
 * :where(...) has zero specificity: [0, 0, 0]
 */
function calculateSpecificity(selector) {
  const cleaned = selector.trim();
  if (cleaned.startsWith(':where(') && cleaned.endsWith(')')) {
    return [0, 0, 0];
  }
  let a = 0, b = 0, c = 0;

  // IDs
  const ids = cleaned.match(/#[a-zA-Z0-9_-]+/g);
  if (ids) a += ids.length;

  // Classes
  const classes = cleaned.match(/\.[a-zA-Z0-9_\\-]+/g);
  if (classes) b += classes.length;

  // Attributes
  const attrs = cleaned.match(/\[[^\]]+\]/g);
  if (attrs) b += attrs.length;

  // Pseudo-classes (excluding pseudo-elements starting with ::)
  const pseudoClasses = cleaned.match(/(?<!:):[a-zA-Z0-9_-]+(?:\([^)]*\))?/g);
  if (pseudoClasses) {
    for (const pseudo of pseudoClasses) {
      if (!pseudo.startsWith('::')) {
        b += 1;
      }
    }
  }

  // Tags
  const tags = cleaned.match(/(?:^|[\s>+~])([a-zA-Z0-9_-]+)/g);
  if (tags) {
    for (const t of tags) {
      const tag = t.trim().replace(/^[\s>+~]+/, '');
      if (['input', 'select', 'textarea', 'button', 'div', 'span', 'p'].includes(tag)) {
        c += 1;
      }
    }
  }

  return [a, b, c];
}

/**
 * Compares two specificity vectors [a, b, c].
 * Returns 1 if specA > specB, -1 if specA < specB, 0 if equal.
 */
function compareSpecificity(specA, specB) {
  for (let i = 0; i < 3; i++) {
    if (specA[i] > specB[i]) return 1;
    if (specA[i] < specB[i]) return -1;
  }
  return 0;
}

async function compileCss() {
  const rawCss = fs.readFileSync(indexCssPath, 'utf8');
  return postcss([
    tailwindcss({
      content: [
        { raw: '<input type="text" class="input-bare" />' },
        { raw: '<input type="number" class="input-bare" />' },
        { raw: '<input type="password" class="input-bare" />' },
        { raw: '<input type="email" class="input-bare" />' }
      ]
    })
  ]).process(rawCss, { from: indexCssPath });
}

describe('PharmaCore input-bare Opt-Out & Double Box Elimination Suite', () => {
  // ─── 1. Compiled PostCSS & Tailwind Specificity & Styling ─────────────────
  describe('1. Compiled CSS Specificity & Properties (src/index.css)', () => {
    it('Base input-bare rule exists, zeroes chrome, and has strictly higher specificity than global input rule', async () => {
      const compiled = await compileCss();

      let globalChromeRule = null;
      let bareBaseRule = null;

      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input[type="text"]') && !rule.selector.includes('input-bare')) {
          const hasBorderRadius = rule.nodes?.some(d => d.prop === 'border-radius' && d.value === '0.375rem');
          const hasBgColor = rule.nodes?.some(d => d.prop === 'background-color' && d.value === '#F8FAFC');
          if (hasBorderRadius && hasBgColor) {
            globalChromeRule = rule;
          }
        }
        if (rule.selector.includes('input-bare') && !rule.selector.includes(':focus')) {
          bareBaseRule = rule;
        }
      });

      assert.ok(globalChromeRule, 'Must find global input chrome rule in compiled CSS');
      assert.ok(bareBaseRule, 'Must find input-bare base rule in compiled CSS');

      const globalSelectors = splitTopLevelSelectors(globalChromeRule.selector);
      const globalBaseSpec = calculateSpecificity(globalSelectors[0]);
      assert.deepEqual(globalBaseSpec, [0, 1, 1], 'Global input rule must have specificity [0, 1, 1]');

      const bareSelectors = splitTopLevelSelectors(bareBaseRule.selector);
      assert.ok(bareSelectors.length >= 4, 'input-bare base rule must contain selectors for text, number, password, and email');

      // Amendment 2: Every selector must be type-qualified and have strictly higher specificity than [0, 1, 1]
      for (const sel of bareSelectors) {
        assert.doesNotMatch(sel, /^input\.input-bare$/, 'Untyped selector input.input-bare must NOT be present');
        assert.doesNotMatch(sel, /^\.input-bare$/, 'Untyped selector .input-bare must NOT be present');
        assert.match(sel, /\[type=["']?(text|number|password|email)["']?\]/, `Selector "${sel}" must be type-qualified`);

        const selSpec = calculateSpecificity(sel);
        assert.equal(
          compareSpecificity(selSpec, globalBaseSpec),
          1,
          `Selector "${sel}" (${JSON.stringify(selSpec)}) must have strictly higher specificity than global rule (${JSON.stringify(globalBaseSpec)})`
        );
      }

      // Assert zeroed chrome properties
      const setsBorderWidthZero = bareBaseRule.nodes?.some(
        d => (d.prop === 'border-width' && (d.value === '0' || d.value === '0px')) ||
             (d.prop === 'border' && (d.value === '0' || d.value === 'none'))
      );
      const setsBgTransparent = bareBaseRule.nodes?.some(
        d => d.prop === 'background-color' && d.value === 'transparent'
      );
      const setsBorderRadiusZero = bareBaseRule.nodes?.some(
        d => d.prop === 'border-radius' && (d.value === '0' || d.value === '0px' || d.value === 'none')
      );
      const setsBoxShadowNone = bareBaseRule.nodes?.some(
        d => d.prop === 'box-shadow' && d.value === 'none'
      );

      assert.ok(setsBorderWidthZero, 'input-bare base rule must set border-width to 0 or border to none');
      assert.ok(setsBgTransparent, 'input-bare base rule must set background-color to transparent');
      assert.ok(setsBorderRadiusZero, 'input-bare base rule must set border-radius to 0');
      assert.ok(setsBoxShadowNone, 'input-bare base rule must set box-shadow to none');
    });

    it('Focus input-bare rule exists, suppresses focus chrome, and has strictly higher specificity than global focus rule', async () => {
      const compiled = await compileCss();

      let globalFocusRule = null;
      let bareFocusRule = null;

      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input:focus') && !rule.selector.includes('input-bare')) {
          globalFocusRule = rule;
        }
        if (rule.selector.includes('input-bare') && rule.selector.includes(':focus')) {
          bareFocusRule = rule;
        }
      });

      assert.ok(globalFocusRule, 'Must find global input:focus rule in compiled CSS');
      assert.ok(bareFocusRule, 'Must find input-bare:focus rule in compiled CSS');

      const globalFocusSelectors = splitTopLevelSelectors(globalFocusRule.selector);
      const globalFocusSpec = calculateSpecificity(globalFocusSelectors[0]);
      assert.deepEqual(globalFocusSpec, [0, 1, 1], 'Global input:focus rule must have specificity [0, 1, 1]');

      const bareFocusSelectors = splitTopLevelSelectors(bareFocusRule.selector);
      assert.ok(bareFocusSelectors.length >= 4, 'input-bare focus rule must contain selectors for text, number, password, and email');

      // Amendment 2: Every focus selector must be type-qualified and strictly beat [0, 1, 1]
      for (const sel of bareFocusSelectors) {
        assert.doesNotMatch(sel, /^input\.input-bare:focus$/, 'Untyped selector input.input-bare:focus must NOT be present');
        assert.doesNotMatch(sel, /^\.input-bare:focus$/, 'Untyped selector .input-bare:focus must NOT be present');
        assert.match(sel, /\[type=["']?(text|number|password|email)["']?\]/, `Focus selector "${sel}" must be type-qualified`);

        const selSpec = calculateSpecificity(sel);
        assert.equal(
          compareSpecificity(selSpec, globalFocusSpec),
          1,
          `Focus selector "${sel}" (${JSON.stringify(selSpec)}) must have strictly higher specificity than global focus rule (${JSON.stringify(globalFocusSpec)})`
        );
      }

      // Assert focus overrides
      const setsFocusBgTransparent = bareFocusRule.nodes?.some(
        d => d.prop === 'background-color' && d.value === 'transparent'
      );
      const setsFocusBorderTransparent = bareFocusRule.nodes?.some(
        d => d.prop === 'border-color' && d.value === 'transparent'
      );
      const setsFocusBoxShadowNone = bareFocusRule.nodes?.some(
        d => d.prop === 'box-shadow' && d.value === 'none'
      );

      assert.ok(setsFocusBgTransparent, 'input-bare:focus must set background-color to transparent');
      assert.ok(setsFocusBorderTransparent, 'input-bare:focus must set border-color to transparent');
      assert.ok(setsFocusBoxShadowNone, 'input-bare:focus must set box-shadow to none');
    });

    it('Global input chrome rule remains intact for plain inputs without input-bare', async () => {
      const compiled = await compileCss();

      let globalChromeRule = null;
      let globalFocusRule = null;

      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input[type="text"]') && !rule.selector.includes(':where(') && !rule.selector.includes('input-bare')) {
          globalChromeRule = rule;
        }
        if (rule.selector.includes('input:focus') && !rule.selector.includes('input-bare')) {
          globalFocusRule = rule;
        }
      });

      assert.ok(globalChromeRule, 'Global input chrome rule must be preserved');
      assert.ok(globalFocusRule, 'Global input:focus rule must be preserved');

      const hasBgColor = globalChromeRule.nodes?.some(d => d.prop === 'background-color' && d.value === '#F8FAFC');
      const hasBorderRadius = globalChromeRule.nodes?.some(d => d.prop === 'border-radius' && d.value === '0.375rem');
      const hasFocusGlow = globalFocusRule.nodes?.some(d => d.prop === 'box-shadow' && d.value === '0 0 0 3px var(--color-glow)');

      assert.ok(hasBgColor, 'Global rule must preserve background-color #F8FAFC for plain inputs');
      assert.ok(hasBorderRadius, 'Global rule must preserve rounded-md (0.375rem) for plain inputs');
      assert.ok(hasFocusGlow, 'Global focus rule must preserve 3px focus glow for plain inputs');
    });
  });

  // ─── 2. Structural AST Scan of Component Inputs ────────────────────────────
  describe('2. Structural AST Scan of Component Inputs (Structural Check Only)', () => {
    function getInputsWithClass(filePath) {
      const code = fs.readFileSync(path.resolve(filePath), 'utf-8');
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
      });

      const matchedInputs = [];
      traverse(ast, {
        JSXElement(p) {
          const tagName = p.node.openingElement.name.name;
          if (tagName === 'input' || tagName === 'NumberInput') {
            const classAttr = p.node.openingElement.attributes.find(
              a => a.name?.name === 'className'
            );
            if (classAttr) {
              let classVal = '';
              if (classAttr.value?.type === 'StringLiteral') {
                classVal = classAttr.value.value;
              } else if (classAttr.value?.type === 'JSXExpressionContainer') {
                if (classAttr.value.expression.type === 'StringLiteral') {
                  classVal = classAttr.value.expression.value;
                } else if (classAttr.value.expression.type === 'TemplateLiteral') {
                  classVal = classAttr.value.expression.quasis.map(q => q.value.raw).join(' ');
                }
              }
              if (classVal.split(/\s+/).includes('input-bare')) {
                matchedInputs.push({
                  tag: tagName,
                  line: p.node.loc?.start?.line,
                  className: classVal
                });
              }
            }
          }
        }
      });
      return matchedInputs;
    }

    it('Structural check: exactly 14 inputs across src/ carry input-bare, matching expected per-file counts', () => {
      const loginInputs = getInputsWithClass('src/components/LoginScreen.jsx');
      const onboardingInputs = getInputsWithClass('src/components/OnboardingScreen.jsx');
      const medicinesInputs = getInputsWithClass('src/components/MedicinesScreen.jsx');

      // Scan all other component files to ensure zero leakage
      const componentsDir = path.resolve('src/components');
      const allComponentFiles = fs.readdirSync(componentsDir).filter(f => f.endsWith('.jsx'));
      const otherFilesWithInputBare = [];

      for (const file of allComponentFiles) {
        if (['LoginScreen.jsx', 'OnboardingScreen.jsx', 'MedicinesScreen.jsx'].includes(file)) {
          continue;
        }
        const found = getInputsWithClass(path.join('src/components', file));
        if (found.length > 0) {
          otherFilesWithInputBare.push({ file, count: found.length });
        }
      }

      // Assertions with exact reporting
      assert.equal(
        loginInputs.length,
        4,
        `LoginScreen.jsx must have exactly 4 inputs with input-bare (found ${loginInputs.length})`
      );
      assert.equal(
        onboardingInputs.length,
        9,
        `OnboardingScreen.jsx must have exactly 9 inputs with input-bare (found ${onboardingInputs.length})`
      );
      assert.equal(
        medicinesInputs.length,
        1,
        `MedicinesScreen.jsx must have exactly 1 input with input-bare (found ${medicinesInputs.length})`
      );

      const total = loginInputs.length + onboardingInputs.length + medicinesInputs.length;
      assert.equal(
        total,
        14,
        `Total inputs across target files must be exactly 14 (found ${total})`
      );

      assert.deepEqual(
        otherFilesWithInputBare,
        [],
        `No other component files should have input-bare (found in: ${JSON.stringify(otherFilesWithInputBare)})`
      );
    });
  });

  // ─── 3. Three Break Attempts ───────────────────────────────────────────────
  describe('3. Three Break Attempts (Attack Your Own Work)', () => {
    it('Break attempt 1 (weakened real compiled selector attack): every compiled selector containing input-bare has strictly higher specificity than the global rule and contains no untyped selectors', async () => {
      // Amendment 3: Inspect the REAL compiled CSS output, not a hypothetical selector
      const compiled = await compileCss();

      const inputBareRules = [];
      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input-bare')) {
          inputBareRules.push(rule);
        }
      });

      assert.ok(inputBareRules.length > 0, 'Must find input-bare rules in the real compiled CSS');

      const globalBaseSpec = [0, 1, 1];
      const globalFocusSpec = [0, 1, 1];

      for (const rule of inputBareRules) {
        const selectors = splitTopLevelSelectors(rule.selector);
        for (const sel of selectors) {
          const spec = calculateSpecificity(sel);

          // Must strictly beat the global rule
          if (sel.includes(':focus')) {
            assert.equal(
              compareSpecificity(spec, globalFocusSpec),
              1,
              `Compiled focus selector "${sel}" (${JSON.stringify(spec)}) must strictly beat global focus rule (${JSON.stringify(globalFocusSpec)})`
            );
            assert.ok(
              spec[1] >= 3,
              `Compiled focus selector "${sel}" must have at least 3 classes/attrs/pseudos so it cannot tie with the global rule`
            );
          } else {
            assert.equal(
              compareSpecificity(spec, globalBaseSpec),
              1,
              `Compiled base selector "${sel}" (${JSON.stringify(spec)}) must strictly beat global base rule (${JSON.stringify(globalBaseSpec)})`
            );
            assert.ok(
              spec[1] >= 2,
              `Compiled base selector "${sel}" must have at least 2 classes/attrs so it cannot tie with the global rule`
            );
          }

          // Must not contain untyped selectors that rely on source order tiebreaks
          assert.doesNotMatch(
            sel,
            /(?:^|[\s,])input\.input-bare(?::focus)?(?:$|[\s,])/,
            `Selector "${sel}" must not contain untyped input.input-bare`
          );
          assert.doesNotMatch(
            sel,
            /(?:^|[\s,])\.input-bare(?::focus)?(?:$|[\s,])/,
            `Selector "${sel}" must not contain untyped .input-bare`
          );
        }
      }
    });

    it('Break attempt 2 (plain input regression attack): plain inputs without input-bare never match the opt-out rule and retain global background and border-radius', async () => {
      const compiled = await compileCss();

      // Verify that plain input selector input[type="text"] is untouched
      let globalTextRule = null;
      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input[type="text"]') && !rule.selector.includes(':where(') && !rule.selector.includes('input-bare')) {
          globalTextRule = rule;
        }
      });

      assert.ok(globalTextRule, 'Global input[type="text"] rule must exist');
      const selectors = splitTopLevelSelectors(globalTextRule.selector);
      assert.ok(selectors.includes('input[type="text"]'), 'input[type="text"] must be in global selectors');
      assert.ok(selectors.includes('input[type="number"]'), 'input[type="number"] must be in global selectors');
      assert.ok(selectors.includes('input[type="password"]'), 'input[type="password"] must be in global selectors');
      assert.ok(selectors.includes('input[type="email"]'), 'input[type="email"] must be in global selectors');

      // Plain input selector must not contain input-bare
      for (const sel of selectors) {
        assert.ok(!sel.includes('input-bare'), `Global selector "${sel}" must not include input-bare`);
      }
    });

    it('Break attempt 3 (focus ring clash attack): input-bare:focus explicitly zeroes box-shadow and border-color so wrapper focus ring is not doubled', async () => {
      const compiled = await compileCss();

      let bareFocusRule = null;
      compiled.root.walkRules(rule => {
        if (rule.selector.includes('input-bare') && rule.selector.includes(':focus')) {
          bareFocusRule = rule;
        }
      });

      assert.ok(bareFocusRule, 'Must find input-bare:focus rule in compiled CSS');

      const boxShadowDecl = bareFocusRule.nodes?.find(d => d.prop === 'box-shadow');
      const borderColorDecl = bareFocusRule.nodes?.find(d => d.prop === 'border-color');
      const bgDecl = bareFocusRule.nodes?.find(d => d.prop === 'background-color');

      assert.equal(boxShadowDecl?.value, 'none', 'input-bare:focus must explicitly set box-shadow: none to eliminate teal focus glow');
      assert.equal(borderColorDecl?.value, 'transparent', 'input-bare:focus must explicitly set border-color: transparent');
      assert.equal(bgDecl?.value, 'transparent', 'input-bare:focus must explicitly set background-color: transparent');
    });
  });
});
