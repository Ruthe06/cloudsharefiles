-- =========================================================================
-- Supabase Setup Script for Real-Time Chunk-Based File Sharing System
-- =========================================================================

-- 1. Create the Storage Bucket for File Chunks (Required)
--    If you prefer doing this in the UI, go to Storage -> Create New Bucket -> Name it "file-chunks" -> Make it "Public"
--    Or run this sql:
INSERT INTO storage.buckets (id, name, public) 
VALUES ('file-chunks', 'file-chunks', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Setup Bucket Policies
--    Allow anyone to read from the bucket
CREATE POLICY "Public Access" ON storage.objects
  FOR SELECT USING (bucket_id = 'file-chunks');
  
--    Allow authenticated and anonymous uploads to the bucket
CREATE POLICY "Public Uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'file-chunks');

--    Allow anyone to update/overwrite chunks
CREATE POLICY "Public Updates" ON storage.objects
  FOR UPDATE USING (bucket_id = 'file-chunks');

--    Allow anyone to delete chunks (optional but recommended for cleanup)
CREATE POLICY "Public Deletes" ON storage.objects
  FOR DELETE USING (bucket_id = 'file-chunks');


-- =========================================================================
-- Optional: Database Tables for Future Enhancements
-- Right now, your app mainly relies on Storage and Socket.io.
-- But if you want to track file metadata, sessions, or logs, create these tables:
-- =========================================================================

-- Table: file_sessions
-- To track active sharing links and metadata
CREATE TABLE IF NOT EXISTS public.file_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_code VARCHAR(10) UNIQUE NOT NULL, -- The 6-character code (e.g., A1B2C3)
    file_name TEXT NOT NULL,
    file_type TEXT,
    total_size BIGINT,
    total_chunks INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    status VARCHAR(20) DEFAULT 'uploading' -- uploading, completed, expired
);

-- Policy to allow anonymous read/write (since you are not using auth yet)
ALTER TABLE public.file_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous select on file_sessions" 
ON public.file_sessions FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert on file_sessions" 
ON public.file_sessions FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update on file_sessions" 
ON public.file_sessions FOR UPDATE USING (true);


-- Table: transfer_logs (Optional)
-- Tracks when chunks are successfully uploaded/downloaded
CREATE TABLE IF NOT EXISTS public.transfer_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.file_sessions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    action VARCHAR(20) NOT NULL, -- 'upload' or 'download'
    event_time TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.transfer_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous insert on transfer_logs" 
ON public.transfer_logs FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous select on transfer_logs" 
ON public.transfer_logs FOR SELECT USING (true);
