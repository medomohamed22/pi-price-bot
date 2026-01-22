const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

// canonical ordering: native first, then code, then issuer
function assetKey(a) {
  try {
    if (a?.isNative && a.isNative()) return "0|NATIVE||";
  } catch {}
  const code = a?.getCode ? a.getCode() : a?.code;
  const issuer = a?.getIssuer ? a.getIssuer() : a?.issuer;
  return `1|${code || ""}|${issuer || ""}|`;
}

function assetLabel(a) {
  try {
    if (a?.isNative && a.isNative()) return "PI(native)";
  } catch {}
  const code = a?.getCode ? a.getCode() : a?.code;
  const issuer = a?.getIssuer ? a.getIssuer() : a?.issuer;
  return `${code}:${issuer}`;
}

function computePoolId(StellarSdk, assetA, assetB, fee) {
  // preferred signature: getLiquidityPoolId("constant_product", {assetA, assetB, fee})
  if (typeof StellarSdk.getLiquidityPoolId === "function") {
    return StellarSdk.getLiquidityPoolId("constant_product", { assetA, assetB, fee });
  }
  // fallback: some builds provide method on LiquidityPoolAsset (rare)
  if (typeof StellarSdk.LiquidityPoolAsset === "function") {
    const lp = new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);
    if (typeof lp.getLiquidityPoolId === "function") return lp.getLiquidityPoolId();
    if (lp.liquidityPoolId) return lp.liquidityPoolId;
  }
  throw new Error("Cannot compute poolId (missing getLiquidityPoolId). Update stellar-sdk.");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "Method Not Allowed" };

  try {
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

    if (typeof StellarSdk.LiquidityPoolAsset !== "function") {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "LiquidityPoolAsset not supported by this stellar-sdk build",
          hint: "Update stellar-sdk",
        }),
      };
    }

    if (!StellarSdk.Operation || typeof StellarSdk.Operation.liquidityPoolDeposit !== "function") {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "liquidityPoolDeposit not supported by this stellar-sdk build",
          hint: "Update stellar-sdk",
        }),
      };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, issuerKP.publicKey());
    const pi = StellarSdk.Asset.native();

    // ✅ Sort assets + bind amounts to A/B order
    const pairs = [
      { asset: token, amount: String(tokenAmount) },
      { asset: pi, amount: String(piAmount) },
    ].sort((x, y) => assetKey(x.asset).localeCompare(assetKey(y.asset)));

    const assetA = pairs[0].asset;
    const assetB = pairs[1].asset;
    const maxAmountA = pairs[0].amount;
    const maxAmountB = pairs[1].amount;

    // ✅ constant product fee is always 30 (bp) 1
    const fee = 30;

    // ✅ This asset represents "liquidity_pool_shares" trustline 2
    const poolAsset = new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);

    // ✅ poolId (constant_product)
    const poolId = computePoolId(StellarSdk, assetA, assetB, fee);

    const account = await server.loadAccount(distKP.publicKey());
    const baseFee = await server.fetchBaseFee();

    const hasPoolTrust = account.balances?.some(
      (b) => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id === poolId
    );

    const txb = new StellarSdk.TransactionBuilder(account, {
      fee: baseFee,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // ✅ Trustline to pool shares (using LiquidityPoolAsset)
    if (!hasPoolTrust) {
      txb.addOperation(
        StellarSdk.Operation.changeTrust({
          asset: poolAsset,
        })
      );
    }

    const minP = (minPrice && String(minPrice)) || "0.000001";
    const maxP = (maxPrice && String(maxPrice)) || "1000000";

    txb.addOperation(
      StellarSdk.Operation.liquidityPoolDeposit({
        liquidityPoolId: poolId,
        maxAmountA,
        maxAmountB,
        minPrice: minP,
        maxPrice: maxP,
      })
    );

    const tx = txb.setTimeout(180).build();
    tx.sign(distKP);

    const res = await server.submitTransaction(tx);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        poolId,
        assetA: assetLabel(assetA),
        assetB: assetLabel(assetB),
        maxAmountA,
        maxAmountB,
        fee,
        hash: res.hash,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
