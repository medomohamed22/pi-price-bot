// ====== Supabase ======
const SB_URL = 'https://axjkwrssmofzavaoqutq.supabase.co';
const SB_KEY = 'sb_publishable_tiuMncgWhf1YRWoD-uYQ3Q_ziI8OKci';
const _sb = supabase.createClient(SB_URL, SB_KEY);

// ====== State ======
let user = null;
let activeAd = null;
let activeConversationId = null;
let allAdsCache = [];

// ====== UI helpers ======
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

// ====== Promote helpers ======
function isPromoted(ad){
  if(!ad?.promoted_until) return false;
  return new Date(ad.promoted_until).getTime() > Date.now();
}

function promoteLabel(ad){
  if(!isPromoted(ad)) return "";
  const ms = new Date(ad.promoted_until).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / (24*60*60*1000)));
  return `⭐ مميز • باقي ${days} يوم`;
}

// ====== Promote flow (5 Pi / 3 days) ======
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

// ====== Navigation ======
function nav(id, btn){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-' + id)?.classList.add('active');

  if(btn){
    document.querySelectorAll('.tab-item').forEach(i=>i.classList.remove('active'));
    btn.classList.add('active');
  }

  if(id === 'home') loadAds();
  if(id === 'profile') loadMyAds();
  if(id === 'inbox') loadInbox();
}

