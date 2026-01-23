/* Donate Way — Dashboard (Netlify + Pi Testnet) */

const $ = (id) => document.getElementById(id);

const HORIZON = "https://api.testnet.minepi.com";

const state = {
  auth: null,
  assetCode: localStorage.getItem("dw_code") || "DONATEWAY",
  issuerPub: localStorage.getItem("dw_issuer") || "GBQ3H472BMOMTFRSK5P26FBRVOE3ZFCB5F3FTGXEGOV5CN7RAB6TRPJR",
  distPub: localStorage.getItem("dw_dist") || "GCLLMIFJFBP5JASN2T7K3CEZWZN5WQWZY3DNKVYOH73KOPXEQQICNDOG",
};

function now(){ return new Date().toLocaleTimeString(); }

function log(elId, ...args){
  const el = $(elId);
  if (!el) return;
  const line = args.map(a => typeof a === "string" ? a : JSON.stringify(a, null, 2)).join(" ");
  el.textContent = `${now()}  ${line}\n` + (el.textContent || "");
}

function normalizeAssetCode(code){
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function getAdminToken(){
  return ($("adminToken")?.value || "").trim();
}

function getCore(){
  const code = normalizeAssetCode($("assetCode")?.value || state.assetCode);
  const issuer = ($("issuerPub")?.value || state.issuerPub).trim();
  const dist = ($("distPub")?.value || state.distPub).trim();
  return { code, issuer, dist };
}

function setStatus(){
  const Pi = window.Pi;
  const sdkOk = !!Pi;
  if ($("dotSdk")) $("dotSdk").className = `dot ${sdkOk ? "good" : "bad"}`;
  if ($("sdkConnected")) $("sdkConnected").textContent = sdkOk ? "Loaded" : "Not loaded";
  if ($("sdkUser")) $("sdkUser").textContent = state.auth?.user?.username || "—";

  if ($("assetCode")) $("assetCode").value = normalizeAssetCode(state.assetCode);
  if ($("issuerPub")) $("issuerPub").value = state.issuerPub;
  if ($("distPub")) $("distPub").value = state.distPub;

  if ($("offersAccount")) $("offersAccount").value = $("offersAccount").value || state.distPub;
  if ($("verIssuer")) $("verIssuer").value = $("verIssuer").value || state.issuerPub;
}

async function apiPost(path, body){
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type":"application/json",
      ...(getAdminToken() ? { "X-Admin-Token": getAdminToken() } : {}),
      ...(state.auth?.accessToken ? { "Authorization": `Bearer ${state.auth.accessToken}` } : {}),
    },
    body: JSON.stringify(body || {})
  });

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!res.ok){
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(`${msg}\n---\n${text}`);
  }
  return data;
}

async function hzGet(path){
  const res = await fetch(`${HORIZON}${path}`, { cache:"no-store" });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw:text }; }
  if (!res.ok) throw new Error(`Horizon ${res.status}\n---\n${text}`);
  return data;
}

/* Tabs */
document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const page = btn.dataset.page;
    document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
    $(`page-${page}`).classList.add("active");
  });
});

/* Save keys */
$("btnSaveKeys")?.addEventListener("click", ()=>{
  const { code, issuer, dist } = getCore();
  if (!code || !issuer.startsWith("G") || !dist.startsWith("G")){
    return log("log", "❌ تأكد من assetCode/issuer/dist");
  }
  state.assetCode = code;
  state.issuerPub = issuer;
  state.distPub = dist;
  localStorage.setItem("dw_code", code);
  localStorage.setItem("dw_issuer", issuer);
  localStorage.setItem("dw_dist", dist);
  log("log", "✅ Saved locally:", { code, issuer, dist });
  setStatus();
});

/* Pi SDK init */
$("btnInit")?.addEventListener("click", ()=>{
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");
  Pi.init({ version:"2.0", sandbox:false });
  log("log", "✅ Pi.init done (sandbox=false)");
  setStatus();
});

/* Pi Auth */
$("btnAuth")?.addEventListener("click", async ()=>{
  const Pi = window.Pi;
  if (!Pi) return log("log", "❌ Pi SDK مش محمّل.");
  const scopes = ["username","payments"];
  function onIncompletePaymentFound(p){ log("log", "⚠️ Incomplete payment:", p); }

  try{
    const auth = await Pi.authenticate(scopes, onIncompletePaymentFound);
    state.auth = auth;
    log("log", "✅ Auth:", { user: auth.user });
    setStatus();
  }catch(e){
    log("log", "❌ Auth error:", e.message || e);
  }
});

