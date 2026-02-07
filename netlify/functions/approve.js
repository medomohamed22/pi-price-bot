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
    
    // 2) إلغاء أي عمليات معلقة قديمة لنفس المستخدم
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
    
    // 4) تحديد نوع الدفع من metadata
    const paymentType = payment.metadata?.type || 'installment'; // 'installment' | 'insurance'
    const member_id = payment.metadata?.memberId || null;
    const cycle_id = payment.metadata?.cycleId || null;
    const installment_number = payment.metadata?.installment || null;
    const platformFee = payment.metadata?.platformFee || 1.00;
    const originalAmount = payment.metadata?.originalAmount || payment.amount;
    
    // 5) حفظ بيانات مؤقتة في قاعدة البيانات حسب نوع الدفع
    if (paymentType === 'insurance') {
      // دفع تأمين - نحفظ في insurance_deposits مؤقتاً
      const { error: insErr } = await supabase
        .from("insurance_deposits")
        .upsert({
          member_id: member_id,
          pi_uid: pi_uid,
          cycle_id: cycle_id,
          amount: payment.amount,
          status: "pending", // سيتم التحديث لـ 'held' عند الـ complete
          payment_id: paymentId,
          txid: null,
        }, { onConflict: "payment_id" });
        
      if (insErr) {
        console.error("Insurance deposit save error:", insErr);
      }
      
    } else {
      // دفع قسط عادي + رسوم المنصة
      
      // أولاً: حفظ سجل الرسوم
      const { error: feeErr } = await supabase
        .from("platform_fees")
        .upsert({
          member_id: member_id,
          cycle_id: cycle_id,
          installment_amount: originalAmount,
          fee_amount: platformFee,
          total_amount: payment.amount,
          pi_payment_id: paymentId,
          status: "pending",
        }, { onConflict: "pi_payment_id" });
        
      if (feeErr) {
        console.error("Platform fee save error:", feeErr);
      }
      
      // ثانياً: حفظ بيانات الدفع المؤقتة (سيتم إنشاء سجل payments الحقيقي عند الـ complete)
      // نستخدم جدول مؤقت أو ننتظر الـ complete من الفرونت إند
    }
    
    return res(200, { 
      ok: true, 
      message: "Approved", 
      paymentId,
      type: paymentType,
      metadata: payment.metadata
    });
    
  } catch (e) {
    console.error("approve error:", e);
    return res(500, { error: e.message || "Server error" });
  }
};
