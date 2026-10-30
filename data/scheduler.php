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
    // 011xxxxxxx (Addis Ababa Landline) -> +25111xxxxxxx
    if (preg_match('/^0([1-5]\d{8})$/', $cleaned, $m)) {
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
 * Normalizes user-submitted scheduled time string
 */
if (!function_exists('normalizeScheduledTime')) {
function normalizeScheduledTime(string $raw): string {
    $s = trim($raw);
    if (empty($s) || strcasecmp($s, 'immediate') === 0 || strcasecmp($s, 'now') === 0) {
        return 'Immediate';
    }

    $tz = getDialerTimezone();
    @date_default_timezone_set($tz);
    $now = time();
    $todayDate = date('Y-m-d', $now);

    // If already in "Today, hh:mm A" or "YYYY-MM-DD hh:mm A"
    if (preg_match('/^(?:Today,\s*)?(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))$/i', $s, $m)) {
        return "Today, " . strtoupper(trim($m[1]));
    }

    // 24h format "14:30"
    if (preg_match('/^(\d{1,2}):(\d{2})$/', $s, $m)) {
        $ts = strtotime("{$todayDate} {$s}");
        if ($ts !== false) {
            return "Today, " . date('h:i A', $ts);
        }
    }

    $parsed = @strtotime($s);
    if ($parsed !== false) {
        $pDate = date('Y-m-d', $parsed);
        $pTime = date('h:i A', $parsed);
        return ($pDate === $todayDate) ? "Today, {$pTime}" : "{$pDate} {$pTime}";
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

    // If there are already future pending scheduled calls in the queue, append after the latest
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
            $batchIndex = floor($i / $batchSize);
            $ts = $baseTs + ($batchIndex * $intervalMins * 60);
            $timePart = date('h:i A', $ts);
            $datePart = date('Y-m-d', $ts);
            $schedules[] = ($datePart === $todayDate) ? "Today, {$timePart}" : "{$datePart} {$timePart}";
        }
    } else {
        // Interval Staggering: starts at present ($baseTs = $now), +intervalMins each
        for ($i = 0; $i < $count; $i++) {
            $ts = $baseTs + ($i * $intervalMins * 60);
            $timePart = date('h:i A', $ts);
            $datePart = date('Y-m-d', $ts);
            $schedules[] = ($datePart === $todayDate) ? "Today, {$timePart}" : "{$datePart} {$timePart}";
        }
    }

    return $schedules;
}
}
