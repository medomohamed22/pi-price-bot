// ===================== Supabase Config =====================
const SUPABASE_URL = "https://xncapmzlwuisupkjlftb.supabase.co";
const SUPABASE_KEY = "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS"; 
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function $(id) { return document.getElementById(id); }

// ===================== 1. تحميل المجموعات =====================
async function loadAdminGroups() {
    const selects = ["groupSelect", "groupSelectCreate"];
    
    const { data: groups } = await sb.from("groups").select("*").order("created_at", { ascending: false });
    
    const html = `<option value="">-- اختر الجمعية --</option>` + 
                 (groups || []).map(g => `<option value="${g.id}">${g.name}</option>`).join("");

    selects.forEach(id => { if($(id)) $(id).innerHTML = html; });
}

// ===================== 2. عرض الدورات =====================
async function loadCyclesForGroup() {
    const groupId = $("groupSelect").value;
    const list = $("cyclesList");
    if(!groupId) return;

    list.innerHTML = "جارٍ التحميل...";
    
    const { data: cycles } = await sb
        .from("cycles")
        .select("*")
        .eq("group_id", groupId)
        .order("created_at", { ascending: false });

    if(!cycles || cycles.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center;">لا توجد دورات في هذه الجمعية</div>`;
        return;
    }

    list.innerHTML = cycles.map(c => `
        <div class="cycle-card member-card" style="border-left:4px solid var(--p)">
            <div class="cycle-info">
                <b>${c.title}</b>
                <div class="badge">${c.status}</div>
                <small>${c.monthly_amount} Pi / شهر - (${c.months} شهور)</small>
            </div>
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button class="btn soft sm" onclick="loadMembersForCycle(${c.id}, '${c.title}', ${c.months}, ${c.monthly_amount})">👥 إدارة الأعضاء والمدفوعات</button>
                <button class="btn danger sm" onclick="deleteCycle(${c.id})">حذف</button>
            </div>
        </div>
    `).join("");
}

// ===================== 3. إدارة الأعضاء (Logic Core) =====================
let currentCycleId = null;

