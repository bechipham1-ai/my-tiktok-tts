const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- API HỆ THỐNG (GIỮ NGUYÊN) ---
app.get('/api/:path', async (req, res) => {
    const { path } = req.params;
    if (path === 'words') res.json((await BannedWord.find()).map(w => w.word));
    else if (path === 'acronyms') res.json(await Acronym.find());
    else if (path === 'emojis') res.json(await EmojiMap.find());
    else if (path === 'bot') res.json(await BotAnswer.find());
});

app.post('/api/:path', async (req, res) => {
    const { path } = req.params;
    if (path === 'words') await new BannedWord({ word: req.body.word }).save();
    else if (path === 'acronyms') await new Acronym(req.body).save();
    else if (path === 'emojis') await new EmojiMap(req.body).save();
    else if (path === 'bot') await new BotAnswer(req.body).save();
    res.json({ ok: true });
});

app.delete('/api/:path/:id', async (req, res) => {
    const { path, id } = req.params;
    if (path === 'words') await BannedWord.deleteOne({ word: id });
    else if (path === 'acronyms') await Acronym.findByIdAndDelete(id);
    else if (path === 'emojis') await EmojiMap.findByIdAndDelete(id);
    else if (path === 'bot') await BotAnswer.findByIdAndDelete(id);
    res.json({ ok: true });
});

app.use(express.static('public'));

// --- LOGIC XỬ LÝ TEXT (GIỮ NGUYÊN) ---
async function processText(text) {
    if (!text) return "";
    let clean = text.toLowerCase();
    const banned = (await BannedWord.find()).map(w => w.word.toLowerCase());
    if (banned.some(word => clean.includes(word))) return null;
    const acronyms = await Acronym.find();
    acronyms.forEach(a => clean = clean.replace(new RegExp(a.key, 'gi'), a.value));
    const emojis = await EmojiMap.find();
    emojis.forEach(e => clean = clean.replace(new RegExp(escapeRegExp(e.icon), 'g'), ` ${e.text} `));
    return clean.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
}

// --- KẾT NỐI SOCKET ---
io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);

        tiktok.connect().then(() => socket.emit('status', '✅ Kết nối thành công')).catch(() => socket.emit('status', '❌ Lỗi kết nối'));

        // 1. Xử lý Chat & Bot
        tiktok.on('chat', async (data) => {
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => data.comment.toLowerCase().includes(r.keyword.toLowerCase()));
            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: data.nickname, comment: match.response, audio });
            } else {
                const clean = await processText(data.comment);
                if (clean) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${clean}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        // 2. Chào mừng thành viên
        tiktok.on('member', async (data) => {
            const safe = await processText(data.nickname);
            if (safe) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safe} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: safe, comment: "vào phòng", audio });
            }
        });

        // 3. Tặng quà
        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const safe = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safe} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: safe, comment: `đã tặng ${data.giftName}`, audio });
            }
        });

        // --- 4. FIX: XỬ LÝ PK 20S (THÊM MỚI VÀO ĐÂY) ---
        tiktok.on('linkMicArmies', (data) => {
            // Sự kiện này TikTok gửi về khi trận đấu có diễn biến mới (thường là mốc 20s cuối)
            socket.emit('linkMicArmies', data);
        });

        tiktok.on('linkMicBattle', (data) => {
            // Bắt đầu trận đấu
            socket.emit('linkMicBattle', data);
        });
        // ----------------------------------------------
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
