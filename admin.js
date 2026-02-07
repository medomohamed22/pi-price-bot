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
// ===================== Notification System =====================

// تبديل حقول اختيار المستلم
function toggleRecipientSelect() {
    const type = document.querySelector('input[name="recipientType"]:checked').value;
    
    $('cycleSelectField').style.display = type === 'cycle' ? 'block' : 'none';
    $('userSelectField').style.display = type === 'user' ? 'block' : 'none';
    
    // تحميل البيانات حسب النوع
    if (type === 'cycle') {
        loadCyclesForNotification();
    } else if (type === 'user') {
        loadUsersForNotification();
    }
}

// تحميل الدورات لقائمة الإشعارات
async function loadCyclesForNotification() {
    const select = $('notifyCycleSelect');
    select.innerHTML = '<option value="">جارٍ التحميل...</option>';
    
    try {
        const { data: cycles, error } = await sb
            .from('cycles')
            .select('id, title, groups(name), status')
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">-- اختر دورة --</option>' +
            (cycles || []).map(c => `
                <option value="${c.id}">
                    ${c.groups?.name || 'جمعية'} - ${c.title} (${c.status === 'open' ? 'نشطة' : 'مغلقة'})
                </option>
            `).join('');
            
    } catch (err) {
        select.innerHTML = '<option value="">خطأ في التحميل</option>';
    }
}

// تحميل المستخدمين لقائمة الإشعارات
async function loadUsersForNotification() {
    const select = $('notifyUserSelect');
    select.innerHTML = '<option value="">جارٍ التحميل...</option>';
    
    try {
        // جلب المستخدمين من جدول profiles
        const { data: profiles, error } = await sb
            .from('profiles')
            .select('pi_uid, username, created_at')
            .order('created_at', { ascending: false })
            .limit(100);
        
        if (error) throw error;
        
        select.innerHTML = '<option value="">-- اختر مستخدم --</option>' +
            (profiles || []).map(p => `
                <option value="${p.pi_uid}">
                    @${p.username || 'مستخدم'} - ${p.pi_uid.substring(0, 16)}...
                </option>
            `).join('');
            
    } catch (err) {
        select.innerHTML = '<option value="">خطأ في التحميل</option>';
    }
}

// تحميل أعضاء دورة محددة للإشعار
async function loadCycleMembersForNotify() {
    const cycleId = $('notifyCycleSelect').value;
    if (!cycleId) return;
    
    // يمكن استخدامها لعرض عدد المستلمين المتوقع
    try {
        const { count, error } = await sb
            .from('members')
            .select('*', { count: 'exact', head: true })
            .eq('cycle_id', cycleId);
        
        if (error) throw error;
        
        showToast(`📊 سيتم إرسال الإشعار لـ ${count} عضو في هذه الدورة`);
        
    } catch (err) {
        console.error('Error counting members:', err);
    }
}

// معاينة الإشعار
function previewNotification() {
    const title = $('notifyTitle').value.trim();
    const message = $('notifyMessage').value.trim();
    const type = $('notifyType').value;
    const recipientType = document.querySelector('input[name="recipientType"]:checked').value;
    
    if (!title || !message) {
        showToast('يرجى إدخال العنوان والمحتوى', 'error');
        return;
    }
    
    const typeLabels = {
        'system': '🔧 نظام',
        'payment_due': '💰 دفع',
        'payout_ready': '🎉 استلام',
        'cycle_complete': '🏆 إنجاز',
        'warning': '⚠️ تحذير'
    };
    
    const recipientLabels = {
        'all': 'جميع المستخدمين',
        'cycle': 'أعضاء دورة محددة',
        'user': 'مستخدم محدد'
    };
    
    const previewBox = $('previewBox');
    previewBox.innerHTML = `
        <div class="preview-header">
            <span class="preview-type type-${type}">${typeLabels[type]}</span>
            <span style="color: #999; font-size: 12px;">${recipientLabels[recipientType]}</span>
        </div>
        <div class="preview-title">${escapeHtml(title)}</div>
        <div class="preview-message">${escapeHtml(message)}</div>
        <div class="preview-meta">
            <span>🕐 ${new Date().toLocaleString('ar-EG')}</span>
            <span>•</span>
            <span>من: المايسترو Admin</span>
        </div>
    `;
    
    $('notifyPreview').style.display = 'block';
}