/* Load Asset from Horizon */
$("btnLoadAsset")?.addEventListener("click", async ()=>{
  const { code, issuer } = getCore();
  if (!code || !issuer.startsWith("G")) return log("log", "❌ Asset/Issuer invalid");
  try{
    log("log", "⏳ Loading asset from Horizon...", { code, issuer });
    const data = await hzGet(`/assets?asset_code=${encodeURIComponent(code)}&asset_issuer=${encodeURIComponent(issuer)}&limit=1&order=desc`);
    $("assetOut").textContent = JSON.stringify(data?._embedded?.records?.[0] || data, null, 2);
    log("log", "✅ Asset loaded");
  }catch(e){
    $("assetOut").textContent = String(e.message || e);
    log("log", "❌ Asset load error:", e.message || e);
  }
});

/* Payments Donate */
$("btnDonate")?.addEventListener("click", async ()=>{
  const Pi = window.Pi;
  if (!Pi) return log("payLog", "❌ Pi SDK مش محمّل.");
  if (!state.auth) return log("payLog", "❌ اعمل Login الأول.");

  const amount = Number($("donAmount")?.value || 0);
  const memo = ($("donMemo")?.value || "").trim() || "Donate Way — Donation";
  if (!amount || amount <= 0) return log("payLog", "❌ Amount لازم > 0");

  try{
    log("payLog", "⏳ createPayment...", { amount, memo });
    Pi.createPayment({ amount, memo, metadata:{ kind:"donation", app:"DonateWay" }},{
      onReadyForServerApproval: async (paymentId)=>{
        log("payLog", "➡️ approval:", paymentId);
        const r = await apiPost("/.netlify/functions/pi_approve", { paymentId });
        log("payLog", "✅ approved:", r);
      },
      onReadyForServerCompletion: async (paymentId, txid)=>{
        log("payLog", "➡️ completion:", { paymentId, txid });
        const r = await apiPost("/.netlify/functions/pi_complete", { paymentId, txid });
        log("payLog", "✅ completed:", r);
      },
      onCancel: (paymentId)=> log("payLog", "⚠️ cancelled:", paymentId),
      onError: (err,p)=> log("payLog", "❌ error:", err?.message || err, p||""),
    });
  }catch(e){
    log("payLog", "❌ createPayment error:", e.message || e);
  }
});

/* ===== Market Explorer ===== */

/* Offers */
$("btnShowOffers")?.addEventListener("click", async ()=>{
  const acc = ($("offersAccount")?.value || state.distPub).trim();
  if (!acc.startsWith("G")) return log("marketLog", "❌ Account invalid");
  try{
    log("marketLog", "⏳ Loading offers...", acc);
    const data = await hzGet(`/accounts/${encodeURIComponent(acc)}/offers?limit=200&order=desc`);
    $("offersOut").textContent = JSON.stringify(data?._embedded?.records || data, null, 2);
    log("marketLog", "✅ offers loaded:", (data?._embedded?.records?.length || 0));
  }catch(e){
    $("offersOut").textContent = String(e.message || e);
    log("marketLog", "❌ offers error:", e.message || e);
  }
});

/* Orderbook */
$("btnOrderbook")?.addEventListener("click", async ()=>{
  const { code, issuer } = getCore();
  const mode = $("obMode")?.value || "sell_token";
  const limit = Number($("obLimit")?.value || 20);
  if (!code || !issuer.startsWith("G")) return log("marketLog", "❌ asset invalid");

  // order_book requires selling_* and buying_* params
  // We always pair with native PI.
  let qs = `limit=${encodeURIComponent(limit)}`;
  if (mode === "sell_token"){
    // selling token, buying PI
    qs += `&selling_asset_type=credit_alphanum12&selling_asset_code=${encodeURIComponent(code)}&selling_asset_issuer=${encodeURIComponent(issuer)}`;
    qs += `&buying_asset_type=native`;
  } else {
    // selling PI, buying token (bids)
    qs += `&selling_asset_type=native`;
    qs += `&buying_asset_type=credit_alphanum12&buying_asset_code=${encodeURIComponent(code)}&buying_asset_issuer=${encodeURIComponent(issuer)}`;
  }

  try{
    log("marketLog", "⏳ Loading orderbook...", { mode, limit });
    const data = await hzGet(`/order_book?${qs}`);
    $("orderbookOut").textContent = JSON.stringify({
      bids: data.bids?.slice(0, limit),
      asks: data.asks?.slice(0, limit),
    }, null, 2);
    log("marketLog", "✅ orderbook loaded");
  }catch(e){
    $("orderbookOut").textContent = String(e.message || e);
    log("marketLog", "❌ orderbook error:", e.message || e);
  }
});

