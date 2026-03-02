const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('stellar-sdk'); 

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY; 

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// إعدادات شبكة Pi
const IS_TESTNET = true; 
const HORIZON_URL = IS_TESTNET ? 'https://api.testnet.minepi.com' : 'https://api.mainnet.minepi.com';
// ✅ تم تصحيح الـ Passphrase بناءً على الكود الخاص بك
const NETWORK_PASSPHRASE = IS_TESTNET ? 'Pi Testnet' : 'Pi Network';

exports.handler = async (event, context) => {
  const headers = { 
    'Access-Control-Allow-Origin': '*', 
    'Access-Control-Allow-Headers': 'Content-Type', 
    'Access-Control-Allow-Methods': 'POST, OPTIONS' 
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { uid, amount, address } = JSON.parse(event.body);
    const withdrawAmount = parseFloat(amount);

    if (!uid || !withdrawAmount || withdrawAmount < 1 || !address || !address.startsWith('G')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "بيانات غير صالحة أو عنوان المحفظة المستلمة خاطئ." }) };
    }
    
    if(!WALLET_PRIVATE_KEY) {
        throw new Error("المفتاح السري للمحفظة غير موجود في إعدادات السيرفر.");
    }

    console.log(`💸 Processing Withdrawal for ${uid}, Amount: ${withdrawAmount}, To: ${address}`);

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

    if (withdrawAmount > actualBalance) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: "رصيدك غير كافٍ لإتمام العملية." }) };
    }

    // =========================================================
    // 2. تهيئة شبكة Pi وبناء المعاملة
    // =========================================================
    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(WALLET_PRIVATE_KEY);
    
    const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

    // ✅ تطبيق التعديلات الجوهرية (الرسوم المحدثة والتوقيت)
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: "100000", // 0.01 Pi لحل خطأ tx_insufficient_fee
      networkPassphrase: NETWORK_PASSPHRASE
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: address,
      asset: StellarSdk.Asset.native(),
      amount: withdrawAmount.toFixed(7).toString()
    }))
    .setTimeout(30) // تم التعديل إلى 30 ثانية لتجنب التعليق
    .build();

    // التوقيع السري
    transaction.sign(sourceKeypair);

    // إرسال المعاملة إلى شبكة البلوكتشين
    const submitRes = await server.submitTransaction(transaction);
    const txid = submitRes.hash; 

    // =========================================================
    // 3. تسجيل العملية في قاعدة البيانات
    // =========================================================
    await supabase.from('withdrawals').insert({
        user_pi_id: uid,
        amount: withdrawAmount,
        status: 'COMPLETED',
        txid: txid
    });

    console.log("✅ Withdrawal Successful! TXID:", txid);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, txid: txid }) };

  } catch (err) {
    // ✅ معالجة الأخطاء المتقدمة مقتبسة من الكود الخاص بك
    console.error("--- ERROR LOG START ---");
    let errorResponse = {
        error: 'فشلت المعاملة',
        details: err.message
    };

    if (err.response && err.response.data && err.response.data.extras) {
        const codes = err.response.data.extras.result_codes;
        const opCodes = codes.operations ? codes.operations.join(', ') : 'no_op_code';
        errorResponse.details = `Blockchain Error: ${codes.transaction} (${opCodes})`;
        
        if (codes.transaction === 'tx_bad_seq') {
            errorResponse.error = 'يوجد ضغط على الشبكة، حاول مرة أخرى بعد لحظات.';
        } else if (codes.transaction === 'tx_insufficient_fee') {
            errorResponse.error = 'رسوم الشبكة مرتفعة حالياً، حاول مرة أخرى.';
        } else if (opCodes.includes('op_underfunded')) {
            errorResponse.error = 'محفظة الموقع (السيرفر) تحتاج شحن رصيد لدفع الرسوم.';
        } else if (opCodes.includes('op_no_destination')) {
            errorResponse.error = 'المحفظة المستلمة غير مفعلة على البلوكتشين.';
        }
    }

    console.error(errorResponse.details);
    console.error("--- ERROR LOG END ---");

    return { statusCode: 400, headers, body: JSON.stringify(errorResponse) };
  }
};
