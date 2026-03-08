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

// Models
const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

async function getGoogleAudio(text) {
    return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
}

// Logic PK đếm ngược
let pkInterval = null;

io.on('connection', (socket) => {
    let tiktok = null;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', '✅ Kết nối thành công')).catch(() => socket.emit('status', '❌ Lỗi'));

        // Xử lý PK Đếm ngược
        tiktok.on('linkMicBattle', () => {
            if (pkInterval) clearInterval(pkInterval);
            let timeLeft = 300;
            pkInterval = setInterval(async () => {
                timeLeft--;
                if (timeLeft === 20) {
                    const audio = await getGoogleAudio("20 giây cuối lên bông bèo ơi");
                    socket.emit('audio-data', { type: 'pk', user: 'Hệ thống', comment: 'Nhắc PK 20s', audio });
                }
                if (timeLeft <= 0) clearInterval(pkInterval);
            }, 1000);
        });

        // Chat & Bot
        tiktok.on('chat', async (data) => {
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => data.comment.toLowerCase().includes(r.keyword.toLowerCase()));
            if (match) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: data.nickname, comment: match.response, audio });
            } else {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
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

server.listen(process.env.PORT || 3000);
