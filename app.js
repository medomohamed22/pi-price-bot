// ==========================================
// جمعيتي - نظام الجمعيات الذكي
// ==========================================

// التهيئة
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";

let sb = null;
let user = null;
let currentTheme = localStorage.getItem('theme') || 'light';

// الأيقونات
const icons = {
  success: '✅',
  error: '❌',
  info: 'ℹ️',
  warning: '⚠️'
};

// ==========================================
// التهيئة الأولية
// ==========================================

document.addEventListener('DOMContentLoaded', function() {
  try {
    // تهيئة Supabase
    if (typeof supabase !== 'undefined') {
      sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    } else {
      console.error('Supabase library not loaded');
    }

    // تهيئة الثيم
    initTheme();

    // تحميل الجمعيات
    loadGroups();

    // تأثيرات الأرقام
    setTimeout(animateNumbers, 500);

    // تهيئة الأنيميشن
    initAnimations();

    // إغلاق المودالات عند النقر خارجها
    setupModalClose();

  } catch (error) {
    console.error('Initialization error:', error);
  }
});

// ==========================================
// نظام الثيم (الوضع الليلي/النهاري)
// ==========================================

function initTheme() {
  document.documentElement.setAttribute('data-theme', currentTheme);
  updateThemeIcons();
}

function toggleTheme() {
  currentTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', currentTheme);
  localStorage.setItem('theme', currentTheme);
  updateThemeIcons();
  toast(currentTheme === 'dark' ? 'الوضع الليلي' : 'الوضع النهاري', 'تم تغيير المظهر بنجاح', 'info');
}

function updateThemeIcons() {
  const iconClass = currentTheme === 'dark' ? 'fa-sun' : 'fa-moon';
  const themeIcon = document.getElementById('themeIcon');
  const floatingThemeIcon = document.getElementById('floatingThemeIcon');

  if (themeIcon) themeIcon.className = 'fas ' + iconClass;
  if (floatingThemeIcon) floatingThemeIcon.className = 'fas ' + iconClass;
}

// ==========================================
// نظام التنبيهات (Toast)
// ==========================================

function toast(title, msg, type, duration) {
  duration = duration || 4000;
  type = type || 'info';

  const container = document.getElementById('toasts');
  if (!container) return;

  const el = document.createElement('div');
  el.className = 'toast ' + type;

  const iconMap = {
    success: '<i class="fas fa-check-circle"></i>',
    error: '<i class="fas fa-times-circle"></i>',
    info: '<i class="fas fa-info-circle"></i>',
    warning: '<i class="fas fa-exclamation-triangle"></i>'
  };

  el.innerHTML =
    '<div class="toast-icon">' + iconMap[type] + '</div>' +
    '<div class="toast-content">' +
      '<div class="toast-title">' + escapeHtml(title) + '</div>' +
      (msg ? '<div class="toast-msg">' + escapeHtml(msg) + '</div>' : '') +
    '</div>';

  container.appendChild(el);

  // إزالة بعد المدة المحددة
  setTimeout(function() {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-20px)';
    setTimeout(function() {
      if (el.parentNode) el.remove();
    }, 300);
  }, duration);
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(date) {
  if (!date) return '---';
  try {
    return new Date(date).toLocaleDateString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return '---';
  }
}

// ==========================================
// نظام الإشعارات
// ==========================================

function toggleNotifications() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;

  const isActive = panel.classList.toggle('active');
  const badge = document.getElementById('notifBadge');

  if (isActive && badge) {
    badge.style.display = 'none';
  }
}

function addNotification(title, msg, type) {
  type = type || 'info';
  const list = document.getElementById('notifList');
  const badge = document.getElementById('notifBadge');

  if (!list) return;

  // إزالة حالة الفارغ
  const emptyState = list.querySelector('.empty-state');
  if (emptyState) emptyState.remove();

  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = '<strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(msg) + '</p>';

  list.prepend(item);

  if (badge) badge.style.display = 'block';
}

function markAllRead() {
  const items = document.querySelectorAll('.notif-item');
  items.forEach(function(item) {
    item.classList.add('read');
  });

  const badge = document.getElementById('notifBadge');
  if (badge) badge.style.display = 'none';
}

// ==========================================
// تسجيل الدخول
// ==========================================

