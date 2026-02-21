const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

async function getGoogleAudio(text) {
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.substring(0, 200))}&tl=vi&client=tw-ob`;
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 3000 });
        return `data:audio/mp3;base64,${Buffer.from(response.data, 'binary').toString('base64')}`;
    } catch (e) { return null; }
}

io.on('connection', (socket) => {
    let tiktok;
    let startTime = 0;

    socket.on('set-username', (username) => {
        // Xóa sạch kết nối cũ nếu có trước khi tạo mới
        if (tiktok) {
            tiktok.disconnect();
            tiktok = null;
        }

        tiktok = new WebcastPushConnection(username, { 
            processInitialData: false,
            enableExtendedGiftInfo: true
        });

        startTime = Date.now();

        tiktok.connect().then(async (state) => {
            socket.emit('status', `Kết nối thành công: ${username}`);
            const audio = await getGoogleAudio("Hệ thống đã sẵn sàng");
            socket.emit('audio-data', { type: 'system', user: "Hệ thống", comment: "Bắt đầu...", audio });
        }).catch(err => {
            socket.emit('status', `Lỗi: ${err.message}`);
        });

        tiktok.on('chat', async (data) => {
            if (Date.now() > startTime) {
                const audio = await getGoogleAudio(`${data.nickname} nói: ${data.comment}`);
                socket.emit('audio-data', { type: 'chat', user: data.nickname, comment: data.comment, audio });
            }
        });

        tiktok.on('member', async (data) => {
            if (Date.now() > startTime) {
                const audio = await getGoogleAudio(`Bèo ơi, anh ${data.nickname} ghé chơi nè`);
                socket.emit('audio-data', { type: 'welcome', user: "Hệ thống", comment: `Anh ${data.nickname} vào`, audio });
            }
        });

        tiktok.on('error', (err) => {
            socket.emit('status', `TikTok Error: ${err.message}`);
        });
    });

    socket.on('disconnect', () => { if (tiktok) tiktok.disconnect(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server is online'));
