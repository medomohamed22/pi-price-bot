const { createClient } = require("@supabase/supabase-js");

// استيراد المتغيرات البيئية
const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PI_BASE = "https://api.minepi.com/v2";

// دالة مساعدة لتنسيق الردود (Responses)
function res(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*", // السماح بالوصول من أي مكان (CORS)
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  };
}

// دالة مساعدة للاتصال بـ Pi API
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
  // 1. التعامل مع طلبات OPTIONS (Pre-flight CORS)
  if (event.httpMethod === "OPTIONS") return res(200, {});
  if (event.httpMethod !== "POST") return res(405, { error: "Method Not Allowed" });

  try {
    // 2. التحقق من إعدادات السيرفر
    if (!PI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing Env Vars");
      return res(500, { error: "Server Configuration Error" });
    }

    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { error: "Missing paymentId" });

    // 3. تهيئة Supabase (بصلاحيات الأدمن للتعديل والحذف)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 4. جلب تفاصيل الدفع من Pi API (للتحقق من المبلغ والبيانات الوصفية)
    const getP = await piFetch(`/payments/${paymentId}`);
    if (!getP.ok) {
      console.error("Pi Get Payment Error:", getP.text);
      return res(getP.status, { error: "Failed to fetch payment from Pi", details: getP.text });
    }

    const payment = getP.json;
    const pi_uid = payment.user_uid;
    const amount = payment.amount;
    const metadata = payment.metadata || {};
    
    // استخراج البيانات التي أرسلناها من الواجهة الأمامية (app.js)
    const memberId = metadata.memberId;       // معرف العضو في الداتابيس
    const installmentNum = metadata.installment; // رقم القسط (مهم جداً)

    if (!memberId) {
      return res(400, { error: "Missing memberId in payment metadata" });
    }

    // 5. (هام) تنظيف أي عمليات دفع عالقة لنفس المستخدم (لتجنب خطأ Pi الشهير)
    try {
      const pendingReq = await piFetch(`/payments/incomplete_server_payments`);
      if (pendingReq.ok && pendingReq.json) {
        const incompleteList = pendingReq.json.incomplete_server_payments || [];
        // تصفية العمليات الخاصة بنفس المستخدم (ما عدا العملية الحالية)
        const toCancel = incompleteList.filter(p => p.user_uid === pi_uid && p.identifier !== paymentId);
        
        for (const p of toCancel) {
          console.log(`Cancelling stuck payment: ${p.identifier}`);
          await piFetch(`/payments/${p.identifier}/cancel`, { method: "POST" });
        }
      }
    } catch (cleanupErr) {
      console.warn("Cleanup warning (non-fatal):", cleanupErr);
    }

    // 6. التحقق من وجود العضو في قاعدة البيانات
    const { data: memberData, error: memberError } = await supabase
      .from("members")
      .select("id, pi_uid")
      .eq("id", memberId)
      .single();

    if (memberError || !memberData) {
      return res(400, { error: "Member not found. Please refresh and try again." });
    }

    // تحقق أمان إضافي: هل المستخدم الذي يدفع هو نفسه صاحب العضوية؟
    if (memberData.pi_uid !== pi_uid) {
      return res(403, { error: "Security Mismatch: You cannot pay for this membership." });
    }

    // 7. تسجيل الدفع المبدئي في قاعدة البيانات (Status: pending)
    // هذا يضمن أننا نعرف أن هناك عملية جارية حتى لو لم تكتمل بعد
    const insertPayload = {
      payment_id: paymentId,
      member_id: memberId,
      amount: amount,
      status: "pending" // سنغيرها إلى 'confirmed' في دالة complete
    };

    // إضافة رقم القسط فقط إذا كان العمود موجوداً وتم إرساله
    if (installmentNum) {
      insertPayload.installment_number = installmentNum;
    }

    const { error: dbError } = await supabase
      .from("payments")
      .upsert(insertPayload, { onConflict: "payment_id" });

    if (dbError) {
      console.error("DB Insert Error:", dbError);
      // ملاحظة: إذا فشل التسجيل هنا، لا يجب أن نوافق على الدفع في Pi حتى لا تخصم الأموال بدون تسجيل
      return res(500, { error: "Database recording failed", details: dbError.message });
    }

    // 8. الخطوة الأخيرة: إرسال الموافقة لـ Pi Network
    const approveR = await piFetch(`/payments/${paymentId}/approve`, { method: "POST" });
    
    if (!approveR.ok) {
      console.error("Pi Approve Error:", approveR.text);
      return res(approveR.status, { error: "Pi Approve Failed", details: approveR.text });
    }

    // نجاح!
    return res(200, { ok: true, message: "Payment Approved", paymentId });

  } catch (e) {
    console.error("Approve Function Error:", e);
    return res(500, { error: e.message || "Internal Server Error" });
  }
};
