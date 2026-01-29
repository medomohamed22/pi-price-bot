export default async (req) => {
  try {
    if (req.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
    }
    
    const { prompt, model, temperature, max_tokens } = JSON.parse(req.body || "{}");
    
    if (!prompt || typeof prompt !== "string") {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing prompt" }) };
    }
    
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing GROQ_API_KEY in env vars" }) };
    }
    
    // Prompt قوي لتوليد كود/مود
    const system = `
You are a senior fullstack engineer.
Return ONLY the final answer as plain text (no markdown fences).
If user asks for a website/app, produce:
- Project spec (short)
- Pages list
- Database SQL (Supabase) if requested
- Suggested file structure
- Then provide code snippets per file.
Be concise but complete.
`;
    
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model || "llama3-70b-8192",
        temperature: typeof temperature === "number" ? temperature : 0.3,
        max_tokens: typeof max_tokens === "number" ? max_tokens : 1800,
        messages: [
          { role: "system", content: system.trim() },
          { role: "user", content: prompt }
        ]
      })
    });
    
    const data = await r.json();
    
    if (!r.ok) {
      return {
        statusCode: r.status,
        body: JSON.stringify({ error: data?.error?.message || "Groq API error", raw: data })
      };
    }
    
    const text = data?.choices?.[0]?.message?.content ?? "";
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ text })
    };
    
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};