<?php
/**
 * SkyKin Technologies - Automatic Outbound Dialer
 * Clean, high-performance interface with Human Voice IVR & Scheduled Call Times
 */
session_start();

require_once __DIR__ . '/data/db.php';
$db = DialerDB::getInstance()->getPdo();

if (!empty($_SESSION['dialer_user']['id'])) {
    $stmt = $db->prepare("SELECT * FROM users WHERE id = ?");
    $stmt->execute([(int)$_SESSION['dialer_user']['id']]);
    $dbUser = $stmt->fetch();
    if ($dbUser) {
        unset($dbUser['password_hash']);
        $_SESSION['dialer_user'] = $dbUser;
    }
} elseif (!empty($_SESSION['username'])) {
    $stmt = $db->prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)");
    $stmt->execute([$_SESSION['username']]);
    $dbUser = $stmt->fetch();
    if ($dbUser) {
        unset($dbUser['password_hash']);
        $_SESSION['dialer_user'] = $dbUser;
    }
}

if (empty($_SESSION['dialer_user'])) {
    if (empty($_SESSION['authorized'])) {
        header("Location: login.php");
        exit;
    }
}

$currentUser   = $_SESSION['dialer_user'] ?? [
    'username' => 'Agent1',
    'full_name' => 'Agent 1',
    'extension' => '101',
    'domain' => 'client1.skykin.local'
];
$raw_name      = $currentUser['full_name'] ?? $currentUser['username'] ?? 'Agent 1';
$clean_name    = trim(preg_replace('/\s*\(Abebe\)/i', '', $raw_name));
$agent_name    = htmlspecialchars(!empty($clean_name) ? $clean_name : 'Agent 1');
$domain        = htmlspecialchars($currentUser['domain'] ?? 'client1.skykin.local');
$agent_ext     = htmlspecialchars($currentUser['sip_extension'] ?? $currentUser['extension'] ?? '101');
$agent_pass    = htmlspecialchars($currentUser['sip_password'] ?? '1234');
$agent_ext2    = htmlspecialchars($currentUser['sip_extension2'] ?? '102');
$agent_pass2   = htmlspecialchars($currentUser['sip_password2'] ?? '1234');
$line2_enabled = isset($currentUser['line2_enabled']) ? (int)$currentUser['line2_enabled'] : 1;
$agent_server  = htmlspecialchars($currentUser['sip_server'] ?? 'webcc.skyconnectsolutions.et');
$agent_port    = htmlspecialchars($currentUser['sip_port'] ?? '443');
$agent_domain  = htmlspecialchars($currentUser['sip_domain'] ?? $domain);
$initials      = strtoupper(substr($currentUser['username'] ?? 'A', 0, 2));
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SkyKin Technologies - Automatic Outbound Dialer</title>
  <link rel="stylesheet" href="assets/css/dialer.css">
