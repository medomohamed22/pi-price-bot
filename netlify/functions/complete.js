const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
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

    console.log(`🔍 Processing Payment: ${paymentId}`);

    // =========================================================
    // 🛡️ الحل الأمني: منع التكرار (Idempotency Check)
    // =========================================================
    // نفحص هل هذه العملية مسجلة لدينا مسبقاً؟
    const { data: existingPayment } = await supabase
        .from('payments')
        .select('status')
        .eq('payment_id', paymentId)
        .single();

    // إذا كانت العملية موجودة ومكتملة، نوقف التنفيذ فوراً
    if (existingPayment && existingPayment.status === 'completed') {
        console.log(`⚠️ Payment ${paymentId} already processed. Skipping logic.`);
        return {
            statusCode: 200, // نرجع 200 عشان Pi يفهم إن الرسالة وصلت وما يكررش الطلب
            headers,
            body: JSON.stringify({ success: true, message: "Already Processed" })
        };
    }
    // =========================================================

    // 1. التحقق من Pi
    const verifyRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!verifyRes.ok) throw new Error("Payment verification failed on Pi Server.");
    
    let piData = await verifyRes.json();

    // 2. فحص الإلغاء
    if (piData.status.cancelled || piData.status.user_cancelled) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Payment was cancelled." }) };
    }

    // 3. إتمام الدفع في Pi (إذا لم يكن مكتملاً)
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

        if (!completeRes.ok) throw new Error(`Failed to complete on Pi`);
        piData = await completeRes.json();
    }

    // 4. استخراج البيانات
    let productId = null;
    let days = 3; 
    const amount = parseFloat(piData.amount);

    if (piData.metadata) {
        let meta = piData.metadata;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) {}
        }
        productId = meta.productId || meta.product_id || meta.id;
        if (meta.days) days = parseInt(meta.days);
        else if (amount >= 4.9) days = 7;
    }

    if (!productId) {
        // تسجيل كعملية معلقة بدون منتج
        await supabase.from('payments').upsert({
            payment_id: paymentId,
            user_id: piData.user_uid,
            amount: amount,
            status: 'completed_missing_product',
            txid: txid
        });
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Product ID missing" }) };
    }

    // 5. تسجيل العملية في قاعدة البيانات
    const { error: payError } = await supabase.from('payments').upsert({
        payment_id: paymentId,
        user_id: piData.user_uid,
        product_id: productId,
        amount: amount,
        status: 'completed', // ✅ هذا ما سيمنع التكرار في المرة القادمة
        txid: txid,
        created_at: new Date().toISOString()
    });

    if (payError) console.error("⚠️ DB Log Error:", payError);

    // 6. تطبيق التمييز (مرة واحدة فقط الآن)
    console.log(`✨ Applying Promotion: Product ${productId} (+${days} Days)`);
    
    const { data: prod } = await supabase
        .from('products')
        .select('promoted_until')
        .eq('id', productId)
        .single();
    
    let newExpiry = new Date();
    if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
        newExpiry = new Date(prod.promoted_until);
    }
    
    newExpiry.setDate(newExpiry.getDate() + days);

    const { error: promoError } = await supabase
      .from('products')
      .update({ promoted_until: newExpiry.toISOString() })
      .eq('id', productId);

    if (promoError) throw new Error("Database Update Failed");

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, daysAdded: days })
    };

  } catch (err) {
    console.error("💥 ERROR:", err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
