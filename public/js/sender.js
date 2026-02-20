document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const fileInfoContainer = document.getElementById('fileInfoContainer');

    // Room logic elements
    const roomSection = document.getElementById('roomSection');
    const createRoomBtn = document.getElementById('createRoomBtn');
    const uploadSection = document.getElementById('uploadSection');
    const roomLinkBox = document.getElementById('roomLinkBox');

    const progressContainer = document.getElementById('progressContainer');
    const progressFill = document.getElementById('progressFill');
    const percentDisplay = document.getElementById('percentDisplay');
    const speedDisplay = document.getElementById('speedDisplay');
    const statusText = document.getElementById('statusText');
    const linkBox = document.getElementById('linkBox');

    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks
    let selectedFile = null;
    let fileId = null;

    // ----- Room Creation Logic ----- //
    createRoomBtn.addEventListener('click', () => {
        // Generate random file ID for the room
        fileId = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Setup sharing link
        const shareLink = `${window.location.origin}/receiver.html?id=${fileId}`;
        roomLinkBox.innerHTML = `Share this ID: <strong>${fileId}</strong><br>Or link: <a href="${shareLink}" target="_blank" style="color:var(--accent)">${shareLink}</a>`;

        // Toggle UI
        roomSection.style.display = 'none';
        uploadSection.style.display = 'block';
    });

    // ----- UI Interaction ----- //
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFileSelect(e.target.files[0]);
        }
    });

    function handleFileSelect(file) {
        selectedFile = file;

        dropZone.style.display = 'none';
        fileInfoContainer.style.display = 'block';

        const sizeMB = (file.size / (1024 * 1024)).toFixed(2);

        fileInfoContainer.innerHTML = `
            <div class="file-info">
                <div class="file-icon">
                    <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                </div>
                <div class="file-details">
                    <span class="file-name" title="${file.name}">${file.name}</span>
                    <span class="file-size">${sizeMB} MB</span>
                </div>
            </div>
        `;

        uploadBtn.disabled = false;
    }

    // ----- Upload Logic ----- //
    uploadBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        uploadBtn.disabled = true;
        uploadBtn.innerHTML = 'Uploading...';
        progressContainer.classList.add('visible');

        const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);

        statusText.innerText = "Chunking and Uploading...";

        let startTime = Date.now();
        let uploadedBytes = 0;
        let hasError = false;
        let currentIndex = 0;
        const CONCURRENT_UPLOADS = 5;

        const uploadNextChunk = async () => {
            if (hasError || currentIndex >= totalChunks) return;

            const i = currentIndex++;
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
            const chunk = selectedFile.slice(start, end);

            const url = `/api/upload-chunk?fileId=${fileId}&chunkIndex=${i}&totalChunks=${totalChunks}&fileName=${encodeURIComponent(selectedFile.name)}&fileType=${encodeURIComponent(selectedFile.type)}`;

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: chunk
                });

                if (!response.ok) {
                    const errInfo = await response.json();
                    throw new Error(errInfo.error || 'Upload failed');
                }

                // Update UI Progress
                uploadedBytes += chunk.size;
                const percent = Math.round((uploadedBytes / selectedFile.size) * 100);

                const timeElapsed = (Date.now() - startTime) / 1000;
                let speed = (uploadedBytes / 1024 / 1024) / timeElapsed; // MB/s

                progressFill.style.width = `${percent}%`;
                percentDisplay.innerText = `${percent}%`;
                speedDisplay.innerText = `${speed.toFixed(2)} MB/s`;

                // Recursively call for next chunks
                await uploadNextChunk();

            } catch (err) {
                if (!hasError) {
                    console.error("Chunk upload error:", err);
                    statusText.innerText = "Error: " + err.message;
                    statusText.style.color = "var(--error)";
                    uploadBtn.disabled = false;
                    uploadBtn.innerHTML = 'Retry Upload';
                    hasError = true;
                }
            }
        };

        const uploadPromises = [];
        for (let j = 0; j < Math.min(CONCURRENT_UPLOADS, totalChunks); j++) {
            uploadPromises.push(uploadNextChunk());
        }

        await Promise.all(uploadPromises);

        if (!hasError) {
            statusText.innerText = "Upload Complete! Wait for receiver to finish.";
            uploadBtn.innerHTML = 'Done';
        }
    });
});
