const PiNetwork = require('pi-nodejs'); // الـ SDK

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  
  const { userUid, amount, memo = 'سحب من Donate Way' } = JSON.parse(event.body);
  
  if (!userUid || !amount || amount <= 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'بيانات ناقصة' }) };
  }
  
  const API_KEY = process.env.PI_SECRET_KEY;
  const WALLET_PRIVATE_SEED = process.env.PI_WALLET_PRIVATE_SEED;
  
  if (!API_KEY || !WALLET_PRIVATE_SEED) {
    return { statusCode: 500, body: JSON.stringify({ error: 'مشكلة في إعداد السيرفر' }) };
  }
  
  const pi = new PiNetwork(API_KEY, WALLET_PRIVATE_SEED);
  
  try {
    // إنشاء الدفع A2U
    const payment = await pi.createPayment({
      amount: parseFloat(amount),
      memo,
      metadata: { type: 'withdraw' },
      uid: userUid
    });
    
    // submit على البلوكشين
    const txid = await pi.submitPayment(payment.identifier);
    
    // إكمال
    const completed = await pi.completePayment(payment.identifier, txid);
    
    if (completed.status === 'completed') {
      return { statusCode: 200, body: JSON.stringify({ success: true, txid, message: 'تم السحب بنجاح!' }) };
    } else {
      return { statusCode: 500, body: JSON.stringify({ error: 'فشل الإكمال', details: completed }) };
    }
  } catch (err) {
    console.error('خطأ A2U:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'خطأ في السحب' }) };
  }
};
