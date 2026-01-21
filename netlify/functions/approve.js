function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: cors(), body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  }
  
  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing paymentId" }) };
    
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: "PI_SECRET_KEY not set" }) };
    
    const url = `https://api.minepi.com/v2/payments/${paymentId}/approve`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json"
      }
    });
    
    const data = await response.json().catch(() => ({}));
    
    if (!response.ok) {
      return { statusCode: response.status, headers: cors(), body: JSON.stringify({ error: data }) };
    }
    
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ approved: true, data }) };
    
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};
