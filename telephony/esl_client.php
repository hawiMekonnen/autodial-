<?php
/**
 * SkyKin FreeSWITCH Event Socket (ESL) Client
 * Handles outbound originate commands and IVR bridging.
 */

class ESLClient {
    private $host;
    private $port;
    private $password;
    private $timeout;
    private $socket = null;
    private $authenticated = false;
    private $last_error = '';

    public function __construct($host = '127.0.0.1', $port = 8021, $password = 'ClueCon', $timeout = 3) {
        $this->host = $host;
        $this->port = (int)$port;
        $this->password = $password;
        $this->timeout = (float)$timeout;
    }

    public static function fromEnv(): self {
        $env_file = __DIR__ . '/../../cc-test/.env';
        $host = '127.0.0.1';
        $port = 8021;
        $pass = 'ClueCon';

        if (file_exists($env_file)) {
            $lines = file($env_file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach ($lines as $line) {
                $line = trim($line);
                if (empty($line) || $line[0] === '#') continue;
                if (strpos($line, '=') !== false) {
                    list($k, $v) = explode('=', $line, 2);
                    $k = trim($k);
                    $v = trim($v, " \t\n\r\0\x0B\"'");
                    if ($k === 'ESL_HOST') $host = $v;
                    if ($k === 'ESL_PORT') $port = (int)$v;
                    if ($k === 'ESL_PASSWORD') $pass = $v;
                }
            }
        }
        return new self($host, $port, $pass);
    }

    public function connect(): bool {
        $this->last_error = '';
        $errNo = 0;
        $errStr = '';
        
        $this->socket = @fsockopen($this->host, $this->port, $errNo, $errStr, $this->timeout);
        if (!$this->socket) {
            $this->last_error = "Socket connection failed ($errNo): $errStr";
            return false;
        }

        stream_set_timeout($this->socket, (int)$this->timeout, (int)(($this->timeout - floor($this->timeout)) * 1000000));

        // Read auth challenge
        $response = $this->readResponse();
        if (strpos($response, 'auth/request') === false) {
            $this->last_error = "Unexpected banner: " . substr($response, 0, 100);
            $this->disconnect();
            return false;
        }

        // Send auth password
        $auth_cmd = "auth {$this->password}\n\n";
        fwrite($this->socket, $auth_cmd);
        $auth_resp = $this->readResponse();

        if (strpos($auth_resp, '+OK accepted') !== false) {
            $this->authenticated = true;
            return true;
        } else {
            $this->last_error = "Authentication rejected by FreeSWITCH.";
            $this->disconnect();
            return false;
        }
    }

    public function disconnect() {
        if ($this->socket) {
            @fwrite($this->socket, "exit\n\n");
            @fclose($this->socket);
            $this->socket = null;
        }
        $this->authenticated = false;
    }

    public function sendCommand(string $command): string {
        if (!$this->socket || !$this->authenticated) {
            if (!$this->connect()) {
                return "-ERR " . $this->last_error;
            }
        }

        $cmd = "api " . trim($command) . "\n\n";
        fwrite($this->socket, $cmd);
        return $this->readResponse();
    }

    public function sendBgCommand(string $command): string {
        if (!$this->socket || !$this->authenticated) {
            if (!$this->connect()) {
                return "-ERR " . $this->last_error;
            }
        }

        $cmd = "bgapi " . trim($command) . "\n\n";
        fwrite($this->socket, $cmd);
        return $this->readResponse();
    }

    /**
     * Originate outbound call and bridge to IVR upon answer
     */
    public function originateOutboundCall(
        string $phoneNumber,
        string $ivrDestination, // e.g. '&playback(/sounds/welcome.wav)' or '&ivr(main_menu)'
        string $callerIdNumber = '0000000000',
        string $callerIdName = 'SkyKin Dialer',
        string $domain = 'localhost',
        int $timeoutSec = 30
    ): array {
        if (!$this->socket && !$this->connect()) {
            return [
                'success' => false,
                'error' => $this->last_error,
                'mode' => 'esl_offline'
            ];
        }

        $channel_vars = [
            'ignore_early_media=true',
            'originate_timeout=' . $timeoutSec,
            'origination_number=' . $phoneNumber,
            'origination_caller_id_name="' . addslashes($callerIdName) . '"',
            'origination_caller_id_number=' . $callerIdNumber,
            'domain_name=' . $domain,
            'skykin_auto_dialer=true'
        ];
        $var_string = '{' . implode(',', $channel_vars) . '}';
        $origination_url = $var_string . "loopback/{$phoneNumber}/{$domain}";

        // Command format: bgapi originate <origination_url> <app_or_dest>
        $cmd = "originate {$origination_url} {$ivrDestination}";
        $resp = $this->sendBgCommand($cmd);

        $success = (strpos($resp, '+OK') !== false || strpos($resp, 'Job-UUID') !== false);
        return [
            'success' => $success,
            'raw_response' => trim($resp),
            'command' => $cmd
        ];
    }

    private function readResponse(): string {
        $buffer = '';
        while ($this->socket && !feof($this->socket)) {
            $line = fgets($this->socket, 2048);
            if ($line === false) break;
            $buffer .= $line;
            if ($line === "\n" || $line === "\r\n") {
                // Header finished
                if (preg_match('/Content-Length:\s*(\d+)/i', $buffer, $matches)) {
                    $length = (int)$matches[1];
                    $body = '';
                    $bytesRead = 0;
                    while ($bytesRead < $length && !feof($this->socket)) {
                        $chunk = fread($this->socket, min(1024, $length - $bytesRead));
                        if ($chunk === false) break;
                        $body .= $chunk;
                        $bytesRead += strlen($chunk);
                    }
                    $buffer .= $body;
                }
                break;
            }
        }
        return $buffer;
    }

    public function getLastError(): string {
        return $this->last_error;
    }
}
