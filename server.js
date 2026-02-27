const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());

// CẤU HÌNH AI GEMINI - Dùng API Key của bạn
const genAI = new GoogleGenerativeAI("AIzaSyDXIWsXNqh5fW543eE3EFieV6vnDMH0zMs");

// DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });

// HÀM TTS GOOGLE
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

// HÀM GỌI AI AN TOÀN (CHỐNG SẬP SERVER)
async function askAI(nickname, comment) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Bạn là trợ lý ảo của Idol TikTok tên Bèo. Khán giả ${nickname} nói: "${comment}". Trả lời ngắn gọn dưới 15 từ, vui vẻ.`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.error("Lỗi AI:", error.message);
        // Nếu lỗi do vùng (Singapore), trả về thông báo để Idol biết
        if (error.message.includes("location")) return "Bèo ơi, vùng này AI chưa hỗ trợ rồi";
        return null;
    }
}

// API QUẢN TRỊ (Giữ nguyên các hàm GET/POST/DELETE cũ của bạn...)
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => { const word = req.body.word?.toLowerCase().trim(); if (word) await BannedWord.updateOne({ word }, { word }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/words/:word', async (req, res) => { await BannedWord.deleteOne({ word: req.params.word }); res.sendStatus(200); });
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => { const { key, value } = req.body; if (key && value) await Acronym.findOneAndUpdate({ key: key.toLowerCase().trim() }, { value: value.trim() }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/acronyms/:key', async (req, res) => { await Acronym.deleteOne({ key: req.params.key }); res.sendStatus(200); });
app.get('/api/emojis', async (req, res) => res.json(await EmojiMap.find()));
app.post('/api/emojis', async (req, res) => { const { icon, text } = req.body; if (icon && text) await EmojiMap.findOneAndUpdate({ icon: icon.trim() }, { text: text.trim() }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/emojis/:id', async (req, res) => { await EmojiMap.findByIdAndDelete(req.params.id); res.sendStatus(200); });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let useAI = false;

    socket.on('toggle-ai', (status) => { useAI = status; });

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        
        tiktok.connect()
            .then(() => socket.emit('status', `Đã kết nối: ${username}`))
            .catch(err => socket.emit('status', `Lỗi: ${err.message}`));

        tiktok.on('chat', async (data) => {
            if (useAI) {
                const aiRes = await askAI(data.nickname, data.comment);
                if (aiRes) {
                    const audio = await getGoogleAudio(aiRes);
                    socket.emit('audio-data', { type: 'ai', user: "AI TRỢ LÝ", comment: aiRes, audio });
                }
            } else {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });
        
        // Các sự kiện khác (gift, member...) giữ nguyên logic cũ
    });
});

server.listen(process.env.PORT || 3000, () => console.log("Server is running..."));
