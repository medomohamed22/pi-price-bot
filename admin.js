// ===================== Supabase =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== Helpers =====================
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function $(id) { return document.getElementById(id); }

function setStatus(msg) {
  const el = $("adminStatus");
  if (el) el.innerText = msg;
}

// ===================== Load Groups into select =====================
async function loadAdminGroups(selectedId = null) {
  const sel = $("groupSelect");
  if (!sel) return;
  
  sel.innerHTML = `<option value="">جارٍ التحميل...</option>`;
  
  const { data, error } = await sb
    .from("groups")
    .select("*")
    .order("created_at", { ascending: false });
  
  if (error) {
    console.error("Admin load groups error:", error);
    sel.innerHTML = `<option value="">مشكلة في تحميل الجمعيات</option>`;
    setStatus("RLS/Policies مانعة القراءة أو فيه خطأ.");
    return;
  }
  
  if (!data || data.length === 0) {
    sel.innerHTML = `<option value="">مفيش جمعيات</option>`;
    return;
  }
  
  sel.innerHTML = `<option value="">اختر جمعية...</option>` + data.map(g => `
    <option value="${Number(g.id)}" ${selectedId && Number(selectedId)===Number(g.id) ? "selected" : ""}>
      ${escapeHtml(g.name)} (أعضاء: ${Number(g.members_count||10)})
    </option>
  `).join("");
  
  // لو فيه اختيار مسبق اعرض دوراته
  if (selectedId) {
    await loadCyclesForGroup(selectedId);
  }
}

// ===================== Create Group =====================
async function createGroup() {
  const name = ($("groupName")?.value || "").trim();
  const membersCount = Number($("membersCount")?.value || 10);
  
  if (!name) return alert("اكتب اسم الجمعية");
  if (!membersCount || membersCount < 2) return alert("عدد الأعضاء غير صحيح");
  
  const { data, error } = await sb
    .from("groups")
    .insert({ name, members_count: membersCount })
    .select()
    .single();
  
  if (error) {
    console.error("createGroup error:", error);
    alert("حصل خطأ في إنشاء الجمعية (RLS؟)");
    return;
  }
  
  alert("تم إنشاء الجمعية ✅");
  $("groupName").value = "";
  $("membersCount").value = membersCount;
  
  await loadAdminGroups(data.id);
}

// ===================== Create Cycle =====================
async function createCycle() {
  const groupId = Number($("groupSelect")?.value);
  if (!groupId) return alert("اختار الجمعية الأول");
  
  const title = ($("cycleTitle")?.value || "").trim();
  const monthlyAmount = Number($("monthlyAmount")?.value || 0);
  const months = Number($("months")?.value || 10);
  
  if (!title) return alert("اكتب اسم الدورة (مثال: دورة مارس 2026)");
  if (!monthlyAmount || monthlyAmount <= 0) return alert("القسط الشهري غير صحيح");
  if (!months || months < 2) return alert("عدد شهور الدورة غير صحيح");
  
  const { error } = await sb.from("cycles").insert({
    group_id: groupId,
    title,
    monthly_amount: monthlyAmount,
    months,
    status: "open"
  });
  
  if (error) {
    console.error("createCycle error:", error);
    alert("حصل خطأ في إنشاء الدورة (RLS؟)");
    return;
  }
  
  alert("تم إنشاء الدورة ✅");
  $("cycleTitle").value = "";
  $("monthlyAmount").value = "";
  $("months").value = months;
  
  await loadCyclesForGroup(groupId);
}

// ===================== Load cycles for selected group =====================
async function loadCyclesForGroup(groupId) {
  const box = $("cyclesList");
  if (!box) return;
  
  box.innerHTML = `<div class="card"><b>جاري تحميل الدورات...</b></div>`;
  
  const { data, error } = await sb
    .from("cycles")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });
  
  if (error) {
    console.error("loadCyclesForGroup error:", error);
    box.innerHTML = `<div class="card"><b>مشكلة في تحميل الدورات</b></div>`;
    return;
  }
  
  if (!data || data.length === 0) {
    box.innerHTML = `<div class="card"><b>مفيش دورات للجمعية دي</b></div>`;
    return;
  }
  
  box.innerHTML = data.map(c => `
    <div class="card">
      <b>${escapeHtml(c.title)}</b>
      <div style="opacity:.85;margin-top:6px">
        القسط: <b>${Number(c.monthly_amount)} Pi</b> — المدة: <b>${Number(c.months)}</b> شهور
      </div>
      <div style="opacity:.7;margin-top:6px">الحالة: <b>${escapeHtml(c.status)}</b></div>
    </div>
  `).join("");
}

// ===================== Events =====================
window.addEventListener("load", async () => {
  await loadAdminGroups();
  
  // onchange للـ select
  const sel = $("groupSelect");
  if (sel) {
    sel.addEventListener("change", async () => {
      const gid = Number(sel.value);
      if (!gid) {
        const box = $("cyclesList");
        if (box) box.innerHTML = "";
        return;
      }
      await loadCyclesForGroup(gid);
    });
  }
  
  // buttons
  $("btnCreateGroup")?.addEventListener("click", createGroup);
  $("btnCreateCycle")?.addEventListener("click", createCycle);
});