// إرسال الإشعار الرئيسي
async function sendNotification() {
    const title = $('notifyTitle').value.trim();
    const message = $('notifyMessage').value.trim();
    const type = $('notifyType').value;
    const recipientType = document.querySelector('input[name="recipientType"]:checked').value;
    
    // التحقق من البيانات
    if (!title || !message) {
        showToast('يرجى إدخال العنوان والمحتوى', 'error');
        return;
    }
    
    // تحديد المستلمين
    let targetUsers = [];
    let recipientInfo = '';
    
    try {
        // جلب قائمة المستلمين
        if (recipientType === 'all') {
            const { data: profiles, error } = await sb
                .from('profiles')
                .select('pi_uid');
            
            if (error) throw error;
            targetUsers = profiles.map(p => p.pi_uid);
            recipientInfo = 'جميع المستخدمين';
            
        } else if (recipientType === 'cycle') {
            const cycleId = $('notifyCycleSelect').value;
            if (!cycleId) {
                showToast('يرجى اختيار دورة', 'error');
                return;
            }
            
            const { data: members, error } = await sb
                .from('members')
                .select('pi_uid')
                .eq('cycle_id', cycleId);
            
            if (error) throw error;
            targetUsers = members.map(m => m.pi_uid);
            recipientInfo = `أعضاء الدورة #${cycleId}`;
            
        } else if (recipientType === 'user') {
            const userId = $('notifyUserSelect').value;
            if (!userId) {
                showToast('يرجى اختيار مستخدم', 'error');
                return;
            }
            targetUsers = [userId];
            recipientInfo = `مستخدم محدد`;
        }
        
        if (targetUsers.length === 0) {
            showToast('لا يوجد مستلمون للإشعار', 'error');
            return;
        }
        
        // تأكيد الإرسال
        if (!confirm(`سيتم إرسال الإشعار لـ ${targetUsers.length} مستخدم\n\nهل تريد المتابعة؟`)) {
            return;
        }
        
        // تعطيل الزر أثناء الإرسال
        const sendBtn = document.querySelector('button[onclick="sendNotification()"]');
        sendBtn.classList.add('sending');
        sendBtn.disabled = true;
        
        // إنشاء الإشعارات
        const notifications = targetUsers.map(uid => ({
            pi_uid: uid,
            title: title,
            message: message,
            type: type,
            read: false,
            metadata: {
                sent_by: 'admin',
                sent_at: new Date().toISOString(),
                recipient_count: targetUsers.length
            }
        }));
        
        // إرسال دفعات (batches) لتجنب الحد الأقصى
        const batchSize = 100;
        let successCount = 0;
        let failCount = 0;
        
        for (let i = 0; i < notifications.length; i += batchSize) {
            const batch = notifications.slice(i, i + batchSize);
            const { error } = await sb.from('notifications').insert(batch);
            
            if (error) {
                console.error('Batch error:', error);
                failCount += batch.length;
            } else {
                successCount += batch.length;
            }
        }
        
        // تسجيل في سجل الإشعارات المرسلة (جدول منفصل للأدمن)
        await logAdminNotification({
            title,
            message,
            type,
            recipient_type: recipientType,
            recipient_count: targetUsers.length,
            success_count: successCount,
            fail_count: failCount,
            sent_by: 'admin',
            sent_at: new Date().toISOString()
        });
        
        // إعادة تفعيل الزر
        sendBtn.classList.remove('sending');
        sendBtn.disabled = false;
        
        // النتيجة
        if (failCount === 0) {
            showToast(`✅ تم إرسال الإشعار بنجاح لـ ${successCount} مستخدم`);
        } else {
            showToast(`⚠️ تم الإرسال: ${successCount} نجاح، ${failCount} فشل`, 'error');
        }
        
        // تحديث السجل ومسح النموذج
        loadNotificationHistory();
        clearNotificationForm();
        
    } catch (err) {
        showToast('خطأ في الإرسال: ' + err.message, 'error');
        const sendBtn = document.querySelector('button[onclick="sendNotification()"]');
        if (sendBtn) {
            sendBtn.classList.remove('sending');
            sendBtn.disabled = false;
        }
    }
}

