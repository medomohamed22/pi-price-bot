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

    const { assetCode, amount, price, offerId } = JSON.parse(event.body || "{}");

    const code = normalizeAssetCode(assetCode);
    if (!code) throw new Error("Missing assetCode");
    if (!amount || isNaN(Number(amount))) throw new Error("Missing/invalid amount");
    if (!price || isNaN(Number(price))) throw new Error("Missing/invalid price");

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;
    if (!ISSUER_SECRET || !DISTRIBUTOR_SECRET) throw new Error("Missing ISSUER_SECRET/DISTRIBUTOR_SECRET env");

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const selling = new StellarSdk.Asset(code, issuerKP.publicKey()); // DONATEWAY
    const buying = StellarSdk.Asset.native(); // PI

    const server = new StellarSdk.Horizon.Server(HORIZON);
    const acc = await server.loadAccount(distKP.publicKey());
    const fee = await server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(acc, {
      fee: String(fee),
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.manageSellOffer({
          selling,
          buying,
          amount: String(amount),
          price: String(price), // PI per 1 Token
          offerId: String(offerId || "0"),
        })
      )
      .setTimeout(180)
      .build();

    tx.sign(distKP);

    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        kind: "sell_offer",
        distributor: distKP.publicKey(),
        selling: { code, issuer: issuerKP.publicKey() },
        buying: "PI",
        amount: String(amount),
        price: String(price),
        offerId: String(offerId || "0"),
        hash: res.hash,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