async function login() {
  try {
    if (!window.Pi) {
      toast('خطأ', 'افتح بـ Pi Browser', 'error');
      return;
    }

    const btn = document.getElementById('btnLogin');
    if (!btn) return;

    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الدخول...';
    btn.disabled = true;

    Pi.init({ version: '2.0', sandbox: false });
    const auth = await Pi.authenticate(['username', 'payments'], onIncompletePaymentFound);

    // التحقق من الحظر
    const { data: profile } = await sb
      .from('profiles')
      .select('is_banned, trust_score')
      .eq('pi_uid', auth.user.uid)
      .single();

    if (profile && profile.is_banned) {
      document.body.innerHTML =
        '<div class="banned-screen">' +
          '<i class="fas fa-ban"></i>' +
          '<h1>حساب محظور</h1>' +
          '<p>تم حظر حسابك من استخدام المنصة</p>' +
        '</div>';
      return;
    }

    // تحديث الملف الشخصي
    await sb.from('profiles').upsert({
      pi_uid: auth.user.uid,
      username: auth.user.username,
      last_login: new Date().toISOString()
    });

    user = auth.user;
    user.trustScore = profile && profile.trust_score ? profile.trust_score : 100;

    updateUI();
    toast('أهلاً بك! 👋', '@' + user.username + '، سعداء بعودتك', 'success');
    addNotification('مرحباً بك', 'تم تسجيل دخولك بنجاح إلى جمعيتي', 'success');

    // تحميل بيانات لوحة التحكم
    loadMyCycles();

  } catch (error) {
    console.error('Login error:', error);
    toast('فشل الدخول', 'حاول مرة أخرى أو تواصل مع الدعم', 'error');

    const btn = document.getElementById('btnLogin');
    if (btn) {
      btn.innerHTML = 'دخول';
      btn.disabled = false;
    }
  }
}

function updateUI() {
  const chipWrapper = document.getElementById('userChipWrapper');
  const chip = document.getElementById('userChip');
  const btn = document.getElementById('btnLogin');

  if (user) {
    if (chipWrapper) chipWrapper.style.display = 'flex';
    if (chip) chip.innerHTML = '<i class="fas fa-user"></i> ' + user.username;
    if (btn) btn.style.display = 'none';

    const dashboardUsername = document.getElementById('dashboardUsername');
    if (dashboardUsername) dashboardUsername.textContent = user.username;

    updateTrustScore(user.trustScore || 100);
  }
}

function updateTrustScore(score) {
  const stars = document.getElementById('trustStars');
  const text = document.getElementById('trustText');

  if (!stars || !text) return;

  const fullStars = Math.floor(score / 20);
  let starsHtml = '';

  for (let i = 0; i < 5; i++) {
    if (i < fullStars) {
      starsHtml += '<i class="fas fa-star"></i>';
    } else {
      starsHtml += '<i class="far fa-star"></i>';
    }
  }

  stars.innerHTML = starsHtml;
  text.textContent = 'نقطة الثقة: ' + score;
}

function requireLogin() {
  if (!user) {
    toast('تنبيه', 'سجل دخولك أولاً للمتابعة', 'warning');

    const btn = document.getElementById('btnLogin');
    if (btn) {
      btn.classList.add('shake');
      setTimeout(function() {
        btn.classList.remove('shake');
      }, 500);
    }
    return false;
  }
  return true;
}

// ==========================================
// لوحة التحكم
// ==========================================

function openDashboard() {
  if (!requireLogin()) return;

  const modal = document.getElementById('dashboardModal');
  if (modal) {
    modal.classList.add('active');
    loadMyCycles();
    loadUserStats();
  }
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('active');
}

