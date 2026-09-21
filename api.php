<?php
/**
 * SkyKin Automatic Dialer - Backend API
 */

header('Content-Type: application/json; charset=utf-8');
session_start();

require_once __DIR__ . '/data/db.php';
require_once __DIR__ . '/telephony/esl_client.php';

$db = DialerDB::getInstance()->getPdo();
$action = $_REQUEST['action'] ?? '';

function jsonOut($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function sanitizePhone(string $raw): string {
    $cleaned = preg_replace('/[^\d+]/', '', trim($raw));
    if (empty($cleaned)) return '';
    
    if (preg_match('/^0([97]\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    if (preg_match('/^251([97]\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    if ($cleaned[0] !== '+') {
        return '+' . $cleaned;
    }
    return $cleaned;
}

function extractLeadDate(?string $callTime, ?string $createdAt): string {
    $timeStr = trim((string)$callTime);
    // 1. ISO date: YYYY-MM-DD
    if (preg_match('/(\d{4}-\d{2}-\d{2})/', $timeStr, $m)) {
        return $m[1];
    }
    // 2. Month format: "Sep 18, 2026" or "18 Sep 2026"
    $parsed = @strtotime($timeStr);
    if ($parsed !== false && $parsed > 0 && !preg_match('/^\d{1,2}:\d{2}/', $timeStr)) {
        $year = (int)date('Y', $parsed);
        if ($year >= 2020 && $year <= 2040) {
            return date('Y-m-d', $parsed);
        }
    }
    // 3. Fallback to record creation date
    if (!empty($createdAt)) {
        $ts = @strtotime($createdAt);
        if ($ts !== false && $ts > 0) {
            return date('Y-m-d', $ts);
        }
    }
    return date('Y-m-d');
}

// 1. Get Campaign Dashboard Data
if ($action === 'get_campaign_data') {
    $campaignId = (int)($_GET['campaign_id'] ?? 1);

    $stmt = $db->prepare("SELECT * FROM campaigns WHERE id = ?");
    $stmt->execute([$campaignId]);
    $campaign = $stmt->fetch();

    if (!$campaign) {
        $db->exec("INSERT INTO campaigns (name, status) VALUES ('Outbound Customer Calls', 'idle')");
        $campaignId = (int)$db->lastInsertId();
        $stmt = $db->prepare("SELECT * FROM campaigns WHERE id = ?");
        $stmt->execute([$campaignId]);
        $campaign = $stmt->fetch();
    }

    // Get Leads
    $stmtLeads = $db->prepare("SELECT * FROM leads WHERE campaign_id = ? ORDER BY id ASC");
    $stmtLeads->execute([$campaignId]);
    $rawLeads = $stmtLeads->fetchAll();

    $today = date('Y-m-d');
    $leads = [];
    $historyDatesMap = [$today => true];
    $remainingCount = 0;

    // Daily Metrics
    $todayTotal = 0;
    $todayPending = 0;
    $todayConnected = 0;

    // Total metrics
    $total = count($rawLeads);
    $pending = 0;
    $connected = 0;
    $failed = 0;
    $totalDuration = 0;

    foreach ($rawLeads as $l) {
        $effDate = extractLeadDate($l['call_time'] ?? '', $l['created_at'] ?? '');
        $historyDatesMap[$effDate] = true;

        $isToday = ($effDate === $today);
        $isPast = ($effDate < $today);
        $isRemaining = ($isPast && in_array($l['status'], ['pending', 'no_answer', 'busy', 'failed']));
        if ($isRemaining) {
            $remainingCount++;
        }

        $l['effective_date'] = $effDate;
        $l['is_today'] = $isToday;
        $l['is_past'] = $isPast;
        $l['is_remaining'] = $isRemaining;

        $st = $l['status'];
        if ($st === 'pending') {
            $pending++;
        } elseif (in_array($st, ['answered', 'ivr_playing', 'ivr_completed', 'completed'])) {
            $connected++;
            $totalDuration += (int)($l['duration_sec'] ?? 0);
        } elseif (in_array($st, ['busy', 'no_answer', 'failed'])) {
            $failed++;
        }

        if ($isToday) {
            $todayTotal++;
            if ($st === 'pending') $todayPending++;
            elseif (in_array($st, ['answered', 'ivr_playing', 'ivr_completed', 'completed'])) $todayConnected++;
        }

        $leads[] = $l;
    }

    $dialed = $total - $pending;
    $answerRate = $dialed > 0 ? round(($connected / $dialed) * 100, 1) : 0;
    $avgDuration = $connected > 0 ? round($totalDuration / $connected, 1) : 0;

    // Get audio recordings
    $recordings = $db->query("SELECT * FROM audio_recordings ORDER BY id ASC")->fetchAll();

    // Get recent call logs
    $stmtLogs = $db->prepare("SELECT * FROM call_logs WHERE campaign_id = ? ORDER BY id DESC LIMIT 100");
    $stmtLogs->execute([$campaignId]);
    $rawLogs = $stmtLogs->fetchAll();

    $logs = [];
    foreach ($rawLogs as $lg) {
        $logDate = !empty($lg['timestamp']) ? date('Y-m-d', strtotime($lg['timestamp'])) : $today;
        $historyDatesMap[$logDate] = true;
        $lg['log_date'] = $logDate;
        $logs[] = $lg;
    }

    $availableDates = array_keys($historyDatesMap);
    rsort($availableDates);

    jsonOut([
        'success' => true,
        'server_today' => $today,
        'available_dates' => $availableDates,
        'remaining_count' => $remainingCount,
        'campaign' => $campaign,
        'leads' => $leads,
        'stats' => [
            'total' => $total,
            'pending' => $pending,
            'connected' => $connected,
            'failed' => $failed,
            'dialed' => $dialed,
            'answer_rate' => $answerRate,
            'avg_duration' => $avgDuration,
            'today_total' => $todayTotal,
            'today_pending' => $todayPending,
            'today_connected' => $todayConnected
        ],
        'audio_recordings' => $recordings,
        'recent_logs' => $logs
    ]);
}

function extractRowsFromUploadedFile(string $filePath, string $origName): array {
    $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));

    // 1. XLSX (Excel OpenXML)
    if ($ext === 'xlsx' && class_exists('ZipArchive')) {
        $zip = new ZipArchive();
        if ($zip->open($filePath) === true) {
            $sharedStrings = [];
            $ssXml = $zip->getFromName('xl/sharedStrings.xml');
            if ($ssXml) {
                $xml = @simplexml_load_string($ssXml);
                if ($xml && isset($xml->si)) {
                    foreach ($xml->si as $si) {
                        if (isset($si->t)) {
                            $sharedStrings[] = (string)$si->t;
                        } elseif (isset($si->r)) {
                            $text = '';
                            foreach ($si->r as $r) {
                                $text .= (string)$r->t;
                            }
                            $sharedStrings[] = $text;
                        } else {
                            $sharedStrings[] = '';
                        }
                    }
                }
            }

            // Read worksheet
            $sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
            if (!$sheetXml) {
                for ($i = 0; $i < $zip->numFiles; $i++) {
                    $name = $zip->getNameIndex($i);
                    if (strpos($name, 'xl/worksheets/sheet') === 0 && substr($name, -4) === '.xml') {
                        $sheetXml = $zip->getFromName($name);
                        break;
                    }
                }
            }
            $zip->close();

            if ($sheetXml) {
                $xml = @simplexml_load_string($sheetXml);
                if ($xml && isset($xml->sheetData->row)) {
                    $rows = [];
                    foreach ($xml->sheetData->row as $row) {
                        $currentRow = [];
                        foreach ($row->c as $c) {
                            $cellType = (string)$c['t'];
                            $val = (string)$c->v;
                            if ($cellType === 's') {
                                $idx = (int)$val;
                                $cellVal = $sharedStrings[$idx] ?? '';
                            } elseif ($cellType === 'inlineStr' && isset($c->is->t)) {
                                $cellVal = (string)$c->is->t;
                            } else {
                                $cellVal = $val;
                            }
                            $currentRow[] = trim($cellVal);
                        }
                        if (!empty(array_filter($currentRow))) {
                            $rows[] = $currentRow;
                        }
                    }
                    if (!empty($rows)) return $rows;
                }
            }
        }
    }

    // 2. CSV / TXT / TSV / HTML XLS
    $content = file_get_contents($filePath);
    if (stripos($content, '<table') !== false && stripos($content, '<tr') !== false) {
        // HTML table based XLS export
        $rows = [];
        if (preg_match_all('/<tr[^>]*>(.*?)<\/tr>/is', $content, $trMatches)) {
            foreach ($trMatches[1] as $tr) {
                if (preg_match_all('/<t[dh][^>]*>(.*?)<\/t[dh]>/is', $tr, $tdMatches)) {
                    $row = array_map(function($td) {
                        return trim(html_entity_decode(strip_tags($td), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
                    }, $tdMatches[1]);
                    if (!empty(array_filter($row))) {
                        $rows[] = $row;
                    }
                }
            }
        }
        if (!empty($rows)) return $rows;
    }

    $lines = preg_split('/\r\n|\r|\n/', $content);
    $rows = [];
    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;
        $delimiter = ',';
        if (strpos($line, "\t") !== false) $delimiter = "\t";
        elseif (strpos($line, ";") !== false) $delimiter = ";";
        elseif (strpos($line, "|") !== false) $delimiter = "|";
        $cols = str_getcsv($line, $delimiter, '"', "\\");
        $rows[] = array_map('trim', $cols);
    }
    return $rows;
}

// 2. Upload Leads File (CSV / XLSX / XLS / TXT / TSV)
if ($action === 'upload_leads') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);

    if (empty($_FILES['lead_file']) || $_FILES['lead_file']['error'] !== UPLOAD_ERR_OK) {
        jsonOut(['success' => false, 'error' => 'No valid file uploaded.'], 400);
    }

    $filePath = $_FILES['lead_file']['tmp_name'];
    $origName = $_FILES['lead_file']['name'] ?? 'leads.csv';
    $rows = extractRowsFromUploadedFile($filePath, $origName);

    if (empty($rows)) {
        jsonOut(['success' => false, 'error' => 'The uploaded file is empty or could not be read.'], 400);
    }

    $imported = 0;
    $invalid = 0;

    $stmtInsert = $db->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')");

    $isFirstLine = true;
    $phoneIdx = 1;
    $nameIdx = 0;
    $timeIdx = 2;
    $notesIdx = 3;

    foreach ($rows as $cols) {
        if (empty($cols) || !is_array($cols)) continue;

        if ($isFirstLine) {
            $isFirstLine = false;
            $headerLower = array_map('strtolower', array_map('trim', $cols));
            $foundHeader = false;

            foreach ($headerLower as $idx => $h) {
                if (strpos($h, 'phone') !== false || strpos($h, 'number') !== false || strpos($h, 'mobile') !== false || strpos($h, 'tel') !== false) {
                    $phoneIdx = $idx;
                    $foundHeader = true;
                } elseif (strpos($h, 'name') !== false || strpos($h, 'customer') !== false || strpos($h, 'client') !== false) {
                    $nameIdx = $idx;
                    $foundHeader = true;
                } elseif (strpos($h, 'time') !== false || strpos($h, 'hour') !== false || strpos($h, 'schedule') !== false) {
                    $timeIdx = $idx;
                    $foundHeader = true;
                } elseif (strpos($h, 'note') !== false || strpos($h, 'tag') !== false || strpos($h, 'account') !== false) {
                    $notesIdx = $idx;
                    $foundHeader = true;
                }
            }

            if ($foundHeader) {
                continue;
            }
        }

        // Intelligently find phone number column if not matching phoneIdx
        $phone = sanitizePhone($cols[$phoneIdx] ?? '');
        $usedPhoneIdx = $phoneIdx;

        if (empty($phone) || strlen($phone) < 6) {
            foreach ($cols as $idx => $val) {
                $candidate = sanitizePhone($val);
                if (!empty($candidate) && strlen($candidate) >= 8) {
                    $phone = $candidate;
                    $usedPhoneIdx = $idx;
                    break;
                }
            }
        }

        if (empty($phone) || strlen($phone) < 6) {
            $invalid++;
            continue;
        }

        $usedNameIdx = ($usedPhoneIdx === $nameIdx) ? ($nameIdx === 0 ? 1 : 0) : $nameIdx;
        $name = trim($cols[$usedNameIdx] ?? 'Customer');
        if (empty($name) || sanitizePhone($name) === $phone) {
            $name = 'Customer (' . substr($phone, -4) . ')';
        }

        $callTime = trim($cols[$timeIdx] ?? 'Immediate');
        if (empty($callTime) || $timeIdx === $usedPhoneIdx) $callTime = 'Immediate';
        $notes = trim($cols[$notesIdx] ?? 'Imported');

        $stmtInsert->execute([$campaignId, $name, $phone, $callTime, $notes]);
        $imported++;
    }

    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);

    // Fetch updated leads
    $stmtLeads = $db->prepare("SELECT * FROM leads WHERE campaign_id = ? ORDER BY id ASC");
    $stmtLeads->execute([$campaignId]);
    $allLeads = $stmtLeads->fetchAll();

    jsonOut([
        'success' => true,
        'imported' => $imported,
        'invalid' => $invalid,
        'leads' => $allLeads,
        'message' => "Successfully imported {$imported} leads from " . htmlspecialchars($origName) . "."
    ]);
}

