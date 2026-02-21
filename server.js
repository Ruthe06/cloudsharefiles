const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
    }
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const bucketName = process.env.SUPABASE_BUCKET || 'file-chunks';
let supabase = null;

if (supabaseUrl && supabaseKey) {
    supabase = createClient(supabaseUrl, supabaseKey);
} else {
    console.warn("⚠️ Supabase credentials not found in env! You must provide them for cloud storage to work.");
}

app.use(cors());
app.use(express.static('public'));

// Endpoint to receive chunk from sender
app.post('/api/upload-chunk', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    const fileId = req.query.fileId;
    const chunkIndex = req.query.chunkIndex;
    const totalChunks = req.query.totalChunks;
    const fileName = req.query.fileName;
    const fileType = req.query.fileType;

    if (!fileId || !chunkIndex) {
        return res.status(400).json({ error: 'Missing required query parameters' });
    }

    if (!supabase) {
        return res.status(500).json({ error: "Supabase not configured in backend!" });
    }

    try {
        const chunkData = req.body; // Buffer from express.raw
        const path = `${fileId}/chunk_${chunkIndex}`;

        // Upload chunk to Supabase Storage
        const { data, error } = await supabase.storage
            .from(bucketName)
            .upload(path, chunkData, { upsert: true, contentType: 'application/octet-stream' });

        if (error) {
            console.error("Supabase Error:", error);
            throw error;
        }

        // Generate Signed URL for secure temporary download (5 minutes expiry)
        const { data: signedData, error: signError } = await supabase.storage
            .from(bucketName)
            .createSignedUrl(path, 300); // 300 seconds = 5 minutes

        if (signError) {
            console.error("Supabase Sign Error:", signError);
            throw signError;
        }

        const chunkUrl = signedData.signedUrl;

        // Auto-delete logic: If this is the last chunk, start the 5-minute deletion timer
        const currentChunk = parseInt(chunkIndex);
        const total = parseInt(totalChunks);

        if (currentChunk === total - 1) {
            console.log(`⏱️ Final chunk uploaded for session ${fileId}. Starting 5-minute auto-delete timer...`);
            setTimeout(async () => {
                const pathsToDelete = [];
                for (let i = 0; i < total; i++) {
                    pathsToDelete.push(`${fileId}/chunk_${i}`);
                }
                const { error: delError } = await supabase.storage.from(bucketName).remove(pathsToDelete);
                if (delError) {
                    console.error(`Failed to auto-delete chunks for ${fileId}:`, delError);
                } else {
                    console.log(`🗑️ Successfully auto-deleted all chunks for session ${fileId}.`);
                }
            }, 5 * 60 * 1000); // 5 minutes delay
        }

        // Emit socket event to the receiver logic
        io.to(fileId).emit('chunk_received', {
            chunkIndex: parseInt(chunkIndex),
            totalChunks: parseInt(totalChunks),
            chunkUrl,
            fileName,
            fileType,
            senderId: req.query.senderId
        });

        res.json({ success: true, url: chunkUrl });
    } catch (err) {
        console.error('Error uploading chunk:', err);
        res.status(500).json({ error: err.message });
    }
});

io.on('connection', (socket) => {
    console.log('🔗 Client connected:', socket.id);

    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        socket.roomId = roomId;
        console.log(`📡 Socket ${socket.id} joined room ${roomId}`);

        // Notify others in the room that a user joined
        socket.to(roomId).emit('user_joined', socket.id);
    });

    // WebRTC Signaling
    socket.on('offer', (data) => {
        socket.to(data.roomId).emit('offer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('answer', (data) => {
        socket.to(data.roomId).emit('answer', { sdp: data.sdp, senderId: socket.id });
    });

    socket.on('ice_candidate', (data) => {
        socket.to(data.roomId).emit('ice_candidate', { candidate: data.candidate, senderId: socket.id });
    });

    // File Sharing Chunk Notification
    // The server HTTP endpoint already emits 'chunk_received' to the roomId (fileId)

    // Ephemeral Chat Events
    socket.on('chat_message', (data) => {
        // Forward message to room only. NO DATABASE STORAGE.
        socket.to(data.roomId).emit('chat_message', data.message);
    });

    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('typing');
    });

    socket.on('disconnect', () => {
        console.log('🔴 Client disconnected:', socket.id);
        if (socket.roomId) {
            socket.to(socket.roomId).emit('user_left', socket.id);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
