const { createClient } = require("@supabase/supabase-js");

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PI_BASE = "https://api.minepi.com/v2";

function res(statusCode, bodyObj) {
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

async function piFetch(path, opts = {}) {
  const r = await fetch(`${PI_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Key ${PI_API_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: r.ok, status: r.status, text, json };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(200, {});
  if (event.httpMethod !== "POST") return res(405, { error: "Method Not Allowed" });

  try {
    if (!PI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res(500, { error: "Missing configuration" });
    }

    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId || !txid) return res(400, { error: "Missing paymentId or txid" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. إخبار Pi باكتمال العملية (Server-Side Completion)
    const comp = await piFetch(`/payments/${paymentId}/complete`, {
      method: "POST",
      body: JSON.stringify({ txid }),
    });

    // ملاحظة: حتى لو ردت Pi بخطأ (مثلاً العملية اكتملت بالفعل)، 
    // يجب أن نحاول تحديث قاعدة البيانات الخاصة بنا لضمان تطابق البيانات.
    if (!comp.ok) {
      console.warn("Pi complete warning:", comp.status, comp.text);
    }

    // 2. تحديث حالة الدفع في قاعدة البيانات إلى 'confirmed'
    // الجدول في SQL لا يحتوي على عمود txid، لذا سنحدث الحالة فقط.
    // إذا أضفت عمود txid في قاعدة البيانات لاحقاً، يمكنك إضافته هنا: { status: 'confirmed', txid: txid }
    const { error: dbError } = await supabase
      .from("payments")
      .update({ status: "confirmed" })
      .eq("payment_id", paymentId);

    if (dbError) {
      console.error("DB Update Error:", dbError);
      return res(500, { error: "Failed to update database", details: dbError.message });
    }

    return res(200, { ok: true, message: "Payment completed and recorded", paymentId });

  } catch (e) {
    console.error("Complete Function Error:", e);
    return res(500, { error: e.message || "Server Error" });
  }
};
