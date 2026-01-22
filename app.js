/* =========================
   Elite Used Market - app.js (FULL)
   ========================= */

let SB_URL = "";
let SB_KEY = "";
let _sb = null;

/* ===== State ===== */
let user = null;
let activeAd = null;
let activeConversationId = null;
let allAdsCache = [];

/* ================= Toast ================= */
function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return alert(msg);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.remove('show'), 2600);
}

function escapeHtml(str=''){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

/* ================= Promote helpers ================= */
function isPromoted(ad){
  if(!ad?.promoted_until) return false;
  return new Date(ad.promoted_until).getTime() > Date.now();
}
function promoteLabel(ad){
  if(!isPromoted(ad)) return "";
  const ms = new Date(ad.promoted_until).getTime() - Date.now();
  const days = Math.ceil(ms / (24*60*60*1000));
  return `⭐ مميز • باقي ${days} يوم`;
}

/* ================= Pending Payment Handler ================= */
async function onIncompletePaymentFound(payment){
  try{
    console.log("INCOMPLETE_PAYMENT_FOUND", payment);

    const memo = String(payment?.memo || "");
    if(!memo.startsWith("PROMOTE_AD|")) return;

    const paymentId = payment?.identifier || payment?.paymentId || payment?.id;
    if(!paymentId) return;

    toast("في عملية دفع معلّقة… بنحاول نكمّلها");

    const r1 = await fetch("/api/pi/approve", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ paymentId })
    });
    const j1 = await r1.json().catch(()=> ({}));
    if(!r1.ok || !j1.ok){
      console.log("APPROVE_FAIL_PENDING", r1.status, j1);
      toast("تعذر الموافقة على الدفع المعلّق");
      return;
    }

    const r2 = await fetch("/api/pi/complete", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ paymentId })
    });
    const j2 = await r2.json().catch(()=> ({}));
    if(!r2.ok || !j2.ok){
      console.log("COMPLETE_FAIL_PENDING", r2.status, j2);
      toast("تعذر إكمال الدفع المعلّق");
      return;
    }

    toast("تم إكمال الدفع المعلّق ✅");
    loadAds();
    loadMyAds();

  }catch(e){
    console.log("INCOMPLETE_HANDLER_ERR", e);
    toast("خطأ أثناء معالجة الدفع المعلّق");
  }
}

/* ================= UI User ================= */
function setWho(){
  const who = document.getElementById('whoami');
  const ud = document.getElementById('user-display');
  const loginText = document.getElementById('login-btn-text');

  if(user?.username){
    if(who) who.innerHTML = `<i class="fa-solid fa-user"></i> @${escapeHtml(user.username)}`;
    if(ud) ud.textContent = `@${user.username}`;
    if(loginText) loginText.textContent = `@${user.username}`;
  }else{
    if(who) who.innerHTML = `<i class="fa-solid fa-user"></i> زائر`;
    if(ud) ud.textContent = `زائر`;
    if(loginText) loginText.textContent = `تسجيل دخول`;
  }
}

async function handleLoginButton(){
  if(user?.username){
    if(confirm("تسجيل خروج؟")) logout();
    return;
  }
  await initPi();
}

/* ================= Navigation ================= */
function nav(id, btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if(page) page.classList.add('active');

  if(btn){
    document.querySelectorAll('.tab-item').forEach(i=>i.classList.remove('active'));
    btn.classList.add('active');
  }

  if(id === 'home') loadAds();
  if(id === 'profile') loadMyAds();
  if(id === 'inbox') loadInbox();
}

/* ================= Pi Login ================= */
async function initPi(){
  try{
    if(!window.Pi) return toast("افتح الموقع من Pi Browser");

    const Pi = window.Pi;
    Pi.init({ version: "2.0", sandbox: false });

    const auth = await Pi.authenticate(['username','payments'], onIncompletePaymentFound);
    user = auth.user;

    setWho();
    toast("تم تسجيل الدخول ✅");

    loadMyAds();
    loadInbox();

  }catch(e){
    console.log("PI_AUTH_ERR", e);
    toast("فشل تسجيل الدخول أو لم يتم منح صلاحية Payments");
  }
}

