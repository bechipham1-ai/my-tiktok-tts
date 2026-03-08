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
app.use(express.static(__dirname)); // Đảm bảo phục vụ file tĩnh

const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_tts?retryWrites=true&w=majority&appName=Cluster0";
mongoose.connect(MONGODB_URI).then(() => console.log("✅ MongoDB Connected"));

const BannedWord = mongoose.model('BannedWord', { word: String });
const Acronym = mongoose.model('Acronym', { key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { keyword: String, response: String });

// --- CÁC API QUẢN TRỊ (Giữ nguyên) ---
app.get('/api/words', async (req, res) => res.json((await BannedWord.find()).map(w => w.word)));
app.post('/api/words', async (req, res) => { const word = req.body.word ? req.body.word.toLowerCase().trim() : ""; if (word) await BannedWord.updateOne({ word }, { word }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/words/:word', async (req, res) => { await BannedWord.deleteOne({ word: req.params.word }); res.sendStatus(200); });
app.get('/api/acronyms', async (req, res) => res.json(await Acronym.find()));
app.post('/api/acronyms', async (req, res) => { const { key, value } = req.body; if (key && value) await Acronym.findOneAndUpdate({ key: key.toLowerCase().trim() }, { value: value.trim() }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/acronyms/:key', async (req, res) => { await Acronym.deleteOne({ key: req.params.key }); res.sendStatus(200); });
app.get('/api/emojis', async (req, res) => res.json(await EmojiMap.find()));
app.post('/api/emojis', async (req, res) => { const { icon, text } = req.body; if (icon && text) await EmojiMap.findOneAndUpdate({ icon: icon.trim() }, { text: text.trim() }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/emojis/:id', async (req, res) => { await EmojiMap.findByIdAndDelete(req.params.id); res.sendStatus(200); });
app.get('/api/bot', async (req, res) => res.json(await BotAnswer.find()));
app.post('/api/bot', async (req, res) => { const { keyword, response } = req.body; if (keyword && response) await BotAnswer.findOneAndUpdate({ keyword: keyword.toLowerCase().trim() }, { response: response.trim() }, { upsert: true }); res.sendStatus(200); });
app.delete('/api/bot/:id', async (req, res) => { await BotAnswer.findByIdAndDelete(req.params.id); res.sendStatus(200); });

// --- HÀM XỬ LÝ ---
async function isBanned(text) { if (!text) return false; const banned = await BannedWord.find(); return banned.some(b => text.toLowerCase().includes(b.word)); }
async function processText(text) {
    if (!text || await isBanned(text)) return null;
    let processed = text;
    const emojis = await EmojiMap.find();
    for (const e of emojis) { processed = processed.split(e.icon).join(" " + e.text + " "); }
    processed = processed.replace(/(\d{2})\d+/g, '$1');
    const acronyms = await Acronym.find();
    acronyms.forEach(a => { const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu'); processed = processed.replace(regex, a.value); });
    return processed;
}
async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

io.on('connection', (socket) => {
    let tiktok;
    let filters = { welcome: true, gift: true, bot: true, pk: true };
    socket.on('update-filters', (f) => filters = f);

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username, { processInitialData: false });
        tiktok.connect().then(() => socket.emit('status', `Đã kết nối: ${username}`));

        tiktok.on('chat', async (data) => {
            if (await isBanned(data.nickname)) return;
            const botRules = await BotAnswer.find();
            const match = botRules.find(r => data.comment.toLowerCase().includes(r.keyword));
            if (match && filters.bot) {
                const audio = await getGoogleAudio(`Anh ${data.nickname} ơi, ${match.response}`);
                socket.emit('audio-data', { type: 'bot', user: "TRỢ LÝ", comment: `Trả lời: ${match.response}`, audio });
            } else {
                const final = await processText(data.comment);
                if (final) {
                    const audio = await getGoogleAudio(`${data.nickname} nói: ${final}`);
                    socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
                }
            }
        });

        tiktok.on('member', async (data) => {
            if (filters.welcome && !(await isBanned(data.nickname))) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "HỆ THỐNG", comment: `${data.nickname} vào xem`, audio });
            }
        });

        tiktok.on('gift', async (data) => {
            if (filters.gift && data.gift && data.repeatEnd && !(await isBanned(data.nickname))) {
                const audio = await getGoogleAudio(`Cảm ơn ${data.nickname} đã tặng ${data.giftName}`);
                socket.emit('audio-data', { type: 'gift', user: "QUÀ", comment: `${data.nickname} tặng ${data.giftName}`, audio });
            }
        });
    });
});

server.listen(3000, () => console.log("Server chạy tại cổng 3000"));
