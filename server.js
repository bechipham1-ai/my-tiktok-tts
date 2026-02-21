const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const emojiMap = { "❤️": "thả tim", "😂": "cười ha ha", "👍": "like", "🔥": "cháy quá", "🌹": "tặng hoa" };

function replaceEmojis(text) {
    let newText = text;
    for (const [emoji, replacement] of Object.entries(emojiMap)) {
        newText = newText.split(emoji).join(` ${replacement} `);
    }
    return newText.replace(/([\uE000-\uF8FF]|\uD83C[\uDF00-\uDFFF]|\uD83D[\uDC00-\uDDFF])/g, "");
}

async function getGoogleAudio(text) {
    try {
        // Rút ngắn text để tránh lỗi URL quá dài
        const shortText = text.substring(0, 200);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(shortText)}&tl=vi&client=tw-ob`;
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            timeout: 5000, // Quá 5s không phản hồi thì bỏ qua
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        return `data:audio/mp3;base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.log("Google chặn hoặc lỗi kết nối");
        return null; // Trả về null để web biết và bỏ qua âm thanh này
    }
}

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0;

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        tiktok = new WebcastPushConnection(username);
        startTime = Date.now();

        tiktok.connect().then(async () => {
            socket.emit('status', `Đã kết nối: ${username}`);
            const audio = await getGoogleAudio("Kết nối thành công");
            socket.emit('audio-data', { type: 'system', user: "Hệ thống", comment: "Bắt đầu đọc...", audio });
        }).catch(err => socket.emit('status', `Lỗi: ${err.message}`));

        tiktok.on('member', async (data) => {
            const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
            socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `Anh ${data.nickname} ghé chơi`, audio });
        });

        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const cleanMsg = replaceEmojis(data.comment);
                const audio = await getGoogleAudio(`${data.nickname} nói: ${cleanMsg}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Live!`));
