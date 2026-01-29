const promptEl = document.getElementById("prompt");
const modelEl = document.getElementById("model");
const tempEl = document.getElementById("temp");
const maxTokensEl = document.getElementById("maxTokens");
const outEl = document.getElementById("output");

const genBtn = document.getElementById("genBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");

const statusChip = document.getElementById("statusChip");
const statusText = document.getElementById("statusText");

// عناصر جديدة في index.html الأخير
const usedModelEl = document.getElementById("usedModel");
const usageTokensEl = document.getElementById("usageTokens");

const errorBox = document.getElementById("errorBox");
const errorMsg = document.getElementById("errorMsg");
const errorFix = document.getElementById("errorFix");
const errorMeta = document.getElementById("errorMeta");

function setStatus(text, busy = false) {
  statusText.textContent = text;
  statusChip.style.opacity = busy ? "0.95" : "1";
  genBtn.disabled = !!busy;
  genBtn.style.opacity = busy ? "0.75" : "1";
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function showErrorBox({ message, fix, code, triedModels, lastTriedModel }) {
  if (!errorBox) return;

  errorBox.style.display = "block";
  if (errorMsg) errorMsg.textContent = message || "حصل خطأ غير معروف.";
  if (errorFix) errorFix.textContent = fix ? `✅ حل مقترح: ${fix}` : "";
  if (errorMeta) {
    const metaLines = [];
    if (code) metaLines.push(`Code: ${code}`);
    if (lastTriedModel) metaLines.push(`Last tried: ${lastTriedModel}`);
    if (Array.isArray(triedModels) && triedModels.length) metaLines.push(`Tried models: ${triedModels.join(", ")}`);
    errorMeta.textContent = metaLines.join(" • ");
  }
}

function hideErrorBox() {
  if (!errorBox) return;
  errorBox.style.display = "none";
  if (errorMsg) errorMsg.textContent = "";
  if (errorFix) errorFix.textContent = "";
  if (errorMeta) errorMeta.textContent = "";
}

function setMeta({ modelUsed, usage }) {
  if (usedModelEl) usedModelEl.textContent = modelUsed || "—";

  // usage ممكن يبقى object زي { prompt_tokens, completion_tokens, total_tokens }
  const total =
    usage?.total_tokens ??
    (Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens)
      ? usage.prompt_tokens + usage.completion_tokens
      : null);

  if (usageTokensEl) usageTokensEl.textContent = (total ?? "—").toString();
}

genBtn.addEventListener("click", async () => {
  const userPrompt = (promptEl.value || "").trim();
  if (!userPrompt) {
    outEl.textContent = "اكتب وصف للتطبيق الأول 🙂";
    return;
  }

  hideErrorBox();
  setMeta({ modelUsed: "—", usage: null });

  setStatus("جاري التوليد…", true);
  outEl.textContent = "⏳ بنولّد…";

  const payload = {
    prompt: userPrompt,
    model: modelEl.value,
    temperature: Number(tempEl.value || 0.2),
    max_tokens: Number(maxTokensEl.value || 1200),
  };

  try {
    const res = await fetch("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    // لو فيه موديل تم استخدامه حتى في حالة error (أحيانًا)، اعرضه
    setMeta({ modelUsed: data?.model, usage: data?.usage });

    if (!res.ok || data?.ok === false) {
      // شكل الأخطاء من generate.js: { ok:false, error, code, fix, triedModels, lastTriedModel, raw }
      const message = data?.error || `HTTP ${res.status}`;
      const fix = data?.fix || "";
      const code = data?.code || data?.raw?.error?.code || "";
      const triedModels = data?.triedModels || [];
      const lastTriedModel = data?.lastTriedModel || "";

      // اظهر تفاصيل نظيفة + داخل صندوق
      showErrorBox({ message, fix, code, triedModels, lastTriedModel });

      // وحط تفاصيل كاملة تحت لو حابب
      outEl.textContent =
        `❌ حصل خطأ:\n${message}\n` +
        (fix ? `\n${fix}\n` : "\n") +
        `\nتفاصيل:\n${JSON.stringify(data, null, 2)}`;

      setStatus("خطأ", false);
      return;
    }

    // نجاح: { ok:true, model, text, usage }
    const text = data?.text ?? "";
    outEl.textContent = text || "// الرد رجع فاضي.";
    setMeta({ modelUsed: data?.model, usage: data?.usage });

    setStatus("تم ✅", false);
  } catch (err) {
    const message = err?.message || String(err);
    showErrorBox({
      message: "مشكلة اتصال بالسيرفر أو Netlify Function.",
      fix: "اتأكد إن Netlify Function شغالة وإن الإنترنت تمام. جرّب Refresh للموقع.",
      code: "network_error",
      triedModels: [],
      lastTriedModel: "",
    });
    outEl.textContent = `❌ مشكلة اتصال:\n${message}`;
    setStatus("اتصال فشل", false);
  }
});

clearBtn.addEventListener("click", () => {
  promptEl.value = "";
  outEl.textContent = "// هنا هيظهر الرد…";
  hideErrorBox();
  setMeta({ modelUsed: "—", usage: null });
  setStatus("جاهز", false);
});

copyBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(outEl.textContent || "");
    setStatus("اتنسخ ✅", false);
    setTimeout(() => setStatus("جاهز", false), 1200);
  } catch {
    setStatus("النسخ فشل", false);
  }
});

downloadBtn.addEventListener("click", () => {
  const text = outEl.textContent || "";
  downloadText("groq_output.txt", text);
});
