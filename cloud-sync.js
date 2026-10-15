import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://bimngjcqcebertsgvovl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_85ACSskK3OMoCOobov8_tQ_93xhAhcC";
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const panel = document.createElement("section");
panel.className = "card span12";
panel.id = "cloudAccount";
panel.innerHTML = `
  <div class="card-head"><h2>Account & cloud drafts</h2><span class="pill" id="cloudBadge">Not signed in</span></div>
  <p class="sub" style="font-size:13px;margin-bottom:12px">Create an account or sign in to sync text drafts to your private workspace. Video files are not uploaded by this feature.</p>
  <div class="row" style="align-items:flex-end">
    <div class="field" style="flex:1;min-width:190px;margin:0"><label for="cloudEmail">Email</label><input id="cloudEmail" type="email" autocomplete="email" placeholder="you@example.com"></div>
    <div class="field" style="flex:1;min-width:190px;margin:0"><label for="cloudPassword">Password</label><input id="cloudPassword" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters"></div>
  </div>
  <div class="row" style="margin-top:12px">
    <button class="btn primary" id="cloudSignIn">Sign in</button>
    <button class="btn" id="cloudSignUp">Create account</button>
    <button class="btn" id="cloudSignOut" hidden>Sign out</button>
    <button class="btn" id="cloudSync" hidden>Sync local drafts</button>
    <button class="btn" id="cloudRefresh" hidden>Refresh cloud drafts</button>\n    <button class="btn" id="youtubeConnect" hidden>Connect YouTube</button>
    <button class="btn" id="facebookConnect" hidden>Connect Facebook Pages</button>
    <button class="btn" id="instagramConnect" hidden>Connect Instagram</button>
    <button class="btn" id="tiktokConnect" hidden>Connect TikTok</button>
  </div>
  <p id="cloudMessage" class="mini" role="status" aria-live="polite" style="margin-top:12px">Cloud database is configured; social platforms are not connected yet.</p>
  <div id="cloudDraftList" style="margin-top:10px"></div>
`;
const mainGrid = document.querySelector(".main .grid");
if (mainGrid) mainGrid.before(panel);

const $ = (id) => document.getElementById(id);
const message = (text, bad = false) => {
  $("cloudMessage").textContent = text;
  $("cloudMessage").style.color = bad ? "#ff9999" : "var(--muted)";
};
const setBusy = (busy) => {
  ["cloudSignIn", "cloudSignUp", "cloudSync", "cloudRefresh", "youtubeConnect", "facebookConnect", "instagramConnect", "tiktokConnect"].forEach(id => {
    const el = $(id); if (el && !el.hidden) el.disabled = busy;
  });
};
const getCredentials = () => ({
  email: $("cloudEmail").value.trim(),
  password: $("cloudPassword").value
});
const authError = (error) => message(error?.message || "Request failed. Please try again.", true);

async function signIn() {
  const { email, password } = getCredentials();
  if (!email || password.length < 8) return message("Enter your email and a password of at least 8 characters.", true);
  setBusy(true);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    message("Signed in. Your cloud drafts are private to this account.");
    await refreshCloudDrafts();
  } catch (error) { authError(error); }
  finally { setBusy(false); }
}

async function signUp() {
  const { email, password } = getCredentials();
  if (!email || password.length < 8) return message("Enter your email and a password of at least 8 characters.", true);
  setBusy(true);
  try {
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
    if (error) throw error;
    message(data.session
      ? "Account created and signed in."
      : "Account created. Check your email for a confirmation link, then sign in.");
  } catch (error) { authError(error); }
  finally { setBusy(false); }
}

function localDrafts() {
  try {
    const value = JSON.parse(localStorage.getItem("orbitDrafts") || "[]");
    return Array.isArray(value) ? value : [];
  } catch { return []; }
}

