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

    const body = JSON.parse(event.body || "{}");
    const assetCode = normalizeAssetCode(body.assetCode);

    if (!assetCode) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing assetCode" }) };
    }

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;

    if (!ISSUER_SECRET || !DISTRIBUTOR_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing ISSUER_SECRET/DISTRIBUTOR_SECRET env" }),
      };
    }

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const server = new StellarSdk.Horizon.Server(HORIZON);

    // Load distributor account
    const acc = await server.loadAccount(distKP.publicKey());

    // Check if trustline already exists
    const already = (acc.balances || []).some(
      (b) => b.asset_code === assetCode && b.asset_issuer === issuerKP.publicKey()
    );

    if (already) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          alreadyTrusted: true,
          distributor: distKP.publicKey(),
          asset: { code: assetCode, issuer: issuerKP.publicKey() },
        }),
      };
    }

    const fee = await server.fetchBaseFee();
    const asset = new StellarSdk.Asset(assetCode, issuerKP.publicKey());

    // Optional: trust limit
    // لو عايز تحدد حد أقصى للتوكنات اللي الحساب يقدر يمسكها
    const limit = body.limit ? String(body.limit) : undefined;

    const tx = new StellarSdk.TransactionBuilder(acc, {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        StellarSdk.Operation.changeTrust({
          asset,
          ...(limit ? { limit } : {}),
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
        alreadyTrusted: false,
        distributor: distKP.publicKey(),
        asset: { code: assetCode, issuer: issuerKP.publicKey() },
        hash: res.hash,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
