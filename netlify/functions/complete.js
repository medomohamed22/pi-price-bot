const { createClient } = require("@supabase/supabase-js");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}

function getSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_URL || "https://axjkwrssmofzavaoqutq.supabase.co";
  const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_tiuMncgWhf1YRWoD-uYQ3Q_ziI8OKci";
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}
exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  
  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId || !txid) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing paymentId or txid" }) };
    }
    
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "PI_SECRET_KEY not set" }) };
    
    // 1) Complete payment with Pi API
    const url = `https://api.minepi.com/v2/payments/${paymentId}/complete`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ txid })
    });
    
    const paymentDTO = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      return { statusCode: response.status, headers: cors(), body: JSON.stringify({ error: paymentDTO }) };
    }
    
    // 2) Safety: لازم تكون verified (الدوك بتحذر من اعتماد الدفع قبل complete success)
    const verified = !!paymentDTO?.transaction?.verified || !!paymentDTO?.status?.transaction_verified;
    if (!verified) {
      return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Transaction not verified by Pi Servers", paymentDTO }) };
    }
    
    // 3) Save donation to Supabase (donations table)
    const supabase = getSupabase();
    const donationRow = {
      pi_user_id: paymentDTO.Pioneer_uid || paymentDTO.pioneer_uid || paymentDTO.pioneer_uid?.toString(),
      username: (paymentDTO?.metadata?.username) || null,
      amount: Number(paymentDTO.amount || 0),
      payment_id: paymentDTO.identifier || paymentId,
      txid: paymentDTO?.transaction?.txid || txid,
      memo: paymentDTO.memo || null,
      metadata: paymentDTO.metadata || null,
      created_at: new Date().toISOString()
    };
    
    // Idempotent: لو نفس payment_id اتسجّل قبل كده ما يعيدش
    // لازم تعمل UNIQUE على payment_id في الجدول
    const { error: insErr } = await supabase
      .from("donations")
      .insert([donationRow]);
    
    // لو فشل بسبب duplicate، تجاهله
    if (insErr) {
      const msg = (insErr.message || "").toLowerCase();
      if (!msg.includes("duplicate") && !msg.includes("unique")) {
        return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "DB insert failed", details: insErr }) };
      }
    }
    
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ completed: true, paymentDTO }) };
    
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};