async function syncLocalDrafts() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return message("Sign in before syncing drafts.", true);
  const local = localDrafts();
  if (!local.length) return message("There are no local drafts to sync yet.");
  setBusy(true);
  try {
    const rows = local.map(draft => {
      const ids = draft.cloudIds && typeof draft.cloudIds === "object" ? draft.cloudIds : {};
      if (!ids[user.id]) ids[user.id] = crypto.randomUUID();
      draft.cloudIds = ids;
      const hashtags = String(draft.hashtags || "").split(/\s+/).map(tag => tag.replace(/^#+/, "")).filter(Boolean);
      return {
        id: ids[user.id],
        user_id: user.id,
        title: String(draft.title || "Untitled draft").slice(0, 120),
        caption: String(draft.caption || ""),
        hashtags,
        updated_at: new Date().toISOString()
      };
    });
    localStorage.setItem("orbitDrafts", JSON.stringify(local));
    const { error } = await supabase.from("drafts").upsert(rows, { onConflict: "id" });
    if (error) throw error;
    message(`Synced ${rows.length} text draft(s). Local video files were not uploaded.`);
    await refreshCloudDrafts();
  } catch (error) { authError(error); }
  finally { setBusy(false); }
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

async function refreshCloudDrafts() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  setBusy(true);
  try {
    const { data, error } = await supabase.from("drafts")
      .select("id,title,caption,hashtags,updated_at")
      .order("updated_at", { ascending: false })
      .limit(20);
    if (error) throw error;
    const list = $("cloudDraftList");
    if (!data?.length) {
      list.innerHTML = '<div class="empty">No cloud drafts yet. Save a local draft and select “Sync local drafts”.</div>';
      return;
    }
    list.innerHTML = '<div class="card-head"><h2>Private cloud drafts</h2><span class="pill">' + data.length + ' shown</span></div>';
    data.forEach(draft => {
      const row = document.createElement("div");
      row.className = "task";
      row.innerHTML = '<div><b>' + safeText(draft.title || "Untitled draft") + '</b><small>' +
        safeText((draft.hashtags || []).map(tag => "#" + tag).join(" ")) + ' · ' +
        safeText(new Date(draft.updated_at).toLocaleString()) + '</small></div>';
      const load = document.createElement("button");
      load.className = "btn";
      load.textContent = "Load";
      load.addEventListener("click", () => {
        $("postTitle").value = draft.title || "";
        $("caption").value = draft.caption || "";
        $("hashtags").value = (draft.hashtags || []).map(tag => "#" + tag).join(" ");
        $("publish").scrollIntoView({ behavior: "smooth", block: "start" });
        message("Cloud draft loaded into Publish Studio.");
      });
      row.append(load);
      list.append(row);
    });
  } catch (error) { authError(error); }
  finally { setBusy(false); }
}

function updateAuthUi(session) {
  const signedIn = Boolean(session?.user);
  $("cloudBadge").textContent = signedIn ? "Signed in" : "Not signed in";
  $("cloudSignIn").hidden = signedIn;
  $("cloudSignUp").hidden = signedIn;
  $("cloudSignOut").hidden = !signedIn;
  $("cloudSync").hidden = !signedIn;
  $("cloudRefresh").hidden = !signedIn;
  $("youtubeConnect").hidden = !signedIn;
  $("facebookConnect").hidden = !signedIn;
  $("instagramConnect").hidden = !signedIn;
  $("tiktokConnect").hidden = !signedIn;
  $("cloudEmail").disabled = signedIn;
  $("cloudPassword").disabled = signedIn;
  if (signedIn) {
    $("cloudEmail").value = session.user.email || "";
    message("Signed in as " + (session.user.email || "your account") + ". Cloud drafts are owner-protected.");
    refreshCloudDrafts();
    refreshYouTubeStatus();
    refreshSocialStatus();
  } else {
    $("cloudDraftList").innerHTML = "";
  }
}

$("cloudSignIn").addEventListener("click", signIn);
$("cloudSignUp").addEventListener("click", signUp);
$("cloudSync").addEventListener("click", syncLocalDrafts);
$("cloudRefresh").addEventListener("click", refreshCloudDrafts);
async function refreshYouTubeStatus() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from("social_accounts")
    .select("display_name,connection_status,connected_at")
    .eq("platform", "youtube").eq("connection_status", "connected")
    .order("connected_at", { ascending: false }).limit(1);
  if (error) return;
  if (data?.length) {
    $("youtubeConnect").textContent = "YouTube connected: " + (data[0].display_name || "Channel");
    $("youtubeConnect").classList.add("success");
  } else {
    $("youtubeConnect").textContent = "Connect YouTube";
    $("youtubeConnect").classList.remove("success");
  }
  refreshConnectedCount();
}
$("youtubeConnect").addEventListener("click", async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return message("Sign in before connecting YouTube.", true);
  setBusy(true);
  try {
    const response = await fetch("https://bimngjcqcebertsgvovl.supabase.co/functions/v1/youtube-oauth?action=start", {
      method: "GET",
      headers: { "apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": "Bearer " + session.access_token }
    });
    const data = await response.json();
    if (!response.ok || !data.authorization_url) throw new Error(data.error || "YouTube OAuth setup is not ready.");
    window.location.assign(data.authorization_url);
  } catch (error) {
    message(error?.message || "Unable to start YouTube authorization.", true);
    setBusy(false);
  }
});

