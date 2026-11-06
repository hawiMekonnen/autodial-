<?php
/**
 * SkyKin Automatic Outbound Dialer
 * Enterprise Dual-Driver Database Engine (PostgreSQL 16 Primary + SQLite WAL Fallback)
 * Designed for High-Throughput (1,000+ Outbound Calls in 2 Hours)
 */

if (!defined('APP_TIMEZONE')) {
    date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'Africa/Addis_Ababa');
}

class DialerDB {
    private static $instance = null;
    private $pdo;
    private $driver = 'sqlite';

    private function __construct() {
        $env = $this->loadEnv(dirname(__DIR__) . '/.env');
        $driverConfig = strtolower($env['DB_DRIVER'] ?? getenv('DB_DRIVER') ?: 'pgsql');

        // 1. Attempt PostgreSQL Connection if configured and driver available
        if ($driverConfig === 'pgsql' && extension_loaded('pdo_pgsql')) {
            $host = $env['DB_HOST'] ?? getenv('DB_HOST') ?: '127.0.0.1';
            $port = $env['DB_PORT'] ?? getenv('DB_PORT') ?: '5432';
            $dbname = $env['DB_NAME'] ?? getenv('DB_NAME') ?: 'skykin_dialer';
            $user = $env['DB_USER'] ?? getenv('DB_USER') ?: 'postgres';
            $pass = $env['DB_PASSWORD'] ?? getenv('DB_PASSWORD') ?: 'skykindialer123';

            try {
                $dsn = "pgsql:host={$host};port={$port};dbname={$dbname}";
                $this->pdo = new PDO($dsn, $user, $pass, [
                    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES => false,
                    PDO::ATTR_PERSISTENT => true
                ]);
                $this->driver = 'pgsql';
                $this->initPostgresSchema();
                return;
            } catch (Exception $e) {
                error_log("[SkyKin Dialer] PostgreSQL connection failed (" . $e->getMessage() . ") - Falling back to SQLite WAL engine.");
            }
        }

        // 2. High-Concurrency SQLite Engine (WAL Mode Fallback)
        $this->driver = 'sqlite';
        $db_dir = __DIR__;
        if (!is_dir($db_dir)) {
            @mkdir($db_dir, 0777, true);
        }
        $db_file = $db_dir . '/dialer.db';

        $this->pdo = new PDO("sqlite:" . $db_file);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

        // High-concurrency enterprise SQLite optimization pragmas
        try {
            $this->pdo->exec("PRAGMA journal_mode = WAL;");
            $this->pdo->exec("PRAGMA synchronous = NORMAL;");
            $this->pdo->exec("PRAGMA busy_timeout = 5000;");
        } catch (Exception $e) {}

        $this->initSqliteSchema();
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

    public function getDriver(): string {
        return $this->driver;
    }

    public function isPostgres(): bool {
        return $this->driver === 'pgsql';
    }

    private function loadEnv(string $path): array {
        $env = [];
        if (!file_exists($path)) return $env;
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#') || str_starts_with($line, ';')) continue;
            if (strpos($line, '=') !== false) {
                list($key, $val) = explode('=', $line, 2);
                $key = trim($key);
                $val = trim(trim($val), "\"'\t ");
                $env[$key] = $val;
            }
        }
        return $env;
    }

    private function initPostgresSchema() {
        try {
            // Check if users table exists; if not, execute data/schema_postgres.sql
            $check = $this->pdo->query("SELECT to_regclass('public.users')")->fetchColumn();
            if (empty($check)) {
                $schemaFile = __DIR__ . '/schema_postgres.sql';
                if (file_exists($schemaFile)) {
                    $sql = file_get_contents($schemaFile);
                    $this->pdo->exec($sql);
                }
            }
        } catch (Exception $e) {
            error_log("[SkyKin Dialer] Postgres init schema error: " . $e->getMessage());
        }
    }

