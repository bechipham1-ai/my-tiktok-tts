const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*" }
});

// Cấu hình URL để tự đánh thức Server trên Render
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_HOSTNAME 
    ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` 
    : `http://localhost:${process.env.PORT || 3000}`;

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/ping', (req, res) => res.send('pong'));

// Tự động Ping để giữ Server luôn thức (5 phút/lần)
setInterval(() => {
    axios.get(`${RENDER_EXTERNAL_URL}/ping`)
        .then(() => console.log('Self-ping: Server is awake'))
        .catch(err => console.log('Self-ping failed:', err.message));
}, 5 * 60 * 1000);

// Bảng tra cứu Icon sang tiếng Việt
const emojiMap = {
    "❤️": "thả tim", "😂": "cười ha ha", "🤣": "cười đau bụng",
    "😍": "mê quá", "🥰": "thương thương", "👍": "like",
    "🙏": "cảm ơn", "😭": "khóc quá trời", "😘": "hôn gió",
    "🔥": "cháy quá", "👏": "vỗ tay", "🌹": "tặng hoa hồng", "🎁": "tặng quà"
};

function replaceEmojis(text) {
    let newText = text;
    for (const [emoji, replacement] of Object.entries(emojiMap)) {
        newText = newText.split(emoji).join(` ${replacement} `);
    }
    const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
    return newText.replace(emojiRegex, "");
}

// Hàm lấy Audio từ Google với mẹo chỉnh giọng "mượt" hơn
async function getGoogleAudio(text) {
    try {
        // Mẹo: Thêm dấu phẩy và kéo dài từ để giọng trẻ trung hơn
        let tunedText = text
            .replace(/Bèo ơi/g, "Bèoo ơi,, ")
            .replace(/vào nè/g, "vào nè... .")
            .replace(/ghé chơi nè/g, "ghé chơi nè... tươi không cần tưới!");

        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(tunedText.substring(0, 200))}&tl=vi&client=tw-ob`;
        
        const response = await axios.get(url, { 
            responseType: 'arraybuffer', 
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        return `data:audio/mp3;base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (e) {
        console.error("Lỗi lấy âm thanh Google");
        return null;
    }
}

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0;

    socket.on('set-username', (username) => {
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        tiktok = new WebcastPushConnection(username, {
            processInitialData: false // Không lấy dữ liệu cũ trước khi kết nối
        });

        startTime = Date.now();

        tiktok.connect().then(async () => {
            socket.emit('status', `Đã kết nối ID: ${username}`);
            const audio = await getGoogleAudio("Kết nối thành công, bắt đầu đọc bình luận nè!");
            socket.emit('audio-data', { type: 'system', user: "Hệ thống", comment: "Đã sẵn sàng!", audio });
        }).catch(err => {
            socket.emit('status', `Lỗi kết nối: ${err.message}`);
        });

        // Đọc bình luận mới
        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const cleanMsg = replaceEmojis(data.comment);
                const audio = await getGoogleAudio(`${data.nickname} nói: ${cleanMsg}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });

        // Chào người mới
        tiktok.on('member', async (data) => {
            if (Date.now() > startTime) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `Anh ${data.nickname} vừa vào`, audio });
            }
        });

        tiktok.on('disconnected', () => {
            socket.emit('status', 'Mất kết nối TikTok, vui lòng thử lại');
        });
        
        tiktok.on('error', (err) => {
            console.error(err);
        });
    });

    socket.on('disconnect', () => {
        if (tiktok) tiktok.disconnect();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
