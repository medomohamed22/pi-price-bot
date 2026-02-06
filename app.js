// ===================== Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== User =====================
let user = null;

// ===================== Helpers =====================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setUserUI() {
  const chip = document.getElementById("userChip");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");

  if (user?.username) {
    chip.textContent = `👤 ${user.username}`;
    if (btnLogin) btnLogin.style.display = "none";
    if (btnLogout) btnLogout.style.display = "inline-block";
  } else {
    chip.textContent = "👤 ضيف";
    if (btnLogin) btnLogin.style.display = "inline-block";
    if (btnLogout) btnLogout.style.display = "none";
  }
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

  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
  }, ms);

  setTimeout(() => el.remove(), ms + 220);
}

function requireLogin() {
  if (!user?.uid) {
    toast("لازم تسجل دخول", "سجّل دخول بـ Pi عشان تحجز دور أو تدفع", "error");
    return false;
  }
  return true;
}

// ===================== Login / Logout =====================
async function login() {
  try {
    if (!window.Pi) {
      toast("Pi Browser مطلوب", "افتح الموقع من Pi Browser عشان تسجيل الدخول يشتغل", "error");
      return;
    }

    Pi.init({ version: "2.0", sandbox: false });

    const auth = await Pi.authenticate(["username"], () => {});
    user = auth.user;

    setUserUI();
    toast("تم تسجيل الدخول ✅", "دلوقتي تقدر تحجز دورك", "success");
  } catch (e) {
    console.error("Pi login error:", e);
    toast("فشل تسجيل الدخول", "جرّب تفتح الموقع من Pi Browser", "error");
  }
}

function logout() {
  user = null;
  setUserUI();
  toast("تم تسجيل الخروج", "", "info");
}

// ===================== Dashboard & Modals =====================
function openModal(id) {
  document.getElementById(id).classList.add("active");
}

function closeModal(id) {
  document.getElementById(id).classList.remove("active");
}

