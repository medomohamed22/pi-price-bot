const { createClient } = require("@supabase/supabase-js");

// استيراد المتغيرات البيئية
const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PI_BASE = "https://api.minepi.com/v2";

// دالة مساعدة للردود
function res(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*", // السماح للكورس
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
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: r.ok, status: r.status, text, json };
}

exports.handler = async (event) => {
  // التعامل مع طلبات OPTIONS (CORS)
  if (event.httpMethod === "OPTIONS") return res(200, {});
  if (event.httpMethod !== "POST") return res(405, { error: "Method Not Allowed" });
  
  try {
    // 1. التحقق من المتغيرات البيئية
    if (!PI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res(500, { error: "Server Configuration Error (Missing Env Vars)" });
    }
    
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { error: "Missing paymentId" });
    
    // تهيئة Supabase بصلاحيات الأدمن (Service Role)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    
    // 2. جلب تفاصيل الدفع من Pi لمعرفة المستخدم والـ Metadata
    const getP = await piFetch(`/payments/${paymentId}`);
    if (!getP.ok) {
      return res(getP.status, { error: "Pi API Error", details: getP.text });
    }
    
    const payment = getP.json || {};
    const pi_uid = payment.user_uid;
    const amount = payment.amount;
    // استخراج cycleId من البيانات الوصفية التي أرسلناها في الفرونت إند
    const cycleId = payment.metadata?.cycleId; 

    if (!cycleId) {
      return res(400, { error: "Missing cycleId in payment metadata" });
    }

    // 3. (خطوة اختيارية لكن هامة) إلغاء أي مدفوعات معلقة سابقة لنفس المستخدم
    // لتجنب خطأ Pi المعروف: "User has an incomplete payment"
    try {
      const pending = await piFetch(`/payments/incomplete_server_payments`);
      if (pending.ok && pending.json) {
        const list = Array.isArray(pending.json) ? pending.json : (pending.json.incomplete_server_payments || []);
        
        // تصفية المدفوعات الخاصة بنفس المستخدم ولكن ليست العملية الحالية
        const userOldPayments = list.filter(p => p.user_uid === pi_uid && p.identifier !== paymentId);
        
        for (const p of userOldPayments) {
          await piFetch(`/payments/${p.identifier}/cancel`, { method: "POST" });
        }
      }
    } catch (err) {
      console.warn("Cleanup warning:", err); // لا نوقف العملية إذا فشل التنظيف
    }
    
    // 4. البحث عن العضو (Member) في قاعدة البيانات
    // نحتاج member_id لربط الدفع به حسب هيكل قاعدة البيانات
    const { data: memberData, error: memberError } = await supabase
      .from("members")
      .select("id")
      .eq("pi_uid", pi_uid)
      .eq("cycle_id", cycleId)
      .single();

    if (memberError || !memberData) {
      // إذا لم يكن العضو مسجلاً في الدورة، نرفض العملية أو نسجلها بدون ربط (حسب السياسة)
      // هنا سنرفض العملية لأنه يجب أن يكون منضماً للدورة أولاً
      return res(400, { error: "Member not found in this cycle. Please join first." });
    }

    // 5. تسجيل الدفع في جدول payments بحالة 'pending'
    // لاحظ أننا نستخدم payment_id الذي أنشأه Pi لضمان عدم التكرار
    const { error: dbError } = await supabase
      .from("payments")
      .upsert({
        payment_id: paymentId,
        member_id: memberData.id,
        amount: amount,
        status: "pending" // بانتظار الـ completion
      }, { onConflict: "payment_id" });
    
    if (dbError) {
      console.error("DB Insert Error:", dbError);
      return res(500, { error: "Database error", details: dbError.message });
    }
    
    // 6. الموافقة النهائية في Pi Network
    const approveR = await piFetch(`/payments/${paymentId}/approve`, { method: "POST" });
    if (!approveR.ok) {
      return res(approveR.status, { error: "Pi approve failed", details: approveR.text });
    }
    
    return res(200, { ok: true, message: "Approved successfully", paymentId });

  } catch (e) {
    console.error("Server Error:", e);
    return res(500, { error: e.message || "Internal Server Error" });
  }
};
