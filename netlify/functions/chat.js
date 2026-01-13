// استدعاء المكتبة الصحيحة
const { GoogleGenerativeAI } = require("@google/generative-ai");

// تأكد أنك وضعت GEMINI_API_KEY في ملف .env أو إعدادات Netlify
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function main(prompt) {
  try {
    // تحديد الموديل (تأكد من استخدام إصدار مدعوم مثل gemini-1.5-flash أو gemini-pro)
    // ملاحظة: الإصدار 2.5 غير متاح حالياً، الأحدث هو 1.5 أو 2.0 Flash
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error("خطأ في Gemini:", error);
    return "عذراً، حدث خطأ في معالجة الطلب.";
  }
}

// إذا كنت تستخدمه كـ Netlify Function
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  
  const { prompt } = JSON.parse(event.body);
  const reply = await main(prompt);
  
  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reply: reply }),
  };
};