// دالة لوحة التحكم (Dashboard)
async function openDashboard() {
  if (!requireLogin()) return; // التأكد من تسجيل الدخول
  
  openModal("dashboardModal");
  const list = document.getElementById("myCyclesList");
  
  list.innerHTML = `<div class="muted">جاري البحث عن جمعياتك...</div>`;

  // جلب البيانات: العضوية -> الدورة -> الجمعية
  const { data: mySeats, error } = await sb
    .from("members")
    .select(`
      position, 
      created_at,
      cycles (
        id, title, monthly_amount, status,
        groups ( name )
      )
    `)
    .eq("pi_uid", user.uid);

  if (error) {
    console.error(error);
    list.innerHTML = `<div class="toast error">خطأ في التحميل: ${escapeHtml(error.message)}</div>`;
    return;
  }

  if (!mySeats || mySeats.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:30px;margin-bottom:10px">📂</div>
        <p>أنت غير مشترك في أي جمعية حالياً</p>
        <button class="btn primary sm" onclick="closeModal('dashboardModal')">تصفح الجمعيات</button>
      </div>
    `;
    return;
  }

  list.innerHTML = mySeats.map(item => {
    const cycle = item.cycles;
    const groupName = cycle?.groups?.name || "جمعية";
    
    return `
      <div class="cycleCard" style="margin-bottom:10px; border-color:var(--p)">
        <div class="cycleHead">
          <div>
            <b>${escapeHtml(groupName)} - ${escapeHtml(cycle.title)}</b>
            <div class="muted" style="font-size:13px; margin-top:4px">
              دورك رقم: <b>${item.position}</b> | القسط: <b>${cycle.monthly_amount} Pi</b>
            </div>
          </div>
          <span class="badge ${cycle.status === 'active' ? 'ok' : 'pi'}">
            ${cycle.status || 'تحت التجميع'}
          </span>
        </div>
        <div style="margin-top:10px; display:flex; gap:8px">
           <button class="btn primary sm" onclick="pay(${cycle.id}, ${cycle.monthly_amount})">دفع القسط</button>
        </div>
      </div>
    `;
  }).join("");
}

// ===================== Search =====================
function filterGroups(query) {
  const term = query.toLowerCase();
  const cards = document.querySelectorAll("#groups .card");
  
  cards.forEach(card => {
    const title = card.querySelector("h3").textContent.toLowerCase();
    const text = card.textContent.toLowerCase();
    
    if (title.includes(term) || text.includes(term)) {
      card.style.display = "block";
    } else {
      card.style.display = "none";
    }
  });
}

// ===================== Load Groups (Public) =====================
async function loadGroups() {
  const box = document.getElementById("groups");
  if (!box) return;

  box.innerHTML = `
    <div class="card">
      <b>جاري تحميل الجمعيات...</b>
      <div class="muted" style="margin-top:6px">ثواني بس</div>
    </div>
  `;

  const { data, error } = await sb
    .from("groups")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("loadGroups error:", error);
    box.innerHTML = `
      <div class="card">
        <h3>مشكلة في عرض الجمعيات</h3>
        <p class="muted">غالباً RLS مانعة القراءة.</p>
        <p style="direction:ltr;text-align:left" class="muted">${escapeHtml(error.message || "")}</p>
      </div>
    `;
    return;
  }

  if (!data || data.length === 0) {
    box.innerHTML = `
      <div class="card">
        <h3>مفيش جمعيات لسه</h3>
        <p class="muted">أول ما الأدمن ينشئ جمعية هتظهر هنا.</p>
      </div>
    `;
    return;
  }

  box.innerHTML = "";

  data.forEach((g) => {
    const membersCount = Number(g.members_count || 10);
    // محاكاة لعدد المشتركين (للعرض فقط) - يفضل جلبها من الداتابيس عبر Count
    // بما أننا لا نملك Count حالياً، سنفترض أنها فارغة (0) أو نضع قيمة عشوائية للمعاينة
    const currentMembers = 0; 
    const percent = Math.min((currentMembers / membersCount) * 100, 100);

    box.innerHTML += `
      <div class="card">
        <div class="cardTop">
          <div>
            <h3>${escapeHtml(g.name)}</h3>
            <p>الأعضاء: <b>${membersCount}</b></p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge ok">متاحة</span>
            <span class="badge pi">Pi</span>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="progressWrap" title="نسبة الاكتمال">
          <div class="progressBar" style="width:${percent}%"></div>
        </div>
        <div style="font-size:11px; text-align:left; color:var(--mut); margin-top:4px">
           ${currentMembers} / ${membersCount} مشترك
        </div>

        <div class="cardActions">
          <button class="btn primary btnExpand" onclick="toggleGroup(${Number(g.id)})">
            عرض الدورات
          </button>
          <button class="btn soft" onclick="openGroup(${Number(g.id)})">تحميل</button>
        </div>

        <div class="panel" id="cycles-${Number(g.id)}" style="display:none"></div>
      </div>
    `;
  });
}

function toggleGroup(groupId){
  const panel = document.getElementById(`cycles-${groupId}`);
  if(!panel) return;

  const isHidden = panel.style.display === "none";
  panel.style.display = isHidden ? "block" : "none";

  if(isHidden){
    openGroup(groupId);
  }
}

// ===================== Open Group -> list cycles =====================
async function openGroup(groupId) {
  const panel = document.getElementById(`cycles-${groupId}`);
  if (!panel) return;

  panel.innerHTML = `
    <div class="cycleCard">
      <b>جاري تحميل الدورات...</b>
      <div class="muted" style="margin-top:6px">ثواني</div>
    </div>
  `;

  const { data, error } = await sb
    .from("cycles")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("openGroup cycles error:", error);
    panel.innerHTML = `
      <div class="cycleCard">
        <b>مشكلة في عرض الدورات</b>
        <div class="muted" style="direction:ltr;text-align:left;margin-top:6px">${escapeHtml(error.message || "")}</div>
      </div>
    `;
    return;
  }

  if (!data || data.length === 0) {
    panel.innerHTML = `<div class="cycleCard"><b>مفيش دورات لسه</b></div>`;
    return;
  }

  panel.innerHTML = data.map((c) => {
    const months = Number(c.months || 10);
    const amt = Number(c.monthly_amount || 0);

    return `
      <div class="cycleCard">
        <div class="cycleHead">
          <div>
            <b>${escapeHtml(c.title)}</b>
            <div class="muted" style="margin-top:6px">
              القسط: <b>${amt} Pi</b> — المدة: <b>${months}</b> شهور
            </div>
            <div class="muted" style="margin-top:6px">
              الحالة: <b>${escapeHtml(c.status || "open")}</b>
            </div>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn primary" onclick="openCycle(${Number(c.id)}, ${months}, ${amt})">اختيار الدور</button>
            <button class="btn ghost" onclick="pay(${Number(c.id)}, ${amt})">دفع</button>
          </div>
        </div>

        <div id="cycle-${Number(c.id)}"></div>
      </div>
    `;
  }).join("");
}

// ===================== Open Cycle -> show slots =====================
async function openCycle(cycleId, membersCount, monthlyAmount) {
  const box = document.getElementById(`cycle-${cycleId}`);
  if (!box) return;

  box.innerHTML = `<div class="muted" style="margin-top:10px">جاري تحميل الأدوار...</div>`;

  const { data: members, error } = await sb
    .from("members")
    .select("position, username")
    .eq("cycle_id", cycleId);

  if (error) {
    console.error("openCycle error:", error);
    box.innerHTML = `<div class="muted">مشكلة في تحميل الأدوار</div>`;
    return;
  }

  const taken = new Map();
  (members || []).forEach(m => taken.set(Number(m.position), m.username || "عضو"));

  let html = `<div class="slotGrid">`;

  for (let pos = 1; pos <= membersCount; pos++) {
    const isTaken = taken.has(pos);
    const label = isTaken ? `محجوز` : `متاح`;

    html += `
      <button class="btn ${isTaken ? "ghost" : "primary"} slotBtn"
        style="opacity:${isTaken ? .55 : 1}"
        ${isTaken ? "disabled" : ""}
        onclick="joinCycle(${cycleId}, ${pos}, ${membersCount}, ${monthlyAmount})"
      >
        الدور ${pos}<br>
        <span style="font-size:12px;opacity:.9">${label}</span>
      </button>
    `;
  }

  html += `</div>`;

  html += user?.uid
    ? `<div class="muted" style="margin-top:10px">✅ اختر دورك المتاح</div>`
    : `<div class="muted" style="margin-top:10px">👤 ضيف: سجّل دخول عشان تحجز</div>`;

  box.innerHTML = html;
}

// ===================== Join Cycle (reserve position) =====================
async function joinCycle(cycleId, position, membersCount, monthlyAmount) {
  if (!requireLogin()) return;

  const payload = {
    cycle_id: cycleId,
    pi_uid: user.uid,
    username: user.username,
    position
  };

  const { error } = await sb.from("members").insert(payload);

  if (error) {
    console.error("joinCycle error:", error);
    toast("مش قادر أحجز الدور", "الدور اتحجز أو أنت منضم للدورة بالفعل", "error");
    openCycle(cycleId, membersCount, monthlyAmount);
    return;
  }

  toast("تم حجز الدور ✅", `حجزت الدور رقم ${position}`, "success");
  openCycle(cycleId, membersCount, monthlyAmount);
}

// ===================== Pay =====================
async function pay(cycleId, amount) {
  if (!requireLogin()) return;

  if (!window.Pi) {
    toast("Pi Browser مطلوب", "افتح من Pi Browser عشان الدفع يشتغل", "error");
    return;
  }

  if (!amount || amount <= 0) {
    toast("قيمة غير صحيحة", "القسط الشهري غير مضبوط", "error");
    return;
  }

  toast("بدء الدفع", "هيتم فتح نافذة الدفع الآن", "info");

  try {
    await Pi.createPayment(
      { amount: Number(amount), memo: "قسط الجمعية", metadata: { cycleId } },
      {
        onReadyForServerApproval: (paymentId) => {
          fetch("/.netlify/functions/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId }),
          });
        },
        onReadyForServerCompletion: (paymentId, txid) => {
          fetch("/.netlify/functions/complete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paymentId, txid }),
          });
        },
        onCancel: () => toast("تم الإلغاء", "تم إلغاء عملية الدفع", "info"),
        onError: (err) => {
          console.error("Pi payment error:", err);
          toast("خطأ في الدفع", "حصلت مشكلة أثناء الدفع", "error");
        },
      }
    );
  } catch (e) {
    console.error("pay() error:", e);
    toast("فشل الدفع", "حصلت مشكلة أثناء بدء الدفع", "error");
  }
}

// ===================== On Load =====================
window.addEventListener("load", () => {
  setUserUI();
  loadGroups();
});
