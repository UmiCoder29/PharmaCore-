import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('[export_data_sql] Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in your .env file or environment.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const DEFAULT_PHARMACY_ID = '11111111-1111-1111-1111-111111111111';

const TABLES_IN_ORDER = [
    'pharmacies',
    'branches',
    'categories',
    'suppliers',
    'medicines',
    'batches',
    'customers',
    'prescriptions',
    'sales',
    'sale_items',
    'sale_payments',
    'returns',
    'return_items',
    'activity_logs',
    'settings',
    'app_users'
];

function formatSqlValue(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (typeof val === 'number') return String(val);
    if (typeof val === 'object') {
        return `'${JSON.stringify(val).replace(/'/g, "''")}'::JSONB`;
    }
    return `'${String(val).replace(/'/g, "''")}'`;
}

async function exportData() {
    console.log('Fetching data from Supabase...');
    const dataByTable = {};
    const tableCounts = {};

    // 1. Fetch auth.users
    let authUsers = [];
    try {
        const { data: { users }, error: authError } = await supabase.auth.admin.listUsers();
        if (!authError && users) {
            authUsers = users;
            console.log(`Fetched ${users.length} auth.users`);
        }
    } catch (err) {
        console.warn('Could not fetch auth.users:', err.message);
    }

    // 2. Fetch each table
    for (const table of TABLES_IN_ORDER) {
        try {
            const { data, error } = await supabase.from(table).select('*');
            if (error) {
                console.error(`Error fetching table ${table}:`, error.message);
                dataByTable[table] = [];
                tableCounts[table] = 0;
            } else {
                let rows = data || [];
                // If table is pharmacies and empty, insert default flagship pharmacy
                if (table === 'pharmacies' && rows.length === 0) {
                    rows = [{
                        id: DEFAULT_PHARMACY_ID,
                        name: 'PharmaCore Flagship Pharmacy',
                        slug: 'pharmacore-main',
                        contact_email: 'admin@pharmacore.local',
                        contact_phone: '+92 21 35876543',
                        city: 'Karachi',
                        plan_tier: 'professional',
                        subscription_status: 'active',
                        max_branches: 5,
                        max_users: 15,
                        is_active: true
                    }];
                }
                
                // Attach pharmacy_id to rows if missing
                if (table !== 'pharmacies') {
                    rows = rows.map(r => ({
                        ...r,
                        pharmacy_id: r.pharmacy_id || DEFAULT_PHARMACY_ID
                    }));
                }

                dataByTable[table] = rows;
                tableCounts[table] = rows.length;
                console.log(`Fetched ${tableCounts[table]} records from ${table}`);
            }
        } catch (err) {
            console.error(`Exception fetching table ${table}:`, err.message);
            dataByTable[table] = [];
            tableCounts[table] = 0;
        }
    }

    // 3. Build data.sql
    let sqlOutput = `-- ==============================================================================\n`;
    sqlOutput += `-- PharmaCore ERP + POS — Multi-Tenant SaaS Database Data Dump\n`;
    sqlOutput += `-- Exported on: ${new Date().toISOString()}\n`;
    sqlOutput += `-- ==============================================================================\n\n`;
    sqlOutput += `BEGIN;\n\n`;
    sqlOutput += `SET session_replication_role = 'replica';\n\n`;

    if (authUsers.length > 0) {
        sqlOutput += `-- ------------------------------------------------------------------------------\n`;
        sqlOutput += `-- 0. AUTH USERS (Supabase auth.users)\n`;
        sqlOutput += `-- ------------------------------------------------------------------------------\n`;
        for (const u of authUsers) {
            const cols = [
                'id',
                'email',
                'raw_app_meta_data',
                'raw_user_meta_data',
                'created_at',
                'updated_at',
                'role',
                'aud',
                'encrypted_password'
            ];
            const vals = [
                formatSqlValue(u.id),
                formatSqlValue(u.email),
                formatSqlValue(u.app_metadata || { provider: 'email', providers: ['email'] }),
                formatSqlValue(u.user_metadata || {}),
                formatSqlValue(u.created_at || new Date().toISOString()),
                formatSqlValue(u.updated_at || new Date().toISOString()),
                formatSqlValue('authenticated'),
                formatSqlValue('authenticated'),
                u.encrypted_password ? formatSqlValue(u.encrypted_password) : "crypt(gen_random_uuid()::text, gen_salt('bf'))"
            ];
            sqlOutput += `INSERT INTO auth.users (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
        }
        sqlOutput += `\n`;
    }

    for (const table of TABLES_IN_ORDER) {
        const rows = dataByTable[table];
        if (!rows || rows.length === 0) continue;

        sqlOutput += `-- ------------------------------------------------------------------------------\n`;
        sqlOutput += `-- Table: public.${table} (${rows.length} records)\n`;
        sqlOutput += `-- ------------------------------------------------------------------------------\n`;

        for (const row of rows) {
            const cols = Object.keys(row);
            const vals = cols.map(c => formatSqlValue(row[c]));
            
            if (table === 'settings') {
                sqlOutput += `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;\n`;
            } else if (cols.includes('id')) {
                sqlOutput += `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT (id) DO NOTHING;\n`;
            } else {
                sqlOutput += `INSERT INTO public.${table} (${cols.join(', ')}) VALUES (${vals.join(', ')});\n`;
            }
        }
        sqlOutput += `\n`;
    }

    sqlOutput += `-- Re-enable standard trigger/constraint enforcement\n`;
    sqlOutput += `SET session_replication_role = 'DEFAULT';\n\n`;
    sqlOutput += `COMMIT;\n`;

    const outPathData = path.join(__dirname, '..', 'data.sql');
    fs.writeFileSync(outPathData, sqlOutput, 'utf8');
    console.log(`Saved standalone data dump to ${outPathData}`);

    // Update combined schema + data file
    const schemaPath = path.join(__dirname, '..', 'schema.sql');
    if (fs.existsSync(schemaPath)) {
        const schemaContent = fs.readFileSync(schemaPath, 'utf8');
        const combined = `${schemaContent}\n\n-- ==============================================================================\n-- DATA SEED / RESTORE SECTION\n-- ==============================================================================\n\n${sqlOutput}`;
        const combinedPath = path.join(__dirname, '..', 'schema_with_data.sql');
        fs.writeFileSync(combinedPath, combined, 'utf8');
        console.log(`Saved combined schema + data to ${combinedPath}`);
    }

    console.log('Data export complete!');
    console.log('Summary:', JSON.stringify(tableCounts, null, 2));
}

exportData().catch(err => {
    console.error('Fatal export error:', err);
    process.exit(1);
});