// 3. Save Manual Write-in Leads
if ($action === 'save_manual_leads') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $text = trim($_POST['leads_text'] ?? '');

    if (empty($text)) {
        jsonOut(['success' => false, 'error' => 'Please enter at least one phone number.'], 400);
    }

    $lines = preg_split('/\r\n|\r|\n/', $text);
    $imported = 0;
    $duplicates = 0;
    $invalid = 0;

    $stmtCheck = $db->prepare("SELECT id FROM leads WHERE campaign_id = ? AND phone_number = ?");
    $stmtInsert = $db->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')");

    foreach ($lines as $line) {
        $line = trim($line);
        if (empty($line)) continue;

        $parts = array_map('trim', explode(',', $line));
        $phone = sanitizePhone($parts[0] ?? '');

        if (empty($phone) || strlen($phone) < 6) {
            $invalid++;
            continue;
        }

        $name = !empty($parts[1]) ? $parts[1] : 'Customer (' . substr($phone, -4) . ')';
        $callTime = !empty($parts[2]) ? $parts[2] : date('h:i A');
        $notes = !empty($parts[3]) ? $parts[3] : 'Manual Entry';

        $stmtCheck->execute([$campaignId, $phone]);
        if ($stmtCheck->fetch()) {
            $duplicates++;
            continue;
        }

        $stmtInsert->execute([$campaignId, $name, $phone, $callTime, $notes]);
        $imported++;
    }

    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);

    jsonOut([
        'success' => true,
        'imported' => $imported,
        'duplicates' => $duplicates,
        'invalid' => $invalid,
        'message' => "Successfully added {$imported} leads."
    ]);
}