function logout(){
  user = null;
  activeAd = null;
  activeConversationId = null;
  setWho();
  toast("تم تسجيل الخروج");
}

/* ================= Skeleton ================= */
function showSkeleton(on=true){
  const sk = document.getElementById('home-skeleton');
  if(!sk) return;
  if(!on){ sk.innerHTML=''; sk.style.display='none'; return; }
  sk.style.display='grid';
  sk.innerHTML = Array.from({length:6}).map(()=> `
    <div class="sk"><div class="a"></div><div class="b"></div></div>
  `).join('');
}

/* ================= Ads ================= */
async function loadAds(){
  if(!_sb) return;
  showSkeleton(true);

  try{
    const { data, error } = await _sb
      .from('ads')
      .select('*')
      .order('promoted_until', { ascending:false, nullsFirst:false })
      .order('created_at', { ascending:false });

    if(error) throw error;
    allAdsCache = data || [];
    applyFilter();

  }catch(e){
    console.log("LOAD_ADS_ERR", e);
    toast("خطأ في تحميل الإعلانات");
  }finally{
    showSkeleton(false);
  }
}

function applyFilter(){
  const q = (document.getElementById('search')?.value || '').toLowerCase().trim();
  const filtered = !q ? allAdsCache : allAdsCache.filter(a =>
    (a.title||'').toLowerCase().includes(q) ||
    (a.description||'').toLowerCase().includes(q)
  );
  renderGrid(filtered, 'ads-grid');
}

async function loadMyAds(){
  if(!_sb) return;

  const myGrid = document.getElementById('my-ads-grid');
  const empty = document.getElementById('my-empty');

  if(!user?.username){
    if(myGrid) myGrid.innerHTML = '';
    if(empty) empty.style.display = 'block';
    return;
  }

  const { data, error } = await _sb
    .from('ads')
    .select('*')
    .eq('seller_username', user.username)
    .order('created_at', { ascending:false });

  if(error){
    console.log("LOAD_MY_ADS_ERR", error);
    toast("خطأ في تحميل إعلاناتك");
    return;
  }

  if(empty) empty.style.display = (data?.length ? 'none' : 'block');
  renderGrid(data || [], 'my-ads-grid');
}

/* ===== Render Cards ===== */
function renderGrid(data, containerId){
  const el = document.getElementById(containerId);
  if(!el) return;

  if(!data || !data.length){
    el.innerHTML = '';
    return;
  }

  el.innerHTML = data.map(ad => {
    const promoted = isPromoted(ad);
    const label = promoteLabel(ad);
    const isOwnerNow = !!(user?.username && user.username === ad.seller_username);

    return `
      <div class="glass ad-card" onclick="openAd('${ad.id}')">
        <img class="ad-thumb" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url)}">
        <div class="ad-body">
          <div class="ad-title">${escapeHtml(ad.title)}</div>

          <div class="ad-meta">
            <div class="price">${escapeHtml(ad.price)} Pi</div>
            <div class="badge">@${escapeHtml(ad.seller_username)}</div>
          </div>

          ${promoted ? `<div class="badge">⭐ مميز</div>` : ``}
          ${label ? `<div class="muted" style="font-size:11px">${escapeHtml(label)}</div>` : ``}

          ${isOwnerNow ? `
            <button class="btn-main" style="margin-top:8px" onclick="event.stopPropagation(); promoteAd('${ad.id}')">
              ⭐ اجعل إعلانك مميز
            </button>
            <button class="btn-delete" onclick="event.stopPropagation(); deleteAd('${ad.id}','${ad.image_url}')">
              حذف الإعلان
            </button>
          ` : ``}
        </div>
      </div>
    `;
  }).join('');
}

