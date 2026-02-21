const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');
const axios = require('axios');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

io.on('connection', (socket) => {
    let tiktokConnection;

    socket.on('set-username', (username) => {
        if (tiktokConnection) tiktokConnection.disconnect();

        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection.connect().then(state => {
            socket.emit('status', `Đã kết nối tới: ${username}`);
        }).catch(err => {
            socket.emit('status', `Lỗi: ${err.message}`);
        });

        tiktokConnection.on('chat', async (data) => {
            try {
                // Tạo link Google TTS
                const text = `${data.nickname} nói: ${data.comment}`;
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=vi&client=tw-ob`;
                
                // Server tải âm thanh về (để tránh bị chặn IP người dùng)
                const response = await axios.get(ttsUrl, { responseType: 'arraybuffer' });
                const base64Audio = Buffer.from(response.data, 'binary').toString('base64');
                const audioSrc = `data:audio/mp3;base64,${base64Audio}`;

                // Gửi về trình duyệt
                io.emit('audio-comment', {
                    user: data.nickname,
                    comment: data.comment,
                    audioSrc: audioSrc
                });
            } catch (error) {
                console.error("Lỗi Google TTS:", error.message);
                // Nếu lỗi âm thanh, vẫn gửi text về để hiển thị
                io.emit('new-comment', { user: data.nickname, comment: data.comment });
            }
        });
    });

    socket.on('disconnect', () => {
        if (tiktokConnection) tiktokConnection.disconnect();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server đang chạy tại cổng ${PORT}`);
});
