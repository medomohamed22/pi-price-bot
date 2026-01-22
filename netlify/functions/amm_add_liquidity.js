const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

// Stellar canonical ordering: native before credit, then code, then issuer
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

// Normalize fee for liquidity pools (should be 30 for constant product)
function normalizePoolFee(StellarSdk) {
  // safest: always 30
  // بعض النسخ بتوفر LiquidityPoolFeeV18 بأشكال مختلفة
  const cand = StellarSdk?.LiquidityPoolFeeV18;

  if (typeof cand === "number" && Number.isFinite(cand)) return cand;
  if (typeof cand === "string" && cand.trim()) {
    const n = Number(cand.trim());
    if (Number.isFinite(n)) return n;
  }
  if (cand && typeof cand === "object" && typeof cand.fee === "number") return cand.fee;

  return 30;
}

// Create LiquidityPoolAsset in a version-compatible way
function createPoolAssetCompat(StellarSdk, assetA, assetB, fee) {
  // 1) Most common: new LiquidityPoolAsset(assetA, assetB, feeNumber)
  try {
    return new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);
  } catch (e1) {
    // 2) Some versions might expect fee constant
    try {
      return new StellarSdk.LiquidityPoolAsset(assetA, assetB, StellarSdk.LiquidityPoolFeeV18);
    } catch (e2) {
      // 3) Some versions may use object form (rare)
      try {
        return new StellarSdk.LiquidityPoolAsset(assetA, assetB, { fee });
      } catch (e3) {
        const msg =
          `Failed to create LiquidityPoolAsset (SDK mismatch). ` +
          `e1=${e1?.message || e1}, e2=${e2?.message || e2}, e3=${e3?.message || e3}`;
        throw new Error(msg);
      }
    }
  }
}

// Extract poolId in a version-compatible way
function getPoolIdCompat({ StellarSdk, poolAsset, assetA, assetB, fee }) {
  let poolId = null;

  if (poolAsset && typeof poolAsset.getLiquidityPoolId === "function") {
    poolId = poolAsset.getLiquidityPoolId();
  }

  if (!poolId && poolAsset && poolAsset.liquidityPoolId) {
    poolId = poolAsset.liquidityPoolId;
  }

  if (!poolId && typeof StellarSdk.getLiquidityPoolId === "function") {
    poolId = StellarSdk.getLiquidityPoolId(assetA, assetB, fee);
  }

  return poolId;
}

// Pool share asset trustline (version-compatible)
function getPoolShareAssetCompat({ StellarSdk, poolId }) {
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

    // Debug info in Netlify logs
    console.log("stellar-sdk keys:", Object.keys(StellarSdk));
    console.log("LiquidityPoolAsset exists:", typeof StellarSdk.LiquidityPoolAsset === "function");
    console.log("liquidityPoolDeposit exists:", typeof StellarSdk.Operation?.liquidityPoolDeposit === "function");

    if (typeof StellarSdk.LiquidityPoolAsset !== "function" || typeof StellarSdk.Operation?.liquidityPoolDeposit !== "function") {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "AMM is not supported by this stellar-sdk build",
          hint: "Update stellar-sdk in package.json then Clear cache and deploy"
        })
      };
    }

    const server = new StellarSdk.Horizon.Server(HORIZON);

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, issuerKP.publicKey());
    const pi = StellarSdk.Asset.native();

    // ✅ Lexicographic ordering + bind amounts to the same order
    const pairs = [
      { asset: token, amount: String(tokenAmount) },
      { asset: pi, amount: String(piAmount) },
    ].sort((x, y) => assetKey(x.asset).localeCompare(assetKey(y.asset)));

    const assetA = pairs[0].asset;
    const assetB = pairs[1].asset;
    const maxAmountA = pairs[0].amount;
    const maxAmountB = pairs[1].amount;

    // ✅ Force/normalize pool fee (constant product)
    const fee = normalizePoolFee(StellarSdk); // غالبًا 30
    console.log("Pool fee used:", fee, "typeof:", typeof fee);

    // ✅ Create pool asset compat (this is where 'liquidityPoolType invalid' often originates)
    const poolAsset = createPoolAssetCompat(StellarSdk, assetA, assetB, fee);

    // ✅ Get poolId compat
    const poolId = getPoolIdCompat({ StellarSdk, poolAsset, assetA, assetB, fee });
    if (!poolId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Could not determine liquidityPoolId with this stellar-sdk version",
          hint: "Update stellar-sdk then Clear cache and deploy",
          assetA: assetLabel(assetA),
          assetB: assetLabel(assetB),
          fee
        })
      };
    }

    const poolShare = getPoolShareAssetCompat({ StellarSdk, poolId });
    if (!poolShare) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "LiquidityPoolShareAsset not supported by this stellar-sdk version",
          hint: "Update stellar-sdk then Clear cache and deploy",
          poolId
        })
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

    // Trustline to pool shares (if needed)
    if (!hasPoolShare) {
      txb.addOperation(StellarSdk.Operation.changeTrust({ asset: poolShare }));
    }

    // Wide guards by default
    const minP = (minPrice && String(minPrice)) || "0.000001";
    const maxP = (maxPrice && String(maxPrice)) || "1000000";

    // Deposit liquidity
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
      })
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
