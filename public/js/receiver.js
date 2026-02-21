document.addEventListener('DOMContentLoaded', () => {
    const fileIdInput = document.getElementById('fileIdInput');
    const connectBtn = document.getElementById('connectBtn');

    const fileInfoContainer = document.getElementById('fileInfoContainer');
    const receiverFileName = document.getElementById('receiverFileName');

    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const percentDisplay = document.getElementById('percentDisplay');
    const chunksDisplay = document.getElementById('chunksDisplay');
    const statusText = document.getElementById('statusText');

    const downloadActionContainer = document.getElementById('downloadActionContainer');
    const downloadBtn = document.getElementById('downloadBtn');

    const socket = io();

    let currentSessionId = null;
    let expectedChunks = 0;
    let receivedChunksCount = 0;
    let fileChunksData = [];
    let finalFileName = 'download';
    let finalFileType = 'application/octet-stream';

    // Auto-fill from URL param
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('id')) {
        fileIdInput.value = urlParams.get('id');
    }

    connectBtn.addEventListener('click', () => {
        let val = fileIdInput.value.trim();
        if (!val) {
            alert('Please enter a valid File ID or Link');
            return;
        }

        let fileId = val;
        // If user pastes full link, extract ID
        try {
            if (val.includes('id=')) {
                const parsedUrl = new URL(val);
                fileId = parsedUrl.searchParams.get('id') || val;
            } else if (val.includes('http')) {
                const parsedUrl = new URL(val);
                fileId = parsedUrl.pathname.split('/').pop();
            }
        } catch (e) { /* Ignore invalid URL error, use val directly */ }

        if (currentSessionId) {
            // Need to emit something if we want to handle leaving, though typical usage covers disconnecting
        }

        currentSessionId = fileId.toUpperCase();
        socket.emit('join_room', currentSessionId); // Changed to join_room so server assigns socket to the room

        connectBtn.innerHTML = 'Connecting...';
        connectBtn.disabled = true;

        statusText.innerText = "Listening for incoming chunks...";
        progressContainer.classList.add('visible');
    });

    let pendingDownloads = new Set();
    const CONCURRENT_DOWNLOADS = 5;
    let downloadQueue = [];
    let isDownloading = false;

    socket.on('chunk_received', (data) => {
        connectBtn.innerHTML = 'Connected';
        fileInfoContainer.style.display = 'block';

        const { chunkIndex, totalChunks, chunkUrl, fileName, fileType } = data;

        expectedChunks = totalChunks;
        finalFileName = fileName || 'download';
        finalFileType = fileType || 'application/octet-stream';

        receiverFileName.innerText = `Receiving: ${finalFileName}`;

        downloadQueue.push({ chunkIndex, chunkUrl });
        processDownloadQueue();
    });

    async function processDownloadQueue() {
        if (isDownloading) return;
        isDownloading = true;

        while (downloadQueue.length > 0) {
            // Fill available slots
            while (pendingDownloads.size < CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
                const chunkData = downloadQueue.shift();
                const downloadPromise = downloadChunk(chunkData).finally(() => {
                    pendingDownloads.delete(downloadPromise);
                });
                pendingDownloads.add(downloadPromise);
            }

            // Wait for at least one to finish before looping back to fill slots
            if (pendingDownloads.size > 0) {
                await Promise.race(pendingDownloads);
            }
        }

        isDownloading = false;
    }

    async function downloadChunk({ chunkIndex, chunkUrl }) {
        try {
            statusText.innerText = `Downloading chunks in parallel...`;

            const response = await fetch(chunkUrl);
            const arrayBuffer = await response.arrayBuffer();

            // Store directly in index (to maintain order in case of parallel downloads/events)
            fileChunksData[chunkIndex] = arrayBuffer;
            receivedChunksCount++;

            // Update UI
            const percent = Math.round((receivedChunksCount / expectedChunks) * 100);
            progressFill.style.width = `${percent}%`;
            percentDisplay.innerText = `${percent}%`;
            chunksDisplay.innerText = `${receivedChunksCount}/${expectedChunks} Chunks`;

            if (receivedChunksCount === expectedChunks) {
                mergeAndDownload();
            }

        } catch (err) {
            console.error("Error receiving chunk:", err);
            statusText.innerText = "Download Error. See console.";
            statusText.style.color = "var(--error)";
        }
    }

    function mergeAndDownload() {
        statusText.innerText = "Merging Chunks...";

        // Ensure array is contiguous and contains valid buffers
        if (fileChunksData.length !== expectedChunks || fileChunksData.includes(undefined)) {
            statusText.innerText = "Error: Missing chunks during merge.";
            statusText.style.color = "var(--error)";
            return;
        }

        const blob = new Blob(fileChunksData, { type: finalFileType });
        const url = URL.createObjectURL(blob);

        // Auto download trigger
        const a = document.createElement('a');
        a.href = url;
        a.download = finalFileName;
        document.body.appendChild(a);
        a.click();

        statusText.innerText = "Download Complete!";
        statusText.style.color = "var(--success)";
        progressFill.style.background = "var(--success)";

        // Show manual download button in case auto-download gets blocked
        downloadActionContainer.style.display = 'block';

        // Manual download listener
        downloadBtn.onclick = () => {
            const manualTrigger = document.createElement('a');
            manualTrigger.href = url;
            manualTrigger.download = finalFileName;
            document.body.appendChild(manualTrigger);
            manualTrigger.click();
            document.body.removeChild(manualTrigger);
        };

        // Don't revoke immediately so the manual button still works
        setTimeout(() => {
            document.body.removeChild(a);
        }, 100);
    }
});
