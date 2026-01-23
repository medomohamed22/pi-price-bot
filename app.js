/* Donate Way Dashboard (Netlify + Pi Testnet) */

const $ = (id) => document.getElementById(id);

const state = {
  auth: null,
  issuerPub: localStorage.getItem("dw_issuerPub") || "",
  distPub: localStorage.getItem("dw_distPub") || "",
};

function log(elId, ...args){
  const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a, null, 2)).join(" ");
  const el = $(elId);
  if (!el) return;
  el.textContent = `${new Date().toLocaleTimeString()}  ${line}\n` + el.textContent;
}

function setStatus(){
  const Pi = window.Pi;
  if ($("sdkConnected")) $("sdkConnected").textContent = Pi ? "Loaded" : "Not loaded";
  if ($("sdkUser")) $("sdkUser").textContent = state.auth?.user?.username || "—";
  if ($("sdkUid")) $("sdkUid").textContent = state.auth?.user?.uid || "—";
  if ($("sdkToken")) $("sdkToken").textContent = state.auth?.accessToken ? state.auth.accessToken.slice(0, 24) + "..." : "—";

  if ($("issuerPub")) $("issuerPub").textContent = state.issuerPub || "—";
  if ($("distPub")) $("distPub").textContent = state.distPub || "—";

  if ($("verIssuer")) $("verIssuer").value = $("verIssuer").value || state.issuerPub || "";
  if ($("hdDomain")) $("hdDomain").value = $("hdDomain").value || localStorage.getItem("dw_home_domain") || "";
}

