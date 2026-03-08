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

// Models giữ nguyên
const BannedWord = mongoose.model('BannedWord', { word: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

io.on('connection', (socket) => {
    let tiktok;
    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        tiktok.connect().then(() => socket.emit('status', '✅ Kết nối thành công'));

        // Xử lý PK 20s theo logic file cũ
        tiktok.on('linkMicArmies', async () => {
            const audio = await getGoogleAudio("thả bông 20 giây cuối bèo ơi");
            socket.emit('audio-data', { type: 'pk', user: "HỆ THỐNG", comment: "NHẮC PK 20S", audio });
        });

        tiktok.on('chat', async (data) => {
            const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
            socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
        });
    });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
server.listen(3000);
