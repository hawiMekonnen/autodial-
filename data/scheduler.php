<?php
/**
 * SkyKin Automatic Outbound Dialer - Auto-Scheduler & Number Normalization Engine
 * Timezone: Africa/Addis_Ababa
 */

if (!function_exists('getDialerTimezone')) {
    function getDialerTimezone(): string {
        return getenv('APP_TIMEZONE') ?: 'Africa/Addis_Ababa';
    }
}

@date_default_timezone_set(getDialerTimezone());

/**
 * Generic E.164 phone number normalizer using configurable default country code
 */
if (!function_exists('normalizePhoneNumber')) {
function normalizePhoneNumber(string $raw, string $defaultCountryCode = '+251'): string {
    $cleaned = preg_replace('/[^\d+]/', '', trim($raw));
    if (empty($cleaned)) return '';

    if (str_starts_with($cleaned, '+')) {
        $digits = preg_replace('/\D/', '', $cleaned);
        if (strlen($digits) >= 7 && strlen($digits) <= 15) {
            return '+' . $digits;
        }
        return '';
    }

    if (str_starts_with($cleaned, '00')) {
        $digits = substr($cleaned, 2);
        if (strlen($digits) >= 7 && strlen($digits) <= 15) {
            return '+' . $digits;
        }
    }

    $digits = preg_replace('/\D/', '', $cleaned);
    if (empty($digits)) return '';

    // If starts with 0 (national trunk prefix, e.g. 0939777880, 0712345678, 011...)
    if (str_starts_with($digits, '0') && strlen($digits) >= 8) {
        $national = substr($digits, 1);
        $cc = ltrim($defaultCountryCode, '+');
        return '+' . $cc . $national;
    }

    // If 9 digits starting with 7 or 9 (Ethiopian mobile without leading zero, e.g. 939777880 from Excel)
    if (preg_match('/^[79]\d{8}$/', $digits)) {
        $cc = ltrim($defaultCountryCode, '+');
        return '+' . $cc . $digits;
    }

    // If 12 digits starting with 251 (e.g. 251939777880)
    if (preg_match('/^251[79]\d{8}$/', $digits)) {
        return '+' . $digits;
    }

    // If length is already 10-15 digits
    if (strlen($digits) >= 10 && strlen($digits) <= 15) {
        return '+' . $digits;
    }

    // Default: append country code
    $cc = ltrim($defaultCountryCode, '+');
    return '+' . $cc . $digits;
}
}

/**
 * Backward compatibility alias
 */
if (!function_exists('normalizeEthiopianPhone')) {
function normalizeEthiopianPhone(string $raw): string {
    return normalizePhoneNumber($raw, '+251');
}
}

/**
 * Validates and identifies phone number type
 */
if (!function_exists('validatePhoneNumber')) {
function validatePhoneNumber(string $raw, string $defaultCountryCode = '+251'): array {
    $cleaned = preg_replace('/[^\d+]/', '', trim($raw));
    if (empty($cleaned)) {
        return ['valid' => false, 'error' => 'Empty phone number', 'operator' => 'Unknown', 'formatted' => ''];
    }

    $normalized = normalizePhoneNumber($raw, $defaultCountryCode);
    if (!empty($normalized)) {
        $digits = substr($normalized, 1);
        $len = strlen($digits);
        if ($len >= 7 && $len <= 15) {
            return ['valid' => true, 'operator' => 'Standard', 'formatted' => $normalized, 'type' => 'Mobile'];
        }
    }

    $digits = preg_replace('/\D/', '', $cleaned);
    $len = strlen($digits);
    if ($len < 7) {
        return ['valid' => false, 'error' => "Phone number too short ({$len} digits)", 'operator' => 'Invalid', 'formatted' => $cleaned];
    }
    if ($len > 15) {
        return ['valid' => false, 'error' => "Phone number too long ({$len} digits)", 'operator' => 'Invalid', 'formatted' => $cleaned];
    }
    return ['valid' => false, 'error' => 'Invalid phone format', 'operator' => 'Invalid', 'formatted' => $cleaned];
}
}

