/* =========================
   Pi Elite Hub - app.js
   - Loads PUBLIC Supabase config from /api/config (Netlify Function reads ENV)
   - No hardcoded Supabase URL/KEY (avoids Netlify secrets scan)
   ========================= */

/* ====== Global Supabase (filled after initConfig) ====== */
let SB_URL = "";
let SB_KEY = "";
let _sb = null;

/* ====== State ====== */
let user = null;
let activeAd = null;
let activeConversationId = null;
let allAdsCache = [];

/* ====== Promote helpers ====== */
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

/* ====== Promote flow (5 Pi / 3 days) ====== */
async function promoteAd(adId){
  try{
    if(!user?.username) return toast("سجّل دخول الأول");
    if(!window.Pi) return toast("افتح من Pi Browser");

    const Pi = window.Pi;
    toast("فتح الدفع...");

    await Pi.createPayment({
      amount: 5,
      memo: `PROMOTE_AD|${adId}|${Date.now()}`,
      metadata: { purpose: "PROMOTE_AD", adId, username: user.username }
    }, {
      onReadyForServerApproval: async (paymentId) => {
        toast("جاري الموافقة...");
        const r = await fetch("/api/pi/approve", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ paymentId })
        });
        const j = await r.json().catch(()=> ({}));
        if(!r.ok || !j.ok) throw new Error("approve_failed");
        toast("تمت الموافقة ✅");
      },

      onReadyForServerCompletion: async (paymentId, txid) => {
        toast("جاري تفعيل الإعلان المميز...");
        const r = await fetch("/api/pi/complete", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ paymentId, txid })
        });
        const j = await r.json().catch(()=> ({}));
        if(!r.ok || !j.ok) throw new Error("complete_failed");

        toast("تم تمييز إعلانك 3 أيام ⭐");
        loadAds();
        loadMyAds();
      },

      onCancel: () => toast("تم إلغاء الدفع"),
      onError: (err) => {
        console.log(err);
        toast("مشكلة في الدفع");
      }
    });

  }catch(e){
    console.log(e);
    toast("فشل الترقية");
  }
}

/* ====== UI helpers ====== */
function toast(msg){
  const t = document.getElementById('toast');
  if(!t) return alert(msg);
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(()=> t.classList.remove('show'), 2500);
}

function setWho(){
  const who = document.getElementById('whoami');
  const ud = document.getElementById('user-display');
  if(user?.username){
    if(who) who.innerHTML = `<i class="fa-solid fa-user"></i> @${user.username}`;
    if(ud) ud.textContent = `@${user.username}`;
  }else{
    if(who) who.innerHTML = `<i class="fa-solid fa-user"></i> زائر`;
    if(ud) ud.textContent = `زائر`;
  }
}

function showSkeleton(on=true){
  const sk = document.getElementById('home-skeleton');
  if(!sk) return;
  if(!on){ sk.innerHTML=''; sk.style.display='none'; return; }
  sk.style.display='grid';
  sk.innerHTML = Array.from({length:6}).map(()=> `
    <div class="sk">
      <div class="a"></div>
      <div class="b"></div>
    </div>
  `).join('');
}

function escapeHtml(str=''){
  return String(str)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'","&#039;");
}

/* ====== Navigation ====== */
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

/* ====== Pi Auth ====== */
async function initPi(){
  try{
    const Pi = window.Pi;
    Pi.init({ version: "2.0", sandbox: false });

    const auth = await Pi.authenticate(['username'], () => {});
    user = auth.user;

    setWho();
    document.getElementById('page-login')?.classList.remove('active');
    const navbar = document.getElementById('navbar');
    if(navbar) navbar.style.display = 'flex';
    nav('home');

    toast('تم تسجيل الدخول ✅');
  }catch(e){
    alert("لازم تفتح من Pi Browser علشان تسجيل الدخول يشتغل.");
  }
}

function logout(){
  user = null;
  activeAd = null;
  activeConversationId = null;
  setWho();
  toast('تم تسجيل الخروج');
  const navbar = document.getElementById('navbar');
  if(navbar) navbar.style.display = 'none';
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-login')?.classList.add('active');
}

