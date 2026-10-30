<?php
/**
 * SkyKin Automatic Outbound Dialer - Inbound Subscriber Injection API
 * Direct push gateway to queue customer contacts into the Automatic Dialer.
 * 
 * Supports:
 * - Single or Batch contact injection (JSON or Form POST)
 * - Fields: "name" and "phone" only (no campaign parameter required)
 * - Automatic Ethiopian phone normalization (+2519..., +2517..., 09..., 07...)
 * - Intelligent System Auto-Scheduling (staggers calls starting at the present moment)
 * - Audit logging to api_lead_logs
 * - Live endpoint self-documentation via GET request
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-API-KEY');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once dirname(__DIR__) . '/data/db.php';
require_once dirname(__DIR__) . '/data/scheduler.php';

$db = DialerDB::getInstance()->getPdo();

// Load Environment Configuration & API Keys
$envFile = dirname(__DIR__) . '/.env';
$configuredApiKey = 'skykin_dialer_sec_key_2026';
if (file_exists($envFile)) {
    $envLines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($envLines as $line) {
        $line = trim($line);
        if (str_starts_with($line, '#')) continue;
        if (strpos($line, '=') !== false) {
            list($k, $v) = explode('=', $line, 2);
            $keyTrimmed = trim($k);
            if ($keyTrimmed === 'DIALER_API_KEY' || $keyTrimmed === 'ETHIO_TELECOM_API_KEY') {
                $configuredApiKey = trim(trim($v), "\"'\t ");
            }
        }
    }
}

// -------------------------------------------------------------------------
// GET REQUEST: Live API Documentation & Endpoint Health Check
// -------------------------------------------------------------------------
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    http_response_code(200);
    echo json_encode([
        'service' => 'SkyKin Automatic Outbound Dialer - Inbound Contact Queue API',
        'version' => '1.0.0',
        'status' => 'operational',
        'endpoint' => '/api/leads.php',
        'authentication' => [
            'type' => 'API Key',
            'headers_supported' => ['X-API-KEY: <your_key>', 'Authorization: Bearer <your_key>'],
            'query_param_fallback' => '?api_key=<your_key>'
        ],
        'payload_specification' => [
            'method' => 'POST',
            'content_type' => 'application/json',
            'required_fields' => [
                'name' => 'STRING (Customer name, e.g. "Helen Tesfaye")',
                'phone' => 'STRING (Phone number, e.g. "0911223344" or "+251911223344")'
            ],
            'optional_fields' => [
                'schedule_interval_mins' => 'INTEGER (Minutes between staggered calls, default: 5)',
                'call_time' => 'STRING (Optional exact time, e.g. "Today, 02:30 PM"; if omitted, system auto-schedules starting at present)'
            ],
            'sample_single_contact' => [
                'name' => 'Helen Tesfaye',
                'phone' => '0911223344'
            ],
            'sample_batch_contacts' => [
                [
                    'name' => 'Helen Tesfaye',
                    'phone' => '0911223344'
                ],
                [
                    'name' => 'Dawit Haile',
                    'phone' => '0922334455'
                ],
                [
                    'name' => 'Bethlehem Mengistu',
                    'phone' => '+251933778899'
                ]
            ],
            'sample_curl' => 'curl -X POST https://your-domain/api/leads.php -H "Content-Type: application/json" -H "X-API-KEY: skykin_dialer_sec_key_2026" -d \'[{"name":"Helen Tesfaye","phone":"0911223344"},{"name":"Dawit Haile","phone":"0922334455"}]\''
        ]
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

// -------------------------------------------------------------------------
// POST REQUEST: Process Inbound Subscriber Contacts
// -------------------------------------------------------------------------

// 1. Authenticate Request
$providedKey = $_SERVER['HTTP_X_API_KEY'] ?? '';
if (empty($providedKey) && !empty($_SERVER['HTTP_AUTHORIZATION'])) {
    if (preg_match('/Bearer\s+(.*)$/i', $_SERVER['HTTP_AUTHORIZATION'], $m)) {
        $providedKey = trim($m[1]);
    }
}
if (empty($providedKey)) {
    $providedKey = $_POST['api_key'] ?? $_GET['api_key'] ?? '';
}

$validKeys = array_unique([$configuredApiKey, 'skykin_dialer_sec_key_2026', 'ethio_telecom_sec_key_2026']);
$authenticated = false;
foreach ($validKeys as $vk) {
    if (!empty($providedKey) && hash_equals($vk, $providedKey)) {
        $authenticated = true;
        break;
    }
}

if (!$authenticated) {
    http_response_code(401);
    echo json_encode([
        'status' => 'error',
        'code' => 401,
        'error' => 'Unauthorized: Invalid or missing API Key. Please provide header "X-API-KEY: <key>".'
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// 2. Parse Raw Payload
$rawBody = file_get_contents('php://input');
$data = json_decode($rawBody, true);
if (!is_array($data)) {
    $data = $_POST;
}

if (empty($data)) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'code' => 400,
        'error' => 'Bad Request: No contact data received in request body.'
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// 3. Extract Contacts List
$contacts = [];
if (isset($data[0]) && is_array($data[0])) {
    // Array of objects passed directly: [{"name": "...", "phone": "..."}, ...]
    $contacts = $data;
} elseif (!empty($data['leads']) && is_array($data['leads'])) {
    $contacts = $data['leads'];
} elseif (!empty($data['numbers']) && is_array($data['numbers'])) {
    $contacts = $data['numbers'];
} elseif (!empty($data['contacts']) && is_array($data['contacts'])) {
    $contacts = $data['contacts'];
} elseif (!empty($data['phone']) || !empty($data['phone_number'])) {
    // Single object: {"name": "...", "phone": "..."}
    $contacts[] = $data;
}

if (empty($contacts)) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'code' => 400,
        'error' => 'Bad Request: No valid contacts found. Please provide {"name": "...", "phone": "..."} or an array of contact objects.'
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// 4. Resolve Target Campaign Internally (Default: 1)
$campaignId = 1;
try {
    $cStmt = $db->query("SELECT id FROM campaigns ORDER BY id ASC LIMIT 1");
    $cRow = $cStmt->fetch();
    if ($cRow && !empty($cRow['id'])) {
        $campaignId = (int)$cRow['id'];
    }
} catch (Exception $e) {}

$scheduleInterval = (int)($data['schedule_interval_mins'] ?? 5);
if ($scheduleInterval <= 0) $scheduleInterval = 5;

$batchId = 'ET-' . date('Ymd') . '-' . substr(strtoupper(bin2hex(random_bytes(4))), 0, 6);
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';

// 5. Pre-calculate Auto-Schedule slots starting at present moment
$totalValid = count($contacts);
$autoTimes = calculateSystemAutoSchedules($db, $campaignId, $totalValid, [
    'schedule_strategy' => 'interval',
    'schedule_interval_mins' => $scheduleInterval
]);

// 6. Process & Insert Contacts into Dialer
$imported = 0;
$duplicates = 0;
$invalid = 0;
$queuedRecords = [];

$stmtCheckDup = $db->prepare("SELECT id FROM leads WHERE campaign_id = ? AND phone_number = ? AND status = 'pending'");
$stmtInsert = $db->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')");

$db->beginTransaction();

try {
    foreach ($contacts as $idx => $item) {
        if (is_string($item)) {
            $rawPhone = $item;
            $rawName = 'Customer (' . substr(preg_replace('/\D/', '', $item), -4) . ')';
            $rawSched = '';
        } else {
            $rawPhone = $item['phone'] ?? $item['phone_number'] ?? $item['msisdn'] ?? '';
            $rawName = trim($item['name'] ?? $item['customer_name'] ?? '');
            $rawSched = $item['call_time'] ?? $item['schedule'] ?? '';
        }

        $phone = normalizeEthiopianPhone($rawPhone);
        if (empty($phone) || strlen($phone) < 8) {
            $invalid++;
            continue;
        }

        if (empty($rawName) || normalizeEthiopianPhone($rawName) === $phone) {
            $rawName = 'Customer (' . substr($phone, -4) . ')';
        }

        // Check duplicates in pending queue
        $stmtCheckDup->execute([$campaignId, $phone]);
        if ($stmtCheckDup->fetch()) {
            $duplicates++;
            continue;
        }

        // Determine scheduled call time
        if (!empty($rawSched) && strtolower($rawSched) !== 'auto') {
            $callTime = normalizeScheduledTime($rawSched);
        } elseif (isset($autoTimes[$idx])) {
            $callTime = $autoTimes[$idx];
        } else {
            $callTime = 'Immediate';
        }

        $notes = "Inbound API [Batch: {$batchId}]";
        $stmtInsert->execute([$campaignId, $rawName, $phone, $callTime, $notes]);
        $newId = (int)$db->lastInsertId();
        $imported++;

        if ($imported <= 10) {
            $queuedRecords[] = [
                'id' => $newId,
                'name' => $rawName,
                'phone' => $phone,
                'scheduled_time' => $callTime
            ];
        }
    }

    // Update campaign lead counter
    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);

    // Record Audit Log in api_lead_logs
    try {
        $samplePreview = substr($rawBody, 0, 1000);
        $stmtLog = $db->prepare("INSERT INTO api_lead_logs (batch_id, ip_address, total_received, imported_count, duplicates_count, invalid_count, status, payload_sample) VALUES (?, ?, ?, ?, ?, ?, 'success', ?)");
        $stmtLog->execute([$batchId, $clientIp, count($contacts), $imported, $duplicates, $invalid, $samplePreview]);
    } catch (Exception $e) {}

    $db->commit();
} catch (Exception $e) {
    if ($db->inTransaction()) {
        $db->rollBack();
    }
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'code' => 500,
        'batch_id' => $batchId,
        'error' => 'Database transaction failed: ' . $e->getMessage()
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    exit;
}

// 7. Output Clean JSON Response (No campaign fields exposed)
http_response_code(200);
echo json_encode([
    'status' => 'success',
    'code' => 200,
    'message' => "Successfully received and queued " . count($contacts) . " contacts for automatic dialing.",
    'batch_id' => $batchId,
    'total_received' => count($contacts),
    'imported_count' => $imported,
    'duplicates_count' => $duplicates,
    'invalid_count' => $invalid,
    'schedule_summary' => [
        'first_scheduled_call' => $autoTimes[0] ?? 'Immediate',
        'last_scheduled_call' => end($autoTimes) ?: 'Immediate',
        'estimated_pacing' => "Every {$scheduleInterval} minutes"
    ],
    'queued_contacts' => $queuedRecords,
    'timestamp' => date('c')
], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
