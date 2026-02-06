// ===================== Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== State =====================
let user = null;
let active = {
  cycle: null,
  member: null,
  currentMonth: 1,
  nextPayMonth: 1
};

// ===================== Helpers =====================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(title, msg = "", type = "info", ms = 3200) {
  const wrap = document.getElementById("toasts");
  if (!wrap) { alert(title + (msg ? ("\n" + msg) : "")); return; }

  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `
    <div>
      <div class="tTitle">${escapeHtml(title)}</div>
      ${msg ? `<div class="tMsg">${escapeHtml(msg)}</div>` : ``}
    </div>
    <button class="tClose" aria-label="close">✕</button>
  `;
  el.querySelector(".tClose").onclick = () => el.remove();
  wrap.appendChild(el);

  setTimeout(() => { el.style.opacity="0"; el.style.transform="translateY(8px)"; }, ms);
  setTimeout(() => el.remove(), ms + 220);
}

function setUserUI(){
  const chip = document.getElementById("userChip");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if(user?.username){
    chip.textContent = `👤 ${user.username}`;
    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-block";
  }else{
    chip.textContent = "👤 ضيف";
    btnLogin.style.display = "inline-block";
    btnLogout.style.display = "none";
  }
}

function formatDate(d){
  if(!d) return "—";
  const x = new Date(d);
  if(Number.isNaN(x.getTime())) return "—";
  return x.toLocaleDateString("ar-EG", { year:"numeric", month:"long", day:"numeric" });
}

function addMonths(dateObj, months){
  const d = new Date(dateObj);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // fix rollover
  if(d.getDate() < day) d.setDate(0);
  return d;
}

function goHome(){
  // ✅ أفضل: رجوع مباشر (بدون اعتماد على سكوب)
  window.location.href = "index.html";
}
window.goHome = goHome;

// ===================== Pi Login =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("Pi Browser مطلوب", "افتح من Pi Browser عشان تسجيل الدخول يشتغل", "error");
      return;
    }
    
    Pi.init({ version: "2.0", sandbox: false });
    
    // ✅ هنا بناخد username + payments scope
    const auth = await Pi.authenticate(["username", "payments"], () => {});
    user = auth.user;
    
    setUserUI();
    toast("تم تسجيل الدخول ✅", `أهلًا ${user.username}`, "success");
    await refreshDash();
  } catch (e) {
    console.error(e);
    toast("فشل تسجيل الدخول", (e?.message || "جرّب من Pi Browser"), "error");
  }
}
function logout(){
  user = null;
  active = { cycle:null, member:null, currentMonth:1, nextPayMonth:1 };
  setUserUI();
  renderEmpty("لازم تسجل دخول عشان نشوف جمعيتك الحالية.");
}
window.login = login;
window.logout = logout;

// ===================== Load My Latest Membership =====================
async function getMyLatestMember(){
  // نحاول أولاً من localStorage (لو المستخدم اختار دورة من الصفحة الرئيسية)
  const savedCycleId = Number(localStorage.getItem("activeCycleId") || 0);
  if(savedCycleId){
    const { data: m1, error: e1 } = await sb
      .from("members")
      .select("*")
      .eq("cycle_id", savedCycleId)
      .eq("pi_uid", user.uid)
      .order("joined_at", { ascending:false })
      .limit(1);

    if(!e1 && m1 && m1.length) return m1[0];
  }

  // وإلا نجيب آخر انضمام لأي دورة
  const { data, error } = await sb
    .from("members")
    .select("*")
    .eq("pi_uid", user.uid)
    .order("joined_at", { ascending:false })
    .limit(1);

  if(error) throw error;
  return data?.[0] || null;
}

async function getCycle(cycleId){
  const { data, error } = await sb
    .from("cycles")
    .select("*")
    .eq("id", cycleId)
    .single();
  if(error) throw error;
  return data;
}

async function getGroup(groupId){
  const { data, error } = await sb
    .from("groups")
    .select("*")
    .eq("id", groupId)
    .single();
  if(error) throw error;
  return data;
}

// ===================== Compute current month =====================
function computeCurrentMonth(cycle){
  if(cycle?.current_month) return Number(cycle.current_month) || 1;
  if(cycle?.start_date){
    const start = new Date(cycle.start_date);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear())*12 + (now.getMonth() - start.getMonth());
    return Math.max(1, Math.min(Number(cycle.months||10), months + 1));
  }
  return 1; // fallback
}

