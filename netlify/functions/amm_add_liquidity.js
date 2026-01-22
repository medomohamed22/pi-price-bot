const StellarSdk = require("stellar-sdk");

const HORIZON = "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = "Pi Testnet";

function requireAdmin(event) {
  const need = process.env.ADMIN_TOKEN;
  if (!need) return;
  const got = event.headers["x-admin-token"] || event.headers["X-Admin-Token"];
  if (got !== need) throw new Error("Unauthorized (bad admin token)");
}

// ترتيب أصول Stellar canonical: native قبل credit، ثم code، ثم issuer
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

// استخراج poolId بشكل متوافق مع اختلاف نسخ stellar-sdk
function getPoolIdCompat({ StellarSdk, poolAsset, assetA, assetB, fee }) {
  let poolId = null;

  // بعض النسخ فيها getLiquidityPoolId()
  if (poolAsset && typeof poolAsset.getLiquidityPoolId === "function") {
    poolId = poolAsset.getLiquidityPoolId();
  }

  // بعض النسخ فيها liquidityPoolId property
  if (!poolId && poolAsset && poolAsset.liquidityPoolId) {
    poolId = poolAsset.liquidityPoolId;
  }

  // بعض النسخ فيها helper عام
  if (!poolId && typeof StellarSdk.getLiquidityPoolId === "function") {
    poolId = StellarSdk.getLiquidityPoolId(assetA, assetB, fee);
  }

  return poolId;
}

// إنشاء Pool Share Asset بشكل متوافق
function getPoolShareAssetCompat({ StellarSdk, poolId }) {
  // newer: LiquidityPoolShareAsset
  if (typeof StellarSdk.LiquidityPoolShareAsset === "function") {
    return new StellarSdk.LiquidityPoolShareAsset(poolId);
  }

  // older alt: Asset.liquidityPoolShare
  if (StellarSdk.Asset && typeof StellarSdk.Asset.liquidityPoolShare === "function") {
    return StellarSdk.Asset.liquidityPoolShare(poolId);
  }

  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST")
    return { statusCode: 405, body: "Method Not Allowed" };

  try {
    requireAdmin(event);

    const body = JSON.parse(event.body || "{}");
    const assetCode = body.assetCode;
    const tokenAmount = body.tokenAmount;
    const piAmount = body.piAmount;
    const minPrice = body.minPrice;
    const maxPrice = body.maxPrice;

    if (!assetCode || !tokenAmount || !piAmount) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing assetCode/tokenAmount/piAmount" }),
      };
    }

    const ISSUER_SECRET = process.env.ISSUER_SECRET;
    const DISTRIBUTOR_SECRET = process.env.DISTRIBUTOR_SECRET;

    if (!ISSUER_SECRET || !DISTRIBUTOR_SECRET) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing ISSUER_SECRET/DISTRIBUTOR_SECRET env" }),
      };
    }

    // تشخيص سريع (تشوفه في Netlify function logs)
    console.log("stellar-sdk available keys:", Object.keys(StellarSdk));

    const server = new StellarSdk.Horizon.Server(HORIZON);

    const issuerKP = StellarSdk.Keypair.fromSecret(ISSUER_SECRET);
    const distKP = StellarSdk.Keypair.fromSecret(DISTRIBUTOR_SECRET);

    const token = new StellarSdk.Asset(assetCode, issuerKP.publicKey());
    const pi = StellarSdk.Asset.native();

    // نتأكد أن النسخة داعمة لـ AMM ops
    const hasLPAsset = typeof StellarSdk.LiquidityPoolAsset === "function";
    const hasLPDeposit = StellarSdk.Operation && typeof StellarSdk.Operation.liquidityPoolDeposit === "function";

    if (!hasLPAsset || !hasLPDeposit) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "AMM is not supported by this stellar-sdk build",
          hint: "Update stellar-sdk in package.json then Clear cache and deploy",
          hasLiquidityPoolAsset: hasLPAsset,
          hasLiquidityPoolDeposit: hasLPDeposit,
        }),
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

    // fee 30 bps (standard)
    const fee = StellarSdk.LiquidityPoolFeeV18 || 30;

    // إنشاء pool asset
    const poolAsset = new StellarSdk.LiquidityPoolAsset(assetA, assetB, fee);

    // ✅ Get poolId compat
    const poolId = getPoolIdCompat({ StellarSdk, poolAsset, assetA, assetB, fee });
    if (!poolId) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Could not determine liquidityPoolId with this stellar-sdk version",
          hint: "Update stellar-sdk to a newer version (recommended)",
          assetA: assetLabel(assetA),
          assetB: assetLabel(assetB),
        }),
      };
    }

    // ✅ Pool share asset trustline compat
    const poolShare = getPoolShareAssetCompat({ StellarSdk, poolId });
    if (!poolShare) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Liquidity pool share asset is not supported by this stellar-sdk version",
          hint: "Update stellar-sdk to a newer version (recommended)",
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

    if (!hasPoolShare) {
      txb.addOperation(StellarSdk.Operation.changeTrust({ asset: poolShare }));
    }

    // حماية سعرية واسعة افتراضيًا
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
        hash: res.hash,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || String(e) }) };
  }
};
