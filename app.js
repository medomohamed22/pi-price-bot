// ===================== تهيئة Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== المتغيرات العامة =====================
let user = null;
const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

// ===================== نظام التنبيهات (Toast) =====================
function toast(title, msg = "", type = "info", duration = 4000) {
  const container = document.getElementById("toasts");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div class="toast-icon">${icons[type]}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${msg ? `<div class="toast-msg">${escapeHtml(msg)}</div>` : ''}
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()" style="background:none;border:none;color:#fff;cursor:pointer;">✕</button>
  `;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ===================== أدوات مساعدة =====================
function escapeHtml(str) { 
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
}

function formatDate(date) {
    if(!date) return "---";
    return new Date(date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

function updateUI() {
  const chip = document.getElementById("userChip");
  const btn = document.getElementById("btnLogin");
  if (user && user.username) {
    chip.style.display = "inline-block";
    chip.textContent = `👤 ${user.username}`;
    btn.style.display = "none";
  } else {
    chip.style.display = "none";
    btn.style.display = "inline-block";
  }
}

function requireLogin() {
  if (!user?.uid) {
    toast("تنبيه", "يجب تسجيل الدخول بـ Pi Browser أولاً", "warning");
    return false;
  }
  return true;
}

// ===================== تسجيل الدخول =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("خطأ متصفح", "يرجى فتح الموقع داخل متصفح Pi Browser", "error");
      return;
    }
    Pi.init({ version: "2.0", sandbox: false });
    const auth = await Pi.authenticate(['username', 'payments'], onIncompletePaymentFound);
    
    const { data: profile } = await sb.from('profiles').select('is_banned').eq('pi_uid', auth.user.uid).single();
    if (profile && profile.is_banned) {
        document.body.innerHTML = `<div style="height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#fee2e2; color:#b91c1c;"><h2>🚫 حسابك محظور</h2></div>`;
        return;
    }

    await sb.from('profiles').upsert({ pi_uid: auth.user.uid, username: auth.user.username });
    user = auth.user;
    updateUI();
    toast("تم الدخول", `أهلاً بك @${user.username}`, "success");
    if(document.getElementById("dashboardModal").classList.contains("active")) openDashboard();
  } catch (e) {
    toast("فشل الدخول", "حاول مرة أخرى", "error");
  }
}

function onIncompletePaymentFound(payment) {
  if (payment.transaction_id) {
     fetch("/.netlify/functions/complete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: payment.identifier, txid: payment.transaction_id }),
     });
  }
}

// ===================== لوحة التحكم (Dashboard) =====================
function openDashboard() {
  if (!requireLogin()) return;
  document.getElementById("dashboardModal").classList.add("active");
  document.getElementById("userSummary").innerHTML = `
    <div class="avatar-circle">👤</div>
    <div><div style="font-weight:bold;">@${user.username}</div><small>ID: ${user.uid.substring(0,8)}...</small></div>
  `;
  loadWallet();
  loadMyCycles();
}

function closeModal(id) { document.getElementById(id).classList.remove("active"); }

async function loadWallet() {
  const input = document.getElementById("walletInput");
  const { data } = await sb.from("user_wallets").select("wallet_address").eq("pi_uid", user.uid).single();
  input.value = data ? data.wallet_address : "";
}

async function saveWallet() {
  const address = document.getElementById("walletInput").value.trim();
  if (!address || address.length < 20) return toast("تنبيه", "تأكد من العنوان", "warning");
  const { error } = await sb.from("user_wallets").upsert({ pi_uid: user.uid, wallet_address: address });
  if (error) toast("خطأ", "فشل الحفظ", "error");
  else toast("تم الحفظ", "تم تحديث المحفظة ✅", "success");
}

async function loadMyCycles() {
  const list = document.getElementById("myCyclesList");
  list.innerHTML = `<div class="muted" style="text-align:center;">جاري التحميل...</div>`;
  try {
      const { data: members } = await sb.from("members").select(`id, position, created_at, cycles ( id, title, monthly_amount, status, months, created_at, groups ( name ) )`).eq("pi_uid", user.uid);
      if (!members || members.length === 0) { list.innerHTML = `<div class="muted" style="text-align:center;">لست مشتركاً في أي جمعية.</div>`; return; }
      list.innerHTML = "";
      for (let m of members) {
        const c = m.cycles;
        const { data: payments } = await sb.from('payments').select('amount, created_at').eq('member_id', m.id).eq('status', 'confirmed');
        const paidCount = payments?.length || 0;
        const totalAmount = c.monthly_amount * c.months;
        const paidAmountTotal = payments?.reduce((sum, p) => sum + (p.amount || 0), 0) || 0;
        const progressPercent = (paidCount / c.months) * 100;
        const payoutDate = new Date(c.created_at); payoutDate.setMonth(payoutDate.getMonth() + (m.position - 1));

        list.innerHTML += `
          <div class="dashboard-card">
            <div class="dash-header">
                <div class="dash-title"><h4>${escapeHtml(c.groups?.name)}</h4><span>${escapeHtml(c.title)}</span></div>
                <div class="badge primary">${c.monthly_amount} Pi</div>
            </div>
            <div class="payment-progress">
                <div class="progress-label"><span>اكتمال أقساطك</span><span>${Math.round(progressPercent)}%</span></div>
                <div class="track"><div class="fill" style="width:${progressPercent}%"></div></div>
            </div>
            <div class="stats-grid">
               <div class="stat-box"><small>دورك</small><strong>${m.position}</strong></div>
               <div class="stat-box highlight"><small>موعد القبض</small><strong>${formatDate(payoutDate)}</strong></div>
            </div>
            <button class="btn primary sm full-width" style="margin-top:10px" onclick="payInstallment(${c.id}, ${c.monthly_amount}, ${m.id}, ${paidCount + 1})">💳 دفع قسط رقم ${paidCount+1}</button>
          </div>`;
      }
  } catch (err) { list.innerHTML = `<div class="muted">خطأ في التحميل</div>`; }
}

// ===================== عملية الدفع =====================
async function payInstallment(cycleId, amount, memberId, installmentNum) {
  if (!requireLogin()) return;
  if(!confirm(`تأكيد دفع ${amount} Pi؟`)) return;
  try {
    const paymentData = { amount, memo: `قسط ${installmentNum}`, metadata: { cycleId, memberId, installment: installmentNum } };
    const callbacks = {
      onReadyForServerApproval: (paymentId) => fetch("/.netlify/functions/approve", { method: "POST", body: JSON.stringify({ paymentId }) }),
      onReadyForServerCompletion: (paymentId, txid) => {
        sb.from('payments').insert({ member_id: memberId, amount, status: 'confirmed', installment_number: installmentNum, payment_id: paymentId, txid }).then(() => {
            toast("تم بنجاح", "تم تسجيل الدفعة", "success");
            fetch("/.netlify/functions/complete", { method: "POST", body: JSON.stringify({ paymentId, txid }) });
            setTimeout(() => openDashboard(), 1500);
        });
      }
    };
    await Pi.createPayment(paymentData, callbacks);
  } catch (e) { toast("خطأ", "فشل الدفع", "error"); }
}

// ===================== تحميل الجمعيات (الصفحة الرئيسية المحدثة) =====================
async function loadGroups() {
  const grid = document.getElementById("groups");
  grid.innerHTML = `<div class="muted">جاري تحميل الجمعيات...</div>`;

  // جلب الجمعيات والدورات والأعضاء المشتركين فيها
  const { data: groups } = await sb.from("groups").select(`
    id, name, description,
    cycles (
        id, title, monthly_amount, status, months,
        members ( id )
    )
  `).order('created_at', { ascending: false });

  if (!groups || groups.length === 0) { grid.innerHTML = `<div class="card">لا توجد جمعيات حالياً</div>`; return; }

  grid.innerHTML = groups.map(g => {
    const activeCycle = g.cycles?.find(c => c.status === 'open') || g.cycles?.[0];
    if(!activeCycle) return "";

    const memberCount = activeCycle.members?.length || 0;
    const totalMonths = activeCycle.months;
    const fillPercent = (memberCount / totalMonths) * 100;

    return `
      <div class="card">
        <div class="cardTop">
          <h3>${escapeHtml(g.name)}</h3>
          <span class="badge primary">${activeCycle.monthly_amount} Pi</span>
        </div>
        <p class="muted sm-text">${escapeHtml(g.description || "جمعية مضمونة")}</p>
        
        <div class="occupancy-info" style="margin: 15px 0;">
            <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px;">
                <span>اكتمال المشتركين</span>
                <span style="font-weight:bold; color:var(--p)">${memberCount} / ${totalMonths}</span>
            </div>
            <div class="track" style="height:6px; background:#f0f0f0;">
                <div class="fill" style="width:${fillPercent}%; background:var(--success);"></div>
            </div>
        </div>

        <button class="btn soft full-width" onclick="showCycles(${g.id})">
            ${fillPercent >= 100 ? 'الجمعية مكتملة 🔒' : 'استعراض الأدوار المتاحة ✨'}
        </button>
        <div id="group-cycles-${g.id}" style="margin-top:10px; display:none"></div>
      </div>
    `;
  }).join("");
}

// ===================== عرض الأدوار بتصميم جذاب =====================
async function showCycles(groupId) {
    const container = document.getElementById(`group-cycles-${groupId}`);
    if (container.style.display === "block") { container.style.display = "none"; return; }
    container.style.display = "block";
    container.innerHTML = `<div class="loader-sm"></div>`;
  
    const { data: cycles } = await sb.from("cycles").select("*").eq("group_id", groupId).eq("status", "open");
    if(!cycles || cycles.length === 0) { container.innerHTML = "لا توجد دورات"; return; }
  
    container.innerHTML = cycles.map(c => `
      <div class="cycle-expand-box" style="background:#fdfbff; padding:15px; border-radius:12px; border:1px solid var(--p-light); margin-top:10px;">
        <div style="font-weight:bold; margin-bottom:10px; font-size:13px; color:var(--p-dark);">📅 ${escapeHtml(c.title)}</div>
        <div class="slot-instruction" style="font-size:11px; color:var(--muted); margin-bottom:10px;">اختر الشهر الذي تود استلام الجمعية فيه:</div>
        <div id="slots-${c.id}" class="modern-slot-grid"></div>
      </div>
    `).join("");

    cycles.forEach(c => loadSlots(c.id, c.months));
}

async function loadSlots(cycleId, totalMonths) {
    const box = document.getElementById(`slots-${cycleId}`);
    const { data: members } = await sb.from("members").select("position, username").eq("cycle_id", cycleId);
    const takenMap = {};
    members?.forEach(m => takenMap[m.position] = m.username);
  
    let html = "";
    for(let i=1; i<=totalMonths; i++) {
      const isTaken = takenMap[i];
      // تصميم الزر بناءً على الحالة
      html += `
        <div class="slot-item ${isTaken ? 'taken' : 'available'}" onclick="${isTaken ? '' : `joinCycle(${cycleId}, ${i})`}">
            <div class="slot-num">${i}</div>
            <div class="slot-status">${isTaken ? 'محجوز' : 'متاح'}</div>
            ${isTaken ? `<div class="slot-user">@${isTaken.substring(0,6)}</div>` : ''}
        </div>`;
    }
    box.innerHTML = html;
}

async function joinCycle(cycleId, pos) {
    if (!requireLogin()) return;
    if (!confirm(`هل تريد حجز الدور رقم ${pos} في هذه الجمعية؟`)) return;
    const { error } = await sb.from("members").insert({ cycle_id: cycleId, pi_uid: user.uid, username: user.username, position: pos });
    if (error) toast("فشل", "عذراً، سبقك أحدهم لهذا الدور", "error");
    else { toast("تم الحجز", `أنت الآن المشترك رقم ${pos} 🥳`, "success"); loadGroups(); }
}

window.addEventListener('load', loadGroups);
