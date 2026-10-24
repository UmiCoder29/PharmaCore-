require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.INITIAL_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD;

if (!url || !serviceKey) {
  console.error('[create_superadmin] Error: SUPABASE_URL and SUPABASE_SECRET_KEY must be set in your .env file or environment.');
  process.exit(1);
}

if (!password || password.length < 8) {
  console.error('[create_superadmin] Error: Please specify a secure INITIAL_ADMIN_PASSWORD (min 8 characters) in environment variables or .env file.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function createSuperAdmin() {
  const username = 'superadmin';
  const email = `${username}@pharmacore.local`;
  const displayName = 'Platform SuperAdmin';

  console.log(`Setting up SuperAdmin account (${email})...`);

  // Check if auth user exists
  const { data: usersData, error: listErr } = await supabase.auth.admin.listUsers();
  let authUserId = null;

  if (usersData && usersData.users) {
    const existing = usersData.users.find(u => u.email === email);
    if (existing) {
      authUserId = existing.id;
      console.log(`Found existing auth user: ${authUserId}. Updating credentials...`);
      await supabase.auth.admin.updateUserById(authUserId, {
        password: password,
        email_confirm: true,
        user_metadata: { role: 'superadmin', name: displayName, username: username, must_change_password: true }
      });
    }
  }

  if (!authUserId) {
    console.log('Creating new auth user...');
    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: { role: 'superadmin', name: displayName, username: username, must_change_password: true }
    });

    if (createErr) {
      console.error('Failed to create auth user:', createErr);
      return;
    }
    authUserId = newUser.user.id;
  }

  // Upsert into public.app_users
  console.log('Upserting into public.app_users table...');
  const { error: upsertErr } = await supabase.from('app_users').upsert({
    id: authUserId,
    username: username,
    display_name: displayName,
    role: 'superadmin',
    branch_id: null,
    pharmacy_id: null,
    can_view_all_branches: true,
    must_change_password: true
  });

  if (upsertErr) {
    console.error('Failed to upsert app_users:', upsertErr);
    return;
  }

  console.log('\n=========================================');
  console.log('✅ SUPERADMIN ACCOUNT READY');
  console.log('=========================================');
  console.log('Username : superadmin');
  console.log('Role     : superadmin (Global Platform Control)');
  console.log('Password : [Configured via INITIAL_ADMIN_PASSWORD]');
  console.log('Note     : Password change will be required on first login.');
  console.log('=========================================\n');
}

createSuperAdmin().catch(console.error);