// 3b. Add Single Quick Contact
if ($action === 'add_single_lead') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $name = trim($_POST['customer_name'] ?? '');
    $rawPhone = trim($_POST['phone_number'] ?? '');
    $callTime = trim($_POST['call_time'] ?? 'Immediate');
    $notes = trim($_POST['notes'] ?? 'Quick Add');

    $phone = sanitizePhone($rawPhone);
    if (empty($phone) || strlen($phone) < 6) {
        jsonOut(['success' => false, 'error' => 'Please enter a valid phone number.'], 400);
    }
    if (empty($name)) {
        $name = 'Customer (' . substr($phone, -4) . ')';
    }

    $stmtInsert = $db->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    $stmtInsert->execute([$campaignId, $name, $phone, $callTime, $notes]);
    $newId = (int)$db->lastInsertId();

    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);

    $stmtLead = $db->prepare("SELECT * FROM leads WHERE id = ?");
    $stmtLead->execute([$newId]);
    $newLead = $stmtLead->fetch();

    jsonOut([
        'success' => true,
        'message' => "Contact {$name} ({$phone}) added successfully!",
        'lead' => $newLead
    ]);
}

// 4. Update Lead Status & Call Event
if ($action === 'update_lead_status') {
    $leadId = (int)($_POST['lead_id'] ?? 0);
    $status = trim($_POST['status'] ?? 'pending');
    $duration = (int)($_POST['duration_sec'] ?? 0);
    $audioPlayed = trim($_POST['audio_played'] ?? 'Human Welcome Recording');
    $errMsg = trim($_POST['error_message'] ?? '');

    if ($leadId <= 0) {
        jsonOut(['success' => false, 'error' => 'Invalid lead ID.'], 400);
    }

    $stmt = $db->prepare("UPDATE leads SET status = ?, duration_sec = ?, error_message = ?, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?");
    $stmt->execute([$status, $duration, $errMsg, $leadId]);

    if (in_array($status, ['completed', 'ivr_completed', 'busy', 'no_answer', 'failed'])) {
        $lead = $db->query("SELECT * FROM leads WHERE id = {$leadId}")->fetch();
        if ($lead) {
            $campaign = $db->query("SELECT * FROM campaigns WHERE id = {$lead['campaign_id']}")->fetch();
            $insLog = $db->prepare("INSERT INTO call_logs (lead_id, campaign_id, customer_name, phone_number, call_time, agent_extension, status, duration_sec, audio_played) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
            $insLog->execute([
                $leadId,
                $lead['campaign_id'],
                $lead['customer_name'],
                $lead['phone_number'],
                $lead['call_time'] ?? date('h:i A'),
                $_SESSION['dialer_user']['sip_extension'] ?? $_SESSION['dialer_user']['extension'] ?? '101',
                $status,
                $duration,
                $campaign['ivr_audio_name'] ?? 'Human Voice Audio'
            ]);
        }
    }

    jsonOut(['success' => true]);
}

// 5. Upload Human Audio File (.wav / .mp3 / audio formats)
if ($action === 'upload_audio') {
    if (empty($_FILES['audio_file']) || $_FILES['audio_file']['error'] !== UPLOAD_ERR_OK) {
        $errCode = $_FILES['audio_file']['error'] ?? 'no file';
        $errMessages = [
            UPLOAD_ERR_INI_SIZE => 'Audio file exceeds server upload size limit.',
            UPLOAD_ERR_FORM_SIZE => 'Audio file exceeds form size limit.',
            UPLOAD_ERR_PARTIAL => 'Audio file was only partially uploaded.',
            UPLOAD_ERR_NO_FILE => 'No audio file was selected.',
            UPLOAD_ERR_NO_TMP_DIR => 'Missing temporary folder on server.',
            UPLOAD_ERR_CANT_WRITE => 'Failed to write audio file to disk.'
        ];
        $msg = $errMessages[$errCode] ?? "Audio upload failed (code: {$errCode}).";
        jsonOut(['success' => false, 'error' => $msg], 400);
    }

    $rawName = $_FILES['audio_file']['name'];
    $ext = strtolower(pathinfo($rawName, PATHINFO_EXTENSION));
    $allowedExts = ['wav', 'mp3', 'm4a', 'ogg', 'aac', 'flac', 'wma', 'gsm'];
    if (!in_array($ext, $allowedExts)) {
        $ext = 'wav';
    }

    $cleanBase = preg_replace('/[^a-zA-Z0-9_\-]/', '_', pathinfo($rawName, PATHINFO_FILENAME));
    if (empty($cleanBase)) $cleanBase = 'audio_recording';
    
    $uniqueFileName = time() . '_' . $cleanBase . '.' . $ext;
    $uploadDir = __DIR__ . '/assets/audio';
    if (!is_dir($uploadDir)) @mkdir($uploadDir, 0777, true);

    $targetPath = $uploadDir . '/' . $uniqueFileName;
    $saved = @move_uploaded_file($_FILES['audio_file']['tmp_name'], $targetPath);
    if (!$saved && file_exists($_FILES['audio_file']['tmp_name'])) {
        $saved = @copy($_FILES['audio_file']['tmp_name'], $targetPath);
    }

    if ($saved) {
        $audioName = trim($_POST['audio_name'] ?? '');
        if (empty($audioName)) {
            $audioName = pathinfo($rawName, PATHINFO_FILENAME);
        }

        $relPath = 'assets/audio/' . $uniqueFileName;
        $fusionPath = '/var/lib/freeswitch/recordings/' . $uniqueFileName;

        $stmt = $db->prepare("INSERT INTO audio_recordings (name, filename, filepath, fusionpbx_path) VALUES (?, ?, ?, ?)");
        $stmt->execute([$audioName, $uniqueFileName, $relPath, $fusionPath]);
        $audioId = (int)$db->lastInsertId();

        // Update active campaign audio
        $campaignId = (int)($_POST['campaign_id'] ?? 1);
        $db->prepare("UPDATE campaigns SET ivr_audio_name = ?, ivr_audio_file = ?, fusionpbx_ivr_path = ? WHERE id = ?")
           ->execute([$audioName, $relPath, $fusionPath, $campaignId]);

        jsonOut([
            'success' => true,
            'message' => "Audio \"{$audioName}\" uploaded successfully!",
            'audio' => [
                'id' => $audioId,
                'name' => $audioName,
                'filepath' => $relPath,
                'fusionpbx_path' => $fusionPath
            ]
        ]);
    } else {
        jsonOut(['success' => false, 'error' => 'Could not save audio file to assets/audio directory.'], 500);
    }
}

// 6. Select Audio Recording for Campaign
if ($action === 'select_audio') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $audioId = (int)($_POST['audio_id'] ?? 0);

    $stmt = $db->prepare("SELECT * FROM audio_recordings WHERE id = ?");
    $stmt->execute([$audioId]);
    $aud = $stmt->fetch();

    if ($aud) {
        $db->prepare("UPDATE campaigns SET ivr_audio_name = ?, ivr_audio_file = ?, fusionpbx_ivr_path = ? WHERE id = ?")
           ->execute([$aud['name'], $aud['filepath'], $aud['fusionpbx_path'], $campaignId]);
        jsonOut(['success' => true, 'message' => "Selected active IVR: {$aud['name']}", 'audio' => $aud]);
    } else {
        jsonOut(['success' => false, 'error' => 'Audio recording not found.'], 404);
    }
}

