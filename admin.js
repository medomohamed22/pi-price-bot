// ===================== Supabase Config =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function $(id) { return document.getElementById(id); }

// ===================== Helper Functions =====================
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  if (type === 'error') toast.style.background = 'var(--danger)';
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleCreateSection() {
  const section = $('createSection');
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
  if (section.style.display === 'block') {
    section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ===================== 1. تحميل المجموعات =====================
async function loadAdminGroups() {
  const selects = ["groupSelect", "groupSelectCreate"];
  
  try {
    const { data: groups, error } = await sb
      .from("groups")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    
    const html = `<option value="">-- اختر الجمعية --</option>` + 
                 (groups || []).map(g => `<option value="${g.id}">${g.name} (${g.members_count || 10} عضو)</option>`).join("");

    selects.forEach(id => { 
      if($(id)) {
        const currentValue = $(id).value;
        $(id).innerHTML = html;
        $(id).value = currentValue;
      }
    });
    
    showToast('تم تحديث البيانات بنجاح');
  } catch (err) {
    showToast('خطأ في تحميل الجمعيات: ' + err.message, 'error');
  }
}

// ===================== 2. إنشاء جمعية جديدة =====================
async function createGroup() {
  const name = $("groupName").value.trim();
  const membersCount = parseInt($("membersCount").value) || 10;
  const description = $("groupDesc").value.trim();
  
  if(!name) {
    showToast('يرجى إدخال اسم الجمعية', 'error');
    return;
  }

  try {
    const { error } = await sb
      .from("groups")
      .insert({ 
        name: name, 
        description: description,
        members_count: membersCount 
      });
    
    if (error) throw error;
    
    showToast('تم إنشاء الجمعية بنجاح');
    $("groupName").value = "";
    $("groupDesc").value = "";
    $("membersCount").value = "10";
    loadAdminGroups();
  } catch (err) {
    showToast('خطأ: ' + err.message, 'error');
  }
}

// ===================== 3. إنشاء دورة جديدة =====================
async function createCycle() {
  const groupId = $("groupSelectCreate").value;
  const title = $("cycleTitle").value.trim();
  const amount = parseFloat($("monthlyAmount").value);
  const months = parseInt($("months").value);

  if(!groupId || !title || !amount || !months) {
    showToast('اكمل جميع البيانات المطلوبة', 'error');
    return;
  }

  try {
    const { error } = await sb
      .from("cycles")
      .insert({
        group_id: groupId,
        title: title,
        monthly_amount: amount,
        months: months,
        status: 'open'
      });

    if (error) throw error;
    
    showToast('تم إنشاء الدورة بنجاح');
    $("cycleTitle").value = "";
    $("monthlyAmount").value = "";
    $("months").value = "10";
    $("groupSelectCreate").value = "";
    
    // Refresh cycles if a group is selected
    if ($("groupSelect").value === groupId) {
      loadCyclesForGroup();
    }
  } catch (err) {
    showToast('خطأ: ' + err.message, 'error');
  }
}

// ===================== 4. عرض وحذف الدورات =====================
async function loadCyclesForGroup() {
  const groupId = $("groupSelect").value;
  const list = $("cyclesList");
  
  if(!groupId) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = "<div class='loading'>جارٍ تحميل الدورات...</div>";
  
  try {
    const { data: cycles, error } = await sb
      .from("cycles")
      .select("*")
      .eq("group_id", groupId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if(!cycles || cycles.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div>لا توجد دورات في هذه الجمعية</div>
        </div>`;
      return;
    }

    list.innerHTML = cycles.map(c => `
      <div class="cycle-card">
        <div class="cycle-info">
          <b>${c.title}</b>
          <div style="margin: 8px 0;">
            <span class="badge ${c.status === 'open' ? 'paid' : 'banned'}">
              ${c.status === 'open' ? '🟢 نشطة' : '🔴 مغلقة'}
            </span>
          </div>
          <small>💰 ${c.monthly_amount} Pi / شهر | 📅 ${c.months} شهر | 🎯 الإجمالي: ${c.monthly_amount * c.months} Pi</small>
        </div>
        <div class="actions-row">
          <button class="btn soft sm" onclick="loadMembersForCycle(${c.id}, '${c.title}', ${c.months}, ${c.monthly_amount})">
            👥 الأعضاء والمدفوعات
          </button>
          <button class="btn danger sm" onclick="deleteCycle(${c.id})">
            🗑️ حذف
          </button>
        </div>
      </div>
    `).join("");
  } catch (err) {
    list.innerHTML = `<div class="empty-state">خطأ في التحميل: ${err.message}</div>`;
  }
}

async function deleteCycle(id) {
  if(!confirm("⚠️ هل أنت متأكد من حذف هذه الدورة؟\nسيتم حذف جميع المسجلين والبيانات المرتبطة بها!")) return;
  
  try {
    const { error } = await sb.from("cycles").delete().eq("id", id);
    if (error) throw error;
    
    showToast('تم حذف الدورة بنجاح');
    loadCyclesForGroup();
    $("membersSection").style.display = "none";
  } catch (err) {
    showToast('خطأ في الحذف: ' + err.message, 'error');
  }
}

// ===================== 5. إدارة الأعضاء (Logic Core) =====================
let currentCycleId = null;
let currentCycleData = null;

async function loadMembersForCycle(cycleId, title, totalMonths, amount) {
  currentCycleId = cycleId;
  currentCycleData = { title, totalMonths, amount };
  
  const section = $("membersSection");
  const list = $("membersList");
  
  section.style.display = "block";
  $("membersSectionTitle").textContent = `إدارة: ${title}`;
  $("cycleInfoBadge").textContent = `💰 الإجمالي: ${amount * totalMonths} Pi`;
  
  list.innerHTML = "<div class='loading'>جارٍ تحليل بيانات الأعضاء...</div>";
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    // 1. جلب الأعضاء - متوافق مع جدول profiles (pi_uid كـ primary key)
    const { data: members, error: membersError } = await sb
      .from("members")
      .select("id, pi_uid, username, position, created_at")
      .eq("cycle_id", cycleId)
      .order("position", { ascending: true });

    if (membersError) throw membersError;

    if(!members || members.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">👤</div>
          <div>لا يوجد أعضاء مسجلين بعد في هذه الدورة</div>
        </div>`;
      return;
    }

    const userIds = members.map(m => m.pi_uid);

    // 2. جلب المحافظ والحظر والمدفوعات - متوافق مع الجداول المعروضة
    const [walletsRes, profilesRes, paymentsRes] = await Promise.all([
      // جلب المحافظ من جدول user_wallets (pi_uid, wallet_address, updated_at)
      sb.from("user_wallets").select("pi_uid, wallet_address").in("pi_uid", userIds),
      
      // جلب حالة الحظر من جدول profiles (pi_uid, username, is_banned, created_at)
      sb.from("profiles").select("pi_uid, is_banned").in("pi_uid", userIds),
      
      // جلب المدفوعات المؤكدة
      sb.from("payments").select("member_id, status").in("member_id", members.map(m => m.id)).eq("status", "confirmed")
    ]);

    const walletMap = Object.fromEntries(walletsRes.data?.map(w => [w.pi_uid, w.wallet_address]) || []);
    const banMap = Object.fromEntries(profilesRes.data?.map(p => [p.pi_uid, p.is_banned]) || {});
    
    // حساب المدفوعات لكل عضو
    const paymentCounts = {};
    paymentsRes.data?.forEach(p => {
      paymentCounts[p.member_id] = (paymentCounts[p.member_id] || 0) + 1;
    });

    list.innerHTML = members.map(m => {
      const wallet = walletMap[m.pi_uid] || null;
      const isBanned = banMap[m.pi_uid] || false;
      const paidCount = paymentCounts[m.id] || 0;
      const progress = Math.min((paidCount / totalMonths) * 100, 100);
      const remaining = (totalMonths - paidCount) * amount;
      const isComplete = paidCount >= totalMonths;

      return `
      <div class="member-card ${isBanned ? 'banned' : ''}">
        <div class="member-header">
          <div class="user-info">
            <b>${m.position}. @${m.username}</b>
            <span>🆔 ${m.pi_uid.substring(0,16)}...</span>
            ${isBanned ? '<span style="color: var(--danger); font-weight: bold;">🚷 محظور</span>' : ''}
          </div>
          <div class="badge ${isComplete ? 'paid' : 'pending'}">
            ${isComplete ? '✅ مكتمل' : '⏳ سارٍ'}
          </div>
        </div>
        
        <div class="wallet-box" onclick="${wallet ? `copyText('${wallet}')` : ''}" 
             style="${wallet ? 'cursor: pointer;' : 'opacity: 0.6;'}">
          <span>📋 ${wallet ? wallet.substring(0,35) + '...' : 'لم يربط المحفظة بعد'}</span>
          ${wallet ? '<span class="copy-btn">نسخ</span>' : ''}
        </div>
        
        <div class="progress-wrap">
          <div class="progress-meta">
            <span>💳 تم سداد: <b>${paidCount}/${totalMonths}</b> شهر</span>
            <span>📊 باقي: <b>${remaining} Pi</b></span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${progress}%; ${isComplete ? 'background: linear-gradient(90deg, #10b981, #34d399);' : ''}"></div>
          </div>
          <div style="text-align: center; font-size: 11px; color: #999; margin-top: 3px;">
            ${progress.toFixed(0)}% مكتمل
          </div>
        </div>
        
        <div class="actions-row">
          <button class="btn ${isBanned ? 'success' : 'danger'} sm full-width" 
                  onclick="toggleBan('${m.pi_uid}', ${!isBanned}, '${m.username}')">
            ${isBanned ? '✅ فك الحظر' : '🚫 حظر المستخدم'}
          </button>
        </div>
      </div>
      `;
    }).join("");
    
  } catch (err) {
    list.innerHTML = `<div class="empty-state">خطأ: ${err.message}</div>`;
  }
}

// ===================== 6. أدوات مساعدة =====================
async function copyText(text) {
  if(!text || text.includes("لم يربط")) return;
  
  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ تم نسخ عنوان المحفظة');
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);
    showToast('✅ تم نسخ عنوان المحفظة');
  }
}

async function toggleBan(pi_uid, shouldBan, username) {
  const action = shouldBan ? 'حظر' : 'فك الحظر';
  
  if(!confirm(`هل تريد ${action} المستخدم @${username}؟`)) return;
  
  try {
    // استخدام upsert مع pi_uid كـ primary key (متوافق مع جدول profiles)
    const { error } = await sb
      .from("profiles")
      .upsert({ 
        pi_uid: pi_uid, 
        is_banned: shouldBan
      }, { 
        onConflict: 'pi_uid' 
      });
    
    if (error) throw error;
    
    showToast(`تم ${action} المستخدم بنجاح`);
    
    // Refresh members list if we have active cycle
    if(currentCycleId && currentCycleData) {
      loadMembersForCycle(
        currentCycleId, 
        currentCycleData.title, 
        currentCycleData.totalMonths, 
        currentCycleData.amount
      );
    }
  } catch (err) {
    showToast('فشل: ' + err.message, 'error');
  }
}

// ===================== Initialize =====================
window.addEventListener("load", () => {
  loadAdminGroups();
});
