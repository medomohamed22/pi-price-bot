const { createClient } = require('@supabase/supabase-js');
const StellarSdk = require('stellar-sdk'); // استدعاء مكتبة البلوكتشين

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY; 
const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY; // المفتاح السري لمحفظتك (يبدأ بحرف S)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// إعدادات شبكة Pi Network
const IS_TESTNET = true; // ✅ تم التعديل إلى true لتجربة السحب على شبكة الاختبار (Testnet)
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
    const { uid, amount, address } = JSON.parse(event.body);

    // 1. التحقق من صحة البيانات والعنوان
    if (!uid || !amount || amount < 1 || !address || !address.startsWith('G')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "بيانات غير صالحة أو عنوان المحفظة المستلمة خاطئ." }) };
    }
    
    if(!WALLET_PRIVATE_KEY) {
        throw new Error("المفتاح السري للمحفظة غير موجود في إعدادات السيرفر.");
    }

    console.log(`💸 Processing Withdrawal directly on Blockchain for ${uid}, Amount: ${amount}, To: ${address}`);

    // =========================================================
    // 2. حساب الرصيد الآمن من قاعدة البيانات
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
    // 3. بناء وتوقيع المعاملة مباشرة على البلوكتشين (تخطي Pi API)
    // =========================================================
    
    // ✅ [تم التعديل] استخدام Horizon.Server لحل مشكلة TypeError
    const server = new StellarSdk.Horizon.Server(HORIZON_URL);
    const sourceKeypair = StellarSdk.Keypair.fromSecret(WALLET_PRIVATE_KEY);
    
    // جلب حالة محفظة التطبيق من البلوكتشين لمعرفة الـ Sequence Number
    let sourceAccount;
    try {
        sourceAccount = await server.loadAccount(sourceKeypair.publicKey());
    } catch(e) {
        // ✅ تسجيل الخطأ التفصيلي في Netlify لمعرفة المشكلة بدقة
        console.error("❌ Blockchain Account Error:", e.response ? JSON.stringify(e.response.data) : e);
        throw new Error("فشل الوصول لمحفظة الموقع الرئيسية (تأكد من اختيار Testnet، وتأكد من وجود رصيد أدنى 1 Test-Pi في المحفظة).");
    }

    // تجهيز التحويل
    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE, // رسوم البلوكتشين القياسية (0.01 Pi تقريباً)
      networkPassphrase: NETWORK_PASSPHRASE
    })
    .addOperation(StellarSdk.Operation.payment({
      destination: address,
      asset: StellarSdk.Asset.native(),
      amount: amount.toString()
    }))
    .addMemo(StellarSdk.Memo.text("DealWay Withdraw")) // رسالة تظهر في محفظة المستخدم
    .setTimeout(300) 
    .build();

    // التوقيع السري باستخدام Private Key
    transaction.sign(sourceKeypair);

    // =========================================================
    // 4. إرسال المعاملة الموقعة إلى شبكة البلوكتشين الفعلية
    // =========================================================
    const submitRes = await server.submitTransaction(transaction);
    const txid = submitRes.hash; // معرف المعاملة في البلوكتشين

    // =========================================================
    // 5. تسجيل العملية في قاعدة البيانات لدينا
    // =========================================================
    await supabase.from('withdrawals').insert({
        user_pi_id: uid,
        amount: amount,
        status: 'COMPLETED',
        txid: txid
    });

    console.log("✅ Withdrawal Successful on Blockchain! TXID:", txid);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, txid: txid }) };

  } catch (err) {
    console.error("❌ Withdrawal Error:", err);
    
    // استخراج رسالة الخطأ من البلوكتشين لتسهيل حل المشاكل
    let errorMsg = err.message || "حدث خطأ أثناء السحب.";
    if (err.response && err.response.data && err.response.data.extras) {
        const resultCodes = err.response.data.extras.result_codes;
        errorMsg = "رفض البلوكتشين العملية: " + (resultCodes.operations ? resultCodes.operations.join(", ") : resultCodes.transaction);
    }
    
    return { statusCode: 500, headers, body: JSON.stringify({ error: errorMsg }) };
  }
};
