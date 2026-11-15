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
            } else {
                $checkClients = $this->pdo->query("SELECT to_regclass('public.api_clients')")->fetchColumn();
                if (empty($checkClients)) {
                    $this->pdo->exec("
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
                    ");
                }
            }
        } catch (Exception $e) {
            error_log("[SkyKin Dialer] Postgres init schema error: " . $e->getMessage());
        }
    }

    private function initSqliteSchema() {
        $queries = [
            // Users table (Roles: admin, viewer)
            "CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                extension TEXT DEFAULT '100',
                role TEXT DEFAULT 'admin',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Settings table
            "CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Configurable Languages table
            "CREATE TABLE IF NOT EXISTS languages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Caller IDs table
            "CREATE TABLE IF NOT EXISTS caller_ids (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone_number TEXT UNIQUE NOT NULL,
                is_default INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Campaigns table
            "CREATE TABLE IF NOT EXISTS campaigns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                type TEXT DEFAULT 'automated_ivr',
                status TEXT DEFAULT 'idle',
                caller_id_name TEXT DEFAULT '',
                caller_id_number TEXT DEFAULT '',
                ivr_language TEXT DEFAULT 'en',
                ivr_message_text TEXT DEFAULT '',
                ivr_audio_name TEXT DEFAULT '',
                ivr_audio_file TEXT DEFAULT '',
                fusionpbx_ivr_path TEXT DEFAULT '',
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
                smart_schedule_plan TEXT DEFAULT '',
                created_by TEXT DEFAULT 'admin',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Leads table with scheduled Call Time
            "CREATE TABLE IF NOT EXISTS leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                campaign_id INTEGER NOT NULL,
                customer_name TEXT DEFAULT 'Contact',
                phone_number TEXT NOT NULL,
                call_time TEXT DEFAULT 'Immediate',
                custom_data TEXT DEFAULT '{}',
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
                status TEXT,
                duration_sec INTEGER DEFAULT 0,
                dtmf_response TEXT DEFAULT '',
                audio_played TEXT DEFAULT '',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Audio Files table
            "CREATE TABLE IF NOT EXISTS audio_recordings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                filename TEXT NOT NULL,
                filepath TEXT NOT NULL,
                fusionpbx_path TEXT DEFAULT '',
                language_code TEXT DEFAULT 'en',
                duration_sec INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Inbound API Lead Injection Audit Logs & Client Authentication
            "CREATE TABLE IF NOT EXISTS api_clients (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_name TEXT NOT NULL,
                api_key TEXT UNIQUE NOT NULL,
                is_active INTEGER DEFAULT 1,
                rate_limit_per_min INTEGER DEFAULT 60,
                max_batch_size INTEGER DEFAULT 500,
                allowed_campaign_id INTEGER DEFAULT NULL,
                allowed_ips TEXT DEFAULT '',
                total_requests INTEGER DEFAULT 0,
                total_leads_injected INTEGER DEFAULT 0,
                last_used_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            "CREATE TABLE IF NOT EXISTS api_rate_limits (
                key_hash TEXT NOT NULL,
                window_time INTEGER NOT NULL,
                request_count INTEGER DEFAULT 1,
                PRIMARY KEY (key_hash, window_time)
            )",

            "CREATE TABLE IF NOT EXISTS api_lead_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT,
                client_id INTEGER,
                ip_address TEXT,
                total_received INTEGER DEFAULT 0,
                imported_count INTEGER DEFAULT 0,
                duplicates_count INTEGER DEFAULT 0,
                dnc_count INTEGER DEFAULT 0,
                invalid_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'success',
                payload_sample TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // Scheduled Unanswered Callbacks
            "CREATE TABLE IF NOT EXISTS scheduled_callbacks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lead_id INTEGER,
                campaign_id INTEGER,
                customer_name TEXT NOT NULL,
                phone_number TEXT NOT NULL,
                scheduled_time DATETIME NOT NULL,
                status TEXT DEFAULT 'pending',
                notes TEXT DEFAULT '',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )",

            // DNC Compliance table
            "CREATE TABLE IF NOT EXISTS dnc_numbers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                phone_number TEXT UNIQUE NOT NULL,
                reason TEXT DEFAULT 'Contact opt-out',
                added_by TEXT DEFAULT 'admin',
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
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN ivr_audio_name TEXT DEFAULT 'ivr2'");
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN ivr_audio_file TEXT DEFAULT 'assets/audio/1793961705_ahununu_waiting.wav'");
            $this->pdo->exec("ALTER TABLE campaigns ADD COLUMN fusionpbx_ivr_path TEXT DEFAULT '/var/lib/freeswitch/recordings/1793961705_ahununu_waiting.wav'");
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
            'max_retries'           => "3",
            'retry_delay_min'       => "120",
            'retry_date_mode'       => "'same_day'",
            'retry_custom_date'     => "''",
            'dial_ratio'            => "2.1",
            'max_abandon_rate'      => "2.4",
            'calling_hours'         => "'standard'"
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

        // Seed default administrator if users table is empty
        $stmtUsers = $this->pdo->query("SELECT COUNT(*) as count FROM users");
        if ((int)$stmtUsers->fetchColumn() === 0) {
            $defaultPasswordHash = password_hash('admin123', PASSWORD_DEFAULT);
            $insUser = $this->pdo->prepare("INSERT INTO users (username, password_hash, full_name, extension, role) VALUES (?, ?, ?, ?, ?)");
            $insUser->execute(['admin', $defaultPasswordHash, 'Administrator', '100', 'admin']);
        }

        // Seed default languages if empty
        try {
            $stmtLang = $this->pdo->query("SELECT COUNT(*) as count FROM languages");
            if ((int)$stmtLang->fetchColumn() === 0) {
                $insLang = $this->pdo->prepare("INSERT INTO languages (code, name, is_default) VALUES (?, ?, ?)");
                $insLang->execute(['en', 'English', 1]);
                $insLang->execute(['am', 'Amharic', 0]);
                $insLang->execute(['om', 'Afaan Oromoo', 0]);
            }
        } catch (Exception $e) {}

        // Seed default settings if empty
        try {
            $stmtSet = $this->pdo->query("SELECT COUNT(*) as count FROM settings");
            if ((int)$stmtSet->fetchColumn() === 0) {
                $defaults = [
                    'company_name' => 'SkyConnect',
                    'timezone' => 'Africa/Addis_Ababa',
                    'currency' => 'USD',
                    'default_country_code' => '+251',
                    'available_lines' => '2',
                    'default_window_start' => '09:00',
                    'default_window_end' => '17:00',
                    'max_retries' => '2',
                    'retry_delay_min' => '15'
                ];
                $insDef = $this->pdo->prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
                foreach ($defaults as $k => $v) {
                    $insDef->execute([$k, $v]);
                }
            }
        } catch (Exception $e) {}
    }
}
