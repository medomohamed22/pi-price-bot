
import Groq from "groq-sdk";

/**
 * Groq models (official, currently listed in Groq docs)
 * - llama-3.3-70b-versatile (production)
 * - llama-3.1-8b-instant (production)
 * - mixtral-8x7b-32768 (commonly supported on Groq)
 * - llama-3.3-70b-specdec (model card exists in Groq docs)
 *
 * Source: Groq model docs & deprecations. 1
 */
const SUPPORTED_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
  "llama-3.3-70b-specdec",
];

// Default fallback order (more capable first, then faster/cheaper)
const FALLBACK_ORDER = [
  "llama-3.3-70b-versatile",
  "mixtral-8x7b-32768",
  "llama-3.1-8b-instant",
  "llama-3.3-70b-specdec",
];

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function normalizeNumber(x, fallback) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function buildErrorHelp(errObj) {
  const code = errObj?.error?.code || errObj?.code;
  const msg = errObj?.error?.message || errObj?.message || "Unknown error";

  // Groq’s error codes we’ve seen:
  // - model_decommissioned
  // - model_permission_blocked_project
  // - rate_limit_exceeded (or similar)
  // - invalid_request_error
  let fix = "جرّب تاني أو قلّل max_tokens.";

  if (code === "model_permission_blocked_project") {
    fix =
      "الموديل مقفول على مستوى Project. ادخل Groq Console > Settings > Project > Limits وفعّل الموديل.";
  } else if (code === "model_decommissioned") {
    fix =
      "الموديل اتشال (decommissioned). اختار موديل تاني من القائمة المدعومة.";
  } else if (code === "invalid_request_error") {
    fix = "راجع المدخلات: model / messages / max_tokens / temperature.";
  }

  return { code, msg, fix };
}

async function callGroq({ groq, model, messages, temperature, max_tokens }) {
  // groq-sdk uses Chat Completions endpoint
  return groq.chat.completions.create({
    model,
    messages,
    temperature,
    max_tokens,
  });
}

function pickFallbackModels(requestedModel) {
  // If user asked for a model (and it's in our known list), start with it
  // then add the rest from FALLBACK_ORDER without duplicates.
  const picked = [];
  if (requestedModel && typeof requestedModel === "string") {
    picked.push(requestedModel.trim());
  }
  for (const m of FALLBACK_ORDER) {
    if (!picked.includes(m)) picked.push(m);
  }
  // Keep only models in SUPPORTED_MODELS (or allow unknown? safer to restrict)
  return picked.filter((m) => SUPPORTED_MODELS.includes(m));
}

export default async (request) => {
  try {
    if (request.method === "OPTIONS") {
      // If you ever serve cross-origin, you can add CORS headers here.
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ ok: false, error: "Method Not Allowed" }, 405);
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return json(
        { ok: false, error: "Missing GROQ_API_KEY in Netlify env vars" },
        500
      );
    }

    const body = await request.json().catch(() => ({}));

    /**
     * Accept either:
     * 1) { prompt: "..." }  => we wrap as user message
     * 2) { messages: [...] } => use directly
     */
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const messages = Array.isArray(body.messages) ? body.messages : null;

    if (!messages && !prompt) {
      return json(
        {
          ok: false,
          error: "Missing prompt or messages",
          expected: {
            prompt: "string",
            OR: { messages: [{ role: "user", content: "..." }] },
          },
        },
        400
      );
    }

    // Build messages safely
    const finalMessages =
      messages ||
      [
        {
          role: "system",
          content:
            "You are a senior fullstack engineer. Reply in plain text. When asked for code, include clear file sections (FILE: name) and complete code.",
        },
        { role: "user", content: prompt },
      ];

    // Model validation
    const requestedModel =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : "llama-3.3-70b-versatile";

    // If user requests an unknown model, we reject with helpful list
    if (!SUPPORTED_MODELS.includes(requestedModel)) {
      return json(
        {
          ok: false,
          error: "Unsupported model name for this endpoint",
          requestedModel,
          supportedModels: SUPPORTED_MODELS,
          hint:
            "اختار موديل من supportedModels. (ولو Groq أضاف موديلات جديدة، زوّدها في SUPPORTED_MODELS).",
        },
        400
      );
    }

    const temperature = normalizeNumber(body.temperature, 0.2);
    const max_tokens = Math.max(64, Math.min(4096, normalizeNumber(body.max_tokens, 1200)));

    const groq = new Groq({ apiKey });

    // Try requested model then fallbacks (1 retry max beyond requested to avoid wasting tokens)
    const candidates = pickFallbackModels(requestedModel);

    let lastError = null;
    let usedModel = null;

    for (let i = 0; i < candidates.length; i++) {
      const model = candidates[i];
      try {
        const resp = await callGroq({
          groq,
          model,
          messages: finalMessages,
          temperature,
          max_tokens,
        });

        const text = resp?.choices?.[0]?.message?.content ?? "";
        usedModel = model;

        return json({
          ok: true,
          model: usedModel,
          text,
          usage: resp?.usage || null,
        });
      } catch (e) {
        // groq-sdk throws errors with payload sometimes; try to parse
        const raw =
          e?.response?.data ||
          e?.data ||
          (typeof e?.message === "string" ? { message: e.message } : e);

        const help = buildErrorHelp(raw);
        lastError = { raw, help, triedModel: model };

        // If it’s a model permission/decommission issue, try next fallback
        if (
          help.code === "model_permission_blocked_project" ||
          help.code === "model_decommissioned"
        ) {
          continue;
        }

        // For other errors (rate limits, invalid request), stop early (don’t spam retries)
        break;
      }
    }

    return json(
      {
        ok: false,
        error: lastError?.help?.msg || "Groq call failed",
        code: lastError?.help?.code || null,
        fix: lastError?.help?.fix || null,
        triedModels: candidates,
        lastTriedModel: lastError?.triedModel || null,
        raw: lastError?.raw || null,
      },
      502
    );
  } catch (e) {
    return json(
      {
        ok: false,
        error: e?.message || String(e),
      },
      500
    );
  }
};
