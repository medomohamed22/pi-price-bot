// ===================== Supabase Config =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ===================== Helpers =====================
function $(id) { return document.getElementById(id); }
function escapeHtml(str) { return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

// ===================== 1. تحميل الجمعيات في القائمة =====================
async function loadAdminGroups(selectedId = null) {
  const sel = $("groupSelect");
  sel.innerHTML = `<option value="">جارٍ التحميل...</option>`;
  
  const { data, error } = await sb
    .from("groups")
    .select("*")
    .order("created_at", { ascending: false });
  
  if (error) {
    console.error(error);
    sel.innerHTML = `<option value="">خطأ في التحميل (تأكد من RLS)</option>`;
    return;
  }
  
  if (!data || data.length === 0) {
    sel.innerHTML = `<option value="">لا توجد جمعيات بعد</option>`;
    return;
  }
  
  sel.innerHTML = `<option value="">-- اختر الجمعية --</option>` + data.map(g => `
    <option value="${g.id}" ${selectedId == g.id ? "selected" : ""}>
      ${escapeHtml(g.name)} (أعضاء: ${g.members_count || 10})
    </option>
  `).join("");
  
  if (selectedId) loadCyclesForGroup(); // تحميل الدورات إذا كان هناك تحديد مسبق
}

// ===================== 2. إنشاء جمعية =====================
async function createGroup() {
  const btn = $("btnCreateGroup");
  const name = $("groupName").value.trim();
  const desc = $("groupDesc").value.trim();
  const count = Number($("membersCount").value);
  
  if (!name) return alert("الرجاء كتابة اسم الجمعية");
  if (count < 2) return alert("العدد قليل جداً");

  btn.textContent = "جارٍ الإنشاء...";
  btn.disabled = true;

  const { data, error } = await sb
    .from("groups")
    .insert({ 
      name: name, 
      description: desc,
      members_count: count 
    })
    .select()
    .single();

  btn.textContent = "إنشاء الجمعية";
  btn.disabled = false;

  if (error) {
    console.error(error);
    alert("فشل الإنشاء: " + error.message);
  } else {
    alert("تم إنشاء الجمعية بنجاح ✅");
    $("groupName").value = "";
    $("groupDesc").value = "";
    // إعادة تحميل القائمة وتحديد الجمعية الجديدة
    loadAdminGroups(data.id);
  }
}

// ===================== 3. إنشاء دورة =====================
async function createCycle() {
  const btn = $("btnCreateCycle");
  const groupId = $("groupSelect").value;
  const title = $("cycleTitle").value.trim();
  const amount = Number($("monthlyAmount").value);
  const months = Number($("months").value);
  
  if (!groupId) return alert("اختر الجمعية أولاً");
  if (!title || !amount) return alert("أكمل بيانات الدورة");

  btn.textContent = "جارٍ الطرح...";
  btn.disabled = true;

  const { error } = await sb.from("cycles").insert({
    group_id: groupId,
    title: title,
    monthly_amount: amount,
    months: months,
    status: "open" // الحالة الافتراضية
  });

  btn.textContent = "طرح الدورة للتسجيل";
  btn.disabled = false;

  if (error) {
    alert("خطأ: " + error.message);
  } else {
    alert("تم طرح الدورة بنجاح، يمكن للمستخدمين الاشتراك الآن ✅");
    $("cycleTitle").value = "";
    loadCyclesForGroup(); // تحديث القائمة
  }
}

// ===================== 4. عرض وإدارة الدورات =====================
async function loadCyclesForGroup() {
  const groupId = $("groupSelect").value;
  const list = $("cyclesList");
  
  if (!groupId) {
    list.innerHTML = `<div class="empty">اختر جمعية من القائمة أعلاه لعرض دوراتها</div>`;
    return;
  }
  
  list.innerHTML = `<div class="empty">جارٍ التحميل...</div>`;
  
  // جلب الدورات مع عدد المشتركين الحاليين (بشكل بسيط)
  // ملاحظة: لجلب العدد بدقة نحتاج Join مع members، هنا سنجلب الدورات فقط للسرعة
  const { data, error } = await sb
    .from("cycles")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<div class="empty" style="color:red">خطأ: ${error.message}</div>`;
    return;
  }

  if (data.length === 0) {
    list.innerHTML = `<div class="empty">لا توجد دورات في هذه الجمعية</div>`;
    return;
  }

  list.innerHTML = data.map(c => {
    // تحديد لون الحالة
    let statusColor = c.status === 'open' ? 'green' : (c.status === 'active' ? 'blue' : 'gray');
    let statusText = c.status === 'open' ? 'مفتوحة للتسجيل' : (c.status === 'active' ? 'جارية (نشطة)' : 'مكتملة');

    return `
      <div class="cycle-card">
        <div class="cycle-info">
          <b>${escapeHtml(c.title)}</b>
          <span>القسط: ${c.monthly_amount} Pi | المدة: ${c.months} شهور</span>
          <div style="margin-top:4px; font-size:12px; color:${statusColor}">
            الحالة: <b>${statusText}</b>
          </div>
        </div>
        <div class="cycle-actions">
          ${c.status === 'open' ? 
            `<button class="btn soft sm" onclick="updateStatus(${c.id}, 'active')">بدء الدورة</button>` : 
            (c.status === 'active' ? 
              `<button class="btn danger sm" onclick="updateStatus(${c.id}, 'completed')">إنهاء</button>` : 
              `<span class="status">مغلقة</span>`
            )
          }
        </div>
      </div>
    `;
  }).join("");
}

// ===================== 5. تحديث حالة الدورة =====================
async function updateStatus(cycleId, newStatus) {
  if (!confirm(`هل أنت متأكد من تغيير الحالة إلى "${newStatus}"؟`)) return;

  const { error } = await sb
    .from("cycles")
    .update({ status: newStatus })
    .eq("id", cycleId);

  if (error) alert("خطأ: " + error.message);
  else loadCyclesForGroup();
}

// ===================== التشغيل عند البدء =====================
window.addEventListener("load", () => {
  loadAdminGroups();
  
  $("btnCreateGroup").addEventListener("click", createGroup);
  $("btnCreateCycle").addEventListener("click", createCycle);
  $("groupSelect").addEventListener("change", loadCyclesForGroup);
});
