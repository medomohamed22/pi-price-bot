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
    
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { error: "Missing paymentId" });
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    
    // 1) جلب تفاصيل الدفعة الحالية من Pi API
    const getP = await piFetch(`/payments/${paymentId}`);
    if (!getP.ok) {
      return res(getP.status, { error: "Pi get payment failed", details: getP.text });
    }
    const payment = getP.json || {};
    const pi_uid = payment.user_uid || null;
    
    // 2) إلغاء أي عمليات معلقة قديمة لنفس المستخدم لتجنب تعليق المحفظة
    const pending = await piFetch(`/payments/incomplete_server_payments`);
    if (pending.ok && pending.json) {
      const list = Array.isArray(pending.json) ? pending.json : (pending.json.incomplete_server_payments || []);
      
      const sameUserOld = list.filter(p => {
        const pid = p.identifier || p.payment_id || p.id;
        const uid = p.user_uid || p.user_identifier;
        return uid === pi_uid && pid !== paymentId;
      });
      
      for (const p of sameUserOld.slice(0, 5)) {
        const oldId = p.identifier || p.payment_id || p.id;
        await piFetch(`/payments/${oldId}/cancel`, { method: "POST" });
      }
    }
    
    // 3) الموافقة على الدفعة الحالية (Approve)
    const approveR = await piFetch(`/payments/${paymentId}/approve`, { method: "POST" });
    if (!approveR.ok) {
      return res(approveR.status, { error: "Pi approve failed", details: approveR.text });
    }
    
    // 4) تحديث قاعدة البيانات لتتوافق مع الفرونت إند والجدول
    // استخراج البيانات من metadata التي أرسلها الفرونت إند
    const member_id = payment.metadata?.memberId || null;
    const installment_number = payment.metadata?.installment || null;
    
    const row = {
      payment_id: paymentId,
      member_id: member_id, 
      amount: payment.amount || null,
      status: "approved", // حالة مؤقتة حتى يكتمل الـ TxID من الفرونت إند
      installment_number: installment_number,
      // حفظ النسخة الكاملة للبيانات للاحتياط
      raw_json: payment,
    };
    
    // استخدام upsert بناءً على payment_id لتجنب التكرار
    const { error: upErr } = await supabase
      .from("payments")
      .upsert(row, { onConflict: "payment_id" });
    
    if (upErr) {
      console.error("Supabase Error:", upErr);
      // نستمر حتى لو فشل التحديث هنا لأن الفرونت إند سيقوم بمحاولة أخرى عند Completion
    }
    
    return res(200, { ok: true, message: "Approved", paymentId });
  } catch (e) {
    console.error("approve error:", e);
    return res(500, { error: e.message || "Server error" });
  }
};
