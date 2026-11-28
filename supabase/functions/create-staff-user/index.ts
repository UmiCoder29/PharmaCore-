import { createClient } from "npm:@supabase/supabase-js@2";
import { processCreateStaffRequest } from "./logic.ts";

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  let rawBodyResult: { ok: true; body: unknown } | { ok: false } = { ok: false };
  if (req.method === "POST") {
    try {
      rawBodyResult = { ok: true, body: await req.json() };
    } catch (_) {
      rawBodyResult = { ok: false };
    }
  }

  const supabaseAdmin = (supabaseUrl && supabaseServiceRoleKey)
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  const anonClient = (supabaseUrl && supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

  const result = await processCreateStaffRequest(
    req.method,
    req.headers.get("Authorization") || "",
    rawBodyResult,
    {
      getEnv: () => ({
        url: supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
        anonKey: supabaseAnonKey,
      }),
      verifyToken: async (token: string) => {
        if (!anonClient) return { userId: null, error: "Anon client uninitialized" };
        const { data, error } = await anonClient.auth.getUser(token);
        if (error || !data?.user) return { userId: null, error: error?.message };
        return { userId: data.user.id };
      },
      getCallerProfile: async (userId: string) => {
        const { data, error } = await supabaseAdmin!
          .from("app_users")
          .select("id, username, role, pharmacy_id, branch_id, can_view_all_branches, must_change_password")
          .eq("id", userId)
          .maybeSingle();
        if (error || !data) return null;
        return data;
      },
      countAttempts: async (callerId: string, windowStartIso: string) => {
        const { count, error } = await supabaseAdmin!
          .from("staff_creation_attempts")
          .select("id", { count: "exact", head: true })
          .eq("caller_id", callerId)
          .eq("outcome", "attempted")
          .gte("created_at", windowStartIso);
        return { count: count ?? 0, error: error?.message };
      },
      recordAttempt: async (callerId: string, targetUsername: string | null, outcome: string) => {
        try {
          const { error } = await supabaseAdmin!.from("staff_creation_attempts").insert({
            caller_id: callerId,
            target_username: targetUsername,
            outcome,
          });
          if (error) {
            console.error("[create-staff-user] Failed to record attempt:", error.message);
          }
        } catch (err) {
          console.error("[create-staff-user] Exception recording attempt:", err);
        }
      },
      getPharmacy: async (pharmacyId: string) => {
        const { data, error } = await supabaseAdmin!
          .from("pharmacies")
          .select("id, is_active, subscription_status, max_users")
          .eq("id", pharmacyId)
          .maybeSingle();
        if (error || !data) return null;
        return data;
      },
      getBranch: async (branchId: string) => {
        const { data, error } = await supabaseAdmin!
          .from("branches")
          .select("id, pharmacy_id")
          .eq("id", branchId)
          .maybeSingle();
        if (error || !data) return null;
        return data;
      },
      findUserByUsername: async (username: string) => {
        const { data } = await supabaseAdmin!
          .from("app_users")
          .select("id")
          .eq("username", username)
          .maybeSingle();
        return data || null;
      },
      createAuthUser: async (email: string, password: string) => {
        const { data, error } = await supabaseAdmin!.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data?.user) {
          return { error: error ? { message: error.message, status: error.status, code: error.code } : { message: "Auth user creation failed" } };
        }
        return { userId: data.user.id };
      },
      deleteAuthUser: async (userId: string) => {
        const { error } = await supabaseAdmin!.auth.admin.deleteUser(userId);
        return { error: error ? { message: error.message } : null };
      },
      callCreateStaffRpc: async (params) => {
        const { data, error } = await supabaseAdmin!.rpc("fn_create_staff_user", params);
        return { data, error: error ? { message: error.message, code: error.code } : null };
      },
      findAppUserById: async (userId: string) => {
        const { data, error } = await supabaseAdmin!
          .from("app_users")
          .select("id")
          .eq("id", userId)
          .maybeSingle();
        return { data, error: error ? { message: error.message } : null };
      },
      logError: (msg: string) => console.error(msg),
    }
  );

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
});
