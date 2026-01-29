export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    
    const body = await request.json().catch(() => ({}));
    const { prompt, model, temperature, max_tokens } = body;
    
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing GROQ_API_KEY in Netlify env vars" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    
    const system = `
You are a senior fullstack engineer.
Return a helpful answer in plain text.
When asked for an app/site, include:
- short spec
- file structure
- code per file
Keep it complete.
`.trim();
    
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || "llama-3.1-70b-versatile",
        temperature: typeof temperature === "number" ? temperature : 0.2,
        max_tokens: typeof max_tokens === "number" ? max_tokens : 1200,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
    });
    
    const data = await r.json().catch(() => ({}));
    
    if (!r.ok) {
      return new Response(
        JSON.stringify({
          error: data?.error?.message || "Groq API error",
          status: r.status,
          raw: data,
        }),
        {
          status: 502,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        }
      );
    }
    
    const text = data?.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
