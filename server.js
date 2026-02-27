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

// CẤU HÌNH AI GEMINI - DÙNG KEY CỦA BÈO
const genAI = new GoogleGenerativeAI("AIzaSyDXIWsXNqh5fW543eE3EFieV6vnDMH0zMs");

// DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ Database OK"));

const BannedWord = mongoose.model('BannedWord', { word: String });

// HÀM GỌI AI
async function askAI(nickname, comment) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(`Bạn là trợ lý ảo của Bèo. Trả lời ${nickname} cực ngắn gọn về câu: "${comment}".`);
        return result.response.text();
    } catch (e) { return null; }
}

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    let useAI = false;

    socket.on('toggle-ai', (status) => { useAI = status; });

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        
        // FIX LỖI TIKTOK CHẶN: Thêm các tùy chọn request chuyên sâu
        tiktok = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedRequestInfo: true,
            requestOptions: {
                timeout: 10000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            }
        });

        tiktok.connect()
            .then(() => socket.emit('status', `✅ Đã kết nối: ${username}`))
            .catch(err => {
                // Nếu bị chặn, báo lỗi dễ hiểu
                socket.emit('status', `❌ TikTok đang bận, hãy thử bấm kết nối lại vài lần`);
            });

        tiktok.on('chat', async (data) => {
            if (useAI) {
                const aiRes = await askAI(data.nickname, data.comment);
                if (aiRes) {
                    const audio = await getGoogleAudio(aiRes);
                    socket.emit('audio-data', { type: 'ai', user: "AI BÈO", comment: aiRes, audio });
                }
            } else {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });
    });
});

server.listen(process.env.PORT || 3000);
