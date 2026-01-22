// netlify/functions/complete.js
const PI_API_BASE = "https://api.minepi.com/v2";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(200, "");
  if (event.httpMethod !== "POST") return res(405, { ok: false, message: "Method Not Allowed" });

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { ok: false, message: "Missing paymentId" });

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;

    // IMPORTANT: server-side privileged key (safe in Netlify ENV only)
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    if (!PI_SECRET_KEY) return res(500, { ok: false, message: "Missing PI_SECRET_KEY" });
    if (!SUPABASE_URL) return res(500, { ok: false, message: "Missing SUPABASE_URL" });
    if (!SUPABASE_SERVICE_ROLE) return res(500, { ok: false, message: "Missing SUPABASE_SERVICE_ROLE" });

    // 1) Fetch payment
    const getR = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    const pay = await getR.json().catch(() => ({}));
    if (!getR.ok) return res(getR.status, { ok: false, message: "payment_fetch_failed", error: pay });

    // 2) Validate memo
    const memo = String(pay?.memo || "");
    if (!memo.startsWith("PROMOTE_AD|")) {
      return res(400, { ok: false, message: "invalid_memo", memo });
    }
    const parts = memo.split("|");
    const adId = parts[1];
    if (!adId) return res(400, { ok: false, message: "missing_adId" });

    // 3) Validate amount
    const amount = Number(pay?.amount);
    if (!Number.isFinite(amount) || amount < 5) {
      return res(400, { ok: false, message: "invalid_amount", amount });
    }

    // 4) Prevent double-complete (store paymentId once)
    // Requires a table: promotions(payment_id text primary key, ad_id uuid/text, created_at timestamptz default now())
    // If you don't have it yet, you can skip this block temporarily.
    const promoCheck = await fetch(
      `${SUPABASE_URL}/rest/v1/promotions?payment_id=eq.${encodeURIComponent(paymentId)}&select=payment_id`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
      }
    );

    if (promoCheck.ok) {
      const existed = await promoCheck.json().catch(() => []);
      if (Array.isArray(existed) && existed.length) {
        return res(200, { ok: true, already_completed: true, paymentId, adId });
      }
    }

    // 5) Load ad & validate ownership (compare seller with payment metadata.username if exists)
    const adR = await fetch(
      `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(adId)}&select=id,seller_username`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
      }
    );
    const adJ = await adR.json().catch(() => []);
    if (!adR.ok || !Array.isArray(adJ) || !adJ.length) {
      return res(404, { ok: false, message: "ad_not_found", adId, error: adJ });
    }
    const seller = adJ[0].seller_username;

    const payerUsername = pay?.metadata?.username; // from front metadata
    if (payerUsername && seller && String(payerUsername) !== String(seller)) {
      return res(403, { ok: false, message: "not_owner_of_ad", seller, payerUsername });
    }

    // 6) Complete Pi payment
    const completeR = await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${PI_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(txid ? { txid } : {}),
    });

    const completeJ = await completeR.json().catch(() => ({}));
    if (!completeR.ok) {
      return res(completeR.status, { ok: false, message: "pi_complete_failed", error: completeJ });
    }

    // 7) Promote ad (extend if already promoted)
    const now = Date.now();
    const promotedUntil = new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString();

    const sbR = await fetch(
      `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(adId)}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ promoted_until: promotedUntil }),
      }
    );

    const sbJ = await sbR.json().catch(() => ({}));
    if (!sbR.ok) return res(sbR.status, { ok: false, message: "supabase_update_failed", error: sbJ });

    // 8) Save promotion record (optional but recommended)
    await fetch(`${SUPABASE_URL}/rest/v1/promotions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ payment_id: paymentId, ad_id: adId }),
    }).catch(() => {});

    return res(200, { ok: true, completed: true, adId, promoted_until: promotedUntil, pi: completeJ });
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