/* ====== Ads ====== */
async function loadAds(){
  if(!_sb) return; // config not ready
  showSkeleton(true);
  const grid = document.getElementById('ads-grid');
  if(grid) grid.innerHTML = '';
  try{
    // promoted first, then newest
    const { data, error } = await _sb
      .from('ads')
      .select('*')
      .order('promoted_until', { ascending:false, nullsFirst:false })
      .order('created_at', { ascending:false });

    if(error) throw error;
    allAdsCache = data || [];
    applyFilter();
  }catch(e){
    console.log(e);
    toast('خطأ في تحميل الإعلانات');
  }finally{
    showSkeleton(false);
  }
}

function applyFilter(){
  const q = (document.getElementById('search')?.value || '').trim().toLowerCase();
  const filtered = !q ? allAdsCache : allAdsCache.filter(a =>
    (a.title||'').toLowerCase().includes(q) || (a.description||'').toLowerCase().includes(q)
  );
  renderGrid(filtered, 'ads-grid', false);
}

async function loadMyAds(){
  if(!_sb) return;
  if(!user?.username){
    const myGrid = document.getElementById('my-ads-grid');
    if(myGrid) myGrid.innerHTML = '';
    const empty = document.getElementById('my-empty');
    if(empty) empty.style.display = 'block';
    return;
  }

  const { data, error } = await _sb
    .from('ads')
    .select('*')
    .eq('seller_username', user.username)
    .order('created_at', {ascending:false});

  if(error){ toast('خطأ في تحميل إعلاناتك'); return; }

  const empty = document.getElementById('my-empty');
  if(empty) empty.style.display = (data?.length ? 'none' : 'block');

  renderGrid(data || [], 'my-ads-grid', true);
}