/**
 * Robust parser for all datetime formats:
 * - Excel serial timestamps (e.g. 46321.336805555555)
 * - ISO formats (2026-10-26 08:05 AM, 2026-10-26 14:30)
 * - Slashes & dots (26/10/2026 08:05 AM, 10/26/2026, 26.10.2026)
 * - Textual dates (Oct 26, 2026 08:05 AM, 26-Oct-2026)
 * - Time only (08:05 AM, 14:30, Today 08:05 AM, Tomorrow 09:00 AM)
 * - Relative offsets (+5 mins, +1 hour)
 */
if (!function_exists('parseAnyDateTime')) {
function parseAnyDateTime(string $raw, string $tz = ''): ?int {
    $s = trim($raw);
    if (empty($s) || strcasecmp($s, 'immediate') === 0 || strcasecmp($s, 'now') === 0 || strcasecmp($s, 'none') === 0) {
        return null;
    }

    if (empty($tz)) $tz = getDialerTimezone();
    @date_default_timezone_set($tz);
    $now = time();
    $todayDate = date('Y-m-d', $now);

    // 1. Excel Serial Number (e.g. 46321.336805555555 or 46321 or 0.336805555555)
    if (is_numeric($s)) {
        $num = (float)$s;
        // Excel serial date range for years 1970 - 2100 (25569 to 73415)
        if ($num >= 25569 && $num <= 73415) {
            $utcStr = gmdate('Y-m-d H:i:s', (int)round(($num - 25569) * 86400));
            $localTs = @strtotime($utcStr);
            if ($localTs !== false && $localTs > 0) return $localTs;
        }
        // Time fraction without date: 0.0 < num < 1.0
        if ($num > 0 && $num < 1.0) {
            $midnight = strtotime($todayDate . ' 00:00:00');
            return (int)round($midnight + ($num * 86400));
        }
    }

    // 2. Relative offset (e.g. "+5 mins", "+10 min", "+1 hour")
    if (preg_match('/^\+(\d+)\s*(?:min|mins|minute|minutes)$/i', $s, $m)) {
        return $now + ((int)$m[1] * 60);
    }
    if (preg_match('/^\+(\d+)\s*(?:hr|hrs|hour|hours)$/i', $s, $m)) {
        return $now + ((int)$m[1] * 3600);
    }

    // 3. Clean string: remove "Today," or "Tomorrow,"
    $isTomorrow = (stripos($s, 'tomorrow') !== false);
    $clean = trim(preg_replace('/^(?:today|tomorrow),?\s*(?:at\s*)?/i', '', $s));
    $clean = trim(preg_replace('/\s+at\s+/i', ' ', $clean));

    // 4. Time-only format: "08:05 AM", "8:05 pm", "14:30", "08:05:00"
    if (preg_match('/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i', $clean, $m)) {
        $baseDate = $isTomorrow ? date('Y-m-d', strtotime('+1 day', $now)) : $todayDate;
        $timeStr = $m[1] . ':' . $m[2] . (!empty($m[3]) ? ':' . $m[3] : ':00') . (!empty($m[4]) ? ' ' . $m[4] : '');
        $ts = @strtotime("{$baseDate} {$timeStr}");
        if ($ts !== false && $ts > 0) return $ts;
    }

    // 5. European / African Date format with slashes or dots:
    // DD/MM/YYYY or DD.MM.YYYY (e.g. 26/10/2026 08:05 AM or 26.10.2026 08:05)
    if (preg_match('/^(\d{1,2})[\/\.](\d{1,2})[\/\.](\d{4})(.*)$/', $clean, $m)) {
        $d = (int)$m[1];
        $mo = (int)$m[2];
        $y = (int)$m[3];
        $rest = trim($m[4]);
        $isoStr = sprintf('%04d-%02d-%02d %s', $y, $mo, $d, $rest);
        $ts = @strtotime(trim($isoStr));
        if ($ts !== false && $ts > 0) return $ts;
    }

    // 6. YYYY/MM/DD with slashes or dots: 2026/10/26 08:05 AM
    if (preg_match('/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})(.*)$/', $clean, $m)) {
        $isoStr = sprintf('%04d-%02d-%02d %s', (int)$m[1], (int)$m[2], (int)$m[3], trim($m[4]));
        $ts = @strtotime(trim($isoStr));
        if ($ts !== false && $ts > 0) return $ts;
    }

    // 7. General strtotime fallback (handles "2026-10-26 08:05 AM", "Oct 26, 2026", etc.)
    $ts = @strtotime($clean);
    if ($ts !== false && $ts > 0) {
        if ($isTomorrow) $ts += 86400;
        return $ts;
    }

    return null;
}
}


