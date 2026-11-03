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
 * Normalizes Ethiopian phone numbers into E.164 (+2519... or +2517...)
 */
if (!function_exists('normalizeEthiopianPhone')) {
function normalizeEthiopianPhone(string $raw): string {
    $cleaned = preg_replace('/[^\d+]/', '', trim($raw));
    if (empty($cleaned)) return '';

    if (str_starts_with($cleaned, '00251')) {
        $cleaned = '+251' . substr($cleaned, 5);
    }
    // 09xxxxxxxx or 07xxxxxxxx -> +2519xxxxxxxx / +2517xxxxxxxx
    if (preg_match('/^0([97]\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    // 9xxxxxxxx or 7xxxxxxxx (9 digits from Excel dropping leading 0)
    if (preg_match('/^([97]\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    // 011xxxxxxx (Addis Ababa Landline) -> +25111xxxxxxx
    if (preg_match('/^0(1\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    // 11xxxxxxx (8-9 digits Addis Ababa Landline without leading 0)
    if (preg_match('/^(11\d{7})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    // 2519xxxxxxxx or 2517xxxxxxxx
    if (preg_match('/^251([1-9]\d{8})$/', $cleaned, $m)) {
        return '+251' . $m[1];
    }
    if (preg_match('/^\+251([1-9]\d{8})$/', $cleaned)) {
        return $cleaned;
    }
    // Standard international numbers
    if (preg_match('/^\+[1-9]\d{7,14}$/', $cleaned)) {
        return $cleaned;
    }
    if (preg_match('/^[1-9]\d{7,14}$/', $cleaned)) {
        return '+' . $cleaned;
    }
    return '';
}
}

/**
 * Validates and identifies phone number operator
 */
if (!function_exists('validatePhoneNumber')) {
function validatePhoneNumber(string $raw): array {
    $cleaned = preg_replace('/[^\d+]/', '', trim($raw));
    if (empty($cleaned)) {
        return ['valid' => false, 'error' => 'Empty phone number', 'operator' => 'Unknown', 'formatted' => ''];
    }

    $normalized = normalizeEthiopianPhone($raw);
    if (!empty($normalized)) {
        if (preg_match('/^\+251(9\d{8})$/', $normalized)) {
            return ['valid' => true, 'operator' => 'Ethio Telecom', 'formatted' => $normalized, 'type' => 'Mobile'];
        }
        if (preg_match('/^\+251(7\d{8})$/', $normalized)) {
            return ['valid' => true, 'operator' => 'Safaricom', 'formatted' => $normalized, 'type' => 'Mobile'];
        }
        if (preg_match('/^\+251(11\d{7})$/', $normalized)) {
            return ['valid' => true, 'operator' => 'Ethio Telecom (Fixed)', 'formatted' => $normalized, 'type' => 'Landline'];
        }
        if (preg_match('/^\+[1-9]\d{6,14}$/', $normalized)) {
            return ['valid' => true, 'operator' => 'International', 'formatted' => $normalized, 'type' => 'International'];
        }
    }

    $digits = preg_replace('/\D/', '', $cleaned);
    $len = strlen($digits);
    if ($len < 9) {
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

    if ($strategy === 'window') {
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
