// ===================== تهيئة Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== حالة المستخدم =====================
let user = null;

// ===================== نظام الإشعارات الجديد =====================
const icons = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️'
};

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
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(el);

  // إزالة تلقائية
  setTimeout(() => {
    el.style.animation = "fadeOut 0.3s forwards";
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

// ===================== تسجيل الدخول Pi =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("خطأ متصفح", "يرجى فتح الموقع داخل متصفح Pi Browser", "error");
      return;
    }

    // تهيئة Pi SDK
    Pi.init({ version: "2.0", sandbox: false }); // false للإنتاج

    // طلب الصلاحيات الصحيحة
    const scopes = ['username', 'payments'];

    // بدء المصادقة
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);

    user = auth.user;
    updateUI();
    toast("تم الدخول بنجاح", `أهلاً بك يا @${user.username}`, "success");
    
    // تحميل البيانات إذا كان في الصفحة لوحة تحكم مفتوحة
    if(document.getElementById("dashboardModal").classList.contains("active")){
        loadMyCycles();
    }

  } catch (e) {
    console.error("Login Error:", e);
    toast("فشل الدخول", "تأكد من الاتصال وحاول مرة أخرى", "error");
  }
}

function onIncompletePaymentFound(payment) {
  // معالجة عمليات الدفع العالقة
  console.log("Incomplete payment found:", payment);
  
  // نحاول إرسالها للسيرفر للإكمال إذا كانت تمت ولم تسجل
  if (payment.transaction_id) {
     fetch("/.netlify/functions/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: payment.identifier, txid: payment.transaction_id }),
     });
  } else {
      // إذا لم يكن لها txid، يمكن إلغاؤها لتنظيف النظام
      // Pi.createPayment(...).catch(...) // لا ينصح بالإلغاء التلقائي دائماً
  }
}