async function loadUserStats() {
  if (!user || !sb) return;

  try {
    const { data: payments } = await sb
      .from('payments')
      .select('amount')
      .eq('pi_uid', user.uid)
      .eq('status', 'confirmed');

    const totalSaved = payments ? payments.reduce(function(sum, p) {
      return sum + (p.amount || 0);
    }, 0) : 0;

    const { data: cycles } = await sb
      .from('members')
      .select('id')
      .eq('pi_uid', user.uid);

    animateValue('totalSaved', 0, totalSaved, 1000);
    animateValue('activeCycles', 0, cycles ? cycles.length : 0, 1000);

  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

async function loadMyCycles() {
  if (!user || !sb) return;

  const list = document.getElementById('myCyclesList');
  if (!list) return;

  list.innerHTML =
    '<div class="loading-state">' +
      '<div class="spinner"></div>' +
      '<p>جاري تحميل بياناتك المالية...</p>' +
    '</div>';

  try {
    const { data: members, error } = await sb
      .from('members')
      .select(`
        id,
        position,
        created_at,
        status,
        cycles (
          id,
          title,
          monthly_amount,
          months,
          created_at,
          status,
          groups (name)
        )
      `)
      .eq('pi_uid', user.uid)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!members || members.length === 0) {
      list.innerHTML =
        '<div class="empty-state">' +
          '<i class="fas fa-folder-open"></i>' +
          '<p>لا توجد اشتراكات حالية</p>' +
          '<button class="btn primary sm" onclick="closeModal(\'dashboardModal\'); window.scrollTo(0,0);">' +
            'استكشف الجمعيات' +
          '</button>' +
        '</div>';
      return;
    }

    list.innerHTML = '';

    for (let i = 0; i < members.length; i++) {
      const m = members[i];
      const c = m.cycles;

      if (!c) continue;

      const { data: payments } = await sb
        .from('payments')
        .select('amount, created_at')
        .eq('member_id', m.id)
        .eq('status', 'confirmed');

      const paidCount = payments ? payments.length : 0;
      const progressPercent = Math.min((paidCount / c.months) * 100, 100);

      // حساب تاريخ القبض
      const payoutDate = new Date(c.created_at);
      payoutDate.setMonth(payoutDate.getMonth() + (m.position - 1));
      const diff = payoutDate - new Date();
      const daysLeft = Math.ceil(diff / (1000 * 60 * 60 * 24));

      let countdownHTML = '';
      if (daysLeft > 0) {
        countdownHTML =
          '<div class="countdown-timer">' +
            '<span class="timer-label">متبقي على دورك في القبض:</span>' +
            '<span class="timer-value">' + daysLeft + ' يوم</span>' +
          '</div>';
      } else if (daysLeft === 0) {
        countdownHTML =
          '<div class="countdown-timer ready">' +
            '<span class="timer-value">🎉 حان موعد استلامك اليوم!</span>' +
          '</div>';
      } else {
        countdownHTML =
          '<div class="countdown-timer ready">' +
            '<span class="timer-value">✅ تم استلام دورك</span>' +
          '</div>';
      }

      const card = document.createElement('div');
      card.className = 'dashboard-card reveal';
      card.innerHTML =
        '<div class="cycle-header">' +
          '<div>' +
            '<h4 class="cycle-title">' + (c.groups ? c.groups.name : 'جمعية') + ' - ' + c.title + '</h4>' +
            '<span class="cycle-group">' + c.months + ' شهر • ' + c.monthly_amount + ' Pi/شهر</span>' +
          '</div>' +
          '<span class="cycle-badge">' + (m.status === 'active' ? 'نشط' : 'معلق') + '</span>' +
        '</div>' +

        '<div class="payment-progress">' +
          '<div class="progress-header">' +
            '<span class="progress-label">التقدم: ' + paidCount + '/' + c.months + '</span>' +
            '<span class="progress-percent">' + Math.round(progressPercent) + '%</span>' +
          '</div>' +
          '<div class="track">' +
            '<div class="fill" style="width: ' + progressPercent + '%"></div>' +
          '</div>' +
        '</div>' +

        countdownHTML +

        '<div class="stats-grid">' +
          '<div class="stat-box">' +
            '<small>دورك</small>' +
            '<strong>#' + m.position + '</strong>' +
          '</div>' +
          '<div class="stat-box highlight">' +
            '<small>تاريخ القبض</small>' +
            '<strong>' + formatDate(payoutDate) + '</strong>' +
          '</div>' +
        '</div>' +

        (m.status === 'active' && paidCount < c.months ?
          '<button class="btn primary sm full-width pay-btn magnetic-btn" ' +
                  'onclick="payInstallment(' + c.id + ', ' + c.monthly_amount + ', ' + m.id + ', ' + (paidCount + 1) + ')">' +
            '<i class="fas fa-credit-card"></i>' +
            '<span>دفع قسط ' + (paidCount + 1) + '</span>' +
          '</button>' : '');

      list.appendChild(card);

      // تأثير الظهور
      setTimeout(function() {
        card.classList.add('active');
      }, i * 100);
    }

  } catch (error) {
    console.error('Error loading cycles:', error);
    list.innerHTML =
      '<div class="empty-state">' +
        '<i class="fas fa-exclamation-circle" style="color: var(--error)"></i>' +
        '<p>خطأ في تحميل البيانات</p>' +
        '<button class="btn soft sm" onclick="loadMyCycles()">إعادة المحاولة</button>' +
      '</div>';
  }
}

// ==========================================
// نظام الدفع
// ==========================================

async function payInstallment(cycleId, amount, memberId, installmentNum) {
  if (!requireLogin()) return;

  if (!confirm('💳 تأكيد الدفع\n\nالمبلغ: ' + amount + ' Pi\nالقسط رقم: ' + installmentNum + '\n\nهل أنت متأكد من الاستمرار؟')) {
    return;
  }

  try {
    const paymentData = {
      amount: amount,
      memo: 'قسط ' + installmentNum,
      metadata: {
        cycleId: cycleId,
        memberId: memberId,
        installment: installmentNum,
        timestamp: new Date().toISOString()
      }
    };

    const callbacks = {
      onReadyForServerApproval: function(paymentId) {
        console.log('Payment ready for approval:', paymentId);
        fetch('/.netlify/functions/approve', {
          method: 'POST',
          body: JSON.stringify({ paymentId: paymentId })
        });
      },

      onReadyForServerCompletion: function(paymentId, txid) {
        console.log('Payment completed:', paymentId, txid);

        sb.from('payments')
          .insert({
            member_id: memberId,
            amount: amount,
            status: 'confirmed',
            installment_number: installmentNum,
            payment_id: paymentId,
            txid: txid,
            paid_at: new Date().toISOString()
          })
          .then(function() {
            toast('تم الدفع بنجاح! 🎉', 'شكراً لالتزامك بدفع قسط ' + installmentNum, 'success', 6000);

            addNotification(
              'دفعة مؤكدة',
              'تم استلام قسط رقم ' + installmentNum + ' بقيمة ' + amount + ' Pi',
              'success'
            );

            fetch('/.netlify/functions/complete', {
              method: 'POST',
              body: JSON.stringify({ paymentId: paymentId, txid: txid })
            });

            setTimeout(function() {
              loadMyCycles();
            }, 1500);
          });
      },

      onCancel: function(paymentId) {
        toast('تم الإلغاء', 'لم يتم إتمام عملية الدفع', 'warning');
      },

      onError: function(error, payment) {
        console.error('Payment error:', error);
        toast('خطأ في الدفع', error.message || 'حاول مرة أخرى', 'error');
      }
    };

    await Pi.createPayment(paymentData, callbacks);

  } catch (error) {
    console.error('Payment creation error:', error);
    toast('خطأ', 'فشل في إنشاء عملية الدفع', 'error');
  }
}

// ==========================================
// عرض الجمعيات
// ==========================================

async function loadGroups() {
  if (!sb) {
    console.error('Supabase not initialized');
    return;
  }

  const grid = document.getElementById('groups');
  const refreshBtn = document.querySelector('.refresh-btn');

  if (!grid) return;

  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    const { data: groups, error } = await sb
      .from('groups')
      .select('*, cycles(*)')
      .order('created_at', { ascending: false });

    if (error) throw error;

    // تأخير بسيط للتحميل السلس
    await new Promise(function(resolve) {
      setTimeout(resolve, 500);
    });

    if (!groups || groups.length === 0) {
      grid.innerHTML =
        '<div class="empty-state" style="grid-column: 1/-1;">' +
          '<i class="fas fa-inbox" style="font-size: 48px;"></i>' +
          '<p>لا توجد جمعيات متاحة حالياً</p>' +
        '</div>';
      return;
    }

    grid.innerHTML = groups.map(function(g, index) {
      const active = g.cycles && g.cycles.find(function(c) {
        return c.status === 'active';
      }) || (g.cycles && g.cycles[0]);

      const totalMembers = active ? active.months : 0;
      const filledSlots = active ? active.members_count || 0 : 0;
      const availableSlots = totalMembers - filledSlots;

      return '' +
        '<div class="card reveal" style="animation-delay: ' + (index * 0.1) + 's">' +
          '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">' +
            '<h3>' + g.name + '</h3>' +
            (availableSlots > 0 ?
              '<span class="badge-live">متاح</span>' :
              '<span class="badge-full">مكتمل</span>') +
          '</div>' +
          '<p>' + (g.description || 'جمعية ادخار جماعي آمنة') + '</p>' +

          '<div class="card-amount">' +
            (active ? active.monthly_amount : 0) +
            ' <span>Pi/شهر</span>' +
          '</div>' +

          '<div style="display: flex; gap: 8px; margin: 16px 0; font-size: 12px; color: var(--text-secondary);">' +
            '<span><i class="fas fa-users"></i> ' + filledSlots + '/' + totalMembers + ' عضو</span>' +
            '<span><i class="fas fa-clock"></i> ' + (active ? active.months : 0) + ' شهر</span>' +
          '</div>' +

          '<button class="btn soft full-width magnetic-btn" onclick="showCycles(' + g.id + ')">' +
            '<span>عرض التفاصيل</span>' +
            '<i class="fas fa-arrow-left"></i>' +
          '</button>' +

          '<div id="group-cycles-' + g.id + '" class="cycle-expand-box" style="display: none;"></div>' +
        '</div>';
    }).join('');

    // تفعيل الأنيميشن
    setTimeout(function() {
      document.querySelectorAll('.reveal').forEach(function(el) {
        el.classList.add('active');
      });
    }, 100);

  } catch (error) {
    console.error('Error loading groups:', error);
    grid.innerHTML =
      '<div class="empty-state" style="grid-column: 1/-1;">' +
        '<i class="fas fa-wifi-slash" style="font-size: 48px; color: var(--error);"></i>' +
        '<p>فشل في تحميل الجمعيات</p>' +
        '<button class="btn primary sm" onclick="loadGroups()">إعادة المحاولة</button>' +
      '</div>';
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

async function showCycles(groupId) {
  const container = document.getElementById('group-cycles-' + groupId);
  if (!container) return;

  const isVisible = container.style.display !== 'none';

  if (isVisible) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = '<div class="spinner" style="width: 30px; height: 30px; margin: 20px auto;"></div>';

  try {
    const { data: cycles } = await sb
      .from('cycles')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'active');

    if (!cycles || cycles.length === 0) {
      container.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">لا توجد دورات نشطة</p>';
      return;
    }

    const cycle = cycles[0];
    container.innerHTML = '' +
      '<div class="cycle-title-sm">' +
        '<i class="fas fa-calendar-alt"></i>' +
        cycle.title +
      '</div>' +
      '<p class="slot-instruction">' +
        '<i class="fas fa-mouse-pointer"></i>' +
        'اختر دورك من الأدوار المتاحة أدناه' +
      '</p>' +
      '<div id="slots-' + cycle.id + '" class="modern-slot-grid">' +
        '<div class="spinner" style="width: 30px; height: 30px; margin: 20px auto;"></div>' +
      '</div>';

    await loadSlots(cycle.id, cycle.months);

  } catch (error) {
    container.innerHTML = '<p style="color: var(--error); text-align: center;">خطأ في التحميل</p>';
  }
}

async function loadSlots(cycleId, totalMonths) {
  const box = document.getElementById('slots-' + cycleId);
  if (!box) return;

  try {
    const { data: members } = await sb
      .from('members')
      .select('position, profiles(username)')
      .eq('cycle_id', cycleId);

    const takenMap = {};
    if (members) {
      members.forEach(function(m) {
        takenMap[m.position] = m.profiles && m.profiles.username ? m.profiles.username : 'مستخدم';
      });
    }

    let html = '';
    for (let i = 1; i <= totalMonths; i++) {
      const isTaken = takenMap[i];
      const delay = i * 0.05;

      html += '' +
        '<div class="slot-item ' + (isTaken ? 'taken' : 'available') + '" ' +
             'style="animation: fadeIn 0.3s ease ' + delay + 's both;" ' +
             'onclick="' + (isTaken ? '' : 'joinCycle(' + cycleId + ', ' + i + ')') + '">' +
          '<div class="slot-num">' + i + '</div>' +
          '<div class="slot-status">' + (isTaken ? 'محجوز' : 'متاح') + '</div>' +
          (isTaken ? '<div class="slot-user">@' + takenMap[i].substring(0, 8) + '</div>' : '') +
        '</div>';
    }

    box.innerHTML = html;

  } catch (error) {
    box.innerHTML = '<p style="color: var(--error);">خطأ</p>';
  }
}

async function joinCycle(cycleId, position) {
  if (!requireLogin()) return;

  if (!confirm('هل تريد الانضمام للدور ' + position + '؟')) return;

  try {
    const { data, error } = await sb
      .from('members')
      .insert({
        cycle_id: cycleId,
        pi_uid: user.uid,
        username: user.username,
        position: position,
        status: 'active',
        joined_at: new Date().toISOString()
      });

    if (error) throw error;

    toast('تم الانضمام!', 'أنت الآن في الدور ' + position, 'success');
    addNotification('انضمام ناجح', 'انضممت لجمعية جديدة في الدور ' + position);

    loadGroups();

  } catch (error) {
    console.error('Join error:', error);
    toast('خطأ', 'لا يمكن الانضمام، ربما تم حجز هذا الدور', 'error');
  }
}

// ==========================================
// حفظ المحفظة
// ==========================================

async function saveWallet() {
  const input = document.getElementById('walletInput');
  if (!input) return;

  const address = input.value.trim();

  if (!address || !address.startsWith('GDT')) {
    toast('خطأ', 'أدخل عنوان محفظة صحيح يبدأ بـ GDT', 'error');
    input.classList.add('shake');
    setTimeout(function() {
      input.classList.remove('shake');
    }, 500);
    return;
  }

  try {
    const { error } = await sb
      .from('profiles')
      .update({
        wallet_address: address,
        updated_at: new Date().toISOString()
      })
      .eq('pi_uid', user.uid);

    if (error) throw error;

    const status = document.getElementById('walletStatus');
    if (status) {
      status.className = 'wallet-status connected';
      status.innerHTML = '<i class="fas fa-check-circle"></i><span>تم ربط المحفظة بنجاح</span>';
    }

    toast('تم الحفظ', 'عنوان محفظتك محفوظ بأمان', 'success');

  } catch (error) {
    console.error('Save wallet error:', error);
    toast('خطأ', 'فشل في حفظ العنوان', 'error');
  }
}

// ==========================================
// البحث
// ==========================================

function filterGroups(query) {
  const cards = document.querySelectorAll('.card');
  const lowerQuery = query.toLowerCase();

  cards.forEach(function(card) {
    const titleEl = card.querySelector('h3');
    const descEl = card.querySelector('p');

    const title = titleEl ? titleEl.textContent.toLowerCase() : '';
    const desc = descEl ? descEl.textContent.toLowerCase() : '';

    if (title.indexOf(lowerQuery) !== -1 || desc.indexOf(lowerQuery) !== -1) {
      card.style.display = 'block';
      card.style.animation = 'fadeIn 0.3s ease';
    } else {
      card.style.display = 'none';
    }
  });
}

// ==========================================
// الأنيميشن والتأثيرات
// ==========================================

function initAnimations() {
  // Magnetic buttons
  document.querySelectorAll('.magnetic-btn').forEach(function(btn) {
    btn.addEventListener('mousemove', function(e) {
      const rect = btn.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      btn.style.transform = 'translate(' + (x * 0.2) + 'px, ' + (y * 0.2) + 'px) scale(1.05)';
    });

    btn.addEventListener('mouseleave', function() {
      btn.style.transform = '';
    });
  });

  // Scroll reveal
  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('active');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.reveal').forEach(function(el) {
    observer.observe(el);
  });
}

