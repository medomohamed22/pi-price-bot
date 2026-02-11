const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // CORS Header
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { paymentId, txid } = JSON.parse(event.body);
    console.log(`🔥 FORCE COMPLETING: ${paymentId}`);

    // 1. الخطوة الأهم: إبلاغ Pi بإتمام الدفع (عشان الفلوس تثبت)
    // حتى لو فشل اللي تحته، لازم دي تتم
    await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid }),
    });

    // 2. جلب الحقيقة من المصدر (سيرفرات Pi)
    const piRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!piRes.ok) throw new Error("Could not fetch data from Pi");
    
    const piData = await piRes.json();
    console.log("📥 Pi Data Received:", JSON.stringify(piData));

    // 3. استخراج البيانات بذكاء (لمعالجة مشاكل الـ Metadata)
    let productId = null;
    let days = 3; // الافتراضي
    const amount = parseFloat(piData.amount);

    // فك تشفير الميتا داتا بحذر
    if (piData.metadata) {
        let meta = piData.metadata;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { console.log("Metadata parse error"); }
        }
        // لاحظ: قد تكون productId أو product_id حسب ما أرسلته من الفرونت
        productId = meta.productId || meta.product_id || meta.id;
        
        // لو باعت الأيام في الميتا، خدها. لو لأ، احسبها من الفلوس
        if (meta.days) days = parseInt(meta.days);
        else if (amount >= 4.9) days = 7;
    }

    if (!productId) {
        console.error("❌ Fatal: No Product ID found in Pi response.");
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Product ID missing from metadata" }) };
    }

    // 4. تسجيل العملية في جدول المدفوعات (إجباري)
    const { error: payError } = await supabase.from('payments').upsert({
        payment_id: paymentId,
        user_id: piData.user_uid,
        product_id: productId, // سيتم تحويله لنص تلقائياً حسب تعديل الـ SQL
        amount: amount,
        status: 'completed',
        txid: txid
    }, { onConflict: 'payment_id' });

    if (payError) console.error("⚠️ Payment DB Log Failed:", payError);

    // 5. تطبيق التمييز على المنتج
    console.log(`✨ Promoting Product ${productId} for ${days} days...`);
    
    // جلب التاريخ الحالي للمنتج
    const { data: prod } = await supabase.from('products').select('promoted_until').eq('id', productId).single();
    
    let newExpiry = new Date();
    // لو لسه مميز، زود على الميعاد القديم
    if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
        newExpiry = new Date(prod.promoted_until);
    }
    
    newExpiry.setDate(newExpiry.getDate() + days);

    const { error: promoError } = await supabase
      .from('products')
      .update({ promoted_until: newExpiry.toISOString() })
      .eq('id', productId);

    if (promoError) {
        console.error("❌ Promotion DB Update Failed:", promoError);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Promotion Failed" }) };
    }

    console.log("✅ SUCCESS: Product Promoted!");
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, daysAdded: days })
    };

  } catch (err) {
    console.error("💥 SYSTEM ERROR:", err);
    // نرجع 200 عشان Pi ميعلقش، بس نسجل الخطأ عندنا
    return { statusCode: 200, headers, body: JSON.stringify({ error: err.message }) };
  }
};
