const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// KẾT NỐI MONGODB ATLAS (Thay chuỗi dưới đây bằng chuỗi của bạn)
const DB_URL = 'mongodb+srv://0986407002:Tuyenbui237@tuyen.uirvncp.mongodb.net/?appName=Tuyen';

mongoose.connect(DB_URL)
    .then(() => console.log('Đã kết nối MongoDB Atlas trực tuyến thành công.'))
    .catch(err => console.error('Lỗi kết nối database:', err));

const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    friends: [String],
    blocked: [String]
});
const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
    room: String,
    sender: String,
    text: String,
    file: { data: String, name: String, type: String },
    timestamp: { type: Date, default: Date.now },
    isRevoked: { type: Boolean, default: false }
});
const Message = mongoose.model('Message', MessageSchema);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'secret_key_chuoi_bao_mat',
    resave: false,
    saveUninitialized: true
}));

app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword });
        await newUser.save();
        res.json({ success: true, message: "Đăng ký thành công!" });
    } catch (error) {
        res.json({ success: false, message: "Tên tài khoản đã tồn tại." });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
        req.session.username = username;
        res.json({ success: true, username });
    } else {
        res.json({ success: false, message: "Sai tài khoản hoặc mật khẩu." });
    }
});

app.get('/api/me', (req, res) => {
    if (req.session.username) res.json({ loggedIn: true, username: req.session.username });
    else res.json({ loggedIn: false });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

io.on('connection', (socket) => {
    socket.on('join_room', async ({ room, username }) => {
        socket.join(room);
        const history = await Message.find({ room }).sort({ timestamp: 1 });
        socket.emit('load_history', history);
    });

    socket.on('send_message', async (data) => {
        if (data.isPrivate) {
            const targetUser = await User.findOne({ username: data.receiver });
            if (targetUser && targetUser.blocked.includes(data.sender)) {
                return socket.emit('error_message', 'Bạn đã bị người này chặn.');
            }
        }

        const msg = new Message({
            room: data.room,
            sender: data.sender,
            text: data.text,
            file: data.file || null
        });
        await msg.save();

        io.to(data.room).emit('receive_message', msg);

        if (data.room === 'AI_Chat' && data.sender !== 'AI_Assistant') {
            setTimeout(async () => {
                const aiReply = new Message({
                    room: 'AI_Chat',
                    sender: 'AI_Assistant',
                    text: `[🤖 AI] Chào ${data.sender}! Tôi là AI phản hồi tự động của bạn đây.`
                });
                await aiReply.save();
                io.to('AI_Chat').emit('receive_message', aiReply);
            }, 1000);
        }
    });

    socket.on('revoke_message', async ({ msgId, room }) => {
        await Message.findByIdAndUpdate(msgId, { isRevoked: true, text: "Tin nhắn đã bị thu hồi", file: null });
        io.to(room).emit('message_revoked', msgId);
    });

    socket.on('add_friend', async ({ username, friendName }) => {
        await User.findOneAndUpdate({ username }, { $addToSet: { friends: friendName } });
        socket.emit('friend_updated', 'Đã thêm bạn thành công.');
    });

    socket.on('block_user', async ({ username, blockName }) => {
        await User.findOneAndUpdate({ username }, { $addToSet: { blocked: blockName } });
        socket.emit('friend_updated', `Đã chặn ${blockName}.`);
    });

    socket.on('disconnect', () => {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server đang chạy trên cổng ${PORT}`));