// ===================== إدارة المحفظة والحساب =====================
function openDashboard() {
  if (!requireLogin()) return;
  document.getElementById("dashboardModal").classList.add("active");
  loadWallet();
  loadMyCycles();
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

async function loadWallet() {
  const input = document.getElementById("walletInput");
  input.value = "جاري التحميل...";
  
  const { data, error } = await sb
    .from("user_wallets")
    .select("wallet_address")
    .eq("pi_uid", user.uid)
    .single();

  if (data) input.value = data.wallet_address;
  else input.value = "";
}

async function saveWallet() {
  const address = document.getElementById("walletInput").value.trim();
  if (!address || address.length < 20) {
     return toast("تنبيه", "أدخل عنوان محفظة صحيح (يبدأ بـ G)", "warning");
  }

  const { error } = await sb
    .from("user_wallets")
    .upsert({ pi_uid: user.uid, wallet_address: address });

  if (error) toast("خطأ", "فشل حفظ المحفظة", "error");
  else toast("تم الحفظ", "تم تحديث عنوان محفظتك بنجاح ✅", "success");
}

async function loadMyCycles() {
  const list = document.getElementById("myCyclesList");
  list.innerHTML = `<div class="muted">جاري تحميل بياناتك...</div>`;

  const { data: members, error } = await sb
    .from("members")
    .select(`
      position,
      cycles (
        id, title, monthly_amount, status,
        groups ( name )
      )
    `)
    .eq("pi_uid", user.uid);

  if (error) {
      list.innerHTML = `<div class="muted">حدث خطأ في التحميل</div>`;
      return;
  }

  if (!members || members.length === 0) {
    list.innerHTML = `<div class="muted" style="text-align:center; padding:20px">لست مشتركاً في أي جمعية حالياً.</div>`;
    return;
  }

  list.innerHTML = members.map(m => {
    const c = m.cycles;
    return `
      <div class="cycle-item">
        <div class="cycle-info">
          <b style="color:var(--p)">${escapeHtml(c.groups?.name)}</b>
          <span class="badge">${c.status}</span>
        </div>
        <div class="cycle-stats">
          <span>الدورة: ${escapeHtml(c.title)}</span> | 
          <span>دورك رقم: <b>${m.position}</b></span>
        </div>
        <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:15px">${c.monthly_amount} Pi <span class="muted sm-text">/ شهر</span></b>
          <button class="btn primary sm" onclick="payInstallment(${c.id}, ${c.monthly_amount})">دفع القسط</button>
        </div>
      </div>
    `;
  }).join("");
}

// ===================== نظام الدفع الحقيقي (Fix) =====================
async function payInstallment(cycleId, amount) {
  if (!requireLogin()) return;

  // إغلاق المودال مؤقتاً لتركيز المستخدم
  closeModal('dashboardModal');
  toast("بدء الدفع", "يرجى الانتظار، جاري تحضير المعاملة...", "info", 5000);

  try {
    const paymentData = {
      amount: amount,
      memo: "قسط جمعية", // وصف يظهر في المحفظة
      metadata: { cycleId: cycleId, type: "installment" } // بيانات مخفية للسيرفر
    };

    const paymentCallbacks = {
      // 1. عندما يكون الدفع جاهزاً للموافقة
      onReadyForServerApproval: (paymentId) => {
        toast("جاري الموافقة", "يتم التحقق من بياناتك...", "info");
        
        // الاتصال بالسيرفر للموافقة
        fetch("/.netlify/functions/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId: paymentId })
        }).then(res => {
            if(!res.ok) throw new Error("Approval failed");
            console.log("Approved");
        }).catch(err => {
            console.error(err);
            toast("خطأ", "فشل التحقق من الدفعة", "error");
        });
      },

      // 2. عندما يوافق المستخدم ويسجل في البلوكتشين (Txid)
      onReadyForServerCompletion: (paymentId, txid) => {
        toast("اكتمال الدفع", "يتم تسجيل الدفعة في قاعدة البيانات...", "info");

        // الاتصال بالسيرفر للإكمال والتخزين في الداتابيس
        fetch("/.netlify/functions/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId: paymentId, txid: txid })
        }).then(res => {
            if(!res.ok) throw new Error("Completion failed");
            return res.json();
        }).then(data => {
            // نجاح كامل
            toast("تم بنجاح", "تم دفع القسط وتسجيله! شكراً لك 🎉", "success", 6000);
            openDashboard(); // العودة لصفحة الحساب
        }).catch(err => {
            console.error(err);
            toast("تنبيه", "تم الدفع ولكن فشل التأكيد، تواصل مع الدعم", "warning");
        });
      },

      // 3. إلغاء
      onCancel: (paymentId) => {
        toast("إلغاء", "تم إلغاء عملية الدفع", "warning");
        openDashboard();
      },

      // 4. خطأ
      onError: (error, payment) => {
        console.error(error);
        toast("خطأ", "حدث خطأ أثناء الدفع: " + (error.message || ""), "error");
      }
    };

    // إنشاء الدفعة
    await Pi.createPayment(paymentData, paymentCallbacks);

  } catch (e) {
    console.error(e);
    toast("خطأ", "لم نتمكن من بدء عملية الدفع", "error");
    openDashboard();
  }
}