// 6b. Delete Audio Recording
if ($action === 'delete_audio') {
    $audioId = (int)($_POST['audio_id'] ?? 0);
    if ($audioId <= 1) {
        jsonOut(['success' => false, 'error' => 'Cannot delete default audio recording.'], 400);
    }

    $stmt = $db->prepare("SELECT * FROM audio_recordings WHERE id = ?");
    $stmt->execute([$audioId]);
    $aud = $stmt->fetch();
    if ($aud) {
        $fullPath = __DIR__ . '/' . $aud['filepath'];
        if (file_exists($fullPath) && $aud['filename'] !== 'welcome_human_voice.wav') {
            @unlink($fullPath);
        }
        $db->prepare("DELETE FROM audio_recordings WHERE id = ?")->execute([$audioId]);
        jsonOut(['success' => true, 'message' => 'Audio recording deleted.']);
    } else {
        jsonOut(['success' => false, 'error' => 'Audio not found.'], 404);
    }
}

// 7. Reset Leads
if ($action === 'reset_leads') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $db->prepare("UPDATE leads SET status = 'pending', duration_sec = 0, dtmf_response = '', error_message = '' WHERE campaign_id = ?")
       ->execute([$campaignId]);
    jsonOut(['success' => true, 'message' => 'All leads reset to pending.']);
}

