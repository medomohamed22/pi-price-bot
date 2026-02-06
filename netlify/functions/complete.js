const { createClient } = require("@supabase/supabase-js");

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PI_BASE = "https://api.minepi.com/v2";

function json(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return json(200, {});
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });
  
  try {
    if (!PI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { error: "Missing env vars (PI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    }
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId || !txid) return json(400, { error: "Missing paymentId/txid" });
    
    // 1) Complete with Pi
    const completeRes = await fetch(`${PI_BASE}/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid }),
    });
    
    const completeText = await completeRes.text();
    if (!completeRes.ok) {
      return json(completeRes.status, { error: "Pi complete failed", details: completeText });
    }
    
    // 2) Update DB
    const { error: upErr } = await supabase
      .from("payments")
      .update({ status: "completed", txid })
      .eq("payment_id", paymentId);
    
    if (upErr) return json(500, { error: "Supabase update failed", details: upErr.message });
    
    return json(200, { ok: true, message: "Completed", paymentId, txid });
  } catch (e) {
    console.error("complete error:", e);
    return json(500, { error: e.message || "Server error" });
  }
};
