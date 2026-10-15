import { createClient } from "npm:@supabase/supabase-js@2";

const SITE_URL = "https://qavli-chat-app.github.io/orbit-social-manager/";
const CALLBACK_URL = "https://bimngjcqcebertsgvovl.supabase.co/functions/v1/social-oauth";
const ORIGIN = "https://qavli-chat-app.github.io";
const cors = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function page(title: string, message: string, status = 200) {
  const esc = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;background:#101323;color:#f5f7ff"><h1>${esc(title)}</h1><p>${esc(message)}</p><p><a style="color:#9cc8ff" href="${SITE_URL}">Return to Orbit Social Manager</a></p></body></html>`, {status, headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
function secrets() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default; } catch { return undefined; }
  })();
  return {
    url, key,
    encryption: Deno.env.get("ORBIT_TOKEN_ENCRYPTION_KEY"),
    metaId: Deno.env.get("META_APP_ID"),
    metaSecret: Deno.env.get("META_APP_SECRET"),
    ttKey: Deno.env.get("TIKTOK_CLIENT_KEY"),
    ttSecret: Deno.env.get("TIKTOK_CLIENT_SECRET"),
  };
}
function adminClient() {
  const s = secrets();
  if (!s.url || !s.key) throw new Error("Server-side Supabase credentials are missing.");
  return createClient(s.url, s.key, {auth:{persistSession:false,autoRefreshToken:false}});
}
function randomState() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,"0")).join("");
}
async function encrypt(value: unknown) {
  const encoded = secrets().encryption;
  if (!encoded) throw new Error("ORBIT_TOKEN_ENCRYPTION_KEY is missing.");
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0)); } catch { throw new Error("Encryption key is not valid base64."); }
  if (raw.length !== 32) throw new Error("Encryption key must be base64-encoded 32-byte key material.");
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, clear));
  return btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...cipher));
}
async function storeAccount(admin: ReturnType<typeof createClient>, userId: string, platform: string, accountId: string, name: string, tokenBundle: unknown, scopes: string[], expiresAt: string | null) {
  const encrypted = await encrypt(tokenBundle);
  const {error: tokenError} = await admin.from("social_oauth_tokens").upsert({
    user_id:userId, platform, provider_account_id:accountId, encrypted_tokens:encrypted,
    scopes, expires_at:expiresAt, connected_at:new Date().toISOString(), updated_at:new Date().toISOString()
  }, {onConflict:"user_id,platform,provider_account_id"});
  if (tokenError) throw new Error("Secure token storage failed.");
  const {error: accountError} = await admin.from("social_accounts").upsert({
    user_id:userId, platform, provider_account_id:accountId, display_name:name,
    connection_status:"connected", connected_at:new Date().toISOString(), updated_at:new Date().toISOString()
  }, {onConflict:"user_id,platform,provider_account_id"});
  if (accountError) throw new Error("Account status could not be saved.");
}
async function start(platform: string, userId: string, admin: ReturnType<typeof createClient>) {
  const s = secrets();
  let authorization: URL;
  let required: string[] = [];
  if (platform === "facebook" || platform === "instagram") {
    if (!s.metaId || !s.metaSecret || !s.encryption) throw new Error("Meta app credentials and encryption key are not configured in Supabase secrets.");
    required = ["pages_show_list","pages_read_engagement","pages_manage_posts","instagram_basic","instagram_content_publish"];
    authorization = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    authorization.search = new URLSearchParams({
      client_id:s.metaId, redirect_uri:CALLBACK_URL, response_type:"code",
      scope:required.join(","), state:"pending"
    }).toString();
  } else if (platform === "tiktok") {
    if (!s.ttKey || !s.ttSecret || !s.encryption) throw new Error("TikTok app credentials and encryption key are not configured in Supabase secrets.");
    required = ["user.info.basic","video.publish","video.upload"];
    authorization = new URL("https://www.tiktok.com/v2/auth/authorize/");
    authorization.search = new URLSearchParams({
      client_key:s.ttKey, redirect_uri:CALLBACK_URL, response_type:"code",
      scope:required.join(","), state:"pending"
    }).toString();
  } else {
    throw new Error("Unsupported social platform.");
  }
  const state = randomState();
  const {error} = await admin.from("social_oauth_states").insert({
    state, user_id:userId, platform, expires_at:new Date(Date.now()+10*60*1000).toISOString()
  });
  if (error) throw new Error("Could not create secure one-time authorization state.");
  authorization.searchParams.set("state", state);
  return authorization.toString();
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null,{headers:cors});
  const url = new URL(req.url);
  if (req.method !== "GET") return json({error:"Method not supported."},405);

  // Provider callback
  if (url.searchParams.has("code") || url.searchParams.has("error")) {
    const providerError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (providerError) return page("Connection not completed", providerError, 400);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state.length > 256) return page("Invalid authorization", "The provider response was incomplete. Start again from Orbit.",400);
    let admin;
    try { admin = adminClient(); } catch { return page("Server setup required","Supabase server credentials are not configured.",503); }
    const {data: stateRow, error: stateError} = await admin.from("social_oauth_states").select("user_id,platform,expires_at").eq("state",state).maybeSingle();
    if (stateError || !stateRow || Date.parse(stateRow.expires_at) < Date.now()) {
      await admin.from("social_oauth_states").delete().eq("state",state);
      return page("Authorization expired","This one-time request expired or was already used. Start again.",400);
    }
    const {error: consumeError} = await admin.from("social_oauth_states").delete().eq("state",state);
    if (consumeError) return page("Authorization error","The one-time state could not be consumed safely. Retry.",500);
    const s = secrets();
    try {
      if (stateRow.platform === "facebook" || stateRow.platform === "instagram") {
        if (!s.metaId || !s.metaSecret || !s.encryption) return page("Meta setup required","Meta app credentials and encryption key are not configured in Supabase secrets.",503);
        const tokenUrl = new URL("https://graph.facebook.com/v23.0/oauth/access_token");
        tokenUrl.search = new URLSearchParams({client_id:s.metaId,client_secret:s.metaSecret,redirect_uri:CALLBACK_URL,code}).toString();
        const tokenRes = await fetch(tokenUrl);
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) return page("Meta token exchange failed","Check the Meta app credentials, redirect URI, and OAuth configuration.",400);
        const longUrl = new URL("https://graph.facebook.com/v23.0/oauth/access_token");
        longUrl.search = new URLSearchParams({grant_type:"fb_exchange_token",client_id:s.metaId,client_secret:s.metaSecret,fb_exchange_token:tokenData.access_token}).toString();
        const longRes = await fetch(longUrl);
        const longData = await longRes.json();
        const userToken = longRes.ok && longData.access_token ? longData.access_token : tokenData.access_token;
        const meRes = await fetch("https://graph.facebook.com/v23.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&limit=100", {headers:{Authorization:"Bearer "+userToken}});
        const meData = await meRes.json();
        if (!meRes.ok || !Array.isArray(meData.data) || !meData.data.length) return page("No Facebook Pages found","This login did not return any accessible Pages. Use a Facebook account with Page access and retry.",400);
        const scopes = ["pages_show_list","pages_read_engagement","pages_manage_posts","instagram_basic","instagram_content_publish"];
        let savedPages = 0, savedInstagram = 0;
        for (const p of meData.data) {
          if (!p.id || !p.access_token) continue;
          const pageToken = p.access_token;
          await storeAccount(admin,stateRow.user_id,"facebook",String(p.id),String(p.name || "Facebook Page"),{access_token:pageToken,token_type:"bearer",page_id:String(p.id)},scopes,null);
          savedPages++;
          const ig = p.instagram_business_account;
          if (ig?.id) {
            await storeAccount(admin,stateRow.user_id,"instagram",String(ig.id),String(ig.username || ig.name || "Instagram Professional"),{access_token:pageToken,token_type:"bearer",page_id:String(p.id),instagram_user_id:String(ig.id)},scopes,null);
            savedInstagram++;
          }
        }
        if (!savedPages) return page("No Pages connected","Meta returned no usable Page access tokens. No success is being reported.",400);
        return Response.redirect(SITE_URL + "?social_connected=meta&pages=" + savedPages + "&instagram=" + savedInstagram,302);
      }

      if (stateRow.platform === "tiktok") {
        if (!s.ttKey || !s.ttSecret || !s.encryption) return page("TikTok setup required","TikTok app credentials and encryption key are not configured in Supabase secrets.",503);
        const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/",{
          method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
          body:new URLSearchParams({client_key:s.ttKey,client_secret:s.ttSecret,code,grant_type:"authorization_code",redirect_uri:CALLBACK_URL})
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token || !tokenData.open_id) return page("TikTok token exchange failed","Check the TikTok app, approved scopes, and redirect URI.",400);
        const infoRes = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {headers:{Authorization:"Bearer "+tokenData.access_token}});
        const infoData = await infoRes.json();
        const user = infoData.data?.user;
        if (!infoRes.ok || !user?.open_id) return page("TikTok account not verified","OAuth returned a token, but the account profile could not be verified.",400);
        const expiry = new Date(Date.now()+Number(tokenData.expires_in || 86400)*1000).toISOString();
        await storeAccount(admin,stateRow.user_id,"tiktok",String(user.open_id),String(user.display_name || "TikTok account"),{
          access_token:tokenData.access_token,refresh_token:tokenData.refresh_token || null,open_id:user.open_id,
          expires_at:expiry,refresh_expires_in:tokenData.refresh_expires_in || null,scope:tokenData.scope || ""
        },String(tokenData.scope || "").split(",").filter(Boolean),expiry);
        return Response.redirect(SITE_URL + "?social_connected=tiktok",302);
      }
      return page("Unsupported platform","This platform is not supported by this callback.",400);
    } catch (error) {
      console.error("Social OAuth callback failed:",error instanceof Error?error.message:"unknown error");
      return page("Connection could not be verified","The server could not complete account verification and secure storage. Check Edge Function logs and retry.",500);
    }
  }

  if (url.searchParams.get("action") !== "start") return json({error:"Unsupported request."},404);
  const platform = (url.searchParams.get("platform") || "").toLowerCase();
  const auth = req.headers.get("Authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return json({error:"Sign in to Orbit first."},401);
  let admin;
  try { admin = adminClient(); } catch { return json({error:"Server-side Supabase credentials are missing."},503); }
  const {data,error} = await admin.auth.getUser(jwt);
  if (error || !data.user) return json({error:"Session invalid or expired. Sign in again."},401);
  try {
    const authorization_url = await start(platform,data.user.id,admin);
    return json({authorization_url});
  } catch (error) {
    return json({error:error instanceof Error?error.message:"Unable to start authorization."},503);
  }
});
