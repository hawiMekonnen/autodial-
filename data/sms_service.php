<?php
/**
 * SkyKin Automatic Outbound Dialer - SMS Notification & Messaging Service
 * 
 * Supports:
 * - Campaign-level SMS follow-ups (Automated IVR outcomes, completed calls, missed calls)
 * - Agent-driven manual SMS dispatch from the Dialer console
 * - Dynamic message templating ({name}, {phone}, {campaign}, {outcome}, {key})
 * - Dual-mode architecture:
 *     1. Simulator/Mock Mode (active when API key is pending or test mode enabled)
 *     2. Live Gateway Mode (dispatches via HTTP REST to configured SMS provider)
 * - Full audit logging and delivery tracking in sms_messages table
 */

require_once __DIR__ . '/db.php';

class SmsService {
    private static ?SmsService $instance = null;
    private PDO $db;
    private array $config = [];

    private function __construct() {
        $this->db = DialerDB::getInstance()->getPdo();
        $this->loadConfiguration();
    }

    public static function getInstance(): SmsService {
        if (self::$instance === null) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    /**
     * Load SMS settings from database and environment
     */
    public function loadConfiguration(): array {
        $dbSettings = [];
        try {
            $rows = $this->db->query("SELECT key, value FROM settings WHERE key LIKE 'sms_%'")->fetchAll(PDO::FETCH_KEY_PAIR);
            if (is_array($rows)) {
                $dbSettings = $rows;
            }
        } catch (Exception $e) {
            error_log("[SmsService] Error loading DB settings: " . $e->getMessage());
        }

        // Environment overrides
        $envFile = dirname(__DIR__) . '/.env';
        $env = [];
        if (file_exists($envFile)) {
            $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                $line = trim($line);
                if (str_starts_with($line, '#') || str_starts_with($line, ';')) continue;
                if (strpos($line, '=') !== false) {
                    list($k, $v) = explode('=', $line, 2);
                    $env[trim($k)] = trim(trim($v), "\"'\t ");
                }
            }
        }

        $apiKey = !empty($env['AFROMESSAGE_TOKEN'])
            ? $env['AFROMESSAGE_TOKEN']
            : (!empty($env['SMS_TOKEN'])
                ? $env['SMS_TOKEN']
                : (!empty($env['SMS_API_KEY'])
                    ? $env['SMS_API_KEY']
                    : (!empty($dbSettings['sms_api_key']) ? $dbSettings['sms_api_key'] : '')));

        $apiUrl = !empty($env['SMS_API_URL'])
            ? $env['SMS_API_URL']
            : (!empty($dbSettings['sms_api_url'])
                ? $dbSettings['sms_api_url']
                : 'https://api.afromessage.com/api/send');

        $senderId = !empty($env['AFROMESSAGE_SENDER_NAME'])
            ? $env['AFROMESSAGE_SENDER_NAME']
            : (!empty($env['SMS_SENDER_ID'])
                ? $env['SMS_SENDER_ID']
                : (!empty($dbSettings['sms_sender_id']) ? $dbSettings['sms_sender_id'] : 'SkyConnect'));

        $shortCodeId = !empty($env['AFROMESSAGE_IDENTIFIER_ID'])
            ? $env['AFROMESSAGE_IDENTIFIER_ID']
            : (!empty($dbSettings['sms_identifier_id']) ? $dbSettings['sms_identifier_id'] : '');

        $provider = !empty($env['SMS_PROVIDER'])
            ? $env['SMS_PROVIDER']
            : (!empty($dbSettings['sms_provider']) ? $dbSettings['sms_provider'] : 'afromessage');

        $hasKey = !empty($apiKey);
        if (isset($env['SMS_MOCK_MODE'])) {
            $mockMode = (int)$env['SMS_MOCK_MODE'];
        } elseif ($hasKey) {
            $mockMode = 0;
        } elseif (isset($dbSettings['sms_mock_mode'])) {
            $mockMode = (int)$dbSettings['sms_mock_mode'];
        } else {
            $mockMode = 1;
        }

        $this->config = [
            'enabled' => (int)($dbSettings['sms_enabled'] ?? 1),
            'api_key' => $apiKey,
            'token' => $apiKey,
            'api_url' => $apiUrl,
            'sender_id' => $senderId,
            'identifier_id' => $shortCodeId,
            'provider' => $provider,
            'mock_mode' => $mockMode,
            'has_api_key' => $hasKey
        ];

        return $this->config;
    }

