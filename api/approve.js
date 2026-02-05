const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Config
const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // MUST use Service Role for writing securely

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const PI_PLATFORM_API_URL = 'https://api.minepi.com';

module.exports = async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const { paymentId, payment } = req.body;
  
  if (!paymentId || !payment) {
    return res.status(400).json({ error: 'Missing payment data' });
  }
  
  try {
    // 1. Approve with Pi Network
    const approveUrl = `${PI_PLATFORM_API_URL}/v2/payments/${paymentId}/approve`;
    const piResponse = await axios.post(approveUrl, {}, {
      headers: { 'Authorization': `Key ${PI_API_KEY}` }
    });
    
    // 2. Save Pending Transaction to Database
    // Metadata contains the project_id we passed from frontend
    const projectId = payment.metadata.project_id;
    const userId = payment.user_uid;
    
    // Determine username (Pi doesn't always send it in payment obj, might need separate lookup, 
    // strictly we trust the frontend passed verification or look up in our users table)
    // For this implementation, we assume the user exists in our DB.
    const { data: user } = await supabase.from('users').select('username').eq('pi_uid', userId).single();
    
    const { error: dbError } = await supabase.from('supports').insert({
      project_id: projectId,
      pi_uid: userId,
      username: user ? user.username : 'Unknown',
      amount: payment.amount,
      payment_id: paymentId,
      status: 'pending'
    });
    
    if (dbError) throw dbError;
    
    return res.status(200).json({ message: 'Approved', data: piResponse.data });
    
  } catch (error) {
    console.error('Approve Error:', error);
    return res.status(500).json({ error: 'Approval Failed' });
  }
};
