// netlify/functions/approve.js
const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(200, "");
  if (event.httpMethod !== "POST") return res(405, { ok: false, message: "Method Not Allowed" });

  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { ok: false, message: "Missing paymentId" });

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) return res(500, { ok: false, message: "Missing PI_SECRET_KEY" });

    // Approve payment
    const approveR = await fetch(`${PI_API_BASE}/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const approveJ = await approveR.json().catch(() => ({}));

    if (!approveR.ok) {
      console.log("APPROVE_FAIL", approveR.status, approveJ);
      return res(approveR.status, { ok: false, message: "pi_approve_failed", error: approveJ });
    }

    return res(200, { ok: true, approved: true, pi: approveJ });
  } catch (e) {
    console.log("APPROVE_ERR", e);
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
