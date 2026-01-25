const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) {
    const err = new Error("Unauthorized (bad admin token)");
    err.statusCode = 401;
    throw err;
  }
}

function normalizeAssetCode(code){
  return String(code||"").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,12);
}

function pickHorizonExtras(e){
  const r = e?.response?.data;
  const extras = r?.extras;
  return {
    status: e?.response?.status,
    title: r?.title,
    detail: r?.detail,
    result_codes: extras?.result_codes,
    result_xdr: extras?.result_xdr,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try{
    requireAdmin(event);

    const body = JSON.parse(event.body || "{}");
    const assetCode = normalizeAssetCode(body.assetCode);
    const assetIssuer = String(body.assetIssuer || process.env.ISSUER_PUBLIC || "").trim();
    const shares = String(body.shares || "").trim(); // amount of pool shares to redeem
    const minPi = String(body.minPi || "0").trim();
    const minToken = String(body.minToken || "0").trim();

    if (!assetCode) throw new Error("Missing assetCode");
    if (!assetIssuer.startsWith("G")) throw new Error("Missing/invalid assetIssuer");
    if (!/^\d+(\.\d+)?$/.test(shares)) throw new Error("Invalid shares");

    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;
    if (!DISTRIBUTOR_SECRET) throw new Error("Missing DISTRIBUTOR_SECRET env");

    const server = new StellarSdk.Horizon.Server(HORIZON);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, assetIssuer);
    const pi = StellarSdk.Asset.native();

    // ⚠️ lexicographic order required for pools
    const [assetA, assetB] =
      (token.toString() < pi.toString()) ? [token, pi] : [pi, token];

    const acc = await server.loadAccount(distKP.publicKey());
    const fee = await server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(acc, {
      fee: String(fee),
      networkPassphrase: NETWORK_PASSPHRASE
    })
      .addOperation(StellarSdk.Operation.liquidityPoolWithdraw({
        liquidityPoolId: StellarSdk.getLiquidityPoolId("constant_product", assetA, assetB, 30),
        amount: shares,
        minAmountA: (assetA.isNative() ? minPi : minToken),
        minAmountB: (assetB.isNative() ? minPi : minToken),
      }))
      .setTimeout(180)
      .build();

    tx.sign(distKP);
    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        kind: "amm_withdraw",
        distributor: distKP.publicKey(),
        assetA: assetA.isNative() ? "PI(native)" : `${assetA.code}:${assetA.issuer}`,
        assetB: assetB.isNative() ? "PI(native)" : `${assetB.code}:${assetB.issuer}`,
        shares,
        minPi,
        minToken,
        hash: res.hash
      }),
    };
  }catch(e){
    const statusCode = e.statusCode || e?.response?.status || 500;
    return { statusCode, body: JSON.stringify({ error: e.message || String(e), horizon: pickHorizonExtras(e) }) };
  }
};
