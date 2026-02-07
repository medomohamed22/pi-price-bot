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
      "Content-Type": "application/json",
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

    const { paymentId, txid } = JSON.parse(event.body || "{}");
    if (!paymentId || !txid) return res(400, { error: "Missing paymentId/txid" });

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1) إكمال المعاملة على خوادم Pi Network
    const comp = await piFetch(`/payments/${paymentId}/complete`, {
      method: "POST",
      body: JSON.stringify({ txid }),
    });

    if (!comp.ok) {
      console.warn("Pi complete warning:", comp.status, comp.text);
      // نكمل حتى لو كانت مكتملة بالفعل على Pi
    }

    // 2) جلب بيانات الدفع من Pi API للتأكد
    const getP = await piFetch(`/payments/${paymentId}`);
    const payment = getP.json || {};
    const paymentType = payment.metadata?.type || 'installment';
    const member_id = payment.metadata?.memberId || null;
    const cycle_id = payment.metadata?.cycleId || null;
    const installment_number = payment.metadata?.installment || null;
    const originalAmount = payment.metadata?.originalAmount || payment.amount;
    const platformFee = payment.metadata?.platformFee || 1.00;

    // 3) معالجة حسب نوع الدفع
    if (paymentType === 'insurance') {
      // ==== دفع تأمين ====
      
      // تحديث insurance_deposits
      const { error: insErr } = await supabase
        .from("insurance_deposits")
        .update({
          status: "held",
          txid: txid,
        })
        .eq("payment_id", paymentId);
        
      if (insErr) {
        console.error("Insurance update error:", insErr);
        return res(500, { error: "Failed to update insurance record", details: insErr.message });
      }
      
      // إنشاء إشعار للمستخدم
      await supabase.from("notifications").insert({
        pi_uid: payment.user_uid,
        title: "تم استلام التأمين",
        message: `تم دفع تأمين بمبلغ ${payment.amount} Pi بنجاح. سيُسترد بعد اكتمال الدورة.`,
        type: "system",
      });

    } else {
      // ==== دفع قسط + رسوم ====
      
      // 3.1) إنشاء سجل الدفع الرئيسي في payments
      const { data: paymentRecord, error: payErr } = await supabase
        .from("payments")
        .insert({
          member_id: member_id,
          amount: originalAmount,
          status: "confirmed",
          installment_number: installment_number,
          payment_id: paymentId,
          txid: txid,
        })
        .select()
        .single();

      if (payErr) {
        console.error("Payment insert error:", payErr);
        return res(500, { error: "Failed to create payment record", details: payErr.message });
      }

      // 3.2) تحديث سجل الرسوم وربطه بالدفع
      const { error: feeErr } = await supabase
        .from("platform_fees")
        .update({
          payment_id: paymentRecord.id,
          txid: txid,
          status: "paid",
          paid_at: new Date().toISOString(),
        })
        .eq("pi_payment_id", paymentId);

      if (feeErr) {
        console.error("Fee update error:", feeErr);
        // نستمر لأن الدفع تم بنجاح
      }

      // 3.3) إنشاء إشعار للمستخدم
      await supabase.from("notifications").insert({
        pi_uid: payment.user_uid,
        title: "تم دفع القسط بنجاح",
        message: `تم دفع القسط رقم ${installment_number} بمبلغ ${originalAmount} Pi + ${platformFee} Pi رسوم منصة`,
        type: "payment_received",
        metadata: {
          cycle_id: cycle_id,
          installment_number: installment_number,
          amount: originalAmount,
        }
      });

      // 3.4) التحقق من اكتمال جميع الأقساط وإنشاء تقرير تلقائي
      const { data: memberData } = await supabase
        .from("members")
        .select("cycles(months)")
        .eq("id", member_id)
        .single();
        
      const totalMonths = memberData?.cycles?.months || 0;
      
      const { count: paidCount } = await supabase
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("member_id", member_id)
        .eq("status", "confirmed");
        
      if (paidCount >= totalMonths) {
        // الدورة مكتملة للعضو - إنشاء إشعار
        await supabase.from("notifications").insert({
          pi_uid: payment.user_uid,
          title: "🎉 مبروك! اكتملت الدورة",
          message: `لقد أكملت سداد جميع أقساطك (${totalMonths} أقساط). يمكنك الآن استلام جمعيتك!`,
          type: "cycle_complete",
        });
        
        // استرداد التأمين إذا موجود
        const { data: insurance } = await supabase
          .from("insurance_deposits")
          .select("*")
          .eq("member_id", member_id)
          .eq("status", "held")
          .single();
          
        if (insurance) {
          await supabase
            .from("insurance_deposits")
            .update({ status: "returned", released_at: new Date().toISOString() })
            .eq("id", insurance.id);
            
          await supabase.from("notifications").insert({
            pi_uid: payment.user_uid,
            title: "تم استرداد التأمين",
            message: `تم استرداد مبلغ التأمين ${insurance.amount} Pi لاكتمالك الدورة بنجاح`,
            type: "system",
          });
        }
      }
    }

    return res(200, { 
      ok: true, 
      message: "Transaction completed successfully", 
      paymentId, 
      txid,
      type: paymentType
    });
    
  } catch (e) {
    console.error("complete error:", e);
    return res(500, { error: e.message || "Server error" });
  }
};