/* Trades */
$("btnTrades")?.addEventListener("click", async ()=>{
  const { code, issuer } = getCore();
  const limit = Number($("trLimit")?.value || 20);
  const order = $("trOrder")?.value || "desc";
  if (!code || !issuer.startsWith("G")) return log("marketLog", "❌ asset invalid");

  // Trades: base=something counter=something
  // We'll track trades for token vs native.
  const qs =
    `base_asset_type=credit_alphanum12&base_asset_code=${encodeURIComponent(code)}&base_asset_issuer=${encodeURIComponent(issuer)}&` +
    `counter_asset_type=native&limit=${encodeURIComponent(limit)}&order=${encodeURIComponent(order)}`;

  try{
    log("marketLog", "⏳ Loading trades...", { limit, order });
    const data = await hzGet(`/trades?${qs}`);
    $("tradesOut").textContent = JSON.stringify(data?._embedded?.records || data, null, 2);
    log("marketLog", "✅ trades loaded:", (data?._embedded?.records?.length || 0));
  }catch(e){
    $("tradesOut").textContent = String(e.message || e);
    log("marketLog", "❌ trades error:", e.message || e);
  }
});

/* Pool info */
$("btnPoolInfo")?.addEventListener("click", async ()=>{
  const { code, issuer } = getCore();
  if (!code || !issuer.startsWith("G")) return log("marketLog", "❌ asset invalid");

  // liquidity_pools filter by reserves:
  // reserves=native, then reserves=CODE:ISSUER
  const qs = `reserves=native&reserves=${encodeURIComponent(code + ":" + issuer)}&limit=10&order=desc`;

  try{
    log("marketLog", "⏳ Loading liquidity pool...", qs);
    const data = await hzGet(`/liquidity_pools?${qs}`);
    const rec = data?._embedded?.records?.[0];
    $("poolOut").textContent = JSON.stringify(rec || data, null, 2);
    log("marketLog", rec ? `✅ pool found: ${rec.id}` : "⚠️ no pool found");
  }catch(e){
    $("poolOut").textContent = String(e.message || e);
    log("marketLog", "❌ pool error:", e.message || e);
  }
});

/* Execute tiny trade via server function */
$("btnTinyTrade")?.addEventListener("click", async ()=>{
  const { code, issuer } = getCore();
  const destination = ($("tinyDest")?.value || "").trim();
  const sendPiAmount = ($("tinySendPi")?.value || "").trim();
  const destMin = ($("tinyMinOut")?.value || "").trim();
  const memo = ($("tinyMemo")?.value || "").trim();

  if (!destination.startsWith("G")) return log("marketLog", "❌ Destination invalid (G...)");
  if (!/^\d+(\.\d+)?$/.test(sendPiAmount)) return log("marketLog", "❌ sendPiAmount لازم رقم");

  try{
    log("marketLog", "⏳ Executing tiny trade...", { destination, sendPiAmount, code });
    const data = await apiPost("/.netlify/functions/execute_tiny_trade", {
      assetCode: code,
      assetIssuer: issuer,
      destination,
      sendPiAmount,
      destMinTokenOut: destMin || "0.0000001",
      memo,
    });
    $("tinyOut").textContent = JSON.stringify(data, null, 2);
    log("marketLog", "✅ tiny trade done:", data.hash || "");
  }catch(e){
    $("tinyOut").textContent = String(e.message || e);
    log("marketLog", "❌ tiny trade error:", e.message || e);
  }
});

/* ===== Ops ===== */

