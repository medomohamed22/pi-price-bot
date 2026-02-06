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
    
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return json(400, { error: "Missing paymentId" });
    
    // 1) Get payment from Pi (عشان نعرف metadata والمبلغ والـ user)
    const getRes = await fetch(`${PI_BASE}/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_API_KEY}` },
    });
    const getText = await getRes.text();
    if (!getRes.ok) {
      return json(getRes.status, { error: "Pi get payment failed", details: getText });
    }
    const payment = JSON.parse(getText);
    
    // 2) Approve payment
    const approveRes = await fetch(`${PI_BASE}/payments/${paymentId}/approve`, {
      method: "POST",
      headers: { Authorization: `Key ${PI_API_KEY}` },
    });
    const approveText = await approveRes.text();
    if (!approveRes.ok) {
      return json(approveRes.status, { error: "Pi approve failed", details: approveText });
    }
    
    // 3) Save to DB (جدول payments)
    // توقع metadata من الفرونت: { cycleId, month }
    const cycleId = payment?.metadata?.cycleId ?? payment?.metadata?.cycle_id ?? null;
    const month = payment?.metadata?.month ?? null;
    const pi_uid = payment?.user_uid ?? null;
    
    // لو جدول payments عندك أعمدته مختلفة، عدّل أسماء الأعمدة هنا
    const insertPayload = {
      payment_id: paymentId,
      pi_uid,
      cycle_id: cycleId,
      month,
      amount_pi: payment?.amount ?? null,
      memo: payment?.memo ?? null,
      status: "approved",
      raw_json: payment,
    };
    
    const { error: insErr } = await supabase.from("payments").insert(insertPayload);
    // لو عندك unique على payment_id، ممكن يبقى already inserted — تجاهلها
    if (insErr && !String(insErr.message || "").toLowerCase().includes("duplicate")) {
      return json(500, { error: "Supabase insert failed", details: insErr.message });
    }
    
    return json(200, { ok: true, message: "Approved", paymentId });
  } catch (e) {
    console.error("approve error:", e);
    return json(500, { error: e.message || "Server error" });
  }
};
