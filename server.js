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

// DATABASE - Giữ nguyên của Bèo
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- API QUẢN TRỊ (Giữ nguyên) ---
app.get('/api/:path', async (req, res) => {
    const { path } = req.params;
    if (path === 'words') res.json((await BannedWord.find()).map(w => w.word));
    else if (path === 'acronyms') res.json(await Acronym.find());
    else if (path === 'emojis') res.json(await EmojiMap.find());
    else res.json(await BotAnswer.find());
});

app.post('/api/:path', async (req, res) => {
    const { path } = req.params; const { word, key, value, icon, text, keyword, response } = req.body;
    if (path === 'words' && word) await BannedWord.updateOne({ word: word.toLowerCase() }, { word: word.toLowerCase() }, { upsert: true });
    else if (path === 'acronyms') await Acronym.findOneAndUpdate({ key: key.toLowerCase() }, { value }, { upsert: true });
    else if (path === 'emojis') await EmojiMap.findOneAndUpdate({ icon }, { text }, { upsert: true });
    else if (path === 'bot') await BotAnswer.findOneAndUpdate({ keyword: keyword.toLowerCase() }, { response }, { upsert: true });
    res.sendStatus(200);
});

app.delete('/api/:path/:id', async (req, res) => {
    const { path, id } = req.params;
    if (path === 'words') await BannedWord.deleteOne({ word: id });
    else if (path === 'acronyms') await Acronym.findByIdAndDelete(id);
    else if (path === 'emojis') await EmojiMap.findByIdAndDelete(id);
    else await BotAnswer.findByIdAndDelete(id);
    res.sendStatus(200);
});

// --- LOGIC XỬ LÝ CHÍNH ---

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

async function processText(text) {
    if (!text) return null;
    const banned = await BannedWord.find();
    if (banned.some(b => text.toLowerCase().includes(b.word))) return null;
    let processed = text;
    const emojis = await EmojiMap.find();
    for (const e of emojis) processed = processed.split(e.icon).join(" " + e.text + " ");
    const acronyms = await Acronym.find();
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });
    return processed;
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        
        // Khởi tạo kết nối với cấu hình đầy đủ
        tiktok = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedGiftInfo: true
        });

        tiktok.connect().then(state => {
            console.log(`✅ Đã kết nối tới room của: ${username}`);
            socket.emit('status', `✅ Kết nối: ${username}`);
        }).catch(err => {
            console.error('❌ Lỗi kết nối TikTok:', err);
            socket.emit('status', `❌ Lỗi: ${err.message}`);
        });

        // 1. Lắng nghe CHAT
        tiktok.on('chat', async (data) => {
            console.log(`[CHAT] ${data.nickname}: ${data.comment}`); // Log kiểm tra
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => data.comment.toLowerCase().includes(r.keyword));
            
            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: match.response, audio });
            } else {
                const clean = await processText(data.comment);
                if (clean) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${clean}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        // 2. Lắng nghe NGƯỜI VÀO PHÒNG
        tiktok.on('member', async (data) => {
            console.log(`[JOIN] ${data.nickname} vào phòng`);
            const safe = await processText(data.nickname);
            if (safe) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safe} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: "Vào phòng", audio });
            }
        });

        // 3. Lắng nghe QUÀ
        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) { // Chỉ đọc khi kết thúc chuỗi tặng quà
                console.log(`[GIFT] ${data.nickname} tặng ${data.giftName}`);
                const safe = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safe} đã tặng ${data.giftName} nuôi bèo`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `Tặng ${data.giftName}`, audio });
            }
        });

        // Ngắt kết nối khi tab web đóng
        socket.on('disconnect', () => {
            if (tiktok) tiktok.disconnect();
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server đang chạy tại cổng ${PORT}`));
