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

// API QUẢN TRỊ
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => {
    const word = req.body.word ? req.body.word.toLowerCase().trim() : "";
    if (word) await BannedWord.updateOne({ word }, { word }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/words/:word', async (req, res) => {
    await BannedWord.deleteOne({ word: req.params.word });
    res.sendStatus(200);
});
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => {
    const { key, value } = req.body;
    if (key && value) await Acronym.findOneAndUpdate({ key: key.toLowerCase().trim() }, { value: value.trim() }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/acronyms/:key', async (req, res) => {
    await Acronym.deleteOne({ key: req.params.key });
    res.sendStatus(200);
});

const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:3000`;
app.get('/ping', (req, res) => res.send('pong'));
setInterval(() => axios.get(`${RENDER_URL}/ping`).catch(() => {}), 5 * 60 * 1000);

// --- HÀM XỬ LÝ VĂN BẢN (CHỐNG ĐỌC SỐ ĐIỆN THOẠI) ---
async function processText(text) {
    if (!text) return null;
    let processed = text;

    // 1. Kiểm tra từ cấm
    let lowerText = processed.toLowerCase();
    const banned = await BannedWord.find();
    for (let b of banned) { if (lowerText.includes(b.word)) return null; }

    // 2. GIỚI HẠN CHỮ SỐ: Tìm các chuỗi số và chỉ giữ lại tối đa 2 chữ số đầu
    // Regex \d{2,}: tìm chuỗi có từ 2 chữ số trở lên. 
    // Hàm replace sẽ lấy 2 số đầu ($1) và bỏ phần còn lại.
    processed = processed.replace(/(\d{2})\d+/g, '$1');

    // 3. Thay thế viết tắt
    const acronyms = await Acronym.find();
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });

    return processed;
}

async function getGoogleAudio(text) {
    try {
        if (!text) return null;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        startTime = Date.now();
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const finalContent = await processText(data.comment);
                if (finalContent) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${finalContent}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        tiktok.on('member', async (data) => {
            if (Date.now() > startTime) {
                // Xử lý cả nickname để tránh nickname chứa số điện thoại
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safeName} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} đã tham gia`, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (data.gift && data.repeatEnd) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã góp gạo nuôi Bèo`);
                socket.emit('audio-data', { type: 'gift', user: "GÓP GẠO", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });

        tiktok.on('follow', async (data) => {
            if (Date.now() > startTime) {
                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã follow em`);
                socket.emit('audio-data', { type: 'follow', user: "FOLLOW", comment: `${data.nickname} đã theo dõi`, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
