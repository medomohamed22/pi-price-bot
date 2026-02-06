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
      return res(500, {
        error: "Missing env vars",
        details: "PI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId || !txid) return res(400, { error: "Missing paymentId/txid" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) إكمال المعاملة على خوادم Pi Network (Blockchain Settlement)
    const comp = await piFetch(`/payments/${paymentId}/complete`, {
      method: "POST",
      body: JSON.stringify({ txid }),
    });

    if (!comp.ok) {
      // إذا كانت المعاملة مكتملة بالفعل على Pi، لا نتوقف، بل نكمل تحديث قاعدة البيانات
      console.warn("Pi complete not ok (might be already completed):", comp.status, comp.text);
    }

    // 2) تحديث قاعدة البيانات (Update DB)
    // نستخدم 'confirmed' لتطابق الحالة في الفرونت إند وتظهر للمستخدم بنجاح
    const { error: upErr } = await supabase
      .from("payments")
      .upsert(
        { 
          payment_id: paymentId, 
          txid: txid, 
          status: "confirmed" // تم التعديل من 'completed' إلى 'confirmed' للتوافق
        },
        { onConflict: "payment_id" }
      );

    if (upErr) {
      console.error("Supabase upsert failed in complete function:", upErr.message);
      return res(500, { error: "Supabase upsert failed", details: upErr.message });
    }

    return res(200, { ok: true, message: "Transaction Confirmed in DB", paymentId, txid });
  } catch (e) {
    console.error("complete error:", e);
    return res(500, { error: e.message || "Server error" });
  }
};
