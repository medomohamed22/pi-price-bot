const { createClient } = require('@supabase/supabase-js');

// استدعاء المتغيرات البيئية
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; // يفضل أن يكون Service Role Key للكتابة الإجبارية
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
    const body = JSON.parse(event.body);
    const { paymentId, txid } = body;

    if (!paymentId || !txid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Missing paymentId or txid" }) };
    }

    console.log(`🔍 Processing Payment: ${paymentId}`);

    // =========================================================
    // 🛡️ 1. فحص التكرار ومعالجة "التعليق" (Idempotency Check)
    // =========================================================
    const { data: existingPayment } = await supabase
        .from('payments')
        .select('status, txid')
        .eq('payment_id', paymentId)
        .single();

    // إذا كانت العملية مسجلة ومكتملة عندنا
    if (existingPayment && existingPayment.status === 'completed') {
        console.log(`⚠️ Payment ${paymentId} already processed locally.`);
        
        // 🔥 الخطوة الحاسمة لفك التعليق:
        // حتى لو مسجلة عندنا، نعيد إرسال التأكيد لـ Pi لأن التطبيق ربما لم يستلم الرد الأول
        try {
            const piComplete = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Key ${PI_API_KEY}`, 
                    'Content-Type': 'application/json' 
                },
                body: JSON.stringify({ txid: existingPayment.txid || txid }),
            });
            console.log("🔄 Re-sent completion signal to Pi (Confirmation).");
        } catch (e) {
            console.log("ℹ️ Pi likely already knows it's complete.");
        }

        // نرجع نجاح عشان الـ Frontend يكمل
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: "Already Processed & Confirmed" })
        };
    }
    // =========================================================


    // =========================================================
    // 2. التحقق من صحة الدفع من Pi (Verification)
    // =========================================================
    const verifyRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });

    if (!verifyRes.ok) throw new Error("Payment verification failed on Pi Server.");
    
    let piData = await verifyRes.json();

    // فحص الإلغاء
    if (piData.status.cancelled || piData.status.user_cancelled) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "Payment was cancelled." }) };
    }


    // =========================================================
    // 3. إتمام الدفع رسمياً على Pi (Completion)
    // =========================================================
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
            // لو فشل هنا، نرجع خطأ عشان Pi يعيد المحاولة
            const errTxt = await completeRes.text();
            throw new Error(`Failed to complete on Pi: ${errTxt}`);
        }
        
        piData = await completeRes.json();
    }


    // =========================================================
    // 4. استخراج البيانات (Metadata Parsing)
    // =========================================================
    let productId = null;
    let days = 3; 
    let paymentType = 'promotion'; // الافتراضي هو تمييز الإعلان
    let buyerId = piData.user_uid; // الافتراضي هو الشخص الذي دفع
    
    // المبلغ الإجمالي الذي تم دفعه (شاملاً رسوم 1% إذا كان وسيط)
    const amount = parseFloat(piData.amount);

    if (piData.metadata) {
        let meta = piData.metadata;
        if (typeof meta === 'string') {
            try { meta = JSON.parse(meta); } catch(e) { console.log("Meta parse warn"); }
        }
        
        productId = meta.productId || meta.product_id || meta.id;
        
        // استخراج نوع العملية ومعرف المشتري إذا كانت موجودة
        if (meta.type) paymentType = meta.type;
        if (meta.buyerId) buyerId = meta.buyerId;
        
        if (meta.days) days = parseInt(meta.days);
        else if (amount >= 4.9) days = 7;
    }

    if (!productId) {
        // نسجل العملية لكن بدون تحديث منتج (لحفظ الحق المالي)
        await supabase.from('payments').upsert({
            payment_id: paymentId,
            user_id: piData.user_uid,
            amount: amount,
            status: 'completed_no_product',
            txid: txid
        });
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Product ID missing" }) };
    }


    // =========================================================
    // 5. تسجيل العملية في قاعدة البيانات للتوثيق المالي (Log Payment)
    // =========================================================
    const { error: payError } = await supabase.from('payments').upsert({
        payment_id: paymentId,
        user_id: piData.user_uid,
        product_id: productId,
        amount: amount, // نسجل ما دخل محفظتنا بالكامل
        status: 'completed',
        txid: txid,
        created_at: new Date().toISOString()
    }, { onConflict: 'payment_id' });

    if (payError) console.error("⚠️ DB Log Error:", payError);


    // =========================================================
    // 6. تطبيق الخدمة بناءً على نوع الدفع (Promotion VS Escrow)
    // =========================================================
    
    // أ- حالة تمييز الإعلان (Promotion)
    if (paymentType === 'promotion') {
        console.log(`✨ Applying Promotion: Product ${productId} (+${days} Days)`);
        
        // جلب التاريخ الحالي
        const { data: prod } = await supabase
            .from('products')
            .select('promoted_until')
            .eq('id', productId)
            .single();
        
        let newExpiry = new Date();
        // لو لسه ساري، زود عليه
        if (prod && prod.promoted_until && new Date(prod.promoted_until) > new Date()) {
            newExpiry = new Date(prod.promoted_until);
        }
        
        // إضافة الأيام
        newExpiry.setDate(newExpiry.getDate() + days);

        // التحديث
        const { error: promoError } = await supabase
          .from('products')
          .update({ promoted_until: newExpiry.toISOString() })
          .eq('id', productId);

        if (promoError) throw new Error("Database Update Failed");

        console.log("✅ SUCCESS: Product Promoted!");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, type: 'promotion', daysAdded: days, newExpiry })
        };
    } 
    
    // ب- حالة الدفع الآمن / الوسيط (Escrow)
    else if (paymentType === 'escrow') {
        console.log(`🛡️ Applying Escrow: Product ${productId} for Buyer ${buyerId}`);
        
        // 1. جلب بيانات البائع والسعر من جدول المنتجات
        const { data: productData, error: productError } = await supabase
            .from('products')
            .select('seller_pi_id, price')
            .eq('id', productId)
            .single();
            
        if (productError || !productData) {
            throw new Error("Product not found for escrow transaction");
        }
        
        // 💡 حساب الصافي للبائع (نقوم بإزالة نسبة الـ 1% التي دفعها المشتري كرسوم للمنصة)
        // نقسم الإجمالي المدفوع على 1.01 لنستخرج سعر المنتج الأصلي بدقة
        const sellerNetAmount = parseFloat((amount / 1.01).toFixed(5));
        
        // 2. التحقق من وجود معاملة سابقة لنفس المنتج والمشتري (لمنع التكرار)
        const { data: existingEscrow } = await supabase
            .from('escrow_transactions')
            .select('id')
            .eq('product_id', productId)
            .eq('buyer_pi_id', buyerId)
            .order('created_at', { ascending: false })
            .limit(1);

        let escrowError;

        if (existingEscrow && existingEscrow.length > 0) {
            // ✅ تحديث المعاملة الحالية بالرصيد الصافي للبائع
            const res = await supabase
                .from('escrow_transactions')
                .update({ 
                    status: 'FUNDED', 
                    amount: sellerNetAmount, // ⬅️ نسجل الصافي فقط للبائع!
                    updated_at: new Date().toISOString() 
                })
                .eq('id', existingEscrow[0].id);
            escrowError = res.error;
        } else {
            // ✅ إنشاء معاملة جديدة بالرصيد الصافي للبائع
            const res = await supabase
                .from('escrow_transactions')
                .insert({
                    product_id: productId,
                    buyer_pi_id: buyerId,
                    seller_pi_id: productData.seller_pi_id,
                    amount: sellerNetAmount, // ⬅️ نسجل الصافي فقط للبائع!
                    status: 'FUNDED'
                });
            escrowError = res.error;
        }

        if (escrowError) {
            console.error("Escrow Insert/Update Error:", escrowError);
            throw new Error("Failed to save/update escrow transaction");
        }

        console.log("✅ SUCCESS: Escrow Transaction Created/Updated and Funded!");
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, type: 'escrow', status: 'FUNDED' })
        };
    }

  } catch (err) {
    console.error("💥 SYSTEM ERROR:", err.message);
    // نرجع 500 في حالة الخطأ الحقيقي عشان Pi يعيد المحاولة لاحقاً
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