async function refreshSocialStatus() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from("social_accounts")
    .select("platform,display_name,connection_status")
    .in("platform", ["facebook", "instagram", "tiktok"])
    .eq("connection_status", "connected")
    .order("connected_at", { ascending: false });
  if (error) return;
  const rows = data || [];
  const label = (platform, fallback) => {
    const item = rows.find(row => row.platform === platform);
    return item ? "Connected: " + (item.display_name || fallback) : "Connect " + fallback;
  };
  $("facebookConnect").textContent = label("facebook", "Facebook Pages");
  $("instagramConnect").textContent = label("instagram", "Instagram");
  $("tiktokConnect").textContent = label("tiktok", "TikTok");
  ["facebookConnect", "instagramConnect", "tiktokConnect"].forEach(id => {
    const connected = $(""+id).textContent.startsWith("Connected:");
    $(""+id).classList.toggle("success", connected);
  });
  refreshConnectedCount();
}
async function refreshConnectedCount() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { data, error } = await supabase.from("social_accounts")
    .select("platform,provider_account_id")
    .eq("connection_status", "connected");
  if (error) return;
  const unique = new Set((data || []).map(row => row.platform + ":" + row.provider_account_id));
  const stat = document.getElementById("connectedStat");
  if (stat) stat.textContent = unique.size + " / 8";
}
async function connectSocial(platform, buttonId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return message("Sign in before connecting a social account.", true);
  setBusy(true);
  try {
    const response = await fetch("https://bimngjcqcebertsgvovl.supabase.co/functions/v1/social-oauth?action=start&platform=" + encodeURIComponent(platform), {
      method: "GET",
      headers: { "apikey": SUPABASE_PUBLISHABLE_KEY, "Authorization": "Bearer " + session.access_token }
    });
    const data = await response.json();
    if (!response.ok || !data.authorization_url) throw new Error(data.error || "Social OAuth setup is not ready.");
    window.location.assign(data.authorization_url);
  } catch (error) {
    message(error?.message || "Unable to start social authorization.", true);
    setBusy(false);
  }
}
$("facebookConnect").addEventListener("click", () => connectSocial("facebook", "facebookConnect"));
$("instagramConnect").addEventListener("click", () => connectSocial("instagram", "instagramConnect"));
$("tiktokConnect").addEventListener("click", () => connectSocial("tiktok", "tiktokConnect"));

const params = new URLSearchParams(window.location.search);
if (params.get("youtube_connected") === "1") {
  message("YouTube channel authorization was verified. Sign in to refresh its connection status.");
  params.delete("youtube_connected");
if (params.has("social_connected")) {
  const platform = params.get("social_connected");
  const pages = params.get("pages");
  const instagram = params.get("instagram");
  message(platform === "meta"
    ? "Meta OAuth verified. Saved " + (pages || "0") + " Facebook Page(s) and " + (instagram || "0") + " Instagram professional account(s)."
    : "TikTok OAuth and account profile verified. Refreshing connection status.");
  params.delete("social_connected");
  params.delete("pages");
  params.delete("instagram");
}
  const clean = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
  window.history.replaceState({}, "", clean);
}

$("cloudSignOut").addEventListener("click", async () => {
  const { error } = await supabase.auth.signOut();
  if (error) authError(error);
  else message("Signed out.");
});
supabase.auth.onAuthStateChange((_event, session) => updateAuthUi(session));
supabase.auth.getSession().then(({ data, error }) => {
  if (error) authError(error);
  else updateAuthUi(data.session);
});
