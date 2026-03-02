const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('stellar-sdk'); // استدعاء مكتبة البلوكتشين

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const PI_API_KEY = process.env.PI_API_KEY;
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY; // المفتاح السري لمحفظة التطبيق (يبدأ بحرف S)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// إعدادات شبكة Pi Network
const IS_TESTNET = false; // اجعلها true لو بتجرب على شبكة الـ Testnet
const PI_API_BASE = 'https://api.minepi.com/v2';
const HORIZON_URL = IS_TESTNET ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com';
const NETWORK_PASSPHRASE = IS_TESTNET ? 'Pi Network Testnet' : 'Pi Network Mainnet';

exports.handler = async (event, context) => {
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'Content-Type', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS' 
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    // 1. استقبال البيانات وتتضمن الآن عنوان المحفظة (address)
    const { uid, amount, address } = JSON.parse(event.body);

    // 2. التحقق من صحة البيانات والعنوان (يجب أن يبدأ بحرف G)
    if (!uid || !amount || amount < 1 || !address || !address.startsWith('G')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "بيانات غير صالحة أو عنوان المحفظة خاطئ." }) };
    }
    
    if(!WALLET_PRIVATE_KEY) {
        throw new Error("Missing WALLET_PRIVATE_KEY in Netlify environments.");
    }

    console.log(`💸 Processing Withdrawal for ${uid}, Amount: ${amount}, To: ${address}`);

    // =========================================================
    // 1. حساب الرصيد الآمن من قاعدة البيانات
    // =========================================================
    const { data: escrows } = await supabase.from('escrow_transactions').select('amount').eq('seller_pi_id', uid).eq('status', 'COMPLETED');
    let totalEarned = 0;
    if (escrows) escrows.forEach(e => totalEarned += parseFloat(e.amount));

    const { data: withdrawals } = await supabase.from('withdrawals').select('amount').eq('user_pi_id', uid);
    let totalWithdrawn = 0;
    if (withdrawals) withdrawals.forEach(w => totalWithdrawn += parseFloat(w.amount));

    const actualBalance = totalEarned - totalWithdrawn;

    if (amount > actualBalance) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "رصيدك غير كافٍ لإتمام العملية." }) };
    }

    // =========================================================
    // 2. طلب إذن الدفع من Pi API 
    // =========================================================
    const createRes = await fetch(`${PI_API_BASE}/payments`, {
        method: 'POST',
        headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            payment: {
                amount: parseFloat(amount),
                memo: "Withdraw from Deal Way",
                metadata: { type: "withdrawal", to_address: address }, // حفظ العنوان في السجلات
                uid: uid 
            }
        })
    });

    const paymentData = await createRes.json();
    if (!createRes.ok) throw new Error("فشل إنشاء المعاملة في سيرفر Pi");
    
    const paymentId = paymentData.identifier;
    // لم نعد نعتمد على paymentData.to_address الافتراضي، سنستخدم المتغير address مباشرة.

    // =========================================================
    // 3. بناء وتوقيع المعاملة على البلوكتشين (Stellar/Pi Horizon)
    // =========================================================
    const server = new StellarSdk.Server(HORIZON_URL);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(WALLET_PRIVATE_KEY);
    
    // جلب حالة محفظة التطبيق من البلوكتشين
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: address, // استخدام العنوان الذي أدخله المستخدم في الواجهة
      asset: StellarSdk.Asset.native(),
      amount: amount.toString()
    }))
    .addMemo(StellarSdk.Memo.text(paymentId)) // Pi تشترط وجود معرف المعاملة في الـ Memo
    .setTimeout(300) 
    .build();

    // التوقيع السري
    transaction.sign(sourceKeypair);

    // =========================================================
    // 4. إرسال المعاملة الموقعة إلى شبكة البلوكتشين
    // =========================================================
    const submitRes = await server.submitTransaction(transaction);
    const txid = submitRes.hash; // معرف المعاملة في البلوكتشين

    // =========================================================
    // 5. إبلاغ سيرفرات Pi أن المعاملة تمت بنجاح
    // =========================================================
    await fetch(`${PI_API_BASE}/payments/${paymentId}/complete`, {
        method: 'POST',
        headers: { 'Authorization': `Key ${PI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ txid: txid })
    });

    // =========================================================
    // 6. تسجيل العملية في قاعدة البيانات
    // =========================================================
    await supabase.from('withdrawals').insert({
        user_pi_id: uid,
        amount: amount,
        status: 'COMPLETED',
        txid: txid
    });

    console.log("✅ Withdrawal Successful! TXID:", txid);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, txid: txid }) };

  } catch (err) {
    console.error("❌ Withdrawal Error:", err);
    // إرجاع تفاصيل الخطأ لتسهيل التتبع
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || "حدث خطأ أثناء السحب." }) };
  }
};
