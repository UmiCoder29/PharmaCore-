import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default || traverseModule;

const KNOWN_GLOBALS = new Set([
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

function getFilesRecursively(dir) {
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

const srcDir = path.resolve('src');
const files = getFilesRecursively(srcDir);
const issues = [];

for (const file of files) {
  const code = fs.readFileSync(file, 'utf-8');
  let ast;
  try {
    ast = parse(code, {
      sourceType: 'module',
      plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator']
    });
  } catch (err) {
    issues.push({ file, line: err.loc?.line, name: 'PARSER_ERROR', message: err.message });
    continue;
  }

  traverse(ast, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;

      const name = path.node.name;
      if (KNOWN_GLOBALS.has(name)) return;

      // Check if binding exists in current or any parent scope
      if (!path.scope.hasBinding(name)) {
        // Exclude JSX pragma if implicit
        if (name === 'React') return;

        issues.push({
          file: path.relative ? path.relative : file,
          line: path.node.loc?.start?.line,
          column: path.node.loc?.start?.column,
          name
        });
      }
    }
  });
}

console.log(JSON.stringify(issues, null, 2));

if (issues.length > 0) {
  process.exit(1);
}
