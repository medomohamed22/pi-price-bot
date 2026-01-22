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
  el.textContent = `${new Date().toLocaleTimeString()}  ${line}\n` + el.textContent;
}

function setStatus(){
  const Pi = window.Pi;
  $("sdkConnected").textContent = Pi ? "Loaded" : "Not loaded";
  $("sdkUser").textContent = state.auth?.user?.username || "—";
  $("sdkUid").textContent = state.auth?.user?.uid || "—";
  $("sdkToken").textContent = state.auth?.accessToken ? state.auth.accessToken.slice(0, 24) + "..." : "—";

  $("issuerPub").textContent = state.issuerPub || "—";
  $("distPub").textContent = state.distPub || "—";

  // Domain page prefill
  if ($("verIssuer")) $("verIssuer").value = $("verIssuer").value || state.issuerPub || "";
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

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${res.status}: ${text}`);
  }
  return data;
}

/* Tabs routing */
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

    // حفظ pubkeys للـ Domain page
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

/** Create Sell Offer */
$("btnSellOffer").addEventListener("click", async () => {
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const amount = $("offerAmount").value.trim();
  const price = $("offerPrice").value.trim();
  const adminToken = $("adminToken").value.trim();

  if (!assetCode) return log("log", "❌ Asset Code فاضي.");
  if (!/^\d+(\.\d+)?$/.test(amount)) return log("log", "❌ Amount لازم رقم.");
  if (!/^\d+(\.\d+)?$/.test(price)) return log("log", "❌ Price لازم رقم.");

  try{
    log("log", "⏳ Creating DEX sell offer...", { assetCode, amount, price });
    const data = await apiPost("/.netlify/functions/dex_sell_offer", {
      assetCode,
      amount,
      price,
    }, adminToken);

    log("log", "✅ Sell offer created:", data);
  }catch(e){
    log("log", "❌ Sell offer error:", e.message || e);
  }
});

/** Add AMM Liquidity */
$("btnAddAmm").addEventListener("click", async () => {
  const assetCode = normalizeAssetCode($("assetCode").value);
  $("assetCode").value = assetCode;

  const tokenAmount = $("ammTokenAmount").value.trim();
  const piAmount = $("ammPiAmount").value.trim();

  const minPrice = $("ammMinPrice").value.trim();
  const maxPrice = $("ammMaxPrice").value.trim();

  const adminToken = $("adminToken").value.trim();

  if (!assetCode) return log("log", "❌ Asset Code فاضي.");
  if (!/^\d+(\.\d+)?$/.test(tokenAmount)) return log("log", "❌ Token Amount لازم رقم.");
  if (!/^\d+(\.\d+)?$/.test(piAmount)) return log("log", "❌ Pi Amount لازم رقم.");

  try{
    log("log", "⏳ Adding AMM liquidity...", { assetCode, tokenAmount, piAmount, minPrice, maxPrice });
    const data = await apiPost("/.netlify/functions/amm_add_liquidity", {
      assetCode,
      tokenAmount,
      piAmount,
      minPrice,
      maxPrice,
    }, adminToken);

    log("log", "✅ AMM liquidity added:", data);
  }catch(e){
    log("log", "❌ AMM error:", e.message || e);
  }
});

/** Pi Payment: Donation */
$("btnDonate").addEventListener("click", async () => {
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");
  if (!state.auth) return log("log", "❌ اعمل تسجيل دخول الأول.");

  const amount = Number($("donAmount").value || 0);
  const memo = $("donMemo").value.trim() || "Donate Way — Donation";

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
  const safeDomain = (domain || "").trim();
  return `# Donate Way — Stellar TOML
# Place this file at: https://${safeDomain}/.well-known/stellar.toml

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
# Optional (add later if you have it):
# image="https://${safeDomain}/token.png"
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

  const out = genToml({domain, code, issuer, name, desc});
  $("tomlOut").value = out;
  log("log2", "✅ TOML generated. انسخه وحطه في /.well-known/stellar.toml");
});

/* Domain page: check domain */
$("btnCheckDomain").addEventListener("click", async () => {
  const domain = ($("verDomain").value || "").trim();
  const code = normalizeAssetCode($("verAssetCode").value);
  $("verAssetCode").value = code;
  const issuer = ($("verIssuer").value || "").trim();

  if (!domain) return log("log2", "❌ اكتب الدومين.");
  if (!code) return log("log2", "❌ Asset Code فاضي.");
  if (!issuer || !issuer.startsWith("G")) return log("log2", "❌ Issuer Public Key لازم يبدأ بـ G");

  const url = `https://${domain}/.well-known/stellar.toml`;
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
