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

// 1. KẾT NỐI DATABASE (Đã điền user: baoboi97 và pass: baoboi97)
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Đã kết nối MongoDB thành công!"))
    .catch(err => console.error("❌ Lỗi kết nối DB:", err));

// Định nghĩa bảng từ cấm
const BannedWord = mongoose.model('BannedWord', { word: String });

// 2. TÍNH NĂNG ANTI-SLEEP (Giữ server luôn thức)
const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:3000`;
app.get('/ping', (req, res) => res.send('pong'));
setInterval(() => {
    axios.get(`${RENDER_URL}/ping`).catch(() => {});
}, 5 * 60 * 1000);

// 3. API QUẢN TRỊ TỪ CẤM
app.get('/api/words', async (req, res) => {
    const words = await BannedWord.find();
    res.json(words.map(w => w.word));
});

app.post('/api/words', async (req, res) => {
    const word = req.body.word ? req.body.word.toLowerCase().trim() : "";
    if (word) {
        const exists = await BannedWord.findOne({ word });
        if (!exists) await BannedWord.create({ word });
    }
    res.sendStatus(200);
});

app.delete('/api/words/:word', async (req, res) => {
    await BannedWord.deleteOne({ word: req.params.word });
    res.sendStatus(200);
});

// 4. HÀM XỬ LÝ ÂM THANH & LỌC TỪ
async function filterAndCleanText(text) {
    const banned = await BannedWord.find();
    let lowerText = text.toLowerCase();
    let isBanned = false;
    
    banned.forEach(b => {
        if (lowerText.includes(b.word)) isBanned = true;
    });

    return isBanned ? null : text;
}

async function getGoogleAudio(text) {
    try {
        if (!text) return null;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// 5. LOGIC TIKTOK LIVE
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        startTime = Date.now();

        tiktok.connect().then(async () => {
            socket.emit('status', `Đã kết nối ID: ${username}`);
            const audio = await getGoogleAudio("Kết nối thành công, bắt đầu đọc bình luận");
            socket.emit('audio-data', { type: 'system', user: "Hệ thống", comment: "Sẵn sàng!", audio });
        }).catch(err => socket.emit('status', `Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const safeText = await filterAndCleanText(data.comment);
                if (safeText) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${safeText}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                } else {
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: "⚠️ Bình luận chứa từ cấm", audio: null });
                }
            }
        });

        tiktok.on('member', async (data) => {
            if (Date.now() > startTime) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `Anh ${data.nickname} vào`, audio });
            }
        });
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
