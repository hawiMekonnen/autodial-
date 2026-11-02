-- ====================================================================
-- SkyKin Automatic Dialer Enterprise Schema (PostgreSQL 16)
-- High-Throughput Outbound Engine (1,000+ calls in 2 hours / 1,000+ CPM)
-- ====================================================================

-- 1. Users & Agent Accounts
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    extension VARCHAR(20) NOT NULL,
    role VARCHAR(50) DEFAULT 'agent',
    domain VARCHAR(150) DEFAULT 'client1.skykin.local',
    sip_extension VARCHAR(20) DEFAULT '101',
    sip_password VARCHAR(100) DEFAULT '1234',
    sip_extension2 VARCHAR(20) DEFAULT '102',
    sip_password2 VARCHAR(100) DEFAULT '1234',
    line2_enabled SMALLINT DEFAULT 1,
    sip_server VARCHAR(150) DEFAULT 'webcc.skyconnectsolutions.et',
    sip_port VARCHAR(10) DEFAULT '443',
    sip_domain VARCHAR(150) DEFAULT 'client1.skykin.local',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) DEFAULT 'predictive',
    status VARCHAR(50) DEFAULT 'idle',
    caller_id_name VARCHAR(100) DEFAULT 'SkyKin Support',
    caller_id_number VARCHAR(50) DEFAULT '+251911002233',
    ivr_language VARCHAR(50) DEFAULT 'amharic',
    ivr_message_text TEXT DEFAULT '',
    ivr_audio_name VARCHAR(200) DEFAULT 'Human Welcome Recording (WAV)',
    ivr_audio_file VARCHAR(255) DEFAULT 'assets/audio/welcome_human_voice.wav',
    fusionpbx_ivr_path VARCHAR(255) DEFAULT '/var/lib/freeswitch/recordings/welcome_human_voice.wav',
    pacing_delay_sec INT DEFAULT 2,
    max_concurrent INT DEFAULT 2,
    max_retries INT DEFAULT 2,
    retry_delay_min INT DEFAULT 15,
    retry_date_mode VARCHAR(50) DEFAULT 'same_day',
    retry_custom_date VARCHAR(50) DEFAULT '',
    total_leads INT DEFAULT 0,
    completed_leads INT DEFAULT 0,
    calling_method VARCHAR(50) DEFAULT 'auto_schedule',
    schedule_strategy VARCHAR(50) DEFAULT 'interval',
    schedule_interval_mins INT DEFAULT 2,
    schedule_window_start VARCHAR(20) DEFAULT '09:00',
    schedule_window_end VARCHAR(20) DEFAULT '17:00',
    schedule_batch_size INT DEFAULT 5,
    schedule_start_time VARCHAR(50) DEFAULT 'now',
    created_by VARCHAR(100) DEFAULT 'Agent1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Inbound API Lead Injection Audit Logs
CREATE TABLE IF NOT EXISTS api_lead_logs (
    id SERIAL PRIMARY KEY,
    batch_id VARCHAR(100) NOT NULL,
    ip_address VARCHAR(50),
    total_received INT DEFAULT 0,
    imported_count INT DEFAULT 0,
    duplicates_count INT DEFAULT 0,
    invalid_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'success',
    payload_sample TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Customer Leads Queue (Optimized for FOR UPDATE SKIP LOCKED)
CREATE TABLE IF NOT EXISTS leads (
    id BIGSERIAL PRIMARY KEY,
    campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_name VARCHAR(200) DEFAULT 'Customer',
    phone_number VARCHAR(50) NOT NULL,
    call_time VARCHAR(100) DEFAULT 'Immediate',
    notes TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'pending',
    duration_sec INT DEFAULT 0,
    dtmf_response VARCHAR(20) DEFAULT '',
    retry_count INT DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Call Detail Records (CDR) / Call Logs
CREATE TABLE IF NOT EXISTS call_logs (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT,
    campaign_id INT,
    customer_name VARCHAR(200),
    phone_number VARCHAR(50),
    call_time VARCHAR(100) DEFAULT 'Immediate',
    agent_extension VARCHAR(50),
    status VARCHAR(50),
    duration_sec INT DEFAULT 0,
    audio_played VARCHAR(255) DEFAULT '',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Audio Prompts & Recordings Catalog
CREATE TABLE IF NOT EXISTS audio_recordings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(255) NOT NULL,
    fusionpbx_path VARCHAR(255) DEFAULT '',
    duration_sec INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ====================================================================
-- High-Concurrency Performance Indexes (1,000+ Calls Queue Optimization)
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_leads_camp_status ON leads (campaign_id, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_call_time ON leads (call_time);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON call_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_campaign ON call_logs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_batch ON api_lead_logs (batch_id);

-- ====================================================================
-- Seed Initial Data
-- ====================================================================
INSERT INTO users (username, password_hash, full_name, extension, role, domain, sip_extension, sip_password, sip_extension2, sip_password2, line2_enabled, sip_server, sip_port, sip_domain)
VALUES 
('Agent1', '$2y$10$o4T9P5h6kRskgBvjWb.s4eYpGZlHnQvEwS0D4v0Gz1vOqEaX0rGvW', 'Agent 1', '101', 'agent', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'),
('Agent2', '$2y$10$o4T9P5h6kRskgBvjWb.s4eYpGZlHnQvEwS0D4v0Gz1vOqEaX0rGvW', 'Agent 2', '102', 'agent', 'client1.skykin.local', '102', '1234', '101', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'),
('admin', '$2y$10$o4T9P5h6kRskgBvjWb.s4eYpGZlHnQvEwS0D4v0Gz1vOqEaX0rGvW', 'Administrator', '101', 'admin', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'),
('101', '$2y$10$o4T9P5h6kRskgBvjWb.s4eYpGZlHnQvEwS0D4v0Gz1vOqEaX0rGvW', 'Agent 101', '101', 'agent', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local')
ON CONFLICT (username) DO NOTHING;

INSERT INTO campaigns (id, name, type, status, caller_id_name, caller_id_number, ivr_audio_name, ivr_audio_file, total_leads, completed_leads)
VALUES 
(1, 'SkyKin Automated Outbound Campaign', 'predictive', 'idle', 'SkyKin Support', '+251911002233', 'Human Welcome Recording (WAV)', 'assets/audio/welcome_human_voice.wav', 0, 0)
ON CONFLICT (id) DO NOTHING;

INSERT INTO audio_recordings (name, filename, filepath, fusionpbx_path, duration_sec)
VALUES 
('Human Welcome Recording (WAV)', 'welcome_human_voice.wav', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/welcome_human_voice.wav', 12),
('Opening Long Audio (WAV)', '1788952093_opening_long.wav', 'assets/audio/1788952093_opening_long.wav', '/var/lib/freeswitch/recordings/1788952093_opening_long.wav', 24)
ON CONFLICT DO NOTHING;
