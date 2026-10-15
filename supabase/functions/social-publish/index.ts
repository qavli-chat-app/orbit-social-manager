import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGIN = "https://qavli-chat-app.github.io";
const SITE_URL = "https://qavli-chat-app.github.io/orbit-social-manager/";
const cors = {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Headers":"authorization, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const META_VERSION = "v23.0";
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:cors});}
function env(name:string){return Deno.env.get(name) || "";}
function adminClient(){
  const url=env("SUPABASE_URL");
  const key=env("SUPABASE_SERVICE_ROLE_KEY") || (()=>{try{return JSON.parse(env("SUPABASE_SECRET_KEYS")).default||"";}catch{return "";}})();
  if(!url||!key)throw new Error("Server-side Supabase credentials are missing.");
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
function validMediaUrl(value:string){
  try {
    const u=new URL(value);
    if(u.protocol!=="https:" || u.username || u.password) return false;
    const h=u.hostname.toLowerCase();
    if(h==="localhost" || h==="127.0.0.1" || h==="::1" || h.endsWith(".local") || h.startsWith("10.") || h.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    return h==="res.cloudinary.com" || (h.endsWith(".supabase.co") && u.pathname.startsWith("/storage/v1/object/public/"));
  } catch { return false; }
}
function encryptionKey(){
  const encoded=env("ORBIT_TOKEN_ENCRYPTION_KEY");
  if(!encoded)throw new Error("ORBIT_TOKEN_ENCRYPTION_KEY is not configured.");
  const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
  if(bytes.length!==32)throw new Error("Encryption key must be base64-encoded 32-byte key material.");
  return bytes;
}
async function decrypt(value:string){
  const [ivText,cipherText]=value.split(".");
  if(!ivText||!cipherText)throw new Error("Stored token data is malformed.");
  const key=await crypto.subtle.importKey("raw",encryptionKey(),"AES-GCM",false,["decrypt"]);
  const iv=Uint8Array.from(atob(ivText),c=>c.charCodeAt(0));
  const cipher=Uint8Array.from(atob(cipherText),c=>c.charCodeAt(0));
  const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher);
  return JSON.parse(new TextDecoder().decode(clear));
}
async function encrypt(value:unknown){
  const key=await crypto.subtle.importKey("raw",encryptionKey(),"AES-GCM",false,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const clear=new TextEncoder().encode(JSON.stringify(value));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,clear));
  return btoa(String.fromCharCode(...iv))+"."+btoa(String.fromCharCode(...cipher));
}
async function providerTokens(admin:ReturnType<typeof createClient>,userId:string,platform:string,accountId?:string){
  if(platform==="youtube"){
    const {data,error}=await admin.from("youtube_oauth_tokens").select("*").eq("user_id",userId).maybeSingle();
    if(error||!data)throw new Error("Connect and verify your YouTube channel first.");
    const tokens=await decrypt(data.encrypted_tokens);
    if(!tokens.refresh_token)throw new Error("YouTube refresh token is missing. Reconnect YouTube with offline access.");
    if(Number(tokens.expiry_date||0)<Date.now()+120000){
      const clientId=env("GOOGLE_CLIENT_ID"),clientSecret=env("GOOGLE_CLIENT_SECRET");
      if(!clientId||!clientSecret)throw new Error("Google OAuth secrets are not configured.");
      const res=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:tokens.refresh_token,grant_type:"refresh_token"})});
      const next=await res.json();
      if(!res.ok||!next.access_token)throw new Error("YouTube token refresh failed. Reconnect the channel.");
      tokens.access_token=next.access_token;tokens.expiry_date=Date.now()+Number(next.expires_in||3600)*1000;
      const encrypted_tokens=await encrypt(tokens);
      await admin.from("youtube_oauth_tokens").update({encrypted_tokens,updated_at:new Date().toISOString()}).eq("user_id",userId);
    }
    return {tokens,accountId:data.channel_id,displayName:data.channel_title};
  }
  const query=admin.from("social_oauth_tokens").select("*").eq("user_id",userId).eq("platform",platform);
  const {data,error}=accountId?await query.eq("provider_account_id",accountId).maybeSingle():await query.order("connected_at",{ascending:false}).limit(1).maybeSingle();
  if(error||!data)throw new Error("Connect and verify the "+platform+" account first.");
  if(data.expires_at && Date.parse(data.expires_at)<Date.now()+60000 && platform==="tiktok") throw new Error("TikTok access token is expired or near expiry. Reconnect the account before publishing.");
  return {tokens:await decrypt(data.encrypted_tokens),accountId:data.provider_account_id,displayName:data.provider_account_id};
}
async function publishYouTube(admin:ReturnType<typeof createClient>,userId:string,draft:any){
  if(!draft.media_url || !validMediaUrl(draft.media_url))throw new Error("YouTube needs a public HTTPS video URL from an approved public Supabase Storage or Cloudinary URL.");
  const {tokens}=await providerTokens(admin,userId,"youtube");
  const media=await fetch(draft.media_url);
  if(!media.ok)throw new Error("The public video URL could not be fetched.");
  const type=media.headers.get("content-type")||"video/mp4";
  if(!type.startsWith("video/") && type!=="application/octet-stream")throw new Error("The media URL does not appear to be a video.");
  const bytes=new Uint8Array(await media.arrayBuffer());
  if(bytes.byteLength>50*1024*1024)throw new Error("This first publishing version supports videos up to 50 MB.");
  const metadata={snippet:{title:String(draft.title||"Orbit upload").slice(0,100),description:String(draft.caption||"").slice(0,5000)},status:{privacyStatus:"private"}};
  const init=await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",{method:"POST",headers:{Authorization:"Bearer "+tokens.access_token,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Type":type,"X-Upload-Content-Length":String(bytes.byteLength)},body:JSON.stringify(metadata)});
  const uploadUrl=init.headers.get("location");
  if(!init.ok||!uploadUrl)throw new Error("YouTube upload could not be initialized. Check upload permission and Google API approval.");
  const uploaded=await fetch(uploadUrl,{method:"PUT",headers:{"Content-Type":type,"Content-Length":String(bytes.byteLength)},body:bytes});
  const result=await uploaded.json();
  if(!uploaded.ok||!result.id)throw new Error("YouTube did not confirm the video upload.");
  return {id:result.id,url:"https://www.youtube.com/watch?v="+result.id,status:"published_private"};
}
async function publishFacebook(admin:ReturnType<typeof createClient>,userId:string,draft:any,accountId?:string){
  const {tokens,accountId:id}=await providerTokens(admin,userId,"facebook",accountId);
  const url=new URL("https://graph.facebook.com/"+META_VERSION+"/"+encodeURIComponent(id)+(draft.media_url?(draft.media_type==="image"?"/photos":"/videos"):"/feed"));
  const form=new URLSearchParams();
  if(draft.media_url){
    if(!validMediaUrl(draft.media_url))throw new Error("Use a public HTTPS media URL hosted on approved public Supabase Storage or Cloudinary.");
    if(draft.media_type==="image"){form.set("url",draft.media_url);form.set("caption",draft.caption||draft.title||"");}
    else {form.set("file_url",draft.media_url);form.set("description",draft.caption||"");form.set("title",draft.title||"");}
  } else form.set("message",[draft.title,draft.caption].filter(Boolean).join("\n\n"));
  const res=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+tokens.access_token,"Content-Type":"application/x-www-form-urlencoded"},body:form});
  const data=await res.json();
  if(!res.ok||data.error||!(data.id||data.post_id))throw new Error(data.error?.message||"Facebook did not confirm the Page post.");
  return {id:data.id||data.post_id,url:null,status:"published"};
}
async function publishInstagram(admin:ReturnType<typeof createClient>,userId:string,draft:any,accountId?:string){
  if(!draft.media_url||!validMediaUrl(draft.media_url))throw new Error("Instagram publishing requires a public HTTPS image/video URL from approved public Supabase Storage or Cloudinary.");
  const {tokens,accountId:id}=await providerTokens(admin,userId,"instagram",accountId);
  const base="https://graph.facebook.com/"+META_VERSION+"/"+encodeURIComponent(id);
  const fields=new URLSearchParams({caption:[draft.caption,draft.hashtags].filter(Boolean).join("\n\n")});
  if(draft.media_type==="image")fields.set("image_url",draft.media_url);
  else {fields.set("media_type","REELS");fields.set("video_url",draft.media_url);}
  fields.set("access_token",tokens.access_token);
  const created=await fetch(base+"/media",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:fields});
  const c=await created.json();
  if(!created.ok||!c.id)throw new Error(c.error?.message||"Instagram media container could not be created.");
  if(draft.media_type!=="image"){
    let ready=false;
    for(let i=0;i<12;i++){
      await new Promise(resolve=>setTimeout(resolve,2500));
      const status=await fetch(base.replace(id,encodeURIComponent(c.id))+"?fields=status_code&access_token="+encodeURIComponent(tokens.access_token));
      const s=await status.json();
      if(s.status_code==="FINISHED"){ready=true;break;}
      if(s.status_code==="ERROR"||s.status_code==="EXPIRED")throw new Error("Instagram could not process this video.");
    }
    if(!ready)throw new Error("Instagram is still processing this video; retry after it finishes.");
  }
  const publish=await fetch(base+"/media_publish",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({creation_id:c.id,access_token:tokens.access_token})});
  const p=await publish.json();
  if(!publish.ok||!p.id)throw new Error(p.error?.message||"Instagram did not confirm publishing.");
  return {id:p.id,url:null,status:"published"};
}
async function publishTikTok(admin:ReturnType<typeof createClient>,userId:string,draft:any,accountId?:string){
  if(!draft.media_url||!validMediaUrl(draft.media_url))throw new Error("TikTok upload needs a public HTTPS video URL from a domain you own and have verified with TikTok.");
  if(draft.media_type==="image")throw new Error("This first TikTok publishing path supports videos only.");
  const {tokens}=await providerTokens(admin,userId,"tiktok",accountId);
  // Use TikTok's official inbox-upload flow. User must finish editing/publishing inside TikTok.
  const res=await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",{
    method:"POST",headers:{Authorization:"Bearer "+tokens.access_token,"Content-Type":"application/json; charset=UTF-8"},
    body:JSON.stringify({post_info:{title:String(draft.caption||draft.title||"").slice(0,2200)},source_info:{source:"PULL_FROM_URL",video_url:draft.media_url}})
  });
  const data=await res.json();
  if(!res.ok||data.error?.code!=="ok"||!data.data?.publish_id)throw new Error(data.error?.message||"TikTok did not accept the draft upload. Check video.upload approval and verified domain.");
  return {id:data.data.publish_id,url:"https://www.tiktok.com/",status:"uploaded_to_inbox_finish_in_tiktok"};
}
async function publishOne(admin:ReturnType<typeof createClient>,userId:string,platform:string,draft:any,accountId?:string){
  if(platform==="youtube")return await publishYouTube(admin,userId,draft);
  if(platform==="facebook")return await publishFacebook(admin,userId,draft,accountId);
  if(platform==="instagram")return await publishInstagram(admin,userId,draft,accountId);
  if(platform==="tiktok")return await publishTikTok(admin,userId,draft,accountId);
  throw new Error("Publishing is not implemented for this platform.");
}
async function handleUser(req:Request,admin:ReturnType<typeof createClient>,userId:string,body:any){
  const platform=String(body.platform||"").toLowerCase();
  const supported=["youtube","facebook","instagram","tiktok"];
  if(!supported.includes(platform))throw new Error("Choose YouTube, Facebook, Instagram, or TikTok.");
  const draft={
    title:String(body.title||"").slice(0,120),caption:String(body.caption||"").slice(0,5000),
    hashtags:String(body.hashtags||"").slice(0,1000),media_url:String(body.media_url||""),
    media_type:body.media_type==="image"?"image":body.media_url?"video":null
  };
  if(!draft.title&&!draft.caption&&!draft.media_url)throw new Error("Add a title, caption, or media URL first.");
  if(draft.media_url&&!validMediaUrl(draft.media_url))throw new Error("Media URL must be HTTPS and hosted on public Supabase Storage or Cloudinary.");
  if(body.action==="schedule"){
    const scheduledFor=Date.parse(String(body.scheduled_for||""));
    if(!Number.isFinite(scheduledFor)||scheduledFor<Date.now()+60000)throw new Error("Choose a schedule time at least one minute in the future.");
    const {data:d,error:dError}=await admin.from("drafts").insert({user_id:userId,title:draft.title||"Untitled draft",caption:draft.caption,hashtags:String(draft.hashtags).split(/\s+/).filter(Boolean),media_url:draft.media_url||null,media_type:draft.media_type}).select("id").single();
    if(dError||!d)throw new Error("Could not save a private cloud draft for scheduling.");
    const {data:job,error}=await admin.from("publish_jobs").insert({user_id:userId,draft_id:d.id,platform,scheduled_for:new Date(scheduledFor).toISOString(),status:"queued"}).select("id,status,scheduled_for").single();
    if(error||!job)throw new Error("Could not queue the scheduled post.");
    return {ok:true,scheduled:true,job};
  }
  const result=await publishOne(admin,userId,platform,draft,body.account_id?String(body.account_id):undefined);
  return {ok:true,published:true,platform,result};
}
Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{headers:cors});
  if(req.method!=="POST")return json({error:"Use POST."},405);
  let body:any={};try{body=await req.json();}catch{return json({error:"Invalid JSON body."},400);}
  let admin;try{admin=adminClient();}catch{return json({error:"Server-side Supabase credentials are missing."},503);}
  if(body.action==="run-due"){
    const expected=env("ORBIT_WORKER_SECRET");
    const auth=req.headers.get("Authorization")||"";
    if(!expected||auth!=="Bearer "+expected)return json({error:"Worker authorization failed."},401);
    const {data:jobs,error}=await admin.from("publish_jobs").select("id,user_id,platform,draft_id").eq("status","queued").lte("scheduled_for",new Date().toISOString()).order("scheduled_for",{ascending:true}).limit(10);
    if(error)return json({error:"Could not read due publishing jobs."},500);
    const results=[];
    for(const job of jobs||[]){
      const claim=await admin.from("publish_jobs").update({status:"processing",updated_at:new Date().toISOString()}).eq("id",job.id).eq("status","queued").select("id").maybeSingle();
      if(!claim.data){results.push({id:job.id,status:"skipped"});continue;}
      try{
        const {data:draft,error:dError}=await admin.from("drafts").select("title,caption,hashtags,media_url,media_type").eq("id",job.draft_id).eq("user_id",job.user_id).single();
        if(dError||!draft)throw new Error("Scheduled draft is missing.");
        const result=await publishOne(admin,job.user_id,job.platform,draft);
        await admin.from("publish_jobs").update({status:"published",result_url:result.url||result.id,error_message:null,updated_at:new Date().toISOString()}).eq("id",job.id);
        results.push({id:job.id,status:"published"});
      }catch(error){
        const msg=error instanceof Error?error.message:"Publishing failed.";
        await admin.from("publish_jobs").update({status:"failed",error_message:msg.slice(0,500),updated_at:new Date().toISOString()}).eq("id",job.id);
        results.push({id:job.id,status:"failed",error:msg});
      }
    }
    return json({ok:true,processed:results.length,results});
  }
  const auth=req.headers.get("Authorization")||"";
  const jwt=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!jwt)return json({error:"Sign in to Orbit first."},401);
  const {data,error}=await admin.auth.getUser(jwt);
  if(error||!data.user)return json({error:"Session invalid or expired. Sign in again."},401);
  try{return json(await handleUser(req,admin,data.user.id,body));}
  catch(error){return json({error:error instanceof Error?error.message:"Publishing failed."},400);}
});
