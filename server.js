const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cấu hình để nhận diện file index.html nằm cùng thư mục
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    let tiktokConnection;

    socket.on('set-username', (username) => {
        if (tiktokConnection) tiktokConnection.disconnect();
        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection.connect().then(state => {
            socket.emit('status', `Đã kết nối: ${username}`);
        }).catch(err => {
            socket.emit('status', `Lỗi kết nối: ${err.message}`);
        });

        tiktokConnection.on('chat', async (data) => {
            try {
                const text = `${data.nickname} nói: ${data.comment}`;
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
                
                // Server tải audio tránh bị chặn IP người dùng
                const response = await axios.get(ttsUrl, { responseType: 'arraybuffer' });
                const base64Audio = Buffer.from(response.data, 'binary').toString('base64');

                io.emit('audio-comment', {
                    user: data.nickname,
                    comment: data.comment,
                    audioSrc: `data:audio/mp3;base64,${base64Audio}`
                });
            } catch (error) {
                io.emit('audio-comment', { user: data.nickname, comment: data.comment, audioSrc: null });
            }
        });
    });

    socket.on('disconnect', () => { if (tiktokConnection) tiktokConnection.disconnect(); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server chạy tại cổng ${PORT}`));
