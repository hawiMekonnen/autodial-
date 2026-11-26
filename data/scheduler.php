<?php
/**
 * SkyKin Automatic Outbound Dialer - Auto-Scheduler & Number Normalization Engine
 * Timezone: Africa/Addis_Ababa
 */

if (!function_exists('isValidTimezoneId')) {
    function isValidTimezoneId(string $tz): bool {
        static $validSet = null;
        if ($validSet === null) {
            $validSet = array_flip(DateTimeZone::listIdentifiers());
        }
        $tz = trim($tz);
        return $tz !== '' && isset($validSet[$tz]);
    }
}

if (!function_exists('getDialerTimezone')) {
    function getDialerTimezone(?PDO $db = null, bool $forceReload = false): string {
        static $cachedTz = null;
        static $loadedFromDb = false;

        if (!$forceReload && $cachedTz !== null && ($db === null || $loadedFromDb)) {
            return $cachedTz;
        }

        $candidate = '';
        if ($db !== null) {
            try {
                $stmt = $db->prepare("SELECT value FROM settings WHERE key = 'timezone' LIMIT 1");
                $stmt->execute();
                $dbTz = trim((string)$stmt->fetchColumn());
                if (isValidTimezoneId($dbTz)) {
                    $candidate = $dbTz;
                    $loadedFromDb = true;
                }
            } catch (Throwable $e) {
            }
        }

        if ($candidate === '') {
            $envTz = trim((string)(getenv('APP_TIMEZONE') ?: ($_ENV['APP_TIMEZONE'] ?? '')));
            if (isValidTimezoneId($envTz)) {
                $candidate = $envTz;
            }
        }

        if ($candidate === '') {
            $iniTz = trim((string)ini_get('date.timezone'));
            if (isValidTimezoneId($iniTz)) {
                $candidate = $iniTz;
            }
        }

        if ($candidate === '') {
            $candidate = 'Africa/Addis_Ababa';
        }

        $cachedTz = $candidate;
        @date_default_timezone_set($cachedTz);

        if ($db !== null) {
            try {
                if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql') {
                    $db->exec("SET TIME ZONE " . $db->quote($cachedTz));
                }
            } catch (Throwable $e) {
            }
        }

        return $cachedTz;
    }
}

if (!function_exists('refreshDialerTimezone')) {
    function refreshDialerTimezone(?PDO $db = null, ?string $explicitTz = null): string {
        $tz = getDialerTimezone($db, true);
        if (isValidTimezoneId((string)$explicitTz)) {
            $tz = trim((string)$explicitTz);
            @date_default_timezone_set($tz);
            if ($db !== null) {
                try {
                    if ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql') {
                        $db->exec("SET TIME ZONE " . $db->quote($tz));
                    }
                } catch (Throwable $e) {
                }
            }
        }
        return $tz;
    }
}

if (!function_exists('isImmediateScheduleValue')) {
    function isImmediateScheduleValue(?string $raw): bool {
        $s = strtolower(trim((string)$raw));
        return $s === '' || $s === 'immediate' || $s === 'now' || $s === 'asap' || $s === 'none' || $s === '-';
    }
}

if (!function_exists('formatCanonicalCallTime')) {
    function formatCanonicalCallTime(int $ts, string $tz = ''): string {
        $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
        try {
            $dt = (new DateTimeImmutable('@' . $ts))->setTimezone(new DateTimeZone($resolvedTz));
            return $dt->format('Y-m-d h:i:s A');
        } catch (Throwable $e) {
            return date('Y-m-d h:i:s A', $ts);
        }
    }
}

