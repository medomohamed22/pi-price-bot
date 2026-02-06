
const { createClient } = require("@supabase/supabase-js");

const PI_API_KEY = process.env.PI_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const PI_BASE = "https://api.minepi.com/v2";

function res(statusCode, bodyObj) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyObj),
  };
}

async function piFetch(path, opts = {}) {
  const r = await fetch(`${PI_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Key ${PI_API_KEY}`,
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: r.ok, status: r.status, text, json };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return res(200, {});
  if (event.httpMethod !== "POST") return res(405, { error: "Method Not Allowed" });
  
  try {
    if (!PI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return res(500, {
        error: "Missing env vars",
        details: "PI_API_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY",
      });
    }
    
    const { paymentId } = JSON.parse(event.body || "{}");
    if (!paymentId) return res(400, { error: "Missing paymentId" });
    
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    
    // 1) Get current payment details (to know user_uid + metadata)
    const getP = await piFetch(`/payments/${paymentId}`);
    if (!getP.ok) {
      return res(getP.status, { error: "Pi get payment failed", details: getP.text });
    }
    const payment = getP.json || {};
    const pi_uid = payment.user_uid || null;
    
    // 2) Cancel old pending payments for same user (to fix: You already have a pending payment...)
    //    This endpoint returns payments that need server-side action
    const pending = await piFetch(`/payments/incomplete_server_payments`);
    if (pending.ok && pending.json) {
      // response could be array OR { incomplete_server_payments: [...] } depending on API
      const list =
        Array.isArray(pending.json) ? pending.json :
        (pending.json.incomplete_server_payments || pending.json.data || []);
      
      const sameUserOld = (list || []).filter(p => {
        const pid = p.identifier || p.payment_id || p.id;
        const uid = p.user_uid || p.user_identifier || p.user;
        return uid && pid && uid === pi_uid && pid !== paymentId;
      });
      
      // Cancel up to a few to be safe (avoid huge loops)
      for (const p of sameUserOld.slice(0, 10)) {
        const oldId = p.identifier || p.payment_id || p.id;
        const cancelR = await piFetch(`/payments/${oldId}/cancel`, { method: "POST" });
        // even if cancel fails, continue (we'll try approve current anyway)
      }
    }
    
    // 3) Approve current payment
    const approveR = await piFetch(`/payments/${paymentId}/approve`, { method: "POST" });
    if (!approveR.ok) {
      return res(approveR.status, { error: "Pi approve failed", details: approveR.text });
    }
    
    // 4) Save/update in Supabase payments table (idempotent upsert)
    const cycle_id = payment?.metadata?.cycleId ?? payment?.metadata?.cycle_id ?? null;
    const month = payment?.metadata?.month ?? null;
    
    const row = {
      payment_id: paymentId,
      pi_uid,
      cycle_id,
      month,
      amount_pi: payment?.amount ?? null,
      memo: payment?.memo ?? null,
      status: "approved",
      raw_json: payment,
    };
    
    // upsert by payment_id (requires unique constraint on payment_id)
    const { error: upErr } = await supabase
      .from("payments")
      .upsert(row, { onConflict: "payment_id" });
    
    if (upErr) {
      return res(500, { error: "Supabase upsert failed", details: upErr.message });
    }
    
    return res(200, { ok: true, message: "Approved", paymentId });
  } catch (e) {
    console.error("approve error:", e);
    return res(500, { error: e.message || "Server error" });
  }
};
