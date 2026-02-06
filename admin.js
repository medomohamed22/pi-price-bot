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

// ===================== 2. عرض وحذف الدورات =====================
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
                <div class="badge">${c.status === 'open' ? 'نشطة 🟢' : 'مغلقة 🔴'}</div>
                <small>${c.monthly_amount} Pi / شهر - (${c.months} شهور)</small>
            </div>
            <div style="margin-top:10px; display:flex; gap:10px;">
                <button class="btn soft sm" onclick="loadMembersForCycle(${c.id}, '${c.title}', ${c.months}, ${c.monthly_amount})">👥 الأعضاء والمدفوعات</button>
                <button class="btn danger sm" onclick="deleteCycle(${c.id})">حذف الدورة</button>
            </div>
        </div>
    `).join("");
}

async function deleteCycle(id) {
    if(!confirm("هل أنت متأكد من حذف هذه الدورة؟ سيتم حذف جميع المسجلين والبيانات المرتبطة بها!")) return;
    const { error } = await sb.from("cycles").delete().eq("id", id);
    if(error) alert("خطأ في الحذف: " + error.message);
    else { alert("تم حذف الدورة بنجاح"); loadCyclesForGroup(); }
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
    const { data: members } = await sb
        .from("members")
        .select("id, pi_uid, username, position, created_at")
        .eq("cycle_id", cycleId)
        .order("position", { ascending: true });

    if(!members || members.length === 0) {
        list.innerHTML = `<div style="padding:20px; text-align:center; color:gray">لا يوجد أعضاء مسجلين بعد.</div>`;
        return;
    }

    const userIds = members.map(m => m.pi_uid);
    const memberIds = members.map(m => m.id);

    // 2. جلب المحافظ والحظر في وقت واحد
    const [walletsRes, profilesRes, paymentsRes] = await Promise.all([
        sb.from("user_wallets").select("pi_uid, wallet_address").in("pi_uid", userIds),
        sb.from("profiles").select("pi_uid, is_banned").in("pi_uid", userIds),
        // [تعديل هام] جلب الحالات confirmed لتطابق الدفع الجديد
        sb.from("payments").select("member_id").in("member_id", memberIds).eq("status", "confirmed")
    ]);

    const walletMap = Object.fromEntries(walletsRes.data?.map(w => [w.pi_uid, w.wallet_address]) || []);
    const banMap = Object.fromEntries(profilesRes.data?.map(p => [p.pi_uid, p.is_banned]) || []);
    
    // حساب المدفوعات لكل عضو
    const paymentCounts = {};
    paymentsRes.data?.forEach(p => {
        paymentCounts[p.member_id] = (paymentCounts[p.member_id] || 0) + 1;
    });

    list.innerHTML = members.map(m => {
        const wallet = walletMap[m.pi_uid] || "لم يربط المحفظة بعد";
        const isBanned = banMap[m.pi_uid] || false;
        const paidCount = paymentCounts[m.id] || 0;
        const progress = Math.min((paidCount / totalMonths) * 100, 100);
        const remaining = (totalMonths - paidCount) * amount;

        return `
        <div class="member-card ${isBanned ? 'banned' : ''}">
            <div class="member-header">
                <div>
                    <b>${m.position}. @${m.username}</b>
                    <div style="font-size:10px; color:gray">${m.pi_uid.substring(0,12)}...</div>
                </div>
                <div class="badge ${paidCount >= totalMonths ? 'paid' : ''}">
                    ${paidCount >= totalMonths ? 'مكتمل ✅' : 'سارٍ ⏳'}
                </div>
            </div>
            <div class="wallet-box" onclick="copyText('${wallet}')" style="cursor:pointer; background:#eee; padding:5px; border-radius:4px; font-size:11px; margin:10px 0;">
                📋 ${wallet.substring(0,30)}...
            </div>
            <div class="progress-meta" style="display:flex; justify-content:space-between; font-size:12px;">
                <span>تم سداد: ${paidCount}/${totalMonths}</span>
                <span>باقي: ${remaining} Pi</span>
            </div>
            <div style="background:#ddd; height:8px; border-radius:4px; margin:5px 0;">
                <div style="background:var(--p, #6200ee); width:${progress}%; height:100%; border-radius:4px;"></div>
            </div>
            <div style="display:flex; gap:5px; margin-top:10px;">
                <button class="btn ${isBanned ? 'primary' : 'danger'} sm full-width" onclick="toggleBan('${m.pi_uid}', ${!isBanned}, '${m.username}')">
                    ${isBanned ? 'فك الحظر' : 'حظر 🚫'}
                </button>
            </div>
        </div>
        `;
    }).join("");
}

// ===================== 4. إنشاء جمعيات ودورات جديدة =====================
async function createNewGroup() {
    const name = $("newGroupName").value.trim();
    const desc = $("newGroupDesc").value.trim();
    if(!name) return alert("ادخل اسم الجمعية");

    const { error } = await sb.from("groups").insert({ name, description: desc });
    if(error) alert("خطأ: " + error.message);
    else { alert("تم إنشاء الجمعية بنجاح"); $("newGroupName").value=""; $("newGroupDesc").value=""; loadAdminGroups(); }
}

async function createNewCycle() {
    const groupId = $("groupSelectCreate").value;
    const title = $("cycleTitle").value.trim();
    const amount = parseFloat($("cycleAmount").value);
    const months = parseInt($("cycleMonths").value);

    if(!groupId || !title || !amount || !months) return alert("اكمل جميع البيانات");

    const { error } = await sb.from("cycles").insert({
        group_id: groupId,
        title: title,
        monthly_amount: amount,
        months: months,
        status: 'open'
    });

    if(error) alert("خطأ: " + error.message);
    else { alert("تم إنشاء الدورة بنجاح"); loadAdminGroups(); loadCyclesForGroup(); }
}

// ===================== 5. أدوات مساعدة =====================
async function copyText(text) {
    if(!text || text.includes("لم يربط")) return;
    navigator.clipboard.writeText(text);
    alert("تم نسخ المحفظة");
}

async function toggleBan(pi_uid, shouldBan, username) {
    const { error } = await sb.from("profiles").upsert({ pi_uid, is_banned: shouldBan, username });
    if(error) alert("فشل: " + error.message);
    else { alert("تم تحديث حالة الحظر"); if(currentCycleId) loadMembersForCycle(currentCycleId); }
}

window.addEventListener("load", loadAdminGroups);
