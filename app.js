// ===================== تهيئة Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== حالة المستخدم =====================
let user = null;

// ===================== نظام الإشعارات =====================
const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

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

// ===================== الأدوات المساعدة =====================
function escapeHtml(str) { 
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); 
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

function formatDate(date) {
    if(!date) return "---";
    return new Date(date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ===================== تسجيل الدخول Pi =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("خطأ متصفح", "يرجى فتح الموقع داخل متصفح Pi Browser", "error");
      return;
    }

    Pi.init({ version: "2.0", sandbox: false });
    const scopes = ['username', 'payments'];
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);

    user = auth.user;
    updateUI();
    toast("تم الدخول بنجاح", `أهلاً بك يا @${user.username}`, "success");
    
    if(document.getElementById("dashboardModal").classList.contains("active")){
        openDashboard();
    }

  } catch (e) {
    console.error("Login Error:", e);
    toast("فشل الدخول", "تأكد من الاتصال وحاول مرة أخرى", "error");
  }
}

function onIncompletePaymentFound(payment) {
  console.log("Incomplete:", payment);
  if (payment.transaction_id) {
     // ملاحظة: قد تحتاج لتعديل هذه الدالة في السيرفر لتقبل member_id إذا لزم الأمر
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
  
  // تحديث ملخص المستخدم
  document.getElementById("userSummary").innerHTML = `
    <div class="avatar-circle">👤</div>
    <div>
        <div style="font-weight:bold; font-size:16px">@${user.username}</div>
        <div style="font-size:12px; opacity:0.9">المعرف: ${user.uid.substring(0,8)}...</div>
    </div>
  `;

  loadWallet();
  loadMyCycles();
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

async function loadWallet() {
  const input = document.getElementById("walletInput");
  input.value = "جاري التحميل...";
  
  const { data } = await sb.from("user_wallets").select("wallet_address").eq("pi_uid", user.uid).single();
  input.value = data ? data.wallet_address : "";
}

async function saveWallet() {
  const address = document.getElementById("walletInput").value.trim();
  if (!address || address.length < 20) return toast("تنبيه", "عنوان المحفظة غير صحيح", "warning");

  const { error } = await sb.from("user_wallets").upsert({ pi_uid: user.uid, wallet_address: address });
  if (error) toast("خطأ", "فشل الحفظ", "error");
  else toast("تم الحفظ", "تم تحديث المحفظة ✅", "success");
}

// === المنطق الأساسي للوحة التحكم ===
async function loadMyCycles() {
  const list = document.getElementById("myCyclesList");
  list.innerHTML = `<div class="muted" style="text-align:center; margin:20px 0;">جاري جلب البيانات المالية... ⏳</div>`;

  try {
      // 1. جلب العضويات والجمعيات
      // ملاحظة هامة: قمنا بإضافة 'id' في الـ select لأننا نحتاجه لجدول المدفوعات
      const { data: members, error } = await sb
        .from("members")
        .select(`
          id, 
          position, created_at,
          cycles (
            id, title, monthly_amount, status, months, created_at,
            groups ( name )
          )
        `)
        .eq("pi_uid", user.uid);

      if (error || !members || members.length === 0) {
        list.innerHTML = `<div class="muted" style="text-align:center; padding:20px">لست مشتركاً في أي جمعية حالياً.</div>`;
        return;
      }

      list.innerHTML = "";

      // 2. معالجة كل جمعية وعرض التفاصيل
      for (let m of members) {
        const c = m.cycles;
        if(!c) continue;

        // تعديل: الحساب بناءً على جدول payments الجديد
        // نربط الدفعة بـ member_id الخاص بالمستخدم في هذه الدورة
        const { count: paidMonths } = await sb
            .from('payments')
            .select('*', { count: 'exact', head: true })
            .eq('member_id', m.id) // الربط الصحيح بالجدول
            .eq('status', 'completed'); // أو الحالة المعتمدة للدفع الناجح
        
        const safePaidMonths = paidMonths || 0;
        const totalAmount = c.monthly_amount * c.months;
        const paidAmount = c.monthly_amount * safePaidMonths;
        const progressPercent = Math.min((safePaidMonths / c.months) * 100, 100);

        // حساب التواريخ
        const cycleStartDate = new Date(c.created_at);
        // حساب تاريخ القبض
        const payoutDate = new Date(cycleStartDate);
        payoutDate.setMonth(payoutDate.getMonth() + (m.position - 1));

        const isCompleted = safePaidMonths >= c.months;

        list.innerHTML += `
          <div class="dashboard-card">
            <!-- رأس البطاقة -->
            <div class="dash-header">
              <div class="dash-title">
                <h4>${escapeHtml(c.groups?.name)} - ${escapeHtml(c.title)}</h4>
                <span>الحالة: ${c.status === 'open' ? 'نشطة 🟢' : 'مغلقة 🔴'}</span>
              </div>
              <div class="badge primary">${c.monthly_amount} Pi / شهر</div>
            </div>

            <!-- شريط التقدم -->
            <div class="payment-progress">
              <div class="progress-label">
                <span>تم دفع: ${safePaidMonths} من ${c.months} شهر</span>
                <span>${Math.round(progressPercent)}%</span>
              </div>
              <div class="track">
                <div class="fill" style="width: ${progressPercent}%"></div>
              </div>
            </div>

            <!-- شبكة المعلومات -->
            <div class="stats-grid">
               <div class="stat-box">
                 <small>دورك رقم</small>
                 <strong>${m.position}</strong>
               </div>
               <div class="stat-box highlight">
                 <small>تاريخ القبض المتوقع</small>
                 <strong>${formatDate(payoutDate)}</strong>
               </div>
               <div class="stat-box">
                 <small>إجمالي المبلغ</small>
                 <strong>${totalAmount} Pi</strong>
               </div>
               <div class="stat-box">
                 <small>المدفوع</small>
                 <strong>${paidAmount} Pi</strong>
               </div>
            </div>

            <!-- الأزرار -->
            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:15px;">
              ${!isCompleted ? 
                `<div>
                   <span class="muted sm-text">القسط القادم:</span>
                   <div style="font-weight:bold; font-size:13px">${formatDate(new Date())}</div> 
                 </div>
                 <!-- نمرر m.id هنا لأن الدفع يحتاج معرف العضوية -->
                 <button class="btn primary sm" onclick="payInstallment(${c.id}, ${c.monthly_amount}, ${m.id})">
                   دفع القسط (${c.monthly_amount} Pi)
                 </button>` 
                : 
                `<div class="badge success full-width" style="text-align:center">🎉 تم سداد جميع الأقساط</div>`
              }
            </div>
          </div>
        `;
      }

  } catch (err) {
      console.error(err);
      list.innerHTML = `<div class="muted">حدث خطأ أثناء تحميل البيانات</div>`;
  }
}

// ===================== نظام الدفع (تعديل: إضافة memberId) =====================
async function payInstallment(cycleId, amount, memberId) {
  if (!requireLogin()) return;
  closeModal('dashboardModal');
  toast("جاري التحضير", "يتم إنشاء عملية الدفع...", "info");

  try {
    const paymentData = {
      amount: amount,
      memo: "قسط جمعية",
      metadata: { cycleId: cycleId, type: "installment" }
    };

    const callbacks = {
      onReadyForServerApproval: (paymentId) => {
        // الاتصال بالسيرفر للموافقة
        toast("جاري المعالجة", "انتظر قليلاً...", "info");
        fetch("/.netlify/functions/approve", {
             method: "POST", headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ paymentId })
        }).catch(e => console.log("Approval check failed (Server side)"));
      },
      onReadyForServerCompletion: (paymentId, txid) => {
        // تعديل: التسجيل في قاعدة البيانات وفقاً للجدول الجديد
        sb.from('payments').insert({
            member_id: memberId,   // الربط بجدول الأعضاء
            amount: amount,        // المبلغ
            payment_id: paymentId, // معرف عملية الدفع من Pi
            status: 'completed'    // الحالة
        }).then(({ error }) => {
            if (error) {
                console.error("DB Insert Error:", error);
                toast("تنبيه", "تم الدفع ولكن فشل التسجيل، تواصل مع الدعم", "warning");
            } else {
                toast("تم بنجاح", "تم دفع القسط وتسجيله! 🎉", "success");
                openDashboard();
            }
        });
        
        // إرسال للسيرفر لإكمال العملية في Pi Blockchain
        fetch("/.netlify/functions/complete", {
             method: "POST", headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ paymentId: paymentId, txid: txid })
        });
      },
      onCancel: () => { toast("إلغاء", "تم إلغاء الدفع", "warning"); openDashboard(); },
      onError: (err) => { toast("خطأ", "حدث خطأ: " + err.message, "error"); }
    };

    await Pi.createPayment(paymentData, callbacks);

  } catch (e) {
    console.error(e);
    toast("خطأ", "فشل بدء الدفع", "error");
    openDashboard();
  }
}