function animateNumbers() {
  const counters = document.querySelectorAll('.stat-number');

  counters.forEach(function(counter) {
    const target = parseInt(counter.getAttribute('data-target'));
    if (!target) return;

    const duration = 2000;
    const increment = target / (duration / 16);
    let current = 0;

    const updateCounter = function() {
      current += increment;
      if (current < target) {
        counter.innerText = Math.ceil(current).toLocaleString();
        requestAnimationFrame(updateCounter);
      } else {
        counter.innerText = target.toLocaleString();
      }
    };

    const observer = new IntersectionObserver(function(entries) {
      if (entries[0].isIntersecting) {
        updateCounter();
        observer.disconnect();
      }
    });

    observer.observe(counter);
  });
}

function animateValue(id, start, end, duration) {
  const obj = document.getElementById(id);
  if (!obj) return;

  let startTimestamp = null;

  const step = function(timestamp) {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    const value = Math.floor(progress * (end - start) + start);

    if (id === 'totalSaved') {
      obj.innerHTML = value.toLocaleString() + ' <small>Pi</small>';
    } else {
      obj.innerHTML = value.toLocaleString();
    }

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };

  window.requestAnimationFrame(step);
}

// ==========================================
// المودالات المساعدة
// ==========================================

function openCreateModal() {
  if (!requireLogin()) return;
  const modal = document.getElementById('createModal');
  if (modal) modal.classList.add('active');
}

