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
mongoose.connect(MONGODB_URI).then(() => console.log("✅ DB Connected"));

// --- DATABASE MODELS ---
const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String }); // Bảng viết tắt

// --- API QUẢN TRỊ VIẾT TẮT ---
app.get('/api/acronyms', async (req, res) => {
    const data = await Acronym.find();
    res.json(data);
});

app.post('/api/acronyms', async (req, res) => {
    const { key, value } = req.body;
    if (key && value) {
        await Acronym.findOneAndUpdate(
            { key: key.toLowerCase().trim() },
            { value: value.trim() },
            { upsert: true }
        );
    }
    res.sendStatus(200);
});

app.delete('/api/acronyms/:key', async (req, res) => {
    await Acronym.deleteOne({ key: req.params.key });
    res.sendStatus(200);
});

// Giữ API từ cấm cũ
app.get('/api/words', async (req, res) => {
    const words = await BannedWord.find();
    res.json(words.map(w => w.word));
});
app.post('/api/words', async (req, res) => {
    const word = req.body.word ? req.body.word.toLowerCase().trim() : "";
    if (word) await BannedWord.updateOne({ word }, { word }, { upsert: true });
    res.sendStatus(200);
});
app.delete('/api/words/:word', async (req, res) => {
    await BannedWord.deleteOne({ word: req.params.word });
    res.sendStatus(200);
});

// --- HÀM XỬ LÝ VĂN BẢN ---
async function processText(text) {
    let processed = text.toLowerCase();
    
    // 1. Kiểm tra từ cấm trước
    const banned = await BannedWord.find();
    for (let b of banned) {
        if (processed.includes(b.word)) return null; 
    }

    // 2. Thay thế từ viết tắt (Sử dụng Regex để thay thế chính xác từ đứng riêng lẻ)
    const acronyms = await Acronym.find();
    let finalChat = text; 
    acronyms.forEach(a => {
        // Regex này giúp thay "dag" nhưng không thay "dag" trong "dagiau"
        const regex = new RegExp(`\\b${a.key}\\b`, 'gi');
        finalChat = finalChat.replace(regex, a.value);
    });

    return finalChat;
}

async function getGoogleAudio(text) {
    try {
        if (!text) return null;
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 5000 });
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
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối ID: ${username}`));

        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const finalContent = await processText(data.comment);
                if (finalContent) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${finalContent}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, processed: finalContent, audio });
                } else {
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: "⚠️ Từ cấm", audio: null });
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
});

server.listen(process.env.PORT || 3000);
