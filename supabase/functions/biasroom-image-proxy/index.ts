import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") return jsonError("POST only", 405);

  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonError("管理者としてログインしてください。", 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return jsonError("Supabaseの環境変数が設定されていません。", 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return jsonError("ログイン状態を確認できません。", 401);
  }

  const { data: admin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError || admin !== true) {
    return jsonError("この機能は管理者専用です。", 403);
  }

  let input: { url?: string };
  try {
    input = await req.json();
  } catch {
    return jsonError("画像URLを読み取れませんでした。", 400);
  }

  let imageUrl: URL;
  try {
    imageUrl = new URL(input.url || "");
  } catch {
    return jsonError("有効な画像URLを入力してください。", 400);
  }

  const hostAllowed = imageUrl.hostname === "biasroomcdn.com" ||
    imageUrl.hostname.endsWith(".biasroomcdn.com");
  if (imageUrl.protocol !== "https:" || !hostAllowed || imageUrl.username || imageUrl.password) {
    return jsonError("biasroomcdn.com のHTTPS画像URLのみ取得できます。", 400);
  }

  let remote: Response;
  try {
    remote = await fetch(imageUrl.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "image/jpeg,image/png,image/webp,image/avif" },
    });
  } catch {
    return jsonError("Biasroom CDNに接続できませんでした。", 502);
  }

  if (remote.status >= 300 && remote.status < 400) {
    return jsonError("画像URLが別のURLへ転送されました。Open originalのURLを確認してください。", 400);
  }
  if (!remote.ok) return jsonError("画像を取得できませんでした（HTTP " + remote.status + "）。", 502);

  const contentType = (remote.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
  if (!allowedTypes.has(contentType)) {
    return jsonError("JPEG・PNG・WebP・AVIF形式の画像のみ対応しています。", 415);
  }

  const declaredLength = Number(remote.headers.get("content-length") || 0);
  if (declaredLength > 12 * 1024 * 1024) {
    return jsonError("画像サイズが12MBを超えています。", 413);
  }

  const bytes = await remote.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > 12 * 1024 * 1024) {
    return jsonError("画像が空か、12MBを超えています。", 413);
  }

  return new Response(bytes, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