// ===================== Payments (optional) =====================
async function getMyPayments(cycleId){
  const { data, error } = await sb
    .from("payments")
    .select("*")
    .eq("cycle_id", cycleId)
    .eq("pi_uid", user.uid)
    .order("month", { ascending:true });

  if(error){
    console.warn("payments table not available or RLS:", error.message);
    return { list: [], available:false };
  }
  return { list: data || [], available:true };
}

function findNextPayMonth(currentMonth, months, myPayments){
  const paidMonths = new Set((myPayments||[]).map(p => Number(p.month)));
  if(paidMonths.has(currentMonth)) return Math.min(months, currentMonth + 1);
  return currentMonth;
}

// ===================== Render =====================
function renderEmpty(msg){
  document.getElementById("dashTitle").textContent = "مفيش بيانات";
  document.getElementById("dashSub").textContent = msg || "—";
  document.getElementById("dashNote").textContent = "";
  document.getElementById("paymentsBox").innerHTML = `<div class="muted">${escapeHtml(msg||"")}</div>`;

  document.getElementById("kpiPosition").textContent = "—";
  document.getElementById("kpiPayoutDate").textContent = "—";
  document.getElementById("kpiNextPay").textContent = "—";
  document.getElementById("progressText").textContent = "—";
  document.getElementById("progressPct").textContent = "—";
  document.getElementById("progressFill").style.width = "0%";
}

function renderPayments(payments, months, currentMonth){
  const box = document.getElementById("paymentsBox");
  if(!payments.available){
    box.innerHTML = `<div class="muted">جدول payments غير متاح (اختياري). هنكمل بدون سجل مدفوعات.</div>`;
    return;
  }

  const paidMonths = new Set(payments.list.map(p => Number(p.month)));
  let html = "";

  for(let m=1; m<=months; m++){
    const tag = paidMonths.has(m) ? `<span class="payTag ok">مدفوع</span>` :
      (m === currentMonth ? `<span class="payTag warn">مطلوب الآن</span>` : `<span class="payTag">غير مدفوع</span>`);
    html += `
      <div class="payItem">
        <b>شهر ${m}</b>
        ${tag}
      </div>
    `;
  }
  box.innerHTML = html;
}

function renderDash(group, cycle, member, currentMonth, nextPayMonth, payments){
  const months = Number(cycle.months || 10);
  const amt = Number(cycle.monthly_amount || 0);

  let payoutDateText = "—";
  if(cycle.start_date){
    const payoutDate = addMonths(new Date(cycle.start_date), Number(member.position||1) - 1);
    payoutDateText = formatDate(payoutDate);
  }else{
    payoutDateText = `شهر رقم ${Number(member.position||1)} (حدد start_date لعرض تاريخ)`;
  }

  let nextPayText = `شهر ${nextPayMonth} — ${amt} Pi`;
  if(cycle.start_date){
    const due = addMonths(new Date(cycle.start_date), nextPayMonth - 1);
    nextPayText = `${formatDate(due)} — ${amt} Pi`;
  }

  const pct = Math.round((currentMonth / months) * 100);
  document.getElementById("progressFill").style.width = `${pct}%`;
  document.getElementById("progressText").textContent = `الشهر ${currentMonth} من ${months}`;
  document.getElementById("progressPct").textContent = `${pct}%`;

  document.getElementById("dashTitle").textContent = `${group.name} — ${cycle.title}`;
  document.getElementById("dashSub").textContent = `القسط الشهري: ${amt} Pi • مدة الدورة: ${months} شهور`;
  document.getElementById("dashStatus").textContent =
    (cycle.status || "open") === "open" ? "نشط" : (cycle.status || "—");

  document.getElementById("kpiPosition").textContent = `${member.position}`;
  document.getElementById("kpiPayoutDate").textContent = payoutDateText;
  document.getElementById("kpiNextPay").textContent = nextPayText;

  document.getElementById("dMonthly").textContent = `${amt} Pi`;
  document.getElementById("dMonths").textContent = `${months} شهر`;
  document.getElementById("dStart").textContent = cycle.start_date ? formatDate(cycle.start_date) : "غير محدد";
  document.getElementById("dCurrent").textContent = `${currentMonth}`;

  document.getElementById("dashNote").textContent =
    cycle.start_date ? "✅ التواريخ محسوبة من start_date." : "ℹ️ لتفعيل التواريخ بدقة: أضف start_date للدورة في قاعدة البيانات.";

  renderPayments(payments, months, currentMonth);

  document.getElementById("btnPay").disabled = !user?.uid;
}

