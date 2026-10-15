import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://qavli-chat-app.github.io",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const SITE_URL = "https://qavli-chat-app.github.io/orbit-social-manager/";
const CALLBACK_URL = "https://bimngjcqcebertsgvovl.supabase.co/functions/v1/youtube-oauth";
const SCOPES = ["https://www.googleapis.com/auth/youtube.readonly"];

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
function htmlPage(title: string, message: string, status = 200) {
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px system-ui;max-width:640px;margin:12vh auto;padding:24px;background:#101323;color:#f5f7ff"><h1>${title}</h1><p>${message}</p><p><a style="color:#9cc8ff" href="${SITE_URL}">Return to Orbit Social Manager</a></p></body></html>`, {status,headers:{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"}});
}
function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
function getSecrets() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const encryptionKey = Deno.env.get("ORBIT_TOKEN_ENCRYPTION_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const secretKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (() => {
    try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default; } catch { return undefined; }
  })();
  return {clientId, clientSecret, encryptionKey, url, secretKey};
}
function adminClient() {
  const {url, secretKey} = getSecrets();
  if (!url || !secretKey) throw new Error("Supabase server configuration is missing.");
  return createClient(url, secretKey, {auth:{persistSession:false,autoRefreshToken:false}});
}
async function encryptTokens(value: unknown, encodedKey: string) {
  const keyBytes = Uint8Array.from(atob(encodedKey), c => c.charCodeAt(0));
  if (keyBytes.byteLength !== 32) throw new Error("ORBIT_TOKEN_ENCRYPTION_KEY must be base64-encoded 32-byte key material.");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const clear = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv}, key, clear));
  return btoa(String.fromCharCode(...iv)) + "." + btoa(String.fromCharCode(...ciphertext));
}
function renderGoogleError(error: string) {
  const safe = error.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"} as Record<string,string>)[c]);
  return htmlPage("YouTube connection not completed", "Google did not complete authorization ("+safe+"). No account is marked connected. Return to Orbit and try again after checking OAuth setup.", 400);
}
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, {headers:cors});
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  if (req.method === "GET" && url.searchParams.has("code")) {
    const oauthError = url.searchParams.get("error");
    if (oauthError) return renderGoogleError(oauthError);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || state.length > 256) return htmlPage("Invalid OAuth response", "The authorization response was incomplete. Please start again.", 400);
    const secrets = getSecrets();
    if (!secrets.clientId || !secrets.clientSecret || !secrets.encryptionKey) {
      return htmlPage("YouTube setup required", "OAuth server secrets are not configured yet. No connection was saved. Finish the secure setup in Supabase Edge Function secrets.", 503);
    }
    let admin;
    try { admin = adminClient(); } catch { return htmlPage("Server setup required", "The server-side Supabase key is missing. No connection was saved.", 503); }
    const {data: stateRow, error: stateError} = await admin.from("youtube_oauth_states").select("user_id,expires_at").eq("state", state).maybeSingle();
    if (stateError || !stateRow || Date.parse(stateRow.expires_at) < Date.now()) {
      await admin.from("youtube_oauth_states").delete().eq("state", state);
      return htmlPage("Authorization expired", "This one-time authorization request expired or was already used. Start again from Orbit Social Manager.", 400);
    }
    const {error: deleteStateError} = await admin.from("youtube_oauth_states").delete().eq("state", state);
    if (deleteStateError) return htmlPage("Authorization error", "The one-time authorization state could not be consumed safely. Please retry.", 500);

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({code,client_id:secrets.clientId,client_secret:secrets.clientSecret,redirect_uri:CALLBACK_URL,grant_type:"authorization_code"})
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) return htmlPage("Token exchange failed", "Google did not return a valid token. Check client ID, secret, redirect URI, and OAuth consent setup.", 400);
      const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true", {
        headers:{Authorization:"Bearer "+tokens.access_token}
      });
      const channelData = await channelResponse.json();
      const channel = channelData.items?.[0];
      if (!channelResponse.ok || !channel?.id) return htmlPage("Channel not found", "Google authorized the request, but no YouTube channel could be verified. No connection was saved.", 400);
      const encrypted = await encryptTokens({
        access_token:tokens.access_token, refresh_token:tokens.refresh_token ?? null,
        token_type:tokens.token_type, expiry_date:Date.now() + Number(tokens.expires_in ?? 3600)*1000,
        scope:tokens.scope ?? SCOPES.join(" ")
      }, secrets.encryptionKey);
      const {error: tokenError} = await admin.from("youtube_oauth_tokens").upsert({
        user_id:stateRow.user_id, channel_id:channel.id, channel_title:channel.snippet?.title ?? null,
        encrypted_tokens:encrypted, scopes:(tokens.scope ?? SCOPES.join(" ")).split(" "),
        connected_at:new Date().toISOString(), updated_at:new Date().toISOString()
      }, {onConflict:"user_id"});
      if (tokenError) throw new Error("Could not securely save the token record.");
      const {error: accountError} = await admin.from("social_accounts").upsert({
        user_id:stateRow.user_id, platform:"youtube", provider_account_id:channel.id,
        display_name:channel.snippet?.title ?? "YouTube channel", connection_status:"connected",
        connected_at:new Date().toISOString(), updated_at:new Date().toISOString()
      }, {onConflict:"user_id,platform,provider_account_id"});
      if (accountError) throw new Error("Could not save the connection status.");
      return Response.redirect(SITE_URL + "?youtube_connected=1", 302);
    } catch (error) {
      console.error("YouTube OAuth callback failed:", error instanceof Error ? error.message : "unknown error");
      return htmlPage("YouTube connection failed", "The callback could not finish safely. No success is being reported. Check the function logs and try again.", 500);
    }
  }

  if (req.method === "GET" && action === "start") {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) return reply({error:"Sign in to Orbit first."}, 401);
    let admin;
    try { admin = adminClient(); } catch { return reply({error:"Server configuration is incomplete."}, 503); }
    const {data: userData, error: userError} = await admin.auth.getUser(jwt);
    if (userError || !userData.user) return reply({error:"Your session is invalid or expired. Sign in again."}, 401);
    const secrets = getSecrets();
    if (!secrets.clientId || !secrets.clientSecret || !secrets.encryptionKey) {
      return reply({error:"YouTube OAuth secrets are not configured yet. No connection has been started."}, 503);
    }
    const state = randomState();
    const {error: stateInsertError} = await admin.from("youtube_oauth_states").insert({
      state, user_id:userData.user.id, expires_at:new Date(Date.now()+10*60*1000).toISOString()
    });
    if (stateInsertError) return reply({error:"Could not create a secure one-time authorization request."}, 500);
    const googleUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    googleUrl.search = new URLSearchParams({
      client_id:secrets.clientId, redirect_uri:CALLBACK_URL, response_type:"code",
      scope:SCOPES.join(" "), access_type:"offline", prompt:"consent",
      include_granted_scopes:"true", state
    }).toString();
    return reply({authorization_url:googleUrl.toString()});
  }
  return reply({error:"Unsupported request."}, 404);
});
