const fetch = require('node-fetch');

exports.handler = async (event) => {
  console.log("==== PI APPROVE FUNCTION ====");
  console.log("RAW BODY:", event.body);

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  let paymentId;
  try {
    const body = JSON.parse(event.body || '{}');
    paymentId = body.paymentId;
  } catch (err) {
    console.error("JSON PARSE ERROR:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  console.log("PAYMENT ID:", paymentId);

  if (!paymentId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing paymentId' })
    };
  }

  const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
  const PI_API_BASE = 'https://api.minepi.com/v2';

  try {
    const response = await fetch(
      `${PI_API_BASE}/payments/${paymentId}/approve`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${PI_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const text = await response.text();
    console.log("PI APPROVE RESPONSE:", text);

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: text
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ approved: true })
    };

  } catch (err) {
    console.error("APPROVE ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
