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
أسلوب واضح
`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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

    const data = await res.json();

    const reply =
      data.candidates?.[0]?.content?.parts?.[0]?.text ||
      "لا يوجد رد";

    return {
      statusCode: 200,
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server Error" })
    };
  }
}