// ====== Pi Auth ======
async function initPi(){
  try{
    const Pi = window.Pi;
    Pi.init({ version: "2.0", sandbox: false });

    const auth = await Pi.authenticate(['username'], () => {});
    user = auth.user;

    setWho();
    document.getElementById('page-login')?.classList.remove('active');
    const navb = document.getElementById('navbar');
    if(navb) navb.style.display = 'flex';
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
  const navb = document.getElementById('navbar');
  if(navb) navb.style.display = 'none';
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-login')?.classList.add('active');
}

// ====== Ads ======
async function loadAds(){
  showSkeleton(true);
  const grid = document.getElementById('ads-grid');
  if(grid) grid.innerHTML = '';
  try{
    const { data, error } = await _sb.from('ads').select('*').order('created_at', {ascending:false});
    if(error) throw error;

    // ✅ sort promoted first
    allAdsCache = (data || []).sort((a,b)=>{
      const ap = isPromoted(a) ? 1 : 0;
      const bp = isPromoted(b) ? 1 : 0;
      if(bp !== ap) return bp - ap;

      const aut = a.promoted_until ? new Date(a.promoted_until).getTime() : 0;
      const but = b.promoted_until ? new Date(b.promoted_until).getTime() : 0;
      if(bp && ap && but !== aut) return but - aut;

      const ac = new Date(a.created_at || 0).getTime();
      const bc = new Date(b.created_at || 0).getTime();
      return bc - ac;
    });

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
  const myGrid = document.getElementById('my-ads-grid');
  const myEmpty = document.getElementById('my-empty');

  if(!user?.username){
    if(myGrid) myGrid.innerHTML = '';
    if(myEmpty) myEmpty.style.display = 'block';
    return;
  }

  const { data, error } = await _sb.from('ads').select('*').eq('seller_username', user.username).order('created_at', {ascending:false});
  if(error){ toast('خطأ في تحميل إعلاناتك'); return; }

  if(myEmpty) myEmpty.style.display = (data?.length ? 'none' : 'block');
  renderGrid(data || [], 'my-ads-grid', true);
}

function renderGrid(data, containerId, isOwner){
  const el = document.getElementById(containerId);
  if(!el) return;

  if(!data || !data.length){
    el.innerHTML = '';
    return;
  }

  el.innerHTML = data.map(ad => `
    <div class="glass ad-card" onclick="openAd('${ad.id}')">
      <img class="ad-thumb" src="${SB_URL}/storage/v1/object/public/ads-images/${encodeURIComponent(ad.image_url)}" alt="ad">
      <div class="ad-body">
        <div class="ad-title">${escapeHtml(ad.title)}</div>

        <div class="ad-meta">
          <div class="price">${escapeHtml(ad.price)} Pi</div>

          <div style="display:flex; gap:6px; flex-wrap:wrap; justify-content:flex-end;">
            ${isPromoted(ad) ? `<div class="badge" style="border-color: rgba(0,242,254,.35); color:#d9feff;">${escapeHtml(promoteLabel(ad))}</div>` : ``}
            <div class="badge">@${escapeHtml(ad.seller_username)}</div>
          </div>
        </div>

        ${isOwner ? `
          <button class="btn-ghost" style="margin-top:10px"
            onclick="event.stopPropagation(); ${isPromoted(ad) ? `toast('إعلانك مميز بالفعل ✅');` : `promoteAd('${ad.id}')`}">
            <i class="fa-solid fa-bolt"></i> ${isPromoted(ad) ? `مميز بالفعل ✅` : `ترقية الإعلان (5 Pi / 3 أيام)`}
          </button>

          <button class="btn-delete" onclick="event.stopPropagation(); deleteAd('${ad.id}', '${ad.image_url}')">
            <i class="fa-solid fa-trash"></i> حذف الإعلان
          </button>` : ''}
      </div>
    </div>
  `).join('');
}

async function openAd(id){
  try{
    const { data: ad, error } = await _sb.from('ads').select('*').eq('id', id).single();
    if(error) throw error;

    activeAd = ad;
    activeConversationId = buildConversationId(ad);

    const wa = (ad.phone || '').trim();
    const waLink = wa ? `https://wa.me/${wa.replace(/\D/g,'')}` : null;

    // ✅ add promote button in details for owner
    const ownerPromoteBtn = (user?.username && user.username === ad.seller_username)
      ? `<button class="btn-ghost" onclick="${isPromoted(ad) ? `toast('إعلانك مميز بالفعل ✅')` : `promoteAd('${ad.id}')`}">
           <i class="fa-solid fa-bolt"></i> ${isPromoted(ad) ? `مميز ✅` : `تمييز (5 Pi)`}
         </button>`
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

          ${isPromoted(ad) ? `<div class="badge" style="margin-top:10px; display:inline-block; border-color: rgba(0,242,254,.35); color:#d9feff;">${escapeHtml(promoteLabel(ad))}</div>` : ``}

          <p>${escapeHtml(ad.description || '')}</p>

          <div class="cta-row">
            <button class="btn-main" onclick="focusChat()"><i class="fa-solid fa-message"></i> راسل البائع</button>
            <button class="btn-accent" ${waLink ? `onclick="window.open('${waLink}','_blank')"` : 'disabled style="opacity:.5; cursor:not-allowed"'} >
              <i class="fa-brands fa-whatsapp"></i> واتساب
            </button>
            ${ownerPromoteBtn}
          </div>

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

// ====== Conversation logic (PRIVATE CHAT) ======
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

// ====== Messages ======
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

function extractBuyerFromConversation(convId){
  try{
    const parts = String(convId).split('|');
    return parts[2] || null;
  }catch{
    return null;
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

// ====== Inbox (by conversation_id) ======
async function loadInbox(){
  const inboxList = document.getElementById('inbox-list');
  const inboxEmpty = document.getElementById('inbox-empty');

  if(!user?.username){
    if(inboxList) inboxList.innerHTML = '';
    if(inboxEmpty) inboxEmpty.style.display = 'block';
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

    if(inboxEmpty) inboxEmpty.style.display = convs.length ? 'none' : 'block';

    const adIds = [...new Set(convs.map(c=>c.ad_id))];
    let adsMap = {};
    if(adIds.length){
      const { data: ads, error: adErr } = await _sb.from('ads').select('id,title,image_url,seller_username').in('id', adIds);
      if(!adErr && ads){
        adsMap = Object.fromEntries(ads.map(a=>[a.id, a]));
      }
    }

    if(inboxList){
      inboxList.innerHTML = convs.map(c=>{
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
    }
  }catch(e){
    console.log(e);
    toast('تعذر تحميل الرسائل');
  }
}

async function openConversationFromInbox(conversationId, adId){
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

// ====== Upload / Delete ======
async function uploadAd(){
  try{
    if(!user?.username){ toast('سجّل دخول الأول'); return; }

    const f = document.getElementById('p-img')?.files?.[0];
    if(!f) return toast('اختر صورة');

    const title = document.getElementById('p-title')?.value?.trim() || '';
    const description = document.getElementById('p-desc')?.value?.trim() || '';
    const price = document.getElementById('p-price')?.value?.trim() || '';
    const phone = document.getElementById('p-phone')?.value?.trim() || '';

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
    const { error: delErr } = await _sb.from('ads').delete().eq('id', id);
    if(delErr) throw delErr;

    if(img){
      await _sb.storage.from('ads-images').remove([img]);
    }

    toast('تم الحذف');
    loadMyAds();
    loadAds();
  }catch(e){
    console.log(e);
    toast('فشل الحذف');
  }
}

// ====== Share ======
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

// ====== Auto refresh messages ======
setInterval(() => {
  const isDetails = document.getElementById('page-details')?.classList.contains('active');
  if(isDetails) loadMsgs(false);
}, 3500);

// ====== init ======
setWho();
loadAds();