/* Bootstrap */
$("btnBootstrap")?.addEventListener("click", async ()=>{
  const code = normalizeAssetCode($("assetCode")?.value || state.assetCode);
  const displayName = ($("displayName")?.value || "Donate Way").trim();
  const initialSupply = ($("initialSupply")?.value || "").trim();

  if (!code) return log("opsLog", "❌ assetCode missing");
  if (!/^\d+(\.\d+)?$/.test(initialSupply)) return log("opsLog", "❌ initialSupply invalid");

  try{
    log("opsLog", "⏳ Bootstrapping...", { displayName, code, initialSupply });
    const data = await apiPost("/.netlify/functions/token_bootstrap", { displayName, assetCode: code, initialSupply });
    $("bootOut").textContent = JSON.stringify(data, null, 2);

    if (data?.asset?.issuer){
      state.issuerPub = data.asset.issuer;
      localStorage.setItem("dw_issuer", state.issuerPub);
      if ($("issuerPub")) $("issuerPub").value = state.issuerPub;
      if ($("verIssuer")) $("verIssuer").value = state.issuerPub;
    }
    if (data?.distributor){
      state.distPub = data.distributor;
      localStorage.setItem("dw_dist", state.distPub);
      if ($("distPub")) $("distPub").value = state.distPub;
      if ($("offersAccount")) $("offersAccount").value = state.distPub;
    }
    state.assetCode = code;
    localStorage.setItem("dw_code", code);

    log("opsLog", "✅ bootstrap done");
    setStatus();
  }catch(e){
    $("bootOut").textContent = String(e.message || e);
    log("opsLog", "❌ bootstrap error:", e.message || e);
  }
});

/* DEX Sell */
$("btnSellOffer")?.addEventListener("click", async ()=>{
  const code = normalizeAssetCode($("assetCode")?.value || state.assetCode);
  const amount = ($("dexAmount")?.value || "").trim();
  const price = ($("dexPrice")?.value || "").trim();
  const offerId = ($("dexOfferId")?.value || "0").trim();

  try{
    log("opsLog", "⏳ Sell offer...", { code, amount, price, offerId });
    const data = await apiPost("/.netlify/functions/dex_sell_offer", { assetCode: code, amount, price, offerId });
    $("dexOut").textContent = JSON.stringify(data, null, 2);
    log("opsLog", "✅ sell offer done:", data.hash || "");
  }catch(e){
    $("dexOut").textContent = String(e.message || e);
    log("opsLog", "❌ sell offer error:", e.message || e);
  }
});

/* DEX Buy */
$("btnBuyOffer")?.addEventListener("click", async ()=>{
  const code = normalizeAssetCode($("assetCode")?.value || state.assetCode);
  const amount = ($("dexAmount")?.value || "").trim();
  const price = ($("dexPrice")?.value || "").trim();
  const offerId = ($("dexOfferId")?.value || "0").trim();

  try{
    log("opsLog", "⏳ Buy offer...", { code, amount, price, offerId });
    const data = await apiPost("/.netlify/functions/dex_buy_offer", { assetCode: code, amount, price, offerId });
    $("dexOut").textContent = JSON.stringify(data, null, 2);
    log("opsLog", "✅ buy offer done:", data.hash || "");
  }catch(e){
    $("dexOut").textContent = String(e.message || e);
    log("opsLog", "❌ buy offer error:", e.message || e);
  }
});

/* AMM */
$("btnAddAmm")?.addEventListener("click", async ()=>{
  const code = normalizeAssetCode($("assetCode")?.value || state.assetCode);
  const tokenAmount = ($("ammTokenAmount")?.value || "").trim();
  const piAmount = ($("ammPiAmount")?.value || "").trim();
  const minPrice = ($("ammMinPrice")?.value || "").trim();
  const maxPrice = ($("ammMaxPrice")?.value || "").trim();

  try{
    log("opsLog", "⏳ AMM add...", { code, tokenAmount, piAmount });
    const data = await apiPost("/.netlify/functions/amm_add_liquidity", { assetCode: code, tokenAmount, piAmount, minPrice, maxPrice });
    $("ammOut").textContent = JSON.stringify(data, null, 2);
    log("opsLog", "✅ AMM added:", data.hash || "");
  }catch(e){
    $("ammOut").textContent = String(e.message || e);
    log("opsLog", "❌ AMM error:", e.message || e);
  }
});

/* ===== Domain ===== */

function genPiToml({domain, code, issuer, desc, imageUrl, orgName, orgUrl}){
  const d = (domain || "").trim();
  const img = (imageUrl || `https://${d}/token_512.png`).trim();
  const orgN = (orgName || "Donate Way").trim();
  const orgU = (orgUrl || `https://${d}`).trim();
  const description = (desc || "Donate Way token on Pi Testnet for donations.").trim();

  return `# Donate Way — Pi TOML
# Place this file at: https://${d}/.well-known/pi.toml

VERSION="2.0.0"

NETWORK_PASSPHRASE="Pi Testnet"
HORIZON_URL="https://api.testnet.minepi.com"

ACCOUNTS=[
  "${issuer}"
]

[DOCUMENTATION]
ORG_NAME="${orgN}"
ORG_URL="${orgU}"
ORG_LOGO="${img}"
ORG_DESCRIPTION="${description}"

[[CURRENCIES]]
code="${code}"
issuer="${issuer}"
display_decimals=2
name="Donate Way"
desc="${description}"
image="${img}"
`;
}

