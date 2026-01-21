const { createClient } = require("@supabase/supabase-js");

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS"
  };
}

function getSupabase() {
  const SUPABASE_URL = process.env.SUPABASE_URL || "https://axjkwrssmofzavaoqutq.supabase.co";
  const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_tiuMncgWhf1YRWoD-uYQ3Q_ziI8OKci";
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: cors(), body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors(), body: "Method Not Allowed" };
  
  try {
    const { uid } = JSON.parse(event.body || "{}");
    if (!uid) return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: "Missing uid" }) };
    
    const supabase = getSupabase();
    
    const { data: donations, error: dErr } = await supabase
      .from("donations")
      .select("amount, payment_id, txid, created_at")
      .eq("pi_user_id", uid)
      .order("created_at", { ascending: false });
    
    if (dErr) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: dErr }) };
    
    const { data: withdrawals, error: wErr } = await supabase
      .from("withdrawals")
      .select("amount, wallet_address, txid, created_at")
      .eq("pi_user_id", uid)
      .order("created_at", { ascending: false });
    
    if (wErr) return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: wErr }) };
    
    const totalDonated = (donations || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const totalWithdrawn = (withdrawals || []).reduce((s, r) => s + Number(r.amount || 0), 0);
    const balance = totalDonated - totalWithdrawn;
    
    const lastTx = [
      ...(donations || []).slice(0, 5).map(x => ({ type: "donation", ...x })),
      ...(withdrawals || []).slice(0, 5).map(x => ({ type: "withdraw", ...x })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    return { statusCode: 200, headers: cors(), body: JSON.stringify({ totalDonated, totalWithdrawn, balance, lastTx }) };
    
  } catch (err) {
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: err.message }) };
  }
};
