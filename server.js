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
const io = new Server(server, { 
    cors: { origin: "*" },
    transports: ['websocket', 'polling'] // Sửa lỗi 502 bằng cách cho phép polling
});

app.use(express.json());

// CẤU HÌNH AI GEMINI - Sử dụng Key của Bèo
const genAI = new GoogleGenerativeAI("AIzaSyDXIWsXNqh5fW543eE3EFieV6vnDMH0zMs");

// DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ Database Connected"))
    .catch(err => console.error("❌ DB Error:", err));

const BannedWord = mongoose.model('BannedWord', { word: String });

// HÀM GỌI AI (THÊM BẪY LỖI ĐỂ KHÔNG SẬP SERVER)
async function askAI(nickname, comment) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const prompt = `Bạn là trợ lý ảo của Idol TikTok tên Bèo. Khán giả ${nickname} nói: "${comment}". Trả lời cực ngắn gọn (dưới 15 từ), vui vẻ.`;
        const result = await model.generateContent(prompt);
        return result.response.text();
    } catch (error) {
        console.log("AI Error:", error.message);
        return null; // Trả về null để server vẫn chạy bình thường
    }
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
        
        // Cấu hình kết nối TikTok mạnh mẽ hơn để tránh lỗi Ảnh 3
        tiktok = new WebcastPushConnection(username, {
            processInitialData: false,
            enableExtendedRequestInfo: true,
            requestOptions: {
                timeout: 10000,
            }
        });

        tiktok.connect()
            .then(() => socket.emit('status', `Đã kết nối: ${username}`))
            .catch(err => {
                console.log("TikTok Connect Error:", err.message);
                socket.emit('status', `Lỗi kết nối TikTok (Thử lại sau 1 phút)`);
            });

        tiktok.on('chat', async (data) => {
            if (useAI) {
                const aiRes = await askAI(data.nickname, data.comment);
                if (aiRes) {
                    const audio = await getGoogleAudio(aiRes);
                    socket.emit('audio-data', { type: 'ai', user: "TRỢ LÝ AI", comment: aiRes, audio });
                }
            } else {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy trên port ${PORT}`));