// 7b. Re-queue Unanswered / Missed Leads back to Pending
if ($action === 'requeue_unanswered') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $stmt = $db->prepare("UPDATE leads SET status = 'pending', duration_sec = 0 WHERE campaign_id = ? AND status IN ('no_answer', 'busy', 'failed')");
    $stmt->execute([$campaignId]);
    $count = $stmt->rowCount();
    jsonOut(['success' => true, 'message' => "Re-queued {$count} unanswered leads back into active calling queue!"]);
}

// 8. Delete Lead / Clear All Leads
if ($action === 'delete_lead') {
    $leadId = (int)($_POST['lead_id'] ?? 0);
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $db->prepare("DELETE FROM leads WHERE id = ?")->execute([$leadId]);
    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);
    jsonOut(['success' => true]);
}

if ($action === 'clear_all_leads') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $db->prepare("DELETE FROM leads WHERE campaign_id = ?")->execute([$campaignId]);
    $db->prepare("UPDATE campaigns SET total_leads = 0 WHERE id = ?")->execute([$campaignId]);
    jsonOut(['success' => true, 'message' => 'All leads removed.']);
}

// 9. Export Call Logs to CSV
if ($action === 'export_logs_csv') {
    $campaignId = (int)($_GET['campaign_id'] ?? 1);
    $stmt = $db->prepare("SELECT id, customer_name, phone_number, call_time, agent_extension, status, duration_sec, audio_played, timestamp FROM call_logs WHERE campaign_id = ? ORDER BY id DESC");
    $stmt->execute([$campaignId]);
    $records = $stmt->fetchAll();

    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename=skykin_dialer_logs_' . date('Y-m-d_His') . '.csv');

    $out = fopen('php://output', 'w');
    fputcsv($out, ['Log ID', 'Customer Name', 'Phone Number', 'Scheduled Call Time', 'Agent Extension', 'Status', 'Duration (s)', 'IVR Audio Played', 'Timestamp']);

    foreach ($records as $r) {
        fputcsv($out, [
            $r['id'],
            $r['customer_name'],
            $r['phone_number'],
            $r['call_time'],
            $r['agent_extension'],
            $r['status'],
            $r['duration_sec'],
            $r['audio_played'],
            $r['timestamp']
        ]);
    }
    fclose($out);
    exit;
}

