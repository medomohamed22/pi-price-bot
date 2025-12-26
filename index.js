const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');

// ضع التوكن بتاعك هنا
const token = '8339316854:AAFnR5ZilA5JDfN0r9QX2vQACEcDSrHSvXE'; // غير ده بالتوكن الحقيقي
const bot = new TelegramBot(token, { polling: true });

// متغيرات عالمية
let allowedChatIds = new Set(); // يسمح لأي واحد يبدأ البوت

const symbol = 'PI-USDT';

// دوال الحساب الفني (نفس اللي في الصفحة)
function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    const emaArray = [ema];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
        emaArray.push(ema);
    }
    return emaArray;
}

function calculateRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        const currentGain = diff > 0 ? diff : 0;
        const currentLoss = diff < 0 ? -diff : 0;
        avgGain = (avgGain * (period - 1) + currentGain) / period;
        avgLoss = (avgLoss * (period - 1) + currentLoss) / period;
    }
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

function calculateMACD(prices) {
    const ema12 = calculateEMA(prices, 12);
    const ema26 = calculateEMA(prices, 26);
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
        if (ema12[i] !== undefined && ema26[i] !== undefined) macdLine.push(ema12[i] - ema26[i]);
        else macdLine.push(undefined);
    }
    const validMacd = macdLine.filter(v => v !== undefined);
    const signalLineRaw = calculateEMA(validMacd, 9);
    const signalLine = [];
    let validIndex = macdLine.findIndex(v => v !== undefined);
    for (let i = 0; i < signalLineRaw.length; i++) signalLine[validIndex + i] = signalLineRaw[i];
    const histogram = macdLine.map((val, i) => val !== undefined && signalLine[i] !== undefined ? val - signalLine[i] : undefined);
    const lastHist = histogram[histogram.length - 1]?.toFixed(6) || '0';
    return { lastHist, positive: parseFloat(lastHist) > 0 };
}

// جلب البيانات
async function getData() {
    const tickerUrl = `https://www.okx.com/api/v5/market/ticker?instId=${symbol}`;
    const candlesUrl = `https://www.okx.com/api/v5/market/candles?instId=${symbol}&bar=4H&limit=300`;

    const [tickerRes, candlesRes] = await Promise.all([
        fetch(tickerUrl),
        fetch(candlesUrl)
    ]);

    const ticker = await tickerRes.json();
    const candles = await candlesRes.json();

    if (ticker.code !== '0' || candles.code !== '0') return null;

    const data = ticker.data[0];
    const closes = candles.data.reverse().map(c => parseFloat(c[4]));

    const price = parseFloat(data.last).toFixed(6);
    const change24h = ((data.last - data.open24h) / data.open24h * 100).toFixed(2);
    const high24h = parseFloat(data.high24h).toFixed(6);
    const low24h = parseFloat(data.low24h).toFixed(6);
    const volume = parseFloat(data.volCcy24h).toLocaleString('en-US', {maximumFractionDigits: 0});

    const rsi = calculateRSI(closes, 14).toFixed(2);
    const macd = calculateMACD(closes);
    const ema50 = calculateEMA(closes, 50).slice(-1)[0]?.toFixed(6) || '0';
    const ema200 = calculateEMA(closes, 200).slice(-1)[0]?.toFixed(6) || '0';

    // النصيحة
    let score = 0;
    if (parseFloat(rsi) < 40) score += 2;
    if (parseFloat(rsi) > 70) score -= 2;
    if (macd.positive) score += 1.5;
    if (parseFloat(ema50) > parseFloat(ema200)) score += 1.5;

    let advice = "الانتظار أو الاحتفاظ 🟡";
    if (score >= 3) advice = "إشارة شراء قوية 🟢";
    else if (score >= 1.5) advice = "ميل للشراء 🔼";
    else if (score <= -3) advice = "إشارة بيع قوية 🔴";
    else if (score <= -1) advice = "ميل للبيع 🔻";

    return {
        price, change24h, high24h, low24h, volume,
        rsi, histogram: macd.lastHist, ema50, ema200, advice
    };
}

// رسالة البداية
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    allowedChatIds.add(chatId);
    bot.sendMessage(chatId, `
🚀 مرحبا بك في بوت Pi Network المتقدم!

هيرسلك تحديث كامل للسعر والتحليل الفني كل دقيقة.

المتابعة بدأت تلقائيًا ✅
    `);
});

// إرسال التحديثات
async function sendUpdate() {
    const data = await getData();
    if (!data) {
        for (const chatId of allowedChatIds) {
            bot.sendMessage(chatId, "❌ خطأ في جلب البيانات من OKX");
        }
        return;
    }

    const message = `
💰 *Pi Network (PI/USDT)*

🪙 السعر الحالي: $${data.price}
📊 تغيير 24 ساعة: ${data.change24h >= 0 ? '+' : ''}${data.change24h}%

📈 أعلى 24س: $${data.high24h}
📉 أدنى 24س: $${data.low24h}
💹 حجم التداول: $${data.volume}

🔹 RSI (14): ${data.rsi}
🔹 MACD Histogram: ${data.histogram}
🔹 EMA 50: $${data.ema50}
🔹 EMA 200: $${data.ema200}

💡 *النصيحة*: ${data.advice}

⏰ ${new Date().toLocaleString('ar-EG')}
    `;

    for (const chatId of allowedChatIds) {
        bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    }
}

// تحديث كل دقيقة
setInterval(sendUpdate, 60000);

// رسالة أولى فور التشغيل
sendUpdate();

console.log('بوت Pi Network شغال على Render!');