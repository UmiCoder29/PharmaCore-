import { createClient } from "npm:@supabase/supabase-js@2";

// ─── HTTP Headers ────────────────────────────────────────────────────────────
const responseHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma": "no-cache",
};

function jsonResponse(status: number, data: Record<string, unknown>, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...responseHeaders, ...extraHeaders },
  });
}

// ─── Unbiased Password Generator ─────────────────────────────────────────────
// Guarantees all four character classes, uses .length for all bounds, and
// eliminates modulo bias via crypto rejection sampling.
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // 24 chars (I/O omitted)
const LOWERCASE = "abcdefghjkmnpqrstuvwxyz"; // 23 chars (i/l/o omitted)
const DIGITS = "23456789";                   // 8 chars (0/1 omitted)
const SYMBOLS = "!@#$%^&*()_+-=[]{}|";        // 19 chars

function getSecureChar(charset: string): string {
  const len = charset.length;
  const maxValidByte = 256 - (256 % len);
  const buffer = new Uint8Array(1);
  while (true) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < maxValidByte) {
      return charset[buffer[0] % len];
    }
  }
}

function generateTemporaryPassword(): string {
  const charsets = [UPPERCASE, LOWERCASE, DIGITS, SYMBOLS];
  const chars: string[] = [];

  // Guarantee at least 1 character from each of the 4 character classes
  for (let i = 0; i < charsets.length; i++) {
    chars.push(getSecureChar(charsets[i]));
  }

  // Fill remaining characters up to desired target length (16) from the combined pool
  const ALL_CHARS = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;
  const TARGET_LENGTH = 16;
  while (chars.length < TARGET_LENGTH) {
    chars.push(getSecureChar(ALL_CHARS));
  }

  // Fisher-Yates shuffle with unbiased crypto-random indices
  for (let i = chars.length - 1; i > 0; i--) {
    const range = i + 1;
    const maxValidByte = 256 - (256 % range);
    const buffer = new Uint8Array(1);
    let j: number;
    while (true) {
      crypto.getRandomValues(buffer);
      if (buffer[0] < maxValidByte) {
        j = buffer[0] % range;
        break;
      }
    }
    const temp = chars[i];
    chars[i] = chars[j];
    chars[j] = temp;
  }

  return chars.join("");
}

