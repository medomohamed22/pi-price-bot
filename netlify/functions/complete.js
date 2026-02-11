const { createClient } = require('@supabase/supabase-js');

// استدعاء المتغيرات البيئية
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  // إعداد الهيدر لتجنب مشاكل CORS
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'Content-Type', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS' 
  };
  
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { paymentId, txid } = JSON.parse(event.body);

    if (!paymentId || !txid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing paymentId or txid" }) };
    }

    console.log(`🔍 Verifying Payment: ${paymentId}`);

    // ---------------------------------------------------------
    // 1. الخطوة الأولى: التحقق من صحة الدفع من سيرفرات Pi مباشرة
    // ---------------------------------------------------------
    const verifyRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!verifyRes.ok) {
      // إذا رد سيرفر باي بخطأ، فهذا يعني أن عملية الدفع غير موجودة أو وهمية
      throw new Error("Payment verification failed on Pi Server.");
    }
    
    let piData = await verifyRes.json();

    // ---------------------------------------------------------
    // 2. الخطوة الثانية: فحص حالة الدفع (Security Check)
    // ---------------------------------------------------------
    // نتأكد أن المستخدم لم يقم بإلغاء العملية
    if (piData.status.cancelled || piData.status.user_cancelled) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Payment was cancelled by user." }) };
    }

    // ---------------------------------------------------------
    // 3. الخطوة الثالثة: إتمام الدفع رسمياً (Server-Side Completion)
    // ---------------------------------------------------------
    // نقوم بإرسال التاكيد فقط إذا لم تكن مكتملة بالفعل
    // الحالة PAYMENT_APPROVED تعني أن المستخدم دفع، ونحن نحتاج أن نؤكد الاستلام
    if (piData.status.developer_approved === false && !piData.status.completed) {
        console.log(`⚡ Completing transaction on Pi Network...`);
        
        const completeRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
            method: 'POST',
            headers: { 
                'Authorization': `Key ${PI_API_KEY}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify({ txid }),
        });

        if (!completeRes.ok) {
            const errText = await completeRes.text();
            throw new Error(`Failed to complete payment on Pi: ${errText}`);
        }
        
        // تحديث البيانات بعد الإتمام
        piData = await completeRes.json();
    }

    console.log("✅ Payment Verified & Completed via Pi Server.");

    // ---------------------------------------------------------
    // 4. استخراج البيانات (الميتا داتا)
    // ---------------------------------------------------------
    let productId = null;
    let days = 3; // القيمة الافتراضية
    const amount = parseFloat(piData.amount);

    if (piData.metadata) {
        let meta = piData.metadata;
        // أحياناً تصل الميتا كنص JSON، نحاول تحويلها
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { console.log("Metadata parsing info:", e.message); }
        }
        
        // دعم صيغ مختلفة لاسم المفتاح
        productId = meta.productId || meta.product_id || meta.id;
        
        // تحديد عدد الأيام بناءً على الميتا أو المبلغ
        if (meta.days) days = parseInt(meta.days);
        else if (amount >= 4.9) days = 7; // إذا دفع 5 تقريباً نعطيه 7 أيام
    }

    if (!productId) {
        console.error("❌ Fatal: Product ID missing in metadata.");
        // نسجل الدفع في الجدول لكن لا يمكننا ترقية منتج مجهول
        await supabase.from('payments').upsert({
            payment_id: paymentId,
            user_id: piData.user_uid,
            amount: amount,
            status: 'completed_no_product',
            txid: txid
        });
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Payment received but Product ID missing." }) };
    }

    // ---------------------------------------------------------
    // 5. تسجيل العملية في قاعدة البيانات (Payments Table)
    // ---------------------------------------------------------
    const { error: payError } = await supabase.from('payments').upsert({
        payment_id: paymentId,
        user_id: piData.user_uid, // Pi User ID
        product_id: productId,
        amount: amount,
        status: 'completed',
        txid: txid,
        created_at: new Date().toISOString()
    }, { onConflict: 'payment_id' });

    if (payError) {
        console.error("⚠️ DB Error (Payments Log):", payError);
        // لا نوقف العملية هنا لأن الدفع تم بالفعل، فقط نسجل الخطأ في اللوج
    }

    // ---------------------------------------------------------
    // 6. تطبيق الخدمة (Promote Product)
    // ---------------------------------------------------------
    console.log(`✨ Applying Promotion: Product ${productId} (+${days} Days)`);
    
    // جلب المنتج الحالي لمعرفة هل هو مميز بالفعل أم لا
    const { data: prod } = await supabase
        .from('products')
        .select('promoted_until')
        .eq('id', productId)
        .single();
    
    let newExpiry = new Date();
    // إذا كان المنتج مميزاً بالفعل ومازال الوقت سارياً، نضيف الأيام فوق الوقت المتبقي
    if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
        newExpiry = new Date(prod.promoted_until);
    }
    
    // إضافة الأيام
    newExpiry.setDate(newExpiry.getDate() + days);

    // تحديث المنتج
    const { error: promoError } = await supabase
      .from('products')
      .update({ promoted_until: newExpiry.toISOString() })
      .eq('id', productId);

    if (promoError) {
        console.error("❌ DB Error (Update Product):", promoError);
        return { statusCode: 500, headers, body: JSON.stringify({ error: "Payment successful, but failed to update product." }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, daysAdded: days, newExpiry: newExpiry })
    };

  } catch (err) {
    console.error("💥 SYSTEM ERROR:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