    private function initSqliteSchema() {
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
                sip_extension2 TEXT DEFAULT '102',
                sip_password2 TEXT DEFAULT '1234',
                line2_enabled INTEGER DEFAULT 1,
                sip_server TEXT DEFAULT 'webcc.skyconnectsolutions.et',
                sip_port TEXT DEFAULT '443',
                sip_domain TEXT DEFAULT 'client1.skykin.local',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Campaigns table
            "CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'predictive',
                status TEXT DEFAULT 'idle',
                caller_id_name TEXT DEFAULT 'SkyKin Support',
                caller_id_number TEXT DEFAULT '+251911002233',
                ivr_language TEXT DEFAULT 'amharic',
                ivr_message_text TEXT DEFAULT '',
                ivr_audio_name TEXT DEFAULT 'Human Welcome Recording (WAV)',
                ivr_audio_file TEXT DEFAULT 'assets/audio/welcome_human_voice.wav',
                fusionpbx_ivr_path TEXT DEFAULT '/var/lib/freeswitch/recordings/welcome_human_voice.wav',
                pacing_delay_sec INTEGER DEFAULT 2,
                max_concurrent INTEGER DEFAULT 2,
                max_retries INTEGER DEFAULT 2,
                retry_delay_min INTEGER DEFAULT 15,
                retry_date_mode TEXT DEFAULT 'same_day',
                retry_custom_date TEXT DEFAULT '',
                total_leads INTEGER DEFAULT 0,
                completed_leads INTEGER DEFAULT 0,
                calling_method TEXT DEFAULT 'auto_schedule',
                schedule_strategy TEXT DEFAULT 'interval',
                schedule_interval_mins INTEGER DEFAULT 2,
                schedule_window_start TEXT DEFAULT '09:00',
                schedule_window_end TEXT DEFAULT '17:00',
                schedule_batch_size INTEGER DEFAULT 5,
                schedule_start_time TEXT DEFAULT 'now',
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
                call_time TEXT DEFAULT 'Immediate',
                agent_extension TEXT,
                status TEXT,
                duration_sec INTEGER DEFAULT 0,
                audio_played TEXT DEFAULT '',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Audio Files table (Human Recordings / FusionPBX IVRs)
            "CREATE TABLE IF NOT EXISTS audio_recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                fusionpbx_path TEXT DEFAULT '',
                duration_sec INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Inbound API Lead Injection Audit Logs
            "CREATE TABLE IF NOT EXISTS api_lead_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT,
                ip_address TEXT,
                total_received INTEGER DEFAULT 0,
                imported_count INTEGER DEFAULT 0,
                duplicates_count INTEGER DEFAULT 0,
                invalid_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'success',
                payload_sample TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Scheduled Callbacks table
            "CREATE TABLE IF NOT EXISTS scheduled_callbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER,
                campaign_id INTEGER,
                customer_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                scheduled_time DATETIME NOT NULL,
                assigned_agent TEXT DEFAULT 'Agent1',
                status TEXT DEFAULT 'pending',
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // DNC (Do Not Call) Compliance table
            "CREATE TABLE IF NOT EXISTS dnc_numbers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                reason TEXT DEFAULT 'Customer opt-out',
                added_by TEXT DEFAULT 'Agent1',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )"
        ];

        foreach ($queries as $q) {
            $this->pdo->exec($q);
        }

        // Performance Indexes for Fast High-Volume Concurrent Dialing
        try {
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_leads_camp_status ON leads (campaign_id, status)");
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads (phone_number)");
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_leads_call_time ON leads (call_time)");
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_logs_campaign ON call_logs (campaign_id)");
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON call_logs (timestamp)");
            $this->pdo->exec("CREATE INDEX IF NOT EXISTS idx_api_logs_batch ON api_lead_logs (batch_id)");
        } catch (Exception $e) {}

        // Add call_time column if older table exists
        try {
            $this->pdo->exec("ALTER TABLE leads ADD COLUMN call_time TEXT DEFAULT 'Immediate'");
        } catch (Exception $e) {}
        try {
            $this->pdo->exec("ALTER TABLE leads ADD COLUMN currency TEXT DEFAULT 'ETB'");
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

        // Add Retry and Schedule policy columns to campaigns
        foreach ([
            'type'                  => "'predictive'",
            'ivr_language'          => "'amharic'",
            'ivr_message_text'      => "''",
            'calling_method'        => "'auto_schedule'",
            'schedule_strategy'     => "'interval'",
            'schedule_interval_mins'=> "2",
            'schedule_window_start' => "'09:00'",
            'schedule_window_end'   => "'17:00'",
            'schedule_batch_size'   => "5",
            'schedule_start_time'   => "'now'",
            'max_retries'           => "2",
            'retry_delay_min'       => "15",
            'retry_date_mode'       => "'same_day'",
            'retry_custom_date'     => "''"
        ] as $col => $def) {
            try {
                $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN {$col} " . (is_numeric($def) ? "INTEGER" : "TEXT") . " DEFAULT {$def}");
            } catch (Exception $e) {}
        }

        // Add SIP settings columns if upgrading existing DB
        foreach ([
            'sip_extension'  => "'101'",
            'sip_password'   => "'1234'",
            'sip_extension2' => "'102'",
            'sip_password2'  => "'1234'",
            'line2_enabled'  => "1",
            'sip_server'     => "'webcc.skyconnectsolutions.et'",
            'sip_port'       => "'443'",
            'sip_domain'     => "'client1.skykin.local'",
            'agent_status'   => "'ready'",
            'last_heartbeat' => "CURRENT_TIMESTAMP"
        ] as $col => $def) {
            try {
                $this->pdo->exec("ALTER TABLE users ADD COLUMN {$col} TEXT DEFAULT {$def}");
            } catch (Exception $e) {}
        }

        // Seed default SkyKin agents with secure password
        $defaultPasswordHash = password_hash('123Newadissagentone', PASSWORD_DEFAULT);
        $seedUsers = [
            ['Agent1', $defaultPasswordHash, 'Agent 1', '101', 'agent', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['Agent2', $defaultPasswordHash, 'Agent 2', '102', 'agent', 'client1.skykin.local', '102', '1234', '101', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['agent', $defaultPasswordHash, 'SkyKin Agent', '101', 'agent', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['101', $defaultPasswordHash, 'Agent 101', '101', 'agent', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local'],
            ['admin', $defaultPasswordHash, 'Administrator', '101', 'admin', 'client1.skykin.local', '101', '1234', '102', '1234', 1, 'webcc.skyconnectsolutions.et', '443', 'client1.skykin.local']
        ];

        $insUser = $this->pdo->prepare("INSERT OR IGNORE INTO users (username, password_hash, full_name, extension, role, domain, sip_extension, sip_password, sip_extension2, sip_password2, line2_enabled, sip_server, sip_port, sip_domain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        foreach ($seedUsers as $u) {
            $insUser->execute($u);
        }

        // Seed audio recordings list
        $stmtAud = $this->pdo->query("SELECT COUNT(*) as count FROM audio_recordings");
        if ((int)$stmtAud->fetchColumn() === 0) {
            $audioItems = [
                ['Human Welcome Recording (WAV)', 'welcome_human_voice.wav', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/welcome_human_voice.wav', 12],
                ['Opening Long Audio (WAV)', '1788952093_opening_long.wav', 'assets/audio/1788952093_opening_long.wav', '/var/lib/freeswitch/recordings/1788952093_opening_long.wav', 24]
            ];
            $insAud = $this->pdo->prepare("INSERT INTO audio_recordings (name, filename, filepath, fusionpbx_path, duration_sec) VALUES (?, ?, ?, ?, ?)");
            foreach ($audioItems as $a) {
                $insAud->execute($a);
            }
        }

        // Seed default Campaign if none exists (starts clean with 0 leads)
        $stmt = $this->pdo->query("SELECT COUNT(*) as count FROM campaigns");
        if ((int)$stmt->fetchColumn() === 0) {
            $this->pdo->exec("INSERT INTO campaigns (name, status, caller_id_name, caller_id_number, ivr_audio_name, ivr_audio_file, fusionpbx_ivr_path, pacing_delay_sec, max_concurrent, total_leads, completed_leads) 
                VALUES ('SkyKin Automated Outbound Campaign', 'idle', 'SkyKin Support', '+251911002233', 'Human Welcome Recording (WAV)', 'assets/audio/welcome_human_voice.wav', '/var/lib/freeswitch/recordings/welcome_human_voice.wav', 2, 2, 0, 0)");
        }
    }
}
