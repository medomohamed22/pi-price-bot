// netlify/functions/complete.js
const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  // 1. التعامل مع CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    const PI_SECRET = process.env.PI_SECRET_KEY;
    const SB_URL = process.env.PUBLIC_SUPABASE_URL;
    const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE;

    // 2. التحقق من المفاتيح
    if (!PI_SECRET) throw new Error("Missing PI_SECRET_KEY in Netlify");
    if (!SB_SERVICE) throw new Error("Missing SUPABASE_SERVICE_ROLE in Netlify");

    // 3. تأكيد الدفع مع Pi Network
    console.log(`Completing payment: ${paymentId}`);
    const completeRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: "POST",
      headers: { "Authorization": `Key ${PI_SECRET}`, "Content-Type": "application/json" },
      body: JSON.stringify({ txid })
    });
    
    const completeData = await completeRes.json();
    
    // إذا كان الخطأ ليس "تم الدفع مسبقاً"، نتوقف
    if (!completeRes.ok && !JSON.stringify(completeData).toLowerCase().includes("already")) {
       return errorRes(completeRes.status, "Pi Complete Failed", completeData);
    }

    // 4. جلب تفاصيل الدفع لمعرفة الـ adId
    const paymentInfoRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { "Authorization": `Key ${PI_SECRET}` }
    });
    const paymentInfo = await paymentInfoRes.json();
    
    // استخراج رقم الإعلان من المذكرة (PROMOTE_AD|ad-id-here)
    const adId = paymentInfo.metadata?.adId || paymentInfo.memo.split('|')[1];
    
    if (!adId) throw new Error("Could not find Ad ID in payment metadata");

    // 5. تحديث قاعدة البيانات (Supabase)
    // حساب تاريخ الانتهاء (3 أيام من الآن)
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 3);

    const sbUpdate = await fetch(`${SB_URL}/rest/v1/ads?id=eq.${adId}`, {
      method: "PATCH",
      headers: {
        "apikey": SB_SERVICE,
        "Authorization": `Bearer ${SB_SERVICE}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({ promoted_until: expiryDate.toISOString() })
    });

    if (!sbUpdate.ok) {
      const sbError = await sbUpdate.text();
      console.error("Supabase Error:", sbError);
      return errorRes(500, "Database Update Failed", sbError);
    }

    return {
      statusCode: 200,
      headers: cors(),
      body: JSON.stringify({ success: true, message: "Ad Promoted Successfully" })
    };

  } catch (e) {
    console.error("Server Error:", e.message);
    return errorRes(500, e.message, e.stack);
  }
};

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function errorRes(code, msg, detail) {
  return {
    statusCode: code,
    headers: cors(),
    body: JSON.stringify({ success: false, message: msg, error: detail })
  };
}
