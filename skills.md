# skills.md - PharmaCore working rules

PharmaCore is a multi-tenant pharmacy ERP + POS. It will hold real medicine stock, sales and patient-adjacent business data for several pharmacies. A bug here can leak one pharmacy's data to another, corrupt stock counts, or sell expired medicine. Quality and security come before speed. Be slow and correct.

This file covers WHAT is safe to build. workflow.md covers HOW you work. Follow both. If they conflict, the stricter rule wins, and you tell me.

## 1. Non-negotiable security rules
1. The desktop app and the renderer NEVER hold a service role key, a secret key, a JWT secret, or a database password. Only SUPABASE_URL and the publishable key. getAdminClient() returns null on purpose; never bring it back, never fake it.
2. Privileged work (creating or deleting auth users, resetting passwords, anything that needs the Auth admin API) happens only in a server-side function (Supabase Edge Function). The secret lives only on the server.
3. Security is enforced by the database (RLS policies, constraints, SECURITY DEFINER functions with a fixed search_path), never only by hiding a button or checking a role in the UI. Treat the renderer and every IPC call as hostile input.
4. Every IPC handler that touches tenant or platform data starts by checking the caller's role (requireSuperAdmin or the equivalent), then validates every argument (type, length, allowed values) before using it.
5. Tenant isolation: every query on a tenant table must be safe if the caller changes a pharmacy_id or branch_id in the request. RLS must make that fail, not the client code.
6. Never log passwords, tokens, keys, full user records, or stack traces to the UI. Error text shown to the user is short and readable.
7. Never add a public (anon) way to turn a username into an email, list users, or confirm that an account exists.
8. No new dependency without telling me the name, why it is needed, and what safer built-in option you rejected.
9. Roles and permissions are read from app_metadata or from database tables, NEVER from user_metadata, which the user can edit.
10. Electron windows keep contextIsolation on, nodeIntegration off and sandbox on. Navigation and new windows are restricted, and anything passed to openExternal is validated. Never weaken these to make a feature work; ask me.
11. Never print a real secret anywhere: not in the chat, not in a report, not in a file. When you search for secrets, print only the file path, the commit hash and a fingerprint (the first 8 hex characters of the SHA-256 of the match), never the matched line.
12. If a real secret has ever been committed, treat it as compromised. Tell me to rotate it. Do not rewrite history and do not force-push.

## 2. Data integrity rules (pharmacy-specific)
1. Stock, sales and returns change inside one database transaction or one RPC. A half-finished sale must be impossible.
2. The base unit (tablet) is the single source of truth for stock. Strip and box quantities are display only.
3. Expiry rules (FEFO, never sell an expired batch) are enforced in the database function, not only in the UI.
4. Money uses exact decimal types, never floating point. Round once, at one documented place.
5. Returns can never exceed what was sold. Voids and returns leave an audit row. Nothing is silently deleted.

## 3. Honesty rules (most important for quality)
1. Never say something works unless you ran it and can show the exact command and its result. "Should work" and "looks correct" are not results.
2. If a test fails, say it failed and show the output. Never weaken, skip, delete or rewrite a test to make it pass. If a test is wrong, explain why and ask me.
3. Never invent a file, function, table, column, policy or setting. If you have not read it in this repo or the live schema, say you have not verified it.
4. If you are unsure, say "I am not sure" and name what you would check. A confident wrong answer is worse than an honest gap.
5. Never hide a failure: no empty catch blocks, no silent fallbacks to cached or local data that make a broken feature look fine, no swallowed errors.
6. Report anything you notice outside the task at the end, as a list. Do not fix it silently and do not ignore it.

## 4. Quality bar for every change
The process (plan, approval, small steps, reporting) is in workflow.md. These are the quality rules specific to this project.
1. Write the test BEFORE or WITH the fix. For a bug, first write a test that fails because of the bug, then fix it, then show it passes.
2. After finishing, run the full test suite and show the count. A new failure caused by your change is yours to fix.
3. Attack your own work before handing it over: list 3 ways someone could break or abuse this change (wrong role, another pharmacy's id, empty value, huge value, replayed request, bad type) and show you tested each.
4. Make the smallest change that solves the problem. No drive-by refactors, no renaming, no reformatting of untouched code.
5. Never mention prompt numbers in code, comments, commit messages or generated files.

## 5. Hard limits (stop and ask first)
- Do not apply, create or edit migrations on a live database. I apply database changes after review. Do not edit migrations that already exist; add a new one.
- Do not use any Supabase tool, Supabase CLI command, or request to a *.supabase.co host unless the prompt explicitly says so. If you find you can reach the live project, do not use it, and tell me.
- Do not commit, push, delete files, or run destructive commands (rm -rf, DROP, TRUNCATE, git reset --hard, git clean, force push) without my approval.
- Do not run npm audit fix, and do not change package.json or the lockfile, unless the prompt says so.
- Do not touch .env or any file that holds keys.
- Do not run scripts against a live project unless the prompt says so.
- Do not use real pharmacy data, my real superadmin password, or real keys in tests, logs or examples. Use throwaway test accounts and placeholders.

## 6. Code quality
- Match the existing style and structure. Prefer small, named functions with one job.
- Validate at the boundary, trust nothing from the renderer, handle every error path with a visible, honest result.
- Every user-facing failure shows a clear message and a way forward; never a blank screen.
- Comments explain WHY, not what. No dead code, no commented-out code, no TODOs without a reason.
- Accessibility and clarity: labels on inputs, readable errors, keyboard-usable forms.

## 7. Checklist before you say "done"
- [ ] I read the real files, not assumptions.
- [ ] The plan was approved with PLAN OK.
- [ ] Tests were written and the full suite passes (count shown).
- [ ] I tried to break my own change and wrote down the results.
- [ ] No secret, key, real password or real ID is anywhere in the diff or in my report.
- [ ] No empty catch, no silent fallback, no fake data.
- [ ] I listed everything I touched, everything I left disabled, and everything else I noticed.