// ===================== Refresh Dashboard =====================
async function refreshDash(){
  if(!user?.uid){
    renderEmpty("سجّل دخول عشان نعرض جمعيتك الحالية.");
    return;
  }

  try{
    const member = await getMyLatestMember();
    if(!member){
      renderEmpty("أنت مش منضم لأي دورة حالياً. ارجع لصفحة الجمعيات واحجز دور.");
      return;
    }

    const cycle = await getCycle(member.cycle_id);
    const group = await getGroup(cycle.group_id);

    const currentMonth = computeCurrentMonth(cycle);
    const payments = await getMyPayments(cycle.id);
    const nextPayMonth = findNextPayMonth(currentMonth, Number(cycle.months||10), payments.list);

    active = { cycle, member, currentMonth, nextPayMonth };

    renderDash(group, cycle, member, currentMonth, nextPayMonth, payments);

  }catch(e){
    console.error("refreshDash error:", e);
    toast("مشكلة في تحميل الداشبورد", e.message || "Error", "error");
    renderEmpty("حصل خطأ أثناء تحميل البيانات.");
  }
}
window.refreshDash = refreshDash;

// ===================== Pay Next Installment (FIXED) =====================
async function payNext(){
  if(!user?.uid){
    toast("لازم تسجل دخول", "سجل دخول بـ Pi الأول", "error");
    return;
  }
  if(!active?.cycle){
    toast("مفيش دورة", "اختار دورة من الصفحة الرئيسية أولاً", "error");
    return;
  }

  const amt = Number(active.cycle.monthly_amount || 0);
  if(!amt || amt <= 0){
    toast("القسط غير مضبوط", "monthly_amount غير صحيح", "error");
    return;
  }

  if(!window.Pi){
    toast("Pi Browser مطلوب", "افتح من Pi Browser عشان الدفع يشتغل", "error");
    return;
  }

  // ✅ مهم: اعمل init قبل الدفع
  try{
    Pi.init({ version:"2.0", sandbox:false });
  }catch(e){
    console.warn("Pi.init warning:", e);
  }

  toast("بدء الدفع", "سيتم فتح نافذة الدفع الآن", "info");

  try{
    await Pi.createPayment(
      {
        amount: amt,
        memo: "قسط الجمعية",
        metadata: { cycleId: active.cycle.id, month: active.nextPayMonth }
      },
      {
        onReadyForServerApproval: async (paymentId) => {
          try{
            const r = await fetch("/.netlify/functions/approve", {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ paymentId })
            });
            const txt = await r.text();

            // لو approve فشل غالباً الدفع هيفشل
            if(!r.ok){
              console.error("approve failed:", r.status, txt);
              toast("approve فشل", `status ${r.status}`, "error");
            }else{
              console.log("approve ok:", txt);
            }
          }catch(e){
            console.error("approve fetch error:", e);
            toast("مشكلة سيرفر", "approve endpoint مش شغال", "error");
          }
        },

        onReadyForServerCompletion: async (paymentId, txid) => {
          try{
            const r = await fetch("/.netlify/functions/complete", {
              method:"POST",
              headers:{ "Content-Type":"application/json" },
              body: JSON.stringify({ paymentId, txid })
            });
            const txt = await r.text();

            if(!r.ok){
              console.error("complete failed:", r.status, txt);
              toast("complete فشل", `status ${r.status}`, "error");
              return;
            }

            console.log("complete ok:", txt);
            toast("تم الدفع ✅", "تم تسجيل الدفع بنجاح", "success");
            refreshDash();
          }catch(e){
            console.error("complete fetch error:", e);
            toast("مشكلة سيرفر", "complete endpoint مش شغال", "error");
          }
        },

        onCancel: () => toast("تم الإلغاء", "تم إلغاء الدفع", "info"),

        onError: (err) => {
          console.error("Pi payment error:", err);
          toast("خطأ في الدفع", (err?.message || "حصلت مشكلة أثناء الدفع"), "error");
        }
      }
    );
  }catch(e){
    console.error("createPayment throw:", e);
    toast("فشل الدفع", (e?.message || "حصل خطأ أثناء بدء الدفع"), "error");
  }
}
window.payNext = payNext;

// ===================== On Load =====================
window.addEventListener("load", () => {
  setUserUI();
  renderEmpty("سجّل دخول عشان نعرض جمعيتك الحالية.");
});
