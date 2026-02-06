// ===================== تهيئة Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co"; 
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== حالة المستخدم =====================
let user = null;

// ===================== الأدوات المساعدة =====================
function escapeHtml(str) { return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function toast(msg, type = "info") {
  const box = document.getElementById("toasts");
  const el = document.createElement("div");
  el.style.cssText = `background:${type==='error'?'#d32f2f':'#333'};color:#fff;padding:12px 16px;border-radius:8px;margin-bottom:8px;font-size:13px;box-shadow:0 4px 10px rgba(0,0,0,0.2);`;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function updateUI() {
  const chip = document.getElementById("userChip");
  const btn = document.getElementById("btnLogin");
  if (user && user.username) {
    chip.style.display = "inline-block";
    chip.textContent = user.username;
    btn.style.display = "none";
  } else {
    chip.style.display = "none";
    btn.style.display = "inline-block";
  }
}

function requireLogin() {
  if (!user?.uid) {
    toast("يجب تسجيل الدخول بـ Pi Browser أولاً", "error");
    return false;
  }
  return true;
}

// ===================== تسجيل الدخول Pi =====================
async function login() {
  try {
    if (!window.Pi) throw new Error("Pi Browser required");
    Pi.init({ version: "2.0", sandbox: false }); // غير sandbox إلى true للتجربة
    const auth = await Pi.authenticate(["username"], onIncompletePaymentFound);
    user = auth.user;
    updateUI();
    toast(`أهلاً بك @${user.username}`);
  } catch (e) {
    console.error(e);
    toast("افتح الموقع من متصفح Pi", "error");
    // محاكاة للتجربة في المتصفح العادي (احذف هذا السطر عند النشر)
    // user = { uid: "test-uid-123", username: "TestUser" }; updateUI();
  }
}

function onIncompletePaymentFound(payment) {
  // معالجة المدفوعات غير المكتملة هنا
  console.log("Incomplete payment", payment);
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
  if (!address) return toast("أدخل عنوان المحفظة", "error");
  if (address.length < 20) return toast("العنوان يبدو قصيراً وغير صحيح", "error");

  const { error } = await sb
    .from("user_wallets")
    .upsert({ pi_uid: user.uid, wallet_address: address });

  if (error) toast("فشل الحفظ", "error");
  else toast("تم حفظ المحفظة بنجاح ✅");
}

async function loadMyCycles() {
  const list = document.getElementById("myCyclesList");
  list.innerHTML = `<div class="muted">جاري تحميل اشتراكاتك...</div>`;

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

  if (!members || members.length === 0) {
    list.innerHTML = `<div class="muted" style="text-align:center">لست مشتركاً في أي جمعية حالياً.</div>`;
    return;
  }

  list.innerHTML = members.map(m => {
    const c = m.cycles;
    return `
      <div class="cycle-item">
        <div class="cycle-info">
          <b style="color:var(--p)">${escapeHtml(c.groups.name)}</b>
          <span class="badge">${c.status}</span>
        </div>
        <div class="cycle-stats">
          <span>الدورة: ${escapeHtml(c.title)}</span> | 
          <span>دورك: ${m.position}</span>
        </div>
        <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center;">
          <b style="font-size:15px">${c.monthly_amount} Pi <span class="muted sm-text">/ شهر</span></b>
          <button class="btn primary sm" onclick="payInstallment(${c.id}, ${c.monthly_amount})">دفع القسط</button>
        </div>
      </div>
    `;
  }).join("");
}

// ===================== عرض الجمعيات (الصفحة الرئيسية) =====================
async function loadGroups() {
  const grid = document.getElementById("groups");
  grid.innerHTML = `<div class="muted">جاري التحميل...</div>`;

  const { data: groups } = await sb
    .from("groups")
    .select("*, cycles(*)"); // جلب الدورات مع المجموعات

  if (!groups || groups.length === 0) {
    grid.innerHTML = `<div class="card">لا توجد جمعيات حالياً</div>`;
    return;
  }

  grid.innerHTML = "";
  groups.forEach(g => {
    // نأخذ أول دورة مفتوحة كمثال للعرض
    const activeCycle = g.cycles?.[0]; 
    const amount = activeCycle ? activeCycle.monthly_amount : "---";
    const membersLimit = g.members_count || 10;
    
    // محاكاة نسبة الاكتمال
    const fakeProgress = Math.floor(Math.random() * 80) + 10; 

    grid.innerHTML += `
      <div class="card">
        <div class="cardTop">
          <h3>${escapeHtml(g.name)}</h3>
          <span class="badge">القسط: ${amount} Pi</span>
        </div>
        <p class="muted sm-text">${escapeHtml(g.description || "جمعية مضمونة وموثقة")}</p>
        
        <div class="progress-container">
          <div class="progress-bar" style="width:${fakeProgress}%"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:12px">
          <span class="muted">مكتملة بنسبة ${fakeProgress}%</span>
          <span>${membersLimit} عضو</span>
        </div>

        <button class="btn soft full-width" onclick="showCycles(${g.id})">عرض الأدوار المتاحة</button>
        <div id="group-cycles-${g.id}" style="margin-top:10px; display:none"></div>
      </div>
    `;
  });
}

// عرض دورات مجموعة معينة
async function showCycles(groupId) {
  const container = document.getElementById(`group-cycles-${groupId}`);
  const isVisible = container.style.display === "block";
  if (isVisible) { container.style.display = "none"; return; }
  
  container.style.display = "block";
  container.innerHTML = "جاري جلب التفاصيل...";

  const { data: cycles } = await sb
    .from("cycles")
    .select("*")
    .eq("group_id", groupId)
    .eq("status", "open"); // فقط المفتوحة

  if(!cycles || cycles.length === 0) {
    container.innerHTML = "<div class='muted sm-text'>لا توجد دورات متاحة للتسجيل</div>";
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

// تحميل المربعات (الأدوار)
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

// ===================== العمليات (انضمام / دفع) =====================
async function joinCycle(cycleId, pos) {
  if (!requireLogin()) return;

  const { error } = await sb.from("members").insert({
    cycle_id: cycleId,
    pi_uid: user.uid,
    username: user.username,
    position: pos
  });

  if (error) {
    console.error(error);
    toast("عذراً، هذا الدور تم حجزه أو أنك مشترك بالفعل", "error");
  } else {
    toast(`تم حجز الدور ${pos} بنجاح!`);
    loadSlots(cycleId, 10, 0); // تحديث سريع
    openDashboard(); // فتح الحساب ليرى اشتراكه
  }
}

async function payInstallment(cycleId, amount) {
  if (!requireLogin()) return;
  
  try {
    const paymentData = {
      amount: amount,
      memo: "قسط الجمعية",
      metadata: { cycleId: cycleId, type: "installment" }
    };

    const payment = await Pi.createPayment(paymentData, {
      onReadyForServerApproval: (paymentId) => { 
        // هنا ترسل الـ ID للسيرفر للموافقة
        // Server-side: POST /approve { paymentId }
        // محاكاة النجاح:
        toast("جاري معالجة الدفع...");
      },
      onReadyForServerCompletion: (paymentId, txid) => {
        // هنا تسجل الدفعة في جدول payments
        recordPayment(paymentId, txid, cycleId, amount);
      },
      onCancel: () => toast("تم إلغاء الدفع"),
      onError: (err) => toast("خطأ في عملية الدفع", "error")
    });
  } catch (e) {
    console.error(e);
    toast("خطأ في بدء الدفع", "error");
  }
}

async function recordPayment(paymentId, txid, cycleId, amount) {
  // 1. Get Member ID
  const { data: mem } = await sb.from("members").select("id").eq("cycle_id", cycleId).eq("pi_uid", user.uid).single();
  
  if(mem) {
    await sb.from("payments").insert({
      member_id: mem.id,
      amount: amount,
      payment_id: paymentId,
      status: 'confirmed'
    });
    toast("تم استلام القسط بنجاح! شكراً لالتزامك ✅");
    loadMyCycles(); // تحديث الواجهة
  }
}

// ===================== البحث =====================
function filterGroups(val) {
  const term = val.toLowerCase();
  document.querySelectorAll("#groups .card").forEach(el => {
    const txt = el.innerText.toLowerCase();
    el.style.display = txt.includes(term) ? "block" : "none";
  });
}

// تشغيل عند البدء
window.addEventListener('load', () => {
  loadGroups();
});
