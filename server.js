const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const emojiMap = {
    "❤️": "thả tim", "😂": "cười ha ha", "🤣": "cười đau bụng",
    "😍": "mê quá", "🥰": "thương thương", "👍": "like",
    "🙏": "cảm ơn", "😭": "khóc quá trời", "😘": "hôn gió",
    "🔥": "quá cháy", "👏": "vỗ tay", "🌹": "tặng hoa hồng", "🎁": "tặng quà"
};

function replaceEmojis(text) {
    let newText = text;
    for (const [emoji, replacement] of Object.entries(emojiMap)) {
        newText = newText.split(emoji).join(` ${replacement} `);
    }
    const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
    return newText.replace(emojiRegex, "");
}

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        return `data:audio/mp3;base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0; // Thời điểm bắt đầu nhấn kết nối

    socket.on('set-username', (username) => {
        if (tiktok) tiktok.disconnect();
        
        tiktok = new WebcastPushConnection(username);
        startTime = Date.now(); // Ghi lại thời gian hiện tại

        tiktok.connect().then(async () => {
            socket.emit('status', `Đã kết nối: ${username}`);
            
            // 1. Tạo thông báo kết nối thành công bằng giọng nói
            const notifyAudio = await getGoogleAudio("Kết nối thành công, bắt đầu đọc bình luận");
            if (notifyAudio) {
                socket.emit('audio-data', { type: 'system', user: "Hệ thống", comment: "Bắt đầu đọc bình luận...", audio: notifyAudio });
            }
        }).catch(err => {
            socket.emit('status', `Lỗi: ${err.message}`);
        });

        // 2. Chào người mới (Chỉ chào người vào sau khi kết nối)
        tiktok.on('member', async (data) => {
            const welcomeText = `Bèo ơi, anh ${data.nickname} ghé chơi nè`;
            const audio = await getGoogleAudio(welcomeText);
            if (audio) {
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `Anh ${data.nickname} ghé chơi nè!`, audio: audio });
            }
        });

        // 3. Đọc bình luận (Chỉ đọc bình luận MỚI)
        tiktok.on('chat', async (data) => {
            // Kiểm tra nếu bình luận đến sau thời điểm kết nối thì mới đọc
            if (Date.now() > startTime) {
                const cleanComment = replaceEmojis(data.comment);
                const textToSpeak = `${data.nickname} nói: ${cleanComment}`;
                const audio = await getGoogleAudio(textToSpeak);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio: audio });
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running!`));