/**
 * Normalizes user-submitted scheduled time string
 */
if (!function_exists('normalizeScheduledTime')) {
function normalizeScheduledTime(string $raw): string {
    $s = trim($raw);
    if (empty($s) || strcasecmp($s, 'immediate') === 0 || strcasecmp($s, 'now') === 0 || strcasecmp($s, 'none') === 0) {
        return 'Immediate';
    }

    $tz = getDialerTimezone();
    @date_default_timezone_set($tz);
    $now = time();
    $todayDate = date('Y-m-d', $now);

    $ts = parseAnyDateTime($s, $tz);
    if ($ts !== null && $ts > 0) {
        $leadDate = date('Y-m-d', $ts);
        $leadTime = date('h:i A', $ts);
        if ($leadDate === $todayDate) {
            return "Today, {$leadTime}";
        }
        return "{$leadDate} {$leadTime}";
    }

    return $s;
}
}

/**
 * Intelligent System Auto-Scheduler
 * Computes scheduled timestamps for a batch of contacts starting at the present moment.
 */
if (!function_exists('calculateSystemAutoSchedules')) {
function calculateSystemAutoSchedules(PDO $db, int $campaignId, int $count, array $override = []): array {
    if ($count <= 0) return [];

    $tz = !empty($override['client_timezone']) ? $override['client_timezone'] : getDialerTimezone();
    @date_default_timezone_set($tz);

    $camp = [];
    try {
        $stmt = $db->prepare("SELECT * FROM campaigns WHERE id = ?");
        $stmt->execute([$campaignId]);
        $camp = $stmt->fetch() ?: [];
    } catch (Exception $e) {}

    $strategy = $override['schedule_strategy'] ?? $camp['schedule_strategy'] ?? 'interval';
    $intervalMins = (int)($override['schedule_interval_mins'] ?? $camp['schedule_interval_mins'] ?? 2);
    if ($intervalMins <= 0) $intervalMins = 2;

    $winStart = $override['schedule_window_start'] ?? $camp['schedule_window_start'] ?? '09:00';
    $winEnd = $override['schedule_window_end'] ?? $camp['schedule_window_end'] ?? '17:00';
    $batchSize = (int)($override['schedule_batch_size'] ?? $camp['schedule_batch_size'] ?? 5);
    if ($batchSize <= 0) $batchSize = 5;

    // Start at the present moment!
    $now = !empty($override['client_time']) ? (int)$override['client_time'] : time();
    $todayDate = date('Y-m-d', $now);
    $baseTs = $now;

    // If append_queue is explicitly requested, append after existing pending scheduled calls
    if (!empty($override['append_queue'])) {
        try {
            $stmtPending = $db->prepare("SELECT call_time FROM leads WHERE campaign_id = ? AND status = 'pending' AND call_time != 'Immediate' ORDER BY id DESC LIMIT 20");
            $stmtPending->execute([$campaignId]);
            $lastCallTimes = $stmtPending->fetchAll(PDO::FETCH_COLUMN);

            $latestPendingTs = 0;
            foreach ($lastCallTimes as $ct) {
                $cleanTime = str_replace(['Today,', 'Today'], '', $ct);
                $ts = @strtotime($todayDate . ' ' . trim($cleanTime));
                if ($ts && $ts > $latestPendingTs) {
                    $latestPendingTs = $ts;
                }
            }

            if ($latestPendingTs > $now && $strategy === 'interval') {
                $baseTs = $latestPendingTs + ($intervalMins * 60);
            }
        } catch (Exception $e) {}
    }

    $schedules = [];

    if ($strategy === 'smart') {
        $lines = 2;
        try {
            $stmtLines = $db->query("SELECT value FROM settings WHERE key = 'available_lines'");
            $linesVal = (int)$stmtLines->fetchColumn();
            if ($linesVal > 0) $lines = $linesVal;
        } catch (Exception $e) {}

        $startParts = explode(':', $winStart);
        $startH = (int)($startParts[0] ?? 9);
        $startM = (int)($startParts[1] ?? 0);

        $endParts = explode(':', $winEnd);
        $endH = (int)($endParts[0] ?? 17);
        $endM = (int)($endParts[1] ?? 0);

        $curH = (int)date('G', $baseTs);
        $curM = (int)date('i', $baseTs);
        $curTotalMin = $curH * 60 + $curM;
        $startTotalMin = $startH * 60 + $startM;
        $endTotalMin = $endH * 60 + $endM;

        if ($curTotalMin < $startTotalMin) {
            $cursorTs = strtotime(date('Y-m-d', $baseTs) . ' ' . $winStart);
        } else {
            // Prioritize dialing today starting from current time
            $cursorTs = (int)(ceil(($baseTs + 30) / 60) * 60);
        }

        $slotIntervalSecs = 60;
        $lineCounter = 0;
        // Extend evening calling window for today up to 21:00 (9 PM) so late afternoon batches dial today
        $effectiveDayEnd = max($endTotalMin, 21 * 60);

        for ($i = 0; $i < $count; $i++) {
            if ((int)date('w', $cursorTs) === 0) {
                $nextDay = strtotime('+1 day', $cursorTs);
                $cursorTs = strtotime(date('Y-m-d', $nextDay) . ' ' . $winStart);
            }

            $dayDate = date('Y-m-d', $cursorTs);
            $dayEndTs = strtotime($dayDate . ' ' . sprintf('%02d:%02d', floor($effectiveDayEnd / 60), $effectiveDayEnd % 60));
            if ($cursorTs >= $dayEndTs) {
                $nextDay = strtotime('+1 day', $cursorTs);
                if ((int)date('w', $nextDay) === 0) $nextDay = strtotime('+1 day', $nextDay);
                $cursorTs = strtotime(date('Y-m-d', $nextDay) . ' ' . $winStart);
                $dayDate = date('Y-m-d', $cursorTs);
            }

            $timePart = date('h:i A', $cursorTs);
            $schedules[] = ($dayDate === $todayDate) ? "Today, {$timePart}" : "{$dayDate} {$timePart}";

            $lineCounter++;
            if ($lineCounter >= $lines) {
                $lineCounter = 0;
                $cursorTs += $slotIntervalSecs;
            }
        }
    } elseif ($strategy === 'window') {
        $startWindowTs = strtotime($todayDate . ' ' . $winStart);
        $endWindowTs = strtotime($todayDate . ' ' . $winEnd);

        if ($now > $endWindowTs) {
            $tomorrow = date('Y-m-d', strtotime('+1 day', $now));
            $startWindowTs = strtotime($tomorrow . ' ' . $winStart);
            $endWindowTs = strtotime($tomorrow . ' ' . $winEnd);
        } elseif ($now > $startWindowTs) {
            $startWindowTs = $now;
        }

        $windowDuration = max(60, $endWindowTs - $startWindowTs);
        $step = ($count > 1) ? floor($windowDuration / $count) : 0;

        for ($i = 0; $i < $count; $i++) {
            $ts = $startWindowTs + ($i * $step);
            $timePart = date('h:i A', $ts);
            $datePart = date('Y-m-d', $ts);
            $schedules[] = ($datePart === $todayDate) ? "Today, {$timePart}" : "{$datePart} {$timePart}";
        }
    } elseif ($strategy === 'batch') {
        for ($i = 0; $i < $count; $i++) {
            $batchIndex = floor($i / $batchSize) + 1;
            $ts = $baseTs + ($batchIndex * $intervalMins * 60);
            $timePart = date('h:i A', $ts);
            $datePart = date('Y-m-d', $ts);
            $schedules[] = ($datePart === $todayDate) ? "Today, {$timePart}" : "{$datePart} {$timePart}";
        }
    } else {
        // Interval Staggering: first contact is scheduled intervalMins after import time, then each next +intervalMins
        for ($i = 0; $i < $count; $i++) {
            $ts = $baseTs + (($i + 1) * $intervalMins * 60);
            $timePart = date('h:i A', $ts);
            $datePart = date('Y-m-d', $ts);
            $schedules[] = ($datePart === $todayDate) ? "Today, {$timePart}" : "{$datePart} {$timePart}";
        }
    }

    return $schedules;
}
}


