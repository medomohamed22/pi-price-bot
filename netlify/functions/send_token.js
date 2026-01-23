const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

function normalizeAssetCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
    requireAdmin(event);

    const { to, assetCode, amount, memo } = JSON.parse(event.body || "{}");

    const code = normalizeAssetCode(assetCode);
    if (!to || !to.startsWith("G")) throw new Error("Missing/invalid 'to' public key (must start with G)");
    if (!code) throw new Error("Missing assetCode");
    if (!amount || isNaN(Number(amount))) throw new Error("Missing/invalid amount");

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;
    if (!ISSUER_SECRET || !DISTRIBUTOR_SECRET) throw new Error("Missing ISSUER_SECRET/DISTRIBUTOR_SECRET env");

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const server = new StellarSdk.Horizon.Server(HORIZON);

    // تأكد إن المستلم موجود على الشبكة
    const destAcc = await server.loadAccount(to);

    // ✅ تأكد إن المستلم عامل trustline للتوكن
    const hasTrust = (destAcc.balances || []).some(
      (b) => b.asset_code === code && b.asset_issuer === issuerKP.publicKey()
    );
    if (!hasTrust) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Destination has no trustline for this asset",
          hint: "اعمل trustline للتوكن على محفظتك الأول، وبعدها ابعت تاني",
          to,
          asset: { code, issuer: issuerKP.publicKey() },
        }),
      };
    }

    const asset = new StellarSdk.Asset(code, issuerKP.publicKey());

    const distAcc = await server.loadAccount(distKP.publicKey());
    const fee = await server.fetchBaseFee();

    const txb = new StellarSdk.TransactionBuilder(distAcc, {
      fee: String(fee),
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    if (memo) txb.addMemo(StellarSdk.Memo.text(String(memo).slice(0, 28)));

    txb.addOperation(
      StellarSdk.Operation.payment({
        destination: to,
        asset,
        amount: String(amount),
      })
    );

    const tx = txb.setTimeout(180).build();
    tx.sign(distKP);

    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        from: distKP.publicKey(),
        to,
        asset: { code, issuer: issuerKP.publicKey() },
        amount: String(amount),
        hash: res.hash,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
