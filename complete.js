exports.handler = async (event) => {
  console.log("=== COMPLETE FUNCTION CALLED ===");
  console.log("Time:", new Date().toISOString());
  
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const { paymentId, txid } = JSON.parse(event.body || '{}');
  if (!paymentId || !txid) {
    return { statusCode: 400, body: JSON.stringify({ status: 'error', message: 'Missing paymentId or txid' }) };
  }
  
  const apiKey = process.env.API_KEY;
  
  if (!apiKey) {
    console.log("ERROR: API_KEY not set!");
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: 'Server configuration error' }) };
  }
  
  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ txid })
    });
    
    if (response.ok) {
      console.log("COMPLETION SUCCESS");
      return { statusCode: 200, body: JSON.stringify({ status: 'success' }) };
    } else {
      const errText = await response.text();
      console.log("COMPLETION FAILED:", errText);
      return { statusCode: 500, body: JSON.stringify({ status: 'error', message: errText }) };
    }
  } catch (err) {
    console.error("ERROR in complete:", err);
    return { statusCode: 500, body: JSON.stringify({ status: 'error', message: err.message }) };
  }
};
