const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PI_API_KEY = process.env.PI_API_KEY;
const PI_API_BASE = 'https://api.minepi.com/v2';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }, body: '' };
  }

  try {
    const { paymentId } = JSON.parse(event.body);
    console.log(`🚀 Approve: ${paymentId}`);

    // 1. جلب البيانات من Pi
    const piRes = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    if (!piRes.ok) throw new Error("Pi API Error");
    const piData = await piRes.json();
    
    const amount = parseFloat(piData.amount);
    // تصحيح قراءة الميتا داتا في حال كانت نصاً
    let metadata = piData.metadata || {};
    if (typeof metadata === 'string') {
        try { metadata = JSON.parse(metadata); } catch(e) {}
    }
    const productId = metadata.productId;

    // 2. التحقق
    if (!productId) {
        console.error("❌ Missing ProductID in metadata");
        // لن نوقف العملية، لكن سنسجل تحذيراً
    }

    // 3. التسجيل في قاعدة البيانات (Upsert)
    const { error } = await supabase.from('payments').upsert({
      payment_id: paymentId,
      user_id: piData.user_uid,
      product_id: productId, // حتى لو كان null، سنسجله لنعرف المشكلة
      amount: amount,
      status: 'approved'
    }, { onConflict: 'payment_id' });

    if (error) console.error("DB Insert Error:", error);

    // 4. الموافقة
    const approveRes = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    if (!approveRes.ok) console.log("Pi Approve Warning:", await approveRes.text());

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("Approve Crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
