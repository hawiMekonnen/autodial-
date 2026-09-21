<?php
/**
 * SkyKin Automatic Dialer - SQLite Database & Telephony Bridge
 */

class DialerDB {
    private static $instance = null;
    private $pdo;

    private function __construct() {
        $db_dir = __DIR__ . '/../data';
        if (!is_dir($db_dir)) {
            @mkdir($db_dir, 0777, true);
        }
        $db_file = $db_dir . '/dialer.db';
        
        $this->pdo = new PDO("sqlite:" . $db_file);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        
        $this->initSchema();
    }

    public static function getInstance(): self {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    public function getPdo(): PDO {
        return $this->pdo;
    }

    private function initSchema() {
        $queries = [
            // Users table (SkyKin agents)
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                extension TEXT NOT NULL,
                role TEXT DEFAULT 'agent',
                domain TEXT DEFAULT 'client1.skykin.local',
                sip_extension TEXT DEFAULT '101',
                sip_password TEXT DEFAULT '1234',
                sip_server TEXT DEFAULT 'webcc.skyconnectsolutions.et',
                sip_port TEXT DEFAULT '443',
                sip_domain TEXT DEFAULT 'client1.skykin.local',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Campaigns table
            "CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                status TEXT DEFAULT 'idle',
                caller_id_name TEXT DEFAULT 'SkyKin Support',
                caller_id_number TEXT DEFAULT '+251911002233',
                ivr_audio_name TEXT DEFAULT 'Human Welcome Recording (WAV)',
                ivr_audio_file TEXT DEFAULT 'assets/audio/welcome_human_voice.wav',
                fusionpbx_ivr_path TEXT DEFAULT '/var/lib/freeswitch/recordings/welcome_human_voice.wav',
                pacing_delay_sec INTEGER DEFAULT 2,
                max_concurrent INTEGER DEFAULT 2,
                total_leads INTEGER DEFAULT 0,
                completed_leads INTEGER DEFAULT 0,
                created_by TEXT DEFAULT 'Agent1',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Leads table with scheduled Call Time
            "CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                customer_name TEXT DEFAULT 'Customer',
                phone_number TEXT NOT NULL,
                call_time TEXT DEFAULT 'Immediate',
                notes TEXT DEFAULT '',
                status TEXT DEFAULT 'pending',
                duration_sec INTEGER DEFAULT 0,
                dtmf_response TEXT DEFAULT '',
                retry_count INTEGER DEFAULT 0,
                last_attempt_at DATETIME,
                error_message TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
            )",

            // Call Logs table
            "CREATE TABLE IF NOT EXISTS call_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER,
                campaign_id INTEGER,
                customer_name TEXT,
                phone_number TEXT,
                call_time TEXT,
                agent_extension TEXT,
                status TEXT,
                duration_sec INTEGER DEFAULT 0,
                audio_played TEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Audio Files table (Human Recordings / FusionPBX IVRs)
            "CREATE TABLE IF NOT EXISTS audio_recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                fusionpbx_path TEXT NOT NULL,
                duration_sec INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
        ];

        foreach ($queries as $q) {
            $this->pdo->exec($q);
        }

        // Add call_time column if older table exists
        try {
            $this->pdo->exec("ALTER TABLE leads ADD COLUMN call_time TEXT DEFAULT 'Immediate'");
        } catch (Exception $e) {}
        try {
            $this->pdo->exec("ALTER TABLE call_logs ADD COLUMN call_time TEXT DEFAULT 'Immediate'");
        } catch (Exception $e) {}
        try {
            $this->pdo->exec("ALTER TABLE call_logs ADD COLUMN audio_played TEXT DEFAULT ''");
        } catch (Exception $e) {}
        try {
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN ivr_audio_name TEXT DEFAULT 'Human Welcome Recording (WAV)'");
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN ivr_audio_file TEXT DEFAULT 'assets/audio/welcome_human_voice.wav'");
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN fusionpbx_ivr_path TEXT DEFAULT '/var/lib/freeswitch/recordings/welcome_human_voice.wav'");
        } catch (Exception $e) {}

        // Add SIP settings columns if upgrading existing DB
        foreach ([
            'sip_extension'  => "'101'",
            'sip_password'   => "'1234'",
            'sip_extension2' => "'102'",
            'sip_password2'  => "'1234'",
            'line2_enabled'  => "1",
            'sip_server'     => "'webcc.skyconnectsolutions.et'",
            'sip_port'       => "'443'",
            'sip_domain'     => "'client1.skykin.local'"
        ] as $col => $def) {
            try {
                $this->pdo->exec("ALTER TABLE users ADD COLUMN {$col} TEXT DEFAULT {$def}");
            } catch (Exception $e) {}
        }

        // Seed default SkyKin agents with new secure password
        $defaultPasswordHash = password_hash('123Newadissagentone', PASSWORD_DEFAULT);
        $seedUsers = [
            ['Agent1', $defaultPasswordHash, 'Agent 1', '101', 'agent', 'client1.skykin.local', '101', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['Agent2', $defaultPasswordHash, 'Agent 2', '102', 'agent', 'client1.skykin.local', '102', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['agent', $defaultPasswordHash, 'SkyKin Agent', '101', 'agent', 'client1.skykin.local', '101', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['101', $defaultPasswordHash, 'Agent 101', '101', 'agent', 'client1.skykin.local', '101', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['1001', $defaultPasswordHash, 'Agent 1001', '1001', 'agent', 'client1.skykin.local', '1001', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['1002', $defaultPasswordHash, 'Agent 1002', '1002', 'agent', 'client1.skykin.local', '1002', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['admin', $defaultPasswordHash, 'Administrator', '101', 'admin', 'client1.skykin.local', '101', '1234', 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local']
        ];

        $insUser = $this->pdo->prepare("INSERT OR IGNORE INTO users (username, password_hash, full_name, extension, role, domain, sip_extension, sip_password, sip_server, sip_port, sip_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($seedUsers as $u) {
            $insUser->execute($u);
        }

        // Migrate existing accounts to the new password
        try {
            $this->pdo->exec("UPDATE users SET password_hash = " . $this->pdo->quote($defaultPasswordHash));
        } catch (Exception $e) {}

        // Seed audio recordings list
        $stmtAud = $this->pdo->query("SELECT COUNT(*) as count FROM audio_recordings");
        if ((int)$stmtAud->fetchColumn() === 0) {
            $audioItems = [
                ['Human Customer Greeting (WAV)', 'welcome_human_voice.wav', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/welcome_human_voice.wav', 5],
                ['FusionPBX IVR Menu 8000', 'ivr_menu_8000.wav', 'assets/audio/welcome_human_voice.wav', 'ivr(8000)', 10],
                ['Delivery Confirmation Notice', 'order_dispatch_notice.wav', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/order_dispatch_notice.wav', 8]
            ];
            $insAud = $this->pdo->prepare("INSERT INTO audio_recordings (name, filename, filepath, fusionpbx_path, duration_sec) VALUES (?, ?, ?, ?, ?)");
            foreach ($audioItems as $a) {
                $insAud->execute($a);
            }
        }

        // Seed default Campaign if none exists
        $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM campaigns");
        if ((int)$stmt->fetchColumn() === 0) {
            $this->pdo->exec("INSERT INTO campaigns (name, status, caller_id_name, caller_id_number, ivr_audio_name, ivr_audio_file, fusionpbx_ivr_path, pacing_delay_sec, max_concurrent) 
                VALUES ('Outbound Customer Calls', 'idle', 'SkyKin Support', '+251911002233', 'Human Customer Greeting (WAV)', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/welcome_human_voice.wav', 2, 2)");
            
            $campaignId = $this->pdo->lastInsertId();

            $leads = [
                [$campaignId, 'Helen Tesfaye', '+251911456789', '10:30 AM', 'VIP Customer', 'pending'],
                [$campaignId, 'Dawit Haile', '+251922334455', '11:00 AM', 'Delivery follow-up', 'pending'],
                [$campaignId, 'Bethlehem Mengistu', '+251933778899', '11:30 AM', 'Account renewal', 'pending'],
                [$campaignId, 'Yonas Kebede', '+251944112233', '12:00 PM', 'Feedback inquiry', 'pending'],
                [$campaignId, 'Aster Bekele', '+251955667788', '12:30 PM', 'Callback request', 'pending']
            ];
            $insLead = $this->pdo->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, ?)");
            foreach ($leads as $l) {
                $insLead->execute($l);
            }
            $this->pdo->exec("UPDATE campaigns SET total_leads = 5 WHERE id = {$campaignId}");
        }
    }
}
