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

// KẾT NỐI DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ Kết nối MongoDB thành công"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });

// --- API QUẢN TRỊ ---
app.get('/api/words', async (req, res) => {
    const data = await BannedWord.find();
    res.json(data.map(w => w.word));
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

// ANTI-SLEEP
const RENDER_URL = process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : `http://localhost:3000`;
app.get('/ping', (req, res) => res.send('pong'));
setInterval(() => axios.get(`${RENDER_URL}/ping`).catch(() => {}), 5 * 60 * 1000);

// XỬ LÝ VĂN BẢN
async function processText(text) {
    let lowerText = text.toLowerCase();
    const banned = await BannedWord.find();
    for (let b of banned) { if (lowerText.includes(b.word)) return null; }
    const acronyms = await Acronym.find();
    let finalChat = text;
    acronyms.forEach(a => {
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
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        // 1. CHAT
        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const finalContent = await processText(data.comment);
                if (finalContent) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${finalContent}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, processed: finalContent, audio });
                }
            }
        });

        // HÀM CHÀO CHUNG (Dùng cho cả Member và RoomUser)
        async function handleWelcome(data, isVip = false) {
            if (Date.now() <= startTime) return;

            let fLevel = 0;
            if (data.fanTicket && data.fanTicket.level) fLevel = data.fanTicket.level;

            const prefix = isVip ? "Chào mừng khách quý " : "Chào ";
            const audio = await getGoogleAudio(`${prefix} ${data.nickname} vừa ghé chơi nè`);
            
            socket.emit('audio-data', { 
                type: 'welcome', 
                user: isVip ? "KHÁCH VIP" : "Hệ thống", 
                comment: `${data.nickname} đã tham gia (Lv.${fLevel})`, 
                audio, 
                fanLevel: fLevel 
            });
        }

        // 2. MEMBER VÀO PHÒNG (Dòng chữ phía dưới)
        tiktok.on('member', (data) => handleWelcome(data, false));

        // 3. ROOM USER (Dòng chữ bay phía trên - Cấp cao)
        tiktok.on('roomUser', (data) => handleWelcome(data, true));
        
        // 4. DỰ PHÒNG SOCIAL (Một số trường hợp VIP khác)
        tiktok.on('social', (data) => {
            if (data.displayType && data.displayType.includes('join')) {
                handleWelcome(data, true);
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại port ${PORT}`));
