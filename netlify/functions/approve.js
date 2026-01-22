// netlify/functions/approve.js
const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return res(200, "");
  }

  if (event.httpMethod !== "POST") {
    return res(405, { ok: false, message: "Method Not Allowed" });
  }

  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { ok: false, message: "Missing paymentId" });

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return res(500, { ok: false, message: "Missing PI_SECRET_KEY" });

    const r = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const j = await r.json().catch(() => ({}));

    if (!r.ok) {
      return res(r.status, { ok: false, message: "approve_failed", error: j });
    }

    return res(200, { ok: true, approved: true, paymentId });
  } catch (e) {
    return res(500, { ok: false, message: "server_error", error: String(e) });
  }
};

function res(code, body) {
  return {
    statusCode: code,
    headers: cors(),
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}
function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
