const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PI_PLATFORM_API_URL = 'https://api.minepi.com';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const { paymentId, txid, payment } = req.body;
  
  if (!paymentId || !txid) {
    return res.status(400).json({ error: 'Missing txid or paymentId' });
  }
  
  try {
    // 1. Complete with Pi Network
    const completeUrl = `${PI_PLATFORM_API_URL}/v2/payments/${paymentId}/complete`;
    const piResponse = await axios.post(completeUrl, { txid }, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    // 2. Update Database: Mark complete
    const { data: supportRecord, error: findError } = await supabase
      .from('supports')
      .update({ status: 'completed', txid: txid })
      .eq('payment_id', paymentId)
      .select()
      .single();
    
    if (findError) throw findError;
    
    // 3. Increment Project Support Counter
    // Using RPC is safer for atomic increments, but here is a simple fetch-update approach
    const projectId = supportRecord.project_id;
    const amount = supportRecord.amount;
    
    // Get current project stats
    const { data: project } = await supabase.from('projects').select('supports_count').eq('id', projectId).single();
    const newTotal = parseFloat(project.supports_count) + parseFloat(amount);
    
    await supabase.from('projects').update({ supports_count: newTotal }).eq('id', projectId);
    
    return res.status(200).json({ message: 'Completed', data: piResponse.data });
    
  } catch (error) {
    console.error('Complete Error:', error);
    return res.status(500).json({ error: 'Completion Failed' });
  }
};