async function loadMembersForCycle(cycleId, title, totalMonths, amount) {
    currentCycleId = cycleId;
    const section = $("membersSection");
    const list = $("membersList");
    
    section.style.display = "block";
    $("membersSectionTitle").textContent = `إدارة: ${title}`;
    $("cycleInfoBadge").textContent = `إجمالي: ${amount * totalMonths} Pi`;
    
    list.innerHTML = `<div style="text-align:center; padding:20px;">جارٍ تحليل بيانات الأعضاء والمحافظ...</div>`;
    section.scrollIntoView({ behavior: 'smooth' });

    // 1. جلب الأعضاء
    const { data: members, error } = await sb
        .from("members")
        .select("id, pi_uid, username, position, created_at")
        .eq("cycle_id", cycleId)
        .order("position", { ascending: true });

    if(!members || members.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:gray">لا يوجد أعضاء مسجلين في هذه الدورة بعد.</div>`;
        return;
    }

    // 2. تحضير قائمة pi_uids لجلب البيانات الإضافية
    const userIds = members.map(m => m.pi_uid);

    // 3. جلب المحافظ (Wallets)
    const { data: wallets } = await sb
        .from("user_wallets")
        .select("pi_uid, wallet_address")
        .in("pi_uid", userIds);
    
    // تحويل المحافظ إلى Map للسرعة
    const walletMap = {};
    wallets?.forEach(w => walletMap[w.pi_uid] = w.wallet_address);

    // 4. جلب حالة الحظر (Profiles)
    const { data: profiles } = await sb
        .from("profiles")
        .select("pi_uid, is_banned")
        .in("pi_uid", userIds);
        
    const banMap = {};
    profiles?.forEach(p => banMap[p.pi_uid] = p.is_banned);

    // 5. جلب المدفوعات وحساب التقدم لكل عضو
    // نستخدم Loop ذكية أو استعلام تجميعي. هنا سنقوم باستعلام لكل عضو لضمان الدقة في النسخة البسيطة
    // الأفضل: جلب كل مدفوعات الدورة ثم التوزيع JS
    const { data: payments } = await sb
        .from("payments")
        .select("member_id, status")
        .eq("status", "completed")
        .in("member_id", members.map(m => m.id)); // استخدام member_id حسب التعديل الأخير

    // حساب المدفوعات لكل عضو
    const paymentCounts = {};
    payments?.forEach(p => {
        paymentCounts[p.member_id] = (paymentCounts[p.member_id] || 0) + 1;
    });

    // 6. رسم الواجهة
    list.innerHTML = members.map(m => {
        const wallet = walletMap[m.pi_uid] || "لم يربط المحفظة بعد";
        const isBanned = banMap[m.pi_uid] || false;
        const paidCount = paymentCounts[m.id] || 0;
        const progress = Math.min((paidCount / totalMonths) * 100, 100);
        const remaining = (totalMonths - paidCount) * amount;

        return `
        <div class="member-card ${isBanned ? 'banned' : ''}" id="member-${m.id}">
            <div class="member-header">
                <div class="user-info">
                    <b>${m.position}. @${m.username} ${isBanned ? '🔴 (محظور)' : ''}</b>
                    <span>ID: ${m.pi_uid.substring(0, 10)}...</span>
                </div>
                <div class="badge ${paidCount >= totalMonths ? 'paid' : ''}">
                    ${paidCount >= totalMonths ? 'مكتمل' : 'سارٍ'}
                </div>
            </div>

            <!-- المحفظة -->
            <div class="wallet-box">
                <span id="wallet-text-${m.id}" title="${wallet}">${wallet.substring(0, 25)}${wallet.length > 25 ? '...' : ''}</span>
                <button class="copy-btn" onclick="copyText('${wallet}')" title="نسخ">📋</button>
            </div>

            <!-- التقدم -->
            <div class="progress-wrap">
                <div class="progress-meta">
                    <span>دفع: ${paidCount} / ${totalMonths} شهر</span>
                    <span>متبقي: ${remaining.toFixed(1)} Pi</span>
                </div>
                <div class="progress-track">
                    <div class="progress-fill" style="width:${progress}%"></div>
                </div>
            </div>

            <!-- التحكم -->
            <div class="actions-row">
                <button class="btn soft sm" style="flex:1" onclick="alert('سجل المدفوعات التفصيلي قادم قريباً')">📜 السجل</button>
                <button class="btn ${isBanned ? 'primary' : 'danger'} sm" style="flex:1" 
                        onclick="toggleBan('${m.pi_uid}', ${!isBanned}, '${m.username}')">
                        ${isBanned ? 'فك الحظر 🟢' : 'حظر المستخدم 🚫'}
                </button>
            </div>
        </div>
        `;
    }).join("");
}

// ===================== أدوات مساعدة =====================

// 1. نسخ النص
async function copyText(text) {
    if(!text || text.includes("لم يربط")) return alert("لا يوجد عنوان صحيح للنسخ");
    try {
        await navigator.clipboard.writeText(text);
        alert("تم نسخ عنوان المحفظة: \n" + text);
    } catch (err) {
        prompt("اضغط Ctrl+C للنسخ:", text);
    }
}

// 2. حظر/فك حظر المستخدم
async function toggleBan(pi_uid, shouldBan, username) {
    const action = shouldBan ? "حظر" : "فك حظر";
    if(!confirm(`هل أنت متأكد من ${action} المستخدم @${username}؟\nسيؤثر هذا على دخوله للموقع بالكامل.`)) return;

    // نقوم بتحديث الجدول profiles
    // نستخدم upsert لضمان وجود السجل
    const { error } = await sb
        .from("profiles")
        .upsert({ pi_uid: pi_uid, is_banned: shouldBan, username: username }); // تحديث الاسم أيضاً

    if(error) {
        alert("فشل العملية: " + error.message);
    } else {
        alert(`تم ${action} المستخدم بنجاح.`);
        // تحديث القائمة الحالية إذا كانت مفتوحة
        if(currentCycleId) {
             // إعادة تحميل بسيطة للمنطقة المرئية
             // لاسترجاع القيم الصحيحة للدالة، نحتاج تخزينها، لكن هنا سنعيد تحميل الصفحة أو الدورة
             const btn = document.querySelector(`button[onclick*="${currentCycleId}"]`);
             if(btn) btn.click(); 
        }
    }
}

// ===================== الإنشاء (نسخة مختصرة مربوطة بالواجهة) =====================
// الدوال createGroup و createCycle موجودة في الكود السابق، تأكد من وجودها هنا
// ... (أضف دوال createGroup, createCycle من الملف السابق هنا) ...

window.addEventListener("load", loadAdminGroups);
