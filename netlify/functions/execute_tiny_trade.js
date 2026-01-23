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
    const assetIssuer = String(body.assetIssuer || "").trim();
    const destination = String(body.destination || "").trim();
    const sendPiAmount = String(body.sendPiAmount || "").trim();
    const destMinTokenOut = String(body.destMinTokenOut || "0.0000001").trim();
    const memo = String(body.memo || "DW tiny trade").trim();

    if (!assetCode) throw new Error("Missing assetCode");
    if (!assetIssuer.startsWith("G")) throw new Error("Invalid assetIssuer");
    if (!destination.startsWith("G")) throw new Error("Invalid destination");
    if (!/^\d+(\.\d+)?$/.test(sendPiAmount)) throw new Error("Invalid sendPiAmount");

    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;
    if (!DISTRIBUTOR_SECRET) throw new Error("Missing DISTRIBUTOR_SECRET env");

    const server = new StellarSdk.Horizon.Server(HORIZON);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    // destination must trust token — otherwise tx fails (op_no_trust)
    // We'll still try, but error will show clearly.

    const sendAsset = StellarSdk.Asset.native();
    const destAsset = new StellarSdk.Asset(assetCode, assetIssuer);

    // 1) Find strict send paths
    const paths = await server
      .strictSendPaths(sendAsset, sendPiAmount, [destAsset])
      .call();

    const best = paths?._embedded?.records?.[0];
    if (!best){
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "No path found from PI to token (orderbook/amm).",
          hint: "اعمل AMM أو خلي في عروض بيع/شراء بنفس الزوج",
          asset: { assetCode, assetIssuer },
        }),
      };
    }

    const sourceAcc = await server.loadAccount(distKP.publicKey());
    const fee = await server.fetchBaseFee();

    const txb = new StellarSdk.TransactionBuilder(sourceAcc, {
      fee: String(fee),
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Optional memo
    if (memo) txb.addMemo(StellarSdk.Memo.text(memo.slice(0, 28)));

    txb.addOperation(
      StellarSdk.Operation.pathPaymentStrictSend({
        sendAsset,
        sendAmount: sendPiAmount,
        destination,
        destAsset,
        destMin: destMinTokenOut,
        path: (best.path || []).map(p => {
          if (p.asset_type === "native") return StellarSdk.Asset.native();
          return new StellarSdk.Asset(p.asset_code, p.asset_issuer);
        }),
      })
    );

    const tx = txb.setTimeout(180).build();
    tx.sign(distKP);

    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        kind: "tiny_trade",
        distributor: distKP.publicKey(),
        destination,
        sendPiAmount,
        destMinTokenOut,
        asset: `${assetCode}:${assetIssuer}`,
        used_path: best.path || [],
        hash: res.hash,
      }),
    };
  }catch(e){
    const statusCode = e.statusCode || e?.response?.status || 500;
    return {
      statusCode,
      body: JSON.stringify({
        error: e.message || String(e),
        horizon: pickHorizonExtras(e),
      }),
    };
  }
};
