const socket = io();
let currentUser = "";
let currentRoom = "";
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

// Tự động kiểm tra trạng thái đăng nhập khi vừa tải trang
window.onload = function() {
    fetch('/api/me')
        .then(res => res.json())
        .then(data => {
            if (data.loggedIn) {
                showChatPage(data.username);
            }
        })
        .catch(err => console.error("Lỗi kiểm tra session:", err));
};

// --- LOGIC ĐĂNG KÝ & ĐĂNG NHẬP ---
async function register() {
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value.trim();
    
    if (!u || !p) {
        alert("Vui lòng điền đầy đủ tài khoản và mật khẩu!");
        return;
    }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        }).then(r => r.json());

        alert(res.message);
    } catch (error) {
        alert("Không thể kết nối đến Server để đăng ký.");
    }
}

async function login() {
    const u = document.getElementById('auth-username').value.trim();
    const p = document.getElementById('auth-password').value.trim();

    if (!u || !p) {
        alert("Vui lòng nhập tài khoản và mật khẩu!");
        return;
    }

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        }).then(r => r.json());

        if (res.success) {
            showChatPage(res.username);
        } else {
            alert(res.message);
        }
    } catch (error) {
        alert("Không thể kết nối đến Server để đăng nhập.");
    }
}

function showChatPage(username) {
    currentUser = username;
    // Ẩn khung auth, hiện khung chat
    document.getElementById('auth-container').classList.add('hidden');
    document.getElementById('chat-container').classList.remove('hidden');
    document.getElementById('user-display').innerText = username;

    // Tự động đưa người dùng vào phòng Chat với AI làm phòng mặc định lúc đầu
    switchRoom('AI_Chat');
}

async function logout() {
    try {
        await fetch('/api/logout');
        location.reload(); // Tải lại trang để xóa sạch trạng thái cũ
    } catch (error) {
        location.reload();
    }
}

// --- LOGIC CHUYỂN PHÒNG CHAT ---
function switchRoom(roomName) {
    currentRoom = roomName;
    document.getElementById('current-room-display').innerText = roomName;
    document.getElementById('messages-box').innerHTML = ""; // Xóa tin nhắn phòng cũ trên màn hình
    
    // Gửi tín hiệu lên Server để join phòng realtime
    socket.emit('join_room', { room: roomName, username: currentUser });
}

function joinPrivateChat() {
    const target = document.getElementById('target-user-input').value.trim();
    if (!target) return alert("Vui lòng nhập tên người dùng bạn muốn chat riêng vào ô tìm kiếm.");
    if (target === currentUser) return alert("Bạn không thể tự chat riêng với chính mình!");
    
    // Thuật toán tạo tên phòng duy nhất giữa 2 người (Sắp xếp theo chữ cái)
    const room = [currentUser, target].sort().join('_to__');
    switchRoom(room);
}

function joinGroupChat() {
    const groupName = prompt("Nhập tên nhóm trò chuyện bạn muốn tạo hoặc tham gia:");
    if (groupName && groupName.trim() !== "") {
        switchRoom("Group_" + groupName.trim());
    }
}

// --- LOGIC GỬI & NHẬN TIN NHẮN ---
function sendMessage() {
    const textInput = document.getElementById('msg-input');
    const text = textInput.value.trim();
    if (!text || !currentRoom) return;

    const isPrivate = currentRoom.includes('_to__');
    let receiver = "";
    if (isPrivate) {
        // Lấy tên người kia ra từ tên phòng chat
        receiver = currentRoom.split('_to__').find(name => name !== currentUser);
    }

    socket.emit('send_message', {
        room: currentRoom,
        sender: currentUser,
        text: text,
        isPrivate: isPrivate,
        receiver: receiver
    });
    
    textInput.value = ""; // Xóa chữ trong ô nhập sau khi gửi
    textInput.focus();
}

// Cho phép nhấn Enter để gửi tin nhắn nhanh
document.getElementById('msg-input')?.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendMessage();
});

// Nhận lịch sử tin nhắn cũ từ Server
socket.on('load_history', (history) => {
    document.getElementById('messages-box').innerHTML = ""; // Đảm bảo hộp chat trống
    if(history) {
        history.forEach(msg => displayMessage(msg));
    }
});

// Nhận tin nhắn realtime mới
socket.on('receive_message', (msg) => {
    if (msg.room === currentRoom) {
        displayMessage(msg);
    }
});

// Hiển thị lỗi từ server (Ví dụ: Khi bị chặn)
socket.on('error_message', (err) => { 
    alert(err); 
});

