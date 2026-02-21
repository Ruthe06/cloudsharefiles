document.addEventListener('DOMContentLoaded', () => {
    const socket = io();

    // App Mode Selection
    const modeSelectionSection = document.getElementById('modeSelectionSection');
    const modeFileOnlyBtn = document.getElementById('modeFileOnlyBtn');
    const modeVideoCallBtn = document.getElementById('modeVideoCallBtn');
    const modeAudioCallBtn = document.getElementById('modeAudioCallBtn');
    const modePrivateChatBtn = document.getElementById('modePrivateChatBtn');

    // UI Elements - Room
    const roomSection = document.getElementById('roomSection');
    const mainInterfaceSection = document.getElementById('mainInterfaceSection');
    const createRoomBtn = document.getElementById('createRoomBtn');
    const roomIdInput = document.getElementById('roomIdInput');
    const joinRoomBtn = document.getElementById('joinRoomBtn');
    const currentRoomDisplay = document.getElementById('currentRoomDisplay');
    const notificationArea = document.getElementById('notificationArea');

    // UI Elements - Chat
    const chatInput = document.getElementById('chatInput');
    const sendChatBtn = document.getElementById('sendChatBtn');
    const chatMessages = document.getElementById('chatMessages');
    const typingIndicator = document.getElementById('typingIndicator');

    // UI Elements - Video/Call Controls
    const videoContainer = document.getElementById('videoContainer');
    const localVideo = document.getElementById('localVideo');
    const remoteVideo = document.getElementById('remoteVideo');
    const startCallBtn = document.getElementById('startCallBtn');
    const endCallBtn = document.getElementById('endCallBtn');
    const micToggleBtn = document.getElementById('micToggleBtn');
    const videoToggleBtn = document.getElementById('videoToggleBtn');

    // UI Elements - File Sharing
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileInfoContainer = document.getElementById('fileInfoContainer');
    const uploadBtn = document.getElementById('uploadBtn');

    // UI - Upload Progress
    const uploadProgressBox = document.getElementById('uploadProgressBox');
    const uploadPercent = document.getElementById('uploadPercent');
    const uploadFill = document.getElementById('uploadFill');

    // UI - Download Progress
    const downloadProgressBox = document.getElementById('downloadProgressBox');
    const downloadPercent = document.getElementById('downloadPercent');
    const downloadFill = document.getElementById('downloadFill');
    const saveFileBtn = document.getElementById('saveFileBtn');

    // State Variables
    let appMode = 'video'; // 'video' or 'file_only'
    let currentRoom = null;
    let localStream = null;
    let peerConnection = null;

    // File Transfer State
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks (as specified)
    let selectedFile = null;

    // Download State
    let expectedChunks = 0;
    let receivedChunksCount = 0;
    let fileChunksData = [];
    let finalFileName = 'download';
    let finalFileType = 'application/octet-stream';
    let pendingDownloads = new Set();
    const CONCURRENT_DOWNLOADS = 5;
    let downloadQueue = [];
    let isDownloading = false;

    const configuration = {
        'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }]
    };

    function notify(msg, type = 'info') {
        notificationArea.innerText = msg;
        notificationArea.style.color = type === 'error' ? 'var(--error)' : (type === 'success' ? 'var(--success)' : 'var(--text-secondary)');
    }

    // ==========================================
    // MODE LOGIC
    // ==========================================
    function setupAppMode(mode) {
        appMode = mode;
        modeSelectionSection.style.display = 'none';
        roomSection.style.display = 'flex';

        const chatContainer = document.querySelector('.chat-container');

        // Hide features depending on mode
        videoContainer.style.display = 'none';
        chatContainer.style.display = 'none';

        if (mode === 'video' || mode === 'audio') {
            videoContainer.style.display = 'flex';
        } else if (mode === 'chat') {
            chatContainer.style.display = 'block';
        }
        // file_only shows just the default file interface (always visible)
    }

    modeFileOnlyBtn.addEventListener('click', () => setupAppMode('file_only'));
    modeVideoCallBtn.addEventListener('click', () => setupAppMode('video'));
    modeAudioCallBtn.addEventListener('click', () => setupAppMode('audio'));
    modePrivateChatBtn.addEventListener('click', () => setupAppMode('chat'));

    // ==========================================
    // ROOM LOGIC
    // ==========================================
    createRoomBtn.addEventListener('click', () => {
        const id = Math.random().toString(36).substring(2, 8).toUpperCase();
        joinRoom(id);
    });

    joinRoomBtn.addEventListener('click', () => {
        const id = roomIdInput.value.trim().toUpperCase();
        if (id) joinRoom(id);
    });

    function joinRoom(roomId) {
        currentRoom = roomId;
        socket.emit('join_room', currentRoom);

        roomSection.style.display = 'none';
        mainInterfaceSection.style.display = 'block';
        currentRoomDisplay.innerText = currentRoom;

        const roomLinkDisplay = document.getElementById('roomLinkDisplay');
        if (roomLinkDisplay) {
            let shareLink = '';
            if (appMode === 'file_only') {
                shareLink = `${window.location.origin}/receiver.html?id=${currentRoom}`;
            } else {
                shareLink = `${window.location.origin}/?room=${currentRoom}&mode=${appMode}`;
            }
            roomLinkDisplay.innerHTML = `Or share this link: <a href="${shareLink}" target="_blank" style="color: var(--accent); text-decoration: underline;">${shareLink}</a>`;
        }

        notify('Joined room. Waiting for peers...');
        if (appMode === 'video' || appMode === 'audio') {
            initLocalStream(appMode === 'video');
        }
    }

    // ==========================================
    // WEBRTC LOGIC
    // ==========================================
    async function initLocalStream(requestVideo = true) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: requestVideo, audio: true });

            if (requestVideo) {
                localVideo.srcObject = localStream;
            } else {
                // If audio only, we don't strictly need localVideo to play, but it handles tracks
                localVideo.srcObject = localStream;
            }

            startCallBtn.disabled = false;
        } catch (err) {
            console.error('Error accessing media config:', err);
            notify('Camera/Microphone access denied!', 'error');
        }
    }

    function createPeerConnection() {
        if (peerConnection) return;

        peerConnection = new RTCPeerConnection(configuration);

        // Add local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                peerConnection.addTrack(track, localStream);
            });
        }

        // On remote track received
        peerConnection.ontrack = event => {
            remoteVideo.srcObject = event.streams[0];
        };

        // ICE Candidates
        peerConnection.onicecandidate = event => {
            if (event.candidate && currentRoom) {
                socket.emit('ice_candidate', { roomId: currentRoom, candidate: event.candidate });
            }
        };

        // Connection state
        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === 'connected') {
                notify('Call Connected!', 'success');
                startCallBtn.disabled = true;
                endCallBtn.disabled = false;
            }
        };
    }

    startCallBtn.addEventListener('click', async () => {
        if (!currentRoom || appMode === 'file_only') return;
        notify('Calling peer...');
        createPeerConnection();

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('offer', { roomId: currentRoom, sdp: peerConnection.localDescription });
    });

    endCallBtn.addEventListener('click', () => {
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        startCallBtn.disabled = false;
        endCallBtn.disabled = true;
        notify('Call ended.');
    });

    // Media Toggles
    micToggleBtn.addEventListener('click', () => {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                micToggleBtn.classList.toggle('off', !audioTrack.enabled);
            }
        }
    });

    videoToggleBtn.addEventListener('click', () => {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                videoToggleBtn.classList.toggle('off', !videoTrack.enabled);
            }
        }
    });

    // Signaling Socket Events
    socket.on('user_joined', () => {
        if (appMode === 'video' || appMode === 'audio') {
            notify('A peer joined the room. You can start the call.', 'success');
        } else {
            notify('A peer joined the room.', 'success');
        }
    });

    socket.on('offer', async (data) => {
        if (appMode === 'file_only' || appMode === 'chat') return;

        notify('Incoming call... auto answering.');
        createPeerConnection();
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('answer', { roomId: currentRoom, sdp: peerConnection.localDescription });
    });

    socket.on('answer', async (data) => {
        if (peerConnection) {
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
        }
    });

    socket.on('ice_candidate', async (data) => {
        if (peerConnection && data.candidate) {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
            } catch (e) { console.error('Error adding ice candidate', e); }
        }
    });

    socket.on('user_left', () => {
        notify('Peer left the room.');
        if (peerConnection) {
            peerConnection.close();
            peerConnection = null;
        }
        remoteVideo.srcObject = null;
        startCallBtn.disabled = false;
        endCallBtn.disabled = true;
    });

    // ==========================================
    // CHAT LOGIC (EPHEMERAL)
    // ==========================================
    function sendMessage() {
        const text = chatInput.value.trim();
        if (!text || !currentRoom) return;

        // Display locally
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message self';
        msgDiv.innerText = text;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Emit to server
        socket.emit('chat_message', { roomId: currentRoom, message: text });
        chatInput.value = '';
    }

    sendChatBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    let typingTimeout;
    chatInput.addEventListener('input', () => {
        if (!currentRoom) return;
        socket.emit('typing', { roomId: currentRoom });
    });

    socket.on('chat_message', (message) => {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message peer';
        msgDiv.innerText = message;
        chatMessages.appendChild(msgDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    socket.on('typing', () => {
        typingIndicator.classList.add('active');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            typingIndicator.classList.remove('active');
        }, 1500);
    });

    // ==========================================
    // FILE SHARING (SENDER)
    // ==========================================
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; });
    dropZone.addEventListener('dragleave', () => { dropZone.style.borderColor = 'var(--glass-border)'; });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--glass-border)';
        if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileSelect(e.target.files[0]);
    });

    function handleFileSelect(file) {
        selectedFile = file;
        dropZone.style.display = 'none';
        fileInfoContainer.style.display = 'block';
        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

        fileInfoContainer.innerHTML = `
            <div class="file-info">
                <div class="file-details">
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${sizeMB} MB</span>
                </div>
            </div>
        `;
        uploadBtn.disabled = false;
    }

    uploadBtn.addEventListener('click', async () => {
        if (!selectedFile || !currentRoom) return;

        uploadBtn.disabled = true;
        uploadProgressBox.style.display = 'block';

        const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);
        let uploadedBytes = 0;
        let hasError = false;

        // Requirement 5: Upload sequentially (1MB chunks)
        for (let i = 0; i < totalChunks; i++) {
            if (hasError) break;

            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
            const chunk = selectedFile.slice(start, end);

            const url = `/api/upload-chunk?fileId=${currentRoom}&chunkIndex=${i}&totalChunks=${totalChunks}&fileName=${encodeURIComponent(selectedFile.name)}&fileType=${encodeURIComponent(selectedFile.type)}&senderId=${socket.id}`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: chunk
                });

                if (!response.ok) throw new Error('Upload failed');

                uploadedBytes += chunk.size;
                const percent = Math.round((uploadedBytes / selectedFile.size) * 100);

                uploadFill.style.width = `${percent}%`;
                uploadPercent.innerText = `${percent}%`;
            } catch (err) {
                console.error("Chunk upload error:", err);
                notify("Upload failed.", "error");
                hasError = true;
                uploadBtn.disabled = false;
            }
        }

        if (!hasError) {
            notify("File completely uploaded to cloud!", "success");
            uploadPercent.innerText = "100% - Done";
        }
    });

    // ==========================================
    // FILE SHARING (RECEIVER)
    // ==========================================
    socket.on('chunk_received', (data) => {
        if (data.senderId === socket.id) return; // Prevent sender from downloading own file

        downloadProgressBox.style.display = 'block';
        saveFileBtn.style.display = 'none'; // reset just in case

        const { chunkIndex, totalChunks, chunkUrl, fileName, fileType } = data;

        expectedChunks = totalChunks;
        finalFileName = fileName || 'download';
        finalFileType = fileType || 'application/octet-stream';

        downloadQueue.push({ chunkIndex, chunkUrl });
        processDownloadQueue();
    });

    async function processDownloadQueue() {
        if (isDownloading) return;
        isDownloading = true;

        while (downloadQueue.length > 0) {
            while (pendingDownloads.size < CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
                const chunkData = downloadQueue.shift();
                const downloadPromise = downloadChunk(chunkData).finally(() => {
                    pendingDownloads.delete(downloadPromise);
                });
                pendingDownloads.add(downloadPromise);
            }
            if (pendingDownloads.size > 0) {
                await Promise.race(pendingDownloads);
            }
        }
        isDownloading = false;
    }

    async function downloadChunk({ chunkIndex, chunkUrl }) {
        try {
            const response = await fetch(chunkUrl);
            const arrayBuffer = await response.arrayBuffer();

            fileChunksData[chunkIndex] = arrayBuffer;
            receivedChunksCount++;

            const percent = Math.round((receivedChunksCount / expectedChunks) * 100);
            downloadFill.style.width = `${percent}%`;
            downloadPercent.innerText = `${percent}%`;

            if (receivedChunksCount === expectedChunks) {
                mergeAndDownload();
            }
        } catch (err) {
            console.error("Error receiving chunk:", err);
            notify("Download failed. Chunk might have expired.", "error");
        }
    }

    function mergeAndDownload() {
        notify("Merging chunks...", "info");

        if (fileChunksData.length !== expectedChunks || fileChunksData.includes(undefined)) {
            notify("Error: Missing chunks during merge.", "error");
            return;
        }

        const blob = new Blob(fileChunksData, { type: finalFileType });
        const url = URL.createObjectURL(blob);

        notify("File received successfully!", "success");
        saveFileBtn.style.display = 'block';

        saveFileBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = url;
            a.download = finalFileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        };

        // Reset for next file
        receivedChunksCount = 0;
        fileChunksData = [];
    }

    // ==========================================
    // AUTO-JOIN FROM URL PARAMS
    // ==========================================
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const modeParam = urlParams.get('mode');

    if (roomParam && modeParam) {
        setupAppMode(modeParam);
        joinRoom(roomParam);
    }

});
