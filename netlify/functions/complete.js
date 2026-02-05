const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PI_PLATFORM_API_URL = 'https://api.minepi.com';

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }
  
  try {
    const { paymentId, txid, payment } = JSON.parse(event.body);
    
    if (!paymentId || !txid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing txid/paymentId' }) };
    }
    
    // 1. Complete with Pi
    const completeUrl = `${PI_PLATFORM_API_URL}/v2/payments/${paymentId}/complete`;
    await axios.post(completeUrl, { txid }, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    // 2. Update DB
    const { data: supportRecord, error: findError } = await supabase
      .from('supports')
      .update({ status: 'completed', txid: txid })
      .eq('payment_id', paymentId)
      .select()
      .single();
    
    if (findError) throw findError;
    
    // 3. Update Project Counter
    const projectId = supportRecord.project_id;
    const amount = supportRecord.amount;
    
    // الطريقة الآمنة لزيادة العداد
    const { data: project } = await supabase.from('projects').select('supports_count').eq('id', projectId).single();
    const newTotal = parseFloat(project.supports_count || 0) + parseFloat(amount);
    
    await supabase.from('projects').update({ supports_count: newTotal }).eq('id', projectId);
    
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ message: 'Completed' })
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
