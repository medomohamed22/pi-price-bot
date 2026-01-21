const API = "/api/pi";

const state = {
  accessToken: null,
  uid: null,
  username: null,
};

const $ = (id) => document.getElementById(id);

function nowStr(){
  const d = new Date();
  return d.toLocaleString("ar-EG");
}

function logPay(msg, type="muted"){
  const el = $("payLog");
  el.innerHTML = msg;
  el.className = "status " + (type === "ok" ? "ok" : type === "bad" ? "bad" : "");
}
function logWithdraw(msg, type="muted"){
  const el = $("withdrawLog");
  el.innerHTML = msg;
  el.className = "status " + (type === "ok" ? "ok" : type === "bad" ? "bad" : "");
}

function setAuthUI(isAuthed){
  $("authState").textContent = isAuthed ? "مسجل" : "غير مسجل";
  $("uid").textContent = state.uid || "-";
  $("username").textContent = state.username || "-";
}

async function postJSON(url, body){
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(body || {})
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = data?.error?.error_message || data?.error?.message || data?.error || data?.details || data?.raw || "Request failed";
    throw new Error(err);
  }
  return data;
}

function renderTxList(items){
  const wrap = $("txList");
  if (!items || !items.length){
    wrap.innerHTML = `
      <div class="item">
        <div class="left">
          <div class="t">لا يوجد بيانات</div>
          <div class="s">بعد أول دفع/سحب هتظهر هنا</div>
        </div>
        <div class="amt muted">—</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = items.slice(0, 8).map((x)=>{
    const title = x.type === "donation" ? "دفع قسط" : "سحب";
    const sub = x.type === "donation"
      ? `paymentId: ${x.payment_id || "-"} • txid: ${x.txid || "-"}`
      : `to: ${x.wallet_address || "-"} • txid: ${x.txid || "-"}`;

    const amt = (x.amount ?? 0) + " Pi";
    return `
      <div class="item">
        <div class="left">
          <div class="t">${title}</div>
          <div class="s">${sub}</div>
          <div class="s">${new Date(x.created_at || Date.now()).toLocaleString("ar-EG")}</div>
        </div>
        <div class="amt">${amt}</div>
      </div>
    `;
  }).join("");
}

async function refreshBalance(){
  if (!state.uid){
    logWithdraw("سجّل دخول الأول.", "bad");
    return;
  }

  const data = await postJSON(`${API}/balance`, { uid: state.uid });

  $("kpiDonated").textContent = (data.totalDonated ?? 0).toFixed(4);
  $("kpiWithdrawn").textContent = (data.totalWithdrawn ?? 0).toFixed(4);
  $("kpiBalance").textContent = (data.balance ?? 0).toFixed(4);

  $("lastSync").textContent = nowStr();
  renderTxList(data.lastTx || []);
}

async function login(){
  try{
    // scopes الشائعة: username + payments 2
    const scopes = ["username", "payments"];

    const auth = await Pi.authenticate(scopes, async (payment) => {
      // onIncompletePaymentFound: لو فيه دفعة ناقصة نحاول نكمّلها
      // ملاحظة: بعض الحالات payment.transaction ممكن تكون null
      try{
        if (payment?.identifier && payment?.transaction?.txid) {
          await postJSON(`${API}/complete`, { paymentId: payment.identifier, txid: payment.transaction.txid });
        }
      }catch(e){
        // تجاهل/سجل
        console.warn("Incomplete payment completion failed:", e.message);
      }
    });

    state.accessToken = auth.accessToken;
    state.uid = auth.user.uid;
    state.username = auth.user.username || "-";

    setAuthUI(true);
    logPay("تم تسجيل الدخول ✅", "ok");
    await refreshBalance();
  }catch(e){
    setAuthUI(false);
    logPay("فشل تسجيل الدخول: " + e.message, "bad");
  }
}

function logout(){
  state.accessToken = null;
  state.uid = null;
  state.username = null;
  setAuthUI(false);
  logPay("تم الخروج.", "muted");
  $("kpiDonated").textContent = "0";
  $("kpiWithdrawn").textContent = "0";
  $("kpiBalance").textContent = "0";
  $("lastSync").textContent = "-";
  renderTxList([]);
}

async function payInstallment(){
  if (!state.uid){
    logPay("سجّل دخول Pi الأول.", "bad");
    return;
  }

  const groupName = $("groupName").value.trim() || "جمعية";
  const cycleNo = Number($("cycleNo").value || 1);
  const amount = Number($("installment").value || 0);
  const memo = $("memo").value.trim() || "قسط الجمعية";

  if (!Number.isFinite(amount) || amount <= 0){
    logPay("اكتب مبلغ صحيح.", "bad");
    return;
  }

  const paymentData = {
    amount,
    memo: `${memo} - ${groupName} (Cycle ${cycleNo})`,
    metadata: {
      kind: "chama_installment",
      groupName,
      cycleNo,
      uid: state.uid,
      username: state.username,
      ts: Date.now()
    }
  };

  const paymentCallbacks = {
    onReadyForServerApproval: async function(paymentId){
      logPay(`1) paymentId = ${paymentId}\n2) إرسال approve للسيرفر...`);
      await postJSON(`${API}/approve`, { paymentId });
      logPay(`✅ تمت الموافقة Server Approve\nفي انتظار تأكيد المستخدم داخل المحفظة...`, "ok");
    },
    onReadyForServerCompletion: async function(paymentId, txid){
      logPay(`تم الحصول على txid\npaymentId: ${paymentId}\ntxid: ${txid}\nإرسال complete للسيرفر...`);
      const done = await postJSON(`${API}/complete`, { paymentId, txid });
      logPay(`✅ تمت العملية بالكامل\nتم تسجيل الدفع في قاعدة البيانات.\n${JSON.stringify(done).slice(0, 250)}...`, "ok");
      await refreshBalance();
    },
    onCancel: function(paymentId){
      logPay(`تم الإلغاء بواسطة المستخدم.\npaymentId: ${paymentId}`, "bad");
    },
    onError: function(error, payment){
      console.error(error, payment);
      logPay(`خطأ في الدفع: ${error?.message || error}\n${payment?.identifier ? "paymentId: "+payment.identifier : ""}`, "bad");
    }
  };

  try{
    logPay("فتح نافذة الدفع داخل Pi ...");
    await Pi.createPayment(paymentData, paymentCallbacks);
  }catch(e){
    logPay("فشل createPayment: " + e.message, "bad");
  }
}

async function withdraw(){
  if (!state.uid){
    logWithdraw("سجّل دخول الأول.", "bad");
    return;
  }

  const walletAddress = $("walletAddress").value.trim();
  const amount = Number($("withdrawAmount").value || 0);

  if (!walletAddress || walletAddress.length < 20){
    logWithdraw("اكتب عنوان محفظة صحيح (GA....).", "bad");
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0){
    logWithdraw("اكتب مبلغ سحب صحيح.", "bad");
    return;
  }

  try{
    logWithdraw("جاري تنفيذ السحب من محفظة النظام...", "muted");
    const data = await postJSON(`${API}/withdraw`, {
      uid: state.uid,
      username: state.username,
      amount,
      walletAddress
    });

    logWithdraw(`✅ تم السحب بنجاح\nTX: ${data.txid}`, "ok");
    await refreshBalance();
  }catch(e){
    logWithdraw("فشل السحب: " + e.message, "bad");
  }
}

$("btnLogin").addEventListener("click", login);
$("btnLogout").addEventListener("click", logout);
$("btnPay").addEventListener("click", payInstallment);
$("btnRefresh").addEventListener("click", () => refreshBalance().catch(e => logWithdraw(e.message, "bad")));
$("btnWithdraw").addEventListener("click", withdraw);

setAuthUI(false);
renderTxList([]);
