const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";

function requireAdmin(event){
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

exports.handler = async (event) => {
  try{
    requireAdmin(event);

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    if (!ISSUER_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing ISSUER_SECRET env" }) };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);
    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);

    const acc = await server.loadAccount(issuerKP.publicKey());

    // Stellar account fields: home_domain غالبًا موجودة هنا
    const homeDomain = acc.home_domain || acc.homeDomain || null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        issuer: issuerKP.publicKey(),
        home_domain: homeDomain,
        raw_has_home_domain_field: Boolean(acc.home_domain || acc.homeDomain)
      })
    };
  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