// ─── Main Request Handler ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // 1. Method check: POST only (caller is Electron main process)
  if (req.method !== "POST") {
    return jsonResponse(405, {
      success: false,
      error: "Method Not Allowed. Use POST.",
    }, { "Allow": "POST" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseServiceRoleKey || !supabaseAnonKey) {
    console.error("[provision-pharmacy] Server environment variables misconfigured.");
    return jsonResponse(500, {
      success: false,
      error: "Server configuration error.",
    });
  }

  // Service-role client (used strictly for platform-level operations, never exposed)
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Helper to record caller attempt in provision_attempts (checks error return directly)
  async function recordAttempt(callerId: string, outcome: string) {
    const { error: insertErr } = await supabaseAdmin.from("provision_attempts").insert({
      caller_id: callerId,
      outcome,
    });
    if (insertErr) {
      console.error("[provision-pharmacy] Failed to record attempt:", insertErr.message);
    }
  }

  // Helper to compensate and delete created GoTrue user on downstream failures
  async function rollbackAuthUser(authId: string) {
    let deleteSucceeded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(authId);
      if (!delErr) {
        deleteSucceeded = true;
        break;
      }
      if (attempt < 3) {
        await new Promise((res) => setTimeout(res, attempt === 1 ? 500 : 1500));
      }
    }

    if (!deleteSucceeded) {
      console.error(JSON.stringify({
        level: "ERROR",
        event: "ORPHAN_AUTH_USER_CREATION_FAILURE",
        message: "CRITICAL: Failed to delete orphaned auth user during provisioning rollback",
        auth_user_id: authId,
        timestamp: new Date().toISOString(),
      }));
    }
  }

  // 2. JWT check: extract and verify Bearer token
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    return jsonResponse(401, {
      success: false,
      error: "Missing or malformed Authorization header.",
    });
  }

  const anonClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: authData, error: authError } = await anonClient.auth.getUser(token);

  if (authError || !authData?.user) {
    return jsonResponse(401, {
      success: false,
      error: "Invalid or expired session token.",
    });
  }

  const callerAuthId = authData.user.id;

  // 3. Role check: query app_users with caller's own token under RLS
  const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerProfile, error: profileErr } = await callerClient
    .from("app_users")
    .select("id, username, role")
    .eq("id", callerAuthId)
    .single();

  if (profileErr || !callerProfile) {
    return jsonResponse(401, {
      success: false,
      error: "Caller user profile not found.",
    });
  }

  if (callerProfile.role !== "superadmin") {
    return jsonResponse(403, {
      success: false,
      error: "Forbidden: SaaS Platform SuperAdmin access required.",
    });
  }

  // 4. Rate limit check: max 10 attempts per hour per superadmin (fails closed on query error)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: attemptCount, error: countErr } = await supabaseAdmin
    .from("provision_attempts")
    .select("id", { count: "exact", head: true })
    .eq("caller_id", callerProfile.id)
    .gte("created_at", oneHourAgo);

  if (countErr) {
    console.error("[provision-pharmacy] Rate limit check query failed:", countErr.message);
    return jsonResponse(500, {
      success: false,
      error: "Rate limit check failed. Request aborted for safety.",
    });
  }

  // Note: rate_limited attempts are recorded in provision_attempts and count toward the limit
  if ((attemptCount ?? 0) >= 10) {
    await recordAttempt(callerProfile.id, "rate_limited");
    return jsonResponse(429, {
      success: false,
      error: "Rate limit exceeded. Maximum 10 provisioning attempts per hour.",
    });
  }

  // 5. Validation check: parse JSON body and require plain object (not null, array, or primitive)
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Invalid JSON request payload.",
    });
  }

  if (typeof rawBody !== "object" || rawBody === null || Array.isArray(rawBody)) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Request body must be a plain JSON object.",
    });
  }

  const body = rawBody as Record<string, unknown>;

  const allowedKeys = new Set([
    "pharmacyName",
    "adminEmail",
    "adminUsername",
    "planTier",
    "branchName",
    "city",
    "phone",
    "adminDisplayName",
  ]);

  for (const key of Object.keys(body)) {
    if (!allowedKeys.has(key)) {
      await recordAttempt(callerProfile.id, "validation_failed");
      return jsonResponse(400, {
        success: false,
        error: `Unexpected parameter: ${key}`,
      });
    }
  }

  const pharmacyName = typeof body.pharmacyName === "string" ? body.pharmacyName.trim() : "";
  const adminEmail = typeof body.adminEmail === "string" ? body.adminEmail.trim().toLowerCase() : "";
  const adminUsername = typeof body.adminUsername === "string" ? body.adminUsername.trim() : "";
  const planTier = typeof body.planTier === "string" ? body.planTier.trim() : "";
  const branchName = typeof body.branchName === "string" ? body.branchName.trim() : "Main Branch";
  const city = typeof body.city === "string" ? body.city.trim() : "Karachi";
  const phone = typeof body.phone === "string" ? body.phone.trim() : null;
  const adminDisplayName = typeof body.adminDisplayName === "string" ? body.adminDisplayName.trim() : null;

  // Boundary validations
  if (pharmacyName.length < 2 || pharmacyName.length > 100) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Pharmacy name must be between 2 and 100 characters.",
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (adminEmail.length < 5 || adminEmail.length > 255 || !emailRegex.test(adminEmail)) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Invalid email address format.",
    });
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (adminUsername.length < 3 || adminUsername.length > 50 || !usernameRegex.test(adminUsername)) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Admin username must be between 3 and 50 characters (letters, numbers, underscores only).",
    });
  }

  if (planTier.length < 2 || planTier.length > 50) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Subscription plan tier must be between 2 and 50 characters.",
    });
  }

  if (branchName.length > 100) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Branch name cannot exceed 100 characters.",
    });
  }

  if (city.length > 100) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "City cannot exceed 100 characters.",
    });
  }

  if (phone && phone.length > 30) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Phone number cannot exceed 30 characters.",
    });
  }

  if (adminDisplayName && adminDisplayName.length > 100) {
    await recordAttempt(callerProfile.id, "validation_failed");
    return jsonResponse(400, {
      success: false,
      error: "Admin display name cannot exceed 100 characters.",
    });
  }

  // 6. Username pre-check: exact lowercase match before Phase 1
  const normalizedUsername = adminUsername.toLowerCase();
  const { data: existingUser } = await supabaseAdmin
    .from("app_users")
    .select("id")
    .eq("username", normalizedUsername)
    .maybeSingle();

  if (existingUser) {
    await recordAttempt(callerProfile.id, "username_taken");
    return jsonResponse(400, {
      success: false,
      error: "Admin username is already taken. Please choose a different username.",
    });
  }

  // 7. Plan pre-check: ensure planTier exists and is active in subscription_plans
  const { data: planRecord } = await supabaseAdmin
    .from("subscription_plans")
    .select("slug, max_branches, max_users")
    .eq("slug", planTier)
    .eq("is_active", true)
    .maybeSingle();

  if (!planRecord) {
    await recordAttempt(callerProfile.id, "plan_invalid");
    return jsonResponse(400, {
      success: false,
      error: "Invalid or inactive subscription plan tier.",
    });
  }

  // 8. User creation (Phase 1: GoTrue Auth User) & Database RPC (Phase 2)
  const temporaryPassword = generateTemporaryPassword();

  // Create GoTrue user. Note: must_change_password lives ONLY in app_users, NOT user_metadata.
  const { data: authUserData, error: createAuthErr } = await supabaseAdmin.auth.admin.createUser({
    email: adminEmail,
    password: temporaryPassword,
    email_confirm: true,
  });

  if (createAuthErr || !authUserData?.user) {
    await recordAttempt(callerProfile.id, "auth_user_failed");
    // Internal log without exposing the password
    console.error("[provision-pharmacy] auth.admin.createUser failed:", createAuthErr?.message);
    // Uniform response to prevent user enumeration
    return jsonResponse(400, {
      success: false,
      error: "Unable to provision pharmacy with the provided information. Please verify input details and try again.",
    });
  }

  const newAdminAuthId = authUserData.user.id;

  try {
    // Phase 2: Call transactional RPC public.fn_provision_pharmacy
    const { data: rpcResult, error: rpcErr } = await supabaseAdmin.rpc("fn_provision_pharmacy", {
      p_admin_user_id: newAdminAuthId,
      p_pharmacy_name: pharmacyName,
      p_city: city,
      p_contact_phone: phone,
      p_contact_email: adminEmail,
      p_admin_username: normalizedUsername,
      p_admin_display_name: adminDisplayName || normalizedUsername,
      p_branch_name: branchName,
      p_plan_tier: planTier,
      p_caller_user_id: callerProfile.id,
      p_caller_username: callerProfile.username,
    });

    if (rpcErr) {
      await recordAttempt(callerProfile.id, "rpc_failed");
      console.error("[provision-pharmacy] fn_provision_pharmacy RPC failed:", rpcErr.message);

      // Phase 3: Compensating delete with retry (up to 3 attempts with exponential delay)
      await rollbackAuthUser(newAdminAuthId);

      if (rpcErr.message && rpcErr.message.includes("Admin username is already taken")) {
        return jsonResponse(400, {
          success: false,
          error: "Admin username is already taken. Please choose a different username.",
        });
      }

      return jsonResponse(500, {
        success: false,
        error: "Failed to provision pharmacy database records.",
      });
    }

    // Provisioning succeeded: record attempt outcome
    await recordAttempt(callerProfile.id, "success");

    return jsonResponse(200, {
      success: true,
      pharmacy: {
        id: rpcResult.pharmacy_id,
        name: rpcResult.pharmacy_name,
        slug: rpcResult.slug,
      },
      admin: {
        id: rpcResult.app_user_id,
        username: rpcResult.username,
        email: adminEmail,
      },
      temporaryPassword,
    });
  } catch (unexpectedErr) {
    await recordAttempt(callerProfile.id, "rpc_failed");
    console.error("[provision-pharmacy] Unexpected exception during provisioning:", (unexpectedErr as Error).message);
    await rollbackAuthUser(newAdminAuthId);
    return jsonResponse(500, {
      success: false,
      error: "Unexpected error during pharmacy provisioning.",
    });
  }
});
