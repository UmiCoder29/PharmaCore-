import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';
import { registerIpcHandlers } from '../electron/auth.js';

const traverse = traverseModule.default || traverseModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function parseJsxAst(source) {
  return parse(source, {
    sourceType: 'module',
    plugins: ['jsx']
  });
}

describe('PharmaCore Closed Public Pharmacy Self-Registration Suite', () => {

  describe('1. Sign-in Screen Closed Registration (LoginScreen.jsx & App.jsx)', () => {
    it('LoginScreen.jsx does not accept onSwitchToOnboarding prop and has no register button', () => {
      const source = readRepoFile('src/components/LoginScreen.jsx');
      const ast = parseJsxAst(source);

      // (a) Verify prop is not in function declaration parameters
      let foundOnboardingProp = false;
      traverse(ast, {
        FunctionDeclaration(p) {
          if (p.node.id && p.node.id.name === 'LoginScreen') {
            const firstParam = p.node.params[0];
            if (firstParam && firstParam.type === 'ObjectPattern') {
              for (const prop of firstParam.properties) {
                if (prop.key && prop.key.name === 'onSwitchToOnboarding') {
                  foundOnboardingProp = true;
                }
              }
            }
          }
        },
        ExportDefaultDeclaration(p) {
          const decl = p.node.declaration;
          if (decl && (decl.type === 'FunctionDeclaration' || decl.type === 'ArrowFunctionExpression')) {
            const firstParam = decl.params[0];
            if (firstParam && firstParam.type === 'ObjectPattern') {
              for (const prop of firstParam.properties) {
                if (prop.key && prop.key.name === 'onSwitchToOnboarding') {
                  foundOnboardingProp = true;
                }
              }
            }
          }
        }
      });

      assert.equal(
        foundOnboardingProp,
        false,
        'LoginScreen must not declare or accept the onSwitchToOnboarding prop'
      );

      // (b) Verify no button text or signup link exists in source
      assert.equal(
        source.includes('Register New Pharmacy & Start Free Trial'),
        false,
        'LoginScreen must not contain "Register New Pharmacy & Start Free Trial" button'
      );
      assert.equal(
        source.includes('Want to sell with PharmaCore at your pharmacy?'),
        false,
        'LoginScreen must not contain the public pharmacy registration divider text'
      );
    });

    it('App.jsx does not import or render OnboardingScreen and does not pass onSwitchToOnboarding', () => {
      const source = readRepoFile('src/App.jsx');
      const ast = parseJsxAst(source);

      // (a) App.jsx should not import OnboardingScreen
      let importsOnboarding = false;
      traverse(ast, {
        ImportDeclaration(p) {
          const val = p.node.source.value;
          if (val.includes('OnboardingScreen')) {
            importsOnboarding = true;
          }
        }
      });
      assert.equal(
        importsOnboarding,
        false,
        'App.jsx must not import OnboardingScreen'
      );

      // (b) App.jsx should not contain <OnboardingScreen> JSX element
      let rendersOnboardingElement = false;
      traverse(ast, {
        JSXElement(p) {
          const name = p.node.openingElement.name;
          if (name && name.name === 'OnboardingScreen') {
            rendersOnboardingElement = true;
          }
        }
      });
      assert.equal(
        rendersOnboardingElement,
        false,
        'App.jsx must not render <OnboardingScreen />'
      );

      // (c) App.jsx should not pass onSwitchToOnboarding prop to LoginScreen
      let passesPropToLogin = false;
      traverse(ast, {
        JSXElement(p) {
          const name = p.node.openingElement.name;
          if (name && name.name === 'LoginScreen') {
            for (const attr of p.node.openingElement.attributes) {
              if (attr.name && attr.name.name === 'onSwitchToOnboarding') {
                passesPropToLogin = true;
              }
            }
          }
        }
      });
      assert.equal(
        passesPropToLogin,
        false,
        'App.jsx must not pass onSwitchToOnboarding prop to LoginScreen'
      );
    });
  });

  describe('2. Preload API Surface Lockdown (preload.js)', () => {
    it('preload.js does not expose registerPharmacy or register on window.pharmacoreAPI', () => {
      const source = readRepoFile('preload.js');
      const ast = parse(source, { sourceType: 'module' });

      let exposedRegister = false;
      let exposedRegisterPharmacy = false;

      traverse(ast, {
        CallExpression(p) {
          if (
            p.node.callee &&
            p.node.callee.object &&
            p.node.callee.object.name === 'contextBridge' &&
            p.node.callee.property &&
            p.node.callee.property.name === 'exposeInMainWorld'
          ) {
            const apiKeyArg = p.node.arguments[0];
            const apiObjArg = p.node.arguments[1];
            if (apiKeyArg && (apiKeyArg.value === 'pharmacoreAPI' || apiKeyArg.value === 'api')) {
              if (apiObjArg && apiObjArg.type === 'ObjectExpression') {
                for (const prop of apiObjArg.properties) {
                  const keyName = prop.key?.name || prop.key?.value;
                  if (keyName === 'register') exposedRegister = true;
                  if (keyName === 'registerPharmacy') exposedRegisterPharmacy = true;
                }
              }
            }
          }
        }
      });

      assert.equal(
        exposedRegister,
        false,
        'preload.js must not expose register on window.pharmacoreAPI'
      );
      assert.equal(
        exposedRegisterPharmacy,
        false,
        'preload.js must not expose registerPharmacy on window.pharmacoreAPI'
      );

      // Also assert absence of invoke calls to the removed channels in preload source
      assert.equal(
        source.includes("'auth:register'"),
        false,
        'preload.js must not reference auth:register channel'
      );
      assert.equal(
        source.includes("'auth:register-pharmacy'"),
        false,
        'preload.js must not reference auth:register-pharmacy channel'
      );
    });
  });

  describe('3. Main Process IPC Channel Lockdown (electron/auth.js)', () => {
    it('electron/auth.js registerIpcHandlers does not register auth:register or auth:register-pharmacy', () => {
      const registeredChannels = [];
      const mockIpcMain = {
        handle: (channel) => {
          registeredChannels.push(channel);
        }
      };

      registerIpcHandlers(mockIpcMain);

      assert.equal(
        registeredChannels.includes('auth:register-pharmacy'),
        false,
        'electron/auth.js must not register auth:register-pharmacy IPC handler'
      );
      assert.equal(
        registeredChannels.includes('auth:register'),
        false,
        'electron/auth.js must not register auth:register IPC handler'
      );

      // Verify legitimate auth channels still register
      assert.equal(registeredChannels.includes('auth:login'), true, 'auth:login handler must remain registered');
      assert.equal(registeredChannels.includes('auth:logout'), true, 'auth:logout handler must remain registered');
      assert.equal(registeredChannels.includes('auth:change-password'), true, 'auth:change-password handler must remain registered');
    });

    it('electron/auth.js source contains no ipcMain.handle for auth:register or auth:register-pharmacy', () => {
      const source = readRepoFile('electron/auth.js');
      const ast = parse(source, { sourceType: 'module' });

      let registeredAuthRegister = false;
      let registeredAuthRegisterPharmacy = false;

      traverse(ast, {
        CallExpression(p) {
          if (
            p.node.callee &&
            p.node.callee.object &&
            p.node.callee.object.name === 'ipcMain' &&
            p.node.callee.property &&
            p.node.callee.property.name === 'handle'
          ) {
            const firstArg = p.node.arguments[0];
            if (firstArg && firstArg.type === 'StringLiteral') {
              if (firstArg.value === 'auth:register') registeredAuthRegister = true;
              if (firstArg.value === 'auth:register-pharmacy') registeredAuthRegisterPharmacy = true;
            }
          }
        }
      });

      assert.equal(registeredAuthRegister, false, 'auth.js AST must contain no handle for auth:register');
      assert.equal(registeredAuthRegisterPharmacy, false, 'auth.js AST must contain no handle for auth:register-pharmacy');
    });
  });

  describe('4. SuperAdmin Provisioning Guard (Regression Guard)', () => {
    it('saas:create-pharmacy still exists and calls requireSuperAdmin() before any parameter checking or tenant creation', () => {
      const source = readRepoFile('electron/api.js');
      const ast = parse(source, { sourceType: 'module' });

      let foundSaasCreatePharmacy = false;
      let callsRequireSuperAdminFirst = false;

      traverse(ast, {
        CallExpression(p) {
          if (
            p.node.callee &&
            p.node.callee.object &&
            p.node.callee.object.name === 'ipcMain' &&
            p.node.callee.property &&
            p.node.callee.property.name === 'handle'
          ) {
            const firstArg = p.node.arguments[0];
            if (firstArg && firstArg.value === 'saas:create-pharmacy') {
              foundSaasCreatePharmacy = true;
              const handlerFn = p.node.arguments[1];
              if (handlerFn && (handlerFn.type === 'ArrowFunctionExpression' || handlerFn.type === 'FunctionExpression')) {
                // Find try statement
                const body = handlerFn.body;
                if (body && body.type === 'BlockStatement') {
                  const firstStmt = body.body[0];
                  if (firstStmt && firstStmt.type === 'TryStatement') {
                    const tryBody = firstStmt.block.body;
                    const firstTryStmt = tryBody[0];
                    if (
                      firstTryStmt &&
                      firstTryStmt.type === 'ExpressionStatement' &&
                      firstTryStmt.expression.type === 'CallExpression' &&
                      firstTryStmt.expression.callee.name === 'requireSuperAdmin'
                    ) {
                      callsRequireSuperAdminFirst = true;
                    }
                  }
                }
              }
            }
          }
        }
      });

      assert.equal(foundSaasCreatePharmacy, true, 'saas:create-pharmacy IPC handler must exist');
      assert.equal(
        callsRequireSuperAdminFirst,
        true,
        'saas:create-pharmacy handler must execute requireSuperAdmin() as its very first statement in try block'
      );
    });

    it('electron/auth.js still exports registerPharmacy function for use by saas:create-pharmacy', () => {
      const source = readRepoFile('electron/auth.js');
      const ast = parse(source, { sourceType: 'module' });

      let exportsRegisterPharmacy = false;
      traverse(ast, {
        ExportNamedDeclaration(p) {
          if (p.node.declaration) {
            if (
              p.node.declaration.type === 'FunctionDeclaration' &&
              p.node.declaration.id &&
              p.node.declaration.id.name === 'registerPharmacy'
            ) {
              exportsRegisterPharmacy = true;
            }
          }
        }
      });

      assert.equal(exportsRegisterPharmacy, true, 'electron/auth.js must keep exported registerPharmacy function');
    });
  });

  describe('5. Attack Your Own Change (Renderer Isolation & Backdoor Prevention)', () => {
    it('Renderer bridge contains no exposed method that invokes auth:register or auth:register-pharmacy', () => {
      const source = readRepoFile('preload.js');
      assert.equal(
        source.includes('auth:register-pharmacy'),
        false,
        'preload.js must not invoke auth:register-pharmacy on any exposed bridge'
      );
      assert.equal(
        source.includes('auth:register'),
        false,
        'preload.js must not invoke auth:register on any exposed bridge'
      );
    });

    it('Regression guard: components other than the unreachable OnboardingScreen.jsx do not call registerPharmacy or register', () => {
      // Exclude OnboardingScreen.jsx which is deliberately orphaned/unreachable
      const srcFiles = fs.readdirSync(path.join(ROOT, 'src', 'components'))
        .filter(f => f.endsWith('.jsx') && f !== 'OnboardingScreen.jsx');

      for (const file of srcFiles) {
        const content = readRepoFile(path.join('src', 'components', file));
        assert.equal(
          content.includes('.registerPharmacy('),
          false,
          `Active component ${file} must not call registerPharmacy`
        );
        assert.equal(
          content.includes('.register('),
          false,
          `Active component ${file} must not call register`
        );
      }
    });
  });
});

