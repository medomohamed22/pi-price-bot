// netlify/functions/complete.js
// Complete Pi payment + Promote Ad using PUBLIC Supabase keys (as requested)

const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return res(200, "");
  }

  if (event.httpMethod !== "POST") {
    return res(405, { ok: false, message: "Method Not Allowed" });
  }

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { ok: false, message: "Missing paymentId" });

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;

    const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON = process.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!PI_SECRET_KEY) return res(500, { ok: false, message: "Missing PI_SECRET_KEY" });
    if (!SUPABASE_URL || !SUPABASE_ANON)
      return res(500, { ok: false, message: "Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_ANON_KEY" });

    /* ===== 1) Get payment info ===== */
    const getR = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });

    const pay = await getR.json().catch(() => ({}));
    if (!getR.ok) return res(getR.status, { ok: false, message: "payment_fetch_failed", error: pay });

    /* ===== 2) Validate memo ===== */
    const memo = String(pay?.memo || "");
    if (!memo.startsWith("PROMOTE_AD|")) {
      return res(400, { ok: false, message: "invalid_memo", memo });
    }

    const parts = memo.split("|");
    const adId = parts[1];
    if (!adId) return res(400, { ok: false, message: "missing_adId" });

    /* ===== 3) Validate amount ===== */
    const amount = Number(pay?.amount);
    if (!Number.isFinite(amount) || amount < 5) {
      return res(400, { ok: false, message: "invalid_amount", amount });
    }

    /* ===== 4) Complete Pi payment ===== */
    const completeR = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(txid ? { txid } : {}),
    });

    const completeJ = await completeR.json().catch(() => ({}));
    if (!completeR.ok) return res(completeR.status, { ok: false, message: "pi_complete_failed", error: completeJ });

    /* ===== 5) Promote Ad in Supabase ===== */
    const promotedUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

    const sbR = await fetch(
      `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(adId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ promoted_until: promotedUntil }),
      }
    );

    const sbJ = await sbR.json().catch(() => ({}));
    if (!sbR.ok) return res(sbR.status, { ok: false, message: "supabase_update_failed", error: sbJ });

    return res(200, {
      ok: true,
      completed: true,
      adId,
      promoted_until: promotedUntil,
    });

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
