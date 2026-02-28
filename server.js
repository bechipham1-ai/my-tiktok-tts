const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// KẾT NỐI DATABASE
const MONGODB_URI = "mongodb+srv://baoboi97:baoboi97@cluster0.skkajlz.mongodb.net/tiktok_multi?retryWrites=true&w=majority";
mongoose.connect(MONGODB_URI);

// SCHEMAS
const User = mongoose.model('User', { username: { type: String, unique: true }, password: String });
const BannedWord = mongoose.model('BannedWord', { owner: String, word: String });
const Acronym = mongoose.model('Acronym', { owner: String, key: String, value: String });
const EmojiMap = mongoose.model('EmojiMap', { owner: String, icon: String, text: String });
const BotAnswer = mongoose.model('BotAnswer', { owner: String, keyword: String, response: String });

// --- HỆ THỐNG AUTH ---
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = new User({ username: username.toLowerCase(), password });
        await user.save();
        res.json({ success: true });
    } catch (e) { res.status(400).json({ error: "Tên đăng nhập đã tồn tại!" }); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username: username.toLowerCase(), password });
    if (user) res.json({ success: true, username: user.username });
    else res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu!" });
});

// --- API DATA (Yêu cầu owner trong query) ---
app.get('/api/data/:type', async (req, res) => {
    const { type } = req.params; const { owner } = req.query;
    if (type === 'words') res.json((await BannedWord.find({ owner })).map(w => w.word));
    else if (type === 'acr') res.json(await Acronym.find({ owner }));
    else if (type === 'emo') res.json(await EmojiMap.find({ owner }));
    else res.json(await BotAnswer.find({ owner }));
});

app.post('/api/data/:type', async (req, res) => {
    const { type } = req.params; const { owner, v1, v2 } = req.body;
    if (type === 'words') await BannedWord.updateOne({ owner, word: v1.toLowerCase() }, { owner, word: v1.toLowerCase() }, { upsert: true });
    else if (type === 'acr') await Acronym.findOneAndUpdate({ owner, key: v1.toLowerCase() }, { value: v2 }, { upsert: true });
    else if (type === 'emo') await EmojiMap.findOneAndUpdate({ owner, icon: v1 }, { text: v2 }, { upsert: true });
    else await BotAnswer.findOneAndUpdate({ owner, keyword: v1.toLowerCase() }, { response: v2 }, { upsert: true });
    res.sendStatus(200);
});

app.delete('/api/data/:type', async (req, res) => {
    const { type } = req.params; const { owner, id, word } = req.query;
    if (type === 'words') await BannedWord.deleteOne({ owner, word });
    else if (type === 'acr') await Acronym.findByIdAndDelete(id);
    else if (type === 'emo') await EmojiMap.findByIdAndDelete(id);
    else await BotAnswer.findByIdAndDelete(id);
    res.sendStatus(200);
});

// HÀM XỬ LÝ TTS (Như cũ nhưng truyền owner)
async function processText(text, owner) {
    if (!text) return null;
    const banned = await BannedWord.find({ owner });
    if (banned.some(b => text.toLowerCase().includes(b.word))) return null;
    let processed = text;
    const emojis = await EmojiMap.find({ owner });
    for (const e of emojis) processed = processed.split(e.icon).join(" " + e.text + " ");
    const acronyms = await Acronym.find({ owner });
    acronyms.forEach(a => {
        const regex = new RegExp(`(?<!\\p{L})${a.key}(?!\\p{L})`, 'giu');
        processed = processed.replace(regex, a.value);
    });
    return processed;
}

async function getAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const res = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(res.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    let tiktok;
    socket.on('start-live', async ({ tiktokID, owner }) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(tiktokID);
        tiktok.connect().then(() => socket.emit('status', `✅ Đang Live: ${tiktokID}`)).catch(e => socket.emit('status', `❌ Lỗi TikTok ID`));
        
        tiktok.on('chat', async (data) => {
            const bot = await BotAnswer.findOne({ owner, keyword: data.comment.toLowerCase() });
            if (bot) {
                const audio = await getAudio(`Anh ${data.nickname} ơi, ${bot.response}`);
                socket.emit('audio-data', { user: "BOT", comment: bot.response, audio });
            } else {
                const clean = await processText(data.comment, owner);
                if (clean) {
                    const audio = await getAudio(`${data.nickname} nói ${clean}`);
                    socket.emit('audio-data', { user: data.nickname, comment: data.comment, audio });
                }
            }
        });
        // (Thêm các sự kiện Gift, Member tương tự bản cũ...)
    });
});
server.listen(process.env.PORT || 3000);
