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

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// API quản lý (giữ nguyên)
app.get('/api/:path', async (req, res) => {
    const { path } = req.params;
    if (path === 'words') res.json((await BannedWord.find()).map(w => w.word));
    else if (path === 'acronyms') res.json(await Acronym.find());
    else if (path === 'emojis') res.json(await EmojiMap.find());
    else res.json(await BotAnswer.find());
});

app.post('/api/:path', async (req, res) => {
    const { path } = req.params;
    if (path === 'words') await new BannedWord({ word: req.body.word }).save();
    else if (path === 'acronyms') await new Acronym(req.body).save();
    else if (path === 'emojis') await new EmojiMap(req.body).save();
    else if (path === 'bot') await new BotAnswer(req.body).save();
    res.json({ ok: true });
});

async function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
}

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', '✅ Kết nối thành công')).catch(() => socket.emit('status', '❌ Lỗi kết nối'));

        // --- XỬ LÝ NHẮC PK 20S ---
        tiktok.on('linkMicArmies', async () => {
            const audio = await getGoogleAudio("20 giây cuối lên bông bèo ơi");
            socket.emit('audio-data', { type: 'pk', user: 'Hệ thống', comment: 'Nhắc PK 20s', audio });
        });

        tiktok.on('chat', async (data) => {
            const clean = data.comment; // Đơn giản hóa để tránh lỗi filter
            const audio = await getGoogleAudio(`${data.nickname} nói: ${clean}`);
            socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
        });

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
            socket.emit('audio-data', { type: 'welcome', user: data.nickname, comment: "vào phòng", audio });
        });

        tiktok.on('gift', async (data) => {
            if (data.repeatEnd) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: data.nickname, comment: `tặng ${data.giftName}`, audio });
            }
        });
    });
});

server.listen(process.env.PORT || 3000, () => console.log("🚀 Server Ready"));
