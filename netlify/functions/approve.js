// netlify/functions/approve.js
// Approve Pi payment (server-side) using PI_SECRET_KEY

const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  // CORS
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: false, message: "Method Not Allowed" }),
    };
  }

  try {
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: false, message: "Missing paymentId" }),
      };
    }

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;
    if (!PI_SECRET_KEY) {
      return {
        statusCode: 500,
        headers: corsHeaders(),
        body: JSON.stringify({ ok: false, message: "Missing PI_SECRET_KEY env" }),
      };
    }

    const r = await fetch(`${PI_API_BASE}/payments/${encodeURIComponent(paymentId)}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      return {
        statusCode: r.status,
        headers: corsHeaders(),
        body: JSON.stringify({
          ok: false,
          message: "approve_failed",
          error: json,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: true,
        approved: true,
        paymentId,
        pi: json, // مفيد للتشخيص
      }),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        ok: false,
        message: "server_error",
        error: String(e?.message || e),
      }),
    };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