if (!function_exists('parseDbTimestamp')) {
    function parseDbTimestamp(?string $rawTs, string $tz = '', bool $isSqlite = false): ?int {
        $s = trim((string)$rawTs);
        if ($s === '') {
            return null;
        }
        $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
        try {
            if (preg_match('/(Z|[+-]\d{2}(?::?\d{2})?)$/i', $s)) {
                return (new DateTimeImmutable($s))->getTimestamp();
            }
            $tzObj = new DateTimeZone($isSqlite ? 'UTC' : $resolvedTz);
            return (new DateTimeImmutable($s, $tzObj))->getTimestamp();
        } catch (Throwable $e) {
            return null;
        }
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
 * - Textual dates (Oct 26, 2026 08:05 AM, May 15, 02:30 PM, 26-Oct-2026)
 * - Time only (08:05 AM, 14:30, Today, 08:05 AM, Tomorrow, 09:00 AM)
 * - Relative offsets (+5 mins, +1 hour)
 */
if (!function_exists('parseAnyDateTime')) {
function parseAnyDateTime(string $raw, string $tz = '', ?string $anchorCreatedAt = null, bool $isSqlite = false, ?int $referenceNow = null): ?int {
    $s = trim($raw);
    if (isImmediateScheduleValue($s)) {
        return null;
    }

    $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
    $tzObj = new DateTimeZone($resolvedTz);
    $now = $referenceNow ?? time();

    $anchorTs = $anchorCreatedAt ? parseDbTimestamp($anchorCreatedAt, $resolvedTz, $isSqlite) : null;
    $anchorDt = (new DateTimeImmutable('@' . ($anchorTs ?? $now)))->setTimezone($tzObj);
    $anchorDate = $anchorDt->format('Y-m-d');
    $anchorYear = $anchorDt->format('Y');

    // 1. Excel Serial Number (e.g. 46321.336805555555 or 46321 or 0.336805555555)
    // Excel serials represent local wall-clock date/time, so convert directly in $tzObj (no UTC shift).
    if (is_numeric($s)) {
        $num = (float)$s;
        if ($num >= 25569 && $num <= 73415) {
            $days = (int)floor($num);
            $secOfDay = (int)round(($num - $days) * 86400);
            $dt = (new DateTimeImmutable('1899-12-30 00:00:00', $tzObj))
                ->modify("+{$days} days")
                ->modify("+{$secOfDay} seconds");
            return $dt->getTimestamp();
        }
        if ($num > 0 && $num < 1.0) {
            $secOfDay = (int)round($num * 86400);
            $dt = (new DateTimeImmutable("{$anchorDate} 00:00:00", $tzObj))
                ->modify("+{$secOfDay} seconds");
            return $dt->getTimestamp();
        }
    }

    // 2. Relative offset (e.g. "+5 mins", "+10 min", "+1 hour")
    if (preg_match('/^\+(\d+)\s*(?:sec|secs|second|seconds)$/i', $s, $m)) {
        return $now + (int)$m[1];
    }
    if (preg_match('/^\+(\d+)\s*(?:min|mins|minute|minutes)$/i', $s, $m)) {
        return $now + ((int)$m[1] * 60);
    }
    if (preg_match('/^\+(\d+)\s*(?:hr|hrs|hour|hours)$/i', $s, $m)) {
        return $now + ((int)$m[1] * 3600);
    }

    // 3. Explicit ISO-8601 date-time with timezone offset / Z
    if (preg_match('/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}(?::?\d{2})?)$/i', $s)) {
        try {
            return (new DateTimeImmutable($s))->getTimestamp();
        } catch (Throwable $e) {
        }
    }

    // 4. Relative day prefix: "Today, ...", "Tomorrow, ...", "Yesterday, ..." anchored to $anchorDt
    $dayOffset = 0;
    $hasRelPrefix = false;
    $clean = $s;
    if (preg_match('/^(today|tomorrow|yesterday)\b[,\s]*(?:at\s*)?(.*)$/i', $s, $m)) {
        $hasRelPrefix = true;
        $kw = strtolower($m[1]);
        if ($kw === 'tomorrow') $dayOffset = 1;
        elseif ($kw === 'yesterday') $dayOffset = -1;
        $clean = trim($m[2]);
    }
    $clean = trim(preg_replace('/\s+at\s+/i', ' ', $clean));
    $clean = trim(preg_replace('/^(?:today|tomorrow|yesterday),?\s*/i', '', $clean));

    $relBaseDt = $dayOffset !== 0 ? $anchorDt->modify(($dayOffset > 0 ? '+' : '') . $dayOffset . ' days') : $anchorDt;
    $relDate = $relBaseDt->format('Y-m-d');

    if ($hasRelPrefix && $clean === '') {
        return (new DateTimeImmutable("{$relDate} 09:00:00", $tzObj))->getTimestamp();
    }

    // 5. Time-only format: "08:05 AM", "8:05:30 PM", "14:30", "08:05:00"
    if (preg_match('/^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(AM|PM)?$/i', $clean, $m)) {
        $hr = (int)$m[1];
        $mn = (int)$m[2];
        $sc = isset($m[3]) && $m[3] !== '' ? (int)$m[3] : 0;
        $ampm = !empty($m[4]) ? strtoupper($m[4]) : '';
        if ($ampm !== '') {
            if ($ampm === 'PM' && $hr < 12) $hr += 12;
            elseif ($ampm === 'AM' && $hr === 12) $hr = 0;
        }
        if ($hr >= 0 && $hr <= 23 && $mn >= 0 && $mn <= 59 && $sc >= 0 && $sc <= 59) {
            try {
                $dt = new DateTimeImmutable(sprintf('%s %02d:%02d:%02d', $relDate, $hr, $mn, $sc), $tzObj);
                return $dt->getTimestamp();
            } catch (Throwable $e) {
            }
        }
    }

    // 6. YYYY-MM-DD or YYYY/MM/DD with optional time & AM/PM
    if (preg_match('/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T,\s]+(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(AM|PM)?)?$/i', $clean, $m)) {
        $y = (int)$m[1];
        $mo = (int)$m[2];
        $d = (int)$m[3];
        if (checkdate($mo, $d, $y)) {
            $hr = isset($m[4]) && $m[4] !== '' ? (int)$m[4] : 0;
            $mn = isset($m[5]) && $m[5] !== '' ? (int)$m[5] : 0;
            $sc = isset($m[6]) && $m[6] !== '' ? (int)$m[6] : 0;
            $ampm = !empty($m[7]) ? strtoupper($m[7]) : '';
            if ($ampm !== '') {
                if ($ampm === 'PM' && $hr < 12) $hr += 12;
                elseif ($ampm === 'AM' && $hr === 12) $hr = 0;
            }
            if ($hr >= 0 && $hr <= 23 && $mn >= 0 && $mn <= 59 && $sc >= 0 && $sc <= 59) {
                try {
                    return (new DateTimeImmutable(sprintf('%04d-%02d-%02d %02d:%02d:%02d', $y, $mo, $d, $hr, $mn, $sc), $tzObj))->getTimestamp();
                } catch (Throwable $e) {
                }
            }
        }
    }

    // 7. European / African Date format: DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
    if (preg_match('/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})(?:[,\s]+(.*))?$/', $clean, $m)) {
        $p1 = (int)$m[1];
        $p2 = (int)$m[2];
        $y = (int)$m[3];
        $rest = trim($m[4] ?? '');
        // Default to DD/MM/YYYY if valid day/month, else fall back to MM/DD/YYYY
        if ($p2 >= 1 && $p2 <= 12 && checkdate($p2, $p1, $y)) {
            $d = $p1; $mo = $p2;
        } elseif ($p1 >= 1 && $p1 <= 12 && checkdate($p1, $p2, $y)) {
            $mo = $p1; $d = $p2;
        } else {
            $d = 0; $mo = 0;
        }
        if ($d > 0) {
            $timeSuffix = $rest !== '' ? $rest : '00:00:00';
            try {
                return (new DateTimeImmutable(sprintf('%04d-%02d-%02d %s', $y, $mo, $d, $timeSuffix), $tzObj))->getTimestamp();
            } catch (Throwable $e) {
            }
        }
    }

    // 8. Textual month WITHOUT year (e.g. "May 15, 02:30 PM") - attach anchor year!
    $candidateText = $clean;
    if (preg_match('/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,|\s+)(?!\d{4}\b)(.+)$/i', $candidateText, $m)) {
        $candidateText = $m[1] . ' ' . preg_replace('/^([A-Za-z]+\s+\d{1,2})(?:st|nd|rd|th)?/', '$1', explode(',', $candidateText)[0]);
        // Simpler safe rewrite: insert anchorYear right after day number
        $candidateText = preg_replace('/^([A-Za-z]+\s+\d{1,2})(?:st|nd|rd|th)?[,\s]+(.+)$/i', '$1 ' . $anchorYear . ' $2', $clean);
    }

    // 9. General DateTimeImmutable fallback in $tzObj
    try {
        $dt = new DateTimeImmutable($candidateText, $tzObj);
        if ($hasRelPrefix && $dayOffset !== 0) {
            $dt = $dt->modify(($dayOffset > 0 ? '+' : '') . $dayOffset . ' days');
        }
        $yr = (int)$dt->format('Y');
        if ($yr >= 2020 && $yr <= 2100) {
            return $dt->getTimestamp();
        }
    } catch (Throwable $e) {
    }

    return null;
}
}

if (!function_exists('extractLeadDate')) {
function extractLeadDate(?string $callTime, ?string $createdAt = null, string $tz = '', bool $isSqlite = false): string {
    $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
    $tzObj = new DateTimeZone($resolvedTz);

    $raw = trim((string)$callTime);
    if (!isImmediateScheduleValue($raw)) {
        $parsedTs = parseAnyDateTime($raw, $resolvedTz, $createdAt, $isSqlite);
        if ($parsedTs !== null) {
            return (new DateTimeImmutable('@' . $parsedTs))->setTimezone($tzObj)->format('Y-m-d');
        }
    }

    $createdTs = $createdAt ? parseDbTimestamp($createdAt, $resolvedTz, $isSqlite) : null;
    if ($createdTs !== null) {
        return (new DateTimeImmutable('@' . $createdTs))->setTimezone($tzObj)->format('Y-m-d');
    }

    return (new DateTimeImmutable('now', $tzObj))->format('Y-m-d');
}
}

if (!function_exists('isLeadFromPastDay')) {
function isLeadFromPastDay(?string $callTime, ?string $createdAt = null, string $tz = '', bool $isSqlite = false): bool {
    $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
    $tzObj = new DateTimeZone($resolvedTz);
    $today = (new DateTimeImmutable('now', $tzObj))->format('Y-m-d');
    $effDate = extractLeadDate($callTime, $createdAt, $resolvedTz, $isSqlite);
    return $effDate < $today;
}
}

if (!function_exists('isLeadDateTimePassed')) {
function isLeadDateTimePassed(?string $callTime, ?string $createdAt = null, int $graceSeconds = 60, string $tz = '', bool $isSqlite = false): bool {
    $raw = trim((string)$callTime);
    if (isImmediateScheduleValue($raw)) {
        return false;
    }
    $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
    $ts = parseAnyDateTime($raw, $resolvedTz, $createdAt, $isSqlite);
    if ($ts === null) {
        return false;
    }
    return (time() - $ts) >= max(0, $graceSeconds);
}
}


/**
 * Normalizes user-submitted scheduled time string to canonical "YYYY-MM-DD hh:i:s AM/PM" or "Immediate"
 */
if (!function_exists('normalizeScheduledTime')) {
function normalizeScheduledTime(string $raw, string $tz = '', ?string $anchorCreatedAt = null, bool $isSqlite = false): string {
    $s = trim($raw);
    if (isImmediateScheduleValue($s)) {
        return 'Immediate';
    }

    $resolvedTz = isValidTimezoneId($tz) ? $tz : getDialerTimezone();
    $ts = parseAnyDateTime($s, $resolvedTz, $anchorCreatedAt, $isSqlite);
    if ($ts !== null && $ts > 0) {
        return formatCanonicalCallTime($ts, $resolvedTz);
    }

    return $s;
}
}

/**
 * Intelligent System Auto-Scheduler
 * Computes scheduled timestamps for a batch of contacts starting at schedule_start_time or server now.
 */
if (!function_exists('calculateSystemAutoSchedules')) {
function calculateSystemAutoSchedules(PDO $db, int $campaignId, int $count, array $override = []): array {
    if ($count <= 0) return [];

    // Always prefer canonical DB/server timezone over potentially skewed browser timezone
    $tz = getDialerTimezone($db);
    if (!isValidTimezoneId($tz) && !empty($override['client_timezone']) && isValidTimezoneId((string)$override['client_timezone'])) {
        $tz = trim((string)$override['client_timezone']);
    }
    $tzObj = new DateTimeZone($tz);
    @date_default_timezone_set($tz);

    $isSqlite = false;
    try {
        $isSqlite = ($db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite');
    } catch (Throwable $e) {
    }

    $camp = [];
    try {
        $stmt = $db->prepare("SELECT * FROM campaigns WHERE id = ?");
        $stmt->execute([$campaignId]);
        $camp = $stmt->fetch() ?: [];
    } catch (Exception $e) {}

    $strategy = trim((string)($override['schedule_strategy'] ?? $camp['schedule_strategy'] ?? 'interval'));
    if ($strategy === 'auto_schedule' || $strategy === 'scheduled_date') {
        $strategy = 'interval';
    }
    $intervalMins = (int)($override['schedule_interval_mins'] ?? $camp['schedule_interval_mins'] ?? 2);
    if ($intervalMins <= 0) $intervalMins = 2;

    $winStart = trim((string)($override['schedule_window_start'] ?? $camp['schedule_window_start'] ?? '09:00')) ?: '09:00';
    $winEnd = trim((string)($override['schedule_window_end'] ?? $camp['schedule_window_end'] ?? '17:00')) ?: '17:00';
    $batchSize = (int)($override['schedule_batch_size'] ?? $camp['schedule_batch_size'] ?? 5);
    if ($batchSize <= 0) $batchSize = 5;

    // Authoritative server clock for schedule generation & dispatch parity
    $now = isset($override['__test_now_ts']) ? (int)$override['__test_now_ts'] : time();
    $todayDate = (new DateTimeImmutable('@' . $now))->setTimezone($tzObj)->format('Y-m-d');

    $baseTs = $now;
    $includeZeroSlot = false;

    $startTimeRaw = trim((string)($override['schedule_start_time'] ?? $camp['schedule_start_time'] ?? 'now'));
    if (!isImmediateScheduleValue($startTimeRaw)) {
        $parsedStartTs = parseAnyDateTime($startTimeRaw, $tz, null, $isSqlite, $now);
        if ($parsedStartTs !== null && $parsedStartTs > $now) {
            $baseTs = $parsedStartTs;
            $includeZeroSlot = true;
        }
    }

    // If append_queue is requested, append strictly AFTER the latest future pending scheduled lead
    if (!empty($override['append_queue'])) {
        try {
            $stmtPending = $db->prepare("SELECT call_time, created_at FROM leads WHERE campaign_id = ? AND status = 'pending' AND call_time IS NOT NULL AND LOWER(TRIM(call_time)) NOT IN ('', 'immediate', 'now', 'asap')");
            $stmtPending->execute([$campaignId]);
            $rowsPending = $stmtPending->fetchAll(PDO::FETCH_ASSOC);

            $latestPendingTs = 0;
            foreach ($rowsPending as $rp) {
                $ts = parseAnyDateTime((string)($rp['call_time'] ?? ''), $tz, $rp['created_at'] ?? null, $isSqlite, $now);
                if ($ts !== null && $ts > $latestPendingTs) {
                    $latestPendingTs = $ts;
                }
            }

            if ($latestPendingTs > $baseTs) {
                $baseTs = $latestPendingTs;
                $includeZeroSlot = false;
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

        $baseDt = (new DateTimeImmutable('@' . $baseTs))->setTimezone($tzObj);
        $curH = (int)$baseDt->format('G');
        $curM = (int)$baseDt->format('i');
        $curTotalMin = $curH * 60 + $curM;
        $startTotalMin = $startH * 60 + $startM;
        $endTotalMin = $endH * 60 + $endM;

        if ($curTotalMin < $startTotalMin) {
            $cursorTs = (new DateTimeImmutable($baseDt->format('Y-m-d') . sprintf(' %02d:%02d:00', $startH, $startM), $tzObj))->getTimestamp();
        } else {
            $cursorTs = $includeZeroSlot ? $baseTs : ($baseTs + 30);
        }

        $slotIntervalSecs = 60;
        $lineCounter = 0;
        // Extend evening calling window up to 21:00 unless user configured a later end time
        $effectiveDayEnd = max($endTotalMin, 21 * 60);

        for ($i = 0; $i < $count; $i++) {
            $cursorDt = (new DateTimeImmutable('@' . $cursorTs))->setTimezone($tzObj);
            if ((int)$cursorDt->format('w') === 0) {
                $nextDayDt = $cursorDt->modify('+1 day');
                $cursorTs = (new DateTimeImmutable($nextDayDt->format('Y-m-d') . sprintf(' %02d:%02d:00', $startH, $startM), $tzObj))->getTimestamp();
                $cursorDt = (new DateTimeImmutable('@' . $cursorTs))->setTimezone($tzObj);
            }

            $dayDate = $cursorDt->format('Y-m-d');
            $dayEndTs = (new DateTimeImmutable($dayDate . sprintf(' %02d:%02d:00', intdiv($effectiveDayEnd, 60), $effectiveDayEnd % 60), $tzObj))->getTimestamp();
            if ($cursorTs >= $dayEndTs) {
                $nextDayDt = $cursorDt->modify('+1 day');
                if ((int)$nextDayDt->format('w') === 0) {
                    $nextDayDt = $nextDayDt->modify('+1 day');
                }
                $cursorTs = (new DateTimeImmutable($nextDayDt->format('Y-m-d') . sprintf(' %02d:%02d:00', $startH, $startM), $tzObj))->getTimestamp();
            }

            $schedules[] = formatCanonicalCallTime($cursorTs, $tz);

            $lineCounter++;
            if ($lineCounter >= $lines) {
                $lineCounter = 0;
                $cursorTs += $slotIntervalSecs;
            }
        }
    } elseif ($strategy === 'window') {
        $baseDt = (new DateTimeImmutable('@' . $baseTs))->setTimezone($tzObj);
        $targetDate = $baseDt->format('Y-m-d');
        $startWindowTs = (new DateTimeImmutable("{$targetDate} {$winStart}:00", $tzObj))->getTimestamp();
        $endWindowTs = (new DateTimeImmutable("{$targetDate} {$winEnd}:00", $tzObj))->getTimestamp();
        if ($endWindowTs <= $startWindowTs) {
            $endWindowTs = $startWindowTs + 3600;
        }

        if ($baseTs > $endWindowTs) {
            $nextDate = $baseDt->modify('+1 day')->format('Y-m-d');
            $startWindowTs = (new DateTimeImmutable("{$nextDate} {$winStart}:00", $tzObj))->getTimestamp();
            $endWindowTs = (new DateTimeImmutable("{$nextDate} {$winEnd}:00", $tzObj))->getTimestamp();
        } elseif ($baseTs > $startWindowTs) {
            $startWindowTs = $baseTs;
        }

        $windowDuration = max(60, $endWindowTs - $startWindowTs);
        $step = ($count > 1) ? floor($windowDuration / $count) : 0;

        for ($i = 0; $i < $count; $i++) {
            $ts = (int)round($startWindowTs + ($i * $step));
            $schedules[] = formatCanonicalCallTime($ts, $tz);
        }
    } elseif ($strategy === 'batch') {
        for ($i = 0; $i < $count; $i++) {
            $batchIdx = intdiv($i, $batchSize);
            $step = $includeZeroSlot ? $batchIdx : ($batchIdx + 1);
            $ts = $baseTs + ($step * $intervalMins * 60);
            $schedules[] = formatCanonicalCallTime($ts, $tz);
        }
    } else {
        // Interval Staggering: wait $intervalMins before first slot (or start directly at explicit future start time)
        for ($i = 0; $i < $count; $i++) {
            $step = $includeZeroSlot ? $i : ($i + 1);
            $ts = $baseTs + ($step * $intervalMins * 60);
            $schedules[] = formatCanonicalCallTime($ts, $tz);
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