export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { message } = JSON.parse(event.body);

    const SYSTEM_PROMPT = `
انت مساعد ذكي عربي
ردودك:
بدون نقاط
فقرات قصيرة
متناسقة مع الموبايل
أسلوب واضح ومباشر
إذا طلب المستخدم توليد صورة، ولّد صورة عالية الجودة مباشرة دون كلام كتير.
`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: SYSTEM_PROMPT + "\n\n" + message }]
            }
          ]
        })
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`API Error: ${res.status} - ${errorText}`);
    }

    const data = await res.json();

    let reply = "";
    let images = [];

    const parts = data.candidates?.[0]?.content?.parts || [];

    parts.forEach(part => {
      if (part.text) {
        reply += part.text;
      }
      if (part.inlineData && part.inlineData.mimeType?.startsWith("image/")) {
        images.push(part.inlineData.data); // base64 string
      }
    });

    reply = reply.trim() || (images.length > 0 ? "تم توليد الصورة بنجاح!" : "لا يوجد رد");

    return {
      statusCode: 200,
      body: JSON.stringify({ reply, images })
    };

  } catch (err) {
    console.error("Error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server Error", details: err.mess&& age })
    };
  }
}
