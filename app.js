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
    el.style.animation = "fadeOut 0.3s forwards";
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

// ===================== تسجيل الدخول (مع التحقق من الحظر) =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("خطأ متصفح", "يرجى فتح الموقع داخل متصفح Pi Browser", "error");
      return;
    }

    Pi.init({ version: "2.0", sandbox: false });
    const scopes = ['username', 'payments'];
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    
    // التحقق من الحظر
    const { data: profile } = await sb
        .from('profiles')
        .select('is_banned')
        .eq('pi_uid', auth.user.uid)
        .single();

    if (profile && profile.is_banned) {
        document.body.innerHTML = `
            <div style="height:100vh; display:flex; flex-direction:column; justify-content:center; align-items:center; background:#fee2e2; color:#b91c1c; font-family:sans-serif;">
                <h1 style="font-size:50px">🚫</h1>
                <h2>حسابك محظور</h2>
                <p>لا يمكنك الوصول للتطبيق.</p>
            </div>
        `;
        return;
    }

    // تحديث بيانات المستخدم
    await sb.from('profiles').upsert({ 
        pi_uid: auth.user.uid, 
        username: auth.user.username 
    });

    user = auth.user;
    updateUI();
    toast("تم الدخول بنجاح", `أهلاً بك يا @${user.username}`, "success");
    
    if(document.getElementById("dashboardModal").classList.contains("active")){
        openDashboard();
    }

  } catch (e) {
    console.error("Login Error:", e);
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
    <div>
        <div style="font-weight:bold; font-size:16px">@${user.username}</div>
        <div style="font-size:12px; opacity:0.9">ID: ${user.uid.substring(0,8)}...</div>
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
  if (!address || address.length < 20) return toast("تنبيه", "تأكد من العنوان", "warning");
  const { error } = await sb.from("user_wallets").upsert({ pi_uid: user.uid, wallet_address: address });
  if (error) toast("خطأ", "فشل الحفظ", "error");
  else toast("تم الحفظ", "تم تحديث المحفظة ✅", "success");
}