// 10. Get Agent Profile and SIP Configuration
if ($action === 'get_agent_profile') {
    if (empty($_SESSION['dialer_user'])) {
        jsonOut(['success' => false, 'error' => 'Not authenticated'], 401);
    }
    $user = $_SESSION['dialer_user'];
    $userId = $user['id'] ?? 0;
    if ($userId > 0) {
        $stmt = $db->prepare("SELECT id, username, full_name, extension, role, domain, sip_extension, sip_password, sip_extension2, sip_password2, line2_enabled, sip_server, sip_port, sip_domain FROM users WHERE id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if ($row) {
            $user = array_merge($user, $row);
            $_SESSION['dialer_user'] = $user;
        }
    }
    jsonOut(['success' => true, 'user' => $user]);
}

// 11. Save SIP Phone Settings (Line 1 & Line 2)
if ($action === 'save_sip_settings') {
    if (empty($_SESSION['dialer_user'])) {
        jsonOut(['success' => false, 'error' => 'Not authenticated'], 401);
    }

    $ext     = trim($_POST['sip_extension'] ?? $_POST['extension'] ?? '');
    $pass    = trim($_POST['sip_password'] ?? $_POST['password'] ?? '');
    $ext2    = trim($_POST['sip_extension2'] ?? '');
    $pass2   = trim($_POST['sip_password2'] ?? '');
    $l2On    = isset($_POST['line2_enabled']) ? (int)$_POST['line2_enabled'] : 1;
    $server  = trim($_POST['sip_server'] ?? $_POST['server'] ?? 'webcc.skyconnectsolutions.et');
    $port    = trim($_POST['sip_port'] ?? $_POST['port'] ?? '443');
    $domain  = trim($_POST['sip_domain'] ?? $_POST['domain'] ?? 'client1.skykin.local');

    if (empty($ext) || empty($pass)) {
        jsonOut(['success' => false, 'error' => 'Line 1 Extension and SIP password are required.'], 400);
    }

    $userId = $_SESSION['dialer_user']['id'] ?? 0;
    if ($userId > 0) {
        $stmt = $db->prepare("UPDATE users SET sip_extension = ?, sip_password = ?, sip_extension2 = ?, sip_password2 = ?, line2_enabled = ?, sip_server = ?, sip_port = ?, sip_domain = ? WHERE id = ?");
        $stmt->execute([$ext, $pass, $ext2, $pass2, $l2On, $server, $port, $domain, $userId]);
    }

    $_SESSION['dialer_user']['sip_extension']  = $ext;
    $_SESSION['dialer_user']['sip_password']   = $pass;
    $_SESSION['dialer_user']['sip_extension2'] = $ext2;
    $_SESSION['dialer_user']['sip_password2']  = $pass2;
    $_SESSION['dialer_user']['line2_enabled']  = $l2On;
    $_SESSION['dialer_user']['sip_server']     = $server;
    $_SESSION['dialer_user']['sip_port']       = $port;
    $_SESSION['dialer_user']['sip_domain']     = $domain;
    $_SESSION['dialer_user']['extension']      = $ext;

    jsonOut([
        'success' => true,
        'message' => 'Dual Line SIP settings saved successfully!',
        'sip' => [
            'extension'      => $ext,
            'extension2'     => $ext2,
            'line2_enabled'  => $l2On,
            'server'         => $server,
            'port'           => $port,
            'domain'         => $domain
        ]
    ]);
}