    public function getConfig(): array {
        return $this->config;
    }

    /**
     * Normalize phone number to standard format
     */
    public function normalizePhone(string $phone): string {
        $cleaned = preg_replace('/[^\d+]/', '', trim($phone));
        if (str_starts_with($cleaned, '09') && strlen($cleaned) === 10) {
            $cleaned = '+251' . substr($cleaned, 1);
        } elseif (str_starts_with($cleaned, '07') && strlen($cleaned) === 10) {
            $cleaned = '+251' . substr($cleaned, 1);
        } elseif (str_starts_with($cleaned, '9') && strlen($cleaned) === 9) {
            $cleaned = '+251' . $cleaned;
        } elseif (str_starts_with($cleaned, '7') && strlen($cleaned) === 9) {
            $cleaned = '+251' . $cleaned;
        } elseif (str_starts_with($cleaned, '251') && strlen($cleaned) === 12) {
            $cleaned = '+' . $cleaned;
        } elseif (str_starts_with($cleaned, '00')) {
            $cleaned = '+' . substr($cleaned, 2);
        }
        return $cleaned;
    }

    /**
     * Substitute template placeholders with actual values
     */
    public function renderTemplate(string $template, array $data): string {
        $customerName = trim($data['customer_name'] ?? $data['name'] ?? 'Valued Customer');
        if (empty($customerName)) $customerName = 'Valued Customer';
        $phoneNumber = $data['phone_number'] ?? $data['phone'] ?? '';
        $campaignName = $data['campaign_name'] ?? $data['campaign'] ?? 'SkyConnect';
        $outcome = $data['outcome'] ?? $data['status'] ?? 'Completed';
        $keyPressed = $data['key_pressed'] ?? $data['key'] ?? $data['dtmf_response'] ?? '';
        $date = date('Y-m-d');
        $time = date('h:i A');

        $replacements = [
            '{customer_name}' => $customerName,
            '{name}' => $customerName,
            '{phone_number}' => $phoneNumber,
            '{phone}' => $phoneNumber,
            '{campaign_name}' => $campaignName,
            '{campaign}' => $campaignName,
            '{outcome}' => $outcome,
            '{key_pressed}' => $keyPressed,
            '{key}' => $keyPressed,
            '{date}' => $date,
            '{time}' => $time
        ];

        return str_replace(array_keys($replacements), array_values($replacements), $template);
    }

