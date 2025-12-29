exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const { paymentId, txid } = JSON.parse(event.body || '{}');
  
  if (!paymentId || !txid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ status: 'error', message: 'Missing paymentId or txid' })
    };
  }
  
  // نفس الـ API Key زي اللي فوق
  const apiKey = 'ayggk5c72chaob65hpvxlnyxthgj8hrzsntegjhneyoasrnuvcpaqewxtqxdvfwu';
  
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
      return {
        statusCode: 200,
        body: JSON.stringify({ status: 'success' })
      };
    } else {
      const errText = await response.text();
      return {
        statusCode: 500,
        body: JSON.stringify({ status: 'error', message: errText })
      };
    }
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ status: 'error', message: error.message })
    };
  }
};