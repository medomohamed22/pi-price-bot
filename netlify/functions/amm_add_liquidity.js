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

function normalizeFee(StellarSdk) {
  // safest: always 30bp for constant product pools
  const cand = StellarSdk?.LiquidityPoolFeeV18;
  if (typeof cand === "number" && Number.isFinite(cand)) return cand;
  return 30;
}

// ✅ get poolId in a version-safe way (fixes liquidityPoolType invalid)
function getPoolIdSafe(StellarSdk, assetA, assetB, fee) {
  // 1) Newer style helper (js-stellar-base style):
  // getLiquidityPoolId("constant_product", {assetA, assetB, fee})
  if (typeof StellarSdk.getLiquidityPoolId === "function") {
    try {
      return StellarSdk.getLiquidityPoolId("constant_product", { assetA, assetB, fee });
    } catch (e1) {
      // 2) Some older wrappers may accept different order; try fallback
      try {
        return StellarSdk.getLiquidityPoolId(assetA, assetB, fee);
      } catch (e2) {
        throw new Error(
          `getLiquidityPoolId failed. e1=${e1?.message || e1} | e2=${e2?.message || e2}`
        );
      }
    }
  }

  // 3) If LiquidityPoolAsset exists with getLiquidityPoolId()
  if (typeof StellarSdk.LiquidityPoolAsset === "function") {
    try {
      const lp = new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);
      if (typeof lp.getLiquidityPoolId === "function") return lp.getLiquidityPoolId();
      if (lp.liquidityPoolId) return lp.liquidityPoolId;
    } catch (e3) {
      throw new Error(`LiquidityPoolAsset failed: ${e3?.message || e3}`);
    }
  }

  throw new Error("No supported method to compute liquidityPoolId. Update stellar-sdk.");
}

function getPoolShareAssetCompat(StellarSdk, poolId) {
  if (typeof StellarSdk.LiquidityPoolShareAsset === "function") {
    return new StellarSdk.LiquidityPoolShareAsset(poolId);
  }
  if (StellarSdk.Asset && typeof StellarSdk.Asset.liquidityPoolShare === "function") {
    return StellarSdk.Asset.liquidityPoolShare(poolId);
  }
  return null;
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

    // required ops
    if (!StellarSdk.Operation || typeof StellarSdk.Operation.liquidityPoolDeposit !== "function") {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "stellar-sdk build doesn't support liquidityPoolDeposit",
          hint: "Update stellar-sdk then Clear cache and deploy",
        }),
      };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, issuerKP.publicKey());
    const pi = StellarSdk.Asset.native();

    // ✅ Sort assets + match amounts to A/B order
    const pairs = [
      { asset: token, amount: String(tokenAmount) },
      { asset: pi, amount: String(piAmount) },
    ].sort((x, y) => assetKey(x.asset).localeCompare(assetKey(y.asset)));

    const assetA = pairs[0].asset;
    const assetB = pairs[1].asset;
    const maxAmountA = pairs[0].amount;
    const maxAmountB = pairs[1].amount;

    const fee = normalizeFee(StellarSdk); // should be 30
    const poolId = getPoolIdSafe(StellarSdk, assetA, assetB, fee);

    const poolShare = getPoolShareAssetCompat(StellarSdk, poolId);
    if (!poolShare) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "LiquidityPoolShareAsset not supported by this stellar-sdk build",
          hint: "Update stellar-sdk then Clear cache and deploy",
          poolId,
        }),
      };
    }

    const account = await server.loadAccount(distKP.publicKey());
    const baseFee = await server.fetchBaseFee();

    const hasPoolShare = account.balances?.some(
      (b) => b.asset_type === "liquidity_pool_shares" && b.liquidity_pool_id === poolId
    );

    const txb = new StellarSdk.TransactionBuilder(account, {
      fee: baseFee,
      networkPassphrase: NETWORK_PASSPHRASE,
    });

    // Trustline for pool shares (if needed)
    if (!hasPoolShare) {
      txb.addOperation(StellarSdk.Operation.changeTrust({ asset: poolShare }));
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
