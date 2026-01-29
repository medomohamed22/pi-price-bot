const promptEl = document.getElementById("prompt");
const modelEl = document.getElementById("model");
const tempEl = document.getElementById("temp");
const maxTokensEl = document.getElementById("maxTokens");
const outEl = document.getElementById("output");

const genBtn = document.getElementById("genBtn");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const downloadBtn = document.getElementById("downloadBtn");
const zipBtn = document.getElementById("zipBtn");

const statusChip = document.getElementById("statusChip");
const statusText = document.getElementById("statusText");

const usedModelEl = document.getElementById("usedModel");
const usageTokensEl = document.getElementById("usageTokens");
const filesCountEl = document.getElementById("filesCount");

const templatesWrap = document.getElementById("templates");

const errorBox = document.getElementById("errorBox");
const errorMsg = document.getElementById("errorMsg");
const errorFix = document.getElementById("errorFix");
const errorMeta = document.getElementById("errorMeta");

let lastFiles = []; // [{path, content}]

function setStatus(text, busy = false) {
  statusText.textContent = text;
  statusChip.style.opacity = busy ? "0.95" : "1";
  genBtn.disabled = !!busy;
  genBtn.style.opacity = busy ? "0.75" : "1";
}

function setMeta({ modelUsed, usage, filesCount }) {
  if (usedModelEl) usedModelEl.textContent = modelUsed || "—";

  const total =
    usage?.total_tokens ??
    (Number.isFinite(usage?.prompt_tokens) && Number.isFinite(usage?.completion_tokens)
      ? usage.prompt_tokens + usage.completion_tokens
      : null);

  if (usageTokensEl) usageTokensEl.textContent = (total ?? "—").toString();
  if (filesCountEl) filesCountEl.textContent = (Number.isFinite(filesCount) ? filesCount : "—").toString();
}

function showErrorBox({ message, fix, code, triedModels, lastTriedModel }) {
  errorBox.style.display = "block";
  errorMsg.textContent = message || "حصل خطأ غير معروف.";
  errorFix.textContent = fix ? `✅ حل مقترح: ${fix}` : "";
  const meta = [];
  if (code) meta.push(`Code: ${code}`);
  if (lastTriedModel) meta.push(`Last tried: ${lastTriedModel}`);
  if (Array.isArray(triedModels) && triedModels.length) meta.push(`Tried: ${triedModels.join(", ")}`);
  errorMeta.textContent = meta.join(" • ");
}

function hideErrorBox() {
  errorBox.style.display = "none";
  errorMsg.textContent = "";
  errorFix.textContent = "";
  errorMeta.textContent = "";
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

/**
 * Parse AI output into files using this format:
 * FILE: path/to/file.ext
 * <content...>
 *
 * (repeated)
 */
function parseFilesFromText(text) {
  const files = [];
  if (!text || typeof text !== "string") return files;

  // Normalize
  const clean = text.replace(/\r\n/g, "\n");

  // Capture sections
  const re = /(?:^|\n)FILE:\s*([^\n]+)\n([\s\S]*?)(?=\nFILE:\s*[^\n]+\n|$)/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    const path = (m[1] || "").trim();
    let content = (m[2] || "").trim();

    // Remove surrounding ``` fences if present
    content = content.replace(/^```[\w-]*\n?/i, "").replace(/\n?```$/i, "").trim();

    if (path && content) files.push({ path, content });
  }
  return files;
}

function ensureMinimumFiles(files, originalPrompt) {
  // If the model didn't return file blocks, make a basic structure:
  if (files.length) return files;

  const fallback = [
    {
      path: "README.md",
      content:
`# Vibe Code Output

Your model response did not include FILE blocks.

Prompt:
${originalPrompt}

Raw output is saved in: output.txt
`
    },
    { path: "output.txt", content: outEl.textContent || "" }
  ];
  return fallback;
}

