import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

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
 * Calculates W3C CSS selector specificity: [IDs, Classes/Attributes/Pseudo-classes, Elements]
 * :where(...) has zero specificity: [0, 0, 0]
 */
function calculateSpecificity(selector) {
  const cleaned = selector.trim();
  if (cleaned.startsWith(':where(') && cleaned.endsWith(')')) {
    return [0, 0, 0];
  }
  let a = 0, b = 0, c = 0;
  const ids = cleaned.match(/#[a-zA-Z0-9_-]+/g);
  if (ids) a += ids.length;
  const classes = cleaned.match(/\.[a-zA-Z0-9_\\-]+/g);
  if (classes) b += classes.length;
  const attrs = cleaned.match(/\[[^\]]+\]/g);
  if (attrs) b += attrs.length;
  const tags = cleaned.match(/(?:^|[\s>+~])([a-zA-Z0-9_-]+)/g);
  if (tags) {
    for (const t of tags) {
      const tag = t.trim();
      if (['input', 'select', 'textarea', 'button', 'div', 'span', 'p'].includes(tag)) {
        c += 1;
      }
    }
  }
  return [a, b, c];
}

/**
 * Returns 1 if specA > specB, -1 if specA < specB, 0 if equal.
 */
function compareSpecificity(specA, specB) {
  for (let i = 0; i < 3; i++) {
    if (specA[i] > specB[i]) return 1;
    if (specA[i] < specB[i]) return -1;
  }
  return 0;
}

test('Global input padding specificity in real src/index.css allows utility classes to override', async () => {
  // Read and compile the real src/index.css with tailwindcss
  const rawCss = fs.readFileSync(indexCssPath, 'utf8');
  const compiled = await postcss([
    tailwindcss({
      content: [{ raw: '<input type="text" class="pl-10" />' }]
    })
  ]).process(rawCss, { from: indexCssPath });

  let defaultPaddingRule = null;
  let pl10Rule = null;
  let defaultPaddingIndex = -1;
  let pl10Index = -1;

  let ruleIndex = 0;
  compiled.root.walkRules(rule => {
    ruleIndex++;
    if (rule.selector.includes('input[type="text"]') || rule.selector.includes(':where(')) {
      const setsPaddingLeft = rule.nodes?.some(d => d.prop === 'padding-left' && d.value === '0.75rem');
      if (setsPaddingLeft) {
        defaultPaddingRule = rule;
        defaultPaddingIndex = ruleIndex;
      }
    }
    if (rule.selector === '.pl-10') {
      pl10Rule = rule;
      pl10Index = ruleIndex;
    }
  });

  assert.ok(defaultPaddingRule, 'Must find default input padding rule in compiled CSS');
  assert.ok(pl10Rule, 'Must find .pl-10 utility rule in compiled CSS');

  const topSelectors = splitTopLevelSelectors(defaultPaddingRule.selector);
  const defaultPaddingSelector = topSelectors[0];
  const paddingSpec = calculateSpecificity(defaultPaddingSelector);
  const pl10Spec = calculateSpecificity(pl10Rule.selector);

  // Assert default form input padding is zero specificity (0, 0, 0) via :where(...)
  assert.deepEqual(
    paddingSpec,
    [0, 0, 0],
    `Default input padding selector "${defaultPaddingSelector}" must have specificity [0, 0, 0] so utility classes win`
  );

  // Assert .pl-10 has higher specificity than default input padding
  assert.equal(
    compareSpecificity(pl10Spec, paddingSpec),
    1,
    `Utility class .pl-10 (${JSON.stringify(pl10Spec)}) must override default padding rule (${JSON.stringify(paddingSpec)})`
  );

  // Assert stylesheet ordering (.pl-10 in utilities appears after base/components)
  assert.ok(
    pl10Index > defaultPaddingIndex,
    `Utility class .pl-10 (rule #${pl10Index}) must appear after default padding (rule #${defaultPaddingIndex}) in stylesheet order`
  );
});

test('Base input chrome retains specificity [0, 1, 1] to keep plain input styling stable', async () => {
  const rawCss = fs.readFileSync(indexCssPath, 'utf8');
  const compiled = await postcss([
    tailwindcss({
      content: [{ raw: '<input type="text" class="pl-10" />' }]
    })
  ]).process(rawCss, { from: indexCssPath });

  let chromeRule = null;
  compiled.root.walkRules(rule => {
    if (rule.selector.includes('input[type="text"]')) {
      const hasBorderRadius = rule.nodes?.some(d => d.prop === 'border-radius' && d.value === '0.375rem');
      const hasBgColor = rule.nodes?.some(d => d.prop === 'background-color' && d.value === '#F8FAFC');
      if (hasBorderRadius && hasBgColor) {
        chromeRule = rule;
      }
    }
  });

  assert.ok(chromeRule, 'Must find base input chrome rule with rounded-md and #F8FAFC');
  const topSelectors = splitTopLevelSelectors(chromeRule.selector);
  const chromeSelector = topSelectors[0];
  const chromeSpec = calculateSpecificity(chromeSelector);

  // Chrome properties remain on input[type="text"] with specificity [0, 1, 1]
  assert.deepEqual(chromeSpec, [0, 1, 1], 'Chrome rule must retain [0, 1, 1] specificity');
});