function openJoinModal() {
  const grid = document.querySelector('.grid');
  if (grid) {
    window.scrollTo({
      top: grid.offsetTop - 100,
      behavior: 'smooth'
    });
  }
  toast('اختر جمعية', 'اختر جمعية من القائمة أدناه للانضمام', 'info');
}

function openCalculator() {
  toast('قريباً', 'حاسبة التوفير قيد التطوير', 'info');
}

function setupModalClose() {
  // إغلاق المودال عند النقر خارجها
  document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal')) {
      e.target.classList.remove('active');
    }
  });

  // إغلاق الإشعارات عند النقر خارجها
  document.addEventListener('click', function(e) {
    const notifWrapper = document.querySelector('.notification-wrapper');
    const notifPanel = document.getElementById('notifPanel');

    if (notifPanel && notifWrapper && !notifWrapper.contains(e.target)) {
      notifPanel.classList.remove('active');
    }
  });
}

// ==========================================
// دوال مساعدة
// ==========================================

function onIncompletePaymentFound(payment) {
  console.log('Incomplete payment found:', payment);
  toast('دفعة غير مكتملة', 'لديك دفعة سابقة غير مكتملة', 'warning');
}

// ==========================================
// CSS إضافي للأنيميشن
// ==========================================

(function injectStyles() {
  const style = document.createElement('style');
  style.textContent = '' +
    '@keyframes shake {' +
      '0%, 100% { transform: translateX(0); }' +
      '25% { transform: translateX(-10px); }' +
      '75% { transform: translateX(10px); }' +
    '}' +
    '.shake { animation: shake 0.5s ease; }' +

    '.badge-live {' +
      'background: rgba(0, 200, 83, 0.1);' +
      'color: #00c853;' +
      'padding: 4px 10px;' +
      'border-radius: 12px;' +
      'font-size: 11px;' +
      'font-weight: 700;' +
      'animation: pulse-live 2s infinite;' +
    '}' +

    '.badge-full {' +
      'background: rgba(108, 117, 125, 0.1);' +
      'color: #6c757d;' +
      'padding: 4px 10px;' +
      'border-radius: 12px;' +
      'font-size: 11px;' +
      'font-weight: 700;' +
    '}' +

    '@keyframes pulse-live {' +
      '0%, 100% { opacity: 1; transform: scale(1); }' +
      '50% { opacity: 0.5; transform: scale(0.8); }' +
    '}' +

    '.banned-screen {' +
      'position: fixed;' +
      'inset: 0;' +
      'background: var(--bg);' +
      'display: flex;' +
      'flex-direction: column;' +
      'align-items: center;' +
      'justify-content: center;' +
      'gap: 20px;' +
      'text-align: center;' +
      'padding: 40px;' +
    '}' +

    '.banned-screen i { font-size: 80px; color: #ff1744; }' +
    '.banned-screen h1 { color: #ff1744; font-size: 32px; }' +

    '@keyframes fadeIn {' +
      'from { opacity: 0; transform: translateY(10px); }' +
      'to { opacity: 1; transform: translateY(0); }' +
    '}' +

    '.reveal {' +
      'opacity: 0;' +
      'transform: translateY(30px);' +
      'transition: all 0.6s ease;' +
    '}' +

    '.reveal.active {' +
      'opacity: 1;' +
      'transform: translateY(0);' +
    '}';

  document.head.appendChild(style);
})();