// ===================== باقي الأكواد (عرض الجمعيات) =====================
// ... (نفس دالة loadGroups القديمة ولكن تأكد من أنها تستخدم toast الجديد)
async function loadGroups() {
  const grid = document.getElementById("groups");
  if(!grid) return;
  
  grid.innerHTML = `<div class="muted">جاري تحميل الجمعيات...</div>`;

  const { data: groups } = await sb
    .from("groups")
    .select("*, cycles(*)")
    .order('created_at', { ascending: false });

  if (!groups || groups.length === 0) {
    grid.innerHTML = `<div class="card">لا توجد جمعيات حالياً</div>`;
    return;
  }

  grid.innerHTML = "";
  groups.forEach(g => {
    // منطق العرض
    const activeCycle = g.cycles?.find(c => c.status === 'open') || g.cycles?.[0];
    const amount = activeCycle ? activeCycle.monthly_amount : "---";
    const membersLimit = g.members_count || 10;
    
    // حساب تقريبي للنسبة (للعرض فقط)
    // لتحسين هذا يفضل جلب count من members
    const fakeProgress = 10; 

    grid.innerHTML += `
      <div class="card">
        <div class="cardTop">
          <h3>${escapeHtml(g.name)}</h3>
          <span class="badge">القسط: ${amount} Pi</span>
        </div>
        <p class="muted sm-text">${escapeHtml(g.description || "جمعية مضمونة")}</p>
        
        <div class="progress-container">
          <div class="progress-bar" style="width:${fakeProgress}%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:12px">
          <span class="muted">الحالة: متاح</span>
          <span>${membersLimit} عضو</span>
        </div>

        <button class="btn soft full-width" onclick="showCycles(${g.id})">عرض التفاصيل</button>
        <div id="group-cycles-${g.id}" style="margin-top:10px; display:none"></div>
      </div>
    `;
  });
}

// ... (دوال showCycles, loadSlots, joinCycle كما هي مع استخدام toast الجديد)
async function showCycles(groupId) {
    const container = document.getElementById(`group-cycles-${groupId}`);
    const isVisible = container.style.display === "block";
    if (isVisible) { container.style.display = "none"; return; }
    
    container.style.display = "block";
    container.innerHTML = "جاري التحميل...";
  
    const { data: cycles } = await sb
      .from("cycles")
      .select("*")
      .eq("group_id", groupId)
      .eq("status", "open"); // فقط المفتوحة
  
    if(!cycles || cycles.length === 0) {
      container.innerHTML = "<div class='muted sm-text'>لا توجد دورات متاحة</div>";
      return;
    }
  
    container.innerHTML = cycles.map(c => `
      <div style="background:#f8f9fa; padding:10px; border-radius:8px; margin-top:5px; border:1px solid #eee">
        <div style="display:flex; justify-content:space-between; margin-bottom:5px">
          <b>${escapeHtml(c.title)}</b>
          <small>${c.monthly_amount} Pi</small>
        </div>
        <button class="btn primary sm full-width" onclick="loadSlots(${c.id}, ${c.months}, ${c.monthly_amount})">اختر دورك</button>
        <div id="slots-${c.id}" class="slotGrid" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:5px"></div>
      </div>
    `).join("");
}

async function loadSlots(cycleId, totalMonths, amount) {
    const box = document.getElementById(`slots-${cycleId}`);
    box.innerHTML = "Wait...";
  
    const { data: members } = await sb.from("members").select("position").eq("cycle_id", cycleId);
    const taken = new Set(members?.map(m => m.position) || []);
  
    let html = "";
    for(let i=1; i<=totalMonths; i++) {
      const isTaken = taken.has(i);
      html += `
        <button class="btn ${isTaken ? 'ghost' : 'primary'} sm slotBtn" 
          ${isTaken ? 'disabled style="opacity:0.5"' : ''}
          onclick="joinCycle(${cycleId}, ${i})">
          ${i}
        </button>
      `;
    }
    box.innerHTML = html;
}

async function joinCycle(cycleId, pos) {
    if (!requireLogin()) return;
  
    const { error } = await sb.from("members").insert({
      cycle_id: cycleId,
      pi_uid: user.uid,
      username: user.username,
      position: pos
    });
  
    if (error) {
      toast("فشل الحجز", "هذا الدور محجوز مسبقاً", "error");
    } else {
      toast("تم بنجاح", `تم حجز الدور رقم ${pos}`, "success");
      loadSlots(cycleId, 10, 0); // تحديث سريع
      openDashboard(); // فتح الحساب
    }
}

// تشغيل عند البدء
window.addEventListener('load', () => {
  loadGroups();
});
