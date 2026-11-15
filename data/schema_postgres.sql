-- ====================================================================
-- SkyConnect Automatic Outbound Voice Dialer Enterprise Schema (PostgreSQL)
-- Generic Outbound Engine with Zero Mock Data
-- ====================================================================

-- 1. Users Table (Roles: admin, viewer)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(150) NOT NULL,
    extension VARCHAR(20) DEFAULT '100',
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. System Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Configurable Languages Table
CREATE TABLE IF NOT EXISTS languages (
    id SERIAL PRIMARY KEY,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    is_default SMALLINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Customer Caller IDs Table
CREATE TABLE IF NOT EXISTS caller_ids (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(50) UNIQUE NOT NULL,
    is_default SMALLINT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Campaigns Table
CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    type VARCHAR(50) DEFAULT 'automated_ivr',
    status VARCHAR(50) DEFAULT 'idle',
    caller_id_name VARCHAR(100) DEFAULT '',
    caller_id_number VARCHAR(50) DEFAULT '',
    ivr_language VARCHAR(50) DEFAULT 'en',
    ivr_message_text TEXT DEFAULT '',
    ivr_audio_name VARCHAR(200) DEFAULT '',
    ivr_audio_file VARCHAR(255) DEFAULT '',
    fusionpbx_ivr_path VARCHAR(255) DEFAULT '',
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
    smart_schedule_plan TEXT DEFAULT '',
    sms_enabled SMALLINT DEFAULT 0,
    sms_trigger VARCHAR(50) DEFAULT 'call_completed',
    sms_template TEXT DEFAULT '',
    sms_sender_id VARCHAR(50) DEFAULT 'SkyConnect',
    created_by VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. Inbound API Lead Injection Logs & Client Authentication
CREATE TABLE IF NOT EXISTS api_clients (
    id SERIAL PRIMARY KEY,
    client_name VARCHAR(150) NOT NULL,
    api_key VARCHAR(100) UNIQUE NOT NULL,
    is_active SMALLINT DEFAULT 1,
    rate_limit_per_min INT DEFAULT 60,
    max_batch_size INT DEFAULT 500,
    allowed_campaign_id INT DEFAULT NULL,
    allowed_ips TEXT DEFAULT '',
    total_requests BIGINT DEFAULT 0,
    total_leads_injected BIGINT DEFAULT 0,
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_rate_limits (
    key_hash VARCHAR(64) NOT NULL,
    window_time BIGINT NOT NULL,
    request_count INT DEFAULT 1,
    PRIMARY KEY (key_hash, window_time)
);

CREATE TABLE IF NOT EXISTS api_lead_logs (
    id SERIAL PRIMARY KEY,
    batch_id VARCHAR(100) NOT NULL,
    client_id INT DEFAULT NULL,
    ip_address VARCHAR(50),
    total_received INT DEFAULT 0,
    imported_count INT DEFAULT 0,
    duplicates_count INT DEFAULT 0,
    dnc_count INT DEFAULT 0,
    invalid_count INT DEFAULT 0,
    status VARCHAR(50) DEFAULT 'success',
    payload_sample TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 7. Customer Contacts / Leads Queue
CREATE TABLE IF NOT EXISTS leads (
    id BIGSERIAL PRIMARY KEY,
    campaign_id INT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    customer_name VARCHAR(200) DEFAULT 'Contact',
    phone_number VARCHAR(50) NOT NULL,
    call_time VARCHAR(100) DEFAULT 'Immediate',
    custom_data JSONB DEFAULT '{}'::jsonb,
    notes TEXT DEFAULT '',
    status VARCHAR(50) DEFAULT 'pending',
    duration_sec INT DEFAULT 0,
    dtmf_response VARCHAR(20) DEFAULT '',
    retry_count INT DEFAULT 0,
    last_attempt_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. Call Detail Records (CDR) / Call Logs
CREATE TABLE IF NOT EXISTS call_logs (
    id BIGSERIAL PRIMARY KEY,
    lead_id BIGINT,
    campaign_id INT,
    customer_name VARCHAR(200),
    phone_number VARCHAR(50),
    call_time VARCHAR(100) DEFAULT 'Immediate',
    status VARCHAR(50),
    duration_sec INT DEFAULT 0,
    dtmf_response VARCHAR(20) DEFAULT '',
    audio_played VARCHAR(255) DEFAULT '',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Audio Prompts & Recordings Catalog
CREATE TABLE IF NOT EXISTS audio_recordings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    filename VARCHAR(255) NOT NULL,
    filepath VARCHAR(255) NOT NULL,
    fusionpbx_path VARCHAR(255) DEFAULT '',
    language_code VARCHAR(20) DEFAULT 'en',
    duration_sec INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 10. Scheduled Unanswered Callbacks
CREATE TABLE IF NOT EXISTS scheduled_callbacks (
    id SERIAL PRIMARY KEY,
    lead_id BIGINT,
    campaign_id INT,
    customer_name VARCHAR(200) NOT NULL,
    phone_number VARCHAR(50) NOT NULL,
    scheduled_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    notes TEXT DEFAULT '',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 11. DNC (Do Not Call) Compliance Table
CREATE TABLE IF NOT EXISTS dnc_numbers (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(50) UNIQUE NOT NULL,
    reason TEXT DEFAULT 'Contact opt-out',
    added_by VARCHAR(100) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 12. SMS Notifications & Message Dispatch Logs
CREATE TABLE IF NOT EXISTS sms_messages (
    id SERIAL PRIMARY KEY,
    campaign_id INT REFERENCES campaigns(id) ON DELETE SET NULL,
    lead_id INT REFERENCES leads(id) ON DELETE SET NULL,
    phone_number VARCHAR(50) NOT NULL,
    customer_name VARCHAR(150) DEFAULT '',
    message TEXT NOT NULL,
    sender_id VARCHAR(50) DEFAULT 'SkyConnect',
    trigger_event VARCHAR(50) DEFAULT 'call_completed',
    status VARCHAR(50) DEFAULT 'simulated',
    provider VARCHAR(50) DEFAULT 'generic_api',
    provider_response TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    sent_by VARCHAR(100) DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE
);

-- ====================================================================
-- Performance Indexes
-- ====================================================================
CREATE INDEX IF NOT EXISTS idx_leads_camp_status ON leads (campaign_id, status, id ASC);
CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone_number);
CREATE INDEX IF NOT EXISTS idx_leads_call_time ON leads (call_time);
CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON call_logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_campaign ON call_logs (campaign_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_batch ON api_lead_logs (batch_id);
CREATE INDEX IF NOT EXISTS idx_sms_campaign ON sms_messages (campaign_id);
CREATE INDEX IF NOT EXISTS idx_sms_phone ON sms_messages (phone_number);

-- ====================================================================
-- Initial Clean Reference Data Only
-- ====================================================================
INSERT INTO users (username, password_hash, full_name, extension, role)
VALUES ('admin', '$2y$10$tZzT9d2C7eG3b3BkWQ8v3.s1e8fF9aXyZ0kL9m8n7j6h5g4f3e2d1', 'Administrator', '100', 'admin')
ON CONFLICT (username) DO NOTHING;

INSERT INTO languages (code, name, is_default)
VALUES 
('en', 'English', 1),
('am', 'Amharic', 0),
('om', 'Afaan Oromoo', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO settings (key, value)
VALUES 
('company_name', 'SkyConnect'),
('timezone', 'Africa/Addis_Ababa'),
('currency', 'USD'),
('default_country_code', '+251'),
('available_lines', '2'),
('default_window_start', '09:00'),
('default_window_end', '17:00'),
('max_retries', '2'),
('retry_delay_min', '15'),
('sms_enabled', '1'),
('sms_provider', 'generic_api'),
('sms_api_url', ''),
('sms_api_key', ''),
('sms_sender_id', 'SkyConnect'),
('sms_mock_mode', '1')
ON CONFLICT (key) DO NOTHING;