function normalizeAssetCode(code){
  return (code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

async function apiPost(path, body, adminToken){
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { "X-Admin-Token": adminToken } : {}),
      ...(state.auth?.accessToken ? { "Authorization": `Bearer ${state.auth.accessToken}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok) throw new Error(data?.error || data?.message || `HTTP ${res.status}: ${text}`);
  return data;
}

/* Tabs */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    const page = btn.dataset.page;
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    $(`page-${page}`).classList.add("active");
  });
});

/** Pi SDK init */
$("btnInit").addEventListener("click", () => {
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");
  Pi.init({ version: "2.0", sandbox: false });
  log("log", "✅ Pi.init done (version 2.0, sandbox=false)");
  setStatus();
});

/** Authenticate */
$("btnAuth").addEventListener("click", async () => {
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");

  const scopes = ["username", "payments"];

  function onIncompletePaymentFound(payment){
    log("log", "⚠️ Incomplete payment found:", payment);
  }

  try{
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    state.auth = auth;
    log("log", "✅ Auth success:", { user: auth.user });
    setStatus();
  }catch(e){
    log("log", "❌ Auth error:", e.message || e);
  }
});

/** Bootstrap Token */
$("btnBootstrap").addEventListener("click", async () => {
  const displayName = $("displayName").value.trim() || "Donate Way";
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const initialSupply = $("initialSupply").value.trim();
  const adminToken = $("adminToken").value.trim();

  if (!assetCode) return log("log", "❌ Asset Code فاضي.");
  if (!/^\d+(\.\d+)?$/.test(initialSupply)) return log("log", "❌ Initial supply لازم رقم.");

  try{
    log("log", "⏳ Bootstrapping token...", { displayName, assetCode, initialSupply });
    const data = await apiPost("/.netlify/functions/token_bootstrap", {
      displayName,
      assetCode,
      initialSupply,
    }, adminToken);

    if (data?.asset?.issuer) {
      state.issuerPub = data.asset.issuer;
      localStorage.setItem("dw_issuerPub", state.issuerPub);
    }
    if (data?.distributor) {
      state.distPub = data.distributor;
      localStorage.setItem("dw_distPub", state.distPub);
    }

    log("log", "✅ Bootstrap done:", data);
    setStatus();
  }catch(e){
    log("log", "❌ Bootstrap error:", e.message || e);
  }
});

/** Trustline on Distributor */
$("btnTrustDistributor").addEventListener("click", async () => {
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;
  const adminToken = ($("adminToken")?.value || "").trim();
  if (!assetCode) return log("log", "❌ Asset Code فاضي.");

  if ($("trustOut")) $("trustOut").textContent = "";

  try{
    log("log", "⏳ Adding trustline on Distributor...", { assetCode });
    const data = await apiPost("/.netlify/functions/distributor_trust_token", { assetCode }, adminToken);
    if ($("trustOut")) $("trustOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ Trustline done:", data);
  }catch(e){
    if ($("trustOut")) $("trustOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Trustline error:", e.message || e);
  }
});

/** Send Token */
$("btnSendToken").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  const to = ($("sendTo")?.value || "").trim();
  const amount = ($("sendAmount")?.value || "").trim();
  const memo = ($("sendMemo")?.value || "").trim();

  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  if (!to || !to.startsWith("G")) return log("log", "❌ اكتب عنوان محفظتك (G...)");
  if (!/^\d+(\.\d+)?$/.test(amount)) return log("log", "❌ Amount لازم رقم");

  if ($("sendOut")) $("sendOut").textContent = "";

  try{
    log("log", "⏳ Sending token...", { to, assetCode, amount });
    const data = await apiPost("/.netlify/functions/send_token", { to, assetCode, amount, memo }, adminToken);
    if ($("sendOut")) $("sendOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ Send done:", data);
  }catch(e){
    if ($("sendOut")) $("sendOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Send error:", e.message || e);
  }
});

/** DEX Sell */
$("btnDexSell").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const amount = ($("dexAmount")?.value || "").trim();
  const price  = ($("dexPrice")?.value || "").trim();
  const offerId = ($("dexOfferId")?.value || "0").trim();

  if (!/^\d+(\.\d+)?$/.test(amount)) return log("log", "❌ Amount لازم رقم");
  if (!/^\d+(\.\d+)?$/.test(price)) return log("log", "❌ Price لازم رقم");

  if ($("dexOut")) $("dexOut").textContent = "";

  try{
    log("log", "⏳ Creating sell offer...", { assetCode, amount, price, offerId });
    const data = await apiPost("/.netlify/functions/dex_sell_offer", { assetCode, amount, price, offerId }, adminToken);
    if ($("dexOut")) $("dexOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ Sell offer done:", data);
  }catch(e){
    if ($("dexOut")) $("dexOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Sell offer error:", e.message || e);
  }
});

/** DEX Buy */
$("btnDexBuy").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const amount = ($("dexAmount")?.value || "").trim();
  const price  = ($("dexPrice")?.value || "").trim();
  const offerId = ($("dexOfferId")?.value || "0").trim();

  if (!/^\d+(\.\d+)?$/.test(amount)) return log("log", "❌ Amount لازم رقم");
  if (!/^\d+(\.\d+)?$/.test(price)) return log("log", "❌ Price لازم رقم");

  if ($("dexOut")) $("dexOut").textContent = "";

  try{
    log("log", "⏳ Creating buy offer...", { assetCode, amount, price, offerId });
    const data = await apiPost("/.netlify/functions/dex_buy_offer", { assetCode, amount, price, offerId }, adminToken);
    if ($("dexOut")) $("dexOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ Buy offer done:", data);
  }catch(e){
    if ($("dexOut")) $("dexOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Buy offer error:", e.message || e);
  }
});

/** AMM Add Liquidity */
$("btnAddAmm").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const tokenAmount = ($("ammTokenAmount")?.value || "").trim();
  const piAmount    = ($("ammPiAmount")?.value || "").trim();
  const minPrice    = ($("ammMinPrice")?.value || "").trim();
  const maxPrice    = ($("ammMaxPrice")?.value || "").trim();

  if (!/^\d+(\.\d+)?$/.test(tokenAmount)) return log("log", "❌ Token Amount لازم رقم");
  if (!/^\d+(\.\d+)?$/.test(piAmount)) return log("log", "❌ Pi Amount لازم رقم");

  try{
    log("log", "⏳ Adding AMM liquidity...", { assetCode, tokenAmount, piAmount });
    const data = await apiPost("/.netlify/functions/amm_add_liquidity", {
      assetCode, tokenAmount, piAmount, minPrice, maxPrice
    }, adminToken);
    log("log", "✅ AMM liquidity added:", data);
  }catch(e){
    log("log", "❌ AMM error:", e.message || e);
  }
});

/** Set home_domain */
$("btnSetHomeDomain").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  const homeDomainRaw = ($("hdDomain")?.value || "").trim();
  if (!homeDomainRaw) return log("log", "❌ اكتب home_domain");

  const clean = homeDomainRaw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  localStorage.setItem("dw_home_domain", clean);

  if ($("homeDomainOut")) $("homeDomainOut").textContent = "";

  try{
    log("log", "⏳ Setting issuer home_domain...", { homeDomain: clean });
    const data = await apiPost("/.netlify/functions/set_home_domain", { homeDomain: clean }, adminToken);
    if ($("homeDomainOut")) $("homeDomainOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ home_domain set:", data);
  }catch(e){
    if ($("homeDomainOut")) $("homeDomainOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Set home_domain error:", e.message || e);
  }
});

/** Check home_domain */
$("btnCheckHomeDomain").addEventListener("click", async () => {
  const adminToken = ($("adminToken")?.value || "").trim();
  if ($("homeDomainOut")) $("homeDomainOut").textContent = "";

  try{
    log("log", "⏳ Checking issuer info...");
    const data = await apiPost("/.netlify/functions/get_issuer_info", {}, adminToken);
    if ($("homeDomainOut")) $("homeDomainOut").textContent = JSON.stringify(data, null, 2);
    log("log", "✅ Issuer info:", data);

    if (data?.home_domain) {
      localStorage.setItem("dw_home_domain", data.home_domain);
      if ($("hdDomain")) $("hdDomain").value = data.home_domain;
    }
  }catch(e){
    if ($("homeDomainOut")) $("homeDomainOut").textContent = JSON.stringify({ error: e.message || String(e) }, null, 2);
    log("log", "❌ Check home_domain error:", e.message || e);
  }
});

/** Pi Payments Donate */
$("btnDonate").addEventListener("click", async () => {
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");
  if (!state.auth) return log("log", "❌ اعمل تسجيل دخول الأول.");

  const amount = Number($("donAmount").value || 0);
  const memo = ($("donMemo").value || "").trim() || "Donate Way — Donation";

  try{
    log("log", "⏳ Creating payment...", { amount, memo });

    Pi.createPayment({
      amount,
      memo,
      metadata: { kind: "donation", app: "DonateWay" }
    },{
      onReadyForServerApproval: async (paymentId) => {
        log("log", "➡️ onReadyForServerApproval:", paymentId);
        await apiPost("/.netlify/functions/pi_approve", { paymentId });
        log("log", "✅ Approved:", paymentId);
      },
      onReadyForServerCompletion: async (paymentId, txid) => {
        log("log", "➡️ onReadyForServerCompletion:", { paymentId, txid });
        await apiPost("/.netlify/functions/pi_complete", { paymentId, txid });
        log("log", "✅ Completed:", { paymentId, txid });
      },
      onCancel: (paymentId) => log("log", "⚠️ Payment cancelled:", paymentId),
      onError: (err, payment) => log("log", "❌ Payment error:", err?.message || err, payment || "")
    });

  }catch(e){
    log("log", "❌ createPayment error:", e.message || e);
  }
});

/* Domain page: generate TOML */
function genToml({domain, code, issuer, name, desc}){
  const d = (domain || "").trim();
  return `# Donate Way — Pi TOML / Stellar TOML
# Put this content in BOTH:
# https://${d}/.well-known/pi.toml
# https://${d}/.well-known/stellar.toml

NETWORK_PASSPHRASE="Pi Testnet"
HORIZON_URL="https://api.testnet.minepi.com"

ACCOUNTS=[
  "${issuer}"
]

[[CURRENCIES]]
code="${code}"
issuer="${issuer}"
display_decimals=2
name="${name}"
desc="${desc}"
image="https://${d}/token.png"
`;
}

$("btnGenToml").addEventListener("click", () => {
  const domain = ($("verDomain").value || "").trim();
  const code = normalizeAssetCode($("verAssetCode").value);
  $("verAssetCode").value = code;
  const issuer = ($("verIssuer").value || "").trim();
  const name = ($("verName").value || "Donate Way").trim();
  const desc = ($("verDesc").value || "").trim();

  if (!domain) return log("log2", "❌ اكتب الدومين.");
  if (!code) return log("log2", "❌ Asset Code فاضي.");
  if (!issuer || !issuer.startsWith("G")) return log("log2", "❌ Issuer Public Key لازم يبدأ بـ G");

  $("tomlOut").value = genToml({domain, code, issuer, name, desc});
  log("log2", "✅ TOML generated.");
});

/* Domain check */
$("btnCheckDomain").addEventListener("click", async () => {
  const domain = ($("verDomain").value || "").trim();
  const code = normalizeAssetCode($("verAssetCode").value);
  $("verAssetCode").value = code;
  const issuer = ($("verIssuer").value || "").trim();

  if (!domain) return log("log2", "❌ اكتب الدومين.");
  if (!code) return log("log2", "❌ Asset Code فاضي.");
  if (!issuer || !issuer.startsWith("G")) return log("log2", "❌ Issuer Public Key لازم يبدأ بـ G");

  const url = `https://${domain}/.well-known/pi.toml`;
  $("domainCheckOut").textContent = "";

  try{
    log("log2", "⏳ Fetching:", url);
    const res = await fetch(url, { cache: "no-store" });
    const text = await res.text();

    const hasCode = text.includes(`code="${code}"`) || text.includes(`code='${code}'`);
    const hasIssuer = text.includes(issuer);

    const result = {
      url,
      http_ok: res.ok,
      status: res.status,
      found_code: hasCode,
      found_issuer: hasIssuer,
      note: (!res.ok) ? "HTTP not OK" : (!hasCode || !hasIssuer) ? "الملف موجود بس البيانات ناقصة/مش مطابقة" : "تمام ✅"
    };

    $("domainCheckOut").textContent = JSON.stringify(result, null, 2);
    log("log2", "✅ Check done:", result);
  }catch(e){
    $("domainCheckOut").textContent = JSON.stringify({ url, error: e.message || String(e) }, null, 2);
    log("log2", "❌ Check failed:", e.message || e);
  }
});

setStatus();
