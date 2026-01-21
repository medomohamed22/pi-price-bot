const StellarSdk = require("stellar-sdk");
const { createClient } = require("@supabase/supabase-js");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}

function getSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_URL || "https://xncapmzlwuisupkjlftb.supabase.co";
  const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS";
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Pi Testnet (زي كودك)
const PI_HORIZON_URL = process.env.PI_HORIZON_URL || "https://api.testnet.minepi.com";
const NETWORK_PASSPHRASE = process.env.PI_NETWORK_PASSPHRASE || "Pi Testnet";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  
  try {
    const { uid, username, amount, walletAddress } = JSON.parse(event.body || "{}");
    const withdrawAmount = parseFloat(amount);
    
    if (!uid || !walletAddress || !Number.isFinite(withdrawAmount) || withdrawAmount <= 0) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "بيانات ناقصة أو مبلغ غير صحيح" }) };
    }
    
    const APP_WALLET_SECRET = process.env.APP_WALLET_SECRET;
    if (!APP_WALLET_SECRET) {
      return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "APP_WALLET_SECRET not set" }) };
    }
    
    const supabase = getSupabase();
    
    // 1) حساب رصيد المستخدم من DB
    const { data: donations, error: dErr } = await supabase
      .from("donations").select("amount").eq("pi_user_id", uid);
    if (dErr) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: dErr }) };
    
    const { data: withdrawals, error: wErr } = await supabase
      .from("withdrawals").select("amount").eq("pi_user_id", uid);
    if (wErr) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: wErr }) };
    
    const totalDonated = (donations || []).reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    const totalWithdrawn = (withdrawals || []).reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
    const currentBalance = totalDonated - totalWithdrawn;
    
    if (currentBalance < withdrawAmount) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "رصيد حسابك غير كافٍ" }) };
    }
    
    // 2) إرسال تحويل على Testnet
    const server = new StellarSdk.Horizon.Server(PI_HORIZON_URL);
    const sourceKeys = StellarSdk.Keypair.fromSecret(APP_WALLET_SECRET);
    const sourceAccount = await server.loadAccount(sourceKeys.publicKey());
    
    const fee = process.env.STELLAR_FEE || "100000"; // زي تعديلك لتفادي tx_insufficient_fee
    const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
      .addOperation(StellarSdk.Operation.payment({
        destination: walletAddress,
        asset: StellarSdk.Asset.native(),
        amount: withdrawAmount.toFixed(7).toString(),
      }))
      .setTimeout(30)
      .build();
    
    tx.sign(sourceKeys);
    const result = await server.submitTransaction(tx);
    
    // 3) تسجيل السحب
    const { error: insErr } = await supabase
      .from("withdrawals")
      .insert([{
        pi_user_id: uid,
        username: username || null,
        amount: withdrawAmount,
        wallet_address: walletAddress,
        txid: result.hash,
        created_at: new Date().toISOString()
      }]);
    
    if (insErr) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "DB insert failed", details: insErr }) };
    
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ success: true, txid: result.hash, message: "تم التحويل بنجاح" }) };
    
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "فشلت المعاملة", details: err.message }) };
  }
};