</head>
<body>

  <!-- ── SkyKin Top Header ───────────────────────────────── -->
  <div class="header">
    <div style="display:flex;align-items:center;gap:12px">
      <button class="agent-sidebar-toggle" onclick="toggleSidebarMenu()" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:36px;height:36px;border-radius:8px;font-size:20px;cursor:pointer;line-height:1;flex-shrink:0" title="Toggle Navigation">☰</button>
      <div class="logo" style="cursor:pointer" onclick="switchTab('tabLiveRoom')">
        SKY<span>KIN</span> Technologies <small style="font-size:11px;opacity:0.85;font-weight:400;margin-left:6px;">| Automatic Outbound Dialer</small>
      </div>
    </div>

    <div class="agent-info">
      <div class="agent-avatar"><?php echo $initials; ?></div>
      <div class="agent-text-info">
        <span class="agent-name"><?php echo $agent_name; ?></span>
        <span class="agent-domain"><?php echo $domain; ?></span>
      </div>
    </div>

    <div class="header-right">
      <!-- SIP Phone Status Pill -->
      <div class="header-sip-pill" onclick="openSipSettingsModal()" title="SIP Extension Configuration">
        <div class="sip-dot" id="headerSipDot"></div>
        <span id="headerSipStatusText">Ext: <?php echo $agent_ext; ?> (Connecting)</span>
        <span style="font-size:11px;opacity:0.8;">⚙️</span>
      </div>

      <div class="clock" id="liveClock"></div>

      <!-- Ready / Status Dropdown -->
      <div class="status-drop-wrap">
        <button class="status-drop-btn" id="statusDropBtn" onclick="toggleStatusMenu()">
          <span class="sdot ready" id="statusDot"></span>
          <span id="statusLabel">Ready</span>
          <span style="font-size:10px;opacity:.7;">▼</span>
        </button>
        <div class="status-drop-menu" id="statusDropMenu">
          <div class="s-opt" onclick="setAgentStatus('ready')">
            <span class="opt-dot" style="background:#28a745"></span> Available
          </div>
          <div class="s-opt" onclick="setAgentStatus('idle')">
            <span class="opt-dot" style="background:#64748b"></span> Idle
          </div>
          <div class="s-opt" onclick="setAgentStatus('break')">
            <span class="opt-dot" style="background:#0ea5e9"></span> On Break
          </div>
          <div class="s-opt" onclick="openSipSettingsModal()">
            <span class="opt-dot" style="background:#0047AB"></span> ⚙️ SIP Settings
          </div>
          <div class="s-opt logout" onclick="window.location.href='logout.php'">
            <span class="opt-dot" style="background:#ef4444"></span> Sign Out
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Simplified Clean Sidebar ────────────────────────── -->
  <div id="sidebarMenu">
    <div class="sb-nav">
      <div class="sb-section-label">Navigation</div>
      <button class="sb-item active" id="sbLiveRoom" onclick="switchTab('tabLiveRoom')">Auto-Dialer</button>
      <button class="sb-item" id="sbLeadManager" onclick="switchTab('tabLeadManager')">Lead Manager</button>
      <button class="sb-item" id="sbIVRStudio" onclick="switchTab('tabIVRStudio')">Human IVR Audio</button>
      <button class="sb-item" id="sbUnanswered" onclick="switchTab('tabUnanswered')">Unanswered Leads</button>
      <button class="sb-item" id="sbCallLogs" onclick="switchTab('tabCallLogs')">Call Dispositions</button>
      <button class="sb-item" id="sbCallHistory" onclick="switchTab('tabCallHistory')">Call History</button>
    </div>

    <div class="sb-footer">
      <button class="sb-item phone-settings-btn" onclick="openSipSettingsModal()" style="border:none;background:none;width:100%;text-align:left;cursor:pointer;font-family:inherit;">Phone Settings</button>
      <a class="sb-item signout" href="logout.php">Sign Out</a>
    </div>
  </div>

  <!-- ── Main Content Area ───────────────────────────────── -->
  <div class="main">

    <!-- KPI Summary Grid -->
    <div class="summary-grid">
      <div class="card">
        <div class="card-label">Today's Leads</div>
        <div class="card-value" id="kpiTotalLeads">0</div>
        <div class="card-sub">In today's active list</div>
      </div>
      <div class="card orange">
        <div class="card-label">Today's Pending</div>
        <div class="card-value" id="kpiPendingLeads">0</div>
        <div class="card-sub">Waiting to be dialed today</div>
      </div>
      <div class="card green">
        <div class="card-label">Answered / Completed</div>
        <div class="card-value" id="kpiConnectedLeads">0</div>
        <div class="card-sub">Human IVR audio played</div>
      </div>
      <div class="card teal">
        <div class="card-label">Answer Rate</div>
        <div class="card-value" id="kpiAnswerRate">0%</div>
        <div class="card-sub">Pickup ratio</div>
      </div>
      <div class="card purple">
        <div class="card-label">Avg. Duration</div>
        <div class="card-value" id="kpiAvgDuration">0s</div>
        <div class="card-sub">Per completed call</div>
      </div>
    </div>

    <!-- Main Full Section -->
    <div class="full-section">
      <div class="tab-bar">
        <button class="tab-btn active" id="tabBtnLiveRoom" onclick="switchTab('tabLiveRoom')">Auto-Dialer Dashboard</button>
        <button class="tab-btn" id="tabBtnLeadManager" onclick="switchTab('tabLeadManager')">Today's List (<span id="badgePendingCount">0</span>)</button>
        <button class="tab-btn" id="tabBtnUnanswered" onclick="switchTab('tabUnanswered')">Unanswered (<span id="badgeUnansweredCount">0</span>)</button>
        <button class="tab-btn" id="tabBtnIVRStudio" onclick="switchTab('tabIVRStudio')">Human IVR Audio</button>
        <button class="tab-btn" id="tabBtnCallLogs" onclick="switchTab('tabCallLogs')">Call Logs</button>
        <button class="tab-btn" id="tabBtnCallHistory" onclick="switchTab('tabCallHistory')">History (<span id="badgeHistoryCount">0</span>)</button>
      </div>

      <!-- TAB 1: AUTO-DIALER MAIN DASHBOARD -->
      <div class="tab-panel active" id="tabLiveRoom">
        <div class="control-bar">
          <div class="campaign-title-block">
            <h2>
              <span id="campaignTitleText">Outbound Customer Campaign</span>
              <span id="campaignStatusTag" class="campaign-status-tag idle">IDLE</span>
            </h2>
          </div>

          <div class="control-actions">
            <div class="pacing-controls">
              <div class="pacing-item">
                <label for="pacingDelayInput">Pacing:</label>
                <select id="pacingDelayInput">
                  <option value="1">1s</option>
                  <option value="2" selected>2s</option>
                  <option value="4">4s</option>
                </select>
              </div>
              <div class="pacing-item">
                <label for="maxConcurrentInput">Channels:</label>
                <select id="maxConcurrentInput">
                  <option value="1">1 Line</option>
                  <option value="2" selected>2 Lines</option>
                  <option value="4">4 Lines</option>
                </select>
              </div>
            </div>

            <button id="btnStartCampaign" class="btn btn-success">Start Auto-Dialer</button>
            <button id="btnPauseCampaign" class="btn btn-warning" disabled>Pause</button>
            <button id="btnStopCampaign" class="btn btn-danger" disabled>Stop</button>
            <button id="btnResetLeads" class="btn btn-secondary">Reset Leads</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;">
          <!-- Left: Live Outbound Lines & Queue Table -->
          <div>
            <!-- Active Calling Lines -->
            <div style="background:#fafbfc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:20px;">
              <div style="font-size:12px;font-weight:700;color:#0047AB;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                <span class="live-dot"></span> Active Outbound Lines
              </div>
              <div id="activeChannelsGrid" class="channels-grid">
                <!-- Channels rendered by JS -->
              </div>
            </div>

            <!-- Quick Add Contact Bar -->
            <div class="quick-add-card">
              <div class="quick-add-header">
                <span style="font-weight:700;color:#0047AB;font-size:12.5px;">
                  Quick Add Contact &amp; Schedule Call
                </span>
                <span style="font-size:11px;color:#64748b;">Schedule for today or any future date/time</span>
              </div>
              <form id="formQuickAddLead" class="quick-add-form" onsubmit="app.handleQuickAddSubmit(event)">
                <input type="text" id="quickAddName" class="form-control" placeholder="Name (e.g. Hawi)" required style="flex:1;min-width:120px;">
                <input type="tel" id="quickAddPhone" class="form-control" placeholder="Phone (e.g. 0939777880)" required style="flex:1.2;min-width:140px;">
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
                  <select id="quickAddTimePreset" class="form-control" style="font-size:12px;min-width:125px;" onchange="app.handleTimePresetChange(this.value)">
                    <option value="immediate" selected>Immediate</option>
                    <option value="+2min">+2 Minutes</option>
                    <option value="+5min">+5 Minutes</option>
                    <option value="+10min">+10 Minutes</option>
                    <option value="+30min">+30 Minutes</option>
                    <option value="custom">Custom Date &amp; Time...</option>
                  </select>
                  <input type="date" id="quickAddCustomDate" class="form-control" style="display:none;width:125px;font-size:12px;" title="Scheduled Date">
                  <input type="time" id="quickAddCustomTime" class="form-control" style="display:none;width:105px;font-size:12px;" title="Scheduled Time">
                </div>
                <div style="display:flex;gap:6px;">
                  <button type="submit" class="btn btn-primary btn-sm" style="white-space:nowrap;">Add to Queue</button>
                  <button type="button" class="btn btn-success btn-sm" onclick="app.quickAddAndCall()" style="white-space:nowrap;" title="Add and dial immediately">Call Now</button>
                </div>
              </form>
            </div>

            <!-- Queue Header & Actions -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div style="font-size:14px;font-weight:700;color:#1e293b;">Customer Calling Queue</div>
              <div style="display:flex;gap:8px;">
                <button class="btn btn-primary btn-sm" onclick="app.openModal('modalUpload')">Upload CSV File</button>
                <button class="btn btn-secondary btn-sm" onclick="app.openModal('modalManual')">Bulk Write Numbers</button>
              </div>
            </div>

            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Customer Name</th>
                    <th>Phone Number</th>
                    <th>Scheduled Call Time</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="leadsTableBody">
                  <!-- Leads rendered by JS -->
                </tbody>
              </table>
            </div>
          </div>

          <!-- Right: IVR Audio Box (Human Voice) -->
          <div>
            <div style="background:#fafbfc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-size:13px;font-weight:700;color:#0047AB;">Human IVR Audio</div>
                <button class="btn btn-secondary btn-sm" onclick="app.openModal('modalAudioUpload')">Upload Audio</button>
              </div>
              <p style="font-size:11.5px;color:#64748b;margin-bottom:10px;">
                Plays automatically when customer answers the outbound call:
              </p>

              <div style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px;">Selected Recording:</label>
                <select id="ivrAudioSelector" class="form-control" style="font-size:12.5px;">
                  <!-- Injected by JS -->
                </select>
              </div>

              <div style="background:#ffffff;padding:12px;border-radius:8px;border:1px solid #cbd5e1;margin-bottom:12px;">
                <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:6px;" id="activeAudioTitle">Human Welcome Recording</div>
                <!-- Native Audio Player for Human Voice -->
                <audio id="mainAudioPlayer" controls style="width:100%;height:36px;outline:none;" src="assets/audio/welcome_human_voice.wav"></audio>
              </div>

              <div style="font-size:11.5px;color:#64748b;line-height:1.45;background:#f8fafc;padding:10px;border-radius:6px;border:1px solid #e2e8f0;">
                <strong>Telephony Engine:</strong><br>
                Configured as Agent <strong><?php echo $agent_ext; ?></strong> on <code><?php echo $agent_server; ?></code>.<br>
                When a call is answered, the IVR playback streams through the SIP bridge.
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TAB 2: LEAD MANAGER -->
      <div class="tab-panel" id="tabLeadManager">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <input type="text" id="leadSearchInput" class="form-control" placeholder="Search customer or phone..." style="max-width:300px;">
            <select id="leadStatusFilter" class="form-control" style="max-width:180px;">
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="answered">Answered / Completed</option>
              <option value="busy">Busy / Unreachable</option>
              <option value="no_answer">No Answer</option>
            </select>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="app.openModal('modalSingleAdd')">Quick Add Contact</button>
            <button class="btn btn-secondary" onclick="app.openModal('modalUpload')">Upload CSV File</button>
            <button class="btn btn-secondary" onclick="app.openModal('modalManual')">Bulk Write Numbers</button>
          </div>
        </div>

        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Scheduled Call Time</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="leadsTableBodyFull">
              <!-- Rendered by JS -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 3: HUMAN IVR AUDIO SETTINGS -->
      <div class="tab-panel" id="tabIVRStudio">
        <div style="max-width:750px;margin:0 auto;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
            <div>
              <div style="font-size:16px;font-weight:700;color:#0047AB;">Human IVR Voice Audio Management</div>
              <div style="font-size:12px;color:#64748b;">Manage voice recordings that play automatically when customers answer.</div>
            </div>
            <button class="btn btn-primary" onclick="app.openModal('modalAudioUpload')">Upload New Audio (.wav / .mp3)</button>
          </div>

          <!-- Active Selection Card -->
          <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:16px;margin-bottom:20px;">
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label" style="font-weight:700;color:#1e293b;">Active IVR Audio for Auto-Dialer Calls</label>
              <select class="form-control" id="ivrAudioSelectorTab" onchange="document.getElementById('ivrAudioSelector').value=this.value; app.selectAudioRecording(this.value)">
                <!-- Synced with audio selector -->
              </select>
            </div>

            <div>
              <div style="font-size:12px;font-weight:700;color:#475569;margin-bottom:6px;">Audio Preview:</div>
              <audio id="tabAudioPlayer" controls style="width:100%;height:38px;outline:none;" src="assets/audio/welcome_human_voice.wav"></audio>
            </div>
          </div>

          <!-- All Audio Recordings List -->
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:10px;">All Available Audio Recordings</div>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Recording Title</th>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Preview</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="audioListTableBody">
                <!-- Rendered by JS -->
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- TAB 4: CALL LOGS -->
      <div class="tab-panel" id="tabCallLogs">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:15px;font-weight:700;color:#0047AB;">Campaign Call Logs &amp; Dispositions</div>
          <button id="btnExportLogs" class="btn btn-primary">Export to CSV</button>
        </div>

        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Audio Played</th>
                <th>Scheduled Call Time</th>
              </tr>
            </thead>
            <tbody id="logsTableBody">
              <!-- Rendered by JS -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 5: UNANSWERED LEADS (Did Not Listen to IVR) -->
      <div class="tab-panel" id="tabUnanswered">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#1e293b;">
              Unanswered / Missed Customer Leads
            </div>
            <div style="font-size:12px;color:#64748b;">Customers who did not answer, were busy, or did not listen to the IVR audio.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="app.requeueUnansweredLeads()">
              Re-queue All to Calling Queue
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.exportUnansweredCsv()">
              Export to CSV
            </button>
          </div>
        </div>

        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Reason / Disposition</th>
                <th>Scheduled Call Time</th>
                <th>Last Attempt</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="unansweredTableBody">
              <!-- Rendered by JS -->
            </tbody>
          </table>
        </div>
      </div>

      <!-- TAB 6: CALL HISTORY & PAST RECORDS -->
      <div class="tab-panel" id="tabCallHistory">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#0047AB;display:flex;align-items:center;gap:8px;">
              <span>Call History &amp; Past Days Records</span>
            </div>
            <div style="font-size:12px;color:#64748b;">
              Review previous days' calls, check dispositions, or redial contacts with new dates and times.
            </div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary btn-sm" onclick="app.bulkRolloverRemainingToToday()" id="btnHistoryRollover" title="Move all past unanswered calls into today's queue">
              Roll Over Remaining to Today (<span id="historyRolloverCount">0</span>)
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.exportHistoryCsv()">
              Export CSV
            </button>
          </div>
        </div>

        <!-- Very Simple Frontend Filter Bar -->
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;">
            <div style="display:flex;align-items:center;gap:6px;">
              <label style="font-size:12px;font-weight:700;color:#334155;white-space:nowrap;">Date:</label>
              <select id="historyDateSelect" class="form-control" style="font-size:12.5px;min-width:160px;" onchange="app.handleHistoryDateFilter(this.value)">
                <option value="all">All Past Dates</option>
                <option value="yesterday">Yesterday</option>
              </select>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="date" id="historyCustomDatePicker" class="form-control" style="font-size:12.5px;max-width:145px;" title="Pick specific date" onchange="app.handleHistoryCustomDate(this.value)">
            </div>
            <div style="flex:1;min-width:180px;max-width:300px;">
              <input type="text" id="historySearchInput" class="form-control" placeholder="Search customer or phone..." oninput="app.renderHistoryTable()">
            </div>
            <div style="min-width:150px;">
              <select id="historyStatusFilter" class="form-control" style="font-size:12.5px;" onchange="app.renderHistoryTable()">
                <option value="all">All Dispositions</option>
                <option value="answered">Answered / Completed</option>
                <option value="no_answer">No Answer</option>
                <option value="busy">Busy</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
          </div>
          <div style="background:#e0f2fe;color:#0369a1;padding:4px 12px;border-radius:14px;font-size:11.5px;font-weight:700;white-space:nowrap;" id="historyTotalRecordsTag">0 records</div>
        </div>

        <div class="data-table-wrapper">
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Date</th>
                <th>Customer Name</th>
                <th>Phone Number</th>
                <th>Scheduled Call Time</th>
                <th>Disposition / Status</th>
                <th>Duration</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="historyTableBody">
              <!-- Rendered by JS -->
            </tbody>
          </table>
        </div>
      </div>

    </div>
  </div>

  <!-- ── MODAL: SIP PHONE SETTINGS (Dual Line / 2 Numbers) ── -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal-box" style="max-width:480px;">
      <div class="modal-title" style="font-size:16px;">SIP Phone Settings (Dual Line Configuration)</div>
      
      <!-- Line 1 Section -->
      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:#0047AB;margin-bottom:8px;">Line 1 (Primary SIP Extension)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:11px;color:#475569;">Extension Number</label>
            <input type="text" id="sipExt" placeholder="e.g. 101" value="<?php echo $agent_ext; ?>">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:11px;color:#475569;">SIP Password</label>
            <input type="password" id="sipPass" placeholder="Password" value="<?php echo $agent_pass; ?>">
          </div>
        </div>
      </div>

      <!-- Line 2 Section (Parallel Calling) -->
      <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <div style="font-size:12px;font-weight:700;color:#0284c7;">Line 2 (Secondary SIP Extension - 2 Lines Calling)</div>
          <label style="font-size:11.5px;color:#334155;cursor:pointer;display:flex;align-items:center;gap:4px;">
            <input type="checkbox" id="line2EnabledCheck" <?php echo $line2_enabled ? 'checked' : ''; ?> onchange="document.getElementById('line2FieldsWrap').style.opacity = this.checked ? '1' : '0.5';">
            Enable Line 2
          </label>
        </div>
        <div id="line2FieldsWrap" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;opacity:<?php echo $line2_enabled ? '1' : '0.5'; ?>;">
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:11px;color:#475569;">Extension 2 Number</label>
            <input type="text" id="sipExt2" placeholder="e.g. 102" value="<?php echo $agent_ext2; ?>">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:11px;color:#475569;">SIP Password 2</label>
            <input type="password" id="sipPass2" placeholder="Password" value="<?php echo $agent_pass2; ?>">
          </div>
        </div>
      </div>

      <!-- Server & Network Connection -->
      <div class="form-group" style="margin-bottom:8px;">
        <label style="font-size:11px;color:#475569;">SIP Server (WebSocket / PBX Host)</label>
        <input type="text" id="sipServer" placeholder="e.g. webcc.skyconnectsolutions.et" value="<?php echo $agent_server; ?>">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:10px;">
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:#475569;">WebSocket Port</label>
          <input type="text" id="sipPort" placeholder="443" value="<?php echo $agent_port; ?>">
        </div>
        <div class="form-group" style="margin-bottom:0;">
          <label style="font-size:11px;color:#475569;">Domain / Realm</label>
          <input type="text" id="sipDomain" placeholder="e.g. client1.skykin.local" value="<?php echo $agent_domain; ?>">
        </div>
      </div>

      <div style="display:flex;gap:10px;margin-top:14px;">
        <button type="button" class="btn-save-settings" style="background:#64748b;flex:1;" onclick="closeSipSettingsModal()">Cancel</button>
        <button type="button" class="btn-save-settings" style="flex:2;" onclick="saveSipSettings()">Connect Both Lines</button>
      </div>
    </div>
  </div>

  <!-- ── FLOATING SOFTPHONE BUTTON (FAB) ───────────────────── -->
  <button class="phone-fab" id="phoneFab" onclick="togglePhonePopup()" title="Open Softphone">
    &#128222;
    <span class="fab-badge unreg" id="fabBadge"></span>
  </button>

  <!-- ── SLIDE-OUT SOFTPHONE PANEL (SkyKin Softphone) ───────── -->
  <div class="phone-popup" id="phonePopup">
    <div class="pp-header">
      <div class="pp-status">
        <div class="sip-dot registered" id="sipDot"></div>
        <span id="sipStatusText">Registered (<?php echo $agent_ext; ?>)</span>
      </div>
      <div class="pp-header-actions">
        <button class="btn-settings-header" onclick="openSipSettingsModal()" title="Phone settings" aria-label="Phone settings">&#9881;</button>
        <button class="pp-close" onclick="togglePhonePopup()" title="Close phone panel" aria-label="Close">&#x2715;</button>
      </div>
    </div>

    <div class="pp-body">
      <!-- Active Call Display Banner -->
      <div class="call-active-banner" id="callActiveBanner">
        <div class="call-active-number" id="activeCallNumber">Connecting...</div>
        <div class="call-active-sub" id="activeCallSub">Outbound Call &bull; Human IVR Audio</div>
      </div>

      <!-- Live Call Timer -->
      <div id="callTimer" class="call-timer">00:00</div>

      <!-- In-Call Controls -->
      <div class="call-controls">
        <button class="btn-hangup" id="btnHangup" onclick="hangupManualCall()">&#128222; End Call</button>
        <button class="btn-phone-ctrl" id="btnHold" onclick="toggleManualHold()">⏸️<br>Hold</button>
        <button class="btn-phone-ctrl" id="btnMute" onclick="toggleManualMute()">🎤<br>Mute</button>
        <button class="btn-phone-ctrl" id="btnKeypadToggle" onclick="toggleCallKeypad()">🔢<br>Keypad</button>
      </div>
    </div>

    <!-- Inline Outbound Dial Pad -->
    <div class="dp-panel" id="dpPanel">
      <div class="dp-title">DIAL A NUMBER</div>
      <input type="tel" class="dp-display" id="dialInput" placeholder="Enter number..." maxlength="20" autocomplete="off" inputmode="tel">
      <div class="dp-grid">
        <button class="dp-key" onclick="dpKey('1')">1<span class="dp-sub">&nbsp;</span></button>
        <button class="dp-key" onclick="dpKey('2')">2<span class="dp-sub">ABC</span></button>
        <button class="dp-key" onclick="dpKey('3')">3<span class="dp-sub">DEF</span></button>
        <button class="dp-key" onclick="dpKey('4')">4<span class="dp-sub">GHI</span></button>
        <button class="dp-key" onclick="dpKey('5')">5<span class="dp-sub">JKL</span></button>
        <button class="dp-key" onclick="dpKey('6')">6<span class="dp-sub">MNO</span></button>
        <button class="dp-key" onclick="dpKey('7')">7<span class="dp-sub">PQRS</span></button>
        <button class="dp-key" onclick="dpKey('8')">8<span class="dp-sub">TUV</span></button>
        <button class="dp-key" onclick="dpKey('9')">9<span class="dp-sub">WXYZ</span></button>
        <button class="dp-key" onclick="dpKey('*')">*<span class="dp-sub">&nbsp;</span></button>
        <button class="dp-key" onclick="dpKey('0')">0<span class="dp-sub">+</span></button>
        <button class="dp-key" onclick="dpKey('#')">#<span class="dp-sub">&nbsp;</span></button>
      </div>
      <div class="dp-row-actions">
        <button class="dp-recent" type="button" onclick="fillRecentNumber()">Recent</button>
        <button class="dp-call" onclick="dpCall()" title="Start call">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56a.977.977 0 00-1.01.24l-2.2 2.2a15.053 15.053 0 01-6.59-6.59l2.2-2.21a.96.96 0 00.25-1A11.36 11.36 0 018.5 3.99c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.5c0-.55-.45-1-1-1z"/></svg>
        </button>
        <button class="dp-del" onclick="dpDelete()" title="Delete last digit" aria-label="Delete last digit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"></path><line x1="18" y1="9" x2="12" y2="15"></line><line x1="12" y1="9" x2="18" y2="15"></line></svg>
        </button>
      </div>
    </div>
  </div>

  <!-- WebRTC Remote Audio Player (Kept completely silent on computer) -->
  <audio id="remoteAudio" autoplay muted style="display:none;"></audio>

  <!-- ── MODAL: QUICK ADD SINGLE CONTACT ────────────────── -->
  <div id="modalSingleAdd" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Quick Add Contact</h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formModalSingleLead" onsubmit="app.handleModalSingleAdd(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Customer Name</label>
            <input type="text" id="modalAddName" class="form-control" placeholder="e.g. Hawi" required>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Phone Number</label>
            <input type="tel" id="modalAddPhone" class="form-control" placeholder="e.g. 0939777880 or +251939777880" required>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Scheduled Call Time &amp; Date</label>
            <select id="modalAddTimePreset" class="form-control" onchange="app.handleModalPresetChange(this.value)">
              <option value="immediate" selected>Immediate</option>
              <option value="+2min">+2 Minutes</option>
              <option value="+5min">+5 Minutes</option>
              <option value="+10min">+10 Minutes</option>
              <option value="+30min">+30 Minutes</option>
              <option value="custom">Custom Date &amp; Time...</option>
            </select>
            <div id="modalCustomDateTimeWrap" style="display:none;margin-top:8px;display:none;gap:8px;">
              <div style="flex:1;">
                <label style="font-size:11px;color:#64748b;margin-bottom:2px;display:block;">Call Date</label>
                <input type="date" id="modalAddCustomDate" class="form-control" style="font-size:12.5px;">
              </div>
              <div style="flex:1;">
                <label style="font-size:11px;color:#64748b;margin-bottom:2px;display:block;">Call Time</label>
                <input type="time" id="modalAddCustomTime" class="form-control" style="font-size:12.5px;">
              </div>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Notes / Tag (Optional)</label>
            <input type="text" id="modalAddNotes" class="form-control" placeholder="e.g. VIP Customer, Delivery Followup">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Add to Queue</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── MODAL: UPLOAD FILE WITH SCHEDULED CALL TIME ─────── -->
  <div id="modalUpload" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Upload Customer File</h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formUploadLeads" onsubmit="app.handleFileUpload(event)">
        <div class="modal-body">
          <p style="font-size:12.5px;color:#64748b;margin-bottom:12px;">
            Select an Excel (.xlsx, .xls) or CSV file with your customer phone numbers to import into the queue.
          </p>
          <div id="dropzoneBox" class="dropzone-box" onclick="document.getElementById('leadFileInput').click()" style="cursor:pointer;">
            <div style="font-weight:700;color:#0047AB;font-size:14px;margin-bottom:4px;">Click or drag and drop Excel / CSV file</div>
            <div style="font-size:11.5px;color:#94a3b8;">Supports Microsoft Excel (.xlsx, .xls), CSV (.csv), TXT (.txt)</div>
            <input type="file" id="leadFileInput" accept=".xlsx,.xls,.csv,.txt,.tsv" style="display:none;" onchange="const f = this.files[0]; if (f) document.getElementById('selectedFileName').textContent = 'Selected: ' + f.name;">
            <div id="selectedFileName" style="margin-top:8px;color:#0047AB;font-weight:700;font-size:12px;"></div>
          </div>
          <div style="margin-top:12px;font-size:11.5px;color:#64748b;background:#f8fafc;padding:8px 12px;border-radius:6px;border:1px solid #e2e8f0;">
            Format: <code>Customer Name, Phone Number, Call Time, Notes</code><br>
            Example: <code>Hawi, 0939777880, 12:00 PM, Verified Lead</code>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Import</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── MODAL: WRITE IN CUSTOMERS ───────────────────────── -->
  <div id="modalManual" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Write in Customers</h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formManualLeads">
        <div class="modal-body">
          <p style="font-size:12px;color:#64748b;margin-bottom:10px;">
            Enter numbers and call times (one per line):
          </p>
          <div class="form-group">
            <textarea id="manualLeadsText" class="form-control" rows="7" placeholder="0939777880, Hawi, 11:30 AM, VIP Customer
0912345678, Customer 2, 11:45 AM, Delivery Followup
+251913456789, Customer 3, 12:00 PM"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-success">Add to Queue</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── MODAL: UPLOAD HUMAN AUDIO RECORDING ────────────── -->
  <div id="modalAudioUpload" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Upload Human Voice Audio Recording</h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formUploadAudio" onsubmit="app.handleAudioUpload(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Audio File (.wav, .mp3, .m4a, .ogg)</label>
            <input type="file" id="audioFileInput" class="form-control" accept="audio/*,.wav,.mp3,.m4a,.ogg,.aac,.flac,.wma" required onchange="if(this.files[0] && !document.getElementById('audioNameInput').value){document.getElementById('audioNameInput').value = this.files[0].name.replace(/\.[^/.]+$/, '');}">
            <div style="font-size:11px;color:#64748b;margin-top:4px;">Recommended: High-quality WAV (16-bit 8kHz/16kHz Mono) or MP3.</div>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Recording Title / Label</label>
            <input type="text" id="audioNameInput" class="form-control" placeholder="e.g. Ethiopian Amharic Welcome Message" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btnUploadAudioSubmit">Upload &amp; Set as Active IVR</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ── MODAL: REDIAL & RESCHEDULE PAST LEAD ────────────── -->
  <div id="modalRedialSchedule" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:440px;">
      <div class="modal-header">
        <h3 style="font-size:16px;">Redial &amp; Schedule Call</h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formModalRedial" onsubmit="app.handleRedialSubmit(event)">
        <input type="hidden" id="redialLeadId">
        <div class="modal-body">
          <div style="background:#f1f5f9;border-radius:8px;padding:12px;margin-bottom:14px;border:1px solid #e2e8f0;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Customer Contact</div>
            <div style="font-size:14px;font-weight:700;color:#0047AB;" id="redialCustomerName">Customer Name</div>
            <div style="font-size:13px;font-weight:600;color:#334155;" id="redialPhoneNumber">+251...</div>
          </div>

          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Select Date</label>
            <input type="date" id="redialDateInput" class="form-control" required style="font-size:13px;">
          </div>

          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">Select Time</label>
            <select id="redialTimePreset" class="form-control" onchange="app.handleRedialPresetChange(this.value)">
              <option value="immediate" selected>Immediate (Dial right away)</option>
              <option value="+2min">+2 Minutes</option>
              <option value="+5min">+5 Minutes</option>
              <option value="+10min">+10 Minutes</option>
              <option value="+30min">+30 Minutes</option>
              <option value="custom">Specific Time...</option>
            </select>
            <input type="time" id="redialCustomTimeInput" class="form-control" style="display:none;margin-top:8px;font-size:13px;" title="Specific Call Time">
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Schedule &amp; Put in List</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Toast Container -->
  <div id="toastContainer" class="toast-container"></div>

  <!-- Global Agent Telephony Config -->
  <script>
  window.AGENT_CONFIG = {
    name:         '<?php echo addslashes($agent_name); ?>',
    username:     '<?php echo addslashes($currentUser['username'] ?? 'Agent1'); ?>',
    ext:          '<?php echo addslashes($agent_ext); ?>',
    pass:         '<?php echo addslashes($agent_pass); ?>',
    ext2:         '<?php echo addslashes($agent_ext2); ?>',
    pass2:        '<?php echo addslashes($agent_pass2); ?>',
    line2Enabled: <?php echo $line2_enabled ? 'true' : 'false'; ?>,
    server:       '<?php echo addslashes($agent_server); ?>',
    port:         '<?php echo addslashes($agent_port); ?>',
    domain:       '<?php echo addslashes($agent_domain); ?>'
  };

  function toggleSidebarMenu() {
    document.getElementById('sidebarMenu').classList.toggle('collapsed');
    document.querySelector('.main').classList.toggle('sidebar-collapsed');
  }

  function toggleStatusMenu() {
    document.getElementById('statusDropMenu').classList.toggle('open');
  }

  function setAgentStatus(st) {
    const label = document.getElementById('statusLabel');
    const dot = document.getElementById('statusDot');
    if (st === 'ready') { label.textContent = 'Ready'; dot.className = 'sdot ready'; }
    else if (st === 'idle') { label.textContent = 'Idle'; dot.className = 'sdot notready'; }
    else if (st === 'break') { label.textContent = 'On Break'; dot.className = 'sdot brk'; }
    document.getElementById('statusDropMenu').classList.remove('open');
  }

  function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

    const tabBtn = document.getElementById('tabBtn' + tabId.replace('tab', ''));
    if (tabBtn) tabBtn.classList.add('active');

    const sbBtn = document.getElementById('sb' + tabId.replace('tab', ''));
    if (sbBtn) sbBtn.classList.add('active');

    const panel = document.getElementById(tabId);
    if (panel) panel.classList.add('active');
  }

  function updateClock() {
    const now = new Date();
    const str = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.textContent = str;
  }
  setInterval(updateClock, 1000);
  updateClock();

  function openSipSettingsModal() {
    document.getElementById('settingsModal').classList.add('show');
    document.getElementById('statusDropMenu').classList.remove('open');
  }

  function closeSipSettingsModal() {
    document.getElementById('settingsModal').classList.remove('show');
  }

  async function saveSipSettings() {
    const ext = document.getElementById('sipExt')?.value.trim() || '';
    const pass = document.getElementById('sipPass')?.value.trim() || '';
    const ext2 = document.getElementById('sipExt2')?.value.trim() || '';
    const pass2 = document.getElementById('sipPass2')?.value.trim() || '';
    const l2Enabled = document.getElementById('line2EnabledCheck')?.checked ? 1 : 0;
    const server = document.getElementById('sipServer')?.value.trim() || '';
    const port = document.getElementById('sipPort')?.value.trim() || '443';
    const dom = document.getElementById('sipDomain')?.value.trim() || '';

    if (!ext || !pass) {
      alert('Line 1 Extension and Password are required.');
      return;
    }

    const formData = new FormData();
    formData.append('sip_extension', ext);
    formData.append('sip_password', pass);
    formData.append('sip_extension2', ext2);
    formData.append('sip_password2', pass2);
    formData.append('line2_enabled', l2Enabled);
    formData.append('sip_server', server);
    formData.append('sip_port', port);
    formData.append('sip_domain', dom);

    try {
      const res = await fetch('api.php?action=save_sip_settings', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        closeSipSettingsModal();
        if (window.app && typeof window.app.reconnectDualSip === 'function') {
          window.app.reconnectDualSip(ext, pass, ext2, pass2, l2Enabled, server, port, dom);
        }
      } else {
        alert(data.error || 'Failed to save settings');
      }
    } catch (e) {
      alert('Error saving SIP settings');
    }
  }
  </script>

  <!-- SIP.js WebRTC Bridge Bundle -->
  <script src="assets/js/sipjs.bundle.js"></script>
  <!-- Main Dialer Application Logic -->
  <script src="assets/js/dialer.js"></script>
</body>
</html>
