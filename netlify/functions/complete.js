const { createClient } = require('@supabase/supabase-js');

// استبدل الروابط التالية ببياناتك الحقيقية من إعدادات Supabase
const SUPABASE_URL = 'https://xncapmzlwuisupkjlftb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zPECXAiI_bDbeLtRYe3vIw_IEt_p_AS'; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { paymentId, txid, username, amount, campaignId, memo } = JSON.parse(event.body);

  if (!paymentId || !txid) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing paymentId or txid' }) };
  }

  // مفتاح Pi Secret - يفضل بقاؤه في Environment Variables، لكن يمكنك وضعه هنا مؤقتاً
  const PI_SECRET_KEY = process.env.PI_SECRET_KEY || 'اكتب_هنا_PI_SECRET_KEY_الخاص_بك';
  const PI_API_BASE = 'https://api.minepi.com/v2';

  try {
    // 1. تأكيد الدفع مع Pi API
    const response = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${PI_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txid }),
    });

    if (response.ok) {
      const piData = await response.json();

      // 2. تسجيل البيانات في جدول donations مباشرة
      const { data, error } = await supabase
        .from('donations')
        .insert([
          { 
            username: username, 
            amount: parseFloat(amount), 
            campaign_id: campaignId, 
            txid: txid,
            memo: memo 
          }
        ]);

      if (error) {
        return { 
          statusCode: 200, 
          body: JSON.stringify({ completed: true, saved: false, error: error.message }) 
        };
      }

      return { 
        statusCode: 200, 
        body: JSON.stringify({ completed: true, saved: true, data: piData }) 
      };

    } else {
      const errorData = await response.json();
      return { statusCode: response.status, body: JSON.stringify({ error: errorData }) };
    }
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
