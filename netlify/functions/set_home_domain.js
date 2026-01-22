const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event){
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try{
    requireAdmin(event);

    const { homeDomain } = JSON.parse(event.body || "{}");
    if (!homeDomain) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing homeDomain" }) };
    }

    // لازم يكون hostname بس (بدون https:// وبدون /)
    const clean = String(homeDomain)
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "");

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    if (!ISSUER_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing ISSUER_SECRET env" }) };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);
    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);

    const issuerAcc = await server.loadAccount(issuerKP.publicKey());
    const fee = await server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(issuerAcc, {
      fee,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(StellarSdk.Operation.setOptions({ homeDomain: clean }))
      .setTimeout(180)
      .build();

    tx.sign(issuerKP);
    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, issuer: issuerKP.publicKey(), homeDomain: clean, hash: res.hash })
    };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