    /**
     * Send or queue SMS message
     */
    public function send(string $phoneNumber, string $message, array $options = []): array {
        $normalizedPhone = $this->normalizePhone($phoneNumber);
        if (strlen(preg_replace('/\D/', '', $normalizedPhone)) < 9) {
            return [
                'success' => false,
                'error' => 'Invalid phone number format. Minimum 9 digits required.',
                'phone' => $phoneNumber
            ];
        }

        $message = trim($message);
        if (empty($message)) {
            return [
                'success' => false,
                'error' => 'SMS message text cannot be empty.',
                'phone' => $normalizedPhone
            ];
        }

        $campaignId = !empty($options['campaign_id']) ? (int)$options['campaign_id'] : null;
        if ($campaignId !== null && $campaignId > 0) {
            $checkCamp = $this->db->prepare("SELECT id FROM campaigns WHERE id = ?");
            $checkCamp->execute([$campaignId]);
            if (!$checkCamp->fetchColumn()) {
                $campaignId = null;
            }
        }

        $leadId = !empty($options['lead_id']) ? (int)$options['lead_id'] : null;
        if ($leadId !== null && $leadId > 0) {
            $checkLead = $this->db->prepare("SELECT id FROM leads WHERE id = ?");
            $checkLead->execute([$leadId]);
            if (!$checkLead->fetchColumn()) {
                $leadId = null;
            }
        }
        $customerName = trim($options['customer_name'] ?? '');
        $senderId = !empty($options['sender_id']) ? trim($options['sender_id']) : $this->config['sender_id'];
        $triggerEvent = !empty($options['trigger_event']) ? trim($options['trigger_event']) : 'manual';
        $sentBy = !empty($options['sent_by']) ? trim($options['sent_by']) : ($_SESSION['username'] ?? 'system');

        $isMock = ($this->config['mock_mode'] == 1 || empty($this->config['api_key']));
        $status = $isMock ? 'simulated' : 'queued';
        $provider = $this->config['provider'];
        $providerResponse = '';
        $errorMessage = '';
        $sentAt = null;

        if ($isMock) {
            $providerResponse = json_encode([
                'status' => 'simulated_success',
                'mode' => 'simulator',
                'note' => 'SMS verified and logged in simulator mode. Ready for live API key.',
                'timestamp' => date('c'),
                'recipient' => $normalizedPhone,
                'characters' => mb_strlen($message)
            ]);
            $sentAt = date('Y-m-d H:i:s');
        } else {
            // Live Gateway Dispatch
            $dispatchResult = $this->dispatchLiveGateway($normalizedPhone, $message, $senderId);
            if ($dispatchResult['success']) {
                $status = 'sent';
                $providerResponse = json_encode($dispatchResult['response'] ?? []);
                $sentAt = date('Y-m-d H:i:s');
            } else {
                $status = 'failed';
                $errorMessage = $dispatchResult['error'] ?? 'Gateway request failed';
                $providerResponse = json_encode($dispatchResult['response'] ?? []);
            }
        }

        // Insert into sms_messages table
        try {
            $stmt = $this->db->prepare("
                INSERT INTO sms_messages (
                    campaign_id, lead_id, phone_number, customer_name, message,
                    sender_id, trigger_event, status, provider, provider_response,
                    error_message, sent_by, created_at, sent_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ");
            $stmt->execute([
                $campaignId,
                $leadId,
                $normalizedPhone,
                $customerName,
                $message,
                $senderId,
                $triggerEvent,
                $status,
                $provider,
                $providerResponse,
                $errorMessage,
                $sentBy,
                $sentAt
            ]);
            $msgId = (int)$this->db->lastInsertId();
        } catch (Exception $e) {
            error_log("[SmsService] Database insert error: " . $e->getMessage());
            $msgId = 0;
        }

        return [
            'success' => ($status === 'sent'),
            'status' => $status,
            'message_id' => $msgId,
            'phone' => $normalizedPhone,
            'customer_name' => $customerName,
            'sender_id' => $senderId,
            'message_preview' => mb_substr($message, 0, 80) . (mb_strlen($message) > 80 ? '...' : ''),
            'character_count' => mb_strlen($message),
            'mode' => $isMock ? 'simulated' : 'live',
            'error' => $errorMessage,
            'note' => $isMock ? 'SMS captured in simulator mode. Configure SMS API key to enable live delivery.' : ($status === 'sent' ? 'SMS sent via live AfroMessage gateway.' : ('SMS delivery failed: ' . $errorMessage))
        ];
    }

    /**
     * Dispatch live HTTP request to SMS gateway
     */
    private function dispatchLiveGateway(string $phone, string $message, string $senderId): array {
        $apiUrl = $this->config['api_url'];
        $apiKey = $this->config['api_key'];
        $provider = strtolower($this->config['provider'] ?? 'afromessage');

        if (empty($apiUrl)) {
            return [
                'success' => false,
                'error' => 'SMS Gateway API URL is not configured.',
                'response' => []
            ];
        }

        if (empty($apiKey)) {
            return [
                'success' => false,
                'error' => 'SMS API token is missing. Please add your AfroMessage token in the .env file.',
                'response' => []
            ];
        }

        $isAfro = ($provider === 'afromessage' || strpos($apiUrl, 'afromessage.com') !== false);

        if ($isAfro) {
            // AfroMessage Ethiopia specification
            $payload = [
                'to' => $phone,
                'message' => $message
            ];
            // Only add sender if explicitly customized and approved (avoid unapproved SkyConnect causing error)
            $customSender = trim($this->config['sender_id'] ?? $senderId);
            if (!empty($customSender) && strtolower($customSender) !== 'skyconnect' && strtolower($customSender) !== 'default') {
                $payload['sender'] = $customSender;
            }
            if (!empty($this->config['identifier_id'])) {
                $payload['from'] = $this->config['identifier_id'];
            }

            $headers = [
                'Content-Type: application/json; charset=utf-8',
                'Accept: application/json',
                'Authorization: Bearer ' . $apiKey
            ];
        } else {
            // Generic JSON gateway
            $payload = [
                'to' => $phone,
                'from' => $senderId,
                'message' => $message,
                'api_key' => $apiKey
            ];

            $headers = [
                'Content-Type: application/json; charset=utf-8',
                'Accept: application/json',
                'Authorization: Bearer ' . $apiKey,
                'X-API-KEY: ' . $apiKey
            ];
        }

        $ch = curl_init($apiUrl);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_TIMEOUT, 15);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 6);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 0);

