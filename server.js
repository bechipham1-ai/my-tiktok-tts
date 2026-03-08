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
app.use(express.static(__dirname));

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

// Khai báo Schema
const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// Hàm hỗ trợ (Đã kiểm chứng)
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

async function processText(text) {
    if (!text) return null;
    let processed = text;
    const acronyms = await Acronym.find();
    acronyms.forEach(a => processed = processed.replace(new RegExp(a.key, 'gi'), a.value));
    return processed;
}

// Socket xử lý
io.on('connection', (socket) => {
    let tiktok;
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', `✅ Kết nối: ${username}`)).catch(e => socket.emit('status', `❌ Lỗi: ${e.message}`));

        // 1. CHAT & BOT (Đã khôi phục)
        tiktok.on('chat', async (data) => {
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => data.comment.toLowerCase().includes(r.keyword.toLowerCase()));
            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: data.nickname, comment: match.response, audio });
            } else {
                const clean = await processText(data.comment);
                const audio = await getGoogleAudio(`${data.nickname} nói: ${clean}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });

        // 2. CHÀO PHÒNG
        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
            socket.emit('audio-data', { type: 'welcome', user: data.nickname, comment: "vào phòng", audio });
        });

        // 3. TẶNG QUÀ
        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: data.nickname, comment: `đã tặng ${data.giftName}`, audio });
            }
        });

        // 4. PK (Thêm an toàn)
        tiktok.on('linkMicArmies', async () => {
            const audio = await getGoogleAudio("20 giây cuối lên bông bèo ơi");
            socket.emit('audio-data', { type: 'pk', user: 'Hệ thống', comment: 'Nhắc PK 20s', audio });
        });
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(process.env.PORT || 3000);
