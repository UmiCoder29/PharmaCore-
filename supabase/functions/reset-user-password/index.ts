import { createClient } from "npm:@supabase/supabase-js@2";
import {
  validateResetInput,
  evaluateResetPermission,
  generateTemporaryPassword,
  isRateLimitExceeded,
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_COUNTED_OUTCOME,
  UNIFORM_INELIGIBLE_ERROR,
} from "./logic.ts";

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

// ─── Main Request Handler ────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // 1. Method check: POST only
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
    console.error("[reset-user-password] Server environment variables misconfigured.");
    return jsonResponse(500, {
      success: false,
      error: "Server configuration error.",
    });
  }

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  async function recordAttempt(callerId: string, targetId: string | null, outcome: string) {
    try {
      const { error: insertErr } = await supabaseAdmin.from("password_reset_attempts").insert({
        caller_id: callerId,
        target_id: targetId,
        outcome,
      });
      if (insertErr) {
        console.error("[reset-user-password] Failed to record attempt:", insertErr.message);
      }
    } catch (e) {
      console.error("[reset-user-password] Exception recording attempt:", e);
    }
  }

  // 2. Parse and validate JSON request body
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch (_) {
    return jsonResponse(400, {
      success: false,
      error: "Malformed JSON payload.",
    });
  }

  const inputValidation = validateResetInput(rawBody);
  if (!inputValidation.valid || !inputValidation.userId) {
    return jsonResponse(400, {
      success: false,
      error: inputValidation.error || "Invalid request payload.",
    });
  }

  const targetUserId = inputValidation.userId;

  // 3. JWT verification: extract and verify Bearer token
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

  // 4. Resolve caller profile from app_users
  const { data: callerProfile, error: callerProfileErr } = await supabaseAdmin
    .from("app_users")
    .select("id, username, role, pharmacy_id")
    .eq("id", callerAuthId)
    .single();

  if (callerProfileErr || !callerProfile) {
    return jsonResponse(401, {
      success: false,
      error: "Caller user profile not found.",
    });
  }

  // 5. Resolve target profile from app_users
  const { data: targetProfile } = await supabaseAdmin
    .from("app_users")
    .select("id, username, role, pharmacy_id")
    .eq("id", targetUserId)
    .single();

  // 6. Permission check via pure evaluation matrix
  const permission = evaluateResetPermission(callerProfile, targetProfile);
  if (!permission.allowed) {
    // Record unauthorized/ineligible attempt
    await recordAttempt(callerProfile.id, targetUserId, "permission_denied");
    return jsonResponse(permission.httpStatus, {
      success: false,
      error: permission.error || UNIFORM_INELIGIBLE_ERROR,
    });
  }

  // 7. Rate limit check: maximum 10 'attempted' rows per hour per caller
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: attemptCount, error: countErr } = await supabaseAdmin
    .from("password_reset_attempts")
    .select("id", { count: "exact", head: true })
    .eq("caller_id", callerProfile.id)
    .eq("outcome", RATE_LIMIT_COUNTED_OUTCOME)
    .gte("created_at", oneHourAgo);

  if (countErr) {
    console.error("[reset-user-password] Failed to check rate limit count:", countErr.message);
    return jsonResponse(500, {
      success: false,
      error: "Rate limit check failed. Request aborted for safety.",
    });
  }

  if (isRateLimitExceeded(attemptCount ?? 0)) {
    await recordAttempt(callerProfile.id, targetProfile!.id, "rate_limited");
    return jsonResponse(429, {
      success: false,
      error: `Rate limit exceeded. Maximum ${RATE_LIMIT_MAX_ATTEMPTS} password reset attempts per hour.`,
    });
  }

  // 8. Record authorized attempt before executing reset (Adjustment 3)
  await recordAttempt(callerProfile.id, targetProfile!.id, "attempted");

  // 9. Generate temporary password meeting policy
  const temporaryPassword = generateTemporaryPassword();

  // 10. Execution order (Adjustment 2):
  // Set must_change_password = true FIRST. If this fails, abort without updating password.
  const { error: flagErr } = await supabaseAdmin
    .from("app_users")
    .update({
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", targetProfile!.id);

  if (flagErr) {
    console.error("[reset-user-password] Failed to set must_change_password flag:", flagErr.message);
    await recordAttempt(callerProfile.id, targetProfile!.id, "flag_update_failed");
    return jsonResponse(500, {
      success: false,
      error: "Failed to update must_change_password flag. Password was not changed.",
    });
  }

  // Update password in Supabase Auth Admin API
  const { error: authUpdateErr } = await supabaseAdmin.auth.admin.updateUserById(targetProfile!.id, {
    password: temporaryPassword,
  });

  if (authUpdateErr) {
    console.error("[reset-user-password] Failed to update user password in Auth:", authUpdateErr.message);
    // Note: must_change_password remains true as requested in adjustment 2
    await recordAttempt(callerProfile.id, targetProfile!.id, "auth_update_failed");
    return jsonResponse(500, {
      success: false,
      error: "Failed to update password in authentication system.",
    });
  }

  // 11. Audit trail in activity_logs
  const targetPharmacyId = targetProfile!.pharmacy_id || callerProfile.pharmacy_id;
  if (targetPharmacyId) {
    const { error: logErr } = await supabaseAdmin.from("activity_logs").insert({
      pharmacy_id: targetPharmacyId,
      user_id: callerProfile.id,
      username: callerProfile.username,
      action: "ADMIN_RESET_PASSWORD",
      target_table: "app_users",
      target_record_id: targetProfile!.id,
      details: {
        actor_role: callerProfile.role,
        target_username: targetProfile!.username,
        target_role: targetProfile!.role,
      },
    });
    if (logErr) {
      console.error("[reset-user-password] Failed to write activity log:", logErr.message);
    }
  }

  // 12. Record success in password_reset_attempts
  await recordAttempt(callerProfile.id, targetProfile!.id, "success");

  // 13. Return success with temporary password once
  return jsonResponse(200, {
    success: true,
    temporaryPassword,
  });
});
