const fetch = require('node-fetch');

exports.handler = async (event) => {
  console.log("==== PI COMPLETE FUNCTION ====");
  console.log("RAW BODY:", event.body);

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: 'Method Not Allowed'
    };
  }

  let paymentId, txid;
  try {
    const body = JSON.parse(event.body || '{}');
    paymentId = body.paymentId;
    txid = body.txid;
  } catch (err) {
    console.error("JSON PARSE ERROR:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid JSON body' })
    };
  }

  console.log("PAYMENT ID:", paymentId);
  console.log("TXID:", txid);

  if (!paymentId || !txid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing paymentId or txid' })
    };
  }

  const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
  const PI_API_BASE = 'https://api.minepi.com/v2';

  try {
    const response = await fetch(
      `${PI_API_BASE}/payments/${paymentId}/complete`,
      {
        method: 'POST',
        headers: {
          Authorization: `Key ${PI_SECRET_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ txid })
      }
    );

    const text = await response.text();
    console.log("PI COMPLETE RESPONSE:", text);

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: text
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ completed: true })
    };

  } catch (err) {
    console.error("COMPLETE ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