// تسجيل إشعار الأدمن (يمكن إنشاء جدول منفصل أو استخدام localStorage مؤقتاً)
async function logAdminNotification(logData) {
    try {
        // محاولة حفظ في قاعدة البيانات (جدول admin_notifications)
        const { error } = await sb
            .from('admin_notifications_log')
            .insert(logData);
        
        if (error) {
            // إذا الجدول غير موجود، نستخدم localStorage كاحتياطي
            const logs = JSON.parse(localStorage.getItem('admin_notification_logs') || '[]');
            logs.unshift(logData);
            localStorage.setItem('admin_notification_logs', JSON.stringify(logs.slice(0, 50)));
        }
    } catch (e) {
        console.error('Logging error:', e);
    }
}

// تحميل سجل الإشعارات المرسلة
async function loadNotificationHistory() {
    const container = $('notificationHistoryList');
    container.innerHTML = '<div class="loading">جارٍ التحميل...</div>';
    
    try {
        // محاولة جلب من قاعدة البيانات أولاً
        const { data: logs, error } = await sb
            .from('admin_notifications_log')
            .select('*')
            .order('sent_at', { ascending: false })
            .limit(20);
        
        let historyData = logs;
        
        // إذا فشل، نستخدم localStorage
        if (error || !logs || logs.length === 0) {
            historyData = JSON.parse(localStorage.getItem('admin_notification_logs') || '[]');
        }
        
        if (!historyData || historyData.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📭</div>
                    <div>لا توجد إشعارات مرسلة بعد</div>
                </div>`;
            return;
        }
        
        const typeLabels = {
            'system': '🔧 نظام',
            'payment_due': '💰 دفع',
            'payout_ready': '🎉 استلام',
            'cycle_complete': '🏆 إنجاز',
            'warning': '⚠️ تحذير'
        };
        
        container.innerHTML = historyData.map((log, index) => {
            const isSuccess = log.fail_count === 0;
            const date = new Date(log.sent_at).toLocaleString('ar-EG');
            
            return `
                <div class="history-item ${isSuccess ? 'success-sent' : 'failed-sent'}">
                    <div class="history-info">
                        <div class="history-title">
                            ${typeLabels[log.type] || '🔔 إشعار'}
                            ${log.title}
                        </div>
                        <div class="history-recipients">
                            👥 ${log.recipient_type === 'all' ? 'جميع المستخدمين' : 
                                 log.recipient_type === 'cycle' ? 'أعضاء دورة' : 'مستخدم محدد'}
                            (${log.recipient_count} مستلم)
                        </div>
                        <div class="history-message">${log.message.substring(0, 100)}${log.message.length > 100 ? '...' : ''}</div>
                        <div class="history-stats">
                            <span class="stat-badge success">✅ ${log.success_count || log.recipient_count}</span>
                            ${log.fail_count > 0 ? `<span class="stat-badge failed">❌ ${log.fail_count}</span>` : ''}
                        </div>
                    </div>
                    <div class="history-meta">
                        <div>${date}</div>
                        <div style="margin-top: 5px;">#${historyData.length - index}</div>
                    </div>
                </div>
            `;
        }).join('');
        
    } catch (err) {
        container.innerHTML = `<div class="empty-state">خطأ في التحميل: ${err.message}</div>`;
    }
}

// مسح نموذج الإشعار
function clearNotificationForm() {
    $('notifyTitle').value = '';
    $('notifyMessage').value = '';
    $('notifyType').value = 'system';
    $('notifyPreview').style.display = 'none';
    
    // إعادة تعيين المستلمين
    document.querySelector('input[name="recipientType"][value="all"]').checked = true;
    toggleRecipientSelect();
}

// دالة مساعدة لتجنب XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
// ===================== Initialize =====================
window.addEventListener("load", () => {
  loadAdminGroups();
});
