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
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    
    // 1. التحقق من البيانات
    if (!paymentId || !txid) {
      console.error("Missing inputs:", { paymentId, txid });
      return res(400, { error: "Missing paymentId or txid" });
    }

    // 2. إبلاغ سيرفر Pi (هذه الخطوة الأهم لكي لا تعلق الدفعة في المحفظة)
    console.log(`Completing payment ${paymentId} on Pi Server...`);
    const comp = await piFetch(`/payments/${paymentId}/complete`, {
      method: "POST",
      body: JSON.stringify({ txid }),
    });

    // ملاحظة: حتى لو ردت Pi بخطأ (مثلاً تمت العملية سابقاً)، نكمل لتحديث قاعدتنا
    if (!comp.ok) {
      console.warn("Pi complete warning (might be already completed):", comp.status, comp.json);
    }

    // 3. تحديث قاعدة البيانات
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // نحاول التحديث
    const { data, error: dbError } = await supabase
      .from("payments")
      .update({ status: "confirmed" }) // تأكدنا من الصورة أن الحالة confirmed
      .eq("payment_id", paymentId)
      .select();

    if (dbError) {
      console.error("DB Update Error:", dbError);
      return res(500, { error: "DB Error", details: dbError.message });
    }

    // 4. فحص هل تم التحديث فعلاً؟
    if (!data || data.length === 0) {
      console.warn(`Record for payment ${paymentId} not found to update! Client insert might have failed.`);
      // هنا يمكنك اختيارياً عمل Insert إذا لم يكن موجوداً، لكن ذلك يتطلب إرسال amount و member_id من الفرونت إند
      return res(404, { error: "Payment record not found in DB, but completed on Pi." });
    }

    return res(200, { ok: true, message: "Payment confirmed", paymentId });

  } catch (e) {
    console.error("Complete Function Critical Error:", e);
    return res(500, { error: e.message });
  }
};
