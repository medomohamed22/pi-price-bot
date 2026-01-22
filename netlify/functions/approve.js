export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  
  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return { statusCode: 400, body: JSON.stringify({ error: "Missing paymentId" }) };
    
    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return { statusCode: 500, body: JSON.stringify({ error: "Missing PI_SECRET_KEY" }) };
    
    const r = await fetch(`https://api.minepi.com/v2/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });
    
    const data = await r.json().catch(() => ({}));
    return { statusCode: r.ok ? 200 : r.status, body: JSON.stringify({ ok: r.ok, data }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: "Server error", details: String(e) }) };
  }
};
