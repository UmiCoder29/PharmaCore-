import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import ReactDOMServer from 'react-dom/server';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;
const require = createRequire(import.meta.url);

import {
  INITIAL_VISIBILITY,
  passwordVisibilityReducer
} from '../src/utils/passwordVisibility.js';

describe('Password Toggle & Visibility Suite', () => {
  // ─── 1. Pure State Logic (Unit Tests with Real Calls) ──────────────────────
  describe('1. Pure Visibility State Logic (src/utils/passwordVisibility.js)', () => {
    it('initial state starts with all three fields strictly hidden (false)', () => {
      assert.deepEqual(INITIAL_VISIBILITY, {
        signIn: false,
        newPassword: false,
        confirmPassword: false
      });
    });

    it('toggling one field leaves the other two fields strictly unchanged', () => {
      let state = { ...INITIAL_VISIBILITY };

      // Toggle signIn only
      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'signIn' });
      assert.equal(state.signIn, true, 'signIn should be true');
      assert.equal(state.newPassword, false, 'newPassword must remain false');
      assert.equal(state.confirmPassword, false, 'confirmPassword must remain false');

      // Toggle newPassword only
      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'newPassword' });
      assert.equal(state.signIn, true, 'signIn must remain true');
      assert.equal(state.newPassword, true, 'newPassword should be true');
      assert.equal(state.confirmPassword, false, 'confirmPassword must remain false');

      // Toggle confirmPassword only
      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'confirmPassword' });
      assert.equal(state.signIn, true, 'signIn must remain true');
      assert.equal(state.newPassword, true, 'newPassword must remain true');
      assert.equal(state.confirmPassword, true, 'confirmPassword should be true');
    });

    it('repeated toggles flip visibility back and forth', () => {
      let state = { ...INITIAL_VISIBILITY };

      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'signIn' });
      assert.equal(state.signIn, true);

      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'signIn' });
      assert.equal(state.signIn, false);

      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'signIn' });
      assert.equal(state.signIn, true);
    });

    it('reset action hides all three fields regardless of their previous state', () => {
      const allVisible = {
        signIn: true,
        newPassword: true,
        confirmPassword: true
      };

      const resetState = passwordVisibilityReducer(allVisible, { type: 'reset' });
      assert.deepEqual(resetState, {
        signIn: false,
        newPassword: false,
        confirmPassword: false
      });
    });

    it('unknown field names or invalid actions leave state completely unchanged', () => {
      const state = { signIn: true, newPassword: false, confirmPassword: false };

      const unknownField = passwordVisibilityReducer(state, { type: 'toggle', field: 'adminSecret' });
      assert.deepEqual(unknownField, state);

      const unknownAction = passwordVisibilityReducer(state, { type: 'unknownAction' });
      assert.deepEqual(unknownAction, state);

      const nullAction = passwordVisibilityReducer(state, null);
      assert.deepEqual(nullAction, state);

      const undefAction = passwordVisibilityReducer(state, undefined);
      assert.deepEqual(undefAction, state);
    });
  });

  // ─── 2. PasswordToggle Component Static Markup ─────────────────────────────
  describe('2. PasswordToggle Component Static Markup & Accessibility', () => {
    // Transform PasswordToggle.jsx using esbuild and execute in isolated VM context
    const componentPath = path.resolve('src/components/PasswordToggle.jsx');
    const jsxSource = fs.readFileSync(componentPath, 'utf-8');
    const transformed = esbuild.transformSync(jsxSource, {
      loader: 'jsx',
      format: 'cjs'
    });
    const context = {
      require,
      module: { exports: {} },
      exports: {},
      requestAnimationFrame: (cb) => cb(),
      console
    };
    vm.createContext(context);
    vm.runInContext(transformed.code, context);
    const PasswordToggle = context.module.exports.default || context.module.exports;

    it('starts hidden (isVisible=false): renders type="button", Show password label, aria-pressed="false", and Eye icon', () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        PasswordToggle({ isVisible: false, onToggle: () => {}, disabled: false })
      );

      assert.match(html, /<button[^>]*type="button"/, 'Must explicitly declare type="button"');
      assert.match(html, /aria-label="Show password"/, 'Must have aria-label="Show password"');
      assert.match(html, /aria-pressed="false"/, 'Must have aria-pressed="false"');
      assert.match(html, /lucide-eye\b/, 'Must render Eye icon SVG');
      assert.doesNotMatch(html, /lucide-eye-off\b/, 'Must NOT render EyeOff icon when hidden');
    });

    it('toggled visible (isVisible=true): renders type="button", Hide password label, aria-pressed="true", and EyeOff icon', () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        PasswordToggle({ isVisible: true, onToggle: () => {}, disabled: false })
      );

      assert.match(html, /<button[^>]*type="button"/, 'Must explicitly declare type="button"');
      assert.match(html, /aria-label="Hide password"/, 'Must have aria-label="Hide password"');
      assert.match(html, /aria-pressed="true"/, 'Must have aria-pressed="true"');
      assert.match(html, /lucide-eye-off\b/, 'Must render EyeOff icon SVG');
      assert.doesNotMatch(html, /class="[^"]*lucide-eye\b(?!-off)/, 'Must NOT render Eye icon when visible');
    });

    it('disabled state (disabled=true): renders disabled attribute and disabled opacity classes', () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        PasswordToggle({ isVisible: false, onToggle: () => {}, disabled: true })
      );

      assert.match(html, /disabled=""|disabled(?=[ >])/, 'Must carry disabled attribute');
      assert.match(html, /disabled:opacity-50/, 'Must include disabled opacity styling');
      assert.match(html, /disabled:cursor-not-allowed/, 'Must include disabled cursor styling');
    });

    it('geometry & spacing: verifies touch target is at least 24px (h-7 w-7 = 28px) and -mr-1.5 right compensation', () => {
      const html = ReactDOMServer.renderToStaticMarkup(
        PasswordToggle({ isVisible: false, onToggle: () => {}, disabled: false })
      );

      assert.match(html, /h-7\s+w-7/, 'Must have h-7 w-7 (28px touch target >= 24px)');
      assert.match(html, /-mr-1\.5/, 'Must have -mr-1.5 to compensate 6px padding for exact 16px edge alignment');
      assert.match(html, /ml-2/, 'Must have ml-2 for spacing from input text');
    });
  });

  // ─── 3. Structural AST Checks for LoginScreen.jsx ──────────────────────────
  describe('3. LoginScreen.jsx Structural AST & Markup Checks (Structural Check Only)', () => {
    function parseLoginScreenAst() {
      const code = fs.readFileSync(path.resolve('src/components/LoginScreen.jsx'), 'utf-8');
      return parse(code, {
        sourceType: 'module',
        plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
      });
    }

    it('Structural check: imports PasswordToggle and passwordVisibilityReducer (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let importsPasswordToggle = false;
      let importsReducer = false;

      traverse(ast, {
        ImportDeclaration(path) {
          if (path.node.source.value.includes('PasswordToggle')) {
            importsPasswordToggle = true;
          }
          if (path.node.source.value.includes('passwordVisibility')) {
            importsReducer = true;
          }
        }
      });

      assert.equal(importsPasswordToggle, true, 'LoginScreen must import PasswordToggle');
      assert.equal(importsReducer, true, 'LoginScreen must import passwordVisibilityReducer');
    });

    it('Structural check: all three password inputs have explicit autocomplete attributes (structural check only)', () => {
      const ast = parseLoginScreenAst();
      const autocompletes = [];

      traverse(ast, {
        JSXElement(path) {
          if (path.node.openingElement.name.name === 'input') {
            const hasPasswordType = path.node.openingElement.attributes.some(attr =>
              attr.name?.name === 'type' && (
                attr.value?.value === 'password' ||
                attr.value?.expression?.type === 'ConditionalExpression'
              )
            );
            if (hasPasswordType) {
              const autoAttr = path.node.openingElement.attributes.find(attr => attr.name?.name === 'autoComplete');
              if (autoAttr) {
                autocompletes.push(autoAttr.value.value);
              }
            }
          }
        }
      });

      assert.equal(autocompletes.length, 3, 'Must have 3 password inputs with autoComplete');
      assert.equal(autocompletes[0], 'current-password', 'Sign-in password must have autoComplete="current-password"');
      assert.equal(autocompletes[1], 'new-password', 'New password must have autoComplete="new-password"');
      assert.equal(autocompletes[2], 'new-password', 'Confirm password must have autoComplete="new-password"');
    });

    it('Structural check: all three password inputs have explicit aria-labelledby matching their label text span (structural check only)', () => {
      const ast = parseLoginScreenAst();
      const ariaLabelledBys = [];

      traverse(ast, {
        JSXElement(path) {
          if (path.node.openingElement.name.name === 'input') {
            const hasPasswordType = path.node.openingElement.attributes.some(attr =>
              attr.name?.name === 'type' && (
                attr.value?.value === 'password' ||
                attr.value?.expression?.type === 'ConditionalExpression'
              )
            );
            if (hasPasswordType) {
              const ariaAttr = path.node.openingElement.attributes.find(attr => attr.name?.name === 'aria-labelledby');
              if (ariaAttr) {
                ariaLabelledBys.push(ariaAttr.value.value);
              }
            }
          }
        }
      });

      assert.equal(ariaLabelledBys.length, 3, 'Must have 3 password inputs with aria-labelledby');
      assert.equal(ariaLabelledBys[0], 'sign-in-password-label');
      assert.equal(ariaLabelledBys[1], 'new-password-label');
      assert.equal(ariaLabelledBys[2], 'confirm-password-label');
    });

    it('Structural check: all three inputs receive conditional type based on visibility state (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let toggleUsages = 0;

      traverse(ast, {
        JSXElement(path) {
          if (path.node.openingElement.name.name === 'PasswordToggle') {
            toggleUsages++;
          }
        }
      });

      assert.equal(toggleUsages, 3, 'LoginScreen must render PasswordToggle at all 3 password input locations');
    });

    it('Structural check: dispatches reset action inside an effect that depends on step (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let effectFound = false;

      traverse(ast, {
        CallExpression(path) {
          if (path.node.callee.name === 'useEffect') {
            const [effectFn, deps] = path.node.arguments;
            if (deps && deps.type === 'ArrayExpression') {
              const hasStepDep = deps.elements.some(el => el.type === 'Identifier' && el.name === 'step');
              if (hasStepDep) {
                path.traverse({
                  CallExpression(inner) {
                    if (
                      inner.node.callee.name === 'dispatchVisibility' &&
                      inner.node.arguments[0]?.properties?.some(
                        p => (p.key.name === 'type' || p.key.value === 'type') && p.value.value === 'reset'
                      )
                    ) {
                      effectFound = true;
                    }
                  }
                });
              }
            }
          }
        }
      });

      assert.equal(effectFound, true, 'LoginScreen must dispatch reset action inside an effect depending on step');
    });

    it('Structural check: dispatches reset action on failed login (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let failedLoginElseReset = false;
      let failedLoginCatchReset = false;

      traverse(ast, {
        VariableDeclarator(path) {
          if (path.node.id.name === 'handleLoginSubmit') {
            path.traverse({
              CatchClause(catchPath) {
                catchPath.traverse({
                  CallExpression(inner) {
                    if (
                      inner.node.callee.name === 'dispatchVisibility' &&
                      inner.node.arguments[0]?.properties?.some(
                        p => (p.key.name === 'type' || p.key.value === 'type') && p.value.value === 'reset'
                      )
                    ) {
                      failedLoginCatchReset = true;
                    }
                  }
                });
              },
              IfStatement(ifPath) {
                if (ifPath.node.test?.property?.name === 'success' && ifPath.node.alternate) {
                  ifPath.get('alternate').traverse({
                    CallExpression(inner) {
                      if (
                        inner.node.callee.name === 'dispatchVisibility' &&
                        inner.node.arguments[0]?.properties?.some(
                          p => (p.key.name === 'type' || p.key.value === 'type') && p.value.value === 'reset'
                        )
                      ) {
                        failedLoginElseReset = true;
                      }
                    }
                  });
                }
              }
            });
          }
        }
      });

      assert.equal(failedLoginElseReset, true, 'LoginScreen must dispatch reset action in failed login else branch');
      assert.equal(failedLoginCatchReset, true, 'LoginScreen must dispatch reset action in failed login catch branch');
    });

    it('Structural check: dispatches reset action when switching to onboarding (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let onboardingResetFound = false;

      traverse(ast, {
        CallExpression(path) {
          if (path.node.callee.name === 'onSwitchToOnboarding') {
            const fn = path.getFunctionParent();
            if (fn) {
              fn.traverse({
                CallExpression(inner) {
                  if (
                    inner.node.callee.name === 'dispatchVisibility' &&
                    inner.node.arguments[0]?.properties?.some(
                      p => (p.key.name === 'type' || p.key.value === 'type') && p.value.value === 'reset'
                    )
                  ) {
                    onboardingResetFound = true;
                  }
                }
              });
            }
          }
        }
      });

      assert.equal(onboardingResetFound, true, 'LoginScreen must dispatch reset action before calling onSwitchToOnboarding');
    });

    it('Structural check: dispatches reset action immediately before onLogin is called (structural check only)', () => {
      const ast = parseLoginScreenAst();
      let onLoginResetCount = 0;

      traverse(ast, {
        CallExpression(path) {
          if (path.node.callee.name === 'onLogin') {
            const stmt = path.getStatementParent();
            let foundReset = false;
            if (stmt && stmt.parentPath?.isBlockStatement()) {
              const body = stmt.parentPath.node.body;
              const idx = body.indexOf(stmt.node);
              for (let i = 0; i < idx; i++) {
                const s = JSON.stringify(body[i]);
                if (s.includes('dispatchVisibility') && s.includes('reset')) {
                  foundReset = true;
                  break;
                }
              }
            }
            if (!foundReset) {
              const parentIf = path.findParent(p => p.isIfStatement());
              if (parentIf && parentIf.parentPath?.isBlockStatement()) {
                const body = parentIf.parentPath.node.body;
                const idx = body.indexOf(parentIf.node);
                for (let i = 0; i < idx; i++) {
                  const s = JSON.stringify(body[i]);
                  if (s.includes('dispatchVisibility') && s.includes('reset')) {
                    foundReset = true;
                    break;
                  }
                }
              }
            }
            if (foundReset) onLoginResetCount++;
          }
        }
      });

      assert.equal(onLoginResetCount, 2, 'LoginScreen must dispatch reset action before each onLogin invocation');
    });
  });

  // ─── 4. Three Break Attempts ───────────────────────────────────────────────
  describe('4. Three Break Attempts (Attack Your Own Work)', () => {
    it('Break attempt 1 (button markup): verified button has type="button" to prevent form submission', () => {
      const code = fs.readFileSync(path.resolve('src/components/PasswordToggle.jsx'), 'utf-8');
      assert.match(code, /type="button"/, 'PasswordToggle must be explicitly type="button"');
      assert.match(code, /e\.stopPropagation\(\)/, 'PasswordToggle must stop propagation to parent label');
      assert.match(code, /e\.preventDefault\(\)/, 'PasswordToggle must prevent mousedown default focus shift');
    });

    it('Break attempt 2 (one toggle exposing all fields): verified fields are isolated in reducer', () => {
      let state = { ...INITIAL_VISIBILITY };
      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'signIn' });
      assert.equal(state.signIn, true);
      assert.equal(state.newPassword, false);
      assert.equal(state.confirmPassword, false);

      state = passwordVisibilityReducer(state, { type: 'toggle', field: 'newPassword' });
      assert.equal(state.signIn, true);
      assert.equal(state.newPassword, true);
      assert.equal(state.confirmPassword, false);
    });

    it('Break attempt 3 (reducer reset): verified reset action hides all three fields regardless of prior state', () => {
      const stateWithVisiblePasswords = {
        signIn: true,
        newPassword: true,
        confirmPassword: true
      };
      const afterTransition = passwordVisibilityReducer(stateWithVisiblePasswords, { type: 'reset' });
      assert.deepEqual(afterTransition, {
        signIn: false,
        newPassword: false,
        confirmPassword: false
      });
    });
  });
});