function renderGrid(data, containerId, isOwner){
  const el = document.getElementById(containerId);
  if(!el) return;
  if(!data || !data.length){
    el.innerHTML = '';
    return;
  }

  el.innerHTML = data.map(ad => {
    const promoted = isPromoted(ad);
    const label = promoteLabel(ad);
    const badgeHtml = promoted ? `<div class="badge" style="border-color:rgba(0,242,254,.35); color:rgba(0,242,254,.95)">⭐ مميز</div>` : "";
    const labelHtml = promoted ? `<div class="muted" style="margin-top:6px; font-size:11px;">${escapeHtml(label)}</div>` : "";

    return `
      <div class="glass ad-card" onclick="openAd('${ad.id}')">
        <img class="ad-thumb" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url)}" alt="ad">
        <div class="ad-body">
          <div class="ad-title">${escapeHtml(ad.title)}</div>
          <div class="ad-meta">
            <div class="price">${escapeHtml(ad.price)} Pi</div>
            <div class="badge">@${escapeHtml(ad.seller_username)}</div>
          </div>
          ${badgeHtml}
          ${labelHtml}

          ${isOwner ? `
            <button class="btn-delete" onclick="event.stopPropagation(); deleteAd('${ad.id}', '${ad.image_url}')">
              <i class="fa-solid fa-trash"></i> حذف الإعلان
            </button>

            <button class="btn-main" style="margin-top:10px;" onclick="event.stopPropagation(); promoteAd('${ad.id}')">
              ⭐ اجعل إعلانك مميز (5 Pi / 3 أيام)
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

async function openAd(id){
  if(!_sb) return;
  try{
    const { data: ad, error } = await _sb.from('ads').select('*').eq('id', id).single();
    if(error) throw error;

    activeAd = ad;
    activeConversationId = buildConversationId(ad);

    const wa = (ad.phone || '').trim();
    const waLink = wa ? `https://wa.me/${wa.replace(/\D/g,'')}` : null;

    const promoted = isPromoted(ad);
    const promoChip = promoted
      ? `<div class="pill" style="border-color:rgba(0,242,254,.35); color:rgba(0,242,254,.95)"><i class="fa-solid fa-star"></i> إعلان مميز</div>`
      : ``;

    document.getElementById('details-view').innerHTML = `
      <div class="glass details-card">
        <img class="details-img" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url)}" alt="ad">
        <div class="details-body">
          <div class="details-row">
            <div>
              <h2>${escapeHtml(ad.title)}</h2>
              <div class="price" style="font-size:18px">${escapeHtml(ad.price)} Pi</div>
            </div>
            <div class="seller"><i class="fa-solid fa-user"></i> البائع: <b>@${escapeHtml(ad.seller_username)}</b></div>
          </div>

          ${promoChip}

          <p>${escapeHtml(ad.description || '')}</p>

          <div class="cta-row">
            <button class="btn-main" onclick="focusChat()"><i class="fa-solid fa-message"></i> راسل البائع</button>
            <button class="btn-accent" ${waLink ? `onclick="window.open('${waLink}','_blank')"` : 'disabled style="opacity:.5; cursor:not-allowed"'} >
              <i class="fa-brands fa-whatsapp"></i> واتساب
            </button>
          </div>

          ${(user?.username && user.username === ad.seller_username) ? `
            <button class="btn-main" style="margin-top:10px;" onclick="promoteAd('${ad.id}')">
              ⭐ اجعل إعلانك مميز (5 Pi / 3 أيام)
            </button>
          ` : ''}

          ${(!user?.username && ad.seller_username) ? `
            <div class="muted" style="margin-top:10px; font-size:12px; line-height:1.6;">
              * أنت بتتصفح كزائر. علشان تبعت رسائل لازم تعمل دخول من Pi.
            </div>` : ''}
        </div>
      </div>
    `;

    document.getElementById('chat-hint').textContent = `محادثة خاصة على إعلان: ${ad.title}`;
    document.getElementById('conv-pill').innerHTML = `<i class="fa-solid fa-lock"></i> خاص`;

    nav('details');
    await loadMsgs(true);
  }catch(e){
    console.log(e);
    toast('تعذر فتح الإعلان');
  }
}

function focusChat(){
  document.getElementById('chat-input')?.focus();
}

/* ====== Conversation logic ====== */
function buildConversationId(ad){
  if(!ad) return null;
  if(!user?.username) return null;
  const seller = ad.seller_username;
  const buyer = (user.username === seller) ? '__seller_view__' : user.username;
  return `${ad.id}|${seller}|${buyer}`;
}

function isSellerViewingOwnAd(){
  return !!(user?.username && activeAd?.seller_username && user.username === activeAd.seller_username);
}

/* ====== Messages ====== */
async function loadMsgs(scrollToBottom=false){
  const box = document.getElementById('chat-box');
  if(!box) return;
  if(!activeAd){ box.innerHTML = ''; return; }

  if(!user?.username){
    box.innerHTML = `<div class="muted" style="padding:12px; text-align:center;">سجّل دخول علشان تبدأ محادثة خاصة.</div>`;
    return;
  }

  if(isSellerViewingOwnAd() && activeConversationId?.includes('__seller_view__')){
    box.innerHTML = `<div class="muted" style="padding:12px; text-align:center;">
      أنت البائع. هتشوف محادثات المشترين من تبويب <b>الرسائل</b> (Inbox) — كل مشتري له شات منفصل.
    </div>`;
    return;
  }

  try{
    const { data, error } = await _sb
      .from('messages')
      .select('*')
      .eq('conversation_id', activeConversationId)
      .order('created_at', {ascending:true});

    if(error) throw error;

    const rows = data || [];
    box.innerHTML = rows.map(m => `
      <div class="bubble ${m.sender_username === user.username ? 'me' : 'them'}">
        <small>${escapeHtml(m.sender_username)}</small>
        ${escapeHtml(m.text)}
      </div>
    `).join('') || `<div class="muted" style="padding:12px; text-align:center;">ابدأ المحادثة ✨</div>`;

    if(scrollToBottom){
      box.scrollTop = box.scrollHeight;
    }else{
      const nearBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 120;
      if(nearBottom) box.scrollTop = box.scrollHeight;
    }
  }catch(e){
    console.log(e);
    toast('خطأ في تحميل الرسائل');
  }
}

async function sendMsg(){
  try{
    const inp = document.getElementById('chat-input');
    const text = (inp?.value || '').trim();
    if(!text) return;

    if(!user?.username){
      toast('سجّل دخول الأول');
      return;
    }
    if(!activeAd) return;

    if(isSellerViewingOwnAd() && activeConversationId?.includes('__seller_view__')){
      toast('افتح محادثة المشتري من الرسائل');
      return;
    }

    const seller = activeAd.seller_username;
    const buyer = (user.username === seller) ? extractBuyerFromConversation(activeConversationId) : user.username;
    const receiver = (user.username === seller) ? buyer : seller;

    const payload = {
      // NOTE: لازم يكون عندك عمود ad_id فعلاً في جدول messages
      ad_id: activeAd.id,
      conversation_id: activeConversationId,
      seller_username: seller,
      buyer_username: buyer,
      sender_username: user.username,
      receiver_username: receiver,
      text
    };

    const { error } = await _sb.from('messages').insert([payload]);
    if(error) throw error;

    inp.value = '';
    await loadMsgs(true);
  }catch(e){
    console.log(e);
    toast('خطأ في الإرسال');
  }
}

function extractBuyerFromConversation(convId){
  try{
    const parts = String(convId).split('|');
    return parts[2] || null;
  }catch{
    return null;
  }
}

/* ====== Inbox ====== */
async function loadInbox(){
  if(!_sb) return;
  if(!user?.username){
    const list = document.getElementById('inbox-list');
    if(list) list.innerHTML = '';
    const empty = document.getElementById('inbox-empty');
    if(empty) empty.style.display = 'block';
    return;
  }

  try{
    const { data, error } = await _sb
      .from('messages')
      .select('conversation_id, ad_id, text, created_at, seller_username, buyer_username, sender_username, receiver_username')
      .or(`seller_username.eq.${user.username},buyer_username.eq.${user.username}`)
      .order('created_at', {ascending:false});

    if(error) throw error;

    const rows = data || [];
    const seen = new Set();
    const convs = [];

    for(const m of rows){
      if(!m.conversation_id) continue;
      if(seen.has(m.conversation_id)) continue;
      seen.add(m.conversation_id);
      convs.push(m);
    }

    const empty = document.getElementById('inbox-empty');
    if(empty) empty.style.display = convs.length ? 'none' : 'block';

    const adIds = [...new Set(convs.map(c=>c.ad_id).filter(Boolean))];
    let adsMap = {};
    if(adIds.length){
      const { data: ads, error: adErr } = await _sb
        .from('ads')
        .select('id,title,image_url,seller_username')
        .in('id', adIds);

      if(!adErr && ads){
        adsMap = Object.fromEntries(ads.map(a=>[a.id, a]));
      }
    }

    const list = document.getElementById('inbox-list');
    if(!list) return;

    list.innerHTML = convs.map(c=>{
      const ad = adsMap[c.ad_id] || {};
      const partner = (user.username === c.seller_username) ? c.buyer_username : c.seller_username;
      return `
        <div class="glass inbox-card" onclick="openConversationFromInbox('${escapeHtml(c.conversation_id)}','${c.ad_id}')">
          <img class="inbox-thumb" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url || '')}" onerror="this.style.display='none'">
          <div style="flex:1; min-width:0;">
            <div class="inbox-title">${escapeHtml(partner || 'محادثة')}</div>
            <div class="inbox-sub">
              <b>${escapeHtml(ad.title || '—')}</b><br>
              ${escapeHtml((c.text || '').slice(0, 40))}${(c.text || '').length > 40 ? '…' : ''}
            </div>
          </div>
          <div class="pill"><i class="fa-solid fa-lock"></i></div>
        </div>
      `;
    }).join('');
  }catch(e){
    console.log(e);
    toast('تعذر تحميل الرسائل');
  }
}

async function openConversationFromInbox(conversationId, adId){
  if(!_sb) return;
  const { data: ad, error } = await _sb.from('ads').select('*').eq('id', adId).single();
  if(error){ toast('تعذر فتح المحادثة'); return; }

  activeAd = ad;
  activeConversationId = conversationId;

  document.getElementById('details-view').innerHTML = `
    <div class="glass details-card">
      <img class="details-img" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url)}" alt="ad">
      <div class="details-body">
        <div class="details-row">
          <div>
            <h2>${escapeHtml(ad.title)}</h2>
            <div class="price" style="font-size:18px">${escapeHtml(ad.price)} Pi</div>
          </div>
          <div class="seller"><i class="fa-solid fa-user"></i> البائع: <b>@${escapeHtml(ad.seller_username)}</b></div>
        </div>
        <p>${escapeHtml(ad.description || '')}</p>
      </div>
    </div>
  `;

  const buyer = extractBuyerFromConversation(conversationId);
  const partner = (user.username === ad.seller_username) ? buyer : ad.seller_username;
  document.getElementById('chat-hint').textContent = `محادثة خاصة مع @${partner} على إعلان: ${ad.title}`;
  document.getElementById('conv-pill').innerHTML = `<i class="fa-solid fa-lock"></i> خاص`;

  nav('details');
  await loadMsgs(true);
}

/* ====== Upload / Delete ====== */
async function uploadAd(){
  try{
    if(!_sb) return;
    if(!user?.username){ toast('سجّل دخول الأول'); return; }

    const f = document.getElementById('p-img')?.files?.[0];
    if(!f) return toast('اختر صورة');

    const title = document.getElementById('p-title')?.value?.trim() || "";
    const description = document.getElementById('p-desc')?.value?.trim() || "";
    const price = document.getElementById('p-price')?.value?.trim() || "";
    const phone = document.getElementById('p-phone')?.value?.trim() || "";

    if(!title || !price) return toast('اكتب الاسم والسعر');

    const ext = (f.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `img_${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`;

    toast('جاري رفع الصورة...');
    const { error: upErr } = await _sb.storage.from('ads-images').upload(path, f, { cacheControl:'3600', upsert:false });
    if(upErr) throw upErr;

    const { error: insErr } = await _sb.from('ads').insert([{
      title, description, price, phone,
      image_url: path,
      seller_username: user.username
    }]);
    if(insErr) throw insErr;

    toast('تم النشر ✅');
    document.getElementById('p-img').value = '';
    document.getElementById('p-title').value = '';
    document.getElementById('p-desc').value = '';
    document.getElementById('p-price').value = '';
    document.getElementById('p-phone').value = '';
    nav('home');
  }catch(e){
    console.log(e);
    toast('فشل النشر');
  }
}

async function deleteAd(id, img){
  if(!confirm('حذف الإعلان؟')) return;
  try{
    if(!_sb) return;
    const { error: delErr } = await _sb.from('ads').delete().eq('id', id);
    if(delErr) throw delErr;
    await _sb.storage.from('ads-images').remove([img]);
    toast('تم الحذف');
    loadMyAds();
  }catch(e){
    console.log(e);
    toast('فشل الحذف');
  }
}

/* ====== Share ====== */
async function shareActive(){
  if(!activeAd) return;
  const text = `شوف الإعلان: ${activeAd.title} — السعر ${activeAd.price} Pi`;
  try{
    if(navigator.share){
      await navigator.share({ text });
    }else{
      await navigator.clipboard.writeText(text);
      toast('تم النسخ ✅');
    }
  }catch{}
}

/* ====== Auto refresh messages ====== */
setInterval(() => {
  const isDetails = document.getElementById('page-details')?.classList.contains('active');
  if(isDetails) loadMsgs(false);
}, 3500);

/* =========================
   Config loader
   - Reads config from /api/config (server reads ENV)
   ========================= */
async function initConfig(){
  try{
    // Must have supabase-js loaded in index.html
    if(!window.supabase?.createClient){
      throw new Error("supabase_js_not_loaded");
    }

    const r = await fetch("/api/config", { cache: "no-store" });
    if(!r.ok) throw new Error("config_http_" + r.status);

    const j = await r.json().catch(()=> ({}));

    // Accept multiple possible keys (just in case your function names differ)
    const url = j.SB_URL || j.SUPABASE_URL || j.url;
    const anon = j.SB_ANON || j.SUPABASE_ANON_KEY || j.anon || j.key;

    if(!url || !anon){
      throw new Error("config_missing_keys");
    }

    SB_URL = String(url);
    SB_KEY = String(anon);

    _sb = window.supabase.createClient(SB_URL, SB_KEY);

  }catch(e){
    console.log(e);
    toast("مشكلة في إعدادات Supabase. تأكد من Function /api/config و ENV.");
    throw e;
  }
}

/* ====== init ====== */
(async ()=>{
  await initConfig();   // <-- must be first
  setWho();
  loadAds();
})();
