const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PI_PLATFORM_API_URL = 'https://api.minepi.com';

exports.handler = async (event, context) => {
  // تفعيل CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  // التعامل مع طلبات Preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }
  
  try {
    const { paymentId, payment } = JSON.parse(event.body);
    
    if (!paymentId || !payment) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing data' }) };
    }
    
    // 1. Approve with Pi
    const approveUrl = `${PI_PLATFORM_API_URL}/v2/payments/${paymentId}/approve`;
    const piResponse = await axios.post(approveUrl, {}, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    // 2. Save to DB
    const projectId = payment.metadata.project_id;
    const userId = payment.user_uid;
    
    // جلب اسم المستخدم (اختياري، يمكن الاعتماد على ما يأتي من الفرونت مؤقتاً)
    const { data: user } = await supabase.from('users').select('username').eq('pi_uid', userId).single();
    
    await supabase.from('supports').insert({
      project_id: projectId,
      pi_uid: userId,
      username: user ? user.username : 'Pi User',
      amount: payment.amount,
      payment_id: paymentId,
      status: 'pending'
    });
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Approved', data: piResponse.data })
    };
    
  } catch (error) {
    console.error(error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