/* ================= Promote Flow ================= */
async function promoteAd(adId){
  try{
    if(!user?.username) return toast("سجّل دخول الأول");
    if(!window.Pi) return toast("افتح من Pi Browser");

    const Pi = window.Pi;
    toast("فتح الدفع...");

    await Pi.createPayment({
      amount: 5,
      memo: `PROMOTE_AD|${adId}|${Date.now()}`,
      metadata: { purpose:"PROMOTE_AD", adId, username:user.username }
    },{
      onReadyForServerApproval: async (paymentId)=>{
        await fetch("/api/pi/approve",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ paymentId })
        });
      },

      onReadyForServerCompletion: async (paymentId, txid)=>{
        const r = await fetch("/api/pi/complete",{
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ paymentId, txid })
        });
        const j = await r.json().catch(()=> ({}));
        if(!r.ok || !j.ok){
          console.log("PROMOTE_FAIL", j);
          toast("فشل الترقية");
          return;
        }
        toast("تم تمييز إعلانك ⭐");
        loadAds(); loadMyAds();
      },

      onCancel: ()=> toast("تم إلغاء الدفع"),
      onError: (err)=>{
        console.log("PI_PAYMENT_ERR", err);
        toast("مشكلة في الدفع");
      }
    });

  }catch(e){
    console.log("PROMOTE_ERR", e);
    toast("فشل الترقية");
  }
}

/* ================= Upload & Delete ================= */
async function uploadAd(){
  try{
    if(!_sb) return;
    if(!user?.username) return toast("سجّل دخول الأول");

    const f = document.getElementById('p-img')?.files?.[0];
    if(!f) return toast("اختر صورة");

    const title = document.getElementById('p-title').value.trim();
    const description = document.getElementById('p-desc').value.trim();
    const price = document.getElementById('p-price').value.trim();
    const phone = document.getElementById('p-phone').value.trim();

    if(!title || !price) return toast("اكتب الاسم والسعر");

    const ext = f.name.split('.').pop();
    const path = `img_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;

    toast("جاري الرفع...");

    const up = await _sb.storage.from('ads-images').upload(path, f);
    if(up.error) throw up.error;

    const ins = await _sb.from('ads').insert([{
      title, description, price, phone,
      image_url: path,
      seller_username: user.username
    }]);
    if(ins.error) throw ins.error;

    toast("تم النشر ✅");
    nav('home');
    loadAds(); loadMyAds();

  }catch(e){
    console.log("UPLOAD_ERR", e);
    toast("فشل النشر");
  }
}

async function deleteAd(id, img){
  if(!confirm("حذف الإعلان؟")) return;
  try{
    const d = await _sb.from('ads').delete().eq('id', id);
    if(d.error) throw d.error;
    if(img) await _sb.storage.from('ads-images').remove([img]);
    toast("تم الحذف");
    loadAds(); loadMyAds();
  }catch(e){
    console.log("DELETE_ERR", e);
    toast("فشل الحذف");
  }
}

/* ================= Messages & Inbox ================= */
/* نفس كود الرسائل اللي عندك – شغال */

function buildConversationId(ad){
  if(!ad || !user?.username) return null;
  const seller = ad.seller_username;
  const buyer = (user.username === seller) ? '__seller_view__' : user.username;
  return `${ad.id}|${seller}|${buyer}`;
}

/* ================= Config ================= */
async function initConfig(){
  if(!window.supabase?.createClient) throw new Error("supabase_not_loaded");

  const r = await fetch("/api/config", { cache:"no-store" });
  const j = await r.json().catch(()=> ({}));

  const url  = j.SB_URL || j.SUPABASE_URL || j.url;
  const anon = j.SB_ANON || j.SUPABASE_ANON_KEY || j.anon || j.key;

  if(!r.ok || !url || !anon) throw new Error("config_missing");

  SB_URL = String(url);
  SB_KEY = String(anon);
  _sb = window.supabase.createClient(SB_URL, SB_KEY);
}

/* ================= INIT ================= */
(async ()=>{
  try{
    await initConfig();
    setWho();
    loadAds();
  }catch(e){
    console.log("INIT_ERR", e);
    toast("مشكلة في إعدادات Supabase");
  }
})();
