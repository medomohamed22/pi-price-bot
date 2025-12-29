exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const { paymentId } = JSON.parse(event.body || '{}');
  
  if (!paymentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ status: 'error', message: 'Missing paymentId' })
    };
  }
  
  // غير الـ API Key ده بالكي الحقيقي بتاعك من Pi Developer Portal (Testnet)
  const apiKey = 'ayggk5c72chaob65hpvxlnyxthgj8hrzsntegjhneyoasrnuvcpaqewxtqxdvfwu';
  
  try {
    const response = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      }
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