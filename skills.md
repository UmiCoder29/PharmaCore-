1. What this product is

PharmaCore is a multi-tenant pharmacy ERP and point-of-sale SaaS. Its pitch is: the pharmacy software that proves every medicine is real, starting in Karachi, Pakistan and built for the world. The differentiator is verification of the 2D Data Matrix barcodes that DRAP (Drug Regulatory Authority of Pakistan) made mandatory on all new medicine packs from 9 October 2026, plus an audit log and an inspection-ready compliance report.

It is being built for the World's Biggest Business Competition (App Builder track). The build window ends 20 November 2026, with a first paying customer targeted for week 3.

2. Stack and decisions already made
Frontend: React 18, Vite 5, Tailwind CSS 3.4, GSAP for animation, lucide-react for icons. Keep the emerald green theme and the existing layout.
Backend: Supabase (Postgres, Row Level Security, Auth, Realtime, Edge Functions). A brand new Supabase project replaces the old deleted ones.
Product shape: web-first SaaS with an offline mode that syncs later. The existing Electron app stays untouched as a fallback and must not be extended with new features.
Money: prices stored per base unit (tablet). Strip and box prices are computed for display only.
Stock: the base unit (tablet) is authoritative for stock. Deduction follows FEFO (first expiry, first out) by batch.
Global-ready: country rules (barcode standard, tax, currency, regulator name) live in a country profile setting, never hardcoded. Pakistan is the first profile.
3. Security rules (never break these)
Never put a service role key, secret key, JWT secret, or any password in client code, scripts, SQL seed files, documentation, or commits. Only the publishable (anon) key may ship in the frontend, read from environment variables.
Every table has Row Level Security enabled. Every policy ties rows to the caller's pharmacy through the pharmacy id. A user from one pharmacy must never be able to read or write another pharmacy's rows.
Anything needing admin power (creating users, onboarding a pharmacy, resetting passwords, superadmin views) runs in a Supabase Edge Function that verifies the caller's role from their JWT. Never in the client.
Every SECURITY DEFINER function sets a fixed search_path and checks the caller's pharmacy and role inside the function body.
The anonymous role gets no table privileges except where a table is deliberately public, and each such exception must be written down with a reason.
No default passwords. New accounts must change their password on first login.
Before every commit, run a secrets scan for key patterns (sb_secret_, sb_publishable_ with real values, long JWT strings, private key headers, old project IDs). Show the result and wait for approval before committing.
Add an .env.example listing variable names only.
4. Database rules
All schema changes are migration files in supabase/migrations/, named with a timestamp prefix. Never edit a migration that has already been applied; add a new one.
Every table has: id (uuid), pharmacy_id, created_at, and updated_at where it makes sense. Use soft delete (a deleted_at column) for medicines and anything referenced by sales history.
Money columns use numeric, not float. Quantities are integers in base units.
Add an index for every foreign key and every column used in a policy or frequent filter.
Stock changes and sales happen inside a single database transaction. Never update stock from the client in separate calls.
Write the rollback note in a comment at the top of each migration.
5. Coding standards
Small components, one responsibility each. No file over about 400 lines without a good reason.
Handle loading, empty, and error states on every screen. Never leave a blank screen.
Validate all input on the client for speed and again in the database or Edge Function for safety.
No new dependency without saying why, and what it costs in bundle size.
Keep user-facing text in one place so Urdu can be added later.
Use clear names. Comment the reason for anything unusual, not what the code obviously does.
6. Hard do-not-touch list
Do not delete or rewrite working POS, returns, batch, supplier, or multi-branch logic unless the prompt says so.
Do not change the emerald theme or the overall layout.
Do not add features that are not in the current prompt.
Do not push to GitHub, apply migrations to a live database, or deploy without being told to.
Do not invent medical data. Medicine names, formulas, and prices come from imports or user input only.
7. Regulatory and domain context
DRAP Phase I: all locally manufactured and imported pharmaceutical products manufactured or imported on or after 9 October 2026 must carry a unique 2D Data Matrix barcode with a serial number, under the Pharmaceutical Track and Trace System. Older stock is exempt and remains legal to sell, so pharmacies hold mixed stock (coded and uncoded) for months.
A pack serial number should be sellable once. A second scan of the same serial must be blocked and logged as a possible counterfeit or duplicate.
A free DRAP verification app for consumers and pharmacists is expected. PharmaCore must not rely on charging for scan-to-verify alone. Its value is scanning inside the checkout flow, blocking bad packs automatically, tracking coded and uncoded batches, and producing the audit log and inspection report.
FBR and SRB tax handling and DRAP record-keeping rules need a consultation before invoicing real customers. Flag anything that looks like a legal claim and do not state it as certain.
Pharmacy data is private. Treat customer and prescription data as sensitive.
8. How to work with me
Work on one prompt at a time. Do exactly what the prompt says.
Before changing anything, read the relevant files and state a short plan in plain English.
After changing anything, list the files you touched and what changed, then say how to test it.
If something in the prompt is unclear or conflicts with these rules, stop and ask. Do not guess.
If you find a bug or security problem outside the prompt, report it at the end. Do not fix it silently.
Keep explanations short. I am a self-taught developer who learns by building, so plain language beats theory.
9. Definition of done for any prompt
The code runs with no console errors.
The change was tested by hand and the steps are written out.
No secrets, no default passwords, no hardcoded project URLs.
Security rules in section 3 still hold.
Nothing outside the prompt's scope changed.

- Migration files are named YYYYMMDDNNNNNN_description.sql (timestamp, then a sequence number) and run in order.
- A migration that has been applied to any database is never edited. Any fix is a new migration file.
- Migrations run in the Supabase SQL Editor as the postgres role. Never alter default privileges for supabase_admin or other Supabase-managed roles, and never modify the auth, storage or realtime schemas.
- A row-level policy for the anon role must not call helper functions that anon cannot execute. Write separate anon and authenticated policies.
