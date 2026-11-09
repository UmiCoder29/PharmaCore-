import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// Import the pure classifier module used by the Edge Function
const classifierPath = path.join(
  projectRoot,
  'supabase',
  'functions',
  'provision-pharmacy',
  'errorClassifier.ts'
);
const { classifyCreateUserError } = await import(`file:///${classifierPath.replace(/\\/g, '/')}`);

describe('provision-pharmacy Edge Function: createUser Error Classification', () => {
  it('Fixture 1 (email_exists): classifies GoTrue error code email_exists as HTTP 409 email_taken', () => {
    const fixture = {
      name: 'AuthApiError',
      status: 422,
      code: 'email_exists',
      message: 'A user with this email address has already been registered'
    };

    const res = classifyCreateUserError(fixture);
    assert.equal(res.isEmailTaken, true);
    assert.equal(res.httpStatus, 409);
    assert.equal(res.code, 'email_taken');
    assert.equal(res.error, 'An account with this email address already exists.');
  });

  it('Fixture 2 (user_already_exists): classifies alternate error code user_already_exists as HTTP 409 email_taken', () => {
    const fixture = {
      name: 'AuthApiError',
      status: 422,
      code: 'user_already_exists',
      message: 'User already registered'
    };

    const res = classifyCreateUserError(fixture);
    assert.equal(res.isEmailTaken, true);
    assert.equal(res.httpStatus, 409);
    assert.equal(res.code, 'email_taken');
    assert.equal(res.error, 'An account with this email address already exists.');
  });

  it('Fixture 3 (422 without a code): falls back to HTTP 409 when status is 422 and message includes "already been registered"', () => {
    const fixture = {
      name: 'AuthApiError',
      status: 422,
      message: 'A user with this email address has already been registered'
    };

    const res = classifyCreateUserError(fixture);
    assert.equal(res.isEmailTaken, true);
    assert.equal(res.httpStatus, 409);
    assert.equal(res.code, 'email_taken');
    assert.equal(res.error, 'An account with this email address already exists.');
  });

  it('Fixture 4 (weak_password): classifies non-duplicate 422 error as generic HTTP 400 without leaking details', () => {
    const fixture = {
      name: 'AuthApiError',
      status: 422,
      code: 'weak_password',
      message: 'Password should be at least 6 characters'
    };

    const res = classifyCreateUserError(fixture);
    assert.equal(res.isEmailTaken, false);
    assert.equal(res.httpStatus, 400);
    assert.equal(res.code, 'auth_user_failed');
    assert.equal(
      res.error,
      'Unable to provision pharmacy with the provided information. Please verify input details and try again.'
    );
    assert.doesNotMatch(res.error, /weak_password/);
  });

  it('Fixture 5 (undefined): handles undefined / null / non-object errors safely as generic HTTP 400', () => {
    const resUndefined = classifyCreateUserError(undefined);
    assert.equal(resUndefined.isEmailTaken, false);
    assert.equal(resUndefined.httpStatus, 400);
    assert.equal(resUndefined.code, 'auth_user_failed');

    const resNull = classifyCreateUserError(null);
    assert.equal(resNull.isEmailTaken, false);
    assert.equal(resNull.httpStatus, 400);
  });

  it('Fixture 6 (network error): handles network / fetch exceptions as generic HTTP 400', () => {
    const networkErr = new Error('fetch failed: connection reset by peer');
    const res = classifyCreateUserError(networkErr);
    assert.equal(res.isEmailTaken, false);
    assert.equal(res.httpStatus, 400);
    assert.equal(res.code, 'auth_user_failed');
    assert.doesNotMatch(res.error, /connection reset/);
  });

  it('Structural check: provision-pharmacy/index.ts imports and calls classifyCreateUserError (structural check only; does not prove runtime behavior - Edge Function runtime is NOT RUN)', () => {
    const indexPath = path.join(projectRoot, 'supabase', 'functions', 'provision-pharmacy', 'index.ts');
    const source = fs.readFileSync(indexPath, 'utf8');

    assert.match(
      source,
      /import\s*\{\s*classifyCreateUserError\s*\}\s*from\s*["']\.\/errorClassifier\.ts["']/,
      'index.ts must import classifyCreateUserError from ./errorClassifier.ts'
    );
    assert.match(
      source,
      /classifyCreateUserError\(createAuthErr\)/,
      'index.ts must classify createAuthErr before building the response'
    );
  });
});