async function downloadZip(files, zipName = "vibe_code_project.zip") {
  if (!window.JSZip) {
    alert("JSZip لم يتم تحميله. تأكد إن script موجود في index.html");
    return;
  }
  const zip = new JSZip();

  for (const f of files) {
    // support nested paths
    zip.file(f.path, f.content);
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = zipName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// -------------------- Templates --------------------
const TEMPLATES = [
  {
    title: "متجر إلكتروني بسيط",
    desc: "منتجات + سلة + صفحة منتج + تصميم Mint Glass + RTL",
    tags: ["Ecommerce", "RTL", "Mobile-first"],
    prompt:
`ابني موقع متجر إلكتروني بسيط (Mobile-first) بالعربي RTL وبستايل Mint Glass شبيه iOS.
المطلوب:
- صفحات: Home (قائمة منتجات + بحث + فلاتر) / Product / Cart / Checkout (Form) / Success
- بيانات منتجات Mock داخل JS
- سلة مشتريات LocalStorage
- UI زجاجي + أنيميشن بسيط
الستاك: HTML + CSS + JS فقط (بدون frameworks)

مهم جدًا: رجّع الناتج بصيغة ملفات فقط بهذا الشكل:
FILE: index.html
...كود كامل...
FILE: style.css
...كود كامل...
FILE: app.js
...كود كامل...
FILE: README.md
...شرح تشغيل مختصر...
بدون أي كلام خارج FILE blocks.`
  },
  {
    title: "طلبات/توصيل مصغّر",
    desc: "مطاعم + منيو + إضافة للعربة + تتبع حالة (UI فقط)",
    tags: ["Delivery", "Cards", "iOS"],
    prompt:
`ابني واجهة توصيل مصغّرة (Mobile-first) بالعربي RTL وبستايل Mint Glass.
المطلوب:
- Home: مطاعم قريبة (Cards) + بحث
- Restaurant: منيو + إضافة للعربة
- Cart: ملخص + اختيار عنوان + زر طلب
- Track: Timeline للحالة (Preparing / On the way / Delivered) (UI فقط)
- بيانات Mock داخل JS
الستاك: HTML + CSS + JS فقط

مهم جدًا: رجّع الناتج بصيغة ملفات فقط:
FILE: index.html
FILE: style.css
FILE: app.js
FILE: README.md
بدون أي كلام خارج FILE blocks.`
  },
  {
    title: "SaaS Dashboard",
    desc: "لوحة تحكم: إحصائيات + جدول + إعدادات (UI فقط)",
    tags: ["Dashboard", "Charts", "Admin"],
    prompt:
`ابني Dashboard SaaS (Mobile-first) بالعربي RTL وبستايل Mint Glass.
المطلوب:
- Sidebar/BottomNav موبايل
- Cards للإحصائيات
- جدول Users/Orders
- صفحة Settings (toggles + profile)
- بدون مكتبات (Charts بسيطة Canvas أو div bars)
الستاك: HTML + CSS + JS فقط

مهم جدًا: رجّع الناتج بصيغة ملفات فقط:
FILE: index.html
FILE: style.css
FILE: app.js
FILE: README.md
بدون أي كلام خارج FILE blocks.`
  },
  {
    title: "Landing Page + Pricing",
    desc: "Hero + Features + Pricing + FAQ + CTA",
    tags: ["Landing", "Pricing", "Fast"],
    prompt:
`ابني Landing Page احترافية (Mobile-first) بالعربي RTL وبستايل Mint Glass.
المطلوب:
- Hero + CTA
- Features grid
- Pricing cards
- FAQ accordion
- Contact section
- Animations خفيفة
الستاك: HTML + CSS + JS فقط

مهم جدًا: رجّع الناتج بصيغة ملفات فقط:
FILE: index.html
FILE: style.css
FILE: app.js
FILE: README.md
بدون أي كلام خارج FILE blocks.`
  }
];

function renderTemplates() {
  templatesWrap.innerHTML = "";
  TEMPLATES.forEach((t, idx) => {
    const el = document.createElement("div");
    el.className = "tpl";
    el.innerHTML = `
      <div class="tTitle">${t.title}</div>
      <div class="tDesc">${t.desc}</div>
      <div class="tags">
        ${t.tags.map(x => `<span class="tag">${x}</span>`).join("")}
      </div>
    `;
    el.addEventListener("click", () => {
      promptEl.value = t.prompt;
      promptEl.focus();
      setStatus("Template اتضاف ✅", false);
      setTimeout(() => setStatus("جاهز", false), 900);
    });
    templatesWrap.appendChild(el);
  });
}
renderTemplates();

// -------------------- Generate --------------------
genBtn.addEventListener("click", async () => {
  const userPrompt = (promptEl.value || "").trim();
  if (!userPrompt) {
    outEl.textContent = "اكتب وصف للتطبيق الأول 🙂";
    return;
  }

  hideErrorBox();
  lastFiles = [];
  zipBtn.disabled = true;
  setMeta({ modelUsed: "—", usage: null, filesCount: NaN });

  setStatus("جاري التوليد…", true);
  outEl.textContent = "⏳ بنولّد…";

  const payload = {
    prompt: userPrompt,
    model: modelEl.value,
    temperature: Number(tempEl.value || 0.2),
    max_tokens: Number(maxTokensEl.value || 1400),
  };

  try {
    const res = await fetch("/.netlify/functions/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    // meta
    setMeta({ modelUsed: data?.model, usage: data?.usage, filesCount: NaN });

    if (!res.ok || data?.ok === false) {
      const message = data?.error || `HTTP ${res.status}`;
      const fix = data?.fix || "";
      const code = data?.code || data?.raw?.error?.code || "";
      const triedModels = data?.triedModels || [];
      const lastTriedModel = data?.lastTriedModel || "";

      showErrorBox({ message, fix, code, triedModels, lastTriedModel });

      outEl.textContent =
        `❌ حصل خطأ:\n${message}\n` +
        (fix ? `\n${fix}\n` : "\n") +
        `\nتفاصيل:\n${JSON.stringify(data, null, 2)}`;

      setStatus("خطأ", false);
      return;
    }

    const text = data?.text ?? "";
    outEl.textContent = text || "// الرد رجع فاضي.";

    // Parse files for ZIP
    let files = parseFilesFromText(text);
    files = ensureMinimumFiles(files, userPrompt);

    lastFiles = files;
    zipBtn.disabled = !(lastFiles && lastFiles.length);

    setMeta({ modelUsed: data?.model, usage: data?.usage, filesCount: lastFiles.length });

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

// -------------------- Buttons --------------------
clearBtn.addEventListener("click", () => {
  promptEl.value = "";
  outEl.textContent = "// هنا هيظهر الرد…";
  hideErrorBox();
  lastFiles = [];
  zipBtn.disabled = true;
  setMeta({ modelUsed: "—", usage: null, filesCount: NaN });
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
  downloadText("groq_output.txt", outEl.textContent || "");
});

zipBtn.addEventListener("click", async () => {
  if (!lastFiles || !lastFiles.length) {
    alert("مفيش ملفات جاهزة للـ ZIP. اضغط توليد الكود الأول.");
    return;
  }
  setStatus("جارِ تجهيز ZIP…", true);
  try {
    await downloadZip(lastFiles, "vibe_code_project.zip");
    setStatus("اتحمّل ZIP ✅", false);
    setTimeout(() => setStatus("جاهز", false), 900);
  } catch (e) {
    setStatus("ZIP فشل", false);
    alert(e?.message || String(e));
  }
});