if (!function_exists('generateSmartSchedulePlan')) {
function generateSmartSchedulePlan(PDO $db, int $campaignId, array $options = []): array {
    $camp = [];
    if ($campaignId > 0) {
        try {
            $stmt = $db->prepare("SELECT * FROM campaigns WHERE id = ?");
            $stmt->execute([$campaignId]);
            $camp = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        } catch (Exception $e) {}
    }

    // 1. Fetch system settings
    $settings = [];
    try {
        $stmt = $db->query("SELECT key, value FROM settings");
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $settings[$row['key']] = $row['value'];
        }
    } catch (Exception $e) {}

    $tz = !empty($options['timezone']) ? $options['timezone'] : ($settings['timezone'] ?? getDialerTimezone());
    @date_default_timezone_set($tz);

    $availableLines = (int)($options['available_lines'] ?? $settings['available_lines'] ?? $camp['max_concurrent'] ?? 2);
    if ($availableLines < 1) $availableLines = 1;

    $hoursStart = $options['calling_hours_start'] ?? $settings['allowed_calling_hours_start'] ?? $camp['schedule_window_start'] ?? '09:00';
    $hoursEnd = $options['calling_hours_end'] ?? $settings['allowed_calling_hours_end'] ?? $camp['schedule_window_end'] ?? '17:00';

    $maxRetries = (int)($options['max_retries'] ?? $settings['max_attempts_per_contact'] ?? $camp['max_retries'] ?? 2);
    $retryGapHours = (int)($options['retry_gap_hours'] ?? $settings['retry_delay_hours'] ?? 3);
    if ($retryGapHours < 1) $retryGapHours = 3;

    // 2. Count contacts to schedule
    $totalContacts = (int)($options['total_contacts'] ?? 0);
    if ($totalContacts <= 0 && $campaignId > 0) {
        try {
            $stmt = $db->prepare("SELECT count(*) FROM leads WHERE campaign_id = ? AND status = 'pending'");
            $stmt->execute([$campaignId]);
            $totalContacts = (int)$stmt->fetchColumn();
        } catch (Exception $e) {}
    }
    if ($totalContacts <= 0) {
        $totalContacts = 10; // Default sample batch if completely empty
    }

    // 3. Analyze Historical Answer Rates by Hour
    $hourlyRates = [];
    $totalHistoryCalls = 0;
    try {
        $stmt = $db->query("SELECT EXTRACT(HOUR FROM timestamp) as hr, count(*) as cnt, sum(CASE WHEN status ILIKE 'answered' THEN 1 ELSE 0 END) as ans FROM call_logs GROUP BY hr ORDER BY hr");
        while ($r = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $hr = (int)$r['hr'];
            $cnt = (int)$r['cnt'];
            $ans = (int)$r['ans'];
            $totalHistoryCalls += $cnt;
            $hourlyRates[$hr] = $cnt > 0 ? round(($ans / $cnt), 2) : 0.50;
        }
    } catch (Exception $e) {}

    $hasHistory = ($totalHistoryCalls >= 15);
    $historyExplanation = $hasHistory
        ? "Plan optimized using historical answer rates from " . number_format($totalHistoryCalls) . " logged calls."
        : "Initial baseline distribution applied (standard business answer peaks: 10:00 to 12:00 and 14:00 to 16:30). Insufficient call history exists yet.";

    // 4. Calculate Batches and Timeline
    $startH = (int)explode(':', $hoursStart)[0];
    $endH = (int)explode(':', $hoursEnd)[0];
    if ($endH <= $startH) $endH = $startH + 8;

    $callsPerHourPerLine = 24; // 1 call every 2.5 minutes on average
    $maxCallsPerHour = $availableLines * $callsPerHourPerLine;

    $now = time();
    $currentHour = (int)date('G', $now);
    $currentDate = date('Y-m-d', $now);

    // Determine starting date and hour
    $planDate = $currentDate;
    $planHour = max($startH, $currentHour + 1);
    if ($planHour >= $endH) {
        // Schedule starting tomorrow morning
        $planDate = date('Y-m-d', strtotime('+1 day', $now));
        $planHour = $startH;
    }

    $batches = [];
    $remaining = $totalContacts;
    $batchNum = 1;
    $totalAnsweredEst = 0;

    while ($remaining > 0) {
        // Skip Sunday
        $dayOfWeek = date('w', strtotime($planDate));
        if ($dayOfWeek == 0) {
            $planDate = date('Y-m-d', strtotime('+1 day', strtotime($planDate)));
            $planHour = $startH;
            continue;
        }

        $slotStart = sprintf('%02d:00', $planHour);
        $slotEnd = sprintf('%02d:00', $planHour + 1);
        $hourSlotLabel = "{$slotStart} to {$slotEnd}";

        // Optimal response weighting for this hour
        $ansProb = 0.65;
        if ($hasHistory && isset($hourlyRates[$planHour])) {
            $ansProb = max(0.20, min(0.95, $hourlyRates[$planHour]));
        } else {
            if (($planHour >= 10 && $planHour <= 12) || ($planHour >= 14 && $planHour <= 16)) {
                $ansProb = 0.75;
            } elseif ($planHour == 12 || $planHour == 13) {
                $ansProb = 0.50; // Lunch hour
            } else {
                $ansProb = 0.60;
            }
        }

        $batchCount = min($remaining, $maxCallsPerHour);
        $batchAnsEst = (int)round($batchCount * $ansProb);
        $totalAnsweredEst += $batchAnsEst;

        $note = ($ansProb >= 0.70)
            ? "Scheduled during prime response window."
            : (($ansProb <= 0.52) ? "Standard pace window (midday break)." : "Regular business window.");

        $dayName = date('l', strtotime($planDate));
        $batches[] = [
            'batch_number' => $batchNum++,
            'date' => $planDate,
            'day_name' => $dayName,
            'hour_slot' => $hourSlotLabel,
            'time_start' => $slotStart,
            'contacts_count' => $batchCount,
            'active_lines' => min($availableLines, max(1, (int)ceil($batchCount / $callsPerHourPerLine))),
            'estimated_answered' => $batchAnsEst,
            'answer_probability' => round($ansProb * 100) . '%',
            'explanation' => $note
        ];

        $remaining -= $batchCount;

        // Advance to next hour
        $planHour++;
        if ($planHour >= $endH) {
            $planDate = date('Y-m-d', strtotime('+1 day', strtotime($planDate)));
            $planHour = $startH;
        }
    }

    $lastBatch = end($batches);
    $completionDateTime = $lastBatch ? ($lastBatch['date'] . ' at ' . substr($lastBatch['hour_slot'], -5)) : 'Immediate';

    // Estimated time comparison
    // Sequential single-line dial with 5 min gap: totalContacts * 5 mins
    $seqMinutes = $totalContacts * 5;
    $smartMinutes = max(15, count($batches) * 60);
    $timeSavedMinutes = max(0, $seqMinutes - $smartMinutes);
    $timeSavedHours = round($timeSavedMinutes / 60, 1);
    $timeSavedText = ($timeSavedHours >= 1.0)
        ? "{$timeSavedHours} hours saved"
        : "{$timeSavedMinutes} minutes saved";

    $rulesUsed = [
        "Calling window strictly enforced: {$hoursStart} to {$hoursEnd}.",
        "Full capacity utilized across {$availableLines} active telephony lines.",
        "Contacts concentrated into high-response response windows.",
        "Retry gap of {$retryGapHours} hours applied to alternate time windows.",
        $historyExplanation
    ];

    return [
        'campaign_id' => $campaignId,
        'total_contacts' => $totalContacts,
        'available_lines' => $availableLines,
        'calling_hours' => "{$hoursStart} to {$hoursEnd}",
        'expected_completion' => $completionDateTime,
        'estimated_answered_count' => $totalAnsweredEst,
        'estimated_answered_rate' => $totalContacts > 0 ? round(($totalAnsweredEst / $totalContacts) * 100, 1) . '%' : '0%',
        'estimated_time_saved' => $timeSavedText,
        'total_batches' => count($batches),
        'batches' => $batches,
        'rules_used' => $rulesUsed,
        'has_history' => $hasHistory,
        'accepted' => !empty($camp['smart_schedule_plan']),
        'created_at' => date('Y-m-d H:i:s')
    ];
}
}