        $result = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        @curl_close($ch);

        if ($curlErr) {
            return [
                'success' => false,
                'error' => 'cURL Error: ' . $curlErr,
                'response' => []
            ];
        }

        $parsed = json_decode($result, true) ?: ['raw' => $result];
        $isOk = ($httpCode >= 200 && $httpCode < 300);

        if ($isAfro) {
            $ack = strtolower((string)($parsed['acknowledge'] ?? ''));
            if ($ack === 'success') {
                $isOk = true;
            } elseif ($ack === 'error') {
                $isOk = false;
            }
        }

        $errorMessage = '';
        if (!$isOk) {
            if (!empty($parsed['response']['errors']) && is_array($parsed['response']['errors'])) {
                $errorMessage = implode('; ', $parsed['response']['errors']);
            } elseif (!empty($parsed['message'])) {
                $errorMessage = (string)$parsed['message'];
            } elseif (!empty($parsed['error'])) {
                $errorMessage = (string)$parsed['error'];
            } else {
                $errorMessage = 'HTTP ' . $httpCode . ' response from SMS provider';
            }
        }

        return [
            'success' => $isOk,
            'http_code' => $httpCode,
            'error' => $errorMessage,
            'response' => $parsed
        ];
    }

    /**
     * Trigger campaign SMS automatically based on call outcome or IVR key
     */
    public function triggerCampaignSms(int $leadId, string $triggerEvent, array $context = []): ?array {
        if ($leadId <= 0) return null;

        try {
            $lead = $this->db->query("SELECT * FROM leads WHERE id = {$leadId}")->fetch(PDO::FETCH_ASSOC);
            if (!$lead || empty($lead['campaign_id'])) return null;

            $campaign = $this->db->query("SELECT * FROM campaigns WHERE id = {$lead['campaign_id']}")->fetch(PDO::FETCH_ASSOC);
            if (!$campaign) return null;

            // Check if SMS is enabled on the campaign
            $smsEnabled = (int)($campaign['sms_enabled'] ?? 0);
            if ($smsEnabled !== 1) return null;

            $campaignTrigger = $campaign['sms_trigger'] ?? 'call_completed';
            $template = trim($campaign['sms_template'] ?? '');
            if (empty($template)) {
                $template = "Hello {customer_name}, thank you for taking our call regarding {campaign_name}. We have recorded your response.";
            }

            // Verify if the event matches campaign trigger settings
            $shouldSend = false;
            if ($campaignTrigger === 'all_calls') {
                $shouldSend = true;
            } elseif ($campaignTrigger === 'call_completed') {
                $shouldSend = in_array($triggerEvent, ['call_completed', 'completed', 'ivr_completed', 'answered', 'callback']);
            } elseif ($campaignTrigger === 'ivr_choice') {
                $shouldSend = ($triggerEvent === 'ivr_choice' || !empty($context['key']) || !empty($lead['dtmf_response']));
            } elseif ($campaignTrigger === 'unanswered') {
                $shouldSend = in_array($triggerEvent, ['no_answer', 'busy', 'failed']);
            }

            if (!$shouldSend) return null;

            // Anti-flooding: prevent duplicate SMS to same lead within 30 minutes
            $chk = $this->db->prepare("
                SELECT id FROM sms_messages 
                WHERE lead_id = ? AND created_at > (CURRENT_TIMESTAMP - INTERVAL '30 minutes')
                LIMIT 1
            ");
            $chk->execute([$leadId]);
            if ($chk->fetchColumn()) {
                return null;
            }

            // Build dynamic context data
            $mergeData = array_merge($lead, [
                'campaign_name' => $campaign['name'] ?? 'Campaign',
                'key_pressed' => $context['key'] ?? $lead['dtmf_response'] ?? '',
                'outcome' => $context['outcome'] ?? $lead['error_message'] ?? 'Confirmed'
            ]);

            $renderedMessage = $this->renderTemplate($template, $mergeData);

            return $this->send($lead['phone_number'], $renderedMessage, [
                'campaign_id' => (int)$campaign['id'],
                'lead_id' => $leadId,
                'customer_name' => $lead['customer_name'] ?? 'Contact',
                'sender_id' => $campaign['sms_sender_id'] ?: $this->config['sender_id'],
                'trigger_event' => $triggerEvent,
                'sent_by' => 'system (ivr_trigger)'
            ]);
        } catch (Exception $e) {
            error_log("[SmsService] triggerCampaignSms exception: " . $e->getMessage());
            return null;
        }
    }

    /**
     * Retrieve SMS log history
     */
    public function getLogs(int $campaignId = 0, int $limit = 50): array {
        try {
            $where = "";
            $params = [];
            if ($campaignId > 0) {
                $where = "WHERE s.campaign_id = ?";
                $params[] = $campaignId;
            }
            $sql = "
                SELECT s.*, c.name as campaign_name
                FROM sms_messages s
                LEFT JOIN campaigns c ON s.campaign_id = c.id
                {$where}
                ORDER BY s.id DESC
                LIMIT {$limit}
            ";
            $stmt = $this->db->prepare($sql);
            $stmt->execute($params);
            return $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (Exception $e) {
            error_log("[SmsService] getLogs error: " . $e->getMessage());
            return [];
        }
    }

    /**
     * Update system-wide SMS settings
     */
    public function saveSettings(array $settings): bool {
        $allowed = ['sms_enabled', 'sms_provider', 'sms_api_url', 'sms_api_key', 'sms_sender_id', 'sms_mock_mode'];
        try {
            $isSqlite = (DialerDB::getInstance()->getDriver() === 'sqlite');
            $sql = $isSqlite 
                ? "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
                : "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP";

            $stmt = $this->db->prepare($sql);
            foreach ($allowed as $k) {
                if (isset($settings[$k])) {
                    $stmt->execute([$k, trim((string)$settings[$k])]);
                }
            }
            $this->loadConfiguration();
            return true;
        } catch (Exception $e) {
            error_log("[SmsService] saveSettings error: " . $e->getMessage());
            return false;
        }
    }
}
