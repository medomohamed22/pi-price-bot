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

function safeJsonParse(str) {
  try { return JSON.parse(str); } catch { return null; }
}

genBtn.addEventListener("click", async () => {
  const userPrompt = (promptEl.value || "").trim();
  if (!userPrompt) {
    outEl.textContent = "اكتب وصف للتطبيق الأول 🙂";
    return;
  }
  
  setStatus("جاري التوليد…", true);
  outEl.textContent = "⏳ بنولّد…";
  
  const payload = {
    prompt: userPrompt,
    model: modelEl.value,
    temperature: Number(tempEl.value || 0.3),
    max_tokens: Number(maxTokensEl.value || 1800),
  };
  
  try {
    // الواجهة لا تنادي Groq مباشرة — تنادي Netlify Function (آمن)
    const res = await fetch("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json().catch(() => ({}));
    
    if (!res.ok) {
      const msg = data?.error || `HTTP ${res.status}`;
      outEl.textContent = `❌ حصل خطأ:\n${msg}\n\nتفاصيل:\n${JSON.stringify(data, null, 2)}`;
      setStatus("خطأ", false);
      return;
    }
    
    // data.text: نص الرد النهائي
    const text = data?.text ?? JSON.stringify(data, null, 2);
    outEl.textContent = text;
    setStatus("تم ✅", false);
  } catch (err) {
    outEl.textContent = `❌ مشكلة اتصال:\n${err?.message || err}`;
    setStatus("اتصال فشل", false);
  }
});

clearBtn.addEventListener("click", () => {
  promptEl.value = "";
  outEl.textContent = "// هنا هيظهر الرد…";
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