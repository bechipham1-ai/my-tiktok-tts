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

// HÀM KIỂM TRA TỪ CẤM (Dùng cho cả nội dung và Nickname)
async function isBanned(text) {
    if (!text) return true;
    const lowerText = text.toLowerCase();
    const banned = await BannedWord.find();
    return banned.some(b => lowerText.includes(b.word));
}

// HÀM XỬ LÝ VĂN BẢN (CHỐNG ĐỌC SỐ ĐIỆN THOẠI)
async function processText(text) {
    if (!text) return null;
    if (await isBanned(text)) return null;

    let processed = text;
    // GIỚI HẠN CHỮ SỐ: Tìm các chuỗi số và chỉ giữ lại tối đa 2 chữ số đầu
    processed = processed.replace(/(\d{2})\d+/g, '$1');

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
    let startTime = 0;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        startTime = Date.now();
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        // 1. ĐỌC CHAT
        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                // Kiểm tra nếu nickname của họ nằm trong từ cấm thì bỏ qua luôn
                if (await isBanned(data.nickname)) return;

                const finalContent = await processText(data.comment);
                if (finalContent) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${finalContent}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        // 2. CHÀO NGƯỜI VÀO
        tiktok.on('member', async (data) => {
            if (Date.now() > startTime) {
                // Nếu tên người vào phòng có từ cấm -> Không chào
                if (await isBanned(data.nickname)) return;

                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Bèo ơi, anh ${safeName} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `${data.nickname} đã tham gia`, audio });
            }
        });

        // 3. TẶNG QUÀ
        tiktok.on('gift', async (data) => {
            if (data.gift && data.repeatEnd) {
                if (await isBanned(data.nickname)) return;

                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã góp gạo nuôi Bèo`);
                socket.emit('audio-data', { type: 'gift', user: "GÓP GẠO", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });

        // 4. FOLLOW
        tiktok.on('follow', async (data) => {
            if (Date.now() > startTime) {
                if (await isBanned(data.nickname)) return;

                const safeName = await processText(data.nickname);
                const audio = await getGoogleAudio(`Cảm ơn ${safeName} đã follow em`);
                socket.emit('audio-data', { type: 'follow', user: "FOLLOW", comment: `${data.nickname} đã theo dõi`, audio });
            }
        });
    });
});

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