// === المنطق الأساسي لعرض المدفوعات ===
async function loadMyCycles() {
  const list = document.getElementById("myCyclesList");
  list.innerHTML = `<div class="muted" style="text-align:center; margin:20px 0;">جاري جلب بيانات الدفع... ⏳</div>`;

  try {
      // 1. جلب العضويات
      const { data: members, error } = await sb
        .from("members")
        .select(`
          id, position, created_at,
          cycles (
            id, title, monthly_amount, status, months, created_at,
            groups ( name )
          )
        `)
        .eq("pi_uid", user.uid);

      if (error || !members || members.length === 0) {
        list.innerHTML = `<div class="muted" style="text-align:center; padding:20px">لست مشتركاً في أي جمعية.</div>`;
        return;
      }

      list.innerHTML = "";

      for (let m of members) {
        const c = m.cycles;
        if(!c) continue;

        // 2. جلب المدفوعات المسجلة لهذا العضو
        // نستخدم installment_number لترتيبها ومعرفة ما تم دفعه
        const { data: payments } = await sb
            .from('payments')
            .select('amount, created_at, installment_number, status')
            .eq('member_id', m.id)
            .eq('status', 'completed')
            .order('installment_number', { ascending: true });
        
        const paidRows = payments || [];
        
        // حساب آخر قسط تم دفعه (أكبر رقم installment_number)
        const lastPaidInstallment = paidRows.length > 0 
            ? Math.max(...paidRows.map(p => p.installment_number || 0)) 
            : 0;

        // القسط القادم هو (آخر قسط + 1)
        const nextInstallmentNum = lastPaidInstallment + 1;
        
        // الحسابات
        const totalAmount = c.monthly_amount * c.months;
        const paidAmountTotal = paidRows.reduce((sum, p) => sum + (p.amount || 0), 0);
        const remainingAmount = totalAmount - paidAmountTotal;
        const progressPercent = Math.min((paidRows.length / c.months) * 100, 100);
        
        // تواريخ
        const cycleStartDate = new Date(c.created_at);
        const payoutDate = new Date(cycleStartDate);
        payoutDate.setMonth(payoutDate.getMonth() + (m.position - 1));

        const isCompleted = paidRows.length >= c.months;

        // بناء سجل الدفعات HTML
        let historyHTML = "";
        if(paidRows.length > 0) {
            historyHTML = `<div style="margin-top:10px; background:#f8f9fa; padding:10px; border-radius:8px; border:1px solid #eee;">
                <div style="font-weight:bold; font-size:12px; margin-bottom:5px; color:#555">📜 سجل الدفعات السابقة:</div>
                ${paidRows.map(p => `
                    <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px; padding-bottom:4px; border-bottom:1px dashed #ddd;">
                        <span>✅ شهر ${p.installment_number || '?'}</span>
                        <span class="muted">${formatDate(p.created_at)}</span>
                    </div>
                `).join('')}
            </div>`;
        }

        list.innerHTML += `
          <div class="dashboard-card">
            <!-- الهيدر -->
            <div class="dash-header">
              <div class="dash-title">
                <h4>${escapeHtml(c.groups?.name)} - ${escapeHtml(c.title)}</h4>
                <span>الحالة: ${c.status === 'open' ? 'نشطة 🟢' : 'مغلقة 🔴'}</span>
              </div>
              <div class="badge primary">${c.monthly_amount} Pi / شهر</div>
            </div>

            <!-- التقدم -->
            <div class="payment-progress">
              <div class="progress-label">
                <span>تم سداد: ${paidRows.length} من ${c.months} أقساط</span>
                <span>${Math.round(progressPercent)}%</span>
              </div>
              <div class="track">
                <div class="fill" style="width: ${progressPercent}%"></div>
              </div>
            </div>

            <!-- تفاصيل مالية -->
            <div class="stats-grid">
               <div class="stat-box">
                 <small>دورك</small>
                 <strong>${m.position}</strong>
               </div>
               <div class="stat-box highlight">
                 <small>موعد القبض</small>
                 <strong>${formatDate(payoutDate)}</strong>
               </div>
               <div class="stat-box">
                 <small>مدفوع</small>
                 <strong>${paidAmountTotal} Pi</strong>
               </div>
               <div class="stat-box">
                 <small>متبقي</small>
                 <strong>${remainingAmount} Pi</strong>
               </div>
            </div>

            <!-- السجل -->
            ${historyHTML}

            <!-- زر الدفع -->
            <div style="margin-top:15px;">
              ${!isCompleted ? 
                `<button class="btn primary sm full-width" onclick="payInstallment(${c.id}, ${c.monthly_amount}, ${m.id}, ${nextInstallmentNum})">
                   💳 دفع قسط شهر (${nextInstallmentNum})
                 </button>` 
                : 
                `<div class="badge success full-width" style="text-align:center; padding:10px;">🎉 مبروك! تم سداد كامل المبلغ</div>`
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

// ===================== عملية الدفع (تسجيل البيانات كاملة) =====================
async function payInstallment(cycleId, amount, memberId, installmentNum) {
  if (!requireLogin()) return;
  
  closeModal('dashboardModal');
  
  const confirmed = confirm(`تأكيد دفع مبلغ ${amount} Pi \nعن القسط رقم: ${installmentNum}؟`);
  if(!confirmed) { openDashboard(); return; }

  toast("جاري التحضير", "يتم الاتصال بمحفظة Pi...", "info");

  try {
    const paymentData = {
      amount: amount,
      memo: `قسط ${installmentNum} - عضوية ${memberId}`,
      metadata: { 
          cycleId: cycleId, 
          type: "installment", 
          memberId: memberId,
          installmentNumber: installmentNum 
      }
    };

    const callbacks = {
      onReadyForServerApproval: (paymentId) => {
        toast("الموافقة", "جاري التحقق من المعاملة...", "info");
        // عملية وهمية للموافقة السريعة (يجب أن تكون عبر السيرفر الفعلي في الإنتاج)
        fetch("/.netlify/functions/approve", {
             method: "POST", headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ paymentId })
        }).catch(() => {}); 
      },
      
      onReadyForServerCompletion: (paymentId, txid) => {
        toast("جاري الحفظ", "يتم تسجيل الدفعة في النظام...", "info");

        // === التسجيل في قاعدة البيانات (الأهم) ===
        sb.from('payments').insert({
            member_id: memberId,
            amount: amount,
            payment_id: paymentId,
            status: 'completed',
            installment_number: installmentNum, // نسجل رقم القسط
            txid: txid // نسجل رقم المعاملة من البلوكتشين
        }).then(({ error }) => {
            if (error) {
                console.error("DB Error:", error);
                // محاولة ثانية في حال فشل الاتصال
                toast("تحذير", "حدث خطأ في التسجيل، لكن تم الدفع. التقط صورة للشاشة.", "warning");
            } else {
                toast("تم بنجاح", `تم دفع القسط رقم ${installmentNum} بنجاح! 🥳`, "success");
                
                // إرسال الإشعار للسيرفر لإغلاق المعاملة في Pi
                fetch("/.netlify/functions/complete", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ paymentId, txid })
                });

                // تحديث الواجهة تلقائياً
                setTimeout(() => openDashboard(), 1500);
            }
        });
      },
      
      onCancel: () => { 
          toast("إلغاء", "تم إلغاء العملية", "warning");
          openDashboard();
      },
      onError: (err) => { 
          console.error(err);
          toast("خطأ", "حدث خطأ غير متوقع: " + err.message, "error"); 
      }
    };

    await Pi.createPayment(paymentData, callbacks);

  } catch (e) {
    console.error(e);
    toast("خطأ", "فشل بدء الدفع", "error");
    openDashboard();
  }
}

// ===================== تحميل الجمعيات (الصفحة الرئيسية) =====================
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
        <p class="muted sm-text">${escapeHtml(g.description || "جمعية مضمونة")}</p>
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
