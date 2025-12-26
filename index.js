const TelegramBot = require('node-telegram-bot-api');
const fetch = require('node-fetch');
const crypto = require('crypto');
const express = require('express');
const app = express();

const token = '8339316854:AAFnR5ZilA5JDfN0r9QX2vQACEcDSrHSvXE';
const bot = new TelegramBot(token);

const PORT = process.env.PORT || 3000;
const URL = 'https://pi-price-bot-gjul.onrender.com';

app.use(express.json());

app.post(`/bot${token}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    try {
        await bot.setWebHook(`${URL}/bot${token}`);
        console.log('Webhook set successfully!');
    } catch (err) {
        console.error('Error setting webhook:', err);
    }
});

// OKX API Settings
const API_KEY = '0b145bbf-d04c-4a66-9fa8-c607d57d82bd';
const SECRET_KEY = 'B963E55BEFC3EC4237E91E11BACDE0BD';
const PASSPHRASE = 'Android33@';
const SIMULATED = true; // true = ديمو (آمن), false = حقيقي (خطر جدًا!)

let allowedChatIds = new Set();
let openPositions = {}; // { instId: { qty, buyPrice } }
const MAX_POSITIONS = 5;
const TRADE_SIZE_USDT = 10; // حجم الصفقة بالدولار

// توقيع طلبات OKX
function signRequest(timestamp, method, path, body = '') {
    const prehash = timestamp + method + path + body;
    return crypto.createHmac('sha256', SECRET_KEY).update(prehash).digest('base64');
}

// تنفيذ أمر سوقي
async function placeOrder(instId, side, usdtAmount) {
    try {
        const priceRes = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
        const priceData = await priceRes.json();
        if (priceData.code !== '0' || !priceData.data[0]) return { error: 'Price fetch failed' };
        const price = parseFloat(priceData.data[0].last);
        const sz = (usdtAmount / price).toFixed(6);

        const timestamp = new Date().toISOString();
        const path = '/api/v5/trade/order';
        const body = JSON.stringify({
            instId,
            tdMode: 'cash',
            side,
            ordType: 'market',
            sz
        });

        const signature = signRequest(timestamp, 'POST', path, body);
        const headers = {
            'OK-ACCESS-KEY': API_KEY,
            'OK-ACCESS-SIGN': signature,
            'OK-ACCESS-TIMESTAMP': timestamp,
            'OK-ACCESS-PASSPHRASE': PASSPHRASE,
            'Content-Type': 'application/json'
        };
        if (SIMULATED) headers['x-simulated-trading'] = '1';

        const res = await fetch('https://www.okx.com' + path, {
            method: 'POST',
            headers,
            body
        });
        return await res.json();
    } catch (err) {
        console.error('Order error:', err);
        return { error: err.message };
    }
}

// جلب أفضل 50 عملة (حسب حجم التداول)
async function getTop50() {
    try {
        const res = await fetch('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
        const data = await res.json();
        if (data.code !== '0') return [];
        return data.data
            .filter(t => t.instId.endsWith('-USDT') && !t.instId.includes('SWAP'))
            .sort((a, b) => parseFloat(b.volCcy24h) - parseFloat(a.volCcy24h))
            .slice(0, 50);
    } catch (err) {
        console.error('Error fetching top50:', err);
        return [];
    }
}

// حساب RSI بسيط
function calculateRSI(closes, period = 14) {
    if (closes.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = Math.abs(losses) / period;
    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}

// تحليل فني بسيط (RSI + EMA تقريبي)
async function analyzeSymbol(instId) {
    try {
        const res = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=1H&limit=100`);
        const data = await res.json();
        if (data.code !== '0') return 0;
        const closes = data.data.map(c => parseFloat(c[4]));
        if (closes.length < 50) return 0;

        const rsi = calculateRSI(closes);
        const currentPrice = closes[closes.length - 1];
        const ema50Approx = closes[Math.max(0, closes.length - 50)];

        let score = 0;
        if (rsi < 40) score += 3; // oversold
        if (rsi > 70) score -= 2; // overbought
        if (currentPrice > ema50Approx) score += 2; // فوق EMA

        return score;
    } catch (err) {
        console.error('Analyze error for', instId, err);
        return 0;
    }
}

function sendToAll(msg) {
    for (const chatId of allowedChatIds) {
        bot.sendMessage(chatId, msg);
    }
}

// منطق التداول
async function tradingLogic() {
    if (allowedChatIds.size === 0) return;

    console.log('Starting trading logic cycle...');

    // إدارة الصفقات المفتوحة
    for (const instId in openPositions) {
        try {
            const tickerRes = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`);
            const tickerData = await tickerRes.json();
            if (tickerData.code !== '0') continue;
            const price = parseFloat(tickerData.data[0].last);
            const pnl = (price - openPositions[instId].buyPrice) / openPositions[instId].buyPrice;

            if (pnl >= 0.01) { // ربح 1%
                const result = await placeOrder(instId, 'sell', openPositions[instId].qty * openPositions[instId].buyPrice);
                if (result && result.code === '0') {
                    delete openPositions[instId];
                    sendToAll(`🎉 بيع ${instId} بربح 1%`);
                }
            } else if (pnl <= -0.005) { // خسارة 0.5%
                const result = await placeOrder(instId, 'sell', openPositions[instId].qty * openPositions[instId].buyPrice);
                if (result && result.code === '0') {
                    delete openPositions[instId];
                    sendToAll(`🛑 وقف خسارة ${instId} عند -0.5%`);
                }
            }
        } catch (err) {
            console.error('Position management error:', err);
        }
    }

    // ابحث عن فرص جديدة إذا أقل من الحد الأقصى
    if (Object.keys(openPositions).length < MAX_POSITIONS) {
        const top50 = await getTop50();
        const top10 = top50.slice(0, 10); // 10 عملات فقط لتجنب rate limit

        for (const t of top10) {
            if (openPositions[t.instId]) continue;

            const score = await analyzeSymbol(t.instId);
            if (score >= 4) {
                const result = await placeOrder(t.instId, 'buy', TRADE_SIZE_USDT);
                if (result && result.code === '0') {
                    const price = parseFloat(t.last);
                    openPositions[t.instId] = { qty: TRADE_SIZE_USDT / price, buyPrice: price };
                    sendToAll(`✅ شراء ${t.instId} بـ ${TRADE_SIZE_USDT} USDT\nإشارة فنية قوية (Score: ${score})`);
                    break; // صفقة واحدة كل دورة
                } else {
                    console.error('Buy failed for', t.instId, result);
                }
            }

            // تأخير 600ms بين كل تحليل
            await new Promise(resolve => setTimeout(resolve, 600));
        }
    }
}

// رسالة البداية
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    allowedChatIds.add(chatId);
    bot.sendMessage(chatId, `
🚀 بوت تداول آلي متقدم على OKX شغال!

- يراقب أفضل 50 عملة (يحلل 10 كل دورة)
- تحليل فني (RSI + EMA)
- شراء عند إشارة قوية
- بيع عند ربح 1%
- وقف خسارة عند -0.5%
- حد أقصى 5 صفقات مفتوحة
- حجم الصفقة: 10 USDT

الحالة: ${SIMULATED ? 'ديمو (محاكاة آمنة)' : 'حقيقي ⚠️'}

التداول يعمل تلقائيًا كل 10 دقايق...
    `);
});

// تحديث كل 10 دقايق + تأخير داخلي لتجنب rate limit
setInterval(tradingLogic, 600000);

// تشغيل أولي
tradingLogic();

console.log('بوت التداول المتقدم شغال بنجاح!');