function displayMessage(msg) {
    const box = document.getElementById('messages-box');
    const div = document.createElement('div');
    div.id = `msg-${msg._id}`;
    // Phân loại style tin nhắn của mình (me) hay của người khác
    div.className = `msg-item ${msg.sender === currentUser ? 'me' : ''}`;

    let content = `<b>${msg.sender}</b>`;
    
    if (msg.isRevoked) {
        content += `<i style="color: var(--text-muted);">Tin nhắn đã bị thu hồi</i>`;
    } else if (msg.file) {
        if (msg.file.type && msg.file.type.startsWith('audio/')) {
            content += `<audio controls src="${msg.file.data}"></audio>`;
        } else {
            content += `<a href="${msg.file.data}" download="${msg.file.name}" style="color: inherit; font-weight: 600;">📁 ${msg.file.name}</a>`;
        }
    } else {
        content += `<div>${msg.text}</div>`;
    }

    // Nếu là tin nhắn của mình và chưa thu hồi -> Hiển thị nút Thu hồi mờ
    if (msg.sender === currentUser && !msg.isRevoked) {
        content += `<button class="revoke-btn" onclick="revokeMessage('${msg._id}')">[Thu hồi]</button>`;
    }

    div.innerHTML = content;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight; // Tự động cuộn xuống tin nhắn mới nhất
}

function revokeMessage(msgId) {
    if (confirm("Bạn có chắc chắn muốn thu hồi tin nhắn này?")) {
        socket.emit('revoke_message', { msgId, room: currentRoom });
    }
}

socket.on('message_revoked', (msgId) => {
    const el = document.getElementById(`msg-${msgId}`);
    if (el) {
        const senderB = el.querySelector('b') ? el.querySelector('b').outerHTML : '';
        el.innerHTML = `${senderB} <i style="color: var(--text-muted);">Tin nhắn đã bị thu hồi</i>`;
    }
});

// --- QUẢN LÝ BẠN BÈ / CHẶN ---
function addFriend() {
    const target = document.getElementById('target-user-input').value.trim();
    if (!target) return alert("Vui lòng nhập tên người muốn kết bạn.");
    socket.emit('add_friend', { username: currentUser, friendName: target });
}

function blockUser() {
    const target = document.getElementById('target-user-input').value.trim();
    if (!target) return alert("Vui lòng nhập tên người muốn chặn.");
    if (target === currentUser) return alert("Bạn không thể tự chặn chính mình!");
    socket.emit('block_user', { username: currentUser, blockName: target });
}

socket.on('friend_updated', (msg) => alert(msg));

// --- TÍNH NĂNG GỬI FILE ---
function triggerFileInput() { 
    document.getElementById('file-input').click(); 
}

function sendFile(input) {
    const file = input.files[0];
    if (!file) return;
    
    if (file.size > 10 * 1024 * 1024) { // Giới hạn file 10MB để tránh nghẽn socket
        return alert("Hệ thống chỉ hỗ trợ gửi file dưới 10MB.");
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        socket.emit('send_message', {
            room: currentRoom,
            sender: currentUser,
            file: { data: e.target.result, name: file.name, type: file.type }
        });
        input.value = ""; // Reset input file
    };
    reader.readAsDataURL(file);
}

// --- TÍNH NĂNG GỬI VOICE (TIN NHẮN THOẠI) ---
async function toggleVoiceRecord() {
    const btn = document.getElementById('voice-btn');
    if (!isRecording) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];
            
            mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };
            
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                const reader = new FileReader();
                reader.onload = function(e) {
                    socket.emit('send_message', {
                        room: currentRoom,
                        sender: currentUser,
                        file: { data: e.target.result, name: 'voice_note.mp3', type: 'audio/mp3' }
                    });
                };
                reader.readAsDataURL(audioBlob);
            };
            
            mediaRecorder.start();
            btn.innerHTML = "🛑";
            btn.style.background = "#ff4d4f";
            isRecording = true;
        } catch (err) {
            alert("Không thể truy cập Microphone của bạn.");
        }
    } else {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
        btn.innerHTML = "🎤";
        btn.style.background = "";
        isRecording = false;
    }
}

// --- VIDEO CALL ---
async function startVideoCall() {
    document.getElementById('video-area').classList.remove('hidden');
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local-video').srcObject = stream;
        alert("Đang yêu cầu kết nối Camera... Hệ thống gọi video realtime đã được bật.");
    } catch (err) {
        alert("Lỗi: Không tìm thấy hoặc không thể mở thiết bị Camera/Microphone.");
    }
}