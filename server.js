const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// CẤU HÌNH AI GEMINI
const genAI = new GoogleGenerativeAI("AIzaSyDXIWsXNqh5fW543eE3EFieV6vnDMH0zMs");
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: "Bạn là trợ lý ảo của Idol TikTok tên là Bèo. Hãy trả lời bình luận của khán giả một cách vui vẻ, lễ phép, hài hước và cực kỳ ngắn gọn (dưới 15 từ). Gọi khán giả là anh/chị/cả nhà và xưng là em hoặc Bèo. Nếu khán giả chửi bới, hãy nhẹ nhàng nhắc nhở họ lịch sự."
});

// DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });

// API QUẢN TRỊ
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => {
    const word = req.body.word ? req.body.word.toLowerCase().trim() : "";
    if (word) await BannedWord.updateOne({ word }, { word }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/words/:word', async (req, res) => { await BannedWord.deleteOne({ word: req.params.word }); res.sendStatus(200); });
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => {
    const { key, value } = req.body;
    if (key && value) await Acronym.findOneAndUpdate({ key: key.toLowerCase().trim() }, { value: value.trim() }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/acronyms/:key', async (req, res) => { await Acronym.deleteOne({ key: req.params.key }); res.sendStatus(200); });
app.get('/api/emojis', async (req, res) => res.json(await EmojiMap.find()));
app.post('/api/emojis', async (req, res) => {
    const { icon, text } = req.body;
    if (icon && text) await EmojiMap.findOneAndUpdate({ icon: icon.trim() }, { text: text.trim() }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/emojis/:id', async (req, res) => { await EmojiMap.findByIdAndDelete(req.params.id); res.sendStatus(200); });

// XỬ LÝ VĂN BẢN & TTS
async function isBanned(text) {
    if (!text) return false;
    const banned = await BannedWord.find();
    return banned.some(b => text.toLowerCase().includes(b.word));
}

async function processText(text) {
    if (!text || await isBanned(text)) return null;
    let processed = text;
    const emojis = await EmojiMap.find();
    for (const e of emojis) { processed = processed.split(e.icon).join(" " + e.text + " "); }
    processed = processed.replace(/(\d{2})\d+/g, '$1'); // Cắt SĐT
    const acronyms = await Acronym.find();
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });
    return processed;
}

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let pkTimer = null;
    let useAI = false;

    socket.on('toggle-ai', (status) => { useAI = status; console.log("AI Mode:", useAI); });

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        tiktok.on('chat', async (data) => {
            if (await isBanned(data.nickname) || await isBanned(data.comment)) return;

            if (useAI) {
                try {
                    const result = await model.generateContent(`Người xem ${data.nickname} nói: "${data.comment}". Hãy phản hồi.`);
                    const aiText = result.response.text();
                    const audio = await getGoogleAudio(aiText);
                    socket.emit('audio-data', { type: 'ai', user: "TRỢ LÝ AI", comment: `🤖: ${aiText}`, audio });
                } catch (e) { console.error("AI Error"); }
            } else {
                const finalContent = await processText(data.comment);
                if (finalContent) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${finalContent}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        tiktok.on('linkMicBattle', () => {
            if (pkTimer) clearInterval(pkTimer);
            let timeLeft = 300; 
            pkTimer = setInterval(async () => {
                timeLeft--;
                if (timeLeft === 20) {
                    const audio = await getGoogleAudio("thả bông 20 giây cuối bèo ơi");
                    socket.emit('audio-data', { type: 'pk', user: "HỆ THỐNG", comment: "SẮP HẾT GIỜ PK!", audio });
                }
                if (timeLeft <= 0) clearInterval(pkTimer);
            }, 1000);
        });

        tiktok.on('member', async (data) => {
            if (!(await isBanned(data.nickname))) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safeName} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} vào xem`, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (data.gift && data.repeatEnd && !(await isBanned(data.nickname))) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã góp gạo nuôi Bèo`);
                socket.emit('audio-data', { type: 'gift', user: "GÓP GẠO", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại cổng ${PORT}`));