// ===================== عرض الجمعيات (الصفحة الرئيسية) =====================
async function loadGroups() {
  const grid = document.getElementById("groups");
  if(!grid) return;
  grid.innerHTML = `<div class="muted">جاري تحميل الجمعيات...</div>`;

  const { data: groups } = await sb.from("groups").select("*, cycles(*)").order('created_at', { ascending: false });

  if (!groups || groups.length === 0) {
    grid.innerHTML = `<div class="card">لا توجد جمعيات حالياً</div>`;
    return;
  }

  grid.innerHTML = groups.map(g => {
    const activeCycle = g.cycles?.find(c => c.status === 'open') || g.cycles?.[0];
    const amount = activeCycle ? activeCycle.monthly_amount : "---";
    return `
      <div class="card">
        <div class="cardTop">
          <h3>${escapeHtml(g.name)}</h3>
          <span class="badge">القسط: ${amount} Pi</span>
        </div>
        <p class="muted sm-text">${escapeHtml(g.description || "جمعية مضمونة وآمنة")}</p>
        <button class="btn soft full-width" onclick="showCycles(${g.id})">عرض التفاصيل</button>
        <div id="group-cycles-${g.id}" style="margin-top:10px; display:none"></div>
      </div>
    `;
  }).join("");
}

async function showCycles(groupId) {
    const container = document.getElementById(`group-cycles-${groupId}`);
    if (container.style.display === "block") { container.style.display = "none"; return; }
    
    container.style.display = "block";
    container.innerHTML = "جاري التحميل...";
  
    const { data: cycles } = await sb.from("cycles").select("*").eq("group_id", groupId).eq("status", "open");
  
    if(!cycles || cycles.length === 0) {
      container.innerHTML = "<div class='muted sm-text'>لا توجد دورات متاحة</div>"; return;
    }
  
    container.innerHTML = cycles.map(c => `
      <div style="background:#f8f9fa; padding:10px; border-radius:8px; margin-top:5px; border:1px solid #eee">
        <div style="display:flex; justify-content:space-between; margin-bottom:5px">
          <b>${escapeHtml(c.title)}</b>
          <small>${c.monthly_amount} Pi</small>
        </div>
        <button class="btn primary sm full-width" onclick="loadSlots(${c.id}, ${c.months})">اختر دورك</button>
        <div id="slots-${c.id}" class="slotGrid" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:5px"></div>
      </div>
    `).join("");
}

async function loadSlots(cycleId, totalMonths) {
    const box = document.getElementById(`slots-${cycleId}`);
    box.innerHTML = "Wait...";
    const { data: members } = await sb.from("members").select("position").eq("cycle_id", cycleId);
    const taken = new Set(members?.map(m => m.position) || []);
  
    let html = "";
    for(let i=1; i<=totalMonths; i++) {
      const isTaken = taken.has(i);
      html += `<button class="btn ${isTaken ? 'ghost' : 'primary'} sm slotBtn" ${isTaken ? 'disabled style="opacity:0.5"' : ''} onclick="joinCycle(${cycleId}, ${i})">${i}</button>`;
    }
    box.innerHTML = html;
}

async function joinCycle(cycleId, pos) {
    if (!requireLogin()) return;
    const { error } = await sb.from("members").insert({ cycle_id: cycleId, pi_uid: user.uid, username: user.username, position: pos });
  
    if (error) toast("فشل الحجز", "هذا الدور محجوز مسبقاً", "error");
    else {
      toast("تم بنجاح", `تم حجز الدور رقم ${pos}`, "success");
      openDashboard();
    }
}

window.addEventListener('load', loadGroups);