// 12. Reschedule Lead (Redial with new date & time)
if ($action === 'reschedule_lead') {
    $leadId = (int)($_POST['lead_id'] ?? 0);
    $newDate = trim($_POST['new_date'] ?? date('Y-m-d'));
    $newTime = trim($_POST['new_time'] ?? 'Immediate');

    if ($leadId <= 0) {
        jsonOut(['success' => false, 'error' => 'Invalid lead ID'], 400);
    }

    $fullCallTime = ($newTime === 'Immediate' || empty($newTime)) ? "{$newDate} Immediate" : "{$newDate} {$newTime}";

    $stmt = $db->prepare("UPDATE leads SET call_time = ?, status = 'pending', duration_sec = 0, error_message = '' WHERE id = ?");
    $stmt->execute([$fullCallTime, $leadId]);

    // Return updated lead
    $stmtGet = $db->prepare("SELECT * FROM leads WHERE id = ?");
    $stmtGet->execute([$leadId]);
    $updatedLead = $stmtGet->fetch();

    jsonOut([
        'success' => true,
        'message' => "Contact scheduled for {$fullCallTime} and added to active queue!",
        'lead' => $updatedLead
    ]);
}

// 13. Bulk Rollover Remaining / Unanswered Calls to Today
if ($action === 'bulk_rollover_to_today') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $targetDate = trim($_POST['target_date'] ?? date('Y-m-d'));
    $targetTime = trim($_POST['target_time'] ?? 'Immediate');

    $stmtLeads = $db->prepare("SELECT id, call_time, created_at, status FROM leads WHERE campaign_id = ?");
    $stmtLeads->execute([$campaignId]);
    $all = $stmtLeads->fetchAll();

    $today = date('Y-m-d');
    $rolloverIds = [];
    foreach ($all as $l) {
        $d = extractLeadDate($l['call_time'] ?? '', $l['created_at'] ?? '');
        if ($d < $today && in_array($l['status'], ['pending', 'no_answer', 'busy', 'failed'])) {
            $rolloverIds[] = $l['id'];
        }
    }

    if (!empty($rolloverIds)) {
        $fullCallTime = ($targetTime === 'Immediate' || empty($targetTime)) ? "{$targetDate} Immediate" : "{$targetDate} {$targetTime}";
        $inClause = implode(',', array_map('intval', $rolloverIds));
        $db->exec("UPDATE leads SET call_time = '{$fullCallTime}', status = 'pending', duration_sec = 0, error_message = '' WHERE id IN ({$inClause})");
    }

    jsonOut([
        'success' => true,
        'count' => count($rolloverIds),
        'message' => count($rolloverIds) . " remaining calls from previous days rolled over to {$targetDate} ({$targetTime})!"
    ]);
}