async function fetchNoStore(url){
  const res = await fetch(url, { cache:"no-store" });
  const text = await res.text();
  return { res, text };
}

$("btnGenPiToml")?.addEventListener("click", ()=>{
  const domain = ($("verDomain")?.value || "").trim();
  const issuer = ($("verIssuer")?.value || state.issuerPub).trim();
  const code = normalizeAssetCode($("verAssetCode")?.value || state.assetCode);
  const imageUrl = ($("verImage")?.value || "").trim();
  const orgName = ($("verOrgName")?.value || "Donate Way").trim();
  const orgUrl = ($("verOrgUrl")?.value || `https://${domain}`).trim();
  const desc = ($("verDesc")?.value || "").trim();

  if (!domain) return log("domainLog", "❌ domain missing");
  if (!issuer.startsWith("G")) return log("domainLog", "❌ issuer invalid");
  if (!code) return log("domainLog", "❌ asset code missing");

  $("tomlOut").value = genPiToml({ domain, code, issuer, desc, imageUrl, orgName, orgUrl });
  log("domainLog", "✅ pi.toml generated");
});

$("btnCheckDomainAll")?.addEventListener("click", async ()=>{
  const domain = ($("verDomain")?.value || "").trim();
  const issuer = ($("verIssuer")?.value || state.issuerPub).trim();
  const code = normalizeAssetCode($("verAssetCode")?.value || state.assetCode);
  const img = ($("verImage")?.value || `https://${domain}/token_512.png`).trim();

  const result = {};
  try{
    const piTomlUrl = `https://${domain}/.well-known/pi.toml`;
    log("domainLog", "⏳ Fetch:", piTomlUrl);
    const a = await fetchNoStore(piTomlUrl);

    result.pi_toml = {
      url: piTomlUrl,
      http_ok: a.res.ok,
      status: a.res.status,
      found_code: a.text.includes(`code="${code}"`) || a.text.includes(`code='${code}'`),
      found_issuer: a.text.includes(issuer),
      has_documentation: a.text.includes("[DOCUMENTATION]") && a.text.includes("ORG_NAME=") && a.text.includes("ORG_LOGO="),
      has_image: a.text.includes("image="),
    };

    log("domainLog", "⏳ Fetch image:", img);
    const b = await fetch(img, { cache:"no-store" });
    result.image = { url: img, http_ok: b.ok, status: b.status };

    result.summary =
      result.pi_toml.http_ok &&
      result.pi_toml.found_code &&
      result.pi_toml.found_issuer &&
      result.pi_toml.has_documentation &&
      result.pi_toml.has_image &&
      result.image.http_ok
        ? "✅ OK. لو Wallet لسه cache: اقفل وافتح/انتظر."
        : "❌ ناقص حاجة. راجع pi.toml أو الصورة أو redirect.";

    $("domainOut").textContent = JSON.stringify(result, null, 2);
    log("domainLog", "✅ checklist:", result.summary);
  }catch(e){
    $("domainOut").textContent = String(e.message || e);
    log("domainLog", "❌ checklist error:", e.message || e);
  }
});

/* Home domain */
$("btnSetHomeDomain")?.addEventListener("click", async ()=>{
  const homeDomain = ($("hdDomain")?.value || "").trim().replace(/^https?:\/\//i,"").replace(/\/.*$/,"");
  try{
    log("domainLog", "⏳ set_home_domain:", homeDomain);
    const data = await apiPost("/.netlify/functions/set_home_domain", { homeDomain });
    $("homeDomainOut").textContent = JSON.stringify(data, null, 2);
    log("domainLog", "✅ home_domain set");
  }catch(e){
    $("homeDomainOut").textContent = String(e.message || e);
    log("domainLog", "❌ set_home_domain error:", e.message || e);
  }
});

$("btnGetIssuerInfo")?.addEventListener("click", async ()=>{
  try{
    log("domainLog", "⏳ get_issuer_info");
    const data = await apiPost("/.netlify/functions/get_issuer_info", {});
    $("homeDomainOut").textContent = JSON.stringify(data, null, 2);
    log("domainLog", "✅ issuer info loaded");
  }catch(e){
    $("homeDomainOut").textContent = String(e.message || e);
    log("domainLog", "❌ issuer info error:", e.message || e);
  }
});

setStatus();
