import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

export const KNOWN_GLOBALS = new Set([
  'window', 'document', 'console', 'setTimeout', 'setInterval', 'clearInterval', 'clearTimeout',
  'Date', 'Math', 'JSON', 'Promise', 'FileReader', 'URL', 'alert', 'confirm', 'prompt',
  'parseFloat', 'parseInt', 'isNaN', 'isFinite', 'Infinity', 'NaN', 'undefined',
  'Array', 'Object', 'String', 'Boolean', 'Number', 'Set', 'Map', 'WeakMap', 'WeakSet',
  'RegExp', 'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'Event', 'KeyboardEvent', 'MouseEvent', 'CustomEvent', 'localStorage', 'sessionStorage',
  'navigator', 'location', 'history', 'btoa', 'atob', 'fetch', 'AbortSignal', 'AbortController',
  'Blob', 'File', 'FormData', 'crypto', 'requestAnimationFrame', 'cancelAnimationFrame',
  'React', 'process', 'globalThis', 'Intl', 'Audio', 'Image', 'XMLSerializer', 'DOMParser',
  'HTMLInputElement', 'HTMLElement', 'Element', 'Node'
]);

export function scanSource(code, file = 'anonymous.jsx') {
  const issues = [];
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
    });
  } catch (err) {
    issues.push({ file, line: err.loc?.line, name: 'PARSER_ERROR', message: err.message });
    return issues;
  }

  traverse(ast, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;

      const name = path.node.name;
      if (KNOWN_GLOBALS.has(name) || name === 'React') return;

      if (!path.scope.hasBinding(name)) {
        issues.push({
          file,
          line: path.node.loc?.start?.line,
          column: path.node.loc?.start?.column,
          name
        });
      }
    },

    JSXOpeningElement(path) {
      let rootNode = path.node.name;
      let isMemberExpression = false;

      while (rootNode.type === 'JSXMemberExpression') {
        rootNode = rootNode.object;
        isMemberExpression = true;
      }

      if (rootNode.type === 'JSXIdentifier') {
        const name = rootNode.name;

        // Skip plain lowercase native HTML/SVG tags like <div>, <span>, <select>, etc.
        // For JSXMemberExpression tags like <motion.div>, root is checked regardless of case.
        if (!isMemberExpression && /^[a-z]/.test(name)) {
          return;
        }

        if (KNOWN_GLOBALS.has(name) || name === 'React') return;

        if (!path.scope.hasBinding(name)) {
          issues.push({
            file,
            line: rootNode.loc?.start?.line,
            column: rootNode.loc?.start?.column,
            name
          });
        }
      }
    }
  });

  return issues;
}

export function getFilesRecursively(dir) {
  let results = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of list) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(getFilesRecursively(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.jsx'))) {
      results.push(fullPath);
    }
  }
  return results;
}

export function scanDirectory(dir = path.resolve('src')) {
  const files = getFilesRecursively(dir);
  const issues = [];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf-8');
    const fileIssues = scanSource(code, path.relative('.', file));
    issues.push(...fileIssues);
  }
  return issues;
}

const isCLI = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCLI) {
  const issues = scanDirectory();
  console.log(JSON.stringify(issues, null, 2));
  if (issues.length > 0) {
    process.exit(1);
  }
}