// 14. Schedule Redial as New Lead Record (if from call log)
if ($action === 'schedule_redial') {
    $campaignId = (int)($_POST['campaign_id'] ?? 1);
    $name = trim($_POST['customer_name'] ?? 'Customer');
    $rawPhone = trim($_POST['phone_number'] ?? '');
    $schedDate = trim($_POST['scheduled_date'] ?? date('Y-m-d'));
    $schedTime = trim($_POST['scheduled_time'] ?? 'Immediate');
    $notes = trim($_POST['notes'] ?? 'Follow-up Redial');

    $phone = sanitizePhone($rawPhone);
    if (empty($phone) || strlen($phone) < 6) {
        jsonOut(['success' => false, 'error' => 'Invalid phone number.'], 400);
    }

    $fullCallTime = ($schedTime === 'Immediate' || empty($schedTime)) ? "{$schedDate} Immediate" : "{$schedDate} {$schedTime}";

    $stmt = $db->prepare("INSERT INTO leads (campaign_id, customer_name, phone_number, call_time, notes, status) VALUES (?, ?, ?, ?, ?, 'pending')");
    $stmt->execute([$campaignId, $name, $phone, $fullCallTime, $notes]);
    $newId = (int)$db->lastInsertId();

    $db->prepare("UPDATE campaigns SET total_leads = (SELECT COUNT(*) FROM leads WHERE campaign_id = ?) WHERE id = ?")
       ->execute([$campaignId, $campaignId]);

    jsonOut([
        'success' => true,
        'message' => "Redial scheduled for {$name} ({$phone}) on {$fullCallTime}!",
        'lead_id' => $newId
    ]);
}

jsonOut(['error' => 'Unknown action'], 400);

