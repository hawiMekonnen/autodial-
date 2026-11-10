<?php
/**
 * SkyConnect - Automated Outbound Voice Dialer
 * Authentication
 */

if (session_status() === PHP_SESSION_NONE) {
    session_set_cookie_params([
        'httponly' => true,
        'samesite' => 'Lax'
    ]);
    session_start();
}

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');

// If already authenticated, redirect to dialer dashboard
if (!empty($_SESSION['dialer_user'])) {
    header("Location: index.php");
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $rawUsername = trim($_POST['username'] ?? '');
    $password = trim($_POST['password'] ?? '');

    $parts = explode('@', $rawUsername);
    $username = trim($parts[0]);

    if ($username === '') {
        $error = 'Please enter your username.';
    } else {
        require_once __DIR__ . '/data/db.php';
        $db = DialerDB::getInstance()->getPdo();

        $stmt = $db->prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)");
        $stmt->execute([$username]);
        $user = $stmt->fetch();

        // Authenticate verified user credentials
        if ($user && password_verify($password, $user['password_hash'])) {
            unset($user['password_hash']);
            session_regenerate_id(true);
            $_SESSION['dialer_user'] = $user;
            $_SESSION['authorized'] = true;
            $_SESSION['username'] = $user['username'];
            $_SESSION['role'] = $user['role'] ?? 'admin';
            header("Location: index.php");
            exit;
        } else {
            usleep(250000); // 250ms brute force delay
            $error = 'Invalid username or password. Please try again.';
        }
    }
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkyConnect - Automated Voice Dialer</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: #f1f3f5;
      padding: 20px;
    }
    .login-card {
      width: 100%;
      max-width: 390px;
      background: #ffffff;
      border-radius: 8px;
      padding: 40px 32px 36px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      text-align: center;
      border: 1px solid #e9ecef;
    }
    .logo-wrap {
      margin-bottom: 14px;
      display: flex;
      justify-content: center;
      align-items: center;
    }
    .logo-img {
      width: 160px;
      height: auto;
      object-fit: contain;
    }
    .brand-title {
      color: #0c3629;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.2px;
      margin-bottom: 3px;
    }
    .brand-sub {
      color: #718096;
      font-size: 13px;
      margin-bottom: 26px;
    }
    .error-box {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #dc2626;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 18px;
      text-align: left;
      font-weight: 500;
    }
    .form-group {
      margin-bottom: 14px;
      text-align: left;
    }
    .input-field {
      width: 100%;
      padding: 12px 14px;
      font-size: 14px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      outline: none;
      transition: all 0.2s ease;
      background: #ffffff;
      color: #1e293b;
      text-align: center;
    }
    .input-field:focus {
      border-color: #00A651;
      box-shadow: 0 0 0 3px rgba(0, 166, 81, 0.15);
    }
    .input-field::placeholder {
      color: #94a3b8;
      text-align: center;
    }
    .btn-login {
      width: 100%;
      padding: 12px;
      background: #00A651;
      color: #ffffff;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.5px;
      cursor: pointer;
      margin-top: 6px;
      transition: background 0.15s ease, box-shadow 0.15s ease;
      box-shadow: 0 4px 12px rgba(0, 166, 81, 0.25);
    }
    .btn-login:hover {
      background: #008a43;
      box-shadow: 0 6px 16px rgba(0, 166, 81, 0.35);
    }
  </style>
</head>
<body>

<div class="login-card">
  <div class="logo-wrap">
    <?php if (file_exists(__DIR__ . '/assets/images/skyconnect_full_logo.png')): ?>
      <img src="assets/images/skyconnect_full_logo.png" alt="SkyConnect" class="logo-img">
    <?php elseif (file_exists(__DIR__ . '/assets/images/logo_login.png')): ?>
      <img src="assets/images/logo_login.png" alt="SkyConnect" class="logo-img">
    <?php else: ?>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#00A651" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
      </svg>
    <?php endif; ?>
  </div>

  <div class="brand-title">SkyConnect</div>
  <div class="brand-sub">Automated Voice Dialer</div>

  <?php if ($error): ?>
    <div class="error-box">
      <?php echo htmlspecialchars($error); ?>
    </div>
  <?php endif; ?>

  <form method="POST" action="login.php" autocomplete="off">
    <div class="form-group">
      <input type="text" class="input-field" id="username" name="username" placeholder="Username" required autofocus autocomplete="off" value="<?php echo htmlspecialchars($rawUsername ?? ''); ?>">
    </div>

    <div class="form-group">
      <input type="password" class="input-field" id="password" name="password" placeholder="Password" required autocomplete="new-password">
    </div>

    <button type="submit" class="btn-login">
      LOG IN
    </button>
  </form>
</div>

</body>
</html>
