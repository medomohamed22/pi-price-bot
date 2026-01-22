


// netlify/functions/complete.js
const PI_API_BASE = "https://api.minepi.com/v2";
const DAYS = 3;
const PRICE = 5;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(200, "");
  if (event.httpMethod !== "POST") return res(405, { ok: false, message: "Method Not Allowed" });

  try {
    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { ok: false, message: "Missing paymentId" });

    const PI_SECRET_KEY = process.env.PI_SECRET_KEY;

    // Server-side privileged key
    const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    if (!PI_SECRET_KEY) return res(500, { ok: false, message: "Missing PI_SECRET_KEY" });
    if (!SUPABASE_URL) return res(500, { ok: false, message: "Missing PUBLIC_SUPABASE_URL" });
    if (!SUPABASE_SERVICE_ROLE) return res(500, { ok: false, message: "Missing SUPABASE_SERVICE_ROLE" });

    // 1) Fetch payment
    const getR = await fetch(`${PI_API_BASE}/payments/${paymentId}`, {
      headers: { Authorization: `Key ${PI_SECRET_KEY}` },
    });
    const pay = await getR.json().catch(() => ({}));
    if (!getR.ok) {
      console.log("PAYMENT_FETCH_FAIL", getR.status, pay);
      return res(getR.status, { ok: false, message: "payment_fetch_failed", error: pay });
    }

    // 2) Validate memo
    const memo = String(pay?.memo || "");
    if (!memo.startsWith("PROMOTE_AD|")) {
      console.log("INVALID_MEMO", memo);
      return res(400, { ok: false, message: "invalid_memo", memo });
    }
    const parts = memo.split("|");
    const adId = parts[1];
    if (!adId) return res(400, { ok: false, message: "missing_adId" });

    // 3) Validate amount
    const amount = Number(pay?.amount);
    if (!Number.isFinite(amount) || amount < PRICE) {
      console.log("INVALID_AMOUNT", amount, pay);
      return res(400, { ok: false, message: "invalid_amount", amount });
    }

    // 4) Optional: Prevent double processing by promotions table
    // لو جدول promotions مش موجود، هنتجاهل
    let alreadyRecorded = false;
    try {
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
        if (Array.isArray(existed) && existed.length) alreadyRecorded = true;
      }
    } catch (e) {
      // ignore
    }

    // 5) Load ad (get current promoted_until to extend)
    const adR = await fetch(
      `${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(adId)}&select=id,seller_username,promoted_until`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        },
      }
    );
    const adJ = await adR.json().catch(() => []);
    if (!adR.ok || !Array.isArray(adJ) || !adJ.length) {
      console.log("AD_NOT_FOUND", adR.status, adJ);
      return res(404, { ok: false, message: "ad_not_found", adId, error: adJ });
    }

    const seller = adJ[0].seller_username;
    const currentPromotedMs = adJ[0].promoted_until ? new Date(adJ[0].promoted_until).getTime() : 0;

    // 6) Ownership check (optional)
    const payerUsername = pay?.metadata?.username;
    if (payerUsername && seller && String(payerUsername) !== String(seller)) {
      console.log("NOT_OWNER", { seller, payerUsername });
      return res(403, { ok: false, message: "not_owner_of_ad", seller, payerUsername });
    }

    // 7) Complete Pi payment (IDEMPOTENT)
    // لو already completed: نكمل تحديث الإعلان/تسجيل promotions
    let completedOk = false;

    const statusLower = String(pay?.status || "").toLowerCase();
    if (statusLower === "completed") {
      completedOk = true;
    } else {
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
        // ✅ Idempotent: لو Pi قال already completed نعتبره نجاح
        const msg = String(
          completeJ?.error_message ||
          completeJ?.message ||
          completeJ?.error ||
          ""
        ).toLowerCase();

        const alreadyCompleted =
          msg.includes("already") && msg.includes("complete");

        if (!alreadyCompleted) {
          console.log("PI_COMPLETE_FAIL", completeR.status, completeJ);
          return res(completeR.status, { ok: false, message: "pi_complete_failed", error: completeJ });
        }
      }

      completedOk = true;
    }

    if (!completedOk) {
      return res(500, { ok: false, message: "complete_unknown_state" });
    }

    // 8) Promote/Extend
    const base = Math.max(Date.now(), currentPromotedMs || 0);
    const promotedUntil = new Date(base + DAYS * 24 * 60 * 60 * 1000).toISOString();

    const sbR = await fetch(`${SUPABASE_URL}/rest/v1/ads?id=eq.${encodeURIComponent(adId)}`, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_SERVICE_ROLE,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ promoted_until: promotedUntil }),
    });

    const sbJ = await sbR.json().catch(() => ({}));
    if (!sbR.ok) {
      console.log("SUPABASE_UPDATE_FAIL", sbR.status, sbJ);
      return res(sbR.status, { ok: false, message: "supabase_update_failed", error: sbJ });
    }

    // 9) Save promotion record (optional)
    if (!alreadyRecorded) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/promotions`, {
          method: "POST",
          headers: {
            apikey: SUPABASE_SERVICE_ROLE,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ payment_id: paymentId, ad_id: adId }),
        });
      } catch (e) {
        // ignore
      }
    }

    return res(200, {
      ok: true,
      completed: true,
      adId,
      promoted_until: promotedUntil,
    });

  } catch (e) {
    console.log("COMPLETE_ERR", e);
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
