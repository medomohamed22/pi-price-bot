const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event){
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

// ترتيب أصول Stellar canonical: native قبل credit، ثم code، ثم issuer
function assetKey(a){
  if (a.isNative && a.isNative()) return "0|NATIVE||";
  // credit asset:
  const code = a.getCode ? a.getCode() : a.code;
  const issuer = a.getIssuer ? a.getIssuer() : a.issuer;
  // نوع alphanum4/alphanum12 مش ضروري هنا غالبًا، بس نخليه ثابت
  return `1|${code}|${issuer}|`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try{
    requireAdmin(event);

    const { assetCode, tokenAmount, piAmount, minPrice, maxPrice } = JSON.parse(event.body || "{}");
    if (!assetCode || !tokenAmount || !piAmount) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing assetCode/tokenAmount/piAmount" }) };
    }

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;
    if (!ISSUER_SECRET || !DISTRIBUTOR_SECRET) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing ISSUER_SECRET/DISTRIBUTOR_SECRET env" }) };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, issuerKP.publicKey());
    const pi = StellarSdk.Asset.native();

    if (!StellarSdk.LiquidityPoolAsset || !StellarSdk.Operation.liquidityPoolDeposit) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "AMM not supported by stellar-sdk on this build",
          hint: "Update stellar-sdk"
        })
      };
    }

    // ✅ رتّب الأصول + رتّب الكميات معاهم
    const pairs = [
      { asset: token, amount: String(tokenAmount) },
      { asset: pi, amount: String(piAmount) },
    ].sort((x, y) => assetKey(x.asset).localeCompare(assetKey(y.asset)));

    const assetA = pairs[0].asset;
    const assetB = pairs[1].asset;
    const maxAmountA = pairs[0].amount;
    const maxAmountB = pairs[1].amount;

    // fee 30 bps
    const fee = StellarSdk.LiquidityPoolFeeV18 || 30;
    const poolAsset = new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);

    const poolId = poolAsset.getLiquidityPoolId();
    const poolShare = new StellarSdk.LiquidityPoolShareAsset(poolId);

    const account = await server.loadAccount(distKP.publicKey());
    const baseFee = await server.fetchBaseFee();

    const hasPoolShare = account.balances?.some(
      b => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id === poolId
    );

    const txb = new StellarSdk.TransactionBuilder(account, {
      fee: baseFee,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    if (!hasPoolShare) {
      txb.addOperation(StellarSdk.Operation.changeTrust({ asset: poolShare }));
    }

    // خلي الجارد واسع عشان ما يوقفش بسبب اختلاف ترتيب/نسبة
    const minP = (minPrice && String(minPrice)) || "0.000001";
    const maxP = (maxPrice && String(maxPrice)) || "1000000";

    txb.addOperation(StellarSdk.Operation.liquidityPoolDeposit({
      liquidityPoolId: poolId,
      maxAmountA,
      maxAmountB,
      minPrice: minP,
      maxPrice: maxP,
    }));

    const tx = txb.setTimeout(180).build();
    tx.sign(distKP);

    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        poolId,
        assetA: assetA.isNative && assetA.isNative() ? "PI(native)" : `${assetA.getCode()}:${assetA.getIssuer()}`,
        assetB: assetB.isNative && assetB.isNative() ? "PI(native)" : `${assetB.getCode()}:${assetB.getIssuer()}`,
        maxAmountA,
        maxAmountB,
        hash: res.hash
      })
    };

  }catch(e){
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
