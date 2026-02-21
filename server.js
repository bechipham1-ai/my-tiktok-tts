const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    let tiktokConnection;

    socket.on('set-username', (username) => {
        if (tiktokConnection) tiktokConnection.disconnect();
        tiktokConnection = new WebcastPushConnection(username);

        tiktokConnection.connect().then(state => {
            socket.emit('status', `Đã kết nối tới Live của: ${username}`);
        }).catch(err => {
            socket.emit('status', `Lỗi: ${err.message}`);
        });

        tiktokConnection.on('chat', data => {
            socket.emit('new-comment', { user: data.nickname, comment: data.comment });
        });
    });
});

server.listen(PORT, () => {
    console.log(`Server chạy tại port ${PORT}`);
});