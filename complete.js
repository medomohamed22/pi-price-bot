exports.handler = async (event) => {
  console.log("=== COMPLETE FUNCTION CALLED ===");
  
  if (event.httpMethod !== 'POST') return { statusCode: 405 };
  
  const { paymentId, txid, username } = JSON.parse(event.body || '{}');
  if (!paymentId || !txid) return { statusCode: 400, body: JSON.stringify({ status: 'error' }) };
  
  const apiKey = process.env.PI_API_KEY;
  
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'API Key missing' }) };
  
  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: { 'Authorization': `Key ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ txid })
    });
    
    if (response.ok) {
      console.log(`Participation recorded for ${username}`);
      return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
    } else {
      const err = await response.text();
      console.log("COMPLETION FAILED:", err);
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err }) };
    }
  } catch (err) {
    console.error("ERROR:", err);
    return { statusCode: 500, body: JSON.stringify({ status: 'error' }) };
  }
};