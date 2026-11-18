<?php
date_default_timezone_set(getenv('APP_TIMEZONE') ?: 'Africa/Addis_Ababa');
/**
 * SkyConnect Automated Outbound Voice Dialer
 * Clean, high-performance interface with Human Voice IVR & Scheduled Call Times
 */
header("Cache-Control: no-cache, no-store, must-revalidate");
header("Pragma: no-cache");
header("Expires: 0");
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
  <title>SkyConnect &bull; Automated Outbound Voice Dialer</title>
  <link rel="stylesheet" href="assets/css/dialer.css?v=<?= time() ?>">
</head>
<body>

  <!-- ── Left Navigation Sidebar with Brand Logo at Top ──── -->
  <div class="sc-sidebar" id="sidebarMenu">
    <!-- Brand Logo at Top of Sidebar -->
    <div class="sidebar-brand-header" onclick="switchNav('tabCampaigns', 'campaigns')">
      <img src="assets/images/skyconnect_full_logo.png?v=<?= time() ?>" alt="SkyConnect Automated Voice Dialer" class="sidebar-brand-full">
    </div>

    <!-- Hidden compatibility elements to prevent JS errors -->
    <div style="display:none;">
      <span class="sip-dot" id="headerSipDot"></span>
      <span id="headerSipStatusText">Ext: <?php echo $agent_ext; ?> (Standby)</span>
      <button id="statusDropBtn" onclick="toggleStatusMenu()"></button>
      <span class="sdot ready" id="statusDot"></span>
      <span id="statusLabel">Ready</span>
      <div id="statusDropMenu"></div>
      <div id="liveClock"></div>
      <button id="sidebarToggleBtn"></button>
      <span id="headerSectionTitle"></span>
      <span id="topUrlText"></span>
    </div>

    <div class="sc-nav-list" style="padding:10px 0;">
      
      <!-- OPERATE Group -->
      <div class="sc-sidebar-section-title">OPERATE</div>

      <button class="sc-nav-item active" id="sbCampaigns" onclick="app.showVoiceCampaignsView()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          <line x1="2" y1="8" x2="4" y2="8"></line>
          <line x1="20" y1="8" x2="22" y2="8"></line>
        </svg>
        <span>Campaigns</span>
      </button>

      <button class="sc-nav-item" id="sbDialer" onclick="switchNav('tabDialer', 'dialer/agent')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
        </svg>
        <span>Dialer</span>
      </button>

      <button class="sc-nav-item" id="sbCallbacks" onclick="switchNav('tabCallbacks', 'unanswered')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"></polyline>
          <polyline points="23 20 23 14 17 14"></polyline>
          <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"></path>
        </svg>
        <span>Unanswered</span>
        <span class="sc-circle-badge" id="badgeUnansweredCount" style="display:none;">0</span>
      </button>

      <button class="sc-nav-item" id="sbIvrResponses" onclick="switchNav('tabIvrResponses', 'ivr-responses')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="6" y1="3" x2="6" y2="15"></line>
          <circle cx="18" cy="6" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
        <span>Interactive IVR</span>
      </button>

      <button class="sc-nav-item" id="sbSmsCampaigns" onclick="app.showSmsCampaignsView()">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>SMS Campaigns</span>
      </button>

      <!-- INSIGHTS & CONTROL Group -->
      <div class="sc-sidebar-section-title" style="margin-top:16px;">INSIGHTS &amp; CONTROL</div>

      <button class="sc-nav-item" id="sbReports" onclick="switchNav('tabReports', 'reports')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"></line>
          <line x1="12" y1="20" x2="12" y2="4"></line>
          <line x1="6" y1="20" x2="6" y2="14"></line>
        </svg>
        <span>Reports</span>
      </button>

      <button class="sc-nav-item" id="sbCompliance" onclick="switchNav('tabCompliance', 'compliance')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
        <span>Compliance</span>
      </button>

      <button class="sc-nav-item" id="sbSettings" onclick="switchNav('tabSettings', 'settings')">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3m-3.5-6.5l-2.1 2.1m-8.8 8.8l-2.1 2.1m0-13l2.1 2.1m8.8 8.8l2.1 2.1"></path>
        </svg>
        <span>Settings</span>
      </button>

    </div>

    <!-- Bottom Sidebar Footer -->
    <div class="sc-sidebar-footer">
      <a href="javascript:void(0)" class="sb-footer-link" onclick="openSipSettingsModal()">Phone Settings</a>
      <a href="javascript:void(0)" class="sb-footer-link" onclick="openChangePasswordModal()">Change Password</a>
    </div>
  </div>

  <!-- ── SkyConnect Main Content Area ──────────────────────── -->
  <div class="sc-main-content main" id="mainContainer">

    <!-- ========================================================
         VIEW 1: CAMPAIGNS (Matching Exact Design Mockup)
         ======================================================== -->
    <div class="tab-panel active" id="tabCampaigns">
      
      <!-- ── SECTION A: CAMPAIGNS OVERVIEW (Mockup View) ── -->
      <div id="subViewCampaignsList">
        <!-- Top Header: Title, Subtitle and Action buttons -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;flex-wrap:wrap;gap:10px;">
          <div>
            <h1 id="campMainTitle" style="font-size:26px;font-weight:700;color:#0f172a;margin:0 0 5px 0;letter-spacing:-0.3px;">Campaigns</h1>
            <div id="campMainSubtitle" style="font-size:13.5px;color:#64748b;">Create, monitor and control automated outbound voice campaigns.</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <button type="button" class="btn-refresh-pill" onclick="app.loadCampaignsOverview()">Refresh</button>
          </div>
        </div>

        <!-- 4 Automated Dialer Real KPI Metric Cards -->
        <div class="camp-metric-row">
          <div class="camp-metric-card">
            <div class="camp-metric-lbl" id="kpiCard1Lbl">Active calls now</div>
            <div class="camp-metric-val" id="kpiActiveCalls">0</div>
          </div>
          <div class="camp-metric-card">
            <div class="camp-metric-lbl" id="kpiCard2Lbl">Available lines</div>
            <div class="camp-metric-val" id="kpiAvailableLines">0</div>
          </div>
          <div class="camp-metric-card">
            <div class="camp-metric-lbl" id="kpiAnsweredRateLbl">Answered rate</div>
            <div class="camp-metric-val green" id="kpiAnsweredRate">0.0%</div>
          </div>
          <div class="camp-metric-card">
            <div class="camp-metric-lbl" id="kpiCard4Lbl">Average call duration</div>
            <div class="camp-metric-val" id="kpiAvgDuration">00:00</div>
          </div>
        </div>

        <!-- Two Column Main Layout -->
        <div class="camp-layout-grid">
          
          <!-- LEFT: All campaigns (60%) -->
          <div class="camp-panel-box">
            <!-- Header row: title + count badge -->
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div class="camp-panel-heading" id="campPanelHeading" style="margin:0;">All campaigns</div>
                <span id="campaignsCountBadge" style="background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;border:1px solid #e2e8f0;">0</span>
              </div>
            </div>

            <!-- Search + Filter Toolbar -->
            <div id="campaignFilterBar" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px;">
              <!-- Search Input -->
              <div style="position:relative;flex:1;min-width:160px;">
                <svg style="position:absolute;left:10px;top:50%;transform:translateY(-50%);width:15px;height:15px;color:#94a3b8;pointer-events:none;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="text"
                  id="campaignSearchInput"
                  placeholder="Search campaigns..."
                  oninput="app.filterCampaignsTable()"
                  style="width:100%;padding:7px 10px 7px 33px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#0f172a;background:#fff;outline:none;transition:border-color 0.15s;box-sizing:border-box;"
                  onfocus="this.style.borderColor='#00A651'" onblur="this.style.borderColor='#e2e8f0'"
                >
              </div>

              <!-- Status Filter -->
              <select id="campaignStatusFilter" onchange="app.filterCampaignsTable()" style="padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#334155;background:#fff;outline:none;cursor:pointer;min-width:110px;font-weight:500;">
                <option value="">All Status</option>
                <option value="running">Running</option>
                <option value="idle">Idle</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
              </select>

              <!-- Channel / Type Filter -->
              <select id="campaignTypeFilter" onchange="app.filterCampaignsTable()" style="padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:12.5px;color:#334155;background:#fff;outline:none;cursor:pointer;min-width:120px;font-weight:500;">
                <option value="">All Channels</option>
                <option value="automated_ivr">Interactive IVR</option>
                <option value="broadcast">Play & Hang Up</option>
                <option value="sms_only">SMS Only</option>
              </select>
            </div>

            <div style="overflow-x:auto;">
              <table class="camp-table">
                <thead>
                  <tr>
                    <th style="width:38%;">CAMPAIGN</th>
                    <th style="width:16%;">MODE</th>
                    <th style="width:16%;">STATUS</th>
                    <th style="width:18%;">PROGRESS</th>
                    <th style="width:12%;text-align:right;"></th>
                  </tr>
                </thead>
                <tbody id="campaignsOverviewTableBody">
                  <tr class="camp-table-row">
                    <td colspan="5" style="padding:24px;text-align:center;color:#64748b;">Loading campaigns...</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>


          <!-- RIGHT: New campaign Wizard Panel (40%) -->
          <div class="camp-panel-box">
            <div class="camp-panel-heading" id="campWizardHeading">New campaign</div>

            <!-- Stepper Header -->
            <div class="camp-stepper">
              <div class="camp-step-item active" id="wizardStep1" onclick="app.setWizardStep(1)">
                <span class="camp-step-circle active">1</span>
                <span class="camp-step-title active">General</span>
              </div>
              <div class="camp-step-item" id="wizardStep2" onclick="app.setWizardStep(2)">
                <span class="camp-step-circle">2</span>
                <span class="camp-step-title">Message</span>
              </div>
              <div class="camp-step-item" id="wizardStep3" onclick="app.setWizardStep(3)">
                <span class="camp-step-circle">3</span>
                <span class="camp-step-title">Telephony</span>
              </div>
              <div class="camp-step-item" id="wizardStep4" onclick="app.setWizardStep(4)">
                <span class="camp-step-circle">4</span>
                <span class="camp-step-title">Launch</span>
              </div>
            </div>

            <form id="formNewCampaignWizard" onsubmit="app.handleNewCampaignWizardSubmit(event);">
              <div class="form-group" style="margin-bottom:14px;">
                <label class="camp-input-label">Campaign name</label>
                <input type="text" id="newCampaignNameInput" class="camp-input-field" placeholder="e.g. Appointment Reminder" required>
              </div>

              <div class="form-group" style="margin-bottom:14px;">
                <label class="camp-input-label">Campaign purpose</label>
                <select id="newCampaignTypeSelect" class="camp-input-field">
                  <option value="appointment_reminder" selected>Appointment reminder</option>
                  <option value="order_ready">Order ready for pickup</option>
                  <option value="delivery_notice">Delivery notice</option>
                  <option value="payment_reminder">Payment reminder</option>
                  <option value="announcement">General notice</option>
                </select>
              </div>

              <div class="form-group" style="margin-bottom:16px;">
                <label class="camp-input-label" style="display:block;margin-bottom:8px;">Campaign Channel &amp; Execution Mode</label>
                <input type="hidden" id="newCampaignModeSelect" value="automated_ivr">
                <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;" id="newCampModeGrid">
                  
                  <!-- Option 1: Interactive IVR Call -->
                  <div id="campModeCard_ivr" onclick="app.selectCampaignMode('automated_ivr')" style="border:2px solid #00A651;background:#f0fdf4;border-radius:8px;padding:12px 10px;cursor:pointer;transition:all 0.2s;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                      <input type="radio" name="camp_mode_radio" id="radioModeIvr" value="automated_ivr" checked style="accent-color:#00A651;cursor:pointer;">
                      <span style="font-size:12px;font-weight:700;color:#0f172a;">Interactive IVR</span>
                    </div>
                    <div style="font-size:11px;color:#475569;line-height:1.4;">Call contact with interactive keypad menu responses.</div>
                  </div>

                  <!-- Option 2: Play & Hang Up (Voice Broadcast) -->
                  <div id="campModeCard_broadcast" onclick="app.selectCampaignMode('broadcast')" style="border:1.5px solid #cbd5e1;background:#fff;border-radius:8px;padding:12px 10px;cursor:pointer;transition:all 0.2s;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                      <input type="radio" name="camp_mode_radio" id="radioModeBroadcast" value="broadcast" style="accent-color:#00A651;cursor:pointer;">
                      <span style="font-size:12px;font-weight:700;color:#0f172a;">Play &amp; Hang Up</span>
                    </div>
                    <div style="font-size:11px;color:#64748b;line-height:1.4;">Call contact, play announcement audio, then end call.</div>
                  </div>

                  <!-- Option 3: SMS Only Campaign -->
                  <div id="campModeCard_sms" onclick="app.selectCampaignMode('sms_only')" style="border:1.5px solid #cbd5e1;background:#fff;border-radius:8px;padding:12px 10px;cursor:pointer;transition:all 0.2s;">
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                      <input type="radio" name="camp_mode_radio" id="radioModeSms" value="sms_only" style="accent-color:#00A651;cursor:pointer;">
                      <span style="font-size:12px;font-weight:700;color:#0f172a;">SMS Only</span>
                    </div>
                    <div style="font-size:11px;color:#64748b;line-height:1.4;">No call. Contact receives a direct SMS text message.</div>
                  </div>

                </div>
              </div>

              <!-- ==============================================
                   VOICE CAMPAIGN SETTINGS (Interactive IVR & Broadcast)
                   ============================================== -->
              <div id="newCampVoiceSection" style="display:block;">
                <div class="form-group" style="margin-bottom:14px;">
                  <label class="camp-input-label">Caller ID</label>
                  <select id="newCampaignCallerIdSelect" class="camp-input-field">
                    <option value="">Select Caller ID (or add in Settings)</option>
                  </select>
                </div>

                <div class="form-group" style="margin-bottom:14px;">
                  <label class="camp-input-label">Calling &amp; Scheduling Method</label>
                  <select id="newCampaignCallingMethodSelect" class="camp-input-field" onchange="app.handleCallingMethodChange(this.value)">
                    <option value="auto_schedule" selected>System Auto-Schedule (Upload Name &amp; Phone only)</option>
                    <option value="manual">Manual Scheduling (Upload exact times or Immediate)</option>
                  </select>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">
                    In System Auto-Schedule mode, the system automatically schedules the calls. The dialer will place calls at scheduled times when you click Start Auto-Dialer.
                  </div>
                </div>

                <!-- Configurable System Auto-Scheduling Options -->
                <div id="newCampaignAutoScheduleOptions" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
                  <div style="font-size:11.5px;font-weight:700;color:#166534;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <span>How do you want the system to schedule calls?</span>
                  </div>

                  <div style="margin-bottom:10px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Scheduling Strategy</label>
                    <select id="newCampaignScheduleStrategy" class="camp-input-field" style="background:#fff;font-size:12px;padding:6px 10px;" onchange="app.handleScheduleStrategyChange(this.value)">
                      <option value="smart" selected>Smart Optimized Schedule (Fastest: Consumes least time)</option>
                      <option value="interval">Interval Staggering (Spread calls every X minutes)</option>
                      <option value="window">Business Hours Window (Distribute calls within hours)</option>
                    </select>
                  </div>

                  <div id="rowScheduleInterval" style="display:none;margin-bottom:8px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Stagger Interval (Time between calls)</label>
                    <select id="newCampaignScheduleInterval" class="camp-input-field" style="background:#fff;font-size:12px;padding:6px 10px;">
                      <option value="2">Every 2 minutes</option>
                      <option value="5" selected>Every 5 minutes (Recommended)</option>
                      <option value="10">Every 10 minutes</option>
                      <option value="15">Every 15 minutes</option>
                      <option value="30">Every 30 minutes</option>
                    </select>
                  </div>

                  <div id="rowScheduleWindow" style="display:none;margin-bottom:8px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Business Hours Window</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <input type="time" id="newCampaignWindowStart" value="09:00" class="camp-input-field" style="background:#fff;font-size:12px;padding:5px 8px;flex:1;">
                      <span style="font-size:11.5px;color:#64748b;">to</span>
                      <input type="time" id="newCampaignWindowEnd" value="17:00" class="camp-input-field" style="background:#fff;font-size:12px;padding:5px 8px;flex:1;">
                    </div>
                    <div style="font-size:10.5px;color:#64748b;margin-top:3px;">Uploaded contacts will be distributed evenly between these hours.</div>
                  </div>
                </div>

                <div class="form-group" style="margin-bottom:18px;">
                  <label class="camp-input-label">Initial contacts</label>
                  <div class="camp-browse-container">
                    <input type="text" id="newCampaignContactsInput" placeholder="No file chosen (Click Browse to upload)" readonly class="camp-browse-input">
                    <input type="file" id="newCampaignFileInput" accept=".xlsx,.csv,.xls,.txt,.tsv" style="display:none;" onchange="app.handleNewCampaignFileSelect(this)">
                    <button type="button" class="camp-browse-btn" onclick="document.getElementById('newCampaignFileInput').click()">Browse</button>
                  </div>

                  <!-- Smart Schedule Suggestion Offer -->
                  <div id="newCampSmartOffer" style="display:none;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:12px 14px;margin-top:10px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                      <div style="font-size:12px;font-weight:700;color:#15803d;">
                        Smart Time-Saving Schedule
                      </div>
                      <span id="smartOfferBadge" style="font-size:11px;font-weight:700;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;">0 contacts</span>
                    </div>
                    <div id="smartOfferSummary" style="font-size:11.5px;color:#334155;line-height:1.5;margin-bottom:10px;"></div>
                    <div id="smartOfferActions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                      <button type="button" class="btn btn-sm btn-primary" onclick="app.approveSmartScheduleSuggestion()" style="font-size:11.5px;padding:5px 14px;background:#00A651;border:none;border-radius:6px;font-weight:700;color:#fff;cursor:pointer;">
                        Approve suggested schedule
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.rejectSmartScheduleSuggestion()" style="font-size:11.5px;padding:5px 12px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;color:#475569;cursor:pointer;">
                        Use standard interval
                      </button>
                    </div>
                    <div id="smartOfferApproved" style="display:none;font-size:11.5px;font-weight:600;color:#166534;">
                      <span>Suggested schedule approved. Contacts will be dispatched concurrently across available lines.</span>
                    </div>
                  </div>
                </div>

                <!-- Optional SMS Follow-up toggle for voice calls -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:18px;">
                  <div style="display:flex;align-items:center;justify-content:space-between;cursor:pointer;" onclick="const chk = document.getElementById('newCampaignSmsEnabled'); if (chk) { chk.checked = !chk.checked; app.toggleWizardSmsOptions(chk.checked); }">
                    <div style="display:flex;align-items:center;gap:8px;">
                      <div style="width:28px;height:28px;border-radius:6px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                        </svg>
                      </div>
                      <div>
                        <div style="font-size:12px;font-weight:700;color:#0f172a;">Send SMS Follow-Up after call</div>
                        <div style="font-size:10.5px;color:#64748b;">Text contact when call completes or key is pressed</div>
                      </div>
                    </div>
                    <input type="checkbox" id="newCampaignSmsEnabled" style="accent-color:#00A651;width:17px;height:17px;cursor:pointer;" onclick="event.stopPropagation(); app.toggleWizardSmsOptions(this.checked);">
                  </div>

                  <div id="newCampaignSmsDetails" style="display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #cbd5e1;">
                    <div style="margin-bottom:8px;">
                      <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Trigger</label>
                      <select id="newCampaignSmsTrigger" class="camp-input-field" style="background:#fff;font-size:12px;padding:5px 8px;">
                        <option value="call_completed" selected>When call completes / answered</option>
                        <option value="ivr_choice">When caller chooses an IVR option</option>
                        <option value="all_calls">Always (all dialed calls)</option>
                        <option value="unanswered">When call is unanswered / busy</option>
                      </select>
                    </div>
                    <div style="margin-bottom:6px;">
                      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">
                        <label style="font-size:11px;font-weight:600;color:#374151;margin:0;">SMS Message Template</label>
                        <span id="newCampSmsCharCount" style="font-size:10px;color:#64748b;">0 / 160</span>
                      </div>
                      <textarea id="newCampaignSmsTemplate" class="camp-input-field" rows="2" style="background:#fff;font-size:11.5px;padding:6px 8px;resize:vertical;font-family:inherit;min-height:50px;" oninput="app.updateSmsCharCount(this, 'newCampSmsCharCount')">Hello {name}, thank you for taking our call regarding {campaign}. We have recorded your response.</textarea>
                    </div>
                  </div>
                </div>

              </div>

              <!-- ==============================================
                   SMS ONLY CAMPAIGN SETTINGS (No voice call)
                   ============================================== -->
              <div id="newCampSmsOnlySection" style="display:none;">
                <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:12px 14px;margin-bottom:16px;">
                  <div style="font-size:12px;font-weight:700;color:#166534;display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>SMS Only Campaign Mode Active</span>
                  </div>
                  <div style="font-size:11px;color:#334155;line-height:1.4;">
                    Contacts in this campaign will directly receive your SMS message. No phone calls will be placed.
                  </div>
                </div>

                <!-- Sender ID / Mask -->
                <div class="form-group" style="margin-bottom:14px;">
                  <label class="camp-input-label">Sender ID / Mask</label>
                  <input type="text" id="newCampSmsOnlySenderId" class="camp-input-field" value="SkyConnect" placeholder="e.g. SkyConnect">
                  <div style="font-size:11px;color:#64748b;margin-top:3px;">The sender name that appears on customer mobile phones.</div>
                </div>

                <!-- SMS Text Template -->
                <div class="form-group" style="margin-bottom:14px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px;">
                    <label class="camp-input-label" style="margin:0;">SMS Message Template</label>
                    <span id="newCampSmsOnlyCharCount" style="font-size:11px;color:#64748b;font-weight:600;">0 / 160 (1 SMS)</span>
                  </div>
                  <textarea id="newCampSmsOnlyTemplate" class="camp-input-field" rows="3" style="font-size:12.5px;padding:8px 10px;resize:vertical;font-family:inherit;min-height:70px;" placeholder="Hello {name}, this is a notification from {campaign}..." oninput="app.updateSmsCharCount(this, 'newCampSmsOnlyCharCount'); app.updateWizardSmsOnlyPreview();">Hello {name}, this is an important message regarding {campaign}. Please contact us if you have any questions.</textarea>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px;">
                    <button type="button" class="btn btn-xs" style="font-size:10.5px;padding:2px 7px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('newCampSmsOnlyTemplate', '{name}')">+{name}</button>
                    <button type="button" class="btn btn-xs" style="font-size:10.5px;padding:2px 7px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('newCampSmsOnlyTemplate', '{campaign}')">+{campaign}</button>
                    <button type="button" class="btn btn-xs" style="font-size:10.5px;padding:2px 7px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('newCampSmsOnlyTemplate', '{phone}')">+{phone}</button>
                    <button type="button" class="btn btn-xs" style="font-size:10.5px;padding:2px 7px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('newCampSmsOnlyTemplate', '{date}')">+{date}</button>
                  </div>
                </div>

                <!-- SMS Dispatch & Scheduling Method -->
                <div class="form-group" style="margin-bottom:14px;">
                  <label class="camp-input-label">SMS Dispatch &amp; Scheduling Method</label>
                  <select id="newCampSmsSchedulingMethodSelect" class="camp-input-field" onchange="app.handleSmsSchedulingMethodChange(this.value)">
                    <option value="auto_schedule" selected>System Auto-Schedule (Upload Name &amp; Phone only)</option>
                    <option value="manual">Manual Scheduling (Upload exact times or Immediate)</option>
                  </select>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">
                    In System Auto-Schedule mode, the system automatically schedules staggered dispatch times for each contact.
                  </div>
                </div>

                <!-- Configurable SMS Auto-Scheduling Options -->
                <div id="newCampSmsAutoScheduleOptions" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
                  <div style="font-size:11.5px;font-weight:700;color:#166534;margin-bottom:8px;display:flex;align-items:center;gap:6px;">
                    <span>How do you want the system to schedule SMS messages?</span>
                  </div>

                  <div style="margin-bottom:10px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Scheduling Strategy</label>
                    <select id="newCampSmsScheduleStrategy" class="camp-input-field" style="background:#fff;font-size:12px;padding:6px 10px;" onchange="app.handleSmsScheduleStrategyChange(this.value)">
                      <option value="smart" selected>Smart Optimized Schedule (Fastest: Consumes least time)</option>
                      <option value="interval">Interval Staggering (Spread SMS every X minutes)</option>
                      <option value="window">Business Hours Window (Distribute SMS within hours)</option>
                    </select>
                  </div>

                  <div id="rowSmsScheduleInterval" style="display:none;margin-bottom:8px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Stagger Interval (Time between messages)</label>
                    <select id="newCampSmsScheduleInterval" class="camp-input-field" style="background:#fff;font-size:12px;padding:6px 10px;">
                      <option value="1">Every 1 minute</option>
                      <option value="2">Every 2 minutes</option>
                      <option value="5" selected>Every 5 minutes (Recommended)</option>
                      <option value="10">Every 10 minutes</option>
                      <option value="15">Every 15 minutes</option>
                      <option value="30">Every 30 minutes</option>
                    </select>
                  </div>

                  <div id="rowSmsScheduleWindow" style="display:none;margin-bottom:8px;">
                    <label style="font-size:11px;font-weight:600;color:#374151;display:block;margin-bottom:3px;">Business Hours Window</label>
                    <div style="display:flex;gap:8px;align-items:center;">
                      <input type="time" id="newCampSmsWindowStart" value="09:00" class="camp-input-field" style="background:#fff;font-size:12px;padding:5px 8px;flex:1;">
                      <span style="font-size:11.5px;color:#64748b;">to</span>
                      <input type="time" id="newCampSmsWindowEnd" value="17:00" class="camp-input-field" style="background:#fff;font-size:12px;padding:5px 8px;flex:1;">
                    </div>
                    <div style="font-size:10.5px;color:#64748b;margin-top:3px;">Uploaded contacts will be distributed evenly between these hours.</div>
                  </div>
                </div>

                <!-- Initial Contacts File Upload for SMS -->
                <div class="form-group" style="margin-bottom:18px;">
                  <label class="camp-input-label">Initial contacts (CSV, XLSX, TXT)</label>
                  <div class="camp-browse-container">
                    <input type="text" id="newCampaignSmsContactsInput" placeholder="No file chosen (Click Browse to upload)" readonly class="camp-browse-input">
                    <input type="file" id="newCampaignSmsFileInput" accept=".xlsx,.csv,.xls,.txt,.tsv" style="display:none;" onchange="app.handleNewCampaignSmsFileSelect(this)">
                    <button type="button" class="camp-browse-btn" onclick="document.getElementById('newCampaignSmsFileInput').click()">Browse</button>
                  </div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">
                    Supports Excel (<strong>.xlsx</strong>) and CSV (<strong>.csv</strong>) with columns: <strong>Name, Phone Number, Time</strong> (e.g. <code>Helen, 0911223344, 14:30</code> or <code>Immediate</code>).
                  </div>
                  <div id="newCampSmsFileNotice" style="display:none;font-size:11.5px;color:#166534;margin-top:6px;font-weight:600;"></div>

                  <!-- Smart Schedule Suggestion Offer for SMS -->
                  <div id="newCampSmsSmartOffer" style="display:none;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:12px 14px;margin-top:10px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                      <div style="font-size:12px;font-weight:700;color:#15803d;">Smart Time-Saving Schedule</div>
                      <span id="smartSmsOfferBadge" style="font-size:11px;font-weight:700;background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;">0 contacts</span>
                    </div>
                    <div id="smartSmsOfferSummary" style="font-size:11.5px;color:#334155;line-height:1.5;margin-bottom:10px;"></div>
                    <div id="smartSmsOfferActions" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                      <button type="button" class="btn btn-sm btn-primary" onclick="app.approveSmartSmsScheduleSuggestion()" style="font-size:11.5px;padding:5px 14px;background:#00A651;border:none;border-radius:6px;font-weight:700;color:#fff;cursor:pointer;">
                        Approve suggested schedule
                      </button>
                      <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.rejectSmartSmsScheduleSuggestion()" style="font-size:11.5px;padding:5px 12px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;color:#475569;cursor:pointer;">
                        Use standard interval
                      </button>
                    </div>
                    <div id="smartSmsOfferApproved" style="display:none;font-size:11.5px;font-weight:600;color:#166534;">
                      <span>Suggested schedule approved. Contacts will be dispatched on the optimized timetable.</span>
                    </div>
                  </div>
                </div>

                <!-- Recipient Preview -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:18px;">
                  <div style="font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Preview Message</div>
                  <div id="newCampSmsOnlyPreviewBubble" style="background:#e0f2fe;border-radius:10px 10px 10px 2px;padding:8px 12px;color:#0369a1;font-size:11.5px;line-height:1.45;">
                    Hello Abebe Bikila, this is an important message regarding Appointment Reminder. Please contact us if you have any questions.
                  </div>
                </div>

              </div>

              <button type="submit" id="btnNewCampaignSubmit" class="camp-btn-submit">Continue to message design</button>
            </form>
          </div>
        </div>
      </div>

      <!-- ── SECTION B: MESSAGE DESIGNER & LIVE RESULTS (Secondary Screen) ── -->
      <!-- ── SECTION B: MESSAGE DESIGNER, STATS & CONTACTS (Exact Match to Picture 1 & Picture 3) ── -->
      <div id="subViewCampaignsDesigner" style="display:none;">
        
        <!-- Top Navigation & Header Actions (Picture 3 Match) -->
        <div class="des-top-bar">
          <div class="des-nav-tabs" style="margin-bottom:0;border-bottom:none;">
            <button type="button" class="des-nav-tab" onclick="switchCampaignSubView('list')">Campaigns overview</button>
            <button type="button" class="des-nav-tab active">
              <span id="designerTabCampaignName">Campaign</span> &middot; Designer
            </button>
          </div>

          <!-- Top Right Action Buttons (Voice & SMS Variants) -->
          <div id="designerVoiceTopActions" style="display:flex;align-items:center;gap:10px;">
            <button type="button" class="des-btn-text" onclick="app.openCampaignInQueue(app.activeCampaignId || app.campaign?.id)">Open queue</button>
            <button type="button" class="des-btn-save" onclick="app.saveCampaignDesigner()">Save</button>
            <button type="button" id="btnLaunchDesignerCampaign" class="des-btn-launch" onclick="app.toggleCampaignLaunch()">Launch campaign</button>
          </div>

          <div id="designerSmsTopActions" style="display:none;align-items:center;gap:10px;">
            <button type="button" class="btn-clean-white" style="font-size:12px;font-weight:600;padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;" onclick="app.openAddContactsModal(app.activeCampaignId || app.campaign?.id)">Add numbers</button>
            <button type="button" class="des-btn-save" onclick="app.saveSmsCampaignDesigner()">Save SMS Setup</button>
            <button type="button" id="btnLaunchSmsCampaignTop" class="des-btn-launch" onclick="app.dispatchSmsCampaign()" style="background:#00A651;border:none;display:inline-flex;align-items:center;gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              <span>Dispatch SMS</span>
            </button>
          </div>
        </div>

        <!-- ==============================================
             WORKSPACE 1: VOICE CAMPAIGN DESIGNER (IVR & Broadcast)
             ============================================== -->
        <div id="designerVoiceWorkspace" style="display:block;">
        <!-- Main Two-Column Layout: Message, Responses (Left) | Preview, Progress & Schedule (Right) -->
        <div class="des-grid" style="grid-template-columns: 1.4fr 1.1fr; gap: 20px; align-items: start;">
          
          <!-- LEFT COLUMN: Message & IVR Responses -->
          <div style="display:flex;flex-direction:column;gap:18px;">
            
            <!-- CARD 1: Message -->
            <div class="des-panel" style="padding: 24px;">
              <div style="margin-bottom: 14px;">
                <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">Message</h2>
                <div style="font-size: 12px; color: #64748b;">What the contact hears when they answer.</div>
                <span id="designerCampaignTypeBadge" style="display:none;">AUTOMATED_IVR</span>
              </div>

              <!-- Voice prompt audio file -->
              <div style="margin-bottom: 12px;">
                <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:5px;">Voice prompt</label>
                <select id="designerAudioPromptSelect" class="des-clean-field" style="width:100%;font-size:12.5px;padding:8px 10px;" onchange="app.handleDesignerAudioChange(this.value)">
                  <option value="">Text-to-Speech Engine (Default)</option>
                </select>
              </div>

              <!-- Language selector & Single Test Audio button -->
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
                <div class="des-lang-group" style="margin:0;">
                  <button type="button" class="des-lang-btn" id="langBtnAmharic" onclick="setDesignerLang('amharic')">Amharic</button>
                  <button type="button" class="des-lang-btn" id="langBtnOromifa" onclick="setDesignerLang('oromifa')">Afaan Oromoo</button>
                  <button type="button" class="des-lang-btn active" id="langBtnEnglish" onclick="setDesignerLang('english')">English</button>
                </div>
                <button type="button" id="btnTestVoiceAudio" onclick="toggleVoicePreview()" style="background:none;border:none;color:#00A651;font-size:12.5px;font-weight:600;cursor:pointer;padding:4px 0;display:inline-flex;align-items:center;gap:6px;transition:color 0.15s ease;" title="Test and listen to IVR voice prompt">
                  <span id="testAudioPlayIcon" style="font-size:10px;">▶</span>
                  <span id="testAudioPlayText">Test audio</span>
                </button>
              </div>

              <!-- Option: Play human audio recording -->
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;margin-bottom:14px;padding-top:6px;border-top:1px solid #f1f5f9;">
                <span style="font-size:13px;font-weight:500;color:#334155;">Play human audio recording</span>
                <input type="checkbox" id="chkNaturalVoice" checked style="accent-color:#00A651;width:18px;height:18px;cursor:pointer;border-radius:4px;">
              </div>

              <!-- Agent Calling Script for this Campaign -->
              <div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                  <label style="font-size:12.5px;font-weight:700;color:#0f172a;margin:0;">Agent Calling Script</label>
                  <span style="font-size:11px;color:#00A651;font-weight:600;">Visible to agent on live calls</span>
                </div>
                <textarea id="campaignMessageText" class="des-script-box" spellcheck="false" placeholder="Write what the agent should say for this campaign (e.g. Hello {customer_name}, I am calling to inform you about...)" style="width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px;font-size:12.5px;line-height:1.6;color:#0f172a;background:#fff;outline:none;min-height:96px;resize:vertical;box-sizing:border-box;font-family:inherit;"></textarea>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">
                  When an agent selects this campaign on the Dialer screen, this script will be displayed for each contact. Use <code>{customer_name}</code> or <code>{phone_number}</code> for personalization.
                </div>
              </div>
            </div>

            <!-- CARD 2: IVR call flow and responses -->
            <div class="des-panel" style="padding: 24px;">
              <div style="margin-bottom:14px;">
                <h3 style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 4px 0;">IVR call flow and responses</h3>
                <div style="font-size:12px;color:#64748b;">Choose how the call plays and what happens when the contact presses a key.</div>
              </div>

              <!-- Segmented IVR Mode Switcher -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <div id="lblIvrModeBroadcast" onclick="app.setIvrMode('broadcast')" style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid #cbd5e1;border-radius:8px;background:#fff;cursor:pointer;transition:all 0.2s;">
                  <input type="radio" name="ivr_mode_radio" id="radioIvrBroadcast" value="broadcast" style="accent-color:#00A651;width:16px;height:16px;cursor:pointer;margin-top:2px;">
                  <div>
                    <div style="font-size:12.5px;font-weight:700;color:#0f172a;">Play and hang up</div>
                    <div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4;">The contact hears the message, then the call ends.</div>
                  </div>
                </div>

                <div id="lblIvrModeInteractive" onclick="app.setIvrMode('interactive')" style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid #86efac;border-radius:8px;background:#f0fdf4;cursor:pointer;transition:all 0.2s;">
                  <input type="radio" name="ivr_mode_radio" id="radioIvrInteractive" value="interactive" checked style="accent-color:#00A651;width:16px;height:16px;cursor:pointer;margin-top:2px;">
                  <div>
                    <div style="font-size:12.5px;font-weight:700;color:#166534;">Interactive menu</div>
                    <div style="font-size:11px;color:#475569;margin-top:2px;line-height:1.4;">The contact presses a key and the answer is recorded.</div>
                  </div>
                </div>
              </div>

              <!-- Option 1 View: Play & Hang Up Notice -->
              <div id="designerIvrBroadcastPanel" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:12px;">
                <div style="font-size:12px;color:#64748b;line-height:1.5;margin-bottom:8px;">
                  The contact will hear the voice prompt selected above. As soon as the audio playback completes, the call is automatically closed and marked as <strong>Completed</strong>.
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:#475569;">
                  <span><strong>Post-call outcome:</strong> <span id="designerBroadcastOutcomeLabel">Announcement Listened</span></span>
                  <span style="color:#00A651;font-weight:700;">✓ Auto-Disconnect</span>
                </div>
              </div>

              <!-- Option 2 View: Interactive Keypad Menu -->
              <div id="designerIvrInteractivePanel" style="display:block;">
                <!-- Menu Instructions Prompt Audio Selector -->
                <div style="margin-bottom:16px;">
                  <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">Menu instructions audio (plays after greeting, optional)</label>
                  <select id="designerIvrMenuAudioSelect" class="des-clean-field" style="width:100%;font-size:12.5px;padding:8px 10px;" onchange="app.handleDesignerIvrMenuAudioChange(this.value)">
                    <option value="">None (Instructions included in greeting)</option>
                    <!-- Populated dynamically with audio recordings -->
                  </select>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                  <span style="font-size:12.5px;font-weight:700;color:#0f172a;">Keypad options</span>
                  <button type="button" class="btn-clean-white" onclick="app.openIvrResponsesModal()" style="background:#fff;border:1px solid #cbd5e1;border-radius:6px;padding:4px 12px;font-size:11.5px;font-weight:600;color:#334155;cursor:pointer;">Add key option</button>
                </div>

                <div id="designerIvrResponsesSummaryList" style="display:flex;flex-direction:column;gap:8px;">
                  <!-- Rendered dynamically by app.renderIvrResponsesSummary() -->
                </div>

                <div id="designerIvrTimeoutNotice" style="margin-top:14px;font-size:11.5px;color:#64748b;padding-top:10px;border-top:1px dashed #e2e8f0;display:flex;justify-content:space-between;align-items:center;">
                  <span>No key pressed after 15 seconds: mark no response and hang up.</span>
                  <a href="javascript:void(0)" onclick="app.openIvrResponsesModal()" style="color:#00A651;font-weight:700;text-decoration:none;font-size:12px;">Edit</a>
                </div>
              </div>
            </div>

            <!-- CARD 3: SMS Follow-Up & Notifications -->
            <div class="des-panel" style="padding: 24px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
                <div>
                  <h3 style="font-size:15px;font-weight:700;color:#0f172a;margin:0 0 4px 0;display:flex;align-items:center;gap:8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>SMS Follow-Up to Contact</span>
                  </h3>
                  <div style="font-size:12px;color:#64748b;">Send an automated text confirmation or outcome notification.</div>
                </div>
                <div style="display:flex;align-items:center;gap:10px;">
                  <span id="designerSmsStatusBadge" style="background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;">Disabled</span>
                  <label class="switch" style="position:relative;display:inline-block;width:38px;height:22px;margin:0;">
                    <input type="checkbox" id="designerSmsEnabled" style="opacity:0;width:0;height:0;" onchange="app.toggleDesignerSmsOptions(this.checked)">
                    <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#cbd5e1;transition:.3s;border-radius:22px;" id="designerSmsSlider"></span>
                  </label>
                </div>
              </div>

              <div id="designerSmsConfigPanel" style="display:none;">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
                  <div>
                    <label style="display:block;font-size:11.5px;font-weight:600;color:#475569;margin-bottom:5px;">Trigger Condition</label>
                    <select id="designerSmsTrigger" class="des-clean-field" style="width:100%;font-size:12px;padding:7px 10px;" onchange="app.updateDesignerSmsPreview()">
                      <option value="call_completed" selected>When call completes / answered</option>
                      <option value="ivr_choice">When caller chooses an IVR option</option>
                      <option value="all_calls">Always (all dialed calls)</option>
                      <option value="unanswered">When call is unanswered / busy (Missed call)</option>
                      <option value="manual_only">Agent manual dispatch only</option>
                    </select>
                  </div>
                  <div>
                    <label style="display:block;font-size:11.5px;font-weight:600;color:#475569;margin-bottom:5px;">Sender ID / Mask</label>
                    <input type="text" id="designerSmsSenderId" class="des-clean-field" value="SkyConnect" style="width:100%;font-size:12px;padding:7px 10px;" placeholder="SkyConnect" oninput="app.updateDesignerSmsPreview()">
                  </div>
                </div>

                <div style="margin-bottom:14px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                    <label style="font-size:12px;font-weight:600;color:#475569;margin:0;">SMS Message Template</label>
                    <span id="designerSmsCharCount" style="font-size:11px;color:#64748b;">0 / 160 chars</span>
                  </div>
                  <textarea id="designerSmsTemplate" class="des-clean-field" style="width:100%;min-height:76px;font-size:12.5px;padding:10px 12px;line-height:1.5;resize:vertical;font-family:inherit;" placeholder="e.g. Hello {name}, thank you for your call regarding {campaign}. We have recorded your selection." oninput="app.updateSmsCharCount(this, 'designerSmsCharCount'); app.updateDesignerSmsPreview();"></textarea>
                  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;">
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{name}')">+{name}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{campaign}')">+{campaign}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{phone}')">+{phone}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{date}')">+{date}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{outcome}')">+{outcome}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:2px 8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('designerSmsTemplate', '{key}')">+{key}</button>
                  </div>
                </div>

                <!-- Live Customer SMS Preview -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
                  <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Live Recipient Preview</div>
                  <div style="background:#e0f2fe;border-radius:12px 12px 12px 2px;padding:10px 14px;color:#0369a1;font-size:12px;line-height:1.5;max-width:92%;" id="designerSmsLivePreviewBubble">
                    Hello Abebe Bikila, thank you for taking our call regarding Appointment Reminder. We have recorded your response.
                  </div>
                  <div style="font-size:10px;color:#94a3b8;margin-top:4px;margin-left:4px;">Delivered from <strong id="previewSenderIdText">SkyConnect</strong></div>
                </div>

                <div style="display:flex;justify-content:space-between;align-items:center;">
                  <button type="button" class="btn-clean-white" style="font-size:11.5px;padding:5px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;cursor:pointer;" onclick="app.sendTestSmsFromDesigner()">
                    Send Test SMS
                  </button>
                  <span style="font-size:11px;color:#059669;font-weight:600;">Dual-Mode: Simulator active (Live on key entry)</span>
                </div>
              </div>
            </div>

          </div>

          <!-- RIGHT COLUMN: Progress & Schedule -->
          <div style="display:flex;flex-direction:column;gap:18px;">
            
            <!-- CARD 1: Progress -->
            <div class="des-panel" style="padding: 22px;">
              <div style="margin-bottom:14px;">
                <h3 style="font-size:14.5px;font-weight:700;color:#0f172a;margin:0 0 3px 0;">Progress</h3>
                <div id="designerProgressRatio" style="font-size:11.5px;color:#64748b;font-weight:500;">0 of 0 dialed</div>
              </div>

              <div style="display:grid;grid-template-columns:repeat(5, 1fr);gap:4px;text-align:center;">
                <div>
                  <div id="chipScheduled" style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">Scheduled</div>
                </div>
                <div>
                  <div id="chipDialed" style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">Dialed</div>
                </div>
                <div>
                  <div id="chipAnswered" style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">Answered</div>
                </div>
                <div>
                  <div id="chipBusy" style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">Busy</div>
                </div>
                <div>
                  <div id="chipNoAnswer" style="font-size:18px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">No answer</div>
                </div>
              </div>
            </div>

            <!-- CARD 3: Schedule (Right Column Bottom) -->
            <div class="des-panel" style="padding: 22px;">
              <div style="margin-bottom:14px;">
                <h3 style="font-size:14.5px;font-weight:700;color:#0f172a;margin:0 0 3px 0;">Schedule</h3>
                <div style="font-size:12px;color:#64748b;">When and how fast the calls go out.</div>
              </div>

              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Method</label>
                <select id="designerCallingMethodSelect" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;" onchange="app.handleDesignerCallingMethodChange(this.value)">
                  <option value="auto_schedule" selected>Auto-schedule</option>
                  <option value="manual">Manual</option>
                </select>
              </div>

              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Strategy</label>
                <select id="designerScheduleStrategy" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;" onchange="app.handleDesignerScheduleStrategyChange(this.value)">
                  <option value="interval" selected>Staggered</option>
                  <option value="window">Business Hours Window</option>
                </select>
              </div>

              <div style="margin-bottom:12px;">
                <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Interval</label>
                <select id="designerScheduleInterval" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;">
                  <option value="2">Every 2 min</option>
                  <option value="5" selected>Every 5 min</option>
                  <option value="10">Every 10 min</option>
                  <option value="15">Every 15 min</option>
                  <option value="30">Every 30 min</option>
                </select>
              </div>

              <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#475569;margin-bottom:14px;padding-top:2px;">
                <span>Status</span>
                <span id="designerScheduleStateText" style="background:#fef3c7;color:#b45309;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">Paused</span>
              </div>

              <button type="button" class="btn-clean-white" style="width:100%;padding:8px 12px;font-size:12px;font-weight:600;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#334155;cursor:pointer;" onclick="app.suggestBestSchedule ? app.suggestBestSchedule() : app.openSmartScheduleModal()">
                Suggest best schedule
              </button>

              <!-- Hidden inputs for compatibility with saveCampaignDesigner -->
              <input type="hidden" id="designerWindowStart" value="09:00">
              <input type="hidden" id="designerWindowEnd" value="17:00">
              <input type="hidden" id="designerBatchSize" value="5">
              <span id="designerCampaignStatusBadge" style="display:none;"><span class="dot"></span>Ready</span>
              <span id="designerProgressPercent" style="display:none;">Progress 0%</span>
              <div id="designerProgressBarFill" style="display:none;"></div>
            </div>

          </div>

        </div>
        </div><!-- End designerVoiceWorkspace -->

        <!-- ==============================================
             WORKSPACE 2: DEDICATED SMS CAMPAIGN DESIGNER
             ============================================== -->
        <div id="designerSmsWorkspace" style="display:none;">
          <div class="des-grid" style="grid-template-columns: 1.35fr 1.15fr; gap: 20px; align-items: start;">
            
            <!-- LEFT COLUMN: SMS Message Composer -->
            <div style="display:flex;flex-direction:column;gap:18px;">
              
              <!-- CARD 1: SMS Message Setup -->
              <div class="des-panel" style="padding: 24px;">
                <div style="margin-bottom: 16px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;">
                    <div>
                      <h2 style="font-size: 16px; font-weight: 700; color: #0f172a; margin: 0 0 4px 0;">SMS Message Composer</h2>
                      <div style="font-size: 12px; color: #64748b;">Set what contacts receive on their mobile phones.</div>
                    </div>
                    <span style="background:#e0f2fe;color:#0284c7;font-size:11px;font-weight:700;padding:3px 10px;border-radius:12px;border:1px solid #bae6fd;">SMS Campaign</span>
                  </div>
                </div>

                <!-- Sender ID / Mask -->
                <div style="margin-bottom: 14px;">
                  <label style="display:block;font-size:12px;font-weight:600;color:#475569;margin-bottom:5px;">Sender ID / Mask (Displayed on recipient's phone)</label>
                  <input type="text" id="smsDesignerSenderId" class="des-clean-field" style="width:100%;font-size:12.5px;padding:8px 12px;" value="SkyConnect" placeholder="e.g. SkyConnect, MyCompany" oninput="app.updateSmsDesignerLivePreview()">
                  <div style="font-size:11px;color:#64748b;margin-top:4px;">Standard alphanumeric sender mask (e.g. SkyConnect).</div>
                </div>

                <!-- SMS Message Text -->
                <div style="margin-bottom: 14px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
                    <label style="font-size:12px;font-weight:600;color:#475569;margin:0;">SMS Message Body</label>
                    <span id="smsDesignerCharCount" style="font-size:11px;font-weight:600;color:#64748b;">0 / 160 characters (1 SMS)</span>
                  </div>
                  <textarea id="smsDesignerTemplate" class="des-clean-field" style="width:100%;min-height:110px;font-size:13px;padding:12px;line-height:1.5;resize:vertical;font-family:inherit;" placeholder="Hello {name}, this is a message from {campaign}..." oninput="app.updateSmsCharCount(this, 'smsDesignerCharCount'); app.updateSmsDesignerLivePreview();">Hello {name}, this is an important message regarding {campaign}. Please reply or call us if you have any questions.</textarea>
                  
                  <!-- Variable Tags -->
                  <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center;">
                    <span style="font-size:11px;color:#64748b;font-weight:600;margin-right:2px;">Insert Tag:</span>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:3px 9px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('smsDesignerTemplate', '{name}')">+{name}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:3px 9px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('smsDesignerTemplate', '{campaign}')">+{campaign}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:3px 9px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('smsDesignerTemplate', '{phone}')">+{phone}</button>
                    <button type="button" class="btn btn-xs" style="font-size:11px;padding:3px 9px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:#334155;cursor:pointer;" onclick="app.insertSmsTag('smsDesignerTemplate', '{date}')">+{date}</button>
                  </div>
                </div>

                <!-- Quick Test SMS Box -->
                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:14px;">
                  <div style="font-size:11.5px;font-weight:700;color:#334155;margin-bottom:6px;">Send Quick Test SMS</div>
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="tel" id="smsDesignerTestPhone" class="des-clean-field" placeholder="+251911223344" style="flex:1;font-size:12px;padding:6px 10px;">
                    <button type="button" class="btn btn-sm" onclick="app.sendTestSmsFromSmsDesigner()" style="background:#0f172a;color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:11.5px;font-weight:600;cursor:pointer;">Send Test</button>
                  </div>
                  <div style="font-size:10.5px;color:#64748b;margin-top:6px;display:flex;justify-content:space-between;align-items:center;">
                    <span>Delivery Gateway: Real SMS if API key set in Settings, simulator if empty.</span>
                    <span id="smsGatewayModeBadge" style="color:#059669;font-weight:700;">Active</span>
                  </div>
                </div>

              </div>

            </div>

            <!-- RIGHT COLUMN: Mobile Preview & Dispatch Controls -->
            <div style="display:flex;flex-direction:column;gap:18px;">
              
              <!-- CARD 1: Mobile Phone SMS Preview -->
              <div class="des-panel" style="padding: 22px;">
                <div style="margin-bottom: 12px; display:flex; justify-content:space-between; align-items:center;">
                  <h3 style="font-size:14.5px;font-weight:700;color:#0f172a;margin:0;">Mobile Phone Preview</h3>
                  <span style="font-size:11px;color:#64748b;">Live message view</span>
                </div>

                <!-- Phone mockup frame -->
                <div style="background:#0f172a;border-radius:24px;padding:12px 10px;box-shadow:0 8px 24px rgba(15,23,42,0.12);max-width:320px;margin:0 auto;">
                  <!-- Notch / speaker -->
                  <div style="width:60px;height:4px;background:#334155;border-radius:4px;margin:0 auto 10px auto;"></div>
                  
                  <!-- Screen area -->
                  <div style="background:#ffffff;border-radius:16px;padding:14px 12px;min-height:180px;display:flex;flex-direction:column;justify-content:space-between;">
                    <div>
                      <!-- Chat top bar -->
                      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #f1f5f9;padding-bottom:8px;margin-bottom:12px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                          <div style="width:24px;height:24px;border-radius:50%;background:#00A651;color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;">
                            S
                          </div>
                          <div>
                            <div id="smsPhonePreviewSender" style="font-size:11px;font-weight:700;color:#0f172a;line-height:1.2;">SkyConnect</div>
                            <div style="font-size:9.5px;color:#94a3b8;">SMS Message</div>
                          </div>
                        </div>
                        <span style="font-size:9.5px;color:#94a3b8;">Today</span>
                      </div>

                      <!-- Chat bubble -->
                      <div style="background:#e0f2fe;border-radius:14px 14px 14px 2px;padding:10px 12px;color:#0369a1;font-size:11.5px;line-height:1.45;word-break:break-word;" id="smsPhonePreviewBubble">
                        Hello Abebe Bikila, this is an important message regarding Appointment Reminder. Please reply or call us if you have any questions.
                      </div>
                    </div>

                    <!-- Message timestamp & status -->
                    <div style="text-align:right;margin-top:8px;">
                      <span style="font-size:9.5px;color:#94a3b8;">Delivered &bull; Just now</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- CARD 2: Campaign Progress & Dispatch -->
              <div class="des-panel" style="padding: 22px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                  <h3 style="font-size:14.5px;font-weight:700;color:#0f172a;margin:0;">SMS Dispatch &amp; Progress</h3>
                  <span id="smsProgressPercentBadge" style="font-size:11px;font-weight:700;color:#007A3D;background:#e8f8ee;padding:2px 8px;border-radius:10px;">0% Sent</span>
                </div>

                <!-- 4 Stats Counters -->
                <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:6px;text-align:center;margin-bottom:16px;">
                  <div style="background:#f8fafc;padding:8px 4px;border-radius:6px;border:1px solid #e2e8f0;">
                    <div id="smsChipTotal" style="font-size:17px;font-weight:700;color:#0f172a;line-height:1.1;">0</div>
                    <div style="font-size:10.5px;color:#64748b;margin-top:2px;">Total</div>
                  </div>
                  <div style="background:#f0fdf4;padding:8px 4px;border-radius:6px;border:1px solid #bbf7d0;">
                    <div id="smsChipSent" style="font-size:17px;font-weight:700;color:#166534;line-height:1.1;">0</div>
                    <div style="font-size:10.5px;color:#166534;margin-top:2px;">Sent</div>
                  </div>
                  <div style="background:#fffbeb;padding:8px 4px;border-radius:6px;border:1px solid #fde68a;">
                    <div id="smsChipPending" style="font-size:17px;font-weight:700;color:#b45309;line-height:1.1;">0</div>
                    <div style="font-size:10.5px;color:#b45309;margin-top:2px;">Pending</div>
                  </div>
                  <div style="background:#fef2f2;padding:8px 4px;border-radius:6px;border:1px solid #fecaca;">
                    <div id="smsChipFailed" style="font-size:17px;font-weight:700;color:#b91c1c;line-height:1.1;">0</div>
                    <div style="font-size:10.5px;color:#b91c1c;margin-top:2px;">Failed</div>
                  </div>
                </div>

                <!-- Progress track -->
                <div style="margin-bottom:16px;">
                  <div class="camp-progress-track" style="height:8px;border-radius:4px;background:#e2e8f0;overflow:hidden;">
                    <div id="smsProgressBarFill" class="camp-progress-fill" style="width:0%;height:100%;background:#00A651;transition:width 0.3s ease;"></div>
                  </div>
                </div>

                <!-- Dispatch Action Button -->
                <div style="display:flex;flex-direction:column;gap:8px;">
                  <button type="button" id="btnDispatchSmsCampaign" class="btn btn-primary" onclick="app.dispatchSmsCampaign()" style="width:100%;padding:10px 14px;background:#00A651;color:#fff;border:none;border-radius:6px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    <span>Dispatch SMS Campaign</span>
                  </button>
                  <div style="display:flex;gap:8px;">
                    <button type="button" class="btn-clean-white" style="flex:1;padding:6px 10px;font-size:11.5px;font-weight:600;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;" onclick="app.openAddContactsModal(app.activeCampaignId || app.campaign?.id)">
                      + Add Contacts
                    </button>
                    <button type="button" id="btnResetFailedSms" class="btn-clean-white" style="flex:1;padding:6px 10px;font-size:11.5px;font-weight:600;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;" onclick="app.resetFailedSms()">
                      Reset Failed
                    </button>
                  </div>
                </div>

              </div>

              <!-- CARD 3: SMS Schedule & Staggering -->
              <div class="des-panel" style="padding: 22px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
                  <div>
                    <h3 style="font-size:14.5px;font-weight:700;color:#0f172a;margin:0 0 3px 0;">SMS Schedule &amp; Staggering</h3>
                    <div style="font-size:12px;color:#64748b;">Configure scheduled auto-dispatch for this campaign.</div>
                  </div>
                  <span id="smsDesignerScheduleStatusBadge" style="background:#dcfce7;color:#166534;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;">Active</span>
                </div>

                <div style="margin-bottom:12px;">
                  <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Dispatch Method</label>
                  <select id="smsDesignerCallingMethod" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;" onchange="app.handleSmsDesignerMethodChange(this.value)">
                    <option value="auto_schedule" selected>System Auto-Schedule (Timed / Staggered)</option>
                    <option value="manual">Manual Scheduling (Exact Uploaded Times or Immediate)</option>
                  </select>
                </div>

                <div style="margin-bottom:12px;">
                  <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Scheduling Strategy</label>
                  <select id="smsDesignerScheduleStrategy" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;" onchange="app.handleSmsDesignerStrategyChange(this.value)">
                    <option value="interval" selected>Interval Staggering</option>
                    <option value="smart">Smart Optimized Schedule</option>
                    <option value="window">Business Hours Window</option>
                  </select>
                </div>

                <div id="smsDesignerIntervalRow" style="margin-bottom:14px;">
                  <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Stagger Interval</label>
                  <select id="smsDesignerScheduleInterval" class="des-clean-field" style="width:100%;font-size:12.5px;padding:7px 10px;">
                    <option value="1">Every 1 min</option>
                    <option value="2">Every 2 min</option>
                    <option value="5" selected>Every 5 min</option>
                    <option value="10">Every 10 min</option>
                    <option value="15">Every 15 min</option>
                    <option value="30">Every 30 min</option>
                  </select>
                </div>

                <div id="smsDesignerWindowRow" style="display:none;margin-bottom:14px;">
                  <label style="display:block;font-size:11.5px;color:#475569;font-weight:600;margin-bottom:5px;">Business Hours Window</label>
                  <div style="display:flex;gap:8px;align-items:center;">
                    <input type="time" id="smsDesignerWindowStart" value="09:00" class="des-clean-field" style="flex:1;font-size:12px;padding:6px 8px;">
                    <span style="font-size:11.5px;color:#64748b;">to</span>
                    <input type="time" id="smsDesignerWindowEnd" value="17:00" class="des-clean-field" style="flex:1;font-size:12px;padding:6px 8px;">
                  </div>
                </div>

                <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:9px 12px;font-size:11px;color:#166534;line-height:1.45;margin-bottom:14px;">
                  <span>The system automatically dispatches SMS messages when each contact's scheduled time arrives. Or click <strong>Dispatch All Pending</strong> to blast all immediately.</span>
                </div>

                <div style="display:flex;gap:8px;">
                  <button type="button" id="btnToggleSmsAutoSender" class="btn btn-sm" onclick="app.toggleSmsAutoSender()" style="flex:1;padding:7px 12px;font-size:12px;font-weight:700;border:none;border-radius:6px;background:#00A651;color:#fff;cursor:pointer;">
                    Auto-Sender Active
                  </button>
                  <button type="button" class="btn-clean-white" onclick="app.reapplySmsAutoSchedule()" style="padding:7px 12px;font-size:11.5px;font-weight:600;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;" title="Re-calculate and stagger pending contact times">
                    Re-schedule Pending
                  </button>
                </div>
              </div>

            </div>

          </div>
        </div><!-- End designerSmsWorkspace -->

        <!-- ── SECTION C: CONTACTS (Bottom Full Width Card) ── -->
        <div class="des-panel" style="margin-top:20px;padding:24px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <h3 id="designerContactsTitle" style="font-size:16px;font-weight:700;color:#0f172a;margin:0;">Contacts</h3>
            <span id="designerContactsSubtitle" style="font-size:12px;color:#64748b;font-weight:500;">0 scheduled calls</span>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
              <input type="text" id="designerLeadSearch" class="des-clean-field" placeholder="Search contacts" style="width:200px;font-size:12.5px;padding:7px 10px;" oninput="app.onDesignerContactFilterChange()">
              
              <!-- Status Filter Dropdown -->
              <select id="designerContactStatusFilter" class="des-clean-field" style="width:auto;min-width:120px;font-size:12.5px;padding:7px 10px;cursor:pointer;" onchange="app.onDesignerContactFilterChange()">
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="answered">Answered / Delivered</option>
                <option value="busy">Busy</option>
                <option value="no_answer">No answer / Failed</option>
              </select>

              <!-- Schedule Filter Dropdown -->
              <select id="designerContactScheduleFilter" class="des-clean-field" style="width:auto;min-width:125px;font-size:12.5px;padding:7px 10px;cursor:pointer;" onchange="app.onDesignerContactFilterChange()">
                <option value="">All schedules</option>
                <option value="upcoming">Upcoming / Scheduled</option>
                <option value="today">Today / Ready</option>
                <option value="past_due">Past due</option>
                <option value="immediate">Immediate</option>
              </select>
            </div>

            <div style="display:flex;gap:10px;align-items:center;">
              <button type="button" class="btn-clean-white" style="font-size:12px;font-weight:600;padding:6px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#475569;cursor:pointer;" onclick="app.exportCampaignContacts(app.activeCampaignId || app.campaign?.id)">Export CSV</button>
              <button type="button" id="btnContactsDispatchSms" class="btn btn-primary" style="display:none;background:#00A651;color:#fff;border:none;border-radius:6px;padding:6px 16px;font-weight:700;font-size:12.5px;cursor:pointer;" onclick="app.dispatchSmsCampaign()">Dispatch All Pending</button>
              <button type="button" class="btn btn-primary" style="background:#00A651;color:#fff;border:none;border-radius:6px;padding:6px 16px;font-weight:700;font-size:12.5px;cursor:pointer;" onclick="app.openAddContactsModal(app.activeCampaignId || app.campaign?.id)">Add numbers</button>
            </div>
          </div>

          <div style="overflow-x:auto;">
            <table class="des-contact-table">
              <thead id="designerContactsTableHead">
                <tr>
                  <th>CUSTOMER</th>
                  <th>PHONE</th>
                  <th>SCHEDULED</th>
                  <th>STATUS</th>
                  <th>DURATION</th>
                  <th style="text-align:right;"></th>
                </tr>
              </thead>
              <tbody id="designerContactsTableBody">
                <!-- Dynamically rendered by app.renderDesignerContactsTable() -->
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>

<!-- ========================================================
         VIEW 2: DIALER (Screenshots 3 & 4)
         ======================================================== -->
    <div class="tab-panel" id="tabDialer">
      <!-- ── TOP CONTROLS CARD: Pacing Modes, Status, Sub-Views & Campaign Chooser (Mockup Match) ── -->
      <div class="dial-top-card">
        <!-- Row 1: Left Pacing & Queue Status | Right: Sub-View Selector -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <!-- Left: Pacing Modes & Status Pill -->
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div class="dial-segmented">
              <button type="button" class="dial-seg-btn active-green" id="btnPacingPreview" onclick="app.setPacingMode('preview')">Preview</button>
              <button type="button" class="dial-seg-btn" id="btnPacingProgressive" onclick="app.setPacingMode('progressive')">Progressive</button>
            </div>
            
            <div class="dial-status-pill">
              <span class="dot"></span>
              <span id="agentQueueStatusText">Ready &middot; 1 lead in queue</span>
            </div>
          </div>

          <!-- Right: Sub-View Segmented Pills -->
          <div class="dial-segmented">
            <button type="button" class="dial-seg-btn active" id="subBtnDialerAgent" onclick="switchDialerSubView('agent')">Agent screen</button>
            <button type="button" class="dial-seg-btn" id="subBtnDialerPacing" onclick="switchDialerSubView('pacing')">Pacing &amp; compliance</button>
            <button type="button" class="dial-seg-btn" id="subBtnDialerQueue" onclick="switchDialerSubView('queue')">Queue &amp; lines</button>
          </div>
        </div>

        <!-- Row 2: Campaign Selector & Multiple Campaigns Switch -->
        <div class="dial-campaign-row">
          <div style="display:flex;align-items:center;gap:14px;flex:1;max-width:620px;">
            <label style="font-size:13.5px;font-weight:700;color:#0f172a;white-space:nowrap;margin:0;">Campaign</label>
            <select id="dialerCampaignDropdown" class="dial-campaign-select" onchange="app.handleDialerCampaignDropdownChange(this.value)">
              <option value="" selected>Select Campaign</option>
            </select>
          </div>

          <!-- Multi-Campaign Toggle Switch -->
          <div style="display:flex;align-items:center;gap:10px;">
            <label class="sc-switch">
              <input type="checkbox" id="chkSelectMultipleCampaigns" onchange="app.toggleMultiCampaignPanel()">
              <span class="sc-slider"></span>
            </label>
            <span style="font-size:13px;font-weight:500;color:#334155;cursor:pointer;" onclick="document.getElementById('chkSelectMultipleCampaigns').click()">Select multiple campaigns</span>
          </div>
        </div>

        <!-- Multi-Campaign Checkbox Drawer (Collapsible) -->
        <div id="multiCampaignSelectorWrap" style="display:none;margin-top:14px;padding-top:14px;border-top:1px dashed #cbd5e1;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <div style="font-size:12.5px;font-weight:700;color:#143522;">
              Select multiple campaigns to combine into one live outbound calling queue:
            </div>
            <div style="display:flex;gap:8px;">
              <button type="button" class="btn btn-xs btn-secondary" onclick="app.selectAllCampaignsForDialer(true)" style="font-size:11.5px;padding:4px 10px;">Select All</button>
              <button type="button" class="btn btn-xs btn-secondary" onclick="app.selectAllCampaignsForDialer(false)" style="font-size:11.5px;padding:4px 10px;">Clear All</button>
              <button type="button" class="btn btn-xs btn-success" onclick="app.applyMultiCampaignSelection()" style="font-size:11.5px;padding:4px 14px;font-weight:700;">Apply &amp; Load Queue</button>
            </div>
          </div>
          <div id="multiCampaignCheckboxesList" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:10px;">
            <!-- Populated dynamically with campaign cards and checkboxes -->
          </div>
        </div>
      </div>

      <!-- ── SUB-VIEW A: AGENT SCREEN (Exact Match to Picture 2) ── -->
      <div id="subViewDialerAgent">
        <!-- Live Real-Time Telephony Metrics Strip for Agent Screen -->
        <div class="camp-metric-row" style="margin-bottom:18px;">
          <div class="camp-metric-card" style="padding:14px 18px;">
            <div class="camp-metric-lbl">Agents ready</div>
            <div class="camp-metric-val" id="agentKpiAgentsReady">0</div>
          </div>
          <div class="camp-metric-card" style="padding:14px 18px;">
            <div class="camp-metric-lbl">Dialing now</div>
            <div class="camp-metric-val" id="agentKpiDialingNow">0</div>
          </div>
          <div class="camp-metric-card" style="padding:14px 18px;">
            <div class="camp-metric-lbl" id="agentKpiAbandonRateLbl">Abandon rate &bull; target below 3%</div>
            <div class="camp-metric-val green" id="agentKpiAbandonRate">0.0%</div>
          </div>
          <div class="camp-metric-card" style="padding:14px 18px;">
            <div class="camp-metric-lbl">Avg talk time</div>
            <div class="camp-metric-val" id="agentKpiAvgTalkTime">00:00</div>
          </div>
        </div>

        <div class="dial-grid-cols">
          
          <!-- COL 1: Customer Information Card -->
          <div class="dial-col-card">
            <div class="dial-cust-name" id="agentScreenCustName">-</div>
            <div class="dial-cust-phone" id="agentScreenPhoneText">-</div>

            <!-- Clean Status & Priority Badges -->
            <div style="display:flex;align-items:center;gap:8px;margin:12px 0 16px 0;">
              <span id="agentScreenStatusBadge" class="dial-badge-gray">Idle</span>
              <span id="agentScreenTierTag" class="dial-badge-gray">Standard</span>
            </div>

            <!-- Hidden compatibility elements -->
            <div style="display:none;" id="agentScreenDebtAmount"></div>
            <div style="display:none;" id="agentScreenDebtDue"></div>

            <div class="dial-info-lbl">Contact Reference</div>
            <div class="dial-info-val" id="agentScreenAccountText">-</div>

            <div class="dial-info-lbl">Scheduled call time</div>
            <div class="dial-info-val" id="agentScreenCallTimeText">-</div>

            <div class="dial-info-lbl">Campaign</div>
            <div class="dial-info-val" id="agentScreenCampaignText">-</div>

            <div style="display:flex;gap:8px;margin-top:auto;padding-top:12px;">
              <span id="agentScreenLangTag" class="dial-badge-mint">English</span>
            </div>
          </div>

          <!-- COL 2: Agent Script & Interactive Checklist -->
          <div class="dial-col-card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0;">Agent script</h3>
              <span style="font-size:11.5px;color:#00A651;font-weight:600;">Campaign Specific</span>
            </div>

            <!-- Dynamic script speech bubble -->
            <div id="agentDynamicScriptBox" class="dial-script-bubble">
              Select a lead or start the campaign to load the agent script.
            </div>

            <!-- Checklist items -->
            <div class="dial-check-item" onclick="app.toggleAgentCheck(this)">
              <div class="dial-check-box checked">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <span>Greet customer and verify identity</span>
            </div>

            <div class="dial-check-item" onclick="app.toggleAgentCheck(this)">
              <div class="dial-check-box checked">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              </div>
              <span>Deliver campaign message &amp; information</span>
            </div>

            <div class="dial-check-item" onclick="app.toggleAgentCheck(this)">
              <div class="dial-check-box"></div>
              <span>Answer customer questions or feedback</span>
            </div>

            <div class="dial-check-item" onclick="app.toggleAgentCheck(this)">
              <div class="dial-check-box"></div>
              <span>Confirm outcome &amp; record next steps</span>
            </div>
          </div>

          <!-- COL 3: Outcome & Dispositions -->
          <div class="dial-col-card">
            <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 18px 0;">Outcome</h3>

            <div id="dialOutcomeList" style="margin-bottom:12px;">
              <label class="dial-outcome-opt active" onclick="app.selectAgentOutcome(this, 'fixed')">
                <span class="dial-radio-circle checked"></span>
                <span class="dial-outcome-text active">Fixed / Resolved</span>
              </label>

              <label class="dial-outcome-opt" onclick="app.selectAgentOutcome(this, 'told')">
                <span class="dial-radio-circle"></span>
                <span class="dial-outcome-text">Informed / Told</span>
              </label>

              <label class="dial-outcome-opt" onclick="app.selectAgentOutcome(this, 'callback')">
                <span class="dial-radio-circle"></span>
                <span class="dial-outcome-text">Call back requested</span>
              </label>

              <label class="dial-outcome-opt" onclick="app.selectAgentOutcome(this, 'no_answer')">
                <span class="dial-radio-circle"></span>
                <span class="dial-outcome-text">No answer / Busy</span>
              </label>

              <label class="dial-outcome-opt" onclick="app.selectAgentOutcome(this, 'wrong_number')">
                <span class="dial-radio-circle"></span>
                <span class="dial-outcome-text red">Wrong number / Not interested</span>
              </label>
            </div>

            <div style="margin-top:auto;">
              <label style="display:block;font-size:11.5px;color:#64748b;font-weight:500;margin-bottom:5px;">Follow-up / callback date</label>
              <select id="agentPromiseDateSelect" class="dial-input-box" style="margin-bottom:12px;">
                <option value="None" selected>None (Call Completed)</option>
                <option value="Tomorrow (+24h)">Tomorrow (+24h)</option>
                <option value="Today (by 5 PM)">Today (by 5 PM)</option>
                <option value="+3 Days">+3 Days</option>
                <option value="Next Week">Next Week</option>
              </select>

              <textarea id="agentCallNotesInput" class="dial-input-box" placeholder="Notes (optional)..." style="min-height:54px;resize:vertical;margin-bottom:12px;"></textarea>

              <!-- Agent SMS Follow-up toggle and instant trigger -->
              <div id="agentSmsActionRow" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
                <label style="display:flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;color:#166534;margin:0;cursor:pointer;">
                  <input type="checkbox" id="agentSendSmsOnSave" checked style="accent-color:#00A651;width:15px;height:15px;cursor:pointer;">
                  <span>Send SMS on Save</span>
                </label>
                <button type="button" onclick="app.openAgentSmsModal()" style="background:none;border:none;color:#0284c7;font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:4px;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                  Customize SMS
                </button>
              </div>

              <div style="display:flex;gap:10px;margin-bottom:10px;">
                <button type="button" class="dial-btn-outline" onclick="app.handleAgentSkipClick()">Skip</button>
                <button type="button" class="dial-btn-outline primary" onclick="app.handleAgentSaveNextClick()" style="flex:1;text-align:center;">Save &amp; next</button>
                <button type="button" class="dial-btn-outline" onclick="app.openAgentSmsModal()" style="border-color:#0284c7;color:#0284c7;padding:0 12px;display:inline-flex;align-items:center;justify-content:center;" title="Send SMS Now">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                </button>
              </div>

              <button type="button" class="dial-btn-dial" id="btnAgentDial" onclick="app.handleAgentDialClick()">Dial</button>
            </div>
          </div>

        </div>

        <!-- Live Interactive IVR Real-Time Keypad & Status Card -->
        <div id="agentInteractiveIvrBox" class="sc-panel" style="margin-top:16px;padding:16px 20px;border:1.5px solid #bbf7d0;border-radius:10px;background:#f0fdf4;display:none;">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:8px;background:#00A651;color:#fff;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15"></line>
                  <circle cx="18" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <path d="M18 9a9 9 0 0 1-9 9"></path>
                </svg>
              </span>
              <div>
                <div style="font-size:13.5px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;">
                  <span>Interactive IVR Live Session</span>
                  <span id="agentIvrStepBadge" style="background:#e8f8ee;color:#007A3D;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;border:1px solid #bbf7d0;">Playing Greeting</span>
                </div>
                <div id="agentIvrStatusDesc" style="font-size:12px;color:#475569;margin-top:2px;">
                  Customer is listening to opening announcement.
                </div>
              </div>
            </div>

            <!-- Real-time key pressed alert banner -->
            <div id="agentIvrKeyDetectedAlert" style="display:none;background:#ffffff;border:1.5px solid #00A651;padding:6px 14px;border-radius:8px;font-size:12.5px;font-weight:700;color:#007A3D;box-shadow:0 2px 6px rgba(0,166,81,0.15);">
              Caller Pressed Key <span id="agentIvrDetectedKeyNum" style="background:#00A651;color:#fff;padding:1px 6px;border-radius:4px;margin:0 4px;">1</span> : <span id="agentIvrDetectedKeyLabel">Confirmed</span>
            </div>

            <!-- Keypad Options Shortcut for Agent (can click on customer behalf or observe) -->
            <div id="agentIvrLiveKeypadButtons" style="display:flex;align-items:center;gap:8px;">
              <!-- Populated dynamically with configured key buttons -->
            </div>
          </div>
        </div>

        <!-- ── Number List & Calling Queue for Agent Screen ── -->
        <div class="sc-panel" style="margin-top:20px;padding:22px 24px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
            <div>
              <div style="font-size:15px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;">
                <span>Calling Queue : Number List</span>
                <span id="agentQueueNumberCountBadge" style="background:#e8f8ee;color:#00A651;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:10px;">0 numbers</span>
              </div>
              <div style="font-size:12px;color:#64748b;margin-top:2px;">
                Preview contact details above before calling, or click Call to dial directly.
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <input type="text" id="agentLeadSearch" placeholder="Search contact or phone..." style="font-size:12px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;width:220px;" oninput="app.filterAgentScreenNumbers(this.value)">
              <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.refreshAgentScreenQueue()" style="font-size:12px;padding:5px 12px;font-weight:600;">Refresh Queue</button>
            </div>
          </div>

          <div style="overflow-x:auto;">
            <table class="des-contact-table" style="width:100%;">
              <thead>
                <tr>
                  <th style="width:40px;">#</th>
                  <th>CUSTOMER NAME</th>
                  <th>PHONE NUMBER</th>
                  <th>REFERENCE</th>
                  <th>SCHEDULED TIME</th>
                  <th>STATUS</th>
                  <th style="text-align:right;">ACTIONS</th>
                </tr>
              </thead>
              <tbody id="agentNumbersTableBody">
                <!-- Dynamically populated with campaign contacts -->
              </tbody>
            </table>
          </div>
        </div>

      </div>


      <!-- ── SUB-VIEW B: PACING & COMPLIANCE (Screenshot 4) ── -->
      <div id="subViewDialerPacing" style="display:none;">
        <div style="display:grid;grid-template-columns:1fr 1.15fr;gap:20px;">
          <!-- Left: Pacing and compliance -->
          <div class="sc-panel" style="padding:22px 24px;">
            <div style="font-size:16px;font-weight:700;color:#143522;margin-bottom:18px;">Pacing and compliance</div>

            <div class="form-group" style="margin-bottom:18px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;">Dialing mode</label>
              <select class="form-control" id="pacingModeSelect" style="font-size:13px;padding:9px 12px;" onchange="app.setPacingMode(this.value)">
                <option value="preview" selected>Preview (Agent manual click before dialing)</option>
                <option value="progressive">Progressive (Sequential 1-to-1 lead connection)</option>
              </select>
            </div>

            <!-- Dial Ratio Slider -->
            <div class="form-group" style="margin-bottom:18px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;margin:0;">Dial ratio (1.0 to 3.0)</label>
                <span id="dialRatioVal" style="font-size:12px;font-weight:700;color:#00A651;">2.1</span>
              </div>
              <input type="range" id="pacingDialRatioSlider" min="1.0" max="3.0" step="0.1" value="2.1" class="form-control" style="padding:0;height:7px;accent-color:#00A651;" oninput="document.getElementById('dialRatioVal').textContent=parseFloat(this.value).toFixed(1)" onchange="app.savePacingSetting('dial_ratio', this.value)">
            </div>

            <!-- Max Abandon Rate Slider -->
            <div class="form-group" style="margin-bottom:18px;">
              <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
                <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;margin:0;">Maximum abandon rate (target below 3%)</label>
                <span id="abandonRateVal" style="font-size:12px;font-weight:700;color:#0082C8;">2.4%</span>
              </div>
              <input type="range" id="pacingMaxAbandonSlider" min="0.5" max="5.0" step="0.1" value="2.4" class="form-control" style="padding:0;height:7px;accent-color:#0082C8;" oninput="document.getElementById('abandonRateVal').textContent=parseFloat(this.value).toFixed(1)+'%'" onchange="app.savePacingSetting('max_abandon_rate', this.value)">
            </div>

            <!-- Calling Hours -->
            <div class="form-group" style="margin-bottom:18px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;">Calling hours</label>
              <select class="form-control" id="pacingCallingHoursSelect" style="font-size:13px;padding:9px 12px;" onchange="app.savePacingSetting('calling_hours', this.value)">
                <option value="standard" selected>Mon to Sat, 08:00 to 20:00</option>
                <option value="all_week">Mon to Sun, 08:30 to 21:00</option>
                <option value="business">Mon to Fri, 09:00 to 18:00</option>
              </select>
            </div>

            <!-- Max Attempts & Retry After -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div class="form-group">
                <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;">Max attempts</label>
                <select class="form-control" id="pacingMaxAttemptsSelect" style="font-size:13px;padding:9px 12px;" onchange="app.savePacingSetting('max_attempts', this.value)">
                  <option value="1">1 per contact</option>
                  <option value="2">2 per contact</option>
                  <option value="3" selected>3 per contact</option>
                  <option value="5">5 per contact</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" style="font-size:12px;font-weight:600;color:#1a3d2a;text-transform:none;">Retry after</label>
                <select class="form-control" id="pacingRetryAfterSelect" style="font-size:13px;padding:9px 12px;" onchange="app.savePacingSetting('retry_after', this.value)">
                  <option value="30m">30 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="2h" selected>2 hours</option>
                  <option value="4h">4 hours</option>
                  <option value="24h">24 hours</option>
                </select>
              </div>
            </div>
          </div>

          <!-- Right: Live pacing -->
          <div class="sc-panel" style="padding:22px 24px;">
            <div style="font-size:16px;font-weight:700;color:#143522;margin-bottom:18px;">Live pacing</div>

            <!-- 4 Metrics Cards -->
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:24px;">
              <div class="sc-stat-chip">
                <div class="sc-stat-val" id="pacingAgentsReady">0</div>
                <div class="sc-stat-lbl">Agents ready</div>
              </div>
              <div class="sc-stat-chip">
                <div class="sc-stat-val" id="pacingDialingNow">0</div>
                <div class="sc-stat-lbl">Dialing</div>
              </div>
              <div class="sc-stat-chip">
                <div class="sc-stat-val" id="pacingAbandonRate" style="color:#00A651;">0.0%</div>
                <div class="sc-stat-lbl">Abandon</div>
              </div>
              <div class="sc-stat-chip">
                <div class="sc-stat-val" id="pacingAvgTalk">00:00</div>
                <div class="sc-stat-lbl">Avg talk</div>
              </div>
            </div>

            <!-- Bar Chart -->
            <div style="font-size:12.5px;color:#1a3d2a;font-weight:600;margin-bottom:8px;">Calls dialed per 10 minutes</div>
            <div class="sc-barchart" id="pacingCallsBarChart">
              <div class="sc-bar" style="height:35%;" title="10 min ago: 12 calls"></div>
              <div class="sc-bar" style="height:55%;" title="20 min ago: 19 calls"></div>
              <div class="sc-bar" style="height:65%;" title="30 min ago: 22 calls"></div>
              <div class="sc-bar" style="height:50%;" title="40 min ago: 17 calls"></div>
              <div class="sc-bar highlight" style="height:88%;" title="Current peak: 31 calls"></div>
              <div class="sc-bar" style="height:62%;" title="60 min: 21 calls"></div>
              <div class="sc-bar" style="height:58%;" title="70 min: 20 calls"></div>
              <div class="sc-bar" style="height:70%;" title="80 min: 24 calls"></div>
              <div class="sc-bar" style="height:64%;" title="90 min: 22 calls"></div>
              <div class="sc-bar" style="height:48%;" title="100 min: 16 calls"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- ── SUB-VIEW C: QUEUE & PBX LINES ── -->
      <div id="subViewDialerQueue" style="display:none;">
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
                <label for="dialingModeSelect">Mode:</label>
                <select id="dialingModeSelect">
                  <option value="preview" selected>Preview Dialing</option>
                  <option value="progressive">Progressive Dialing</option>
                  <option value="agentless">Agentless Voice Broadcast</option>
                  <option value="callback">Callback Assist</option>
                </select>
              </div>
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
            <button id="btnOpenRetrySettings" class="btn btn-secondary" onclick="app.openRetrySettingsModal()" style="border-color:#93c5fd;color:#0047AB;" title="Configure Call Retry and Scheduling Rules">⚙️ Retry Rules</button>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;">
          <!-- Left: Lines & Queue -->
          <div>
            <!-- Active Outbound Lines -->
            <div style="background:#fafbfc;border:1px solid #dbe8df;border-radius:10px;padding:16px;margin-bottom:20px;">
              <div style="font-size:12px;font-weight:700;color:#0c3629;text-transform:uppercase;margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                <span class="live-dot"></span> Active Outbound Lines
              </div>
              <div id="activeChannelsGrid" class="channels-grid"></div>
            </div>

            <!-- Quick Add Contact Form -->
            <div class="quick-add-card">
              <div class="quick-add-header">
                <span style="font-weight:700;color:#0c3629;font-size:12.5px;">Quick Add Contact &amp; Schedule Call</span>
                <span style="font-size:11px;color:#64748b;">Schedule for today or any future date/time</span>
              </div>
              <form id="formQuickAddLead" class="quick-add-form" onsubmit="app.handleQuickAddSubmit(event)">
                <input type="text" id="quickAddName" class="form-control" placeholder="Name (e.g. Helen Tesfaye)" required style="flex:1;min-width:120px;">
                <input type="tel" id="quickAddPhone" class="form-control" placeholder="Phone (e.g. 0911223344)" required style="flex:1.2;min-width:140px;">
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
                  <button type="submit" class="btn btn-primary btn-sm">Add to Queue</button>
                  <button type="button" class="btn btn-success btn-sm" onclick="app.quickAddAndCall()">Call Now</button>
                </div>
              </form>
            </div>

            <!-- Queue Table -->
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
              <div style="font-size:14px;font-weight:700;color:#1e293b;">Customer Calling Queue</div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button class="btn btn-secondary btn-sm" onclick="app.openVerificationModal()" style="border-color:#38bdf8;color:#0284c7;background:#f0f9ff;" title="Verify Phone Numbers format">🛡️ Verify List</button>
                <button class="btn btn-primary btn-sm" onclick="app.openModal('modalUpload')">Upload CSV File</button>
                <button class="btn btn-secondary btn-sm" onclick="app.openModal('modalManual')">Bulk Write Numbers</button>
                <button class="btn btn-danger btn-sm" onclick="app.clearQueue()" style="background:#fee2e2;color:#b91c1c;border-color:#fca5a5;">Clear Queue</button>
              </div>
            </div>

            <div class="data-table-wrapper">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Customer Name</th>
                    <th>Phone Number</th>
                    <th>Campaign</th>
                    <th>Scheduled Call Time</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody id="leadsTableBody"></tbody>
              </table>
            </div>
          </div>

          <!-- Right: Human IVR Audio Box -->
          <div>
            <div style="background:#f9fcf9;border:1px solid #dbe8df;border-radius:10px;padding:16px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <div style="font-size:13px;font-weight:700;color:#0c3629;">Human IVR Audio</div>
                <button class="btn btn-secondary btn-sm" onclick="app.openModal('modalAudioUpload')">Upload Audio</button>
              </div>
              <p style="font-size:11.5px;color:#64748b;margin-bottom:10px;">
                Plays automatically when customer answers the outbound call:
              </p>

              <div style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11px;">Selected Recording:</label>
                <select id="ivrAudioSelector" class="form-control" style="font-size:12.5px;"></select>
              </div>

              <div style="background:#ffffff;padding:12px;border-radius:8px;border:1px solid #cbd5e1;">
                <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:6px;" id="activeAudioTitle">Active IVR Audio</div>
                <audio id="mainAudioPlayer" controls style="width:100%;height:36px;outline:none;" src=""></audio>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================================
         VIEW: SMS CAMPAIGNS MESSENGER & SCHEDULED QUEUE
         Dedicated SMS operations workspace matching Dialer layout
         ======================================================== -->
    <div class="tab-panel" id="tabSmsCampaigns">

      <!-- SMS KPI Strip (Screenshot Match) -->
      <div class="camp-metric-row" style="margin-bottom:18px;">
        <div class="camp-metric-card" style="padding:14px 18px;">
          <div class="camp-metric-lbl">Active SMS Campaigns</div>
          <div class="camp-metric-val" id="smsKpiActiveCamps">0</div>
        </div>
        <div class="camp-metric-card" style="padding:14px 18px;">
          <div class="camp-metric-lbl">Total SMS Sent</div>
          <div class="camp-metric-val" id="smsKpiTotalSent">0</div>
        </div>
        <div class="camp-metric-card" style="padding:14px 18px;">
          <div class="camp-metric-lbl">Pending SMS</div>
          <div class="camp-metric-val" style="color:#0284c7;" id="smsKpiPending">0</div>
        </div>
        <div class="camp-metric-card" style="padding:14px 18px;">
          <div class="camp-metric-lbl">Delivery Rate</div>
          <div class="camp-metric-val green" id="smsKpiDeliveryRate">100.0%</div>
        </div>
      </div>

      <!-- TOP CONTROLS CARD: Modes, Status, Actions & Campaign Chooser -->
      <div class="dial-top-card">
        <!-- Row 1: Left: Launch, Pause, Stop & Status | Right: Next Scheduled Timer + Quick Actions -->
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <!-- Controls: Launch, Pause, Stop + Status -->
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="display:inline-flex;align-items:center;gap:6px;">
              <button type="button" id="btnLaunchSmsDispatcher" class="btn btn-sm btn-success" onclick="app.startSmsDispatcher()" style="font-size:12px;font-weight:700;background:#00A651;border:none;display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;cursor:pointer;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Launch</span>
              </button>
              <button type="button" id="btnPauseSmsDispatcher" class="btn btn-sm btn-warning" onclick="app.togglePauseSmsDispatcher()" disabled style="font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;cursor:pointer;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                <span id="btnPauseSmsLabel">Pause</span>
              </button>
              <button type="button" id="btnStopSmsDispatcher" class="btn btn-sm btn-danger" onclick="app.stopSmsDispatcher()" disabled style="font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:5px;padding:6px 14px;border-radius:6px;cursor:pointer;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14"></rect></svg>
                <span>Stop</span>
              </button>
            </div>

            <div class="dial-status-pill" id="smsDispatcherStatusPill">
              <span class="dot" id="smsDispatcherStatusDot"></span>
              <span id="smsQueueStatusText">Ready &middot; 0 messages in queue</span>
            </div>
          </div>

          <!-- Live Next Scheduled Timer Banner (Matches Voice Dialer countdown timer) -->
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div id="smsNextScheduledTimerBanner" style="display:inline-flex;align-items:center;gap:8px;background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:5px 12px;">
              <span style="font-size:11px;font-weight:800;color:#166534;letter-spacing:0.5px;">NEXT SEND:</span>
              <span id="smsNextTimerContact" style="font-size:12px;font-weight:700;color:#0f172a;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">-</span>
              <span id="smsNextTimerTime" style="font-size:11.5px;color:#15803d;font-weight:600;">-</span>
              <span id="smsNextCountdownBadge" style="background:#15803d;color:#ffffff;font-size:11.5px;font-weight:800;font-family:monospace;padding:2px 8px;border-radius:10px;">
                Idle
              </span>
            </div>

            <!-- Auto-Schedule Stagger Button -->
            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.reapplySmsAutoSchedule()" style="font-size:12px;font-weight:600;" title="Re-calculate staggered send times for pending contacts">
              Auto-Schedule (Stagger)
            </button>

            <!-- Dispatch All Pending Button -->
            <button type="button" class="btn btn-sm btn-success" onclick="app.dispatchSmsCampaignPrompt()" style="font-size:12px;font-weight:700;background:#00A651;border:none;">
              Dispatch All Pending
            </button>

            <!-- New SMS Campaign Modal Button -->
            <button type="button" class="btn btn-sm btn-primary" onclick="app.openNewSmsCampaignModal()" style="font-size:12px;font-weight:700;background:#0284c7;border:none;display:inline-flex;align-items:center;gap:4px;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>+ New SMS Campaign</span>
            </button>
          </div>
        </div>

        <!-- Row 2: Campaign Selector (at the top, exactly like Dialer!) -->
        <div class="dial-campaign-row">
          <div style="display:flex;align-items:center;gap:14px;flex:1;max-width:640px;">
            <label style="font-size:13.5px;font-weight:700;color:#0f172a;white-space:nowrap;margin:0;">SMS Campaign</label>
            <select id="smsDispatcherCampaignDropdown" class="dial-campaign-select" onchange="app.handleSmsDispatcherCampaignChange(this.value)">
              <option value="" selected>Select SMS Campaign</option>
            </select>
          </div>

          <!-- Campaign Info Strip -->
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12.5px;color:#475569;">
            <span>Sender ID: <strong id="smsCampSenderIdBadge" style="color:#0f172a;">SkyConnect</strong></span>
            <span>&bull;</span>
            <span>Strategy: <strong id="smsCampStrategyBadge" style="color:#15803d;">Auto-Schedule (5m)</strong></span>
            <span>&bull;</span>
            <button type="button" onclick="app.openEditSmsTemplateModal()" style="background:none;border:none;color:#0284c7;font-weight:700;font-size:12.5px;cursor:pointer;text-decoration:underline;padding:0;">Edit Template</button>
          </div>
        </div>
      </div>

      <!-- ACTIVE / NEXT MESSAGE CONSOLE (3 Columns Match to Agent Screen) -->
      <div class="dial-grid-cols" style="margin-bottom:20px;">

        <!-- COL 1: Customer Information & Scheduled Send Time -->
        <div class="dial-col-card">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;">
            <div>
              <div class="dial-cust-name" id="smsNextCustName">-</div>
              <div class="dial-cust-phone" id="smsNextPhoneText" style="margin-bottom:8px;">-</div>
            </div>
            <span id="smsNextStatusBadge" class="dial-badge-gray">Idle</span>
          </div>

          <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px;">
            <div>
              <div class="dial-info-lbl">Scheduled Send Time</div>
              <div class="dial-info-val" id="smsNextScheduledTimeText" style="color:#15803d;font-weight:700;display:flex;align-items:center;gap:6px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                <span>-</span>
              </div>
            </div>

            <div>
              <div class="dial-info-lbl">Contact Reference</div>
              <div class="dial-info-val" id="smsNextAccountText">-</div>
            </div>

            <div>
              <div class="dial-info-lbl">SMS Campaign</div>
              <div class="dial-info-val" id="smsNextCampaignText">-</div>
            </div>
          </div>

          <div style="display:flex;gap:8px;margin-top:auto;padding-top:14px;">
            <span id="smsNextTierTag" class="dial-badge-mint">Standard Priority</span>
          </div>
        </div>

        <!-- COL 2: Message Template & Live Rendered Preview -->
        <div class="dial-col-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0;">SMS Message Preview</h3>
            <span style="font-size:11.5px;color:#00A651;font-weight:600;">Personalized Live</span>
          </div>

          <!-- Dynamic SMS speech bubble -->
          <div id="smsNextMessageBubble" class="dial-script-bubble" style="background:#f8fafc;border-left:3px solid #00A651;padding:14px;border-radius:8px;font-size:13px;line-height:1.5;color:#1e293b;min-height:92px;">
            Select an SMS campaign to preview personalized message.
          </div>

          <!-- Counter & Segment Info -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:11.5px;color:#64748b;">
            <span id="smsNextCharCount">0 / 160 characters (1 SMS segment)</span>
            <button type="button" onclick="app.openEditSmsTemplateModal()" style="background:none;border:none;color:#0284c7;font-weight:600;font-size:11.5px;cursor:pointer;">Customize</button>
          </div>

          <!-- Variable Pills -->
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;padding-top:10px;border-top:1px dashed #e2e8f0;align-items:center;">
            <span style="font-size:11px;color:#64748b;font-weight:600;">Available Tags:</span>
            <span style="font-size:11px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:4px;font-family:monospace;">{name}</span>
            <span style="font-size:11px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:4px;font-family:monospace;">{phone}</span>
            <span style="font-size:11px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:4px;font-family:monospace;">{campaign}</span>
            <span style="font-size:11px;background:#f1f5f9;color:#0f172a;padding:2px 7px;border-radius:4px;font-family:monospace;">{account}</span>
          </div>
        </div>

        <!-- COL 3: Dispatch & Action Controls -->
        <div class="dial-col-card">
          <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 14px 0;">Message Actions</h3>

          <div style="font-size:12px;color:#64748b;margin-bottom:12px;line-height:1.5;">
            Dispatch this message directly via the SMS gateway, or advance to the next contact in queue.
          </div>

          <div style="margin-top:auto;">
            <div style="display:flex;gap:10px;margin-bottom:10px;">
              <button type="button" class="dial-btn-outline" onclick="app.handleSmsSkipClick()" style="flex:1;">Skip</button>
              <button type="button" class="dial-btn-outline primary" onclick="app.handleSmsSaveNextClick()" style="flex:1;">Next Contact</button>
            </div>

            <!-- Primary Action Button (Matches Dial button) -->
            <button type="button" class="dial-btn-dial" id="btnSmsSendNext" onclick="app.handleSmsSendCurrentContact()" style="background:#00A651;color:#fff;display:inline-flex;align-items:center;justify-content:center;gap:8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              <span>Send SMS Now</span>
            </button>
          </div>
        </div>

      </div>

      <!-- SMS CAMPAIGN CONTACTS & SCHEDULED QUEUE TABLE (Matches Picture 2) -->
      <div class="sc-panel" style="padding:22px 24px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;">
        <!-- Header Controls Row -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:16px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;">
              <span>SMS Campaign Contacts</span>
              <span id="smsQueueTableCountBadge" style="font-size:12px;font-weight:600;color:#64748b;">0 contacts (0 sent, 0 pending)</span>
            </div>
            <div style="font-size:12px;color:#64748b;margin-top:2px;">
              View scheduled delivery times, personalized messages, and live delivery status.
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <input type="text" id="smsLeadSearch" placeholder="Search contacts..." style="font-size:12.5px;padding:7px 12px;border:1px solid #cbd5e1;border-radius:6px;width:190px;" oninput="app.filterSmsQueueTable(this.value)">

            <select id="smsLeadStatusFilter" style="font-size:12.5px;padding:7px 12px;border:1px solid #cbd5e1;border-radius:6px;" onchange="app.filterSmsQueueStatus(this.value)">
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="completed">Sent / Delivered</option>
              <option value="failed">Failed</option>
            </select>

            <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.exportSmsQueueCsv()" style="font-size:12px;padding:6px 14px;font-weight:600;">
              Export CSV
            </button>

            <button type="button" class="btn btn-sm btn-success" onclick="app.dispatchSmsCampaignPrompt()" style="font-size:12px;padding:6px 14px;font-weight:700;background:#00A651;border:none;">
              Dispatch All Pending
            </button>

            <button type="button" class="btn btn-sm btn-success" onclick="app.openAddSmsContactsModal()" style="font-size:12px;padding:6px 14px;font-weight:700;background:#00A651;border:none;">
              Add numbers
            </button>
          </div>
        </div>

        <!-- Table -->
        <div style="overflow-x:auto;">
          <table class="des-contact-table" style="width:100%;">
            <thead>
              <tr>
                <th style="width:40px;">#</th>
                <th>CUSTOMER</th>
                <th>PHONE</th>
                <th>SCHEDULED</th>
                <th>SMS STATUS</th>
                <th>MESSAGE PREVIEW</th>
                <th style="text-align:right;">ACTIONS</th>
              </tr>
            </thead>
            <tbody id="smsQueueTableBody">
              <!-- Dynamically populated -->
            </tbody>
          </table>
        </div>

        <!-- Show more button -->
        <div id="smsQueueShowMoreWrap" style="text-align:center;margin-top:14px;display:none;">
          <button type="button" id="btnSmsQueueShowMore" class="btn btn-sm btn-outline-secondary" onclick="app.showMoreSmsContacts()" style="font-size:12px;padding:7px 24px;font-weight:600;">
            Show more contacts
          </button>
        </div>
      </div>

    </div>

    <!-- ========================================================
         VIEW 3: CALLBACKS (Unanswered / Scheduled Callbacks)
         ======================================================== -->

    <!-- ========================================================
         VIEW 3: UNANSWERED & CALLBACKS (Clean Tabs & Rescheduling)
         ======================================================== -->
    <div class="tab-panel" id="tabCallbacks">
      <div class="unans-panel-card">
        <!-- Top Header: Title, Subtitle, and Top Action Buttons -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;flex-wrap:wrap;gap:14px;">
          <div>
            <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px 0;">Unanswered and callbacks</h1>
            <div style="font-size:12.5px;color:#64748b;" id="callbacksSubtitle">Calls that were not answered, were busy, or failed, and follow-up calls requested by contacts.</div>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button type="button" class="unans-btn-export" onclick="app.exportUnansweredCsv()">Export CSV</button>
            <button type="button" class="unans-btn-bulk-smart" onclick="app.openBulkSmartRescheduleModal()">Bulk reschedule with smart plan</button>
          </div>
        </div>

        <!-- Segmented Subtabs: Unanswered vs Scheduled Callbacks -->
        <div class="unans-subtabs-row">
          <button type="button" class="unans-subtab-btn active" id="unansTabBtnMissed" onclick="app.switchUnansweredSubTab('unanswered')">
            <span>Unanswered</span>
            <span class="unans-tab-count" id="unansTabCountBadge">0</span>
          </button>
          <button type="button" class="unans-subtab-btn" id="unansTabBtnCallbacks" onclick="app.switchUnansweredSubTab('callbacks')">
            <span>Scheduled callbacks</span>
            <span class="unans-tab-count" id="callbacksTabCountBadge">0</span>
          </button>
        </div>

        <!-- 4 Metric Cards Grid -->
        <div class="unans-metrics-grid" id="unansMetricsRow">
          <div class="unans-metric-card active" id="unansCardAll" onclick="app.filterByResultCard('')">
            <div class="unans-metric-label">All unanswered</div>
            <div class="unans-metric-value" id="unansMetricAll">0</div>
          </div>
          <div class="unans-metric-card" id="unansCardNoAnswer" onclick="app.filterByResultCard('no_answer')">
            <div class="unans-metric-label">No answer</div>
            <div class="unans-metric-value" id="unansMetricNoAnswer">0</div>
          </div>
          <div class="unans-metric-card" id="unansCardBusy" onclick="app.filterByResultCard('busy')">
            <div class="unans-metric-label">Busy</div>
            <div class="unans-metric-value" id="unansMetricBusy">0</div>
          </div>
          <div class="unans-metric-card" id="unansCardFailed" onclick="app.filterByResultCard('failed')">
            <div class="unans-metric-label">Failed</div>
            <div class="unans-metric-value" id="unansMetricFailed">0</div>
          </div>
        </div>

        <!-- Filter Panel -->
        <div class="unans-filter-panel">
          <div class="unans-filter-row-top">
            <div class="unans-filter-group">
              <label class="unans-filter-lbl">Date</label>
              <div class="unans-date-pills">
                <button type="button" class="unans-date-pill active" id="datePillToday" onclick="app.setUnansDatePreset('today')">Today</button>
                <button type="button" class="unans-date-pill" id="datePillYesterday" onclick="app.setUnansDatePreset('yesterday')">Yesterday</button>
                <button type="button" class="unans-date-pill" id="datePill7Days" onclick="app.setUnansDatePreset('7days')">Last 7 days</button>
                <button type="button" class="unans-date-pill" id="datePill30Days" onclick="app.setUnansDatePreset('30days')">Last 30 days</button>
                <button type="button" class="unans-date-pill" id="datePillCustom" onclick="app.setUnansDatePreset('custom')">Custom</button>
              </div>
            </div>

            <div class="unans-filter-group" style="width:130px;">
              <label class="unans-filter-lbl">From</label>
              <input type="date" id="unansDateFrom" class="unans-date-input" onchange="app.onUnansDateInputChange()">
            </div>

            <div class="unans-filter-group" style="width:130px;">
              <label class="unans-filter-lbl">To</label>
              <input type="date" id="unansDateTo" class="unans-date-input" onchange="app.onUnansDateInputChange()">
            </div>

            <div class="unans-filter-group" style="min-width:120px;">
              <label class="unans-filter-lbl">Call result</label>
              <select id="callbackStatusFilter" class="unans-select-input" onchange="app.onUnansFilterChange()">
                <option value="">All results</option>
                <option value="no_answer">No answer</option>
                <option value="busy">Busy</option>
                <option value="failed">Failed</option>
              </select>
            </div>

            <div class="unans-filter-group" style="min-width:130px;">
              <label class="unans-filter-lbl">Campaign</label>
              <select id="callbackCampaignFilter" class="unans-select-input" onchange="app.onUnansFilterChange()">
                <option value="">All campaigns</option>
              </select>
            </div>

            <div class="unans-filter-group" style="min-width:120px;">
              <label class="unans-filter-lbl">Schedule</label>
              <select id="callbackScheduleFilter" class="unans-select-input" onchange="app.onUnansFilterChange()">
                <option value="">All schedules</option>
                <option value="today">Today</option>
                <option value="past_due">Past due</option>
                <option value="upcoming">Upcoming</option>
              </select>
            </div>
          </div>

          <div style="margin-top:14px;">
            <label class="unans-filter-lbl">Search</label>
            <div style="display:flex;align-items:center;gap:16px;">
              <div style="flex:1;">
                <input type="text" id="callbackSearchInput" placeholder="Name or phone number" class="unans-search-input" oninput="app.onUnansFilterChange()">
              </div>
              <button type="button" class="unans-clear-filters-btn" onclick="app.clearUnansFilters()">Clear filters</button>
            </div>
          </div>
        </div>

        <!-- Batch Action Bar -->
        <div class="unans-batch-bar" id="unansBatchBar" style="display:flex;">
          <div class="unans-batch-left">
            <span id="unansBatchSelectedCount">0 selected</span>
          </div>
          <div class="unans-batch-actions">
            <button type="button" class="unans-btn-requeue-batch" onclick="app.requeueSelectedUnanswered()">Re-queue selected</button>
            <button type="button" class="unans-btn-resched-batch" onclick="app.rescheduleSelectedUnanswered()">Reschedule selected</button>
            <button type="button" class="unans-btn-clear-selection" onclick="app.clearUnansweredSelection()">Clear selection</button>
          </div>
        </div>

        <!-- Table -->
        <div class="unans-table-wrapper">
          <table class="unans-table">
            <thead>
              <tr id="unansTableHeaderRow">
                <th style="width:36px;text-align:center;">
                  <input type="checkbox" id="unansSelectAllCheck" onchange="app.toggleSelectAllUnanswered(this.checked)">
                </th>
                <th>CUSTOMER</th>
                <th>PHONE NUMBER</th>
                <th>CAMPAIGN</th>
                <th>CALL RESULT</th>
                <th>ATTEMPTS</th>
                <th>LAST ATTEMPT</th>
                <th>SCHEDULED CALL</th>
                <th style="text-align:right;">ACTIONS</th>
              </tr>
            </thead>
            <tbody id="unansweredTableBody"></tbody>
          </table>
        </div>

        <!-- Pagination Footer -->
        <div class="unans-footer-row">
          <div id="unansPaginationShowingText" style="font-size:12.5px;color:#64748b;">
            Showing 0 of 0 unanswered calls
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#64748b;">
              <span>Rows per page</span>
              <select id="unansRowsPerPage" class="unans-rows-select" onchange="app.onUnansRowsPerPageChange(this.value)">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="unans-page-nav-btn" id="unansBtnPrevPage" onclick="app.prevUnansPage()">Previous</button>
              <button type="button" class="unans-page-nav-btn" id="unansBtnNextPage" onclick="app.nextUnansPage()">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================================
         VIEW: INTERACTIVE IVR RESPONSES & ANALYTICS
         ======================================================== -->
    <div class="tab-panel" id="tabIvrResponses">
      <div class="unans-panel-card">
        <!-- Page Top Header -->
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
          <div>
            <h2 class="unans-title" style="font-size:22px;font-weight:700;color:#0f172a;margin:0 0 4px 0;">Interactive IVR Responses</h2>
            <p class="unans-subtitle" style="font-size:13px;color:#64748b;margin:0;">
              Track caller keypad responses, menu choices, and automated outcomes for interactive campaigns.
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:10px;">
            <button type="button" class="unans-btn-export" onclick="app.loadIvrResponsesReport()">Refresh</button>
            <button type="button" class="unans-btn-bulk-smart" onclick="app.exportIvrResponsesCsv()">Export CSV</button>
          </div>
        </div>

        <!-- Interactive Campaign Selector Bar -->
        <div style="background:#f8fafc;border:1.5px solid #bbf7d0;border-radius:10px;padding:14px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:8px;">
              <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#00A651;"></span>
              <span>Interactive Campaign:</span>
            </div>
            <select id="ivrRespCampaignSelect" class="unans-select-input" style="min-width:260px;font-weight:600;font-size:13px;padding:8px 12px;border:1.5px solid #00A651;color:#0f172a;" onchange="app.onIvrRespCampaignChange(this.value)">
              <option value="">Loading interactive campaigns...</option>
            </select>
          </div>
          <div style="font-size:12px;color:#64748b;">
            Only showing campaigns configured with <strong style="color:#007A3D;">Interactive IVR</strong>.
          </div>
        </div>

        <!-- KPI Metric Cards Grid -->
        <div class="unans-metrics-grid" style="margin-bottom:18px;">
          <div class="unans-metric-card active" id="ivrCardTotal" onclick="app.filterIvrByCard('all')">
            <div class="unans-metric-label">Total IVR Calls</div>
            <div class="unans-metric-value" id="ivrKpiTotalCalls">0</div>
          </div>
          <div class="unans-metric-card" id="ivrCardKey1" onclick="app.filterIvrByCard('1')">
            <div class="unans-metric-label" style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;background:#00A651;color:#fff;font-size:10px;font-weight:800;">1</span>
              <span>Option 1 (Confirmed)</span>
            </div>
            <div class="unans-metric-value" style="color:#007A3D;" id="ivrKpiKey1Calls">0</div>
          </div>
          <div class="unans-metric-card" id="ivrCardKey2" onclick="app.filterIvrByCard('2')">
            <div class="unans-metric-label" style="display:flex;align-items:center;gap:6px;">
              <span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:4px;background:#2563eb;color:#fff;font-size:10px;font-weight:800;">2</span>
              <span>Option 2 (Callback)</span>
            </div>
            <div class="unans-metric-value" style="color:#1d4ed8;" id="ivrKpiKey2Calls">0</div>
          </div>
          <div class="unans-metric-card" id="ivrCardKeyNone" onclick="app.filterIvrByCard('none')">
            <div class="unans-metric-label">No Key / Timeout</div>
            <div class="unans-metric-value" style="color:#64748b;" id="ivrKpiNoneCalls">0</div>
          </div>
        </div>

        <!-- Keypad Choice Distribution Visual Bar -->
        <div style="padding:14px 18px;border:1px solid #e2e8f0;border-radius:10px;background:#ffffff;margin-bottom:18px;">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;font-weight:700;color:#334155;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <span>Caller Key Distribution</span>
            <div style="display:flex;align-items:center;gap:16px;font-size:11.5px;font-weight:600;flex-wrap:wrap;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#00A651;"></span>
                Key 1 Confirmed (<span id="ivrDistKey1Text">0%</span>)
              </span>
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#3b82f6;"></span>
                Key 2 Callback (<span id="ivrDistKey2Text">0%</span>)
              </span>
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#94a3b8;"></span>
                No Key (<span id="ivrDistNoneText">0%</span>)
              </span>
            </div>
          </div>
          <div class="ivr-dist-bar-wrapper">
            <div class="ivr-dist-bar-seg key-1" id="ivrDistBarKey1" style="width:0%;"></div>
            <div class="ivr-dist-bar-seg key-2" id="ivrDistBarKey2" style="width:0%;"></div>
            <div class="ivr-dist-bar-seg none" id="ivrDistBarNone" style="width:100%;"></div>
          </div>
        </div>

        <!-- Filter Panel -->
        <div class="unans-filter-panel" style="margin-bottom:18px;">
          <div class="unans-filter-row-top">
            <div class="unans-filter-group">
              <label class="unans-filter-lbl">Date</label>
              <div class="unans-date-pills">
                <button type="button" class="unans-date-pill active" id="ivrRespDatePresetToday" onclick="app.setIvrRespDatePreset('today')">Today</button>
                <button type="button" class="unans-date-pill" id="ivrRespDatePresetYesterday" onclick="app.setIvrRespDatePreset('yesterday')">Yesterday</button>
                <button type="button" class="unans-date-pill" id="ivrRespDatePreset7d" onclick="app.setIvrRespDatePreset('7d')">Last 7 days</button>
                <button type="button" class="unans-date-pill" id="ivrRespDatePreset30d" onclick="app.setIvrRespDatePreset('30d')">Last 30 days</button>
                <button type="button" class="unans-date-pill" id="ivrRespDatePresetCustom" onclick="app.setIvrRespDatePreset('custom')">Custom</button>
              </div>
            </div>

            <div class="unans-filter-group" style="width:130px;">
              <label class="unans-filter-lbl">From</label>
              <input type="date" id="ivrRespDateFrom" class="unans-date-input" onchange="app.onIvrRespDateInputChange()">
            </div>

            <div class="unans-filter-group" style="width:130px;">
              <label class="unans-filter-lbl">To</label>
              <input type="date" id="ivrRespDateTo" class="unans-date-input" onchange="app.onIvrRespDateInputChange()">
            </div>

            <div class="unans-filter-group" style="min-width:180px;">
              <label class="unans-filter-lbl">Key pressed</label>
              <select id="ivrRespKeySelect" class="unans-select-input" onchange="app.onIvrRespFilterChange()">
                <option value="">All responses</option>
                <option value="1">Key 1 (Confirmed)</option>
                <option value="2">Key 2 (Callback Requested)</option>
                <option value="none">No Key Pressed / Timeout</option>
              </select>
            </div>
          </div>

          <div style="margin-top:14px;">
            <label class="unans-filter-lbl">Search</label>
            <div style="display:flex;align-items:center;gap:16px;">
              <div style="flex:1;">
                <input type="text" id="ivrRespSearchInput" placeholder="Search contact name or phone number..." class="unans-search-input" oninput="app.onIvrRespFilterChange()">
              </div>
              <button type="button" class="unans-clear-filters-btn" onclick="app.clearIvrRespFilters()">Clear filters</button>
            </div>
          </div>
        </div>

        <!-- Table -->
        <div class="unans-table-wrapper">
          <table class="unans-table">
            <thead>
              <tr>
                <th style="width:40px;">#</th>
                <th>CUSTOMER</th>
                <th>PHONE NUMBER</th>
                <th>CAMPAIGN</th>
                <th>KEY PRESSED</th>
                <th>OUTCOME / ACTION</th>
                <th>DURATION</th>
                <th>DATE &amp; TIME</th>
                <th style="text-align:right;">ACTIONS</th>
              </tr>
            </thead>
            <tbody id="ivrResponsesTableBody">
              <!-- Rendered dynamically by app.renderIvrResponsesTable() -->
            </tbody>
          </table>
        </div>

        <!-- Pagination Footer -->
        <div class="unans-footer-row">
          <div id="ivrRespPaginationShowingText" style="font-size:12.5px;color:#64748b;">
            Showing 0 of 0 responses
          </div>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:#64748b;">
              <span>Rows per page</span>
              <select id="ivrRespRowsPerPage" class="unans-rows-select" onchange="app.onIvrRespRowsPerPageChange(this.value)">
                <option value="10">10</option>
                <option value="25" selected>25</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="unans-page-nav-btn" id="ivrRespBtnPrevPage" onclick="app.prevIvrRespPage()">Previous</button>
              <button type="button" class="unans-page-nav-btn" id="ivrRespBtnNextPage" onclick="app.nextIvrRespPage()">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ========================================================
         VIEW 4: REPORTS (KPIs, Call Logs & History)
         ======================================================== -->
    <div class="tab-panel" id="tabReports">
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
          <div class="card-sub">Audio broadcast played</div>
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

      <!-- Call Logs Section -->
      <div class="sc-panel" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div style="font-size:15px;font-weight:700;color:#0c3629;">Live Call Dispositions</div>
          <button id="btnExportLogs" class="btn btn-primary btn-sm">Export to CSV</button>
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
            <tbody id="logsTableBody"></tbody>
          </table>
        </div>
      </div>

      <!-- Call History & Past Records -->
      <div class="sc-panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:15px;font-weight:700;color:#0c3629;">Call History &amp; Past Records</div>
            <div style="font-size:12px;color:#526e5f;">Review previous days, check dispositions, or roll over remaining contacts.</div>
          </div>
          <div style="display:flex;gap:8px;">
            <button class="btn btn-primary btn-sm" onclick="app.bulkRolloverRemainingToToday()" id="btnHistoryRollover">
              Roll Over Remaining to Today (<span id="historyRolloverCount">0</span>)
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.exportHistoryCsv()">Export CSV</button>
          </div>
        </div>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex:1;">
            <select id="historyDateSelect" class="form-control" style="font-size:12px;min-width:140px;" onchange="app.handleHistoryDateFilter(this.value)">
              <option value="all">All Past Dates</option>
              <option value="yesterday">Yesterday</option>
            </select>
            <input type="date" id="historyCustomDatePicker" class="form-control" style="font-size:12px;max-width:140px;" onchange="app.handleHistoryCustomDate(this.value)">
            <input type="text" id="historySearchInput" class="form-control" placeholder="Search customer or phone..." style="font-size:12px;min-width:180px;max-width:280px;" oninput="app.renderHistoryTable()">
            <select id="historyStatusFilter" class="form-control" style="font-size:12px;min-width:140px;" onchange="app.renderHistoryTable()">
              <option value="all">All Dispositions</option>
              <option value="answered">Answered / Completed</option>
              <option value="no_answer">No Answer</option>
              <option value="busy">Busy</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
            </select>
          </div>
          <div style="background:#e0f2fe;color:#0369a1;padding:4px 12px;border-radius:14px;font-size:11.5px;font-weight:700;" id="historyTotalRecordsTag">0 records</div>
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
            <tbody id="historyTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ========================================================
         VIEW 6: COMPLIANCE & DNC REGISTRY
         ======================================================== -->
    <div class="tab-panel" id="tabCompliance">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px;">
        <div>
          <div style="font-size:16px;font-weight:700;color:#143522;">Compliance &amp; Do-Not-Call (DNC) Registry</div>
          <div style="font-size:12px;color:#526e5f;">Retry limits and opt-out scrubbing.</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-primary btn-sm" onclick="app.scrubQueueDnc()" title="Scan leads against DNC and block matches">
            Run Pre-Dial DNC Scrub
          </button>
          <button class="btn btn-secondary btn-sm" onclick="app.loadDncList()">Refresh DNC</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1.35fr;gap:20px;">
        <!-- Left: Add to DNC Form -->
        <div style="display:flex;flex-direction:column;gap:16px;">
          <div class="sc-panel" style="padding:20px 22px;">
            <div style="font-size:15px;font-weight:700;color:#143522;margin-bottom:12px;">Add Number to Do-Not-Call (DNC)</div>
            <form onsubmit="app.handleAddDncSubmit(event);">
              <div class="form-group" style="margin-bottom:12px;">
                <label class="form-label" style="font-size:11.5px;font-weight:600;color:#1a3d2a;">Phone Number</label>
                <input type="tel" id="dncInputPhone" class="form-control" placeholder="e.g. +1234567890 or national number" required style="font-size:13px;padding:8px 10px;">
              </div>
              <div class="form-group" style="margin-bottom:16px;">
                <label class="form-label" style="font-size:11.5px;font-weight:600;color:#1a3d2a;">Opt-Out Reason</label>
                <select id="dncInputReason" class="form-control" style="font-size:12.5px;padding:8px 10px;">
                  <option value="Contact requested opt-out via IVR key" selected>Contact requested opt-out via IVR key</option>
                  <option value="Contact requested opt-out via web/SMS">Contact requested opt-out via web/SMS</option>
                  <option value="Wrong subscriber or disconnected number">Wrong subscriber or disconnected number</option>
                  <option value="General Do-Not-Call request">General Do-Not-Call request</option>
                </select>
              </div>
              <button type="submit" class="sc-pill-btn primary" style="width:100%;padding:9px;font-size:13px;font-weight:700;">
                + Add to DNC Registry
              </button>
            </form>
          </div>
        </div>

        <!-- Right: Live DNC Table -->
        <div class="sc-panel" style="padding:18px 20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
            <div style="font-size:15px;font-weight:700;color:#143522;">
              Active Do-Not-Call (DNC) Numbers (<span id="dncCountTag">0</span>)
            </div>
            <span style="font-size:11.5px;color:#526e5f;">Scrubbed before every outbound batch</span>
          </div>

          <div class="data-table-wrapper" style="max-height:480px;overflow-y:auto;">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Phone Number</th>
                  <th>Reason</th>
                  <th>Date Added</th>
                  <th>Added By</th>
                  <th style="text-align:right;">Action</th>
                </tr>
              </thead>
              <tbody id="dncTableBody">
                <tr><td colspan="5" style="text-align:center;padding:20px;color:#64748b;">Loading DNC registry from PostgreSQL...</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>


    <!-- ========================================================
         VIEW 7: SETTINGS (Business Settings, Caller IDs, Languages, Audio)
         ======================================================== -->
    <div class="tab-panel" id="tabSettings">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <div>
          <h1 style="font-size:24px;font-weight:700;color:#0f172a;margin:0 0 4px 0;">Settings</h1>
          <div style="font-size:13px;color:#64748b;">Configure business details, caller IDs, telephony lines, languages, and audio.</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        
        <!-- COL 1: Business Settings & Caller IDs -->
        <div style="display:flex;flex-direction:column;gap:20px;">
          <!-- Business & Telephony Settings Form -->
          <div class="sc-panel" style="padding:20px;">
            <div style="font-size:15px;font-weight:700;color:#143522;margin-bottom:14px;">Business &amp; Dialing Configuration</div>
            <form id="formBusinessSettings" onsubmit="app.handleSaveSettingsSubmit(event);">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Company Name</label>
                  <input type="text" id="settingCompanyName" class="form-control" placeholder="SkyConnect" required>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Time Zone</label>
                  <input type="text" id="settingTimezone" class="form-control" placeholder="Africa/Addis_Ababa" required>
                </div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px;">
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Currency</label>
                  <input type="text" id="settingCurrency" class="form-control" placeholder="USD" required>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Default Country Code</label>
                  <input type="text" id="settingCountryCode" class="form-control" placeholder="+1" required>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Available Lines</label>
                  <input type="number" id="settingAvailableLines" class="form-control" min="1" max="64" value="2" required>
                </div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Calling Window Start</label>
                  <input type="time" id="settingWindowStart" class="form-control" value="09:00" required>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Calling Window End</label>
                  <input type="time" id="settingWindowEnd" class="form-control" value="17:00" required>
                </div>
              </div>

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Max Retry Attempts</label>
                  <input type="number" id="settingMaxRetries" class="form-control" min="0" max="10" value="2" required>
                </div>
                <div class="form-group">
                  <label class="form-label" style="font-size:11.5px;font-weight:600;">Retry Gap (Minutes)</label>
                  <input type="number" id="settingRetryDelay" class="form-control" min="1" max="1440" value="15" required>
                </div>
              </div>

              <button type="submit" class="sc-pill-btn primary" style="width:100%;font-weight:700;">Save Business Settings</button>
            </form>
          </div>

          <!-- Caller IDs Management -->
          <div class="sc-panel" style="padding:20px;">
            <div style="font-size:15px;font-weight:700;color:#143522;margin-bottom:12px;">Outbound Caller IDs</div>
            <form onsubmit="app.handleAddCallerIdSubmit(event);" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
              <input type="text" id="newCallerIdName" class="form-control" placeholder="Label (e.g. Customer Care)" required style="flex:1;min-width:130px;font-size:12.5px;">
              <input type="tel" id="newCallerIdNumber" class="form-control" placeholder="+1234567890" required style="flex:1;min-width:130px;font-size:12.5px;">
              <button type="submit" class="btn btn-primary btn-sm" style="white-space:nowrap;font-weight:700;">+ Add Caller ID</button>
            </form>
            <div class="data-table-wrapper" style="max-height:220px;overflow-y:auto;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Phone Number</th>
                    <th style="text-align:right;">Action</th>
                  </tr>
                </thead>
                <tbody id="callerIdsTableBody">
                  <tr><td colspan="3" style="text-align:center;padding:14px;color:#94a3b8;">No caller IDs added yet.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- COL 2: Audio Library -->
        <div style="display:flex;flex-direction:column;gap:20px;">
          <!-- Human IVR Audio Recordings Library -->
          <div class="sc-panel" style="padding:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
              <div style="font-size:15px;font-weight:700;color:#143522;">Audio Recordings Library</div>
              <button class="btn btn-primary btn-sm" onclick="app.openModal('modalAudioUpload')">Upload New Audio</button>
            </div>

            <div style="background:#f8fafc;border:1px solid #cbd5e1;border-radius:10px;padding:12px;margin-bottom:14px;">
              <div class="form-group" style="margin-bottom:8px;">
                <label class="form-label" style="font-size:11px;font-weight:700;">Preview Selected Recording:</label>
                <select class="form-control" id="ivrAudioSelectorTab" onchange="document.getElementById('ivrAudioSelector') ? document.getElementById('ivrAudioSelector').value=this.value : null; app.selectAudioRecording(this.value)"></select>
              </div>
              <audio id="tabAudioPlayer" controls style="width:100%;height:36px;outline:none;"></audio>
            </div>

            <div class="data-table-wrapper" style="max-height:220px;overflow-y:auto;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Filename</th>
                    <th>Preview</th>
                    <th style="text-align:right;">Actions</th>
                  </tr>
                </thead>
                <tbody id="audioListTableBody">
                  <tr><td colspan="4" style="text-align:center;padding:14px;color:#94a3b8;">No audio recordings uploaded yet.</td></tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <!-- SMS Gateway & API Key Configuration -->
        <div class="sc-panel" style="grid-column: 1 / -1; padding: 22px; margin-top: 4px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
            <div style="display:flex;align-items:center;gap:12px;">
              <div style="width:36px;height:36px;border-radius:8px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <div>
                <div style="font-size:16px;font-weight:700;color:#0f172a;">SMS Gateway &amp; API Key Configuration</div>
                <div style="font-size:12px;color:#64748b;">Configure external SMS provider API credentials for live messaging dispatch</div>
              </div>
            </div>
            <div id="smsGatewayStatusBadge" style="background:#fef3c7;color:#92400e;font-size:11.5px;font-weight:700;padding:4px 12px;border-radius:12px;border:1px solid #fde68a;">
              Simulator Mode (Pending API Key)
            </div>
          </div>

          <form id="formSmsSettings" onsubmit="app.handleSaveSmsSettingsSubmit(event);">
            <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:14px;margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label" style="font-size:11.5px;font-weight:600;">SMS Gateway Provider</label>
                <select id="smsSettingProvider" class="form-control" style="font-size:12.5px;" onchange="app.handleSmsProviderChange(this.value);">
                  <option value="afromessage" selected>AfroMessage (Ethiopia SMS Gateway)</option>
                  <option value="generic_api">Generic REST / HTTP API</option>
                  <option value="twilio">Twilio Programmable SMS</option>
                  <option value="africastalking">Africa's Talking SMS</option>
                  <option value="infobip">Infobip</option>
                  <option value="custom_webhook">Custom Webhook</option>
                </select>
              </div>
              <div class="form-group" style="grid-column: span 2;">
                <label class="form-label" style="font-size:11.5px;font-weight:600;">Gateway API URL / Endpoint</label>
                <input type="url" id="smsSettingApiUrl" class="form-control" placeholder="https://api.provider.com/v1/sms/send" style="font-size:12.5px;">
              </div>
              <div class="form-group">
                <label class="form-label" style="font-size:11.5px;font-weight:600;">Default Sender ID</label>
                <input type="text" id="smsSettingSenderId" class="form-control" value="SkyConnect" placeholder="SkyConnect" style="font-size:12.5px;">
              </div>
            </div>

            <div style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-bottom:14px;">
              <div class="form-group">
                <label class="form-label" style="font-size:11.5px;font-weight:600;">SMS API Key / Bearer Token</label>
                <div style="position:relative;">
                  <input type="password" id="smsSettingApiKey" class="form-control" placeholder="Paste your SMS provider API key here..." style="font-size:12.5px;padding-right:45px;">
                  <button type="button" onclick="app.toggleApiKeyVisibility('smsSettingApiKey')" style="position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:none;color:#64748b;cursor:pointer;font-size:11.5px;font-weight:600;">Show</button>
                </div>
                <div style="font-size:11px;color:#64748b;margin-top:4px;">
                  Enter the API key when ready. While empty, the system runs safely in simulator mode.
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" style="font-size:11.5px;font-weight:600;">Operating Mode</label>
                <select id="smsSettingMockMode" class="form-control" style="font-size:12.5px;">
                  <option value="1">Simulator / Mock Mode (Test &amp; Log)</option>
                  <option value="0">Live Gateway (Dispatch real SMS)</option>
                </select>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;padding-top:8px;border-top:1px solid #f1f5f9;">
              <button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.sendTestSmsFromSettings()">
                Test SMS Dispatch
              </button>
              <button type="submit" class="btn btn-primary btn-sm" style="font-weight:700;">
                Save SMS Settings
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>

    <!-- Hidden alias panels for legacy switchTab backwards compatibility -->
    <div id="tabLiveRoom" style="display:none;"></div>
    <div id="tabLeadManager" style="display:none;"></div>
    <div id="tabIVRStudio" style="display:none;"></div>
    <div id="tabCallLogs" style="display:none;"></div>
    <div id="tabUnanswered" style="display:none;"></div>
    <div id="tabCallHistory" style="display:none;"></div>

  </div> <!-- /sc-main-content -->

  <!-- ========================================================
       MODAL: QUICK SMS DISPATCH (Agent Manual or Test SMS)
       ======================================================== -->
  <div id="modalAgentQuickSms" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:32px;height:32px;border-radius:8px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">Send SMS to Contact</h3>
            <div style="font-size:11.5px;color:#64748b;">Instant SMS text message dispatch</div>
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalAgentQuickSms')">&times;</button>
      </div>
      <form id="formAgentQuickSms" onsubmit="app.handleAgentQuickSmsSubmit(event)">
        <div class="modal-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px;">
            <div class="form-group">
              <label class="form-label" style="font-size:11.5px;font-weight:600;">Recipient Name</label>
              <input type="text" id="quickSmsCustomerName" class="form-control" readonly style="background:#f8fafc;font-size:12.5px;">
            </div>
            <div class="form-group">
              <label class="form-label" style="font-size:11.5px;font-weight:600;">Recipient Phone</label>
              <input type="tel" id="quickSmsPhoneNumber" class="form-control" placeholder="+251911..." required style="font-size:12.5px;">
            </div>
          </div>

          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label" style="font-size:11.5px;font-weight:600;">Sender ID</label>
            <input type="text" id="quickSmsSenderId" class="form-control" value="SkyConnect" style="font-size:12.5px;">
          </div>

          <div class="form-group" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="font-size:11.5px;font-weight:600;margin:0;">Message Text</label>
              <span id="quickSmsCharCount" style="font-size:11px;color:#64748b;">0 / 160</span>
            </div>
            <textarea id="quickSmsMessageText" class="form-control" rows="3" required style="font-size:12.5px;line-height:1.5;resize:vertical;" oninput="app.updateSmsCharCount(this, 'quickSmsCharCount')"></textarea>
          </div>

          <!-- Gateway Mode Banner -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
            <span style="font-size:16px;">💬</span>
            <div style="font-size:11.5px;color:#166534;line-height:1.4;">
              <strong>Delivery Mode:</strong> <span id="quickSmsModeLabel">Simulator Active (Logged &amp; Verified)</span>
            </div>
          </div>

          <input type="hidden" id="quickSmsLeadId" value="">
          <input type="hidden" id="quickSmsCampaignId" value="">
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.closeModal('modalAgentQuickSms')">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm" id="btnSubmitQuickSms" style="background:#0284c7;border-color:#0284c7;font-weight:700;">Send SMS Now</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL: CREATE NEW SMS CAMPAIGN
       ======================================================== -->
  <div id="modalNewSmsCampaign" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:560px;">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:34px;height:34px;border-radius:8px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">New SMS Campaign</h3>
            <div style="font-size:11.5px;color:#64748b;">Direct text messaging and scheduled broadcast</div>
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalNewSmsCampaign')">&times;</button>
      </div>
      <form id="formNewSmsCampaign" onsubmit="app.handleNewSmsCampaignSubmit(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Campaign Name *</label>
            <input type="text" id="newSmsModalCampName" class="form-control" placeholder="e.g. Appointment Reminder SMS" required style="font-size:13px;">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
            <div class="form-group">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Sender ID</label>
              <input type="text" id="newSmsModalSenderId" class="form-control" value="SkyConnect" maxlength="11" placeholder="e.g. SkyConnect" style="font-size:13px;">
            </div>

            <div class="form-group">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Scheduling Strategy</label>
              <select id="newSmsModalScheduleStrategy" class="form-control" style="font-size:13px;" onchange="app.handleNewSmsStrategyChange(this.value)">
                <option value="auto_schedule" selected>Auto-Schedule (Staggered)</option>
                <option value="immediate">Immediate (Blast All)</option>
                <option value="scheduled_date">Specific Date and Time</option>
              </select>
            </div>
          </div>

          <!-- Stagger Interval Row -->
          <div id="newSmsModalIntervalRow" class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Interval Between Messages</label>
            <select id="newSmsModalIntervalMins" class="form-control" style="font-size:13px;">
              <option value="2">Every 2 minutes</option>
              <option value="5" selected>Every 5 minutes (Recommended)</option>
              <option value="10">Every 10 minutes</option>
              <option value="15">Every 15 minutes</option>
            </select>
          </div>

          <!-- Specific Start Date & Time Row -->
          <div id="newSmsModalDateTimeRow" style="display:none;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #cbd5e1;">
            <div style="font-size:11.5px;font-weight:600;color:#475569;margin-bottom:6px;">Scheduled Start Time:</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <input type="date" id="newSmsModalStartDate" class="form-control" style="font-size:12.5px;">
              <input type="time" id="newSmsModalStartTime" class="form-control" style="font-size:12.5px;">
            </div>
          </div>

          <!-- SMS Message Template -->
          <div class="form-group" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;margin:0;">SMS Message Template *</label>
              <span id="newSmsModalCharCount" style="font-size:11px;color:#64748b;">0 / 160 (1 SMS)</span>
            </div>
            <textarea id="newSmsModalTemplate" class="form-control" rows="3" required style="font-size:13px;resize:vertical;" oninput="app.updateNewSmsCharCount(this.value)" placeholder="Hello {name}, this is an important message regarding your {campaign} update.">Hello {name}, this is an important message regarding your {campaign} update.</textarea>

            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToNewSmsTemplate('{name}')" style="font-size:11px;padding:2px 7px;">+{name}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToNewSmsTemplate('{phone}')" style="font-size:11px;padding:2px 7px;">+{phone}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToNewSmsTemplate('{campaign}')" style="font-size:11px;padding:2px 7px;">+{campaign}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToNewSmsTemplate('{date}')" style="font-size:11px;padding:2px 7px;">+{date}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToNewSmsTemplate('{account}')" style="font-size:11px;padding:2px 7px;">+{account}</button>
            </div>
          </div>

          <!-- Upload Initial Contacts (CSV or Paste) -->
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Initial Contacts (Optional CSV or Text)</label>
            <input type="file" id="newSmsModalFileInput" class="form-control" accept=".csv,.txt" style="font-size:12px;padding:6px;">
            <div style="font-size:11px;color:#64748b;margin-top:4px;">You can also add numbers after creating the campaign.</div>
          </div>
        </div>
        <div class="modal-footer" style="padding:12px 18px;display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.closeModal('modalNewSmsCampaign')">Cancel</button>
          <button type="submit" class="btn btn-success btn-sm" id="btnSubmitNewSmsCamp" style="background:#00A651;border:none;font-weight:700;">Create SMS Campaign</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL: ADD NUMBERS TO SMS CAMPAIGN
       ======================================================== -->
  <div id="modalAddSmsContacts" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:500px;">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:34px;height:34px;border-radius:8px;background:#e8f8ee;color:#00A651;display:flex;align-items:center;justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">Add Numbers to SMS Campaign</h3>
            <div style="font-size:11.5px;color:#64748b;" id="modalAddSmsCampSubtitle">Active Campaign</div>
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalAddSmsContacts')">&times;</button>
      </div>
      <form id="formAddSmsContacts" onsubmit="app.handleAddSmsContactsSubmit(event)">
        <div class="modal-body">
          <!-- Method Toggle -->
          <div style="display:flex;gap:10px;margin-bottom:14px;">
            <button type="button" id="btnAddSmsMethodFile" class="btn btn-sm btn-primary" onclick="app.switchAddSmsMethod('file')" style="flex:1;font-size:12px;font-weight:600;">Upload CSV File</button>
            <button type="button" id="btnAddSmsMethodManual" class="btn btn-sm btn-outline-secondary" onclick="app.switchAddSmsMethod('manual')" style="flex:1;font-size:12px;font-weight:600;">Paste Numbers</button>
          </div>

          <!-- File Upload Section -->
          <div id="addSmsSectionFile">
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Choose CSV or Text File</label>
              <input type="file" id="addSmsFileInput" class="form-control" accept=".csv,.txt" style="font-size:12px;padding:6px;">
              <div style="font-size:11px;color:#64748b;margin-top:4px;">Columns: Phone Number, Customer Name, Scheduled Time (optional)</div>
            </div>
          </div>

          <!-- Manual Section -->
          <div id="addSmsSectionManual" style="display:none;">
            <div class="form-group" style="margin-bottom:12px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Phone Numbers (one per line)</label>
              <textarea id="addSmsManualText" class="form-control" rows="4" placeholder="0911223344, Abebe Kebede&#10;0922334455, Almaz Tadesse" style="font-size:12.5px;"></textarea>
            </div>
          </div>

          <!-- Scheduling Behavior -->
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Scheduling for New Contacts</label>
            <select id="addSmsSchedulingSelect" class="form-control" style="font-size:12.5px;">
              <option value="auto_stagger" selected>Auto-Schedule (Stagger by campaign interval)</option>
              <option value="immediate">Immediate (Ready for blast)</option>
            </select>
          </div>
        </div>
        <div class="modal-footer" style="padding:12px 18px;display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.closeModal('modalAddSmsContacts')">Cancel</button>
          <button type="submit" class="btn btn-success btn-sm" id="btnSubmitAddSms" style="background:#00A651;border:none;font-weight:700;">Import Numbers</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL: EDIT SMS CAMPAIGN TEMPLATE
       ======================================================== -->
  <div id="modalEditSmsTemplate" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:520px;">
      <div class="modal-header">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:34px;height:34px;border-radius:8px;background:#e0f2fe;color:#0284c7;display:flex;align-items:center;justify-content:center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
          </div>
          <div>
            <h3 style="margin:0;font-size:16px;font-weight:700;color:#0f172a;">Edit SMS Template</h3>
            <div style="font-size:11.5px;color:#64748b;" id="modalEditSmsSubtitle">Campaign Template</div>
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalEditSmsTemplate')">&times;</button>
      </div>
      <form id="formEditSmsTemplate" onsubmit="app.handleSaveSmsTemplate(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;">Sender ID</label>
            <input type="text" id="editSmsSenderId" class="form-control" maxlength="11" style="font-size:13px;" required>
          </div>

          <div class="form-group" style="margin-bottom:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
              <label class="form-label" style="font-size:12px;font-weight:600;color:#1e293b;margin:0;">SMS Message Template</label>
              <span id="editSmsCharCount" style="font-size:11px;color:#64748b;">0 / 160 (1 SMS)</span>
            </div>
            <textarea id="editSmsTemplateText" class="form-control" rows="4" style="font-size:13px;resize:vertical;" oninput="app.updateEditSmsCharCount(this.value)" required></textarea>

            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px;">
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToEditSmsTemplate('{name}')" style="font-size:11px;padding:2px 7px;">+{name}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToEditSmsTemplate('{phone}')" style="font-size:11px;padding:2px 7px;">+{phone}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToEditSmsTemplate('{campaign}')" style="font-size:11px;padding:2px 7px;">+{campaign}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToEditSmsTemplate('{date}')" style="font-size:11px;padding:2px 7px;">+{date}</button>
              <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.insertTagToEditSmsTemplate('{account}')" style="font-size:11px;padding:2px 7px;">+{account}</button>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="padding:12px 18px;display:flex;justify-content:flex-end;gap:10px;">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="app.closeModal('modalEditSmsTemplate')">Cancel</button>
          <button type="submit" class="btn btn-success btn-sm" id="btnSubmitEditSms" style="background:#00A651;border:none;font-weight:700;">Save Template</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODAL: SEND TEST CALL (Automated Voice Test)
       ======================================================== -->
  <div id="modalSendTestCall" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Send Test Call</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalSendTestCall')">&times;</button>
      </div>
      <form id="formSendTestCall" onsubmit="app.handleSendTestCallSubmit(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Phone Number to Call</label>
            <input type="tel" id="testCallPhone" class="form-control" placeholder="e.g. +1234567890 or national number" required>
            <div style="font-size:11.5px;color:#64748b;margin-top:4px;">Enter the number that should receive the automated voice call.</div>
          </div>
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label">Campaign Audio Prompt</label>
            <select id="testCallCampaignSelect" class="form-control">
              <option value="">Default Audio Prompt</option>
            </select>
          </div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;font-size:12px;color:#166534;">
            Places a single automated IVR test call immediately to verify audio playback and line connectivity.
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;border-top:1px solid #e2e8f0;">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalSendTestCall')">Cancel</button>
          <button type="submit" class="btn btn-success" id="btnSubmitTestCall" style="background:#00A651;font-weight:700;">Place Test Call</button>
        </div>
      </form>
    </div>
  </div>

  <!-- ========================================================
       MODALS
       ======================================================== -->
  <!-- MODAL: QUICK ADD SINGLE CONTACT -->
  <div id="modalSingleAdd" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Quick Add Contact</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalSingleAdd')">&times;</button>
      </div>
      <form id="formSingleAddLead" onsubmit="app.handleSingleAddSubmit(event)">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label" style="font-weight:700;color:#143522;">Target Campaign</label>
            <select id="singleAddCampaignSelect" class="form-control" style="font-size:13px;padding:8px 10px;" required>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Full Customer Name</label>
            <input type="text" id="modalAddName" class="form-control" placeholder="e.g. Helen Tesfaye" required>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Phone Number</label>
            <input type="tel" id="modalAddPhone" class="form-control" placeholder="e.g. 0911223344 or +251911..." required>
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Scheduled Call Time</label>
            <select id="modalAddTimePreset" class="form-control" onchange="app.handleModalPresetChange(this.value)">
              <option value="immediate" selected>Immediate (Dial with queue)</option>
              <option value="+2min">+2 Minutes</option>
              <option value="+5min">+5 Minutes</option>
              <option value="+10min">+10 Minutes</option>
              <option value="+30min">+30 Minutes</option>
              <option value="custom">Custom Date &amp; Time...</option>
            </select>
          </div>
          <div id="modalCustomDateTimeWrap" style="display:none;margin-bottom:12px;background:#f8fafc;padding:10px;border-radius:8px;border:1px solid #cbd5e1;">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Date</label>
                <input type="date" id="modalAddCustomDate" class="form-control" style="font-size:12.5px;">
              </div>
              <div>
                <label style="font-size:11px;font-weight:600;color:#475569;display:block;margin-bottom:4px;">Time</label>
                <input type="time" id="modalAddCustomTime" class="form-control" style="font-size:12.5px;">
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalSingleAdd')">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Contact</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: UPLOAD CSV / EXCEL FILE -->
  <div id="modalUpload" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Add Contacts to Campaign</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalUpload')">&times;</button>
      </div>
      <form id="formUploadLeads">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label" style="font-weight:700;color:#143522;">Target Campaign</label>
            <select id="uploadCampaignSelect" class="form-control" style="font-size:13px;padding:8px 10px;" required>
            </select>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:12px;font-weight:600;color:#143522;">Upload Excel or CSV File</span>
            <a href="javascript:void(0)" onclick="app.closeModal('modalUpload'); app.openModal('modalManual');" style="font-size:11.5px;color:#00A651;font-weight:600;text-decoration:none;">Or Paste Numbers Directly &rarr;</a>
          </div>
          <p style="font-size:12px;color:#334155;margin-bottom:10px;line-height:1.5;">
            Supports Excel (<strong>.xlsx</strong>) and <strong>.csv</strong> with exact columns: <strong>Name, Phone Number, Time</strong>.<br>
            <span style="font-size:11px;color:#64748b;">Example: <code>Helen Tesfaye, 0911223344, 14:30</code> (or <code>02:30 PM</code> / <code>Immediate</code>). The dialer will wait for the exact time entered.</span>
          </p>
          <!-- Auto-Schedule Config in Modal -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#166534;cursor:pointer;margin:0;">
              <input type="checkbox" id="uploadAutoScheduleToggle" onchange="document.getElementById('uploadScheduleOptionsRow').style.display = this.checked ? 'flex' : 'none';">
              <span>Auto-Schedule any leads without a time (stagger calls automatically)</span>
            </label>
            <div id="uploadScheduleOptionsRow" style="display:none;gap:10px;align-items:center;margin-top:8px;">
              <div style="flex:1;">
                <label style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Strategy</label>
                <select id="uploadScheduleStrategy" class="form-control" style="font-size:11.5px;padding:5px 8px;" onchange="app.handleUploadStrategyChange(this.value)">
                  <option value="interval" selected>Interval Staggering</option>
                  <option value="window">Business Hours Window</option>
                </select>
              </div>
              <div id="uploadColInterval" style="flex:1;">
                <label id="uploadLblInterval" style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Stagger Interval</label>
                <select id="uploadScheduleInterval" class="form-control" style="font-size:11.5px;padding:5px 8px;">
                  <option value="2">Every 2 mins</option>
                  <option value="5" selected>Every 5 mins (Recommended)</option>
                  <option value="10">Every 10 mins</option>
                  <option value="15">Every 15 mins</option>
                </select>
              </div>
              <div id="uploadColWindow" style="flex:1;display:none;">
                <label style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Business Hours Window</label>
                <div style="display:flex;gap:5px;align-items:center;">
                  <input type="time" id="uploadWindowStart" value="09:00" class="form-control" style="font-size:11.5px;padding:4px 6px;flex:1;">
                  <span style="font-size:11px;color:#64748b;">to</span>
                  <input type="time" id="uploadWindowEnd" value="17:00" class="form-control" style="font-size:11.5px;padding:4px 6px;flex:1;">
                </div>
              </div>
            </div>
            <div id="uploadWindowHelpText" style="display:none;font-size:11px;color:#166534;margin-top:6px;background:#e8f5e9;padding:4px 8px;border-radius:4px;">
              System will evenly distribute calls across these business hours automatically.
            </div>
          </div>
          <div class="dropzone-box" id="dropzoneBox" onclick="document.getElementById('leadFileInput').click()">
            <div style="font-weight:700;color:#1e293b;margin-bottom:4px;">Click to select Excel (.xlsx) or CSV file</div>
            <div style="font-size:11px;color:#64748b;" id="selectedFileName">No file selected</div>
            <input type="file" id="leadFileInput" accept=".csv,.txt,.xlsx,.xls" style="display:none;" onchange="app.handleFileSelect(this)">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalUpload')">Cancel</button>
          <button type="submit" id="btnSubmitUploadLeads" class="btn btn-primary">Import Numbers to Campaign</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: CAMPAIGN CREATED NEXT STEPS FLOW -->
  <div id="modalCampaignCreated" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:480px;">
      <div class="modal-header" style="background:#f0fdf4;border-bottom:1px solid #bbf7d0;">
        <div style="display:flex;align-items:center;gap:10px;">
          <span style="width:28px;height:28px;border-radius:50%;background:#22c55e;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-weight:700;">&#10003;</span>
          <h3 style="margin:0;color:#15803d;font-size:16px;">Campaign Created Successfully!</h3>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalCampaignCreated')">&times;</button>
      </div>
      <div class="modal-body" style="padding:20px;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:4px;" id="modalCreatedCampTitle">Campaign Name</div>
        <div style="font-size:12.5px;color:#64748b;margin-bottom:18px;">
          Follow the defined flow below to upload scheduled contacts and launch the dialer:
        </div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <!-- Action 1: Upload Excel/CSV -->
          <div onclick="app.flowUploadContacts()" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;transition:all 0.15s ease;" onmouseover="this.style.borderColor='#00A651';this.style.background='#f0fdf4';" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc';">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:#0f172a;">1. Upload Contacts &amp; Schedule</div>
              <div style="font-size:11.5px;color:#64748b;">Import Excel (.xlsx) or CSV with Name, Phone Number, and Time.</div>
            </div>
            <span style="color:#00A651;font-weight:700;font-size:13px;">Upload &rarr;</span>
          </div>

          <!-- Action 2: Go to Dialer & Start Calling -->
          <div onclick="app.flowGoToDialer()" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;transition:all 0.15s ease;" onmouseover="this.style.borderColor='#0284c7';this.style.background='#f0f9ff';" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc';">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:#0f172a;">2. Go to Dialer &amp; Outbound Lines</div>
              <div style="font-size:11.5px;color:#64748b;">View active lines, review scheduled queue, and hit Start Auto-Dialer.</div>
            </div>
            <span style="color:#0284c7;font-weight:700;font-size:13px;">Dialer &rarr;</span>
          </div>

          <!-- Action 3: Message & Audio Designer -->
          <div onclick="app.flowGoToDesigner()" style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#f8fafc;border:1.5px solid #e2e8f0;border-radius:8px;cursor:pointer;transition:all 0.15s ease;" onmouseover="this.style.borderColor='#64748b';this.style.background='#f1f5f9';" onmouseout="this.style.borderColor='#e2e8f0';this.style.background='#f8fafc';">
            <div>
              <div style="font-weight:700;font-size:13.5px;color:#0f172a;">3. Customize Audio &amp; Message</div>
              <div style="font-size:11.5px;color:#64748b;">Select IVR welcome audio recording or Amharic voice script.</div>
            </div>
            <span style="color:#475569;font-weight:700;font-size:13px;">Design &rarr;</span>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="background:#f8fafc;">
        <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalCampaignCreated')">Close</button>
      </div>
    </div>
  </div>

  <!-- MODAL: BULK WRITE NUMBERS -->
  <div id="modalManual" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Bulk Write Numbers to Campaign</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalManual')">&times;</button>
      </div>
      <form id="formManualLeads">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label" style="font-weight:700;color:#143522;">Target Campaign</label>
            <select id="manualCampaignSelect" class="form-control" style="font-size:13px;padding:8px 10px;" required>
            </select>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <span style="font-size:12px;font-weight:600;color:#143522;">Paste Phone Numbers (One per line)</span>
            <a href="javascript:void(0)" onclick="app.closeModal('modalManual'); app.openModal('modalUpload');" style="font-size:11.5px;color:#00A651;font-weight:600;text-decoration:none;">&larr; Or Upload Excel/CSV</a>
          </div>
          <!-- Auto-Schedule Config in Manual Modal -->
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 12px;margin-bottom:10px;">
            <label style="display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;color:#166534;cursor:pointer;margin:0;">
              <input type="checkbox" id="manualAutoScheduleToggle" checked onchange="document.getElementById('manualScheduleOptionsRow').style.display = this.checked ? 'flex' : 'none';">
              <span>System Auto-Schedule (Paste Name &amp; Phone only)</span>
            </label>
            <div id="manualScheduleOptionsRow" style="display:flex;gap:10px;align-items:center;margin-top:8px;">
              <div style="flex:1;">
                <label style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Strategy</label>
                <select id="manualScheduleStrategy" class="form-control" style="font-size:11.5px;padding:5px 8px;" onchange="app.handleManualStrategyChange(this.value)">
                  <option value="interval" selected>Interval Staggering</option>
                  <option value="window">Business Hours Window</option>
                </select>
              </div>
              <div id="manualColInterval" style="flex:1;">
                <label id="manualLblInterval" style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Stagger Interval</label>
                <select id="manualScheduleInterval" class="form-control" style="font-size:11.5px;padding:5px 8px;">
                  <option value="2">Every 2 mins</option>
                  <option value="5" selected>Every 5 mins (Recommended)</option>
                  <option value="10">Every 10 mins</option>
                  <option value="15">Every 15 mins</option>
                </select>
              </div>
              <div id="manualColWindow" style="flex:1;display:none;">
                <label style="font-size:11px;color:#374151;font-weight:600;display:block;margin-bottom:2px;">Business Hours Window</label>
                <div style="display:flex;gap:5px;align-items:center;">
                  <input type="time" id="manualWindowStart" value="09:00" class="form-control" style="font-size:11.5px;padding:4px 6px;flex:1;">
                  <span style="font-size:11px;color:#64748b;">to</span>
                  <input type="time" id="manualWindowEnd" value="17:00" class="form-control" style="font-size:11.5px;padding:4px 6px;flex:1;">
                </div>
              </div>
            </div>
            <div id="manualWindowHelpText" style="display:none;font-size:11px;color:#166534;margin-top:6px;background:#e8f5e9;padding:4px 8px;border-radius:4px;">
              System will evenly distribute calls across these business hours automatically.
            </div>
          </div>
          <p style="font-size:11.5px;color:#64748b;margin-bottom:8px;">
            Format: <code>0911223344</code>, or <code>Helen Tesfaye, 0911223344</code>, or <code>Abebe, 0922334455, 02:30 PM</code>
          </p>
          <textarea id="manualLeadsText" class="form-control" rows="8" placeholder="0911223344&#10;Helen Tesfaye, 0911223344&#10;Abebe Kebede, 0922334455" required style="font-family:monospace;font-size:12px;"></textarea>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalManual')">Cancel</button>
          <button type="submit" class="btn btn-primary">Add Numbers to Campaign</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: CAMPAIGN ACTION MENU (More Button) -->
  <div id="modalCampaignActionMenu" class="modal-backdrop" onclick="app.closeModal('modalCampaignActionMenu')">
    <div class="modal-dialog" style="max-width:380px;" onclick="event.stopPropagation();">
      <div class="modal-header">
        <h3 id="campActionMenuTitle" style="font-size:15px;font-weight:700;color:#0f172a;">Campaign Options</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalCampaignActionMenu')">&times;</button>
      </div>
      <div class="modal-body" style="padding:16px 20px;">
        <input type="hidden" id="campActionMenuCampaignId">
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button type="button" class="btn btn-primary" onclick="app.actionMenuDialCampaign()" style="justify-content:flex-start;padding:10px 14px;font-weight:600;font-size:13px;">
            Load &amp; Dial in Outbound Queue
          </button>
          <button type="button" class="btn btn-secondary" onclick="app.actionMenuAddContacts()" style="justify-content:flex-start;padding:10px 14px;font-size:13px;">
            + Add Numbers / Import Contacts
          </button>
          <button type="button" class="btn btn-secondary" onclick="app.actionMenuExportContacts()" style="justify-content:flex-start;padding:10px 14px;font-size:13px;">
            Export Contacts (CSV)
          </button>
          <button type="button" class="btn btn-secondary" onclick="app.actionMenuToggleStatus()" style="justify-content:flex-start;padding:10px 14px;font-size:13px;">
            Toggle Running / Idle Status
          </button>
          <button type="button" class="btn btn-secondary" onclick="app.actionMenuDeleteCampaign()" style="justify-content:flex-start;padding:10px 14px;font-size:13px;color:#dc2626;border-color:#fecaca;">
            Delete Campaign
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- MODAL: UPLOAD AUDIO RECORDING -->
  <div id="modalAudioUpload" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Upload Voice Recording (.wav / .mp3)</h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalAudioUpload')">&times;</button>
      </div>
      <form id="formUploadAudio">
        <div class="modal-body">
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Recording Title</label>
            <input type="text" id="audioNameInput" class="form-control" placeholder="e.g. October Bill Payment Reminder" required>
          </div>
          <div class="form-group">
            <label class="form-label">Audio File (.wav / .mp3)</label>
            <input type="file" id="audioFileInput" class="form-control" accept=".wav,.mp3" required>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalAudioUpload')">Cancel</button>
          <button type="submit" id="btnUploadAudioSubmit" class="btn btn-primary">Upload Recording</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: REDIAL SCHEDULE -->
  <div id="modalRedialSchedule" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:440px;">
      <div class="modal-header">
        <h3 style="font-size:16px;font-weight:700;color:#0f172a;">
          Schedule Redial Date &amp; Time
        </h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalRedialSchedule')">&times;</button>
      </div>
      <form onsubmit="app.handleRedialSubmit(event)">
        <input type="hidden" id="redialLeadId">
        <div class="modal-body">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;border-radius:8px;margin-bottom:14px;">
            <div style="font-weight:700;color:#143522;font-size:13.5px;" id="redialCustomerName">Customer Name</div>
            <div style="font-size:12px;color:#00A651;font-weight:600;" id="redialPhoneNumber">Phone Number</div>
          </div>

          <!-- Quick Presets -->
          <div style="font-size:11.5px;font-weight:700;color:#526e5f;margin-bottom:6px;">Quick Presets:</div>
          <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('+15m')">+15 Mins</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('+1h')">+1 Hour</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('+3h')">+3 Hours</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('tomorrow_am')">Tomorrow 09:00 AM</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('tomorrow_pm')">Tomorrow 02:00 PM</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setRedialPreset('+3days')">+3 Days</button>
          </div>

          <!-- Small Calendar & Time Pickers -->
          <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:10px;">
              Pick from Calendar &amp; Clock:
            </div>
            <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:10px;margin-bottom:10px;">
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">Date (Calendar)</label>
                <input type="date" id="redialDateInput" class="form-control" required style="font-size:13px;padding:8px 10px;background:#ffffff;border:1.5px solid #94a3b8;border-radius:6px;cursor:pointer;" onchange="app.updateRedialPreview()">
              </div>
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">Time (Hours : Mins)</label>
                <input type="time" id="redialCustomTimeInput" class="form-control" required style="font-size:13px;padding:8px 10px;background:#ffffff;border:1.5px solid #94a3b8;border-radius:6px;cursor:pointer;" onchange="app.updateRedialPreview()">
              </div>
            </div>
            <div style="font-size:11.5px;color:#15803d;font-weight:600;background:#dcfce7;padding:6px 10px;border-radius:6px;border:1px solid #bbf7d0;" id="redialPreviewText">
              Redial scheduled for: Tomorrow at 09:00 AM
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalRedialSchedule')">Cancel</button>
          <button type="submit" class="btn btn-primary" style="font-weight:700;">Save &amp; Queue Redial</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: RESCHEDULE CALLBACK (Calendar Date & Time Picker) -->
  <div id="modalRescheduleCallback" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:440px;">
      <div class="modal-header">
        <h3 style="font-size:16px;font-weight:700;color:#0f172a;">
          Choose Callback Date &amp; Time
        </h3>
        <button type="button" class="btn-close" onclick="app.closeModal('modalRescheduleCallback')">&times;</button>
      </div>
      <form id="formRescheduleCallback" onsubmit="app.handleRescheduleSubmit(event)">
        <input type="hidden" id="rescheduleCallbackId">
        <div class="modal-body">
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;padding:12px;border-radius:8px;margin-bottom:14px;">
            <div style="font-weight:700;color:#143522;font-size:13.5px;" id="rescheduleCustomerName">Customer Name</div>
            <div style="font-size:12px;color:#00A651;font-weight:600;" id="reschedulePhoneNumber">Phone Number</div>
          </div>

          <!-- Quick Presets -->
          <div style="font-size:11.5px;font-weight:700;color:#526e5f;margin-bottom:6px;">Quick Presets:</div>
          <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap;">
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('+15m')">+15 Mins</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('+1h')">+1 Hour</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('+3h')">+3 Hours</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('tomorrow_am')">Tomorrow 09:00 AM</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('tomorrow_pm')">Tomorrow 02:00 PM</button>
            <button type="button" class="sc-pill-btn secondary" style="font-size:11px;padding:4px 9px;" onclick="app.setReschedulePreset('+3days')">+3 Days</button>
          </div>

          <!-- Small Calendar & Time Pickers -->
          <div style="background:#f8fafc;border:1.5px solid #cbd5e1;border-radius:10px;padding:14px;margin-bottom:14px;">
            <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:10px;">
              Pick from Calendar &amp; Clock:
            </div>
            <div style="display:grid;grid-template-columns:1.25fr 1fr;gap:10px;margin-bottom:10px;">
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">Date (Calendar)</label>
                <input type="date" id="rescheduleDateInput" class="form-control" required style="font-size:13px;padding:8px 10px;background:#ffffff;border:1.5px solid #94a3b8;border-radius:6px;cursor:pointer;" onchange="app.updateReschedulePreview()">
              </div>
              <div>
                <label class="form-label" style="font-size:11px;font-weight:700;color:#334155;margin-bottom:4px;">Time (Hours : Mins)</label>
                <input type="time" id="rescheduleTimeInput" class="form-control" required style="font-size:13px;padding:8px 10px;background:#ffffff;border:1.5px solid #94a3b8;border-radius:6px;cursor:pointer;" onchange="app.updateReschedulePreview()">
              </div>
            </div>
            <div style="font-size:11.5px;color:#15803d;font-weight:600;background:#dcfce7;padding:6px 10px;border-radius:6px;border:1px solid #bbf7d0;" id="reschedulePreviewText">
              Callback scheduled for: Tomorrow at 09:00 AM
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" style="font-size:11.5px;font-weight:700;color:#143522;">Follow-up Note (Optional)</label>
            <input type="text" id="rescheduleNotesInput" class="form-control" placeholder="e.g. Customer requested callback after lunch" style="font-size:12.5px;">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="app.closeModal('modalRescheduleCallback')">Cancel</button>
          <button type="submit" class="btn btn-primary" style="font-weight:700;">Save &amp; Update Schedule</button>
        </div>
      </form>
    </div>
  </div>

  <!-- MODAL: CHANGE PASSWORD -->
  <div id="modalChangePassword" class="modal-backdrop">
    <div class="modal-dialog">
      <div class="modal-header">
        <h3>Change Account Password</h3>
        <button type="button" class="btn-close" onclick="closeChangePasswordModal()">&times;</button>
      </div>
      <form onsubmit="handleChangePasswordSubmit(event)">
        <div class="modal-body">
          <div id="changePassAlert" style="display:none;padding:8px 12px;border-radius:6px;font-size:12px;margin-bottom:12px;"></div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Current Password</label>
            <input type="password" id="cpCurrentPassword" class="form-control" placeholder="Enter current password" required autocomplete="current-password">
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">New Password</label>
            <input type="password" id="cpNewPassword" class="form-control" placeholder="Enter new password (min. 4 chars)" required minlength="4" autocomplete="new-password">
          </div>
          <div class="form-group" style="margin-bottom:12px;">
            <label class="form-label">Confirm New Password</label>
            <input type="password" id="cpConfirmPassword" class="form-control" placeholder="Re-type new password" required minlength="4" autocomplete="new-password">
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick="closeChangePasswordModal()">Cancel</button>
          <button type="submit" id="btnSubmitChangePass" class="btn btn-primary">Update Password</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Verification & Retry Modals -->
<div id="modalVerifyList" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:600px;">
      <div class="modal-header">
        <h3 style="display:flex;align-items:center;gap:8px;">
          <span>🛡️</span> Phone Number Verification
        </h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:12.5px;color:#64748b;margin-bottom:14px;line-height:1.4;">
          Validates all phone numbers against international and national format standards, flags duplicates, and identifies malformed numbers before dialing.
        </div>

        <!-- Verification Stat Badges -->
        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;margin-bottom:16px;">
          <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:11px;font-weight:700;color:#166534;text-transform:uppercase;">Valid Numbers</div>
            <div style="font-size:22px;font-weight:800;color:#15803d;" id="verifyValidCount">0</div>
            <div style="font-size:10.5px;color:#166534;margin-top:2px;" id="verifyOperatorBreakdown">Ready to dial</div>
          </div>
          <div style="background:#fffbeb;border:1.5px solid #fde68a;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:11px;font-weight:700;color:#92400e;text-transform:uppercase;">Duplicates</div>
            <div style="font-size:22px;font-weight:800;color:#b45309;" id="verifyDuplicateCount">0</div>
            <div style="font-size:10.5px;color:#92400e;margin-top:2px;">Repeated entries</div>
          </div>
          <div style="background:#fef2f2;border:1.5px solid #fecaca;border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;">Invalid Numbers</div>
            <div style="font-size:22px;font-weight:800;color:#dc2626;" id="verifyInvalidCount">0</div>
            <div style="font-size:10.5px;color:#991b1b;margin-top:2px;">Format errors</div>
          </div>
        </div>

        <!-- Detail Box of Duplicates and Invalid -->
        <div style="font-size:11.5px;font-weight:700;color:#475569;margin-bottom:6px;text-transform:uppercase;">Inspection Details</div>
        <div id="verifyDetailsContainer" style="max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;padding:10px;font-size:12px;background:#fafbfc;">
          <div id="verifyDetailsContent" style="color:#64748b;text-align:center;padding:14px;">Loading verification details...</div>
        </div>

        <!-- Remediation Actions -->
        <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e2e8f0;">
          <div style="font-size:12px;font-weight:700;color:#1e293b;margin-bottom:8px;">One-Click Quick Actions:</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn btn-secondary btn-sm" onclick="app.executeQueueClean('auto_format')" style="color:#0284c7;border-color:#bae6fd;">
              Standardize to (+251)
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.executeQueueClean('remove_duplicates')" style="color:#b45309;border-color:#fde68a;">
              Remove Duplicates
            </button>
            <button class="btn btn-secondary btn-sm" onclick="app.executeQueueClean('remove_invalid')" style="color:#dc2626;border-color:#fecaca;">
              Delete Invalid Numbers
            </button>
          </div>
        </div>
      </div>
      <div class="modal-footer" style="display:flex;justify-content:space-between;align-items:center;">
        <button type="button" class="btn btn-secondary btn-close-modal">Close</button>
        <button type="button" class="btn btn-primary" onclick="app.closeVerificationAndStart()">Start Dialer With Valid Leads</button>
      </div>
    </div>
  </div>

<div id="modalRetrySettings" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:480px;">
      <div class="modal-header">
        <h3 style="display:flex;align-items:center;gap:8px;">
          <span>⚙️</span> Retry Policy &amp; Schedule Rules
        </h3>
        <button type="button" class="btn-close-modal" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <form id="formRetrySettings" onsubmit="app.handleSaveRetrySettings(event)">
        <div class="modal-body">
          <p style="font-size:12px;color:#64748b;margin-bottom:14px;line-height:1.4;">
            Configure how the system automatically re-dials customer numbers when a call is not answered (busy, declined, or unreachable).
          </p>

          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">
              Max Retry Attempts
            </label>
            <select id="cfgMaxRetries" class="form-control" style="font-size:13px;">
              <option value="0">0: Do Not Retry (Mark as No Answer)</option>
              <option value="1">1 Retry Attempt</option>
              <option value="2" selected>2 Retry Attempts (Recommended)</option>
              <option value="3">3 Retry Attempts</option>
              <option value="5">5 Retry Attempts</option>
            </select>
            <span style="font-size:11px;color:#94a3b8;display:block;margin-top:2px;">How many times to re-dial an unanswered phone number.</span>
          </div>

          <div class="form-group" style="margin-bottom:14px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">
              Retry Target Schedule Mode
            </label>
            <select id="cfgRetryDateMode" class="form-control" style="font-size:13px;" onchange="app.handleRetryModeChange(this.value)">
              <option value="same_day" selected>Same Day (Wait X minutes before re-dialing)</option>
              <option value="next_day">Next Day (Schedule for Tomorrow)</option>
              <option value="custom_date">Specific Scheduled Date...</option>
            </select>
          </div>

          <div class="form-group" id="cfgRetryDelayWrap" style="margin-bottom:14px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">
              Retry Interval Delay
            </label>
            <select id="cfgRetryDelayMin" class="form-control" style="font-size:13px;">
              <option value="2">2 Minutes</option>
              <option value="5">5 Minutes</option>
              <option value="10">10 Minutes</option>
              <option value="15" selected>15 Minutes (Default)</option>
              <option value="30">30 Minutes</option>
              <option value="60">1 Hour</option>
              <option value="120">2 Hours</option>
            </select>
            <span style="font-size:11px;color:#94a3b8;display:block;margin-top:2px;">Delay before the next attempt is dispatched into the active calling queue.</span>
          </div>

          <div class="form-group" id="cfgRetryCustomDateWrap" style="display:none;margin-bottom:14px;">
            <label class="form-label" style="font-size:12px;font-weight:600;color:#334155;margin-bottom:4px;display:block;">
              Select Retry Date
            </label>
            <input type="date" id="cfgRetryCustomDate" class="form-control" style="font-size:13px;">
            <span style="font-size:11px;color:#94a3b8;display:block;margin-top:2px;">All retries will be moved to this target date.</span>
          </div>
        </div>
        <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:8px;">
          <button type="button" class="btn btn-secondary btn-close-modal">Cancel</button>
          <button type="submit" class="btn btn-primary">Save Retry Rules</button>
        </div>
      </form>
    </div>
  </div>


  <!-- MODAL: SIP SETTINGS -->
  <div class="modal-overlay" id="settingsModal">
    <div class="modal-box">
      <div class="modal-title">SIP Softphone Extension Settings</div>
      <form onsubmit="saveSipSettings(event)">
        <div class="form-group">
          <label>SIP Server (WSS Host)</label>
          <input type="text" id="sipServer" value="<?php echo $agent_server; ?>" required>
        </div>
        <div class="form-group">
          <label>SIP WSS Port</label>
          <input type="text" id="sipPort" value="<?php echo $agent_port; ?>" required>
        </div>
        <div class="form-group">
          <label>SIP Domain</label>
          <input type="text" id="sipDomain" value="<?php echo $agent_domain; ?>" required>
        </div>
        <div class="form-group">
          <label>Extension 1 (Line 1)</label>
          <input type="text" id="sipExt" value="<?php echo $agent_ext; ?>" required>
        </div>
        <div class="form-group">
          <label>Password 1</label>
          <input type="password" id="sipPass" value="<?php echo $agent_pass; ?>" required>
        </div>
        <div class="form-group" style="border-top:1px solid #dce8df;padding-top:10px;">
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
            <input type="checkbox" id="line2EnabledCheck" <?php echo $line2_enabled ? 'checked' : ''; ?>>
            <span>Enable Dual-Line Outbound (Line 2)</span>
          </label>
        </div>
        <div class="form-group">
          <label>Extension 2 (Line 2)</label>
          <input type="text" id="sipExt2" value="<?php echo $agent_ext2; ?>">
        </div>
        <div class="form-group">
          <label>Password 2</label>
          <input type="password" id="sipPass2" value="<?php echo $agent_pass2; ?>">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;">
          <button type="button" class="btn btn-secondary" style="flex:1;" onclick="closeSipSettingsModal()">Cancel</button>
          <button type="submit" class="btn-save-settings" style="flex:1.5;">Connect / Save</button>
        </div>
      </form>
    </div>
  </div>

  <!-- Toast Notification Container -->
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

  /* Navigation & Context Switcher */
  const NAV_SECTION_TITLES = {
    'tabCampaigns': 'Campaigns Management',
    'tabDialer': 'Agent Softphone & Live Queue',
    'tabSmsCampaigns': 'SMS Campaign Messenger & Scheduled Queue',
    'tabCallbacks': 'Unanswered & Follow-up Calls',
    'tabIvrResponses': 'Interactive IVR Responses & Analytics',
    'tabReports': 'Analytics & Call Reports',
    'tabCompliance': 'Compliance & DNC Registry',
    'tabSettings': 'System & Dialer Settings'
  };

  function switchNav(tabId, urlPath) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sc-nav-item').forEach(b => b.classList.remove('active'));

    const targetPanel = document.getElementById(tabId);
    if (targetPanel) targetPanel.classList.add('active');

    const sbBtn = document.getElementById('sb' + tabId.replace('tab', ''));
    if (sbBtn) sbBtn.classList.add('active');

    const titleEl = document.getElementById('headerSectionTitle');
    if (titleEl && NAV_SECTION_TITLES[tabId]) {
      titleEl.textContent = NAV_SECTION_TITLES[tabId];
    }

    const urlText = document.getElementById('topUrlText');
    if (urlText && urlPath) {
      urlText.textContent = 'skyconnect.local/' + urlPath;
    }

    if (tabId === 'tabCampaigns' && typeof switchCampaignSubView === 'function') {
      switchCampaignSubView('list');
    }
    if (tabId === 'tabDialer' && typeof switchDialerSubView === 'function') {
      switchDialerSubView('agent');
    }

    if (window.app) {
      try {
        if (tabId === 'tabCampaigns' && app.loadCampaignsOverview) app.loadCampaignsOverview();
        if (tabId === 'tabDialer' && app.renderAgentScreen) app.renderAgentScreen();
        if (tabId === 'tabSmsCampaigns' && app.loadSmsDispatcherScreen) app.loadSmsDispatcherScreen();
        if (tabId === 'tabCallbacks' && app.loadCallbacksList) app.loadCallbacksList();
        if (tabId === 'tabIvrResponses' && app.loadIvrResponsesReport) app.loadIvrResponsesReport();
        if (tabId === 'tabCompliance' && app.loadDncList) app.loadDncList();
        if (tabId === 'tabReports' && app.loadReportsAndLogs) app.loadReportsAndLogs();
        if (tabId === 'tabSettings') {
          if (app.loadSettingsAndData) app.loadSettingsAndData();
          if (app.loadSmsSettings) app.loadSmsSettings();
        }
      } catch (err) {
        console.warn('Navigation hook error:', err);
      }
    }
  }

  /* Backwards-compatibility for switchTab calls from dialer.js */
  function switchTab(tabId) {
    if (tabId === 'tabLiveRoom' || tabId === 'tabDialer') {
      switchNav('tabDialer', 'dialer/agent');
    } else if (tabId === 'tabLeadManager' || tabId === 'tabContacts') {
      switchNav('tabCampaigns', 'campaigns');
    } else if (tabId === 'tabSmsCampaigns') {
      switchNav('tabSmsCampaigns', 'sms-campaigns');
    } else if (tabId === 'tabUnanswered') {
      switchNav('tabCallbacks', 'callbacks');
    } else if (tabId === 'tabIVRStudio') {
      switchNav('tabSettings', 'settings');
    } else if (tabId === 'tabCallLogs' || tabId === 'tabCallHistory') {
      switchNav('tabReports', 'reports');
    } else {
      switchNav(tabId, tabId.replace('tab', '').toLowerCase());
    }
  }
  window.switchNav = switchNav;
  window.switchTab = switchTab;

  /* Campaigns Sub-View Switcher (list, designer, queue) */
  function switchCampaignSubView(sub) {
    const listEl = document.getElementById('subViewCampaignsList');
    const designerEl = document.getElementById('subViewCampaignsDesigner');
    const queueEl = document.getElementById('subViewDialerQueue');
    const urlText = document.getElementById('topUrlText');
    const titleEl = document.getElementById('headerSectionTitle');

    if (listEl) listEl.style.display = (sub === 'list') ? 'block' : 'none';
    if (designerEl) designerEl.style.display = (sub === 'designer') ? 'block' : 'none';
    if (queueEl) queueEl.style.display = (sub === 'queue') ? 'block' : 'none';

    const cName = window.app?.campaign?.name || 'Campaign';

    if (sub === 'designer') {
      const tabName = document.getElementById('designerTabCampaignName');
      if (tabName) tabName.textContent = cName;
      if (urlText) urlText.textContent = 'skyconnect.local/campaigns/' + encodeURIComponent(cName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
      if (titleEl) titleEl.textContent = 'Campaign Designer: ' + cName;
    } else if (sub === 'queue') {
      if (urlText) urlText.textContent = 'skyconnect.local/campaigns/queue';
      if (titleEl) titleEl.textContent = 'Calling Queue: ' + cName;
    } else {
      if (urlText) urlText.textContent = 'skyconnect.local/campaigns';
      if (titleEl) titleEl.textContent = 'Campaigns Management';
    }
  }
  window.switchCampaignSubView = switchCampaignSubView;

  function switchDialerSubView(sub) {
    const agentEl = document.getElementById('subViewDialerAgent');
    const pacingEl = document.getElementById('subViewDialerPacing');
    const queueEl = document.getElementById('subViewDialerQueue');
    const btnAgent = document.getElementById('subBtnDialerAgent');
    const btnPacing = document.getElementById('subBtnDialerPacing');
    const btnQueue = document.getElementById('subBtnDialerQueue');
    const urlText = document.getElementById('topUrlText');
    const titleEl = document.getElementById('headerSectionTitle');

    if (agentEl) agentEl.style.display = (sub === 'agent') ? 'block' : 'none';
    if (pacingEl) pacingEl.style.display = (sub === 'pacing') ? 'block' : 'none';
    if (queueEl) queueEl.style.display = (sub === 'queue') ? 'block' : 'none';

    if (btnAgent) btnAgent.className = (sub === 'agent') ? 'dial-seg-btn active' : 'dial-seg-btn';
    if (btnPacing) btnPacing.className = (sub === 'pacing') ? 'dial-seg-btn active' : 'dial-seg-btn';
    if (btnQueue) btnQueue.className = (sub === 'queue') ? 'dial-seg-btn active' : 'dial-seg-btn';

    if (sub === 'agent') {
      if (urlText) urlText.textContent = 'skyconnect.local/dialer/agent';
      if (titleEl) titleEl.textContent = 'Agent Script & Customer 360';
      if (window.app && app.renderAgentScreen) app.renderAgentScreen();
    } else if (sub === 'pacing') {
      if (urlText) urlText.textContent = 'skyconnect.local/dialer/control';
      if (titleEl) titleEl.textContent = 'Dialer Pacing & Compliance';
      if (window.app && app.renderPacingAndComplianceSettings) app.renderPacingAndComplianceSettings();
    } else {
      if (urlText) urlText.textContent = 'skyconnect.local/dialer/queue';
      if (titleEl) titleEl.textContent = 'Live Outbound Queue & Softphone';
    }
  }
  window.switchDialerSubView = switchDialerSubView;

  /* Language switcher for Message Designer */
  function setDesignerLang(lang) {
    document.querySelectorAll('#langBtnAmharic, #langBtnOromifa, #langBtnEnglish').forEach(b => b.className = 'des-lang-btn');
    if (lang === 'amharic') {
      document.getElementById('langBtnAmharic')?.classList.add('active');
    } else if (lang === 'oromifa') {
      document.getElementById('langBtnOromifa')?.classList.add('active');
    } else {
      document.getElementById('langBtnEnglish')?.classList.add('active');
    }
  }

  let _voicePreviewAudio = null;

  function toggleVoicePreview() {
    const sel = document.getElementById('designerAudioPromptSelect');
    let audioSrc = (sel && sel.value) ? sel.value : '';
    let audioName = (sel && sel.selectedOptions && sel.selectedOptions[0]) ? sel.selectedOptions[0].textContent : 'Voice prompt';

    if (!audioSrc && window.app) {
      audioSrc = window.app.campaign?.ivr_audio_file || (window.app.audioRecordings?.[0]?.filepath) || '';
      audioName = window.app.campaign?.ivr_audio_name || (window.app.audioRecordings?.[0]?.name) || 'Voice prompt';
    }

    if (!audioSrc) {
      if (window.app && window.app.showToast) {
        window.app.showToast('No audio recording found to preview.', 'warning');
      } else {
        alert('No audio recording found to preview.');
      }
      return;
    }

    const iconSpan = document.getElementById('testAudioPlayIcon');
    const textSpan = document.getElementById('testAudioPlayText');

    // If audio is currently playing, toggle to pause
    if (_voicePreviewAudio && !_voicePreviewAudio.paused && !_voicePreviewAudio.ended) {
      _voicePreviewAudio.pause();
      if (iconSpan) iconSpan.textContent = '▶';
      if (textSpan) textSpan.textContent = 'Resume';
      if (window.app && window.app.showToast) window.app.showToast('Audio paused', 'info');
      return;
    }

    // If audio is currently paused on the same track, resume it
    if (_voicePreviewAudio && _voicePreviewAudio.paused && !_voicePreviewAudio.ended && _voicePreviewAudio.currentTime > 0) {
      _voicePreviewAudio.play().then(() => {
        if (iconSpan) iconSpan.textContent = '⏸';
        if (textSpan) textSpan.textContent = 'Pause';
        if (window.app && window.app.showToast) window.app.showToast('Resuming: ' + audioName, 'info');
      }).catch(err => {
        console.warn('Resume error:', err);
      });
      return;
    }

    // Otherwise, create fresh audio instance and play from start
    if (_voicePreviewAudio) {
      try { _voicePreviewAudio.pause(); } catch(e) {}
      _voicePreviewAudio = null;
    }

    _voicePreviewAudio = new Audio(audioSrc);

    _voicePreviewAudio.onended = () => {
      if (iconSpan) iconSpan.textContent = '▶';
      if (textSpan) textSpan.textContent = 'Test audio';
      _voicePreviewAudio = null;
    };

    _voicePreviewAudio.onerror = (e) => {
      console.warn('Audio playback error:', e);
      if (window.app && window.app.showToast) {
        window.app.showToast('Could not play audio file: ' + audioSrc, 'error');
      }
      if (iconSpan) iconSpan.textContent = '▶';
      if (textSpan) textSpan.textContent = 'Test audio';
      _voicePreviewAudio = null;
    };

    _voicePreviewAudio.play().then(() => {
      if (iconSpan) iconSpan.textContent = '⏸';
      if (textSpan) textSpan.textContent = 'Pause';
      if (window.app && window.app.showToast) {
        window.app.showToast('Playing: ' + audioName, 'info');
      }
    }).catch(err => {
      console.warn('Audio play error:', err);
      if (window.app && window.app.showToast) {
        window.app.showToast('Audio playback error: ' + err.message, 'error');
      }
    });
  }

  function pauseVoicePreview() {
    toggleVoicePreview();
  }

  function playVoicePreview() {
    toggleVoicePreview();
  }

  function toggleSidebarMenu() {
    document.getElementById('sidebarMenu')?.classList.toggle('collapsed');
    document.getElementById('mainContainer')?.classList.toggle('sidebar-collapsed');
  }

  function toggleStatusMenu() {
    document.getElementById('statusDropMenu')?.classList.toggle('open');
  }

  function setAgentStatus(st) {
    const label = document.getElementById('statusLabel');
    const dot = document.getElementById('statusDot');
    if (st === 'ready') { if (label) label.textContent = 'Ready'; if (dot) dot.className = 'sdot ready'; }
    else if (st === 'idle') { if (label) label.textContent = 'Idle'; if (dot) dot.className = 'sdot notready'; }
    else if (st === 'break') { if (label) label.textContent = 'On Break'; if (dot) dot.className = 'sdot brk'; }
    document.getElementById('statusDropMenu')?.classList.remove('open');
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
    document.getElementById('settingsModal')?.classList.add('show');
    document.getElementById('statusDropMenu')?.classList.remove('open');
  }

  function closeSipSettingsModal() {
    document.getElementById('settingsModal')?.classList.remove('show');
  }

  function openChangePasswordModal() {
    const cp = document.getElementById('cpCurrentPassword');
    const np = document.getElementById('cpNewPassword');
    const cnp = document.getElementById('cpConfirmPassword');
    if (cp) cp.value = '';
    if (np) np.value = '';
    if (cnp) cnp.value = '';
    const alertEl = document.getElementById('changePassAlert');
    if (alertEl) { alertEl.style.display = 'none'; alertEl.textContent = ''; }
    document.getElementById('modalChangePassword')?.classList.add('open');
    document.getElementById('statusDropMenu')?.classList.remove('open');
  }

  function closeChangePasswordModal() {
    document.getElementById('modalChangePassword')?.classList.remove('open');
  }

  async function handleChangePasswordSubmit(e) {
    e.preventDefault();
    const currentPass = document.getElementById('cpCurrentPassword')?.value || '';
    const newPass = document.getElementById('cpNewPassword')?.value || '';
    const confirmPass = document.getElementById('cpConfirmPassword')?.value || '';
    const alertEl = document.getElementById('changePassAlert');
    const btn = document.getElementById('btnSubmitChangePass');

    if (newPass !== confirmPass) {
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.style.background = '#fee2e2';
        alertEl.style.color = '#b91c1c';
        alertEl.style.border = '1px solid #fecaca';
        alertEl.textContent = 'New password and confirm password do not match.';
      }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }

    try {
      const resp = await fetch('api.php?action=change_password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: currentPass, new_password: newPass })
      });
      const data = await resp.json();

      if (data && data.success) {
        if (alertEl) {
          alertEl.style.display = 'block';
          alertEl.style.background = '#dcfce7';
          alertEl.style.color = '#15803d';
          alertEl.style.border = '1px solid #bbf7d0';
          alertEl.textContent = 'Password changed successfully!';
        }
        setTimeout(() => closeChangePasswordModal(), 1200);
      } else {
        if (alertEl) {
          alertEl.style.display = 'block';
          alertEl.style.background = '#fee2e2';
          alertEl.style.color = '#b91c1c';
          alertEl.style.border = '1px solid #fecaca';
          alertEl.textContent = data.error || 'Failed to update password.';
        }
      }
    } catch (err) {
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.style.background = '#fee2e2';
        alertEl.style.color = '#b91c1c';
        alertEl.style.border = '1px solid #fecaca';
        alertEl.textContent = 'Network or server error while changing password.';
      }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
    }
  }

  async function saveSipSettings(e) {
    e.preventDefault();
    const server = document.getElementById('sipServer')?.value.trim();
    const port   = document.getElementById('sipPort')?.value.trim();
    const domain = document.getElementById('sipDomain')?.value.trim();
    const ext    = document.getElementById('sipExt')?.value.trim();
    const pass   = document.getElementById('sipPass')?.value.trim();
    const ext2   = document.getElementById('sipExt2')?.value.trim();
    const pass2  = document.getElementById('sipPass2')?.value.trim();
    const line2  = document.getElementById('line2EnabledCheck')?.checked ? 1 : 0;

    try {
      const resp = await fetch('api.php?action=update_sip_settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sip_server: server,
          sip_port: port,
          sip_domain: domain,
          sip_extension: ext,
          sip_password: pass,
          sip_extension2: ext2,
          sip_password2: pass2,
          line2_enabled: line2
        })
      });
      const data = await resp.json();
      if (data && data.success) {
        window.AGENT_CONFIG.server = server;
        window.AGENT_CONFIG.port   = port;
        window.AGENT_CONFIG.domain = domain;
        window.AGENT_CONFIG.ext    = ext;
        window.AGENT_CONFIG.pass   = pass;
        window.AGENT_CONFIG.ext2   = ext2;
        window.AGENT_CONFIG.pass2  = pass2;
        window.AGENT_CONFIG.line2Enabled = (line2 === 1);

        closeSipSettingsModal();
        if (window.app && app.showToast) {
          app.showToast('SIP Extension settings updated & reconnected!', 'success');
        }
        if (window.app && app.initSipSoftphone) {
          app.initSipSoftphone();
        }
      } else {
        alert('Failed to save settings: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      alert('Network error saving SIP settings.');
    }
  }
  </script>

  <!-- Production SIP.js Softphone Engine & Core Dialer JS -->
  <script src="assets/js/sipjs.bundle.js?v=<?= time() ?>"></script>
  <script>
    if (!window.SIPjs && window.SIP) window.SIPjs = window.SIP;
  </script>
  <script src="assets/js/dialer.js?v=<?= time() ?>"></script>

  <!-- ── MODAL: Smart Schedule Proposal & Acceptance (Deterministic Plan) ── -->
  <div id="modalSmartScheduleProposal" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:680px;">
      <div class="modal-header">
        <div>
          <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0;">
            Proposed Smart Calling Schedule
          </h3>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">
            Optimized timeline based on contact volume, calling hours, and trunk capacity.
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalSmartScheduleProposal')">&times;</button>
      </div>

      <div class="modal-body" style="padding:18px 24px;">
        <!-- 4 Summary KPI Chips -->
        <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:16px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;">
            <div style="font-size:11px;color:#64748b;font-weight:600;">Contacts</div>
            <div id="smartPropTotalContacts" style="font-size:18px;font-weight:800;color:#0f172a;margin-top:2px;">0</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;">
            <div style="font-size:11px;color:#64748b;font-weight:600;">Active Lines</div>
            <div id="smartPropLines" style="font-size:18px;font-weight:800;color:#00A651;margin-top:2px;">2</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;">
            <div style="font-size:11px;color:#64748b;font-weight:600;">Est. Answer Rate</div>
            <div id="smartPropAnswerRate" style="font-size:18px;font-weight:800;color:#15803d;margin-top:2px;">68%</div>
          </div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;text-align:center;">
            <div style="font-size:11px;color:#64748b;font-weight:600;">Time Saved</div>
            <div id="smartPropTimeSaved" style="font-size:18px;font-weight:800;color:#0284c7;margin-top:2px;">1.5h</div>
          </div>
        </div>

        <!-- Expected Completion Banner -->
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:11px;color:#166534;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Expected Completion</div>
            <div id="smartPropCompletionText" style="font-size:13.5px;font-weight:700;color:#14532d;margin-top:2px;">Today at 04:30 PM</div>
          </div>
          <div style="font-size:11.5px;color:#166534;background:#dcfce7;padding:4px 10px;border-radius:12px;font-weight:600;">
            100% Deterministic Method
          </div>
        </div>

        <!-- Rules Used (Plain, Explainable) -->
        <div style="margin-bottom:14px;">
          <div style="font-size:11.5px;font-weight:700;color:#334155;margin-bottom:6px;">Rules applied in proposal:</div>
          <ul id="smartPropRulesList" style="margin:0;padding-left:18px;font-size:12px;color:#475569;line-height:1.6;">
            <!-- Rendered by app.renderSmartScheduleProposal() -->
          </ul>
        </div>

        <!-- Batches Timeline / Schedule Table -->
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-size:11.5px;font-weight:700;color:#334155;">Batch calling timeline:</div>
            <span style="font-size:11px;color:#64748b;" id="smartPropBatchCountLabel">3 Batches</span>
          </div>
          <div style="max-height:180px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;">
            <table class="data-table" style="font-size:11.5px;margin:0;">
              <thead>
                <tr style="background:#f8fafc;">
                  <th>Batch</th>
                  <th>Date &amp; Day</th>
                  <th>Hour Slot</th>
                  <th>Contacts</th>
                  <th>Lines</th>
                  <th>Est. Answers</th>
                  <th>Window Profile</th>
                </tr>
              </thead>
              <tbody id="smartPropBatchesTableBody">
                <!-- Batches rendered dynamically -->
              </tbody>
            </table>
          </div>
        </div>

        <!-- Edit Plan Drawer (Collapsible) -->
        <div id="smartPropEditDrawer" style="display:none;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px;margin-bottom:12px;">
          <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:8px;">Adjust Parameters &amp; Recalculate:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:8px;">
            <div>
              <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Calling Window Start</label>
              <input type="time" id="smartEditWindowStart" value="09:00" class="form-control" style="font-size:12px;padding:5px 8px;">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Calling Window End</label>
              <input type="time" id="smartEditWindowEnd" value="17:00" class="form-control" style="font-size:12px;padding:5px 8px;">
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Available Lines</label>
              <input type="number" id="smartEditLines" value="2" min="1" max="64" class="form-control" style="font-size:12px;padding:5px 8px;">
            </div>
          </div>
          <button type="button" class="btn btn-xs btn-outline-success" onclick="app.recalculateSmartPlanProposal()" style="font-size:11.5px;padding:4px 10px;font-weight:700;">
            Recalculate proposal ⟳
          </button>
        </div>
      </div>

      <div class="modal-footer" style="padding:12px 24px;display:flex;justify-content:space-between;align-items:center;background:#f8fafc;">
        <div>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.useManualScheduleFromModal()" style="font-size:12px;font-weight:600;">
            Use manual schedule
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.toggleSmartPlanEditDrawer()" style="font-size:12px;font-weight:600;margin-left:6px;">
            Edit plan
          </button>
        </div>
        <div style="display:flex;gap:8px;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="app.closeModal('modalSmartScheduleProposal')" style="font-size:12px;">Cancel</button>
          <button type="button" class="btn btn-sm btn-primary" onclick="app.acceptSmartSchedulePlan()" style="font-size:12px;font-weight:700;padding:6px 16px;background:#00A651;border-color:#00A651;">
            Accept plan &amp; Apply schedule
          </button>
        </div>
      </div>
    </div>
  </div>

  <!-- ── MODAL: IVR Keypad Responses Setup (FusionPBX Style) ── -->
  <div id="modalIvrResponses" class="modal-backdrop">
    <div class="modal-dialog" style="max-width:720px;">
      <div class="modal-header">
        <div>
          <h3 style="font-size:16px;font-weight:700;color:#0f172a;margin:0;">
            IVR Setup &amp; Call Flow Configuration
          </h3>
          <div style="font-size:12px;color:#64748b;margin-top:2px;">
            Configure call behavior: Play &amp; Hang Up or Interactive Keypad DTMF with custom response audios.
          </div>
        </div>
        <button type="button" class="btn-close" onclick="app.closeModal('modalIvrResponses')">&times;</button>
      </div>

      <form onsubmit="app.handleSaveIvrResponsesSubmit(event)">
        <div class="modal-body" style="padding:18px 24px;max-height:calc(85vh - 120px);overflow-y:auto;">
          
          <!-- IVR Mode Selection Inside Modal -->
          <div style="margin-bottom:16px;">
            <label style="display:block;font-size:12px;font-weight:700;color:#334155;margin-bottom:6px;">Select Calling Flow Type:</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
              <div id="modalLblModeBroadcast" onclick="app.setModalIvrMode('broadcast')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #cbd5e1;border-radius:8px;cursor:pointer;background:#fff;transition:all 0.2s;">
                <input type="radio" name="modal_ivr_mode" id="modalRadioBroadcast" value="broadcast" style="accent-color:#00A651;width:16px;height:16px;cursor:pointer;">
                <div>
                  <div style="font-size:12px;font-weight:700;color:#0f172a;">1. Play &amp; Hang Up</div>
                  <div style="font-size:11px;color:#64748b;">Customer listens to voice prompt, then call ends.</div>
                </div>
              </div>

              <div id="modalLblModeInteractive" onclick="app.setModalIvrMode('interactive')" style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #00A651;border-radius:8px;cursor:pointer;background:#f0fdf4;transition:all 0.2s;">
                <input type="radio" name="modal_ivr_mode" id="modalRadioInteractive" value="interactive" checked style="accent-color:#00A651;width:16px;height:16px;cursor:pointer;">
                <div>
                  <div style="font-size:12px;font-weight:700;color:#166534;">2. Interactive Menu</div>
                  <div style="font-size:11px;color:#475569;">Customer presses numbers for actions &amp; audio.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Section A: Broadcast / Play & Hang Up Settings -->
          <div id="modalBroadcastOptionsSection" style="display:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:14px;">
            <div style="font-size:12.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">Announcement IVR Settings:</div>
            <div style="font-size:11.5px;color:#64748b;line-height:1.5;margin-bottom:10px;">
              When the contact answers, the dialer plays the selected voice prompt audio once. When the playback finishes, the call automatically disconnects.
            </div>
            <div>
              <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Call Completion Outcome Label</label>
              <input type="text" id="modalBroadcastOutcomeLabel" class="form-control" value="Announcement Listened" style="font-size:12px;padding:6px 10px;max-width:320px;">
            </div>
          </div>

          <!-- Section B: Interactive Keypad Menu Settings -->
          <div id="modalInteractiveOptionsSection" style="display:block;">
            <!-- Menu Instructions Audio Selector -->
            <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:12px 14px;margin-bottom:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <label style="display:block;font-size:12px;font-weight:700;color:#0f172a;margin:0;">Menu Instructions Prompt (Audio telling caller to press 1 or 2):</label>
                <span style="font-size:11px;color:#00A651;font-weight:600;">Plays after Greeting</span>
              </div>
              <div style="font-size:11px;color:#64748b;margin-bottom:8px;">
                Plays automatically after the primary greeting audio finishes, giving instructions for keypad navigation.
              </div>
              <div style="display:flex;gap:8px;align-items:center;">
                <select id="modalIvrMenuAudioSelect" class="form-control" style="font-size:12.5px;flex:1;">
                  <!-- Populated dynamically with audio recordings -->
                </select>
                <button type="button" class="btn btn-sm btn-outline-secondary" onclick="app.previewModalMenuAudio()" style="font-size:12px;padding:5px 12px;">▶ Play</button>
              </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <div style="font-size:12px;font-weight:700;color:#334155;">
                Keypad Actions (Keys 0-9, *, #):
              </div>
              <button type="button" class="btn btn-xs btn-outline-success" onclick="app.addIvrKeyRow()" style="font-size:11.5px;padding:3px 10px;font-weight:700;">
                + Add Option Key
              </button>
            </div>

            <!-- Header Row for Table -->
            <div style="display:grid;grid-template-columns:52px 1.4fr 1.6fr 1.2fr 28px;gap:8px;padding:0 10px 4px 10px;font-size:11px;font-weight:700;color:#64748b;">
              <div>Key</div>
              <div>Action</div>
              <div>Response Audio (Played to Caller)</div>
              <div>Outcome Label</div>
              <div></div>
            </div>

            <!-- Dynamic Keypad List -->
            <div id="ivrModalKeyRowsContainer" style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
              <!-- Rows rendered dynamically by app.renderIvrModalKeys() -->
            </div>

            <!-- Timeout Settings -->
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:14px;">
              <div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:8px;">
                No Keypad Response / Timeout Handling:
              </div>
              <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:10px;">
                <div>
                  <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Timeout Seconds</label>
                  <input type="number" id="ivrModalTimeoutSec" class="form-control" value="10" min="3" max="60" style="font-size:12.5px;" required>
                </div>
                <div>
                  <label style="display:block;font-size:11px;color:#64748b;font-weight:600;margin-bottom:3px;">Action on Timeout</label>
                  <select id="ivrModalTimeoutAction" class="form-control" style="font-size:12.5px;">
                    <option value="no_response_hangup" selected>Mark No response &amp; Hang up</option>
                    <option value="repeat_menu">Repeat menu once then Hang up</option>
                    <option value="schedule_callback">Schedule follow-up callback</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <!-- Hidden File Upload for Keypad Audio Assignment -->
          <input type="file" id="ivrKeyAudioFileInput" accept=".wav,.mp3,.ogg,.m4a" style="display:none;" onchange="app.handleIvrKeyAudioFileChosen(this)">

        </div>

        <div class="modal-footer" style="padding:12px 24px;display:flex;justify-content:flex-end;gap:8px;background:#f8fafc;">
          <button type="button" class="btn btn-sm btn-secondary" onclick="app.closeModal('modalIvrResponses')">Cancel</button>
          <button type="submit" class="btn btn-sm btn-primary" style="font-weight:700;background:#00A651;border-color:#00A651;padding:6px 18px;">
            Save IVR Setup
          </button>
        </div>
      </form>
    </div>
  </div>

</body>
</html>
