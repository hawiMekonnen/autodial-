/**
 * SkyConnect Automated Outbound Voice Dialer - Production Controller & WebRTC Bridge
 * Generic SIP Outbound Calling & Automated Voice Engine
 */

// Generic Dial Normalization
window.skykinNormalizeDial = function(raw, defaultCountryCode) {
  var s = String(raw || '').trim();
  if (!s) return s;
  if (/^2\d{2}$/.test(s) || /^1\d{2}$/.test(s)) return s; // Internal extensions
  var d = s.replace(/\D/g, '');
  if (!d) return s;
  if (s.startsWith('+')) return '+' + d;
  if (d.startsWith('00')) return '+' + d.slice(2);
  var cc = (defaultCountryCode || '+251').replace(/\D/g, '');
  if (d.startsWith('0') && d.length >= 8) {
    return '+' + cc + d.slice(1);
  }
  if (/^[79]\d{8}$/.test(d)) {
    return '+' + cc + d;
  }
  if (/^251[79]\d{8}$/.test(d)) {
    return '+' + d;
  }
  return '+' + d;
};
window.skykinNormalizeEtDial = window.skykinNormalizeDial;

class SkyKinDialerApp {
  constructor() {
    this.campaign = null;
    this.leads = [];
    this.stats = {};
    this.audioRecordings = [];
    this.activeChannels = new Map();
    this.isRunning = false;
    this.isPaused = false;
    this.activeAudioPlayer = null;

    // Outbound Softphone WebRTC state (Dual-Line Engine)
    this.line1 = {
      num: 1,
      ext: '101',
      pass: '1234',
      ua: null,
      reg: null,
      isRegistered: false,
      session: null,
      activeChannelId: null,
      audioCtx: null,
      ivrSource: null
    };
    this.line2 = {
      num: 2,
      ext: '102',
      pass: '1234',
      enabled: true,
      ua: null,
      reg: null,
      isRegistered: false,
      session: null,
      activeChannelId: null,
      audioCtx: null,
      ivrSource: null
    };

    this.cachedAudioMap = new Map();
    this.manualTimerInterval = null;
    this.manualStartTime = null;
    this.isMuted = false;
    this.isHeld = false;
    this.ringbackCtx = null;
    this.ringbackInterval = null;
    this.selectedCampaignIds = [1];
    this.selectedCampaigns = [];
    this.telephonyMetrics = null;
    this.isAgentCallActive = false;
    this.agentCallTimerInterval = null;
    this.lastCallDuration = 0;
    this.dialRatio = 2.1;
    this.maxAbandonRate = 2.4;
    this.callingHours = 'standard';
    this.maxAttempts = 3;
    this.retryAfter = '2h';

    // Unanswered and Callbacks state
    this.unansweredSubTab = 'unanswered';
    this.unansDatePreset = 'today';
    this.unansDateFrom = '';
    this.unansDateTo = '';
    this.unansCurrentPage = 1;
    this.unansRowsPerPage = 25;
    this.selectedUnansweredIds = new Set();

    // SMS Dispatcher and Live Messenger state
    this.activeSmsCampaignId = null;
    this.activeSmsCampaign = null;
    this.activeSmsLead = null;
    this.smsLeads = [];
    this._smsSearchFilter = '';
    this._smsStatusFilter = 'all';
    this._smsPageLimit = 20;
    this.isSmsDispatcherRunning = false;
    this.isSmsDispatcherPaused = false;
    this._smsCountdownTimer = null;

    this.initElements();
    this.initEventListeners();
    try {
      this.initSipTelephony();
    } catch(e) {
      console.warn('SIP Telephony init error:', e);
    }
    this.loadCampaignData();
    this.loadCampaignsOverview();
    this.loadCallbacksList();
    this.startTelephonyMetricsHeartbeat();
  }

  initAudioContextUnlock() {
    if (this._audioUnlockInitialized) return;
    this._audioUnlockInitialized = true;
    const unlock = () => {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!this.sharedAudioCtx && AudioCtxClass) {
        try {
          this.sharedAudioCtx = new AudioCtxClass();
        } catch(e) {}
      }
      if (this.sharedAudioCtx && this.sharedAudioCtx.state === 'suspended') {
        this.sharedAudioCtx.resume().catch(() => {});
      }
    };
    ['click', 'touchstart', 'keydown'].forEach(ev => {
      document.addEventListener(ev, unlock, { passive: true });
    });
  }

  initElements() {
    this.initAudioContextUnlock();
    this.btnStart = document.getElementById('btnStartCampaign');
    this.btnPause = document.getElementById('btnPauseCampaign');
    this.btnStop = document.getElementById('btnStopCampaign');
    this.syncDialerControlButtons();
    this.btnReset = document.getElementById('btnResetLeads');
    this.btnExportLogs = document.getElementById('btnExportLogs');

    this.channelsContainer = document.getElementById('activeChannelsGrid');
    this.leadsTableBody = document.getElementById('leadsTableBody');
    this.leadsTableBodyFull = document.getElementById('leadsTableBodyFull');
    this.logsTableBody = document.getElementById('logsTableBody');

    this.campaignStatusTag = document.getElementById('campaignStatusTag');
    this.campaignTitleText = document.getElementById('campaignTitleText');
    this.audioSelectDropdown = document.getElementById('ivrAudioSelector');
    this.audioSelectDropdownTab = document.getElementById('ivrAudioSelectorTab');
    this.audioPlayerElement = document.getElementById('mainAudioPlayer');
    this.tabAudioPlayer = document.getElementById('tabAudioPlayer');
    this.activeAudioTitle = document.getElementById('activeAudioTitle');

    // KPI fields
    this.kpiTotal = document.getElementById('kpiTotalLeads');
    this.kpiPending = document.getElementById('kpiPendingLeads');
    this.kpiConnected = document.getElementById('kpiConnectedLeads');
    this.kpiAnswerRate = document.getElementById('kpiAnswerRate');
    this.kpiAvgDuration = document.getElementById('kpiAvgDuration');
  }

  initEventListeners() {
    this.btnStart?.addEventListener('click', () => this.startCampaign());
    this.btnPause?.addEventListener('click', () => this.togglePauseCampaign());
    this.btnStop?.addEventListener('click', () => this.stopCampaign());
    this.btnReset?.addEventListener('click', () => this.resetLeads());
    this.btnExportLogs?.addEventListener('click', () => {
      window.location.href = 'api.php?action=export_logs_csv&campaign_id=' + (this.campaign?.id || 1);
    });

    this.audioSelectDropdown?.addEventListener('change', (e) => this.selectAudioRecording(e.target.value));

    // Modals
    document.querySelectorAll('.btn-close-modal').forEach(btn => {
      btn.addEventListener('click', () => this.closeAllModals());
    });

    // Upload Lead File Form
    document.getElementById('formUploadLeads')?.addEventListener('submit', (e) => this.handleFileUpload(e));
    document.getElementById('formManualLeads')?.addEventListener('submit', (e) => this.handleManualUpload(e));
    document.getElementById('formUploadAudio')?.addEventListener('submit', (e) => this.handleAudioUpload(e));

    const uploadStratSel = document.getElementById('uploadScheduleStrategy');
    if (uploadStratSel) {
      uploadStratSel.addEventListener('change', (e) => this.handleUploadStrategyChange(e.target.value));
    }
    const manualStratSel = document.getElementById('manualScheduleStrategy');
    if (manualStratSel) {
      manualStratSel.addEventListener('change', (e) => this.handleManualStrategyChange(e.target.value));
    }

    // Drag and Drop
    const dropzone = document.getElementById('dropzoneBox');
    const fileInput = document.getElementById('leadFileInput');
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
          const fn = fileInput.files[0].name;
          const fnEl = document.getElementById('selectedFileName');
          if (fnEl) fnEl.textContent = fn;
          const campInp = document.getElementById('newCampaignContactsInput');
          if (campInp) campInp.value = fn;
          this.pendingCampaignFile = fileInput.files[0];
        }
      });
      ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (ev === 'drop' && e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          const fn = fileInput.files[0].name;
          const fnEl = document.getElementById('selectedFileName');
          if (fnEl) fnEl.textContent = fn;
          const campInp = document.getElementById('newCampaignContactsInput');
          if (campInp) campInp.value = fn;
          this.pendingCampaignFile = fileInput.files[0];
        }
      }));
    }

    // Lead Search & Filter
    document.getElementById('leadSearchInput')?.addEventListener('input', () => this.renderLeadsTables());
    document.getElementById('leadStatusFilter')?.addEventListener('change', () => this.renderLeadsTables());

    // SMS Dispatcher Controls
    document.getElementById('btnLaunchSmsDispatcher')?.addEventListener('click', () => this.startSmsDispatcher());
    document.getElementById('btnPauseSmsDispatcher')?.addEventListener('click', () => this.togglePauseSmsDispatcher());
    document.getElementById('btnStopSmsDispatcher')?.addEventListener('click', () => this.stopSmsDispatcher());
  }

  /* ─────────────────────────────────────────────────────────
     SIP.js Dual-Line WebRTC Registration & Softphone Bridge
     ───────────────────────────────────────────────────────── */
  initSipTelephony() {
    const cfg = window.AGENT_CONFIG || {};
    const ext = localStorage.getItem('sip_ext') || cfg.ext || '101';
    const pass = localStorage.getItem('sip_pass') || cfg.pass || '1234';
    const ext2 = localStorage.getItem('sip_ext2') || cfg.ext2 || '102';
    const pass2 = localStorage.getItem('sip_pass2') || cfg.pass2 || '1234';
    const l2Stored = localStorage.getItem('line2_enabled');
    const l2Enabled = l2Stored !== null ? (l2Stored === '1' || l2Stored === 'true') : (cfg.line2Enabled !== false);
    const server = localStorage.getItem('sip_server') || cfg.server || 'webcc.skyconnectsolutions.et';
    const port = localStorage.getItem('sip_port') || cfg.port || '443';
    const dom = localStorage.getItem('sip_domain') || cfg.domain || 'client1.skykin.local';

    // Populate modal inputs
    if (document.getElementById('sipExt')) document.getElementById('sipExt').value = ext;
    if (document.getElementById('sipPass')) document.getElementById('sipPass').value = pass;
    if (document.getElementById('sipExt2')) document.getElementById('sipExt2').value = ext2;
    if (document.getElementById('sipPass2')) document.getElementById('sipPass2').value = pass2;
    if (document.getElementById('line2EnabledCheck')) document.getElementById('line2EnabledCheck').checked = l2Enabled;
    if (document.getElementById('sipServer')) document.getElementById('sipServer').value = server;
    if (document.getElementById('sipPort')) document.getElementById('sipPort').value = port;
    if (document.getElementById('sipDomain')) document.getElementById('sipDomain').value = dom;

    this.connectDualSip({ ext, pass, ext2, pass2, l2Enabled, server, port, dom });
  }

  connectDualSip(config) {
    const { ext, pass, ext2, pass2, l2Enabled, server, port, dom } = config;
    this.line1.ext = ext || '101';
    this.line1.pass = pass || '1234';
    this.line2.ext = ext2 || '102';
    this.line2.pass = pass2 || '1234';
    this.line2.enabled = !!l2Enabled;
    this.sipServer = server;
    this.sipPort = port;
    this.sipDomain = dom;

    this.updateSipStatus('connecting', 'Connecting Dual SIP...');

    // Build WebSocket URI
    let wsUri = server.trim();
    if (!wsUri.startsWith('wss://') && !wsUri.startsWith('ws://')) {
      const isHttps = typeof location !== 'undefined' && location.protocol === 'https:';
      wsUri = (isHttps ? 'wss://' : 'ws://') + wsUri;
    }
    const hostPart = wsUri.replace(/^wss?:\/\//i, '');
    if (!hostPart.includes('/')) {
      if (port && port !== '443' && port !== '80' && !hostPart.includes(':')) {
        wsUri = wsUri + ':' + port + '/wss/';
      } else {
        wsUri = wsUri + '/wss/';
      }
    }
    this.wsUri = wsUri;

    const startBridge = (tries = 0) => {
      const SIP = window.SIPjs || window.SIP;
      if (window.SIP && !window.SIPjs) window.SIPjs = window.SIP;
      if (!SIP || !SIP.UserAgent) {
        if (tries < 30) {
          setTimeout(() => startBridge(tries + 1), 150);
          return;
        }
        this.updateSipStatus('failed', 'SIP softphone standby');
        return;
      }

      const { UserAgent, Registerer, RegistererState } = SIP;

      // Register Line 1
      this.initSingleLine(this.line1, this.line1.ext, this.line1.pass, dom, wsUri, UserAgent, Registerer, RegistererState);

      // Register Line 2 if enabled
      if (this.line2.enabled && this.line2.ext) {
        this.initSingleLine(this.line2, this.line2.ext, this.line2.pass, dom, wsUri, UserAgent, Registerer, RegistererState);
      } else {
        this.teardownLine(this.line2);
      }

      // Softphone bridge methods for UI
      window.sipBridge = {
        call: (target, d, lNum = 1) => this.sipMakeCall(target, d || dom, {}, lNum),
        hangup: (lNum) => this.sipHangup(lNum),
        hold: (lNum) => this.sipHold(lNum),
        unhold: (lNum) => this.sipUnhold(lNum),
        mute: (lNum) => this.sipMute(lNum),
        unmute: (lNum) => this.sipUnmute(lNum),
        sendDtmf: (tone, lNum) => this.sipSendDtmf(tone, lNum)
      };
    };

    startBridge();
  }

  initSingleLine(lineObj, ext, pass, dom, wsUri, UserAgent, Registerer, RegistererState) {
    this.teardownLine(lineObj);

    lineObj.ext = ext;
    lineObj.pass = pass;

    const sipUri = UserAgent.makeURI('sip:' + ext + '@' + dom);
    if (!sipUri) {
      console.warn(`Invalid SIP URI: sip:${ext}@${dom}`);
      return;
    }

    try {
      lineObj.ua = new UserAgent({
        uri: sipUri,
        transportOptions: {
          server: wsUri,
          connectionTimeout: 10,
          traceSip: false
        },
        authorizationUsername: ext,
        authorizationPassword: pass,
        contactParams: { transport: 'wss' },
        logLevel: 'error',
        sessionDescriptionHandlerFactoryOptions: {
          peerConnectionConfiguration: {
            iceServers: [
              { urls: 'stun:stun.cloudflare.com:3478' },
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        }
      });

      lineObj.reg = new Registerer(lineObj.ua, { expires: 300 });

      lineObj.reg.stateChange.addListener(state => {
        if (state === RegistererState.Registered || state === 'Registered') {
          lineObj.isRegistered = true;
          this.updateSipStatus();
          this.showToast(`Line ${lineObj.num} (${ext}) Registered`, 'success');
        } else if (state === RegistererState.Unregistered || state === 'Unregistered') {
          lineObj.isRegistered = false;
          this.updateSipStatus();
        } else if (state === RegistererState.Terminated || state === 'Terminated') {
          lineObj.isRegistered = false;
          this.updateSipStatus();
        }
      });

      lineObj.ua.start()
        .then(() => {
          lineObj.reg.register();
        })
        .catch(err => {
          console.warn(`Line ${lineObj.num} SIP UA start notice:`, err);
          lineObj.isRegistered = false;
          this.updateSipStatus();
        });
    } catch (err) {
      console.error(`Line ${lineObj.num} SIP init error:`, err);
    }
  }

  teardownLine(lineObj) {
    if (lineObj.ua) {
      try {
        if (lineObj.reg) lineObj.reg.unregister();
        lineObj.ua.stop();
      } catch (e) {}
      lineObj.ua = null;
      lineObj.reg = null;
      lineObj.isRegistered = false;
      lineObj.session = null;
      lineObj.activeChannelId = null;
    }
  }

  reconnectDualSip(ext, pass, ext2, pass2, l2Enabled, server, port, dom) {
    localStorage.setItem('sip_ext', ext);
    localStorage.setItem('sip_pass', pass);
    localStorage.setItem('sip_ext2', ext2);
    localStorage.setItem('sip_pass2', pass2);
    localStorage.setItem('line2_enabled', l2Enabled ? '1' : '0');
    localStorage.setItem('sip_server', server);
    localStorage.setItem('sip_port', port);
    localStorage.setItem('sip_domain', dom);

    this.showToast('Re-connecting SIP Lines...', 'info');
    this.connectDualSip({ ext, pass, ext2, pass2, l2Enabled, server, port, dom });
  }

  updateSipStatus(customState, customText) {
    const dot = document.getElementById('sipDot');
    const headerDot = document.getElementById('headerSipDot');
    const badge = document.getElementById('fabBadge');
    const statusText = document.getElementById('sipStatusText');
    const headerText = document.getElementById('headerSipStatusText');

    let state = 'unregistered';
    let text = '';

    if (customState && customText) {
      state = customState;
      text = customText;
    } else {
      const l1Ready = this.line1.isRegistered;
      const l2Ready = this.line2.enabled && this.line2.isRegistered;

      if (this.line1.session || this.line2.session) {
        state = 'calling';
      } else if (l1Ready || l2Ready) {
        state = 'registered';
      } else {
        state = 'unregistered';
      }

      if (this.line2.enabled && this.line2.ext) {
        const l1Str = `L1: ${this.line1.ext} (${l1Ready ? 'Ready' : 'Off'})`;
        const l2Str = `L2: ${this.line2.ext} (${l2Ready ? 'Ready' : 'Off'})`;
        text = `${l1Str} | ${l2Str}`;
      } else {
        text = `Ext: ${this.line1.ext || '101'} (${l1Ready ? 'Ready' : 'Off'})`;
      }
    }

    [dot, headerDot].forEach(d => {
      if (!d) return;
      d.className = 'sip-dot ' + state;
    });

    if (badge) {
      badge.className = 'fab-badge show ' + (state === 'registered' ? '' : (state === 'calling' ? 'calling' : 'unreg'));
    }

    if (statusText) statusText.textContent = text;
    if (headerText) headerText.textContent = text;
    this.updateTelephonyKpiCards();
  }

  async sipMakeCall(rawTarget, dom, callbacks = {}, lineNum = 1) {
    const lineObj = (lineNum === 2 && this.line2.enabled) ? this.line2 : this.line1;
    const SIP = window.SIPjs || window.SIP;

    if (!lineObj.ua || !SIP) {
      if (callbacks.onError) callbacks.onError(new Error(`Line ${lineObj.num} SIP not initialized`));
      this.showToast(`Line ${lineObj.num} SIP is not initialized`, 'error');
      return;
    }

    const target = window.skykinNormalizeEtDial(rawTarget);
    const targetUri = SIP.UserAgent.makeURI('sip:' + target + '@' + (dom || this.sipDomain || 'client1.skykin.local'));
    if (!targetUri) {
      if (callbacks.onError) callbacks.onError(new Error('Invalid phone number'));
      this.showToast('Invalid target phone number', 'error');
      return;
    }

    // Hangup existing session on this line cleanly
    if (lineObj.session) {
      try {
        if (lineObj.session.dispose) lineObj.session.dispose();
      } catch (e) {}
      lineObj.session = null;
    }

    // Acquire microphone permission once if possible
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      }
    } catch (e) {
      console.warn('Microphone permission:', e);
    }

    try {
      const inviter = new SIP.Inviter(lineObj.ua, targetUri, {
        sessionDescriptionHandlerOptions: {
          constraints: { audio: true, video: false },
          peerConnectionConfiguration: {
            iceServers: [
              { urls: 'stun:stun.cloudflare.com:3478' },
              { urls: 'stun:stun.l.google.com:19302' }
            ]
          }
        }
      });
      lineObj.session = inviter;
      this.updateSipStatus();

      // Receive incoming DTMF tones via SIP INFO or delegate events from FreeSWITCH
      const handleIncomingDtmfInfo = (info) => {
        try {
          const body = String(info.request?.body || info.request?.message?.body || info.body || '');
          console.log(`[Line ${lineObj.num}] SIP INFO received:`, body);
          const match = body.match(/(?:Signal\s*[:=]\s*|dtmf\s*[:=]\s*|\b)([0-9*#A-D])\b/i);
          if (match && match[1]) {
            const digit = match[1];
            console.log(`[Line ${lineObj.num}] Extracted DTMF digit:`, digit);
            this.handleIvrDtmfInput(lineObj.num, digit);
          }
          if (info.accept) info.accept();
        } catch(e) {
          console.warn('Error handling SIP INFO:', e);
        }
      };

      inviter.delegate = {
        onInfo: handleIncomingDtmfInfo
      };
      if (lineObj.ua) {
        lineObj.ua.delegate = {
          onInfo: handleIncomingDtmfInfo
        };
      }
      inviter.onCallDTMFReceived = (tone) => {
        console.log(`[Line ${lineObj.num}] onCallDTMFReceived:`, tone);
        this.handleIvrDtmfInput(lineObj.num, String(tone));
      };

      inviter.stateChange.addListener(state => {
        if (state === SIP.SessionState.Establishing) {
          if (callbacks.onEstablishing) callbacks.onEstablishing();
        }
        if (state === SIP.SessionState.Established) {
          this.stopRingbackTone();
          const pc = inviter.sessionDescriptionHandler?.peerConnection;
          if (pc) this.attachAudio(pc);
          this.showToast(`Line ${lineObj.num}: Connected to ${target}`, 'success');
          if (callbacks.onEstablished) callbacks.onEstablished(pc);
        }
        if (state === SIP.SessionState.Terminated) {
          this.stopRingbackTone();
          this.stopCurrentIvrAudio(lineObj.num);
          lineObj.session = null;
          this.updateSipStatus();
          if (callbacks.onTerminated) callbacks.onTerminated();
        }
      });

      await inviter.invite({
        requestDelegate: {
          onProgress: () => {
            if (callbacks.onProgress) callbacks.onProgress();
          },
          onAccept: () => {
            this.stopRingbackTone();
          },
          onReject: (response) => {
            this.stopRingbackTone();
            this.showToast(`Line ${lineObj.num} declined: ${response.statusCode} ${response.reasonPhrase}`, 'warning');
            if (callbacks.onReject) callbacks.onReject(response);
          }
        },
        extraHeaders: [
          'X-DTMF-Type: info',
          'Recv-Info: application/dtmf-relay, application/dtmf'
        ]
      });

    } catch (e) {
      this.stopRingbackTone();
      console.error(`Line ${lineObj.num} SIP Call invite failed:`, e);
      if (callbacks.onError) callbacks.onError(e);
    }
  }

  /* ─────────────────────────────────────────────────────────
     IVR In-Call Audio Stream Injection (Streams into Phone Call)
     ───────────────────────────────────────────────────────── */
  async getAudioArrayBuffer(audioUrl) {
    if (this.cachedAudioMap.has(audioUrl)) {
      const cached = this.cachedAudioMap.get(audioUrl);
      return cached.slice(0);
    }
    try {
      const response = await fetch(audioUrl);
      const buf = await response.arrayBuffer();
      this.cachedAudioMap.set(audioUrl, buf);
      return buf.slice(0);
    } catch(fetchErr) {
      console.warn('Could not fetch audioUrl directly, trying relative path:', fetchErr);
      const response = await fetch(audioUrl.replace(/^assets\//, 'assets/'));
      const buf = await response.arrayBuffer();
      this.cachedAudioMap.set(audioUrl, buf);
      return buf.slice(0);
    }
  }

  async playIvrAudioIntoPeerConnection(audioUrl, pc, onEnded, lineNum = 1) {
    if (!audioUrl) {
      if (onEnded) onEnded();
      return;
    }

    const lineObj = lineNum === 2 ? this.line2 : this.line1;

    // Clean up previous IVR audio context for this line
    if (lineObj.ivrSource) {
      try { lineObj.ivrSource.stop(); } catch(e) {}
      lineObj.ivrSource = null;
    }
    if (lineObj.audioCtx) {
      try { lineObj.audioCtx.close(); } catch(e) {}
      lineObj.audioCtx = null;
    }

    let currentToken = null;
    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      if (audioCtx.state !== 'running') {
        try { await audioCtx.resume(); } catch(e) {}
      }
      lineObj.audioCtx = audioCtx;

      // Get cloned ArrayBuffer for clean decoding without detaching issues
      const arrayBuffer = await this.getAudioArrayBuffer(audioUrl);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const durationSec = Math.max(2, audioBuffer.duration || 5);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = 1.0;

      const destination = audioCtx.createMediaStreamDestination();
      source.connect(gainNode);
      gainNode.connect(destination);

      const ivrTrack = destination.stream.getAudioTracks()[0];
      if (ivrTrack) {
        ivrTrack.enabled = true;
      }

      // Robust sender attachment with retry loop to ensure track is replaced even if sender initializes asynchronously
      if (pc && ivrTrack) {
        let attached = false;
        for (let attempt = 0; attempt < 15; attempt++) {
          const senders = pc.getSenders ? pc.getSenders() : [];
          let audioSender = senders.find(s => s.track && s.track.kind === 'audio');
          if (!audioSender && senders.length > 0) {
            audioSender = senders.find(s => !s.track || (s.track && s.track.kind === 'audio')) || senders[0];
          }
          if (audioSender && audioSender.replaceTrack) {
            try {
              await audioSender.replaceTrack(ivrTrack);
              console.log(`[Line ${lineNum}] IVR Audio track replaced on sender (attempt ${attempt + 1})`);
              attached = true;
              break;
            } catch(e) {
              console.warn(`[Line ${lineNum}] replaceTrack error on attempt ${attempt + 1}:`, e);
            }
          }
          await new Promise(r => setTimeout(r, 100));
        }
        if (!attached) {
          console.warn(`[Line ${lineNum}] Could not attach IVR track to peerConnection senders`);
        }
      }

      lineObj.ivrSource = source;
      currentToken = {};
      lineObj.currentPlaybackToken = currentToken;

      let finished = false;
      const finishPlayback = () => {
        if (finished) return;
        finished = true;
        lineObj.ivrSource = null;
        setTimeout(() => {
          if (lineObj.currentPlaybackToken === currentToken && onEnded) {
            onEnded();
          }
        }, 200);
      };

      source.onended = finishPlayback;
      source.start(0);

      // Fallback safety timer: guarantees completion after full audio length + 1s buffer
      setTimeout(() => {
        if (lineObj.currentPlaybackToken === currentToken) {
          finishPlayback();
        }
      }, (durationSec + 1) * 1000);

      return { source, duration: durationSec };
    } catch (err) {
      console.error(`[Line ${lineNum}] Error in playIvrAudioIntoPeerConnection:`, err);
      setTimeout(() => {
        if (onEnded) onEnded();
      }, 500);
      return null;
    }
  }

  stopCurrentIvrAudio(lineNum = null) {
    const stopLineAudio = (lineObj) => {
      if (lineObj) {
        lineObj.currentPlaybackToken = null;
        if (lineObj.ivrSource) {
          try {
            lineObj.ivrSource.onended = null;
            lineObj.ivrSource.stop();
          } catch(e) {}
          lineObj.ivrSource = null;
        }
        if (lineObj.audioCtx) {
          try { lineObj.audioCtx.close(); } catch(e) {}
          lineObj.audioCtx = null;
        }
      }
    };

    if (lineNum === 1) {
      stopLineAudio(this.line1);
    } else if (lineNum === 2) {
      stopLineAudio(this.line2);
    } else {
      stopLineAudio(this.line1);
      stopLineAudio(this.line2);
    }
  }

  sipHangup(lineNum = null, triggerFinish = true) {
    this.stopRingbackTone();
    this.stopCurrentIvrAudio(lineNum);

    const stopDtmfDetector = (lineObj) => {
      if (lineObj && lineObj.dtmfAudioCtx) {
        try { lineObj.dtmfAudioCtx.close(); } catch(e){}
        lineObj.dtmfAudioCtx = null;
      }
    };
    if (lineNum === 1) stopDtmfDetector(this.line1);
    else if (lineNum === 2) stopDtmfDetector(this.line2);
    else { stopDtmfDetector(this.line1); stopDtmfDetector(this.line2); }

    if (triggerFinish) {
      // Also stop any broadcast audio on virtual/trunk channels
      this.activeChannels.forEach(ch => {
        if (!lineNum || ch.lineNum === lineNum) {
          if (ch.cancelRinging) ch.cancelRinging();
          if (ch.audioPlayer) {
            try { ch.audioPlayer.pause(); } catch(e) {}
            ch.audioPlayer = null;
          }
          if (ch.finishCall) {
            ch.finishCall('completed', ch.duration || 1);
          }
        }
      });
    }

    const hangupSession = (lineObj) => {
      if (lineObj && lineObj.session) {
        try {
          const SIP = window.SIPjs || window.SIP;
          const s = lineObj.session;
          if (s.state === SIP?.SessionState?.Established || s.state === 'Established') {
            if (s.bye) s.bye();
          } else if (s.state === SIP?.SessionState?.Establishing || s.state === 'Establishing') {
            if (s.cancel) s.cancel();
          } else {
            if (s.bye) s.bye();
            else if (s.cancel) s.cancel();
          }
        } catch (e) {
          console.warn(`Line ${lineObj.num} SIP Hangup notice:`, e);
        }
        try {
          if (lineObj.session.dispose) lineObj.session.dispose();
        } catch(e) {}
        lineObj.session = null;
      }
    };

    if (lineNum === 1) {
      hangupSession(this.line1);
    } else if (lineNum === 2) {
      hangupSession(this.line2);
    } else {
      hangupSession(this.line1);
      hangupSession(this.line2);
    }
    this.updateSipStatus();
  }

  sipHold(lineNum = 1) {
    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    if (lineObj.session && lineObj.session.hold) lineObj.session.hold();
  }

  sipUnhold(lineNum = 1) {
    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    if (lineObj.session && lineObj.session.unhold) lineObj.session.unhold();
  }

  sipMute(lineNum = 1) {
    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    const pc = lineObj.session?.sessionDescriptionHandler?.peerConnection;
    if (pc) pc.getSenders().forEach(s => { if (s.track) s.track.enabled = false; });
  }

  sipUnmute(lineNum = 1) {
    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    const pc = lineObj.session?.sessionDescriptionHandler?.peerConnection;
    if (pc) pc.getSenders().forEach(s => { if (s.track) s.track.enabled = true; });
  }

  sipSendDtmf(tone, lineNum = 1) {
    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    if (lineObj.session && lineObj.session.sessionDescriptionHandler) {
      try { lineObj.session.sessionDescriptionHandler.sendDtmf(tone); } catch(e) {}
    }
  }

  attachAudio(pc, isManualCall = false) {
    let el = document.getElementById('remoteAudio');
    if (!el) {
      el = document.createElement('audio');
      el.id = 'remoteAudio';
      el.autoplay = true;
      document.body.appendChild(el);
    }
    
    // Silence computer speakers without setting muted=true (which halts WebRTC RTP decoding in Chromium)
    el.muted = false;
    el.volume = 0.0001;

    const remote = new MediaStream();
    pc.getReceivers().forEach(r => { if (r.track) remote.addTrack(r.track); });
    if (remote.getTracks().length > 0) {
      el.srcObject = remote;
      el.play().catch(() => {});
    }

    pc.ontrack = (ev) => {
      if (el) {
        el.muted = false;
        el.volume = 0.0001;
        el.srcObject = ev.streams[0] || new MediaStream([ev.track]);
        el.play().catch(() => {});
      }
    };
  }

  setupRemoteDtmfDetector(pc, lineNum = 1) {
    if (!pc) return;
    try {
      this.initAudioContextUnlock();
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!this.sharedAudioCtx && AudioCtxClass) {
        try { this.sharedAudioCtx = new AudioCtxClass(); } catch(e) {}
      }
      const audioCtx = this.sharedAudioCtx;
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
      }

      const attachToTrack = (track) => {
        if (!track || track.kind !== 'audio') return;
        try {
          if (audioCtx.state === 'suspended') {
            audioCtx.resume().catch(() => {});
          }
          const stream = new MediaStream([track]);
          const source = audioCtx.createMediaStreamSource(stream);

          const bufferSize = 1024;
          const scriptNode = audioCtx.createScriptProcessor ? audioCtx.createScriptProcessor(bufferSize, 1, 1) : null;
          if (!scriptNode) return;

          const sRate = audioCtx.sampleRate;
          const dtmfFrequencies = {
            low: [697, 770, 852, 941],
            high: [1209, 1336, 1477]
          };
          const dtmfMap = {
            '697,1209': '1', '697,1336': '2', '697,1477': '3',
            '770,1209': '4', '770,1336': '5', '770,1477': '6',
            '852,1209': '7', '852,1336': '8', '852,1477': '9',
            '941,1209': '*', '941,1336': '0', '941,1477': '#'
          };

          const goertzel = (samples, targetFreq, sampleRate) => {
            const k = Math.round((samples.length * targetFreq) / sampleRate);
            const w = (2 * Math.PI * k) / samples.length;
            const cosine = Math.cos(w);
            const coeff = 2 * cosine;
            let q0 = 0, q1 = 0, q2 = 0;
            for (let i = 0; i < samples.length; i++) {
              q0 = coeff * q1 - q2 + samples[i];
              q2 = q1;
              q1 = q0;
            }
            return q1 * q1 + q2 * q2 - q1 * q2 * coeff;
          };

          let lastDetected = null;
          let detectCount = 0;

          scriptNode.onaudioprocess = (audioProcessingEvent) => {
            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
            let totalEnergy = 0;
            for (let i = 0; i < inputData.length; i++) {
              totalEnergy += inputData[i] * inputData[i];
            }
            if (totalEnergy < 1e-6) {
              detectCount = 0;
              lastDetected = null;
              return;
            }

            let maxLowFreq = null, maxLowMag = 0, secondLowMag = 0;
            let maxHighFreq = null, maxHighMag = 0, secondHighMag = 0;

            for (const f of dtmfFrequencies.low) {
              const mag = goertzel(inputData, f, sRate);
              if (mag > maxLowMag) {
                secondLowMag = maxLowMag;
                maxLowMag = mag;
                maxLowFreq = f;
              } else if (mag > secondLowMag) {
                secondLowMag = mag;
              }
            }
            for (const f of dtmfFrequencies.high) {
              const mag = goertzel(inputData, f, sRate);
              if (mag > maxHighMag) {
                secondHighMag = maxHighMag;
                maxHighMag = mag;
                maxHighFreq = f;
              } else if (mag > secondHighMag) {
                secondHighMag = mag;
              }
            }

            const isToneDominant = (maxLowMag > 0.5) && (maxHighMag > 0.5) &&
                                  (maxLowMag > 1.4 * (secondLowMag + 0.05)) &&
                                  (maxHighMag > 1.4 * (secondHighMag + 0.05));

            if (isToneDominant) {
              const key = `${maxLowFreq},${maxHighFreq}`;
              const digit = dtmfMap[key];
              if (digit) {
                if (digit === lastDetected) {
                  detectCount++;
                  if (detectCount >= 1) {
                    console.log(`[Line ${lineNum}] In-band DTMF detected on audio stream:`, digit);
                    this.handleIvrDtmfInput(lineNum, digit);
                  }
                } else {
                  lastDetected = digit;
                  detectCount = 1;
                }
                return;
              }
            }
            detectCount = 0;
            lastDetected = null;
          };

          source.connect(scriptNode);
          const muteGain = audioCtx.createGain();
          muteGain.gain.value = 0;
          scriptNode.connect(muteGain);
          muteGain.connect(audioCtx.destination);
        } catch(err) {
          console.warn('attachToTrack error:', err);
        }
      };

      const receivers = pc.getReceivers ? pc.getReceivers() : [];
      const audioReceiver = receivers.find(r => r.track && r.track.kind === 'audio');
      if (audioReceiver && audioReceiver.track) {
        attachToTrack(audioReceiver.track);
      }
      pc.addEventListener('track', (e) => {
        if (e.track && e.track.kind === 'audio') attachToTrack(e.track);
      });
    } catch(e) {
      console.warn('DTMF audio detector setup error:', e);
    }
  }

  startRingbackTone() {
    this.stopRingbackTone();
    // Computer speakers remain silent during dialing
    return;
  }

  stopRingbackTone() {
    if (this.ringbackInterval) {
      clearInterval(this.ringbackInterval);
      this.ringbackInterval = null;
    }
    if (this.ringbackCtx) {
      try { this.ringbackCtx.close(); } catch(e) {}
      this.ringbackCtx = null;
    }
  }

  openModal(modalId) {
    document.getElementById(modalId)?.classList.add('open');
    if (modalId === 'modalUpload') {
      const strat = document.getElementById('uploadScheduleStrategy')?.value || 'interval';
      this.handleUploadStrategyChange(strat);
    } else if (modalId === 'modalManual') {
      const strat = document.getElementById('manualScheduleStrategy')?.value || 'interval';
      this.handleManualStrategyChange(strat);
    }
  }

  closeModal(modalId) {
    if (modalId) {
      document.getElementById(modalId)?.classList.remove('open');
    } else {
      this.closeAllModals();
    }
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
  }

  handleSingleAddSubmit(e) { return this.handleModalSingleAdd(e); }
  handleUploadSubmit(e) { return this.handleFileUpload(e); }
  handleManualSubmit(e) { return this.handleManualUpload(e); }
  handleAudioUploadSubmit(e) { return this.handleAudioUpload(e); }

  exportContactsCsv() {
    window.location.href = 'api.php?action=export_contacts_csv&campaign_id=' + (this.campaign?.id || 1);
  }

  async loadReportsAndLogs() {
    await this.loadCampaignData();
    this.renderHistoryTable();
  }

  showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  /* ─────────────────────────────────────────────────────────
     Data Loading & Queue Manager
     ───────────────────────────────────────────────────────── */
  async loadCampaignData(campaignInput = null) {
    try {
      let ids = [];
      if (Array.isArray(campaignInput)) {
        ids = campaignInput.map(Number).filter(n => n > 0);
      } else if (typeof campaignInput === 'string' && campaignInput.includes(',')) {
        ids = campaignInput.split(',').map(Number).filter(n => n > 0);
      } else if (campaignInput !== null && campaignInput !== undefined) {
        ids = [Number(campaignInput)];
      } else if (this.selectedCampaignIds && this.selectedCampaignIds.length > 0) {
        ids = this.selectedCampaignIds.map(Number).filter(n => n > 0);
      } else if (this.activeCampaignId) {
        ids = [Number(this.activeCampaignId)];
      } else if (this.campaign?.id) {
        ids = [Number(this.campaign.id)];
      } else {
        ids = [];
      }

      this.selectedCampaignIds = ids;
      if (ids.length === 1) {
        this.activeCampaignId = ids[0];
      }

      const q = ids.length > 0 ? `campaign_ids=${encodeURIComponent(ids.join(','))}` : '';
      const res = await fetch(`api.php?action=get_campaign_data${q ? '&' + q : ''}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');

      this.campaign = data.campaign;
      if (this.campaign && this.campaign.ivr_responses) {
        try {
          this.ivrResponses = typeof this.campaign.ivr_responses === 'string'
            ? JSON.parse(this.campaign.ivr_responses)
            : this.campaign.ivr_responses;
        } catch(e) {
          this.ivrResponses = null;
        }
      }
      this.syncServerClock(data);
      this.selectedCampaigns = data.selected_campaigns || (data.campaign ? [data.campaign] : []);
      const activeByLeadId = new Map();
      if (this.activeChannels && this.activeChannels.size > 0) {
        this.activeChannels.forEach(ch => {
          if (ch.lead && ch.lead.id) activeByLeadId.set(Number(ch.lead.id), ch);
        });
      }
      this.leads = (data.leads || []).map(l => {
        const activeCh = activeByLeadId.get(Number(l.id));
        if (activeCh && l.status === 'pending') {
          return { ...l, status: 'calling' };
        }
        return l;
      });
      this.stats = data.stats || {};
      this.audioRecordings = data.audio_recordings || [];
      this.recentLogs = data.recent_logs || [];
      this.serverToday = data.server_today || this.getLocalDateString();
      this.availableDates = data.available_dates || [];
      this.remainingCount = data.remaining_count || 0;

      if (data.telephony_metrics) {
        this.updateTelephonyKpiCards(data.telephony_metrics);
      } else {
        this.updateTelephonyKpiCards();
      }

      if (this.campaign && !this._dialerTransitionLock) {
        if (this.campaign.status === 'running') {
          this.isRunning = true;
          this.isPaused = false;
          if (!this.schedulerInterval) {
            this.startSchedulerLoop();
          }
        } else if (this.campaign.status === 'paused') {
          this.isRunning = true;
          this.isPaused = true;
          this.stopSchedulerLoop();
        } else if (!this.activeChannels || this.activeChannels.size === 0) {
          this.isRunning = false;
          this.isPaused = false;
          this.stopSchedulerLoop();
        }
      }
      this.syncDialerControlButtons();

      this.renderCampaignHeader();
      this.renderDialerCampaignSelector();
      this.renderStats();
      this.renderLeadsTables();
      this.renderAgentScreen();
      this.renderPacingAndComplianceSettings();
      this.renderActiveChannels();
      this.renderUnansweredTable();
      this.renderLogsTable(this.recentLogs);
      this.renderHistoryTable();
      this.populateAudioDropdown();
      this.updateRolloverBanners();

      // Phase 1 updates
      this.loadCampaignsOverview();
      this.updateDesignerUI();

      // Phase 3 & 4 updates
      this.loadCallbacksList();
      this.loadDncList();
    } catch (err) {
      console.error(err);
      this.showToast('Could not load campaign data', 'error');
    }
  }

  renderDialerCampaignSelector() {
    const sel = document.getElementById('dialerCampaignDropdown');
    const badge = document.getElementById('dialerSelectedCampaignsBadge');
    const queueBadge = document.getElementById('dialerQueueCountBadge');
    const cbList = document.getElementById('multiCampaignCheckboxesList');

    const campaigns = this.allCampaigns || this.selectedCampaigns || [];
    const selectedIds = (this.selectedCampaignIds || [1]).map(Number);
    const isMulti = selectedIds.length > 1;

    // Update Dropdown
    if (sel && campaigns.length > 0) {
      let optionsHtml = '';
      if (isMulti) {
        optionsHtml += `<option value="multi" selected>Multiple Campaigns (${selectedIds.length} Selected)</option>`;
      }
      campaigns.forEach(c => {
        const isSelected = !isMulti && selectedIds.includes(Number(c.id));
        const count = c.total_leads_count || c.total_leads || 0;
        optionsHtml += `<option value="${c.id}" ${isSelected ? 'selected' : ''}>${this.escapeHtml(c.name)} &middot; ${count} lead${count === 1 ? '' : 's'}</option>`;
      });
      optionsHtml += `<option value="all">Select All Campaigns Combined</option>`;
      sel.innerHTML = optionsHtml;
    }

    // Update Checkboxes Drawer
    if (cbList && campaigns.length > 0) {
      cbList.innerHTML = campaigns.map(c => {
        const checked = selectedIds.includes(Number(c.id));
        const count = c.total_leads_count || c.total_leads || 0;
        return `
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:${checked ? '#eefbf2' : '#ffffff'};border:1.5px solid ${checked ? '#00A651' : '#e2e8f0'};border-radius:8px;cursor:pointer;transition:all 0.15s ease;">
            <input type="checkbox" value="${c.id}" ${checked ? 'checked' : ''} onchange="app.handleCampaignCheckboxToggle(${c.id}, this.checked)" style="width:17px;height:17px;accent-color:#00A651;cursor:pointer;">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:12.5px;color:#143522;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.escapeHtml(c.name)}</div>
              <div style="font-size:11px;color:#526e5f;">${count} contacts &bull; Caller ID: ${this.escapeHtml(c.caller_id_number || 'Default')}</div>
            </div>
          </label>
        `;
      }).join('');
    }

    // Update Badges & Status Pill
    const pendingCount = (this.leads || []).filter(l => l.status === 'pending').length;
    const agentQueueStatus = document.getElementById('agentQueueStatusText');
    if (agentQueueStatus) {
      const stateLabel = this.isRunning ? (this.isPaused ? 'Paused' : 'Active') : 'Ready';
      agentQueueStatus.innerHTML = `${stateLabel} &middot; ${pendingCount} lead${pendingCount === 1 ? '' : 's'} in queue`;
    }

    if (badge) {
      if (isMulti) {
        badge.textContent = `${selectedIds.length} Campaigns Active`;
        badge.className = 'sc-badge running';
      } else {
        const singleCamp = campaigns.find(c => Number(c.id) === selectedIds[0]);
        badge.textContent = singleCamp ? singleCamp.name : (this.campaign?.name || 'Campaign Active');
        badge.className = 'sc-badge running';
      }
    }

    if (queueBadge) {
      queueBadge.textContent = `${pendingCount} Leads in Queue`;
      queueBadge.style.background = pendingCount > 0 ? '#00A651' : '#64748b';
    }
  }

  handleDialerCampaignDropdownChange(val) {
    if (val === 'multi') {
      this.toggleMultiCampaignPanel(true);
      return;
    }
    if (val === 'all') {
      const allIds = (this.allCampaigns || []).map(c => Number(c.id));
      if (allIds.length > 0) {
        this.selectedCampaignIds = allIds;
        this.loadCampaignData(allIds);
        this.showToast(`Selected all ${allIds.length} campaigns for outbound dialing!`, 'success');
      }
      return;
    }

    const campId = Number(val);
    if (!campId) return;
    this.activeLead = null;
    this.selectedCampaignIds = [campId];
    this.activeCampaignId = campId;
    this.loadCampaignData([campId]);
    const camp = (this.allCampaigns || []).find(c => Number(c.id) === campId);
    this.showToast(`Active dialing campaign set to: ${camp?.name || 'Campaign #' + campId}`, 'success');
  }

  toggleMultiCampaignPanel(forceOpen = null) {
    const wrap = document.getElementById('multiCampaignSelectorWrap');
    if (!wrap) return;
    const isCurrentlyOpen = wrap.style.display !== 'none';
    const shouldOpen = (forceOpen !== null) ? forceOpen : !isCurrentlyOpen;
    wrap.style.display = shouldOpen ? 'block' : 'none';

    const btn = document.getElementById('btnToggleMultiCampaign');
    if (btn) {
      btn.className = shouldOpen ? 'sc-pill-btn active' : 'sc-pill-btn secondary';
    }
  }

  handleCampaignCheckboxToggle(campaignId, isChecked) {
    const id = Number(campaignId);
    if (isChecked) {
      if (!this.selectedCampaignIds.includes(id)) {
        this.selectedCampaignIds.push(id);
      }
    } else {
      if (this.selectedCampaignIds.length > 1) {
        this.selectedCampaignIds = this.selectedCampaignIds.filter(x => x !== id);
      } else {
        this.showToast('At least one campaign must remain selected.', 'error');
        this.renderDialerCampaignSelector();
        return;
      }
    }
    this.renderDialerCampaignSelector();
  }

  selectAllCampaignsForDialer(select) {
    if (select) {
      this.selectedCampaignIds = (this.allCampaigns || []).map(c => Number(c.id));
    } else {
      this.selectedCampaignIds = [Number(this.allCampaigns?.[0]?.id || 1)];
    }
    this.renderDialerCampaignSelector();
  }

  /* ─────────────────────────────────────────────────────────
     Live Telephony Metrics & KPI Cards (Agent & Campaigns)
     ───────────────────────────────────────────────────────── */
  updateTelephonyKpiCards(metrics = null) {
    if (metrics) {
      this.telephonyMetrics = metrics;
    } else if (!this.telephonyMetrics) {
      this.telephonyMetrics = {
        active_calls: 0,
        available_lines: 2,
        answered_rate: 0.0,
        answered_rate_formatted: '0.0%',
        avg_duration_sec: 0,
        avg_duration_formatted: '00:00'
      };
    }

    const m = this.telephonyMetrics;
    const activeCalls = m.active_calls !== undefined ? m.active_calls : (m.dialing_now || 0);
    const availLines = m.available_lines !== undefined ? m.available_lines : 2;
    const answeredRate = m.answered_rate_formatted || (typeof m.answered_rate === 'number' ? m.answered_rate.toFixed(1) + '%' : '0.0%');
    const avgDuration = m.avg_duration_formatted || m.avg_talk_time_formatted || '00:00';

    // 1. Update Campaigns Overview Cards (Real Data)
    const elActive = document.getElementById('kpiActiveCalls');
    const elAvail = document.getElementById('kpiAvailableLines');
    const elAnsRate = document.getElementById('kpiAnsweredRate');
    const elAvgDur = document.getElementById('kpiAvgDuration');

    if (elActive) elActive.textContent = activeCalls;
    if (elAvail) elAvail.textContent = availLines;
    if (elAnsRate) elAnsRate.textContent = answeredRate;
    if (elAvgDur) elAvgDur.textContent = avgDuration;

    // 2. Update Dialer Tab Agent Cards (if present)
    const elAgentReady = document.getElementById('agentKpiAgentsReady');
    const elAgentDialing = document.getElementById('agentKpiDialingNow');
    const elAgentAbandon = document.getElementById('agentKpiAbandonRate');
    const elAgentAvgTalk = document.getElementById('agentKpiAvgTalkTime');

    if (elAgentReady) elAgentReady.textContent = (m.agents_ready !== undefined ? m.agents_ready : 1);
    if (elAgentDialing) elAgentDialing.textContent = activeCalls;
    if (elAgentAbandon) elAgentAbandon.textContent = (m.abandon_rate !== undefined ? m.abandon_rate : '0%');
    if (elAgentAvgTalk) elAgentAvgTalk.textContent = avgDuration;

    // 3. Update Pacing & Compliance Metrics Cards
    const elPacingReady = document.getElementById('pacingAgentsReady');
    const elPacingDialing = document.getElementById('pacingDialingNow');
    const elPacingAbandon = document.getElementById('pacingAbandonRate');
    const elPacingAvgTalk = document.getElementById('pacingAvgTalk');

    if (elPacingReady) elPacingReady.textContent = (m.agents_ready !== undefined ? m.agents_ready : 1);
    if (elPacingDialing) elPacingDialing.textContent = activeCalls;
    if (elPacingAbandon) elPacingAbandon.textContent = (m.abandon_rate !== undefined ? m.abandon_rate : '0.0%');
    if (elPacingAvgTalk) elPacingAvgTalk.textContent = avgDuration;

    this.checkAbandonCompliance();
  }

  startTelephonyMetricsHeartbeat() {
    if (this._telephonyHeartbeatTimer) {
      clearInterval(this._telephonyHeartbeatTimer);
    }
    const sendHeartbeat = async () => {
      try {
        const campId = this.activeCampaignId || this.campaign?.id || null;
        const currentStatus = (this.activeChannels && this.activeChannels.size > 0) ? 'on_call' : 'ready';
        const formData = new FormData();
        formData.append('status', currentStatus);
        if (campId) formData.append('campaign_id', campId);

        const res = await fetch('api.php?action=agent_heartbeat', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data && data.success && data.metrics) {
          this._lastTelephonyMetrics = data.metrics;
          if (this.campaignViewMode !== 'sms') {
            this.updateTelephonyKpiCards(data.metrics);
          }
        }
        this.checkAndDispatchDueSms();
      } catch (err) {
        // silent heartbeat catch
      }
    };

    // Initial heartbeat after 800ms
    setTimeout(sendHeartbeat, 800);

    // Recurring heartbeat every 5 seconds to keep metrics completely live
    this._telephonyHeartbeatTimer = setInterval(sendHeartbeat, 5000);
  }

  applyMultiCampaignSelection() {
    if (!this.selectedCampaignIds || this.selectedCampaignIds.length === 0) {
      this.selectedCampaignIds = [1];
    }
    this.loadCampaignData(this.selectedCampaignIds);
    this.showToast(`Loaded ${this.selectedCampaignIds.length} campaigns into outbound dialing queue!`, 'success');
  }

  async loadCampaignsOverview() {
    try {
      const res = await fetch('api.php?action=get_all_campaigns');
      const data = await res.json();
      if (!data.success) return;
      this.allCampaigns = data.campaigns || [];
      if (data.telephony_metrics) {
        this._lastTelephonyMetrics = data.telephony_metrics;
        if (this.campaignViewMode !== 'sms') {
          this.updateTelephonyKpiCards(data.telephony_metrics);
        }
      }
      if (this.campaignViewMode === 'sms') {
        this.updateSmsKpiCards();
      }
      this.filterCampaignsTable();
      this.populateCampaignSelectDropdowns();
      this.renderDialerCampaignSelector();
    } catch (e) {
      console.warn('loadCampaignsOverview error:', e);
    }
  }

  /* ─────────────────────────────────────────────────────────
     Campaign Table Filtering & Search
     ───────────────────────────────────────────────────────── */
  filterCampaignsTable() {
    const searchVal = (document.getElementById('campaignSearchInput')?.value || '').toLowerCase().trim();
    const statusVal = (document.getElementById('campaignStatusFilter')?.value || '').toLowerCase();
    const typeVal   = (document.getElementById('campaignTypeFilter')?.value || '').toLowerCase();

    const isSmsPage = (this.campaignViewMode === 'sms');

    const filtered = (this.allCampaigns || []).filter(c => {
      const isSms = (c.type === 'sms_only');

      // On dedicated SMS page, ONLY show campaigns where type is sms_only
      if (isSmsPage && !isSms) return false;
      // On main Campaigns page, show ALL campaigns (Voice + SMS included)

      // Search: match name, caller ID, sender ID, or type
      if (searchVal) {
        const haystack = [c.name, c.caller_id_number, c.caller_id_name, c.sms_sender_id, c.type].join(' ').toLowerCase();
        if (!haystack.includes(searchVal)) return false;
      }

      // Status filter
      if (statusVal) {
        const st = (c.status || '').toLowerCase();
        const isRunning = (st === 'running' || st === 'active');
        const matchedStatus =
          (statusVal === 'running'   && isRunning) ||
          (statusVal === 'idle'      && !isRunning && st !== 'completed' && st !== 'paused') ||
          (statusVal === 'completed' && st === 'completed') ||
          (statusVal === 'paused'    && st === 'paused');
        if (!matchedStatus) return false;
      }

      // Type / Channel filter: match the stored type value
      if (typeVal && typeVal !== 'all') {
        const ct = (c.type || '').toLowerCase();
        if (ct !== typeVal) return false;
      }

      return true;
    });

    this.renderCampaignsTable(filtered);
  }

  clearCampaignFilters() {
    const searchInput  = document.getElementById('campaignSearchInput');
    const statusFilter = document.getElementById('campaignStatusFilter');
    const typeFilter   = document.getElementById('campaignTypeFilter');
    if (searchInput)  searchInput.value  = '';
    if (statusFilter) statusFilter.value = '';
    if (typeFilter)   typeFilter.value   = '';
    this.filterCampaignsTable();
  }

  renderCampaignsTable(campaigns) {
    const tbody = document.getElementById('campaignsOverviewTableBody');
    const badge = document.getElementById('campaignsCountBadge');
    if (!tbody) return;

    const LIMIT = 5;
    const isSmsPage = (this.campaignViewMode === 'sms');
    const totalAll = (this.allCampaigns || []).filter(c => isSmsPage ? (c.type === 'sms_only') : true).length;
    const shownFiltered = (campaigns || []).length;

    if (badge) {
      badge.textContent = totalAll === shownFiltered ? totalAll : `${shownFiltered} of ${totalAll}`;
    }

    if (!campaigns || campaigns.length === 0) {
      if (totalAll === 0) {
        if (isSmsPage) {
          tbody.innerHTML = `
            <tr class="camp-table-row">
              <td colspan="5" style="padding:40px 20px;text-align:center;">
                <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">No SMS campaigns yet</div>
                <div style="font-size:13px;color:#64748b;margin-bottom:16px;">Create your first automated SMS messaging campaign to start dispatching.</div>
                <button type="button" class="btn btn-primary" onclick="document.getElementById('newCampaignNameInput')?.focus(); document.getElementById('newCampaignNameInput')?.scrollIntoView({behavior:'smooth'});">Create SMS campaign</button>
              </td>
            </tr>
          `;
        } else {
          tbody.innerHTML = `
            <tr class="camp-table-row">
              <td colspan="5" style="padding:40px 20px;text-align:center;">
                <div style="font-size:15px;font-weight:700;color:#0f172a;margin-bottom:6px;">No campaigns yet</div>
                <div style="font-size:13px;color:#64748b;margin-bottom:16px;">Create your first automated outbound campaign to start dialing.</div>
                <button type="button" class="btn btn-primary" onclick="document.getElementById('newCampaignNameInput')?.focus(); document.getElementById('newCampaignNameInput')?.scrollIntoView({behavior:'smooth'});">Create campaign</button>
              </td>
            </tr>
          `;
        }
      } else {
        const noMatch = isSmsPage ? 'No SMS campaigns match your search or filters.' : 'No campaigns match your search or filters.';
        tbody.innerHTML = `<tr class="camp-table-row"><td colspan="5" style="padding:28px;text-align:center;color:#64748b;font-size:13px;">${noMatch}</td></tr>`;
      }
      return;
    }

    // Determine which set to show based on expand state
    const isExpanded = this._campaignsTableExpanded === true;
    const visibleCampaigns = isExpanded ? campaigns : campaigns.slice(0, LIMIT);
    const hiddenCount = campaigns.length - LIMIT;

    const buildRow = (c) => {
      const totalLeads = parseInt(c.total_leads > 0 ? c.total_leads : (c.total_leads_count || 0), 10);
      const comp = parseInt(c.completed_leads > 0 ? c.completed_leads : (c.completed_leads_count || 0), 10);
      const pct = totalLeads > 0 ? Math.min(100, Math.round((comp / totalLeads) * 100)) : 0;

      const isRunning = (c.status === 'running' || c.status === 'active');
      const statusClass = isRunning ? 'running' : (c.status === 'completed' ? 'completed' : (c.status === 'paused' ? 'paused' : 'idle'));
      const statusLabel = isRunning ? 'Running' : (c.status === 'completed' ? 'Completed' : (c.status === 'paused' ? 'Paused' : 'Idle'));
      const dotClass    = isRunning ? 'green'   : (c.status === 'completed' ? 'gray'      : (c.status === 'paused' ? 'yellow'  : 'blue'));

      let progressText = `${pct}%`;
      if (totalLeads > 0 && comp < totalLeads) {
        progressText = `${pct}% · ${comp} of ${totalLeads}`;
      } else if (totalLeads === 0) {
        progressText = `0% · 0 of 0`;
      }

      let typeDisplay = 'Automated IVR';
      if (c.type === 'sms_only') {
        typeDisplay = 'SMS Only';
      } else if (c.type === 'broadcast') {
        typeDisplay = 'Play & Hang Up';
      }

      const callerId = c.caller_id_number || 'Default';
      const isSmsOnly = (c.type === 'sms_only');
      const subInfo = isSmsOnly
        ? `Sender ID: ${this.escapeHtml(c.sms_sender_id || 'SkyConnect')}`
        : `Caller ID ${this.escapeHtml(callerId)}`;

      return `
        <tr class="camp-table-row" style="cursor:pointer;" onclick="${isSmsOnly ? `app.showSmsCampaignsView(${c.id})` : `selectCampaignForDesigner(${c.id})`}">
          <td style="padding:14px 12px;vertical-align:middle;">
            <div style="font-weight:700;color:#0f172a;font-size:13.5px;line-height:1.3;cursor:pointer;" onclick="${isSmsOnly ? `app.showSmsCampaignsView(${c.id})` : `selectCampaignForDesigner(${c.id})`}">${this.escapeHtml(c.name)}</div>
            <div style="font-size:11.5px;color:#64748b;margin-top:2px;">${subInfo}</div>
          </td>
          <td style="padding:14px 12px;vertical-align:middle;color:#334155;font-size:13px;font-weight:500;">
            <div style="display:flex;align-items:center;gap:6px;">
              <span>${typeDisplay}</span>
              ${isSmsOnly ? '<span style="background:#e0f2fe;color:#0284c7;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid #bae6fd;">SMS</span>' : (Number(c.sms_enabled) === 1 ? '<span style="background:#e0f2fe;color:#0284c7;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;border:1px solid #bae6fd;" title="SMS Follow-up Active">SMS</span>' : '')}
            </div>
            <div style="font-size:11px;color:${c.calling_method === 'auto_schedule' ? '#15803d' : '#64748b'};font-weight:600;margin-top:2px;">
              ${isSmsOnly ? 'Direct text dispatch' : (c.calling_method === 'auto_schedule' ? `Auto (${c.schedule_interval_mins || 5}m)` : 'Manual')}
            </div>
          </td>
          <td style="padding:14px 12px;vertical-align:middle;">
            <span class="camp-status-badge ${statusClass}">
              <span class="camp-dot ${dotClass}"></span>
              ${statusLabel}
            </span>
          </td>
          <td style="padding:14px 12px;vertical-align:middle;min-width:130px;">
            <div style="font-size:11px;color:#64748b;font-weight:600;margin-bottom:5px;">
              ${progressText}
            </div>
            <div class="camp-progress-track">
              <div class="camp-progress-fill" style="width:${pct}%;"></div>
            </div>
          </td>
          <td style="padding:14px 12px;vertical-align:middle;text-align:right;white-space:nowrap;" onclick="event.stopPropagation()">
            ${isSmsOnly
              ? `<button type="button" class="btn btn-sm btn-success" style="padding:4px 10px;font-size:12px;font-weight:700;margin-right:4px;background:#00A651;border:none;" onclick="app.showSmsCampaignsView(${c.id})" title="Open SMS Campaign Messenger">Send SMS</button>`
              : `<button type="button" class="btn btn-sm btn-success" style="padding:4px 10px;font-size:12px;font-weight:700;margin-right:4px;" onclick="app.openCampaignInQueue(${c.id})" title="Launch Outbound Dialer for this Campaign">Dial</button>`
            }
            <button type="button" class="camp-btn-design" onclick="${isSmsOnly ? `app.showSmsCampaignsView(${c.id})` : `selectCampaignForDesigner(${c.id})`}" title="Configure Campaign">${isSmsOnly ? 'Open' : 'Design'}</button>
            <button type="button" class="camp-btn-more" onclick="app.openCampaignActionMenu(${c.id}, event)" title="More options">More</button>
          </td>
        </tr>
      `;
    };

    let html = visibleCampaigns.map(buildRow).join('');

    // Show more / Show less row
    if (campaigns.length > LIMIT) {
      if (!isExpanded) {
        html += `
          <tr>
            <td colspan="5" style="padding:10px 12px;text-align:center;border-top:1px solid #f1f5f9;">
              <button type="button" onclick="app.toggleCampaignsExpand(true)"
                style="background:none;border:1.5px solid #e2e8f0;border-radius:8px;padding:7px 20px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;transition:all 0.15s;"
                onmouseover="this.style.borderColor='#00A651';this.style.color='#00A651';"
                onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#475569';">
                Show ${hiddenCount} more campaign${hiddenCount === 1 ? '' : 's'}
              </button>
            </td>
          </tr>
        `;
      } else {
        html += `
          <tr>
            <td colspan="5" style="padding:10px 12px;text-align:center;border-top:1px solid #f1f5f9;">
              <button type="button" onclick="app.toggleCampaignsExpand(false)"
                style="background:none;border:1.5px solid #e2e8f0;border-radius:8px;padding:7px 20px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;transition:all 0.15s;"
                onmouseover="this.style.borderColor='#00A651';this.style.color='#00A651';"
                onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#475569';">
                Show less
              </button>
            </td>
          </tr>
        `;
      }
    }

    tbody.innerHTML = html;
  }

  toggleCampaignsExpand(expand) {
    this._campaignsTableExpanded = expand;
    this.filterCampaignsTable();
  }

  setWizardStep(step) {
    for (let i = 1; i <= 4; i++) {
      const stepItem = document.getElementById(`wizardStep${i}`);
      if (stepItem) {
        const circle = stepItem.querySelector('.camp-step-circle');
        const title = stepItem.querySelector('.camp-step-title');
        if (i === step) {
          stepItem.classList.add('active');
          if (circle) circle.classList.add('active');
          if (title) title.classList.add('active');
        } else {
          stepItem.classList.remove('active');
          if (circle) circle.classList.remove('active');
          if (title) title.classList.remove('active');
        }
      }
    }
    if (step === 2) {
      switchCampaignSubView('designer');
    } else if (step === 1) {
      switchCampaignSubView('list');
    }
  }

  handleCallingMethodChange(val) {
    const opts = document.getElementById('newCampaignAutoScheduleOptions');
    if (opts) {
      opts.style.display = (val === 'auto_schedule') ? 'block' : 'none';
    }
  }

  handleScheduleStrategyChange(val) {
    const rowInt = document.getElementById('rowScheduleInterval');
    const rowWin = document.getElementById('rowScheduleWindow');
    const smartOffer = document.getElementById('newCampSmartOffer');

    if (rowInt) rowInt.style.display = (val === 'interval') ? 'block' : 'none';
    if (rowWin) rowWin.style.display = (val === 'window') ? 'block' : 'none';
    if (smartOffer) {
      if (val === 'smart' && this.pendingCampaignFile) {
        smartOffer.style.display = 'block';
      } else {
        smartOffer.style.display = 'none';
      }
    }
  }

  approveSmartScheduleSuggestion() {
    this.smartScheduleApproved = true;
    const actions = document.getElementById('smartOfferActions');
    if (actions) actions.style.display = 'none';

    const approved = document.getElementById('smartOfferApproved');
    if (approved) approved.style.display = 'flex';

    this.showToast('Time-saving schedule approved: Contacts will be dispatched concurrently.', 'success');
  }

  rejectSmartScheduleSuggestion() {
    this.smartScheduleApproved = false;
    const stratSel = document.getElementById('newCampaignScheduleStrategy');
    if (stratSel) stratSel.value = 'interval';
    this.handleScheduleStrategyChange('interval');

    const offerEl = document.getElementById('newCampSmartOffer');
    if (offerEl) offerEl.style.display = 'none';

    this.showToast('Switched to standard interval scheduling.', 'info');
  }

  handleDesignerCallingMethodChange(val) {
    const rowInt = document.getElementById('designerRowInterval');
    const rowWin = document.getElementById('designerRowWindow');
    const strat = document.getElementById('designerScheduleStrategy')?.value || 'smart';
    if (val === 'manual') {
      if (rowInt) rowInt.style.display = 'none';
      if (rowWin) rowWin.style.display = 'none';
    } else {
      this.handleDesignerScheduleStrategyChange(strat);
    }
  }

  handleDesignerScheduleStrategyChange(val) {
    const rowInt = document.getElementById('designerRowInterval');
    const rowWin = document.getElementById('designerRowWindow');
    if (rowInt) rowInt.style.display = (val === 'interval') ? 'block' : 'none';
    if (rowWin) rowWin.style.display = (val === 'window') ? 'block' : 'none';
  }

  handleUploadStrategyChange(val) {
    const colInt = document.getElementById('uploadColInterval');
    const colWin = document.getElementById('uploadColWindow');
    const helpWin = document.getElementById('uploadWindowHelpText');

    if (colInt) colInt.style.display = (val === 'interval') ? 'block' : 'none';
    if (colWin) colWin.style.display = (val === 'window') ? 'block' : 'none';
    if (helpWin) helpWin.style.display = (val === 'window') ? 'block' : 'none';
  }

  handleManualStrategyChange(val) {
    const colInt = document.getElementById('manualColInterval');
    const colWin = document.getElementById('manualColWindow');
    const helpWin = document.getElementById('manualWindowHelpText');

    if (colInt) colInt.style.display = (val === 'interval') ? 'block' : 'none';
    if (colWin) colWin.style.display = (val === 'window') ? 'block' : 'none';
    if (helpWin) helpWin.style.display = (val === 'window') ? 'block' : 'none';
  }

  selectCampaignMode(mode) {
    const hiddenInp = document.getElementById('newCampaignModeSelect');
    if (hiddenInp) hiddenInp.value = mode;

    const cardIvr = document.getElementById('campModeCard_ivr');
    const cardBroadcast = document.getElementById('campModeCard_broadcast');
    const cardSms = document.getElementById('campModeCard_sms');
    const radIvr = document.getElementById('radioModeIvr');
    const radBroadcast = document.getElementById('radioModeBroadcast');
    const radSms = document.getElementById('radioModeSms');

    const voiceSec = document.getElementById('newCampVoiceSection');
    const smsSec = document.getElementById('newCampSmsOnlySection');
    const submitBtn = document.getElementById('btnNewCampaignSubmit');

    const resetCard = (card, radio, active) => {
      if (!card) return;
      if (active) {
        card.style.borderColor = '#00A651';
        card.style.borderWidth = '2px';
        card.style.background = '#f0fdf4';
        if (radio) radio.checked = true;
      } else {
        card.style.borderColor = '#cbd5e1';
        card.style.borderWidth = '1.5px';
        card.style.background = '#ffffff';
        if (radio) radio.checked = false;
      }
    };

    resetCard(cardIvr, radIvr, mode === 'automated_ivr');
    resetCard(cardBroadcast, radBroadcast, mode === 'broadcast');
    resetCard(cardSms, radSms, mode === 'sms_only');

    if (mode === 'sms_only') {
      if (voiceSec) voiceSec.style.display = 'none';
      if (smsSec) smsSec.style.display = 'block';
      if (submitBtn) submitBtn.textContent = 'Continue to SMS campaign designer';
      this.updateWizardSmsOnlyPreview();
    } else {
      if (voiceSec) voiceSec.style.display = 'block';
      if (smsSec) smsSec.style.display = 'none';
      if (submitBtn) submitBtn.textContent = 'Continue to message design';
    }
  }

  updateWizardSmsOnlyPreview() {
    const bubble = document.getElementById('newCampSmsOnlyPreviewBubble');
    const txtEl = document.getElementById('newCampSmsOnlyTemplate');
    const campName = document.getElementById('newCampaignNameInput')?.value.trim() || 'Appointment Reminder';
    if (!bubble) return;
    const tpl = txtEl?.value.trim() || 'Hello {name}, this is an important message regarding {campaign}. Please contact us if you have any questions.';
    bubble.textContent = this.renderSmsTemplate(tpl, {
      name: 'Abebe Bikila',
      campaign: campName,
      phone: '+251911223344'
    });
  }

  handleNewCampaignSmsFileSelect(input) {
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    const campInp = document.getElementById('newCampaignSmsContactsInput');
    const notice = document.getElementById('newCampSmsFileNotice');
    if (campInp) campInp.value = file.name;
    this.pendingCampaignFile = file;

    const strat = document.getElementById('newCampSmsScheduleStrategy')?.value || 'smart';
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result || '';
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const contactCount = Math.max(1, lines.length > 1 ? lines.length - 1 : lines.length);
        if (notice) {
          notice.style.display = 'block';
          notice.textContent = `Selected: ${file.name} (${contactCount} contacts detected).`;
        }
        if (strat === 'smart') {
          this.renderSmartSmsScheduleOffer(file.name, contactCount);
        }
      };
      reader.readAsText(file);
    } else {
      const estimatedCount = Math.max(10, Math.min(250, Math.round(file.size / 140)));
      if (notice) {
        notice.style.display = 'block';
        notice.textContent = `Selected: ${file.name} (~${estimatedCount} contacts estimated).`;
      }
      if (strat === 'smart') {
        this.renderSmartSmsScheduleOffer(file.name, estimatedCount);
      }
    }
  }

  renderSmartSmsScheduleOffer(fileName, count) {
    const offerEl = document.getElementById('newCampSmsSmartOffer');
    if (!offerEl) return;

    const intv = 2;
    const totalMinutes = Math.max(2, Math.ceil(count * intv));
    const totalH = Math.floor(totalMinutes / 60);
    const totalM = totalMinutes % 60;
    const timeText = totalH > 0 ? `~${totalH}h ${totalM}m` : `~${totalM}m`;

    const badge = document.getElementById('smartSmsOfferBadge');
    if (badge) badge.textContent = `${count} contacts`;

    const summary = document.getElementById('smartSmsOfferSummary');
    if (summary) {
      summary.innerHTML = `System will stagger ${count} contacts smoothly across an optimal timetable (staggered every ${intv} minutes over ${timeText}) to maximize deliverability and avoid carrier rate throttling.`;
    }

    const actions = document.getElementById('smartSmsOfferActions');
    if (actions) actions.style.display = 'flex';
    const approved = document.getElementById('smartSmsOfferApproved');
    if (approved) approved.style.display = 'none';

    offerEl.style.display = 'block';
    this.smartSmsScheduleApproved = true;
  }

  approveSmartSmsScheduleSuggestion() {
    this.smartSmsScheduleApproved = true;
    const strat = document.getElementById('newCampSmsScheduleStrategy');
    if (strat) strat.value = 'smart';
    const actions = document.getElementById('smartSmsOfferActions');
    if (actions) actions.style.display = 'none';
    const approved = document.getElementById('smartSmsOfferApproved');
    if (approved) approved.style.display = 'block';
    this.showToast('Smart SMS schedule approved!', 'success');
  }

  rejectSmartSmsScheduleSuggestion() {
    this.smartSmsScheduleApproved = false;
    const strat = document.getElementById('newCampSmsScheduleStrategy');
    if (strat) strat.value = 'interval';
    this.handleSmsScheduleStrategyChange('interval');
    const offerEl = document.getElementById('newCampSmsSmartOffer');
    if (offerEl) offerEl.style.display = 'none';
    this.showToast('Switched to standard interval staggering', 'info');
  }

  handleSmsSchedulingMethodChange(val) {
    const optBox = document.getElementById('newCampSmsAutoScheduleOptions');
    if (optBox) {
      optBox.style.display = (val === 'auto_schedule') ? 'block' : 'none';
    }
  }

  handleSmsScheduleStrategyChange(val) {
    const rowIntv = document.getElementById('rowSmsScheduleInterval');
    const rowWin = document.getElementById('rowSmsScheduleWindow');
    if (rowIntv) rowIntv.style.display = (val === 'interval' || val === 'smart') ? 'block' : 'none';
    if (rowWin) rowWin.style.display = (val === 'window') ? 'block' : 'none';
  }

  handleSmsDesignerMethodChange(val) {
    const badge = document.getElementById('smsDesignerScheduleStatusBadge');
    if (badge) {
      badge.textContent = (val === 'auto_schedule') ? 'Active (Auto)' : 'Manual';
      badge.style.background = (val === 'auto_schedule') ? '#dcfce7' : '#f1f5f9';
      badge.style.color = (val === 'auto_schedule') ? '#166534' : '#475569';
    }
  }

  handleSmsDesignerStrategyChange(val) {
    const rowIntv = document.getElementById('smsDesignerIntervalRow');
    const rowWin = document.getElementById('smsDesignerWindowRow');
    if (rowIntv) rowIntv.style.display = (val === 'interval' || val === 'smart') ? 'block' : 'none';
    if (rowWin) rowWin.style.display = (val === 'window') ? 'block' : 'none';
  }

  async handleNewCampaignWizardSubmit(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('newCampaignNameInput')?.value.trim();
    const type = document.getElementById('newCampaignTypeSelect')?.value || 'appointment_reminder';
    const mode = document.getElementById('newCampaignModeSelect')?.value || 'automated_ivr';
    const callerIdSelect = document.getElementById('newCampaignCallerIdSelect');
    const callerId = callerIdSelect?.value || '';
    const callerIdName = callerIdSelect?.selectedOptions?.[0]?.dataset?.name || 'SkyConnect';
    const lang = document.getElementById('newCampaignLanguageSelect')?.value || 'en';

    let callingMethod = 'auto_schedule';
    let scheduleStrategy = 'interval';
    let scheduleInterval = '5';
    let windowStart = '09:00';
    let windowEnd = '17:00';

    let smsEnabled = 0;
    let smsTrigger = 'call_completed';
    let smsTemplate = '';
    let smsSenderId = 'SkyConnect';

    if (mode === 'sms_only') {
      callingMethod = document.getElementById('newCampSmsSchedulingMethodSelect')?.value || 'auto_schedule';
      scheduleStrategy = document.getElementById('newCampSmsScheduleStrategy')?.value || (this.smartSmsScheduleApproved ? 'smart' : 'interval');
      scheduleInterval = document.getElementById('newCampSmsScheduleInterval')?.value || '5';
      windowStart = document.getElementById('newCampSmsWindowStart')?.value || '09:00';
      windowEnd = document.getElementById('newCampSmsWindowEnd')?.value || '17:00';

      smsEnabled = 1;
      smsTrigger = 'sms_blast';
      smsTemplate = document.getElementById('newCampSmsOnlyTemplate')?.value.trim() || 'Hello {name}, this is an important message regarding {campaign}.';
      smsSenderId = document.getElementById('newCampSmsOnlySenderId')?.value.trim() || 'SkyConnect';
    } else {
      callingMethod = document.getElementById('newCampaignCallingMethodSelect')?.value || 'auto_schedule';
      scheduleStrategy = document.getElementById('newCampaignScheduleStrategy')?.value || (this.smartScheduleApproved ? 'smart' : 'interval');
      scheduleInterval = document.getElementById('newCampaignScheduleInterval')?.value || '5';
      windowStart = document.getElementById('newCampaignWindowStart')?.value || '09:00';
      windowEnd = document.getElementById('newCampaignWindowEnd')?.value || '17:00';

      smsEnabled = document.getElementById('newCampaignSmsEnabled')?.checked ? 1 : 0;
      smsTrigger = document.getElementById('newCampaignSmsTrigger')?.value || 'call_completed';
      smsTemplate = document.getElementById('newCampaignSmsTemplate')?.value || '';
      smsSenderId = document.getElementById('newCampaignSmsSenderId')?.value || 'SkyConnect';
    }

    if (!name) {
      this.showToast('Please enter a campaign name', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('type', mode);
    formData.append('caller_id_name', callerIdName);
    formData.append('caller_id_number', callerId);
    formData.append('ivr_language', lang);

    formData.append('calling_method', callingMethod);
    formData.append('schedule_strategy', scheduleStrategy);
    formData.append('schedule_interval_mins', scheduleInterval);
    formData.append('schedule_window_start', windowStart);
    formData.append('schedule_window_end', windowEnd);

    formData.append('sms_enabled', smsEnabled);
    formData.append('sms_trigger', smsTrigger);
    formData.append('sms_template', smsTemplate);
    formData.append('sms_sender_id', smsSenderId);

    try {
      const res = await fetch('api.php?action=create_campaign', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        const newCampId = Number(data.campaign_id);
        this.activeCampaignId = newCampId;
        this.showToast(`Campaign "${name}" created!`, 'success');

        const tabNameEl = document.getElementById('designerTabCampaignName');
        if (tabNameEl) tabNameEl.textContent = name;

        // If an initial contacts file was selected in the wizard, upload it immediately
        if (this.pendingCampaignFile) {
          const upData = new FormData();
          upData.append('lead_file', this.pendingCampaignFile);
          upData.append('campaign_id', newCampId);
          upData.append('auto_schedule', callingMethod === 'auto_schedule' ? '1' : '0');
          upData.append('schedule_strategy', scheduleStrategy);
          upData.append('schedule_interval_mins', scheduleInterval);
          upData.append('schedule_window_start', windowStart);
          upData.append('schedule_window_end', windowEnd);
          upData.append('client_timezone', this.getDialerTimezoneName());
          try {
            const upRes = await fetch('api.php?action=upload_leads', { method: 'POST', body: upData });
            const upJson = await upRes.json();
            if (upJson.success) {
              this.showToast(`Loaded ${upJson.imported || 0} contacts from ${this.pendingCampaignFile.name}`, 'success');
            } else {
              this.showToast(upJson.error || 'Failed to import contacts file', 'error');
            }
          } catch (e) {
            console.warn('Initial contacts upload error:', e);
            this.showToast('Error uploading contacts file', 'error');
          }
          this.pendingCampaignFile = null;
        }

        // Reload campaigns cache so allCampaigns contains new campaign
        await this.loadCampaignsOverview();

        // Navigate directly to the Message Designer for this new campaign
        await this.selectCampaignForDesigner(newCampId);
      } else {
        this.showToast(data.error || 'Failed to create campaign', 'error');
      }
    } catch (err) {
      this.showToast('Network error creating campaign', 'error');
    }
  }

  handleNewCampaignFileSelect(input) {
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    const campInp = document.getElementById('newCampaignContactsInput');
    if (campInp) campInp.value = file.name;
    this.pendingCampaignFile = file;

    const strat = document.getElementById('newCampaignScheduleStrategy')?.value || 'smart';
    if (strat === 'smart') {
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
        const reader = new FileReader();
        reader.onload = (e) => {
          const text = e.target?.result || '';
          const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
          const contactCount = Math.max(1, lines.length > 1 ? lines.length - 1 : lines.length);
          this.renderSmartScheduleOffer(file.name, contactCount);
        };
        reader.readAsText(file);
      } else {
        const estimatedCount = Math.max(10, Math.min(250, Math.round(file.size / 140)));
        this.renderSmartScheduleOffer(file.name, estimatedCount);
      }
    } else {
      this.showToast(`Selected "${file.name}"`, 'info');
    }
  }

  renderSmartScheduleOffer(fileName, count) {
    const offerEl = document.getElementById('newCampSmartOffer');
    if (!offerEl) return;

    const lines = this.availableLines || 2;
    const seqMinutes = count * 5;
    const seqH = Math.floor(seqMinutes / 60);
    const seqM = seqMinutes % 60;
    const seqText = seqH > 0 ? `~${seqH}h ${seqM}m` : `~${seqM}m`;

    const slotMins = 2;
    const smartMinutes = Math.max(4, Math.ceil(count / lines) * slotMins);
    const smartH = Math.floor(smartMinutes / 60);
    const smartM = smartMinutes % 60;
    const smartText = smartH > 0 ? `~${smartH}h ${smartM}m` : `~${smartM}m`;

    const timeSavedMins = Math.max(0, seqMinutes - smartMinutes);
    const savedH = Math.floor(timeSavedMins / 60);
    const savedM = timeSavedMins % 60;
    const savedText = savedH > 0 ? `${savedH}h ${savedM}m` : `${savedM}m`;
    const pctFaster = seqMinutes > 0 ? Math.round((timeSavedMins / seqMinutes) * 100) : 0;

    const badge = document.getElementById('smartOfferBadge');
    if (badge) badge.textContent = `${count} contacts`;

    const summary = document.getElementById('smartOfferSummary');
    if (summary) {
      summary.innerHTML = `Standard sequential calling takes <strong>${seqText}</strong>. The system suggests distributing calls across <strong>${lines} available lines</strong> to finish in <strong>${smartText}</strong> (saving ~${savedText}, ${pctFaster}% faster).`;
    }

    const actions = document.getElementById('smartOfferActions');
    if (actions) actions.style.display = 'flex';

    const approved = document.getElementById('smartOfferApproved');
    if (approved) approved.style.display = 'none';

    offerEl.style.display = 'block';
    this.smartScheduleApproved = true;
    this.showToast(`Analyzed "${fileName}": Suggested schedule ready for review`, 'info');
  }

  renderSmartScheduleProposalForFile() {}

  showCampaignCreatedFlowModal(campId, campName) {
    this._flowCampaignId = Number(campId);
    const titleEl = document.getElementById('modalCreatedCampTitle');
    if (titleEl) titleEl.textContent = `Campaign: ${campName || 'New Campaign'}`;
    this.openModal('modalCampaignCreated');
  }

  flowUploadContacts() {
    const campId = this._flowCampaignId || this.activeCampaignId;
    this.closeModal('modalCampaignCreated');
    this.openAddContactsModal(campId);
  }

  flowGoToDialer() {
    const campId = this._flowCampaignId || this.activeCampaignId;
    this.closeModal('modalCampaignCreated');
    this.openCampaignInQueue(campId);
  }

  flowGoToDesigner() {
    const campId = this._flowCampaignId || this.activeCampaignId;
    this.closeModal('modalCampaignCreated');
    this.selectCampaignForDesigner(campId);
  }

  openCampaignActionMenu(campaignId, event) {
    if (event) event.stopPropagation();
    const camp = (this.allCampaigns || []).find(c => Number(c.id) === Number(campaignId));
    if (!camp) return;

    const idInp = document.getElementById('campActionMenuCampaignId');
    const titleEl = document.getElementById('campActionMenuTitle');
    if (idInp) idInp.value = camp.id;
    if (titleEl) titleEl.textContent = `${camp.name} Options`;

    this.openModal('modalCampaignActionMenu');
  }

  actionMenuDialCampaign() {
    const id = document.getElementById('campActionMenuCampaignId')?.value;
    this.closeModal('modalCampaignActionMenu');
    if (id) {
      this.openCampaignInQueue(Number(id));
    }
  }

  actionMenuAddContacts() {
    const id = document.getElementById('campActionMenuCampaignId')?.value;
    this.closeModal('modalCampaignActionMenu');
    if (id) {
      this.openAddContactsModal(Number(id));
    }
  }

  actionMenuExportContacts() {
    const id = document.getElementById('campActionMenuCampaignId')?.value;
    this.closeModal('modalCampaignActionMenu');
    if (id) {
      this.exportCampaignContacts(Number(id));
    }
  }

  async actionMenuToggleStatus() {
    const id = document.getElementById('campActionMenuCampaignId')?.value;
    this.closeModal('modalCampaignActionMenu');
    if (!id) return;
    const camp = (this.allCampaigns || []).find(c => Number(c.id) === Number(id));
    const nextStatus = (camp && camp.status === 'running') ? 'idle' : 'running';

    try {
      const formData = new FormData();
      formData.append('campaign_id', id);
      formData.append('status', nextStatus);
      const res = await fetch('api.php?action=toggle_campaign_status', { method: 'POST', body: formData });
      const data = await res.json();
      this.showToast(`Campaign status updated to ${nextStatus}`, 'success');
      await this.loadCampaignsOverview();
    } catch (e) {
      this.showToast('Failed to update campaign status', 'error');
    }
  }

  async actionMenuDeleteCampaign() {
    const id = document.getElementById('campActionMenuCampaignId')?.value;
    this.closeModal('modalCampaignActionMenu');
    if (!id) return;
    if (!confirm('Are you sure you want to delete this campaign and all its leads?')) return;

    try {
      const formData = new FormData();
      formData.append('campaign_id', id);
      const res = await fetch('api.php?action=delete_campaign', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast('Campaign deleted successfully', 'success');
        await this.loadCampaignsOverview();
      } else {
        this.showToast(data.error || 'Failed to delete campaign', 'error');
      }
    } catch (e) {
      this.showToast('Error deleting campaign', 'error');
    }
  }

  populateCampaignSelectDropdowns(selectedId = null) {
    const campaigns = this.allCampaigns || [];
    if (campaigns.length === 0) return;

    const targetIds = ['uploadCampaignSelect', 'manualCampaignSelect', 'singleAddCampaignSelect'];
    targetIds.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const currentVal = selectedId || sel.value || this.activeCampaignId || this.campaign?.id;
      sel.innerHTML = campaigns.map(c => {
        const count = c.total_leads_count || c.total_leads || 0;
        return `<option value="${c.id}">${this.escapeHtml(c.name)} (${count} contacts)</option>`;
      }).join('');
      if (currentVal) sel.value = String(currentVal);
    });
  }

  async openAddContactsModal(campaignId = null) {
    if (!this.allCampaigns || this.allCampaigns.length === 0) {
      await this.loadCampaignsOverview();
    }
    const targetId = campaignId || this.activeCampaignId || this.campaign?.id || 1;
    this.populateCampaignSelectDropdowns(targetId);
    this.openModal('modalUpload');
  }

  async openManualAddModal(campaignId = null) {
    if (!this.allCampaigns || this.allCampaigns.length === 0) {
      await this.loadCampaignsOverview();
    }
    const targetId = campaignId || this.activeCampaignId || this.campaign?.id || 1;
    this.populateCampaignSelectDropdowns(targetId);
    this.openModal('modalManual');
  }

  async openSingleAddModal(campaignId = null) {
    if (!this.allCampaigns || this.allCampaigns.length === 0) {
      await this.loadCampaignsOverview();
    }
    const targetId = campaignId || this.activeCampaignId || this.campaign?.id || 1;
    this.populateCampaignSelectDropdowns(targetId);
    this.openModal('modalSingleAdd');
  }

  exportCampaignContacts(campaignId = null) {
    const targetId = campaignId || this.activeCampaignId || this.campaign?.id || 1;
    this.showToast('Generating contacts CSV export...', 'info');
    window.location.href = `api.php?action=export_contacts_csv&campaign_id=${encodeURIComponent(targetId)}`;
  }

  async selectCampaignForDesigner(campaignId) {
    this.activeCampaignId = Number(campaignId);
    this.ivrResponses = null;

    // Immediately reflect campaign name in breadcrumb tab from cached list
    const camps = this.allCampaigns || [];
    const c = camps.find(item => Number(item.id) === Number(campaignId));
    if (c) {
      this.campaign = c;
      const tabName = document.getElementById('designerTabCampaignName');
      if (tabName) tabName.textContent = c.name || 'Campaign';
      const titleEl = document.getElementById('headerSectionTitle');
      if (titleEl) titleEl.textContent = 'Campaign Designer: ' + (c.name || 'Campaign');
    }

    // Switch view immediately to provide instant visual navigation
    if (typeof window.switchCampaignSubView === 'function') {
      window.switchCampaignSubView('designer');
    } else {
      const listEl = document.getElementById('subViewCampaignsList');
      const designerEl = document.getElementById('subViewCampaignsDesigner');
      if (listEl) listEl.style.display = 'none';
      if (designerEl) designerEl.style.display = 'block';
    }

    try {
      await this.loadCampaignData(campaignId);
      this.updateDesignerUI();
    } catch (err) {
      console.warn('loadCampaignData in selectCampaignForDesigner error:', err);
    }
  }

  loadData(campaignInput = null) {
    return this.loadCampaignData(campaignInput);
  }

  openCampaignInQueue(campaignId) {
    const cid = Number(campaignId) || this.activeCampaignId || this.campaign?.id || (this.allCampaigns && this.allCampaigns[0]?.id) || 1;
    this.selectedCampaignIds = [cid];
    this.activeCampaignId = cid;
    this.ivrResponses = null;
    this.loadCampaignData([cid]).then(() => {
      if (typeof window.switchNav === 'function') {
        window.switchNav('tabDialer', 'dialer/agent');
      }
      if (typeof window.switchDialerSubView === 'function') {
        window.switchDialerSubView('queue');
      }
      this.showToast(`Loaded "${this.campaign?.name || 'Campaign'}" into Outbound Dialer Queue`, 'success');
    });
  }

  updateDesignerUI() {
    if (!this.campaign) return;
    const isSms = (this.campaign.type === 'sms_only');

    const nameEl = document.getElementById('designerCampaignNameText');
    if (nameEl) nameEl.textContent = this.campaign.name || 'Outbound Campaign';

    const tabNameEl = document.getElementById('designerTabCampaignName');
    if (tabNameEl) {
      tabNameEl.textContent = isSms
        ? `${this.campaign.name || 'Campaign'} (SMS Designer)`
        : `${this.campaign.name || 'Campaign'} · Designer`;
    }

    const subPill = document.getElementById('subBtnCampaignsDesigner');
    if (subPill) subPill.textContent = `${this.campaign.name || 'Campaign'} Designer`;

    const typeBadge = document.getElementById('designerCampaignTypeBadge');
    if (typeBadge) {
      typeBadge.textContent = (this.campaign.type || 'preview').toUpperCase();
    }

    // Toggle Workspace views and Actions
    const voiceWork = document.getElementById('designerVoiceWorkspace');
    const smsWork = document.getElementById('designerSmsWorkspace');
    const voiceTopActs = document.getElementById('designerVoiceTopActions');
    const smsTopActs = document.getElementById('designerSmsTopActions');
    const btnContactDispatch = document.getElementById('btnContactsDispatchSms');
    const schedFilter = document.getElementById('designerContactScheduleFilter');
    const contactsTitle = document.getElementById('designerContactsTitle');

    if (isSms) {
      if (voiceWork) voiceWork.style.display = 'none';
      if (smsWork) smsWork.style.display = 'block';
      if (voiceTopActs) voiceTopActs.style.display = 'none';
      if (smsTopActs) smsTopActs.style.display = 'flex';
      if (btnContactDispatch) btnContactDispatch.style.display = 'inline-block';
      if (schedFilter) schedFilter.style.display = 'inline-block';
      if (contactsTitle) contactsTitle.textContent = 'SMS Campaign Contacts';

      // Populate SMS Designer fields
      const smsSender = document.getElementById('smsDesignerSenderId');
      const smsTpl = document.getElementById('smsDesignerTemplate');
      if (smsSender) smsSender.value = this.campaign.sms_sender_id || 'SkyConnect';
      if (smsTpl) {
        smsTpl.value = this.campaign.sms_template || 'Hello {name}, this is an important message regarding {campaign}. Please reply or call us if you have any questions.';
        this.updateSmsCharCount(smsTpl, 'smsDesignerCharCount');
      }
      this.updateSmsDesignerLivePreview();

      // Populate SMS Schedule fields
      const smsMethod = document.getElementById('smsDesignerCallingMethod');
      const smsStrat = document.getElementById('smsDesignerScheduleStrategy');
      const smsIntv = document.getElementById('smsDesignerScheduleInterval');
      const smsWinStart = document.getElementById('smsDesignerWindowStart');
      const smsWinEnd = document.getElementById('smsDesignerWindowEnd');

      if (smsMethod) smsMethod.value = this.campaign.calling_method || 'auto_schedule';
      if (smsStrat) smsStrat.value = this.campaign.schedule_strategy || 'interval';
      if (smsIntv) smsIntv.value = String(this.campaign.schedule_interval_mins || 5);
      if (smsWinStart) smsWinStart.value = this.campaign.schedule_window_start || '09:00';
      if (smsWinEnd) smsWinEnd.value = this.campaign.schedule_window_end || '17:00';
      this.handleSmsDesignerStrategyChange(smsStrat?.value || 'interval');
      this.handleSmsDesignerMethodChange(smsMethod?.value || 'auto_schedule');

      // SMS Stats calculation
      const campLeads = (this.leads || []).filter(l => Number(l.campaign_id) === Number(this.campaign.id));
      const total = (this.campaign.total_leads > 0) ? Number(this.campaign.total_leads) : campLeads.length;
      let sent = 0, pending = 0, failed = 0;
      campLeads.forEach(l => {
        const s = (l.status || 'pending').toLowerCase();
        if (['completed', 'answered'].includes(s)) sent++;
        else if (['failed', 'no_answer'].includes(s)) failed++;
        else pending++;
      });
      const pct = total > 0 ? Math.min(100, Math.round((sent / total) * 100)) : 0;

      const elTot = document.getElementById('smsChipTotal');
      const elSent = document.getElementById('smsChipSent');
      const elPend = document.getElementById('smsChipPending');
      const elFail = document.getElementById('smsChipFailed');
      const elBar = document.getElementById('smsProgressBarFill');
      const elBadge = document.getElementById('smsProgressPercentBadge');

      if (elTot) elTot.textContent = total;
      if (elSent) elSent.textContent = sent;
      if (elPend) elPend.textContent = pending;
      if (elFail) elFail.textContent = failed;
      if (elBar) elBar.style.width = `${pct}%`;
      if (elBadge) elBadge.textContent = `${pct}% Sent`;

    } else {
      if (voiceWork) voiceWork.style.display = 'block';
      if (smsWork) smsWork.style.display = 'none';
      if (voiceTopActs) voiceTopActs.style.display = 'flex';
      if (smsTopActs) smsTopActs.style.display = 'none';
      if (btnContactDispatch) btnContactDispatch.style.display = 'none';
      if (schedFilter) schedFilter.style.display = 'inline-block';
      if (contactsTitle) contactsTitle.textContent = 'Contacts';

      const txtArea = document.getElementById('campaignMessageText');
      if (txtArea && this.campaign.ivr_message_text) {
        txtArea.value = this.campaign.ivr_message_text;
      }

      const lang = (this.campaign.ivr_language || 'amharic').toLowerCase();
      document.querySelectorAll('#langBtnAmharic, #langBtnOromifa, #langBtnEnglish').forEach(b => {
        b.className = 'des-lang-btn';
      });
      if (lang === 'amharic') document.getElementById('langBtnAmharic')?.classList.add('active');
      else if (lang === 'oromifa') document.getElementById('langBtnOromifa')?.classList.add('active');
      else document.getElementById('langBtnEnglish')?.classList.add('active');

      // Audio prompt dropdown
      this.populateDesignerAudioDropdown();

      // Calling & Scheduling fields
      const callingMethodSel = document.getElementById('designerCallingMethodSelect');
      if (callingMethodSel && this.campaign.calling_method) {
        callingMethodSel.value = this.campaign.calling_method;
        this.handleDesignerCallingMethodChange(this.campaign.calling_method);
      }
      const stratSel = document.getElementById('designerScheduleStrategy');
      if (stratSel && this.campaign.schedule_strategy) {
        stratSel.value = this.campaign.schedule_strategy;
        this.handleDesignerScheduleStrategyChange(this.campaign.schedule_strategy);
      }
      const intvSel = document.getElementById('designerScheduleInterval');
      if (intvSel && this.campaign.schedule_interval_mins) {
        intvSel.value = String(this.campaign.schedule_interval_mins);
      }
      const winStartInp = document.getElementById('designerWindowStart');
      if (winStartInp && this.campaign.schedule_window_start) {
        winStartInp.value = this.campaign.schedule_window_start;
      }
      const winEndInp = document.getElementById('designerWindowEnd');
      if (winEndInp && this.campaign.schedule_window_end) {
        winEndInp.value = this.campaign.schedule_window_end;
      }
      const batchSel = document.getElementById('designerBatchSize');
      if (batchSel && this.campaign.schedule_batch_size) {
        batchSel.value = String(this.campaign.schedule_batch_size);
      }

      // Populate SMS Follow-up settings in Designer
      const chkSms = document.getElementById('designerSmsEnabled');
      const selSmsTrigger = document.getElementById('designerSmsTrigger');
      const txtSmsTemplate = document.getElementById('designerSmsTemplate');
      const inpSmsSender = document.getElementById('designerSmsSenderId');
      const isSmsOn = (Number(this.campaign.sms_enabled) === 1);
      if (chkSms) {
        chkSms.checked = isSmsOn;
        this.toggleDesignerSmsOptions(isSmsOn);
      }
      if (selSmsTrigger && this.campaign.sms_trigger) {
        selSmsTrigger.value = this.campaign.sms_trigger;
      }
      if (txtSmsTemplate) {
        txtSmsTemplate.value = this.campaign.sms_template || 'Hello {name}, thank you for taking our call regarding {campaign}. We have recorded your response.';
      }
      if (inpSmsSender && this.campaign.sms_sender_id) {
        inpSmsSender.value = this.campaign.sms_sender_id;
      }
      this.updateDesignerSmsPreview();

      // Live Results calculation
      const total = (this.campaign.total_leads > 0) ? this.campaign.total_leads : this.leads.length;
      let pending = 0, answered = 0, busy = 0, noAnswer = 0;
      this.leads.forEach(l => {
        const s = l.status;
        if (s === 'pending') pending++;
        else if (['answered', 'completed', 'ivr_completed', 'ivr_playing'].includes(s)) answered++;
        else if (s === 'busy') busy++;
        else if (s === 'no_answer') noAnswer++;
      });

      const dialed = total > 0 ? (total - pending) : 0;
      const pct = total > 0 ? Math.min(100, Math.round((dialed / total) * 100)) : 0;

      const elSched = document.getElementById('chipScheduled');
      const elDialed = document.getElementById('chipDialed');
      const elAns = document.getElementById('chipAnswered');
      const elBusy = document.getElementById('chipBusy');
      const elNoAns = document.getElementById('chipNoAnswer');

      const displayTotal = total > 0 ? total : 0;
      this.updateDesignerPreview();
      this.renderIvrResponsesSummary();
      this.updateDesignerChecklist();
      if (elSched) elSched.textContent = displayTotal;
      if (elDialed) elDialed.textContent = dialed;
      if (elAns) elAns.textContent = answered;
      if (elBusy) elBusy.textContent = busy;
      if (elNoAns) elNoAns.textContent = noAnswer;

      const pctEl = document.getElementById('designerProgressPercent');
      const ratioEl = document.getElementById('designerProgressRatio');
      const barEl = document.getElementById('designerProgressBarFill');

      if (pctEl) pctEl.textContent = `Progress ${pct}%`;
      if (ratioEl) ratioEl.textContent = `${dialed} of ${displayTotal} dialed`;
      if (barEl) barEl.style.width = `${pct}%`;

      const statusBadge = document.getElementById('designerCampaignStatusBadge');
      const btnLaunch = document.getElementById('btnLaunchDesignerCampaign');

      const isRunning = (this.campaign.status === 'running');
      if (statusBadge) {
        statusBadge.innerHTML = `<span class="dot"></span>${isRunning ? 'Running' : (this.campaign.status === 'completed' ? 'Done' : 'Paused')}`;
        statusBadge.className = `des-status-pill ${isRunning ? 'running' : 'idle'}`;
      }
      if (btnLaunch) {
        btnLaunch.textContent = isRunning ? 'Pause campaign' : 'Launch campaign';
        btnLaunch.className = `des-btn-launch ${isRunning ? 'running' : ''}`;
      }
    }

    this.renderDesignerContactsTable();
  }

  onDesignerContactFilterChange() {
    this._designerContactsExpanded = false;
    this.renderDesignerContactsTable();
  }

  toggleDesignerContactsExpand(expand) {
    this._designerContactsExpanded = expand;
    this.renderDesignerContactsTable();
  }

  renderDesignerContactsTable() {
    const tbody = document.getElementById('designerContactsTableBody');
    if (!tbody) return;

    const campId = Number(this.activeCampaignId || this.campaign?.id || 1);
    const campLeads = (this.leads || []).filter(l => Number(l.campaign_id) === campId);
    let rawList = (campLeads && campLeads.length > 0) ? campLeads : [];

    const isSms = (this.campaign?.type === 'sms_only');
    const thead = document.getElementById('designerContactsTableHead');
    if (thead) {
      if (isSms) {
        thead.innerHTML = `
          <tr>
            <th>CUSTOMER</th>
            <th>PHONE</th>
            <th>SCHEDULED</th>
            <th>SMS STATUS</th>
            <th>MESSAGE PREVIEW</th>
            <th style="text-align:right;">ACTIONS</th>
          </tr>
        `;
      } else {
        thead.innerHTML = `
          <tr>
            <th>CUSTOMER</th>
            <th>PHONE</th>
            <th>SCHEDULED</th>
            <th>STATUS</th>
            <th>DURATION</th>
            <th style="text-align:right;"></th>
          </tr>
        `;
      }
    }

    const searchVal = document.getElementById('designerLeadSearch')?.value.toLowerCase().trim() || '';
    const statusVal = document.getElementById('designerContactStatusFilter')?.value.toLowerCase().trim() || '';
    const schedVal = document.getElementById('designerContactScheduleFilter')?.value.toLowerCase().trim() || '';

    const filtered = rawList.filter(l => {
      // 1. Text Search Filter (name or phone)
      if (searchVal) {
        const matchesName = l.customer_name && l.customer_name.toLowerCase().includes(searchVal);
        const matchesPhone = l.phone_number && l.phone_number.includes(searchVal);
        if (!matchesName && !matchesPhone) return false;
      }

      // 2. Status Filter
      if (statusVal) {
        const s = (l.status || 'pending').toLowerCase();
        if (statusVal === 'pending' && s !== 'pending') return false;
        if ((statusVal === 'answered' || statusVal === 'completed') && !['answered', 'completed', 'ivr_completed', 'ivr_playing'].includes(s)) return false;
        if (statusVal === 'busy' && s !== 'busy') return false;
        if ((statusVal === 'no_answer' || statusVal === 'failed') && !['no_answer', 'failed'].includes(s)) return false;
      }

      // 3. Schedule Filter
      if (schedVal) {
        const sched = this.getLeadScheduleInfo(l);
        if (schedVal === 'upcoming' && sched.type !== 'upcoming') return false;
        if (schedVal === 'today' && sched.type !== 'today') return false;
        if (schedVal === 'past_due' && sched.type !== 'past_due') return false;
        if (schedVal === 'immediate' && sched.type !== 'immediate') return false;
      }

      return true;
    });

    const subTitle = document.getElementById('designerContactsSubtitle');
    if (subTitle) {
      if (isSms) {
        const sentNum = rawList.filter(l => ['completed', 'answered'].includes((l.status || '').toLowerCase())).length;
        const pendingNum = rawList.filter(l => (l.status || '').toLowerCase() === 'pending').length;
        subTitle.textContent = `${rawList.length} contacts (${sentNum} sent, ${pendingNum} pending)`;
      } else {
        if (rawList.length === 0) {
          subTitle.textContent = '0 scheduled calls';
        } else if (filtered.length !== rawList.length) {
          subTitle.textContent = `Showing ${filtered.length} of ${rawList.length} scheduled calls`;
        } else {
          subTitle.textContent = `${rawList.length} scheduled calls`;
        }
      }
    }

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      const emptyMsg = rawList.length === 0
        ? (isSms ? 'No contacts uploaded for this SMS campaign yet. Click "Add numbers" above to import your contact list.' : 'No contacts uploaded for this campaign yet. Click "Add numbers" above to import your contact list.')
        : 'No contacts match the current filters.';
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#64748b;padding:36px 20px;font-size:13px;">${emptyMsg}</td></tr>`;
      return;
    }

    // Don't show all at once (limit initial view to 6 contacts)
    const LIMIT = 6;
    const isExpanded = !!this._designerContactsExpanded;
    const visibleContacts = (filtered.length > LIMIT && !isExpanded) ? filtered.slice(0, LIMIT) : filtered;
    const hiddenCount = filtered.length - LIMIT;

    const tpl = (this.campaign?.sms_template || 'Hello {name}, thank you for choosing {campaign}.');
    const campName = this.campaign?.name || 'Campaign';

    let rowsHtml = '';
    visibleContacts.forEach(l => {
      const rawStatus = (l.status || 'pending').toLowerCase();

      if (isSms) {
        const sched = this.getLeadScheduleInfo(l);
        const isPastDue = rawStatus === 'pending' && (this.isLeadPastDue(l) || sched.type === 'past_due');
        let statusClass = 'des-badge-pending';
        let statusLabel = 'Pending';
        if (['completed', 'answered'].includes(rawStatus)) {
          statusClass = 'des-badge-answered';
          statusLabel = 'Delivered';
        } else if (['failed', 'no_answer'].includes(rawStatus)) {
          statusClass = 'des-badge-noanswer';
          statusLabel = 'Failed';
        } else if (isPastDue) {
          statusClass = 'des-badge-pastdue';
          statusLabel = 'Past Due';
        }

        const previewMsg = this.renderSmsTemplate(tpl, {
          name: l.customer_name || 'Contact',
          campaign: campName,
          phone: l.phone_number || '',
          call_time: l.call_time
        });
        const shortPreview = previewMsg.length > 55 ? (previewMsg.substring(0, 52) + '...') : previewMsg;

        rowsHtml += `
          <tr>
            <td style="font-weight:600;color:#0f172a;">${this.escapeHtml(l.customer_name || 'Contact')}</td>
            <td style="color:#334155;font-weight:500;">${this.escapeHtml(l.phone_number)}</td>
            <td><span class="${sched.badgeClass}">${this.escapeHtml(sched.displayTime || l.call_time || 'Immediate')}</span></td>
            <td><span class="${statusClass}">${this.escapeHtml(statusLabel)}</span></td>
            <td style="color:#64748b;font-size:12px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this.escapeHtml(previewMsg)}">${this.escapeHtml(shortPreview)}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button type="button" class="des-btn-call-pill" style="background:#00A651;color:#fff;border:none;padding:4px 12px;border-radius:12px;font-size:11.5px;font-weight:700;cursor:pointer;" onclick="app.sendSingleContactSms(${typeof l.id === 'number' ? l.id : `'${l.id}'`}, '${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name || 'Contact')}')">Send SMS</button>
              <button type="button" class="des-btn-delete-link" onclick="app.deleteLead(${typeof l.id === 'number' ? l.id : `'${l.id}'`})">Delete</button>
            </td>
          </tr>
        `;
      } else {
        const sched = this.getLeadScheduleInfo(l);
        const dur = (l.duration_sec && l.duration_sec > 0) ? `${l.duration_sec}s` : '-';
        
        let statusClass = 'des-badge-pending';
        let statusLabel = 'Pending';
        if (['answered', 'completed', 'ivr_completed', 'ivr_playing'].includes(rawStatus)) {
          statusClass = 'des-badge-answered';
          statusLabel = 'Answered';
        } else if (rawStatus === 'busy') {
          statusClass = 'des-badge-busy';
          statusLabel = 'Busy';
        } else if (['no_answer', 'failed'].includes(rawStatus)) {
          statusClass = 'des-badge-noanswer';
          statusLabel = 'No answer';
        }

        rowsHtml += `
          <tr>
            <td style="font-weight:600;color:#0f172a;">${this.escapeHtml(l.customer_name || 'Customer')}</td>
            <td style="color:#334155;font-weight:500;">${this.escapeHtml(l.phone_number)}</td>
            <td><span class="${sched.badgeClass}">${this.escapeHtml(sched.displayTime || l.call_time || 'Immediate')}</span></td>
            <td><span class="${statusClass}">${this.escapeHtml(statusLabel)}</span></td>
            <td style="color:#94a3b8;">${dur}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button type="button" class="des-btn-call-pill" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')">Call</button>
              <button type="button" class="des-btn-delete-link" onclick="app.deleteLead(${typeof l.id === 'number' ? l.id : `'${l.id}'`})">Delete</button>
            </td>
          </tr>
        `;
      }
    });

    // Expand / Show More Row
    if (filtered.length > LIMIT) {
      const colSpan = 6;
      if (!isExpanded) {
        rowsHtml += `
          <tr>
            <td colspan="${colSpan}" style="padding:14px;text-align:center;border-top:1px solid #f1f5f9;">
              <button type="button" onclick="app.toggleDesignerContactsExpand(true)"
                style="background:none;border:1.5px solid #e2e8f0;border-radius:8px;padding:7px 24px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;transition:all 0.15s;"
                onmouseover="this.style.borderColor='#00A651';this.style.color='#00A651';"
                onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#475569';">
                Show ${hiddenCount} more contact${hiddenCount === 1 ? '' : 's'}
              </button>
            </td>
          </tr>
        `;
      } else {
        rowsHtml += `
          <tr>
            <td colspan="${colSpan}" style="padding:14px;text-align:center;border-top:1px solid #f1f5f9;">
              <button type="button" onclick="app.toggleDesignerContactsExpand(false)"
                style="background:none;border:1.5px solid #e2e8f0;border-radius:8px;padding:7px 24px;font-size:12.5px;font-weight:600;color:#475569;cursor:pointer;transition:all 0.15s;"
                onmouseover="this.style.borderColor='#00A651';this.style.color='#00A651';"
                onmouseout="this.style.borderColor='#e2e8f0';this.style.color='#475569';">
                Show less
              </button>
            </td>
          </tr>
        `;
      }
    }

    tbody.innerHTML = rowsHtml;
  }

  renderSmsTemplate(template, data = {}) {
    if (!template) return '';
    const nowParts = this.getZonedDateParts(this.getServerNow());
    const todayIso = nowParts.ymd;
    const h12Now = (nowParts.hour % 12) || 12;
    const ampmNow = nowParts.hour >= 12 ? 'PM' : 'AM';
    const todayTime = `${String(h12Now).padStart(2, '0')}:${String(nowParts.minute).padStart(2, '0')} ${ampmNow}`;

    const name = data.name || data.customer_name || 'Contact';
    const phone = data.phone || data.phone_number || '';
    const campaign = data.campaign || data.campaign_name || this.activeSmsCampaign?.name || this.campaign?.name || 'SkyConnect';
    const account = data.account || data.account_number || '';
    const outcome = data.outcome || data.status || 'Confirmed';
    const key = data.key || data.key_pressed || data.dtmf || '1';

    let dateStr = data.date || '';
    let timeStr = data.time || '';
    if (!dateStr && data.call_time && !this.isImmediateCallTime(data.call_time)) {
      const schedMs = this.getLeadScheduledTimestamp({ call_time: data.call_time, created_at: data.created_at });
      if (schedMs > 0) {
        const sp = this.getZonedDateParts(schedMs);
        dateStr = sp.ymd;
        const sh12 = (sp.hour % 12) || 12;
        const sampm = sp.hour >= 12 ? 'PM' : 'AM';
        timeStr = `${String(sh12).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')} ${sampm}`;
      } else if (typeof data.call_time === 'string' && data.call_time.includes(' ')) {
        dateStr = data.call_time.split(' ')[0];
        timeStr = data.call_time.split(' ')[1] || todayTime;
      }
    }
    if (!dateStr) dateStr = todayIso;
    if (!timeStr) timeStr = todayTime;

    return template
      .replace(/\{customer_name\}|\{name\}/gi, name)
      .replace(/\{phone_number\}|\{phone\}/gi, phone)
      .replace(/\{campaign_name\}|\{campaign\}/gi, campaign)
      .replace(/\{account_number\}|\{account\}/gi, account)
      .replace(/\{outcome\}/gi, outcome)
      .replace(/\{key_pressed\}|\{key\}/gi, key)
      .replace(/\{date\}/gi, dateStr)
      .replace(/\{time\}/gi, timeStr);
  }

  renderSmsTemplateHighlighted(template, data = {}) {
    if (!template) return { text: '', html: '' };
    const rendered = this.renderSmsTemplate(template, data);
    const escaped = this.escapeHtml(template);

    const nowParts = this.getZonedDateParts(this.getServerNow());
    const todayIso = nowParts.ymd;
    const h12Now = (nowParts.hour % 12) || 12;
    const ampmNow = nowParts.hour >= 12 ? 'PM' : 'AM';
    const todayTime = `${String(h12Now).padStart(2, '0')}:${String(nowParts.minute).padStart(2, '0')} ${ampmNow}`;

    const name = data.name || data.customer_name || 'Contact';
    const phone = data.phone || data.phone_number || '';
    const campaign = data.campaign || data.campaign_name || this.activeSmsCampaign?.name || this.campaign?.name || 'SkyConnect';
    const account = data.account || data.account_number || '';
    const outcome = data.outcome || data.status || 'Confirmed';
    const key = data.key || data.key_pressed || data.dtmf || '1';

    let dateStr = data.date || '';
    let timeStr = data.time || '';
    if (!dateStr && data.call_time && !this.isImmediateCallTime(data.call_time)) {
      const schedMs = this.getLeadScheduledTimestamp({ call_time: data.call_time, created_at: data.created_at });
      if (schedMs > 0) {
        const sp = this.getZonedDateParts(schedMs);
        dateStr = sp.ymd;
        const sh12 = (sp.hour % 12) || 12;
        const sampm = sp.hour >= 12 ? 'PM' : 'AM';
        timeStr = `${String(sh12).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')} ${sampm}`;
      } else if (typeof data.call_time === 'string' && data.call_time.includes(' ')) {
        dateStr = data.call_time.split(' ')[0];
        timeStr = data.call_time.split(' ')[1] || todayTime;
      }
    }
    if (!dateStr) dateStr = todayIso;
    if (!timeStr) timeStr = todayTime;

    const span = (val) => `<strong style="color:#00A651;font-weight:700;">${this.escapeHtml(val)}</strong>`;

    const html = escaped
      .replace(/\{customer_name\}|\{name\}/gi, span(name))
      .replace(/\{phone_number\}|\{phone\}/gi, span(phone))
      .replace(/\{campaign_name\}|\{campaign\}/gi, span(campaign))
      .replace(/\{account_number\}|\{account\}/gi, span(account))
      .replace(/\{outcome\}/gi, span(outcome))
      .replace(/\{key_pressed\}|\{key\}/gi, span(key))
      .replace(/\{date\}/gi, span(dateStr))
      .replace(/\{time\}/gi, span(timeStr));

    return { text: rendered, html: html };
  }

  updateSmsDesignerLivePreview() {
    const bubble = document.getElementById('smsPhonePreviewBubble');
    const sender = document.getElementById('smsPhonePreviewSender');
    const txtEl = document.getElementById('smsDesignerTemplate');
    const senderInp = document.getElementById('smsDesignerSenderId');

    const sName = senderInp?.value.trim() || 'SkyConnect';
    if (sender) sender.textContent = sName;

    if (!bubble) return;
    const tpl = txtEl?.value.trim() || 'Hello {name}, this is an important message regarding {campaign}. Please reply or call us if you have any questions.';
    const campName = this.campaign?.name || 'Appointment Reminder';
    bubble.textContent = this.renderSmsTemplate(tpl, {
      name: 'Abebe Bikila',
      campaign: campName,
      phone: '+251911223344',
      date: this.getLocalDateString()
    });
  }

  async saveSmsCampaignDesigner() {
    const campId = Number(this.activeCampaignId || this.campaign?.id);
    if (!campId) return;

    const tpl = document.getElementById('smsDesignerTemplate')?.value.trim() || '';
    const sender = document.getElementById('smsDesignerSenderId')?.value.trim() || 'SkyConnect';
    const method = document.getElementById('smsDesignerCallingMethod')?.value || 'auto_schedule';
    const strat = document.getElementById('smsDesignerScheduleStrategy')?.value || 'interval';
    const intv = document.getElementById('smsDesignerScheduleInterval')?.value || '5';
    const winStart = document.getElementById('smsDesignerWindowStart')?.value || '09:00';
    const winEnd = document.getElementById('smsDesignerWindowEnd')?.value || '17:00';

    const fd = new FormData();
    fd.append('campaign_id', campId);
    fd.append('sms_template', tpl);
    fd.append('sms_sender_id', sender);
    fd.append('sms_enabled', '1');
    fd.append('calling_method', method);
    fd.append('schedule_strategy', strat);
    fd.append('schedule_interval_mins', intv);
    fd.append('schedule_window_start', winStart);
    fd.append('schedule_window_end', winEnd);

    try {
      const res = await fetch('api.php?action=save_campaign_designer', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        if (this.campaign) {
          this.campaign.sms_template = tpl;
          this.campaign.sms_sender_id = sender;
          this.campaign.calling_method = method;
          this.campaign.schedule_strategy = strat;
          this.campaign.schedule_interval_mins = intv;
          this.campaign.schedule_window_start = winStart;
          this.campaign.schedule_window_end = winEnd;
        }
        this.showToast('SMS campaign settings saved!', 'success');
      } else {
        this.showToast(data.error || 'Failed to save SMS settings', 'error');
      }
    } catch (e) {
      this.showToast('Error saving SMS campaign', 'error');
    }
  }

  async dispatchSmsCampaign(campId = null, forceBlast = false) {
    const targetId = Number(campId || this.activeCampaignId || this.campaign?.id);
    if (!targetId) {
      this.showToast('Please select a campaign first', 'warning');
      return;
    }

    const targetCamp = (this.campaign && Number(this.campaign.id) === targetId)
      ? this.campaign
      : ((this.allCampaigns || []).find(c => Number(c.id) === targetId) || null);

    // For auto-scheduled SMS campaigns, Launch starts scheduled auto-dispatch unless explicit Force Blast was clicked
    if (!forceBlast && targetCamp && targetCamp.calling_method === 'auto_schedule') {
      const nowMs = this.getServerNow();
      const campLeads = (this.leads || []).filter(l => Number(l.campaign_id) === targetId && (l.status || '').toLowerCase() === 'pending');
      const hasFutureScheduled = campLeads.some(l => {
        if (this.isImmediateCallTime(l.call_time)) return false;
        const ts = this.getLeadScheduledTimestamp(l);
        return ts > nowMs;
      });
      if (hasFutureScheduled) {
        this.activeSmsCampaignId = targetId;
        if (typeof switchTab === 'function') {
          switchTab('tabSmsCampaigns');
        }
        await this.loadSmsDispatcherScreen(targetId);
        await this.startSmsDispatcher();
        return;
      }
    }

    const tpl = document.getElementById('smsDesignerTemplate')?.value.trim() || (this.campaign?.sms_template || '');
    const sender = document.getElementById('smsDesignerSenderId')?.value.trim() || (this.campaign?.sms_sender_id || 'SkyConnect');

    const btn = document.getElementById('btnDispatchSmsCampaign');
    const topBtn = document.getElementById('btnLaunchSmsCampaignTop');
    const contactBtn = document.getElementById('btnContactsDispatchSms');

    const setBusy = (busy) => {
      [btn, topBtn, contactBtn].forEach(b => {
        if (b) {
          b.disabled = busy;
          if (busy) {
            b.dataset.origText = b.dataset.origText || b.innerHTML;
            b.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true" style="display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 0.75s linear infinite;margin-right:6px;"></span>Dispatching SMS...';
          } else {
            b.innerHTML = b.dataset.origText || 'Dispatch SMS Campaign';
          }
        }
      });
    };

    setBusy(true);

    try {
      let totalSent = 0;
      let totalFailed = 0;
      let remaining = 1;
      let iterations = 0;

      while (remaining > 0 && iterations < 20) {
        iterations++;
        const fd = new FormData();
        fd.append('campaign_id', targetId);
        fd.append('template', tpl);
        fd.append('sender_id', sender);
        fd.append('batch_size', '50');

        const res = await fetch('api.php?action=dispatch_sms_campaign', { method: 'POST', body: fd });
        const data = await res.json();

        if (!data || !data.success) {
          this.showToast(data.error || 'SMS dispatch batch failed', 'error');
          break;
        }

        totalSent += (data.sent_count || 0);
        totalFailed += (data.failed_count || 0);
        remaining = Number(data.remaining_pending || 0);

        if (data.batch_processed === 0) {
          break;
        }

        if (remaining > 0) {
          this.showToast(`Dispatched ${totalSent} SMS (${remaining} remaining)...`, 'info');
          await new Promise(r => setTimeout(r, 400));
        }
      }

      await this.loadCampaignData(targetId);
      this.updateDesignerUI();
      this.renderDesignerContactsTable();

      if (totalSent > 0) {
        this.showToast(`Successfully dispatched ${totalSent} SMS messages!`, 'success');
      } else if (remaining === 0) {
        this.showToast('All contacts in this campaign have already been reached.', 'info');
      } else {
        this.showToast('No pending SMS messages to dispatch.', 'info');
      }
    } catch (e) {
      console.warn('dispatchSmsCampaign error:', e);
      this.showToast('Network error during SMS dispatch', 'error');
    } finally {
      setBusy(false);
    }
  }

  async sendSingleContactSms(leadId, phone, name) {
    if (!phone) {
      this.showToast('Contact has no valid phone number', 'warning');
      return;
    }
    const campId = Number(this.activeCampaignId || this.campaign?.id);
    const tpl = document.getElementById('smsDesignerTemplate')?.value.trim() || (this.campaign?.sms_template || 'Hello {name}, thank you for choosing {campaign}.');
    const sender = document.getElementById('smsDesignerSenderId')?.value.trim() || (this.campaign?.sms_sender_id || 'SkyConnect');
    const campName = this.campaign?.name || 'Campaign';
    const lead = (this.leads || []).find(l => Number(l.id) === Number(leadId));

    const rendered = this.renderSmsTemplate(tpl, {
      name: name || 'Contact',
      campaign: campName,
      phone: phone,
      outcome: 'Delivered',
      call_time: lead?.call_time
    });

    const fd = new FormData();
    fd.append('phone_number', phone);
    fd.append('message', rendered);
    fd.append('lead_id', leadId);
    fd.append('campaign_id', campId);
    fd.append('customer_name', name || 'Contact');
    fd.append('sender_id', sender);

    try {
      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`SMS sent to ${phone}: ${data.note || 'Logged'}`, 'success');
        const lead = (this.leads || []).find(l => Number(l.id) === Number(leadId));
        if (lead) {
          lead.status = 'completed';
        }
        this.updateDesignerUI();
        this.renderDesignerContactsTable();
      } else {
        this.showToast(data.error || 'Failed to send SMS', 'error');
      }
    } catch (e) {
      this.showToast('Network error sending SMS', 'error');
    }
  }

  async sendTestSmsFromSmsDesigner() {
    const phone = document.getElementById('smsDesignerTestPhone')?.value.trim();
    if (!phone) {
      this.showToast('Please enter a test phone number', 'warning');
      document.getElementById('smsDesignerTestPhone')?.focus();
      return;
    }
    const tpl = document.getElementById('smsDesignerTemplate')?.value.trim() || 'Hello {name}, this is a test SMS from SkyConnect.';
    const sender = document.getElementById('smsDesignerSenderId')?.value.trim() || 'SkyConnect';
    const campName = this.campaign?.name || 'Test Campaign';

    const rendered = this.renderSmsTemplate(tpl, {
      name: 'Test Recipient',
      campaign: campName,
      phone: phone,
      outcome: 'Test'
    });

    const fd = new FormData();
    fd.append('phone_number', phone);
    fd.append('message', rendered);
    fd.append('sender_id', sender);
    fd.append('customer_name', 'Test Recipient');

    try {
      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`Test SMS sent to ${phone}! (${data.mode === 'live' ? 'Live gateway' : 'Simulator recorded'})`, 'success');
      } else {
        this.showToast(data.error || 'Failed to send test SMS', 'error');
      }
    } catch (e) {
      this.showToast('Network error sending test SMS', 'error');
    }
  }

  async resetFailedSms() {
    const campId = Number(this.activeCampaignId || this.campaign?.id);
    if (!campId) return;

    const fd = new FormData();
    fd.append('campaign_id', campId);

    try {
      const res = await fetch('api.php?action=reset_sms_leads', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`Reset ${data.reset_count || 0} failed contacts back to pending.`, 'success');
        await this.loadCampaignData(campId);
        this.updateDesignerUI();
        this.renderDesignerContactsTable();
      } else {
        this.showToast(data.error || 'Failed to reset leads', 'error');
      }
    } catch (e) {
      this.showToast('Error resetting leads', 'error');
    }
  }

  showSmsCampaignsView(campaignId = null) {
    this.campaignViewMode = 'sms';

    // Sidebar active pill
    document.querySelectorAll('.sc-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('sbSmsCampaigns')?.classList.add('active');

    // Show tabSmsCampaigns panel
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tabSmsCampaigns')?.classList.add('active');

    // Update section titles and breadcrumb
    const headerTitle = document.getElementById('headerSectionTitle');
    if (headerTitle) headerTitle.textContent = 'SMS Campaign Messenger & Scheduled Queue';
    const topUrl = document.getElementById('topUrlText');
    if (topUrl) topUrl.textContent = 'skyconnect.local/sms-campaigns';

    this.updateSmsKpiCards();
    this.loadSmsDispatcherScreen(campaignId);
    this.startSmsCountdownTick();
    this.showToast('Viewing SMS Campaigns', 'info');
  }

  showVoiceCampaignsView() {
    this.campaignViewMode = 'voice';
    if (this._smsCountdownTimer) {
      clearInterval(this._smsCountdownTimer);
      this._smsCountdownTimer = null;
    }

    // Sidebar active pill
    document.querySelectorAll('.sc-nav-item').forEach(b => b.classList.remove('active'));
    document.getElementById('sbCampaigns')?.classList.add('active');

    // Show tabCampaigns panel
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById('tabCampaigns')?.classList.add('active');

    if (typeof window.switchCampaignSubView === 'function') {
      window.switchCampaignSubView('list');
    }

    // Update section titles and breadcrumb
    const headerTitle = document.getElementById('headerSectionTitle');
    if (headerTitle) headerTitle.textContent = 'Campaign Management';
    const topUrl = document.getElementById('topUrlText');
    if (topUrl) topUrl.textContent = 'skyconnect.local/campaigns';

    this.updateCampaignOverviewHeader(false);
    this.selectCampaignMode('automated_ivr');
    this.filterCampaignsTable();
    this.updateVoiceKpiCards();
  }

  updateCampaignOverviewHeader(isSms) {
    const mainTitle = document.getElementById('campMainTitle');
    if (mainTitle) mainTitle.textContent = isSms ? 'SMS Campaigns' : 'Campaigns';

    const mainSub = document.getElementById('campMainSubtitle');
    if (mainSub) mainSub.textContent = isSms
      ? 'Create, monitor and dispatch automated SMS messaging campaigns.'
      : 'Create, monitor and control automated outbound voice campaigns.';

    const panelHeading = document.getElementById('campPanelHeading');
    if (panelHeading) panelHeading.textContent = isSms ? 'SMS campaigns' : 'All campaigns';

    const wizardHeading = document.getElementById('campWizardHeading');
    if (wizardHeading) wizardHeading.textContent = isSms ? 'New SMS campaign' : 'New campaign';
  }

  updateSmsKpiCards() {
    if (this.campaignViewMode !== 'sms') return;

    const lbl1 = document.getElementById('kpiCard1Lbl');
    const val1 = document.getElementById('kpiActiveCalls');
    const lbl2 = document.getElementById('kpiCard2Lbl');
    const val2 = document.getElementById('kpiAvailableLines');
    const lbl3 = document.getElementById('kpiAnsweredRateLbl');
    const val3 = document.getElementById('kpiAnsweredRate');
    const lbl4 = document.getElementById('kpiCard4Lbl');
    const val4 = document.getElementById('kpiAvgDuration');

    const smsCamps = (this.allCampaigns || []).filter(c => c.type === 'sms_only');

    let totalSent = 0;
    let totalPending = 0;
    let totalFailed = 0;

    smsCamps.forEach(c => {
      const cTotal = Number(c.total_leads || c.total_leads_count || 0);
      const cSent = Number(c.completed_leads || c.completed_leads_count || 0);
      totalSent += cSent;
      totalPending += Math.max(0, cTotal - cSent);
    });

    const totalProcessed = totalSent + totalFailed;
    const rateStr = totalProcessed > 0 ? ((totalSent / totalProcessed) * 100).toFixed(1) + '%' : '100.0%';

    // Update dedicated SMS view KPI cards
    const dActive = document.getElementById('smsKpiActiveCamps');
    if (dActive) dActive.textContent = smsCamps.length;
    const dSent = document.getElementById('smsKpiTotalSent');
    if (dSent) dSent.textContent = totalSent;
    const dPending = document.getElementById('smsKpiPending');
    if (dPending) dPending.textContent = totalPending;
    const dRate = document.getElementById('smsKpiDeliveryRate');
    if (dRate) dRate.textContent = rateStr;

    if (lbl1) lbl1.textContent = 'Active SMS Campaigns';
    if (val1) val1.textContent = smsCamps.length;
    if (lbl2) lbl2.textContent = 'Total SMS Sent';
    if (val2) val2.textContent = totalSent;
    if (lbl3) lbl3.textContent = 'Pending SMS';
    if (val3) val3.textContent = totalPending;
    if (lbl4) lbl4.textContent = 'Delivery Rate';
    if (val4) val4.textContent = rateStr;
  }

  updateVoiceKpiCards() {
    if (this.campaignViewMode === 'sms') return;

    const lbl1 = document.getElementById('kpiCard1Lbl');
    const lbl2 = document.getElementById('kpiCard2Lbl');
    const lbl3 = document.getElementById('kpiAnsweredRateLbl');
    const lbl4 = document.getElementById('kpiCard4Lbl');

    if (lbl1) lbl1.textContent = 'Active calls now';
    if (lbl2) lbl2.textContent = 'Available lines';
    if (lbl3) lbl3.textContent = 'Answered rate';
    if (lbl4) lbl4.textContent = 'Average call duration';

    if (this._lastTelephonyMetrics) {
      this.updateTelephonyKpiCards(this._lastTelephonyMetrics);
    }
  }

  /* ─────────────────────────────────────────────────────────
     SMS Messenger & Live Queue Workspace Engine
     ───────────────────────────────────────────────────────── */
  async loadSmsDispatcherScreen(preferredCampId = null) {
    try {
      if (!this.allCampaigns || this.allCampaigns.length === 0) {
        await this.loadCampaignsOverview();
      }

      const smsCamps = (this.allCampaigns || []).filter(c => c.type === 'sms_only');
      const dropdown = document.getElementById('smsDispatcherCampaignDropdown');

      if (dropdown) {
        if (smsCamps.length === 0) {
          dropdown.innerHTML = '<option value="">No SMS campaigns found. Click "+ New SMS Campaign"</option>';
        } else {
          dropdown.innerHTML = smsCamps.map(c => {
            const total = Number(c.total_leads || c.total_leads_count || 0);
            const sent = Number(c.completed_leads || c.completed_leads_count || 0);
            const pending = Math.max(0, total - sent);
            return `<option value="${c.id}">${this.escapeHtml(c.name)} (${pending} pending / ${total} total)</option>`;
          }).join('');
        }
      }

      // Determine active SMS campaign
      let targetId = preferredCampId ? Number(preferredCampId) : null;
      if (!targetId && this.activeSmsCampaignId) {
        if (smsCamps.some(c => Number(c.id) === Number(this.activeSmsCampaignId))) {
          targetId = Number(this.activeSmsCampaignId);
        }
      }
      if (!targetId && smsCamps.length > 0) {
        targetId = Number(smsCamps[0].id);
      }

      this.activeSmsCampaignId = targetId;
      if (dropdown && targetId) {
        dropdown.value = String(targetId);
      }

      this.updateSmsKpiCards();

      if (!targetId) {
        this.renderSmsActiveMessageConsole(null);
        this.renderSmsQueueTable();
        this.syncSmsControlButtons();
        this.updateSmsNextScheduledTimer();
        return;
      }

      // Fetch campaign data and leads for this SMS campaign
      const res = await fetch(`api.php?action=get_campaign_data&campaign_id=${targetId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load campaign data');

      this.syncServerClock(data);
      this.activeSmsCampaign = data.campaign;
      this.smsLeads = data.leads || [];

      // Update info badges in the top card
      const senderBadge = document.getElementById('smsCampSenderIdBadge');
      if (senderBadge) senderBadge.textContent = this.activeSmsCampaign?.sms_sender_id || 'SkyConnect';

      const stratBadge = document.getElementById('smsCampStrategyBadge');
      if (stratBadge) {
        const strat = this.activeSmsCampaign?.schedule_strategy || 'auto_schedule';
        const mins = this.activeSmsCampaign?.schedule_interval_mins || 5;
        stratBadge.textContent = strat === 'immediate' ? 'Immediate Blast' : `Auto-Schedule (${mins}m)`;
      }

      this.renderSmsActiveMessageConsole();
      this.renderSmsQueueTable();

      // Restore dispatcher running/paused state based on backend campaign status
      const campStatus = (this.activeSmsCampaign?.status || '').toLowerCase();
      if (campStatus === 'running') {
        this.isSmsDispatcherRunning = true;
        this.isSmsDispatcherPaused = false;
      } else if (campStatus === 'paused') {
        this.isSmsDispatcherRunning = true;
        this.isSmsDispatcherPaused = true;
      } else {
        this.isSmsDispatcherRunning = false;
        this.isSmsDispatcherPaused = false;
      }

      this.syncSmsControlButtons();
      this.startSmsCountdownTick();
    } catch (err) {
      console.warn('loadSmsDispatcherScreen error:', err);
      this.showToast('Could not load SMS campaign data', 'error');
    }
  }

  handleSmsDispatcherCampaignChange(campId) {
    const id = Number(campId);
    if (!id) return;
    if (this.isSmsDispatcherRunning) {
      this.stopSmsDispatcher();
    }
    this.activeSmsCampaignId = id;
    this.activeSmsLead = null;
    this.loadSmsDispatcherScreen(id);
    const camp = (this.allCampaigns || []).find(c => Number(c.id) === id);
    if (camp) {
      this.showToast(`Active SMS campaign set to: ${camp.name}`, 'info');
    }
  }

  syncSmsControlButtons() {
    const btnLaunch = document.getElementById('btnLaunchSmsDispatcher');
    const btnPause = document.getElementById('btnPauseSmsDispatcher');
    const btnStop = document.getElementById('btnStopSmsDispatcher');
    const pauseLabel = document.getElementById('btnPauseSmsLabel');
    const dot = document.getElementById('smsDispatcherStatusDot');

    if (!btnLaunch || !btnPause || !btnStop) return;

    if (this.isSmsDispatcherRunning && !this.isSmsDispatcherPaused) {
      btnLaunch.disabled = true;
      btnLaunch.style.opacity = '0.55';
      btnLaunch.style.cursor = 'not-allowed';

      btnPause.disabled = false;
      btnPause.style.opacity = '1';
      btnPause.style.cursor = 'pointer';
      btnPause.className = 'btn btn-sm btn-warning';
      if (pauseLabel) pauseLabel.textContent = 'Pause';

      btnStop.disabled = false;
      btnStop.style.opacity = '1';
      btnStop.style.cursor = 'pointer';

      if (dot) {
        dot.style.background = '#00A651';
        dot.className = 'dot live-pulse';
      }
    } else if (this.isSmsDispatcherPaused) {
      btnLaunch.disabled = true;
      btnLaunch.style.opacity = '0.55';
      btnLaunch.style.cursor = 'not-allowed';

      btnPause.disabled = false;
      btnPause.style.opacity = '1';
      btnPause.style.cursor = 'pointer';
      btnPause.className = 'btn btn-sm btn-success';
      if (pauseLabel) pauseLabel.textContent = 'Resume';

      btnStop.disabled = false;
      btnStop.style.opacity = '1';
      btnStop.style.cursor = 'pointer';

      if (dot) {
        dot.style.background = '#eab308';
        dot.className = 'dot';
      }
    } else {
      btnLaunch.disabled = false;
      btnLaunch.style.opacity = '1';
      btnLaunch.style.cursor = 'pointer';

      btnPause.disabled = true;
      btnPause.style.opacity = '0.55';
      btnPause.style.cursor = 'not-allowed';
      btnPause.className = 'btn btn-sm btn-warning';
      if (pauseLabel) pauseLabel.textContent = 'Pause';

      btnStop.disabled = true;
      btnStop.style.opacity = '0.55';
      btnStop.style.cursor = 'not-allowed';

      if (dot) {
        dot.style.background = '#64748b';
        dot.className = 'dot';
      }
    }
  }

  async startSmsDispatcher() {
    const leads = this.smsLeads || [];
    const pending = leads.filter(l => (l.status || '').toLowerCase() === 'pending');
    if (pending.length === 0) {
      this.showToast('No pending contacts in this SMS campaign queue!', 'warning');
      return;
    }

    this.isSmsDispatcherRunning = true;
    this.isSmsDispatcherPaused = false;
    this.syncSmsControlButtons();

    const campId = Number(this.activeSmsCampaignId || this.activeSmsCampaign?.id);
    if (campId) {
      const fd = new FormData();
      fd.append('campaign_id', campId);
      fd.append('status', 'running');
      try {
        await fetch('api.php?action=set_campaign_status', { method: 'POST', body: fd });
      } catch (e) {}
      if (this.activeSmsCampaign) this.activeSmsCampaign.status = 'running';
    }

    const statusText = document.getElementById('smsQueueStatusText');
    if (statusText) {
      statusText.innerHTML = `<strong style="color:#00A651;">ACTIVE</strong> &middot; Monitoring scheduled send times (${pending.length} pending)`;
    }

    this.showToast('SMS Campaign launched! Monitoring scheduled times for automatic sending...', 'success');
    this.startSmsCountdownTick();

    // Check if any contacts are already due right now
    this.checkAndDispatchDueSms();
  }

  togglePauseSmsDispatcher() {
    if (!this.isSmsDispatcherRunning && !this.isSmsDispatcherPaused) {
      this.showToast('Campaign is not running. Click Launch first.', 'warning');
      return;
    }

    this.isSmsDispatcherPaused = !this.isSmsDispatcherPaused;
    if (!this.isSmsDispatcherPaused) {
      this.isSmsDispatcherRunning = true;
    }
    this.syncSmsControlButtons();

    const campId = Number(this.activeSmsCampaignId || this.activeSmsCampaign?.id);
    const newStatus = this.isSmsDispatcherPaused ? 'paused' : 'running';
    if (campId) {
      const fd = new FormData();
      fd.append('campaign_id', campId);
      fd.append('status', newStatus);
      fetch('api.php?action=set_campaign_status', { method: 'POST', body: fd }).catch(() => {});
      if (this.activeSmsCampaign) this.activeSmsCampaign.status = newStatus;
    }

    const statusText = document.getElementById('smsQueueStatusText');
    const pendingCount = (this.smsLeads || []).filter(l => (l.status || '').toLowerCase() === 'pending').length;

    if (this.isSmsDispatcherPaused) {
      if (statusText) {
        statusText.innerHTML = `<strong style="color:#eab308;">PAUSED</strong> &middot; Automated sending suspended (${pendingCount} pending)`;
      }
      this.updateSmsNextScheduledTimer();
      this.showToast('SMS Dispatcher paused', 'warning');
    } else {
      if (statusText) {
        statusText.innerHTML = `<strong style="color:#00A651;">ACTIVE</strong> &middot; Monitoring scheduled send times (${pendingCount} pending)`;
      }
      this.updateSmsNextScheduledTimer();
      this.showToast('SMS Dispatcher resumed', 'info');
      this.checkAndDispatchDueSms();
    }
  }

  stopSmsDispatcher() {
    this.isSmsDispatcherRunning = false;
    this.isSmsDispatcherPaused = false;
    this.syncSmsControlButtons();

    const campId = Number(this.activeSmsCampaignId || this.activeSmsCampaign?.id);
    if (campId) {
      const fd = new FormData();
      fd.append('campaign_id', campId);
      fd.append('status', 'idle');
      fetch('api.php?action=set_campaign_status', { method: 'POST', body: fd }).catch(() => {});
      if (this.activeSmsCampaign) this.activeSmsCampaign.status = 'idle';
    }

    const statusText = document.getElementById('smsQueueStatusText');
    const total = (this.smsLeads || []).length;
    const pending = (this.smsLeads || []).filter(l => (l.status || '').toLowerCase() === 'pending').length;
    const sent = total - pending;

    if (statusText) {
      statusText.innerHTML = `<strong style="color:#64748b;">STOPPED</strong> &middot; ${total} contacts in queue (${sent} sent, ${pending} pending)`;
    }

    this.updateSmsNextScheduledTimer();
    this.showToast('SMS Dispatcher stopped', 'info');
  }

  startSmsCountdownTick() {
    if (this._smsCountdownTimer) {
      clearInterval(this._smsCountdownTimer);
      this._smsCountdownTimer = null;
    }

    // Tick every 1 second
    this._smsCountdownTimer = setInterval(() => {
      this.updateSmsNextScheduledTimer();
    }, 1000);

    // Initial immediate update
    this.updateSmsNextScheduledTimer();
  }

  updateSmsNextScheduledTimer() {
    const leads = this.smsLeads || [];
    const pending = leads.filter(l => (l.status || '').toLowerCase() === 'pending');

    const nameEl = document.getElementById('smsNextTimerContact');
    const timeEl = document.getElementById('smsNextTimerTime');
    const badge = document.getElementById('smsNextCountdownBadge');
    const banner = document.getElementById('smsNextScheduledTimerBanner');
    if (!badge) return;

    if (pending.length === 0) {
      if (nameEl) nameEl.textContent = 'All Completed';
      if (timeEl) timeEl.textContent = '';
      badge.textContent = 'Completed';
      badge.style.background = '#64748b';
      if (banner) {
        banner.style.background = '#f8fafc';
        banner.style.borderColor = '#cbd5e1';
      }

      if (this.isSmsDispatcherRunning) {
        this.stopSmsDispatcher();
        this.showToast('All contacts in this campaign have been reached!', 'success');
      }
      return;
    }

    // Sort pending leads by scheduled timestamp (earliest first)
    const sorted = [...pending].sort((a, b) => {
      const aTs = this.getLeadScheduledTimestamp(a);
      const bTs = this.getLeadScheduledTimestamp(b);
      return (aTs || 0) - (bTs || 0);
    });

    const next = sorted[0];
    const targetTs = this.getLeadScheduledTimestamp(next);
    const schedInfo = this.getLeadScheduleInfo(next);
    const now = this.getServerNow();
    const isImmediate = (!next.call_time || this.isImmediateCallTime(next.call_time));
    const isFuture = (!isImmediate && targetTs > now);
    const isPastDue = (!isImmediate && targetTs > 0 && now >= targetTs + 60 * 1000);
    const isDue = (!isImmediate && targetTs > 0 && now >= targetTs && !isPastDue);

    if (nameEl) {
      nameEl.textContent = `${next.customer_name || 'Contact'} (${next.phone_number})`;
    }
    if (timeEl) {
      timeEl.textContent = schedInfo.displayTime || schedInfo.badgeText || next.call_time || 'Immediate';
    }

    let countdownStr = '';
    if (isFuture) {
      const diffSec = Math.max(0, Math.ceil((targetTs - now) / 1000));
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      const s = diffSec % 60;
      if (h > 0) {
        countdownStr = `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
      } else {
        countdownStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      }
    }

    if (this.isSmsDispatcherPaused) {
      if (banner) {
        banner.style.background = '#fefce8';
        banner.style.borderColor = '#fde047';
      }
      if (isImmediate) {
        badge.textContent = 'Ready (Paused)';
        badge.style.background = '#eab308';
      } else if (isPastDue) {
        badge.textContent = 'Past Due (Paused)';
        badge.style.background = '#eab308';
      } else if (isDue) {
        badge.textContent = 'Due (Paused)';
        badge.style.background = '#eab308';
      } else if (isFuture) {
        badge.textContent = `in ${countdownStr} (Paused)`;
        badge.style.background = '#eab308';
      }
    } else if (!this.isSmsDispatcherRunning) {
      if (banner) {
        banner.style.background = isPastDue ? '#fff7ed' : '#f8fafc';
        banner.style.borderColor = isPastDue ? '#fed7aa' : '#cbd5e1';
      }
      if (isImmediate) {
        badge.textContent = 'Idle (Stopped)';
        badge.style.background = '#64748b';
      } else if (isPastDue) {
        badge.textContent = 'Past Due (Stopped)';
        badge.style.background = '#64748b';
      } else if (isDue) {
        badge.textContent = 'Due (Stopped)';
        badge.style.background = '#64748b';
      } else if (isFuture) {
        badge.textContent = `in ${countdownStr} (Stopped)`;
        badge.style.background = '#64748b';
      }
    } else {
      if (banner) {
        banner.style.background = isPastDue ? '#fff7ed' : '#f0fdf4';
        banner.style.borderColor = isPastDue ? '#fed7aa' : '#86efac';
      }
      if (isImmediate) {
        badge.textContent = 'Ready Now';
        badge.style.background = '#00A651';
      } else if (isPastDue) {
        badge.textContent = 'Past Due (Ready)';
        badge.style.background = '#c2410c';
      } else if (isDue) {
        badge.textContent = 'Due Now';
        badge.style.background = '#00A651';
      } else if (isFuture) {
        badge.textContent = `in ${countdownStr}`;
        badge.style.background = '#15803d';
      }
    }

    // If dispatcher is running and contact is due (or immediate or past due), trigger automated dispatch
    if (this.isSmsDispatcherRunning && !this.isSmsDispatcherPaused) {
      if (isDue || isImmediate || isPastDue) {
        this.checkAndDispatchDueSms();
      }
    }
  }

  renderSmsActiveMessageConsole(overrideLead = undefined) {
    const leads = this.smsLeads || [];
    const pendingLeads = leads.filter(l => (l.status || '').toLowerCase() === 'pending');

    if (overrideLead !== undefined) {
      this.activeSmsLead = overrideLead;
    } else if (!this.activeSmsLead || !leads.some(l => Number(l.id) === Number(this.activeSmsLead.id))) {
      this.activeSmsLead = pendingLeads.length > 0 ? pendingLeads[0] : (leads.length > 0 ? leads[0] : null);
    }

    const nameEl = document.getElementById('smsNextCustName');
    const phoneEl = document.getElementById('smsNextPhoneText');
    const statusBadge = document.getElementById('smsNextStatusBadge');
    const timeEl = document.getElementById('smsNextScheduledTimeText');
    const acctEl = document.getElementById('smsNextAccountText');
    const campEl = document.getElementById('smsNextCampaignText');
    const tierTag = document.getElementById('smsNextTierTag');
    const bubbleEl = document.getElementById('smsNextMessageBubble');
    const countEl = document.getElementById('smsNextCharCount');
    const queueStatusText = document.getElementById('smsQueueStatusText');

    const totalCount = leads.length;
    const sentCount = leads.filter(l => (l.status || '').toLowerCase() === 'completed').length;
    const pendingCount = pendingLeads.length;

    if (queueStatusText && !this.isSmsDispatcherRunning) {
      queueStatusText.innerHTML = `Ready &middot; ${totalCount} contact${totalCount === 1 ? '' : 's'} in queue (${sentCount} sent, ${pendingCount} pending)`;
    }

    if (!this.activeSmsLead) {
      if (nameEl) nameEl.textContent = 'Queue Empty';
      if (phoneEl) phoneEl.textContent = '-';
      if (statusBadge) { statusBadge.textContent = 'All Completed'; statusBadge.className = 'dial-badge-gray'; }
      if (timeEl) timeEl.innerHTML = '<span>-</span>';
      if (acctEl) acctEl.textContent = '-';
      if (campEl) campEl.textContent = this.activeSmsCampaign?.name || '-';
      if (bubbleEl) bubbleEl.innerHTML = 'All scheduled messages for this campaign have been dispatched. Upload new numbers or select another campaign to continue.';
      if (countEl) countEl.textContent = '0 / 160 characters (0 SMS)';
      const btnSend = document.getElementById('btnSmsSendNext');
      if (btnSend) btnSend.disabled = true;
      return;
    }

    const lead = this.activeSmsLead;
    const btnSend = document.getElementById('btnSmsSendNext');
    if (btnSend) btnSend.disabled = false;

    if (nameEl) nameEl.textContent = lead.customer_name || 'Contact';
    if (phoneEl) phoneEl.textContent = lead.phone_number || '-';

    const isPending = (lead.status || '').toLowerCase() === 'pending';
    const isCompleted = (lead.status || '').toLowerCase() === 'completed';
    const schedInfo = this.getLeadScheduleInfo(lead);
    const isPastDue = isPending && (this.isLeadPastDue(lead) || schedInfo.type === 'past_due');
    const isDue = !isPastDue && this.isLeadDueForCall(lead);

    if (statusBadge) {
      if (isCompleted) {
        statusBadge.textContent = 'Delivered';
        statusBadge.className = 'dial-badge-gray';
        statusBadge.style.cssText = 'background:#e8f8ee;color:#00A651;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;';
      } else if (isPastDue) {
        statusBadge.textContent = 'Past Due';
        statusBadge.className = '';
        statusBadge.style.cssText = 'background:#fff7ed;color:#c2410c;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;border:1px solid #fed7aa;box-shadow:0 1px 2px rgba(194,65,12,0.06);';
      } else if (isPending) {
        statusBadge.textContent = 'Scheduled';
        statusBadge.className = 'dial-badge-mint';
        statusBadge.style.cssText = '';
      } else {
        statusBadge.textContent = lead.status;
        statusBadge.className = 'dial-badge-gray';
        statusBadge.style.cssText = '';
      }
    }

    if (timeEl) {
      const color = isDue ? '#166534' : '#0284c7';
      const badge = isDue ? '<span style="background:#dcfce7;color:#166534;font-size:10px;padding:2px 6px;border-radius:4px;font-weight:700;">Ready Now</span>' : '';
      const schedDisplay = schedInfo.displayTime || schedInfo.formatted || schedInfo.badgeText || (lead.call_time && !this.isImmediateCallTime(lead.call_time) ? lead.call_time : 'Immediate');
      timeEl.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
        <span style="color:${color};">${this.escapeHtml(schedDisplay)}</span>
        ${badge}
      `;
    }

    const refNum = lead.account_number || (lead.id ? `REF-${lead.id}` : '-');
    if (acctEl) acctEl.textContent = refNum;
    const campName = this.activeSmsCampaign?.name || lead.campaign_name || 'Campaign';
    if (campEl) campEl.textContent = campName;
    if (tierTag) tierTag.textContent = lead.priority || 'Standard Priority';

    // Live personalized message template preview
    const rawTemplate = (this.activeSmsCampaign?.sms_template || 'Hello {name}, this is an important message regarding your {campaign} update.').trim();
    const cName = lead.customer_name || 'Customer';
    const cPhone = lead.phone_number || '';

    const previewData = {
      name: cName,
      phone: cPhone,
      campaign: campName,
      account: refNum,
      call_time: lead.call_time
    };

    const rendered = this.renderSmsTemplate(rawTemplate, previewData);
    const highlighted = this.renderSmsTemplateHighlighted(rawTemplate, previewData);

    if (bubbleEl) {
      bubbleEl.innerHTML = `&ldquo;${highlighted.html.replace(/\n/g, '<br>')}&rdquo;`;
    }

    if (countEl) {
      const len = rendered.length;
      const segments = Math.ceil(len / 160) || 1;
      countEl.textContent = `${len} / 160 characters (${segments} SMS segment${segments > 1 ? 's' : ''})`;
    }
  }

  renderSmsQueueTable() {
    const tbody = document.getElementById('smsQueueTableBody');
    const badge = document.getElementById('smsQueueTableCountBadge');
    const showMoreWrap = document.getElementById('smsQueueShowMoreWrap');
    if (!tbody) return;

    let leads = this.smsLeads || [];
    const totalCount = leads.length;
    const sentCount = leads.filter(l => (l.status || '').toLowerCase() === 'completed').length;
    const pendingCount = leads.filter(l => (l.status || '').toLowerCase() === 'pending').length;
    const pastDueCount = leads.filter(l => (l.status || '').toLowerCase() === 'pending' && (this.isLeadPastDue(l) || this.getLeadScheduleInfo(l).type === 'past_due')).length;

    if (badge) {
      const pastDueText = pastDueCount > 0 ? `, ${pastDueCount} past due` : '';
      badge.textContent = `${totalCount} contacts (${sentCount} sent, ${pendingCount} pending${pastDueText})`;
    }

    // Apply Search Filter
    if (this._smsSearchFilter) {
      const q = this._smsSearchFilter.toLowerCase();
      leads = leads.filter(l =>
        (l.customer_name || '').toLowerCase().includes(q) ||
        (l.phone_number || '').includes(q) ||
        (l.account_number || '').toLowerCase().includes(q)
      );
    }

    // Apply Status Filter
    if (this._smsStatusFilter && this._smsStatusFilter !== 'all') {
      if (this._smsStatusFilter === 'past_due') {
        leads = leads.filter(l => (l.status || '').toLowerCase() === 'pending' && (this.isLeadPastDue(l) || this.getLeadScheduleInfo(l).type === 'past_due'));
      } else if (this._smsStatusFilter === 'pending') {
        leads = leads.filter(l => (l.status || '').toLowerCase() === 'pending');
      } else {
        leads = leads.filter(l => (l.status || '').toLowerCase() === this._smsStatusFilter);
      }
    }

    if (leads.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;font-size:13px;">
            No contacts match the filter. Add contacts or adjust search.
          </td>
        </tr>
      `;
      if (showMoreWrap) showMoreWrap.style.display = 'none';
      return;
    }

    const limit = this._smsPageLimit || 20;
    const visibleLeads = leads.slice(0, limit);

    const rawTemplate = (this.activeSmsCampaign?.sms_template || 'Hello {name}, this is an important message regarding your {campaign} update.').trim();
    const campName = this.activeSmsCampaign?.name || 'Campaign';

    tbody.innerHTML = visibleLeads.map((l, idx) => {
      const isPending = (l.status || '').toLowerCase() === 'pending';
      const isCompleted = (l.status || '').toLowerCase() === 'completed';
      const schedInfo = this.getLeadScheduleInfo(l);
      const isPastDue = isPending && (this.isLeadPastDue(l) || schedInfo.type === 'past_due');
      const isDue = !isPastDue && this.isLeadDueForCall(l);

      const statusBadge = isCompleted
        ? '<span style="background:#e8f8ee;color:#00A651;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;display:inline-block;">Sent</span>'
        : (isPastDue
          ? '<span style="background:#fff7ed;color:#c2410c;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;border:1px solid #fed7aa;box-shadow:0 1px 2px rgba(194,65,12,0.06);" title="Scheduled send time has passed"><span style="width:6px;height:6px;border-radius:50%;background:#f97316;display:inline-block;"></span>Past Due</span>'
          : (isPending
            ? '<span style="background:#f1f5f9;color:#475569;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;display:inline-block;">Pending</span>'
            : '<span style="background:#fee2e2;color:#ef4444;font-size:11px;font-weight:700;padding:3px 9px;border-radius:12px;display:inline-block;">Failed</span>'));

      const schedDisplay = schedInfo.displayTime || schedInfo.formatted || schedInfo.badgeText || (l.call_time && !this.isImmediateCallTime(l.call_time) ? l.call_time : 'Immediate');
      const schedColor = isDue ? '#166534' : '#475569';

      const cName = l.customer_name || 'Customer';
      const cPhone = l.phone_number || '';
      const refNum = l.account_number || ('REF-' + l.id);

      const msgPreview = this.renderSmsTemplate(rawTemplate, {
        name: cName,
        phone: cPhone,
        campaign: campName,
        account: refNum,
        call_time: l.call_time
      });

      const isCurrentActive = this.activeSmsLead && Number(this.activeSmsLead.id) === Number(l.id);
      const rowBg = isCurrentActive ? 'background:#f0fdf4;' : '';

      return `
        <tr style="${rowBg}transition:background 0.15s;cursor:pointer;" onclick="app.previewSmsLead(${l.id})">
          <td style="color:#94a3b8;font-size:12px;vertical-align:middle;">${idx + 1}</td>
          <td style="font-weight:700;color:#0f172a;font-size:13.5px;vertical-align:middle;">${this.escapeHtml(cName)}</td>
          <td style="color:#00A651;font-weight:600;font-size:13px;vertical-align:middle;">${this.escapeHtml(cPhone)}</td>
          <td style="vertical-align:middle;">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:${schedColor};">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>${this.escapeHtml(schedDisplay)}</span>
              ${isDue && isPending ? '<span style="background:#dcfce7;color:#166534;font-size:9.5px;padding:1px 5px;border-radius:4px;font-weight:700;">Ready</span>' : ''}
            </div>
          </td>
          <td style="vertical-align:middle;">${statusBadge}</td>
          <td style="color:#64748b;font-size:12px;vertical-align:middle;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${this.escapeHtml(msgPreview)}">
            ${this.escapeHtml(msgPreview)}
          </td>
          <td style="text-align:right;vertical-align:middle;white-space:nowrap;">
            ${isPending ? `<button type="button" class="btn btn-xs btn-success" style="padding:4px 10px;font-size:11.5px;font-weight:700;background:#00A651;border:none;margin-right:6px;" onclick="event.stopPropagation(); app.sendSingleSmsLead(${l.id})">Send SMS</button>` : ''}
            <button type="button" class="btn btn-xs btn-outline-danger" style="padding:4px 8px;font-size:11px;" onclick="event.stopPropagation(); app.deleteLead(${l.id})" title="Delete Contact">Delete</button>
          </td>
        </tr>
      `;
    }).join('');

    if (showMoreWrap) {
      if (leads.length > limit) {
        showMoreWrap.style.display = 'block';
        const remaining = leads.length - limit;
        const btnMore = document.getElementById('btnSmsQueueShowMore');
        if (btnMore) btnMore.textContent = `Show ${remaining} more contacts`;
      } else {
        showMoreWrap.style.display = 'none';
      }
    }
  }

  previewSmsLead(leadId) {
    const lead = (this.smsLeads || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    this.activeSmsLead = lead;
    this.renderSmsActiveMessageConsole(lead);
    this.renderSmsQueueTable();
  }

  async handleSmsSendCurrentContact() {
    if (!this.activeSmsLead) {
      this.showToast('No active contact selected to send SMS', 'warning');
      return;
    }

    const lead = this.activeSmsLead;
    const btn = document.getElementById('btnSmsSendNext');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<span>Sending...</span>';
    }

    try {
      const rawTemplate = (this.activeSmsCampaign?.sms_template || 'Hello {name}, thank you for choosing {campaign}.').trim();
      const campName = this.activeSmsCampaign?.name || 'Campaign';
      const cName = lead.customer_name || 'Customer';
      const cPhone = lead.phone_number || '';
      const refNum = lead.account_number || ('REF-' + lead.id);

      const msg = this.renderSmsTemplate(rawTemplate, {
        name: cName,
        phone: cPhone,
        campaign: campName,
        account: refNum,
        call_time: lead.call_time
      });

      const fd = new FormData();
      fd.append('phone_number', cPhone);
      fd.append('message', msg);
      fd.append('lead_id', lead.id);
      fd.append('campaign_id', this.activeSmsCampaignId || lead.campaign_id);
      fd.append('customer_name', cName);
      fd.append('sender_id', this.activeSmsCampaign?.sms_sender_id || 'SkyConnect');

      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();

      if (data && data.success) {
        this.showToast(`SMS sent successfully to ${cName} (${cPhone})`, 'success');
        lead.status = 'completed';
        if (this.activeSmsCampaign) {
          this.activeSmsCampaign.completed_leads = Number(this.activeSmsCampaign.completed_leads || 0) + 1;
        }

        // Advance to next pending lead
        const nextPending = (this.smsLeads || []).find(l => Number(l.id) !== Number(lead.id) && (l.status || '').toLowerCase() === 'pending');
        this.activeSmsLead = nextPending || null;

        this.renderSmsActiveMessageConsole();
        this.renderSmsQueueTable();
        this.updateSmsKpiCards();
      } else {
        this.showToast(data?.error || 'Failed to deliver SMS', 'error');
      }
    } catch (e) {
      this.showToast('Network error while dispatching SMS', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
          <span>Send SMS Now</span>
        `;
      }
    }
  }

  async sendSingleSmsLead(leadId) {
    const lead = (this.smsLeads || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    this.previewSmsLead(leadId);
    await this.handleSmsSendCurrentContact();
  }

  handleSmsSkipClick() {
    const leads = this.smsLeads || [];
    if (leads.length === 0) return;
    const curIdx = this.activeSmsLead ? leads.findIndex(l => Number(l.id) === Number(this.activeSmsLead.id)) : -1;
    const nextIdx = (curIdx + 1) % leads.length;
    this.activeSmsLead = leads[nextIdx];
    this.renderSmsActiveMessageConsole(this.activeSmsLead);
    this.renderSmsQueueTable();
    this.showToast(`Previewing: ${this.activeSmsLead.customer_name}`, 'info');
  }

  handleSmsSaveNextClick() {
    const leads = this.smsLeads || [];
    const pendingLeads = leads.filter(l => (l.status || '').toLowerCase() === 'pending');
    if (pendingLeads.length === 0) {
      this.showToast('No more pending contacts in queue', 'info');
      return;
    }
    const curIdx = this.activeSmsLead ? pendingLeads.findIndex(l => Number(l.id) === Number(this.activeSmsLead.id)) : -1;
    const nextIdx = (curIdx + 1) % pendingLeads.length;
    this.activeSmsLead = pendingLeads[nextIdx];
    this.renderSmsActiveMessageConsole(this.activeSmsLead);
    this.renderSmsQueueTable();
  }

  filterSmsQueueTable(query) {
    this._smsSearchFilter = query;
    this.renderSmsQueueTable();
  }

  filterSmsQueueStatus(status) {
    this._smsStatusFilter = status;
    this.renderSmsQueueTable();
  }

  showMoreSmsContacts() {
    this._smsPageLimit = (this._smsPageLimit || 20) + 30;
    this.renderSmsQueueTable();
  }

  exportSmsQueueCsv() {
    const leads = this.smsLeads || [];
    if (leads.length === 0) {
      this.showToast('No contacts to export', 'warning');
      return;
    }

    const campName = this.activeSmsCampaign?.name || 'SMS_Campaign';
    const rawTemplate = (this.activeSmsCampaign?.sms_template || '').trim();

    let csv = 'ID,Customer Name,Phone Number,Scheduled Time,Status,Message\n';
    leads.forEach(l => {
      const cName = (l.customer_name || '').replace(/"/g, '""');
      const cPhone = l.phone_number || '';
      const cTime = (l.call_time || 'Immediate').replace(/"/g, '""');
      const cStatus = l.status || 'pending';
      const refNum = l.account_number || ('REF-' + l.id);
      const msg = rawTemplate
        .replace(/\{name\}|\{customer_name\}/gi, l.customer_name || 'Customer')
        .replace(/\{phone\}|\{phone_number\}/gi, cPhone)
        .replace(/\{campaign\}|\{campaign_name\}/gi, campName)
        .replace(/\{account\}|\{account_number\}/gi, refNum)
        .replace(/"/g, '""');

      csv += `"${l.id}","${cName}","${cPhone}","${cTime}","${cStatus}","${msg}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${campName.replace(/[^a-zA-Z0-9_-]/g, '_')}_contacts.csv`;
    link.click();
    URL.revokeObjectURL(url);
    this.showToast('SMS contacts exported successfully!', 'success');
  }

  async dispatchSmsCampaignPrompt() {
    const targetId = Number(this.activeSmsCampaignId || this.activeCampaignId || this.campaign?.id);
    if (!targetId) {
      this.showToast('Please select an SMS campaign first', 'warning');
      return;
    }
    const camp = (this.allCampaigns || []).find(c => Number(c.id) === targetId);
    const campName = camp?.name || 'this campaign';
    if (!confirm(`Are you sure you want to dispatch all pending SMS messages for "${campName}"?`)) {
      return;
    }
    await this.dispatchSmsCampaign(targetId);
    await this.loadSmsDispatcherScreen(targetId);
  }

  /* ─────────────────────────────────────────────────────────
     SMS Modals: Create, Add Contacts, Edit Template
     ───────────────────────────────────────────────────────── */
  openNewSmsCampaignModal() {
    const form = document.getElementById('formNewSmsCampaign');
    if (form) form.reset();
    const countEl = document.getElementById('newSmsModalCharCount');
    if (countEl) countEl.textContent = '80 / 160 (1 SMS)';
    this.openModal('modalNewSmsCampaign');
  }

  handleNewSmsStrategyChange(strat) {
    const intvRow = document.getElementById('newSmsModalIntervalRow');
    const dtRow = document.getElementById('newSmsModalDateTimeRow');
    if (intvRow) intvRow.style.display = (strat === 'immediate') ? 'none' : 'block';
    if (dtRow) dtRow.style.display = strat === 'scheduled_date' ? 'block' : 'none';
  }

  updateNewSmsCharCount(text) {
    const countEl = document.getElementById('newSmsModalCharCount');
    if (!countEl) return;
    const len = (text || '').length;
    const segs = Math.ceil(len / 160) || 1;
    countEl.textContent = `${len} / 160 (${segs} SMS)`;
  }

  insertTagToNewSmsTemplate(tag) {
    const ta = document.getElementById('newSmsModalTemplate');
    if (!ta) return;
    const start = ta.selectionStart || ta.value.length;
    const end = ta.selectionEnd || ta.value.length;
    ta.value = ta.value.substring(0, start) + tag + ta.value.substring(end);
    ta.focus();
    this.updateNewSmsCharCount(ta.value);
  }

  async handleNewSmsCampaignSubmit(e) {
    if (e) e.preventDefault();
    const name = document.getElementById('newSmsModalCampName')?.value.trim();
    if (!name) {
      this.showToast('Please enter a campaign name', 'error');
      return;
    }

    const senderId = document.getElementById('newSmsModalSenderId')?.value.trim() || 'SkyConnect';
    const strategy = document.getElementById('newSmsModalScheduleStrategy')?.value || 'auto_schedule';
    const intervalMins = document.getElementById('newSmsModalIntervalMins')?.value || '5';
    const startDate = document.getElementById('newSmsModalStartDate')?.value || '';
    const startTime = document.getElementById('newSmsModalStartTime')?.value || '';
    const template = document.getElementById('newSmsModalTemplate')?.value.trim() || 'Hello {name}, this is an important message regarding {campaign}.';
    const fileInput = document.getElementById('newSmsModalFileInput');

    const btn = document.getElementById('btnSubmitNewSmsCamp');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating Campaign...';
    }

    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('type', 'sms_only');
      fd.append('sms_enabled', '1');
      fd.append('sms_sender_id', senderId);
      fd.append('sms_template', template);
      fd.append('calling_method', strategy === 'immediate' ? 'manual' : 'auto_schedule');
      fd.append('schedule_strategy', strategy === 'immediate' ? 'immediate' : 'interval');
      fd.append('schedule_interval_mins', intervalMins);
      if (strategy === 'scheduled_date' && startDate && startTime) {
        fd.append('schedule_start_time', `${startDate} ${startTime}:00`);
      }

      const res = await fetch('api.php?action=create_campaign', { method: 'POST', body: fd });
      const data = await res.json();

      if (!data || !data.success) {
        this.showToast(data?.error || 'Failed to create SMS campaign', 'error');
        return;
      }

      const newCampId = Number(data.campaign_id);

      // If a CSV or text file was attached, upload leads immediately with campaign schedule rules
      if (fileInput && fileInput.files && fileInput.files[0]) {
        const fileFd = new FormData();
        fileFd.append('campaign_id', newCampId);
        fileFd.append('lead_file', fileInput.files[0]);
        fileFd.append('auto_schedule', strategy === 'immediate' ? '0' : '1');
        fileFd.append('schedule_strategy', strategy === 'immediate' ? 'immediate' : 'interval');
        fileFd.append('schedule_interval_mins', intervalMins);
        if (strategy === 'scheduled_date' && startDate && startTime) {
          fileFd.append('schedule_start_time', `${startDate} ${startTime}:00`);
        }
        const upRes = await fetch('api.php?action=upload_leads', { method: 'POST', body: fileFd });
        const upData = await upRes.json();
        if (!upData || !upData.success) {
          this.showToast(upData?.error || 'Campaign created, but initial contacts upload failed', 'warning');
        }
      }

      this.closeModal('modalNewSmsCampaign');
      this.showToast(`SMS Campaign "${name}" created successfully!`, 'success');

      await this.loadCampaignsOverview();
      this.activeSmsCampaignId = newCampId;
      await this.loadSmsDispatcherScreen(newCampId);
    } catch (err) {
      this.showToast('Network error creating SMS campaign', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create SMS Campaign';
      }
    }
  }

  openAddSmsContactsModal() {
    const subtitle = document.getElementById('modalAddSmsCampSubtitle');
    if (subtitle) {
      subtitle.textContent = `Campaign: ${this.activeSmsCampaign?.name || 'Active Campaign'}`;
    }
    const form = document.getElementById('formAddSmsContacts');
    if (form) form.reset();
    this.switchAddSmsMethod('file');
    this.openModal('modalAddSmsContacts');
  }

  switchAddSmsMethod(method) {
    const btnFile = document.getElementById('btnAddSmsMethodFile');
    const btnMan = document.getElementById('btnAddSmsMethodManual');
    const secFile = document.getElementById('addSmsSectionFile');
    const secMan = document.getElementById('addSmsSectionManual');

    if (method === 'file') {
      btnFile?.classList.add('btn-primary');
      btnFile?.classList.remove('btn-outline-secondary');
      btnMan?.classList.remove('btn-primary');
      btnMan?.classList.add('btn-outline-secondary');
      if (secFile) secFile.style.display = 'block';
      if (secMan) secMan.style.display = 'none';
    } else {
      btnMan?.classList.add('btn-primary');
      btnMan?.classList.remove('btn-outline-secondary');
      btnFile?.classList.remove('btn-primary');
      btnFile?.classList.add('btn-outline-secondary');
      if (secMan) secMan.style.display = 'block';
      if (secFile) secFile.style.display = 'none';
    }
  }

  async handleAddSmsContactsSubmit(e) {
    if (e) e.preventDefault();
    const campId = Number(this.activeSmsCampaignId || this.campaign?.id);
    if (!campId) {
      this.showToast('No active SMS campaign selected', 'error');
      return;
    }

    const isFile = document.getElementById('addSmsSectionFile')?.style.display !== 'none';
    const btn = document.getElementById('btnSubmitAddSms');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Importing...';
    }

    try {
      const schedMode = document.getElementById('addSmsSchedulingSelect')?.value || 'auto_stagger';
      const isAutoStagger = (schedMode === 'auto_stagger');

      if (isFile) {
        const fileInput = document.getElementById('addSmsFileInput');
        if (!fileInput || !fileInput.files || !fileInput.files[0]) {
          this.showToast('Please select a file to import', 'warning');
          return;
        }
        const fd = new FormData();
        fd.append('campaign_id', campId);
        fd.append('lead_file', fileInput.files[0]);
        fd.append('auto_schedule', isAutoStagger ? '1' : '0');
        if (!isAutoStagger) fd.append('force_immediate', '1');
        if (this.activeSmsCampaign?.schedule_interval_mins) {
          fd.append('schedule_interval_mins', this.activeSmsCampaign.schedule_interval_mins);
        }
        const res = await fetch('api.php?action=upload_leads', { method: 'POST', body: fd });
        const data = await res.json();
        if (data && data.success) {
          this.showToast(`Imported ${data.imported || 0} contacts!`, 'success');
        } else {
          this.showToast(data?.error || 'Import failed', 'error');
          return;
        }
      } else {
        const text = document.getElementById('addSmsManualText')?.value.trim();
        if (!text) {
          this.showToast('Please enter at least one number', 'warning');
          return;
        }
        const fd = new FormData();
        fd.append('campaign_id', campId);
        fd.append('leads_text', text);
        fd.append('auto_schedule', isAutoStagger ? '1' : '0');
        if (!isAutoStagger) fd.append('force_immediate', '1');
        if (this.activeSmsCampaign?.schedule_interval_mins) {
          fd.append('schedule_interval_mins', this.activeSmsCampaign.schedule_interval_mins);
        }
        const res = await fetch('api.php?action=save_manual_leads', { method: 'POST', body: fd });
        const data = await res.json();
        if (data && data.success) {
          this.showToast(`Added contacts successfully!`, 'success');
        } else {
          this.showToast(data?.error || 'Failed to add contacts', 'error');
          return;
        }
      }

      this.closeModal('modalAddSmsContacts');
      await this.loadCampaignsOverview();
      await this.loadSmsDispatcherScreen(campId);
    } catch (err) {
      this.showToast('Error importing contacts', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Import Numbers';
      }
    }
  }

  openEditSmsTemplateModal() {
    const subtitle = document.getElementById('modalEditSmsSubtitle');
    if (subtitle) {
      subtitle.textContent = `Campaign: ${this.activeSmsCampaign?.name || 'Active Campaign'}`;
    }
    const senderInp = document.getElementById('editSmsSenderId');
    if (senderInp) senderInp.value = this.activeSmsCampaign?.sms_sender_id || 'SkyConnect';
    const templateInp = document.getElementById('editSmsTemplateText');
    if (templateInp) {
      templateInp.value = this.activeSmsCampaign?.sms_template || 'Hello {name}, thank you for choosing {campaign}.';
      this.updateEditSmsCharCount(templateInp.value);
    }
    this.openModal('modalEditSmsTemplate');
  }

  updateEditSmsCharCount(text) {
    const countEl = document.getElementById('editSmsCharCount');
    if (!countEl) return;
    const len = (text || '').length;
    const segs = Math.ceil(len / 160) || 1;
    countEl.textContent = `${len} / 160 (${segs} SMS)`;
  }

  insertTagToEditSmsTemplate(tag) {
    const ta = document.getElementById('editSmsTemplateText');
    if (!ta) return;
    const start = ta.selectionStart || ta.value.length;
    const end = ta.selectionEnd || ta.value.length;
    ta.value = ta.value.substring(0, start) + tag + ta.value.substring(end);
    ta.focus();
    this.updateEditSmsCharCount(ta.value);
  }

  async handleSaveSmsTemplate(e) {
    if (e) e.preventDefault();
    const campId = Number(this.activeSmsCampaignId || this.campaign?.id);
    if (!campId) {
      this.showToast('No active campaign selected', 'error');
      return;
    }

    const sender = document.getElementById('editSmsSenderId')?.value.trim() || 'SkyConnect';
    const template = document.getElementById('editSmsTemplateText')?.value.trim();
    if (!template) {
      this.showToast('Please enter an SMS template', 'warning');
      return;
    }

    const btn = document.getElementById('btnSubmitEditSms');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
    }

    try {
      const fd = new FormData();
      fd.append('campaign_id', campId);
      fd.append('sms_sender_id', sender);
      fd.append('sms_template', template);
      fd.append('sms_enabled', '1');

      const res = await fetch('api.php?action=save_campaign_designer', { method: 'POST', body: fd });
      const data = await res.json();

      if (data && data.success) {
        this.showToast('SMS message template updated!', 'success');
        if (this.activeSmsCampaign) {
          this.activeSmsCampaign.sms_sender_id = sender;
          this.activeSmsCampaign.sms_template = template;
        }
        const camp = (this.allCampaigns || []).find(c => Number(c.id) === campId);
        if (camp) {
          camp.sms_sender_id = sender;
          camp.sms_template = template;
        }
        if (this.campaign && Number(this.campaign.id) === campId) {
          this.campaign.sms_sender_id = sender;
          this.campaign.sms_template = template;
        }
        const senderBadge = document.getElementById('smsCampSenderIdBadge');
        if (senderBadge) senderBadge.textContent = sender;

        const desTpl = document.getElementById('smsDesignerTemplate');
        if (desTpl && Number(this.campaign?.id) === campId) {
          desTpl.value = template;
          this.updateSmsDesignerLivePreview();
        }

        this.closeModal('modalEditSmsTemplate');
        this.renderSmsActiveMessageConsole();
        this.renderSmsQueueTable();
      } else {
        this.showToast(data?.error || 'Failed to update template', 'error');
      }
    } catch (err) {
      this.showToast('Network error updating template', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Save Template';
      }
    }
  }

  async reapplySmsAutoSchedule() {
    const campId = Number(this.activeSmsCampaignId || this.activeCampaignId || this.campaign?.id);
    if (!campId) return;

    const strat = document.getElementById('smsDesignerScheduleStrategy')?.value || this.activeSmsCampaign?.schedule_strategy || 'interval';
    const intv = document.getElementById('smsDesignerScheduleInterval')?.value || this.activeSmsCampaign?.schedule_interval_mins || '5';
    const winStart = document.getElementById('smsDesignerWindowStart')?.value || '09:00';
    const winEnd = document.getElementById('smsDesignerWindowEnd')?.value || '17:00';

    const fd = new FormData();
    fd.append('campaign_id', campId);
    fd.append('schedule_strategy', strat);
    fd.append('schedule_interval_mins', intv);
    fd.append('schedule_window_start', winStart);
    fd.append('schedule_window_end', winEnd);
    fd.append('client_timezone', this.getDialerTimezoneName());

    this.showToast('Re-calculating schedule times for pending contacts...', 'info');
    try {
      const res = await fetch('api.php?action=reschedule_campaign_pending_leads', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(data.message || 'Contacts rescheduled successfully!', 'success');
        if (this.campaignViewMode === 'sms') {
          await this.loadSmsDispatcherScreen(campId);
        } else {
          await this.loadCampaignData(campId);
          this.updateDesignerUI();
          this.renderDesignerContactsTable();
        }
      } else {
        this.showToast(data?.error || 'Failed to reschedule contacts', 'error');
      }
    } catch (e) {
      this.showToast('Network error while rescheduling', 'error');
    }
  }

  async checkAndDispatchDueSms() {
    if (this._isDispatchingDueSms) return;
    if (this._smsAutoSenderDisabled) return;

    let campId = 0;
    if (this.campaignViewMode === 'sms') {
      if (!this.isSmsDispatcherRunning || this.isSmsDispatcherPaused) {
        return;
      }
      if (!this.activeSmsCampaign || this.activeSmsCampaign.type !== 'sms_only') {
        return;
      }
      campId = Number(this.activeSmsCampaignId || this.activeSmsCampaign.id);
    } else {
      if (!this.isRunning || this.isPaused) {
        return;
      }
      if (!this.campaign || this.campaign.type !== 'sms_only' || this.campaign.status !== 'running') {
        return;
      }
      campId = Number(this.activeCampaignId || this.campaign.id);
    }

    if (!campId) return;

    const campLeads = (this.campaignViewMode === 'sms')
      ? (this.smsLeads || []).filter(l => (l.status || '').toLowerCase() === 'pending')
      : (this.leads || []).filter(l => Number(l.campaign_id) === campId && (l.status || '').toLowerCase() === 'pending');

    if (campLeads.length === 0) return;

    const nowMs = this.getServerNow();
    const dueLeads = campLeads.filter(l => {
      if (this.isImmediateCallTime(l.call_time)) return true;
      const targetTs = this.getLeadScheduledTimestamp(l);
      // Never auto-send unparseable scheduled timestamps as immediate
      return targetTs > 0 && nowMs >= targetTs;
    });
    if (dueLeads.length === 0) return;

    this._isDispatchingDueSms = true;
    try {
      const tpl = this.activeSmsCampaign?.sms_template || document.getElementById('smsDesignerTemplate')?.value.trim() || this.campaign?.sms_template || '';
      const sender = this.activeSmsCampaign?.sms_sender_id || document.getElementById('smsDesignerSenderId')?.value.trim() || this.campaign?.sms_sender_id || 'SkyConnect';

      const fd = new FormData();
      fd.append('campaign_id', campId);
      fd.append('only_due', '1');
      fd.append('lead_ids', dueLeads.map(l => Number(l.id)).filter(Boolean).join(','));
      fd.append('template', tpl);
      fd.append('sender_id', sender);

      const res = await fetch('api.php?action=dispatch_sms_campaign', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success && data.sent_count > 0) {
        this.showToast(`Auto-dispatched ${data.sent_count} scheduled SMS message${data.sent_count === 1 ? '' : 's'}`, 'info');
        if (this.campaignViewMode === 'sms') {
          await this.loadSmsDispatcherScreen(campId);
        } else {
          await this.loadCampaignData(campId);
          this.updateDesignerUI();
          this.renderDesignerContactsTable();
        }
      }
    } catch (e) {
      // silent background catch
    } finally {
      this._isDispatchingDueSms = false;
    }
  }

  toggleSmsAutoSender() {
    this._smsAutoSenderDisabled = !this._smsAutoSenderDisabled;
    const btn = document.getElementById('btnToggleSmsAutoSender');
    const badge = document.getElementById('smsDesignerScheduleStatusBadge');
    const dispDot = document.getElementById('smsAutoSenderDot');
    const dispLabel = document.getElementById('smsAutoSenderBtnLabel');

    if (this._smsAutoSenderDisabled) {
      if (btn) {
        btn.textContent = 'Auto-Sender Paused';
        btn.style.background = '#64748b';
      }
      if (dispDot) dispDot.style.background = '#64748b';
      if (dispLabel) dispLabel.textContent = 'Auto-Dispatch: OFF';
      if (badge) {
        badge.textContent = 'Paused';
        badge.style.background = '#fef3c7';
        badge.style.color = '#b45309';
      }
      this.showToast('SMS Auto-Sender paused', 'warning');
    } else {
      if (btn) {
        btn.textContent = 'Auto-Sender Active';
        btn.style.background = '#00A651';
      }
      if (dispDot) dispDot.style.background = '#00A651';
      if (dispLabel) dispLabel.textContent = 'Auto-Dispatch: ON';
      if (badge) {
        badge.textContent = 'Active';
        badge.style.background = '#dcfce7';
        badge.style.color = '#166534';
      }
      this.showToast('SMS Auto-Sender activated: messages will send at scheduled times', 'success');
      this.checkAndDispatchDueSms();
    }
  }

  populateDesignerAudioDropdown() {
    const sel = document.getElementById('designerAudioPromptSelect');
    if (!sel || !this.audioRecordings) return;
    sel.innerHTML = this.audioRecordings.map(a => {
      const isSel = (this.campaign?.ivr_audio_file === a.filepath || this.campaign?.ivr_audio_name === a.name);
      const langLabel = (a.language || 'Amharic').charAt(0).toUpperCase() + (a.language || 'Amharic').slice(1);
      return `<option value="${this.escapeHtml(a.filepath)}" data-name="${this.escapeHtml(a.name)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(a.name)} &middot; ${langLabel}</option>`;
    }).join('');
  }

  handleDesignerAudioChange(audioPath) {
    if (typeof _voicePreviewAudio !== 'undefined' && _voicePreviewAudio) {
      try { _voicePreviewAudio.pause(); } catch(e){}
      _voicePreviewAudio = null;
      const iconSpan = document.getElementById('testAudioPlayIcon');
      const textSpan = document.getElementById('testAudioPlayText');
      const btnPlay = document.getElementById('btnTestVoiceAudio');
      const btnPause = document.getElementById('btnPauseVoiceAudio');
      if (iconSpan) iconSpan.textContent = '▶';
      if (textSpan) textSpan.textContent = 'Test audio';
      if (btnPlay) {
        btnPlay.style.background = '#f0fdf4';
        btnPlay.style.borderColor = '#86efac';
        btnPlay.style.color = '#166534';
      }
      if (btnPause) btnPause.style.display = 'none';
    }

    const sel = document.getElementById('designerAudioPromptSelect');
    const opt = sel?.options[sel.selectedIndex];
    const name = opt?.dataset.name || '';
    if (this.campaign) {
      this.campaign.ivr_audio_file = audioPath;
      this.campaign.ivr_audio_name = name;
      try {
        const fd = new FormData();
        fd.append('campaign_id', this.campaign.id);
        fd.append('audio_file', audioPath);
        fd.append('audio_name', name);
        fetch('api.php?action=save_campaign_designer', { method: 'POST', body: fd }).catch(() => {});
      } catch(e) {}
    }
    const player = document.getElementById('mainAudioPlayer');
    if (player) player.src = audioPath;
  }

  async saveCampaignDesigner() {
    if (!this.campaign) return;
    const txtArea = document.getElementById('campaignMessageText');
    const selAudio = document.getElementById('designerAudioPromptSelect');
    const activeLangBtn = document.querySelector('#langBtnAmharic.active, #langBtnOromifa.active, #langBtnEnglish.active');
    const lang = activeLangBtn ? (activeLangBtn.id.replace('langBtn', '').toLowerCase()) : 'amharic';

    if (txtArea && this.campaign) {
      this.campaign.ivr_message_text = txtArea.value;
    }

    const formData = new FormData();
    formData.append('campaign_id', this.campaign.id);
    formData.append('message_text', txtArea ? txtArea.value : '');
    formData.append('language', lang);
    if (selAudio) {
      formData.append('audio_file', selAudio.value);
      const opt = selAudio.options[selAudio.selectedIndex];
      if (opt) formData.append('audio_name', opt.dataset.name || '');
    }

    const callingMethod = document.getElementById('designerCallingMethodSelect')?.value;
    if (callingMethod) formData.append('calling_method', callingMethod);
    const strat = document.getElementById('designerScheduleStrategy')?.value;
    if (strat) formData.append('schedule_strategy', strat);
    const intv = document.getElementById('designerScheduleInterval')?.value;
    if (intv) formData.append('schedule_interval_mins', intv);
    const winStart = document.getElementById('designerWindowStart')?.value;
    if (winStart) formData.append('schedule_window_start', winStart);
    const winEnd = document.getElementById('designerWindowEnd')?.value;
    if (winEnd) formData.append('schedule_window_end', winEnd);
    const batchSize = document.getElementById('designerBatchSize')?.value;
    if (batchSize) formData.append('schedule_batch_size', batchSize);

    // Save SMS Follow-up settings
    const smsEnabled = document.getElementById('designerSmsEnabled')?.checked ? 1 : 0;
    const smsTrigger = document.getElementById('designerSmsTrigger')?.value || 'call_completed';
    const smsTemplate = document.getElementById('designerSmsTemplate')?.value || '';
    const smsSenderId = document.getElementById('designerSmsSenderId')?.value || 'SkyConnect';
    formData.append('sms_enabled', smsEnabled);
    formData.append('sms_trigger', smsTrigger);
    formData.append('sms_template', smsTemplate);
    formData.append('sms_sender_id', smsSenderId);

    if (this.campaign) {
      this.campaign.sms_enabled = smsEnabled;
      this.campaign.sms_trigger = smsTrigger;
      this.campaign.sms_template = smsTemplate;
      this.campaign.sms_sender_id = smsSenderId;
    }

    try {
      const res = await fetch('api.php?action=save_campaign_designer', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.showToast('Campaign IVR template and voice settings saved to PostgreSQL!', 'success');
        this.loadCampaignsOverview();
      } else {
        this.showToast(data.error || 'Failed to save settings', 'error');
      }
    } catch (e) {
      this.showToast('Network error saving campaign settings', 'error');
    }
  }

  async handleCreateCampaign(e) {
    e.preventDefault();
    const name = document.getElementById('newCampaignNameInput')?.value.trim();
    const type = document.getElementById('newCampaignTypeSelect')?.value;
    const mode = document.getElementById('newCampaignModeSelect')?.value;
    const callerId = document.getElementById('newCampaignCallerIdSelect')?.value;

    if (!name) {
      this.showToast('Please enter a campaign name', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('type', mode || type || 'agentless');
    formData.append('caller_id_number', callerId || '+251911002233');
    formData.append('language', 'amharic');

    try {
      const res = await fetch('api.php?action=create_campaign', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Campaign "${name}" created in PostgreSQL!`, 'success');
        await this.loadCampaignsOverview();
        await this.selectCampaignForDesigner(data.campaign_id);
      } else {
        this.showToast(data.error || 'Failed to create campaign', 'error');
      }
    } catch (err) {
      this.showToast('Error creating campaign', 'error');
    }
  }

  async toggleCampaignLaunch() {
    if (!this.campaign) return;
    const newStatus = (this.campaign.status === 'running') ? 'paused' : 'running';

    const formData = new FormData();
    formData.append('campaign_id', this.campaign.id);
    formData.append('status', newStatus);

    try {
      const res = await fetch('api.php?action=set_campaign_status', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.campaign.status = newStatus;
        this.isRunning = (newStatus === 'running');
        this.isPaused = (newStatus === 'paused');
        this.syncDialerControlButtons();
        this.renderCampaignHeader();
        this.updateDesignerUI();
        this.loadCampaignsOverview();

        if (this.isRunning && !this.isPaused) {
          this.startSchedulerLoop();
          this.processOutboundQueue();
        } else {
          this.stopSchedulerLoop();
        }
      }
    } catch (e) {
      this.showToast('Error updating campaign status', 'error');
    }
  }

  renderAgentScreen() {
    const leads = this.leads || [];
    const pendingLeads = leads.filter(l => l.status === 'pending');
    if (!this.activeLead || !leads.some(l => Number(l.id) === Number(this.activeLead.id))) {
      this.activeLead = pendingLeads.length > 0 ? pendingLeads[0] : (leads.length > 0 ? leads[0] : null);
    }

    const nameEl = document.getElementById('agentScreenCustName');
    const phoneEl = document.getElementById('agentScreenPhoneText');
    const statusBadge = document.getElementById('agentScreenStatusBadge');
    const acctEl = document.getElementById('agentScreenAccountText');
    const timeEl = document.getElementById('agentScreenCallTimeText');
    const campEl = document.getElementById('agentScreenCampaignText');
    const langTag = document.getElementById('agentScreenLangTag');
    const tierTag = document.getElementById('agentScreenTierTag');
    const scriptBox = document.getElementById('agentDynamicScriptBox');
    const qCountTag = document.getElementById('agentQueueStatusTag');
    const queueStatusText = document.getElementById('agentQueueStatusText');

    if (queueStatusText) {
      const stateLabel = this.isRunning ? (this.isPaused ? 'Paused' : 'Active') : 'Ready';
      queueStatusText.innerHTML = `${stateLabel} &middot; ${pendingLeads.length} lead${pendingLeads.length === 1 ? '' : 's'} in queue`;
    }

    if (qCountTag) {
      qCountTag.textContent = `${pendingLeads.length} Leads in Queue`;
      qCountTag.style.background = pendingLeads.length > 0 ? '#00A651' : '#64748b';
    }

    if (!this.activeLead) {
      if (nameEl) nameEl.textContent = 'Queue Empty';
      if (phoneEl) phoneEl.textContent = '-';
      if (statusBadge) { statusBadge.textContent = 'All Completed'; statusBadge.className = 'dial-badge-gray'; }
      if (acctEl) acctEl.textContent = '-';
      if (timeEl) timeEl.textContent = '-';
      if (campEl) campEl.textContent = this.campaign?.name || 'No active campaign';
      if (scriptBox) {
        scriptBox.innerHTML = 'All scheduled contacts for this campaign have been dialed. Upload new contacts or select another campaign to continue.';
      }
      this.renderAgentScreenNumbers();
      return;
    }

    const lead = this.activeLead;
    if (nameEl) nameEl.textContent = lead.customer_name || 'Contact';
    if (phoneEl) phoneEl.textContent = lead.phone_number || '-';
    if (statusBadge && !this.isAgentCallActive) {
      const isPending = lead.status === 'pending';
      statusBadge.textContent = isPending ? 'Pending Call' : (lead.status === 'completed' ? 'Completed' : lead.status);
      statusBadge.className = isPending ? 'dial-badge-mint' : 'dial-badge-gray';
    }
    const dialBtn = document.getElementById('btnAgentDial');
    if (dialBtn && !this.isAgentCallActive) {
      dialBtn.textContent = 'Dial';
      dialBtn.classList.remove('in-call');
    }

    const refNum = lead.account_number || (lead.id ? `REF-${lead.id}` : '-');
    if (acctEl) acctEl.textContent = refNum;
    const dueTimeStr = lead.call_time || 'Immediate';
    if (timeEl) timeEl.textContent = dueTimeStr;
    const campName = lead.campaign_name || this.campaign?.name || 'Campaign';
    if (campEl) campEl.textContent = campName;

    const leadLang = (lead.language || this.campaign?.ivr_language || 'english').toLowerCase();
    if (langTag) {
      langTag.textContent = leadLang.charAt(0).toUpperCase() + leadLang.slice(1);
    }
    if (tierTag) {
      tierTag.textContent = lead.priority || 'Standard';
    }

    // Dynamic Script configured specifically for this campaign
    if (scriptBox) {
      const cName = lead.customer_name || 'Contact';
      // Read campaign-specific script configured in Campaign Designer
      const campScript = (lead.ivr_message_text || this.campaign?.ivr_message_text || this.campaign?.agent_script || '').trim();

      if (campScript) {
        let rendered = campScript
          .replace(/\{customer_name\}|\{name\}/gi, `<strong>${this.escapeHtml(cName)}</strong>`)
          .replace(/\{phone_number\}|\{phone\}/gi, `<strong>${this.escapeHtml(lead.phone_number || '')}</strong>`)
          .replace(/\{account_number\}|\{account\}/gi, `<strong>${this.escapeHtml(refNum)}</strong>`)
          .replace(/\{campaign_name\}|\{campaign\}/gi, `<strong>${this.escapeHtml(campName)}</strong>`);
        scriptBox.innerHTML = `&ldquo;${rendered.replace(/\n/g, '<br>')}&rdquo;`;
      } else {
        scriptBox.innerHTML = `&ldquo;Hello <strong>${this.escapeHtml(cName)}</strong>: I am calling regarding your ${this.escapeHtml(campName)} update. Do you have a moment to speak?&rdquo;`;
      }
    }

    this.renderAgentScreenNumbers();
  }

  renderAgentScreenNumbers() {
    const tbody = document.getElementById('agentNumbersTableBody');
    const badge = document.getElementById('agentQueueNumberCountBadge');
    if (!tbody) return;

    const leads = this.leads || [];
    const pendingLeads = leads.filter(l => l.status === 'pending');
    if (badge) {
      badge.textContent = `${pendingLeads.length} pending / ${leads.length} total`;
    }

    if (leads.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:#94a3b8;font-size:13px;">
            No contacts found in this campaign. Upload contacts or select a different campaign.
          </td>
        </tr>
      `;
      return;
    }

    const searchFilter = (this._agentSearchFilter || '').toLowerCase().trim();
    const filteredLeads = searchFilter
      ? leads.filter(l => (l.customer_name || '').toLowerCase().includes(searchFilter) || (l.phone_number || '').includes(searchFilter))
      : leads;

    tbody.innerHTML = filteredLeads.map((l, idx) => {
      const isSelected = this.activeLead && Number(this.activeLead.id) === Number(l.id);
      const isPending = l.status === 'pending';
      const statusBadge = isPending
        ? '<span style="background:#e0f2fe;color:#0369a1;font-weight:700;font-size:11px;padding:3px 8px;border-radius:12px;">Pending</span>'
        : (l.status === 'completed' || l.status === 'answered'
          ? '<span style="background:#dcfce7;color:#15803d;font-weight:700;font-size:11px;padding:3px 8px;border-radius:12px;">Completed</span>'
          : `<span style="background:#f1f5f9;color:#475569;font-weight:600;font-size:11px;padding:3px 8px;border-radius:12px;text-transform:capitalize;">${this.escapeHtml(l.status)}</span>`);

      const rowBg = isSelected ? '#f0fdf4' : (idx % 2 === 0 ? '#ffffff' : '#f8fafc');
      const rowBorder = isSelected ? 'border-left: 3px solid #00A651;' : '';

      const refStr = l.account_number || (l.id ? `REF-${l.id}` : '-');
      const timeStr = l.call_time || 'Immediate';

      return `
        <tr style="background:${rowBg};${rowBorder}transition:background 0.15s ease;">
          <td style="font-weight:600;color:#64748b;font-size:12px;padding:10px 12px;">${idx + 1}</td>
          <td style="font-weight:700;color:#0f172a;font-size:12.5px;padding:10px 12px;">
            ${this.escapeHtml(l.customer_name || 'Contact')}
            ${isSelected ? '<span style="color:#00A651;font-size:11px;margin-left:6px;font-weight:700;">(Selected for Preview)</span>' : ''}
          </td>
          <td style="font-family:monospace;color:#334155;font-size:12px;padding:10px 12px;font-weight:600;">${this.escapeHtml(l.phone_number || '')}</td>
          <td style="color:#475569;font-size:12px;padding:10px 12px;font-family:monospace;">${this.escapeHtml(refStr)}</td>
          <td style="color:#64748b;font-size:12px;padding:10px 12px;">${this.escapeHtml(timeStr)}</td>
          <td style="padding:10px 12px;">${statusBadge}</td>
          <td style="text-align:right;padding:10px 12px;white-space:nowrap;">
            <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.selectLeadForPreview(${l.id})" style="font-size:11px;padding:3px 9px;margin-right:6px;border-radius:4px;cursor:pointer;">
              Preview
            </button>
            <button type="button" class="btn btn-xs btn-success" onclick="app.callLeadDirectly(${l.id})" style="font-size:11px;padding:3px 10px;background:#00A651;border-color:#00A651;color:#fff;border-radius:4px;font-weight:700;cursor:pointer;">
              Call
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  selectLeadForPreview(leadId) {
    if (this.isAgentCallActive) {
      this.hangupAgentCall(false);
    }
    const lead = (this.leads || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    this.activeLead = lead;
    this.renderAgentScreen();
    this.showToast(`Previewing: ${lead.customer_name} (${lead.phone_number})`, 'info');
  }

  callLeadDirectly(leadId) {
    const lead = (this.leads || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    this.activeLead = lead;
    this.renderAgentScreen();
    this.handleAgentDialClick();
  }

  filterAgentScreenNumbers(query) {
    this._agentSearchFilter = query;
    this.renderAgentScreenNumbers();
  }

  async refreshAgentScreenQueue() {
    await this.loadCampaignData();
    this.showToast('Calling queue refreshed', 'info');
  }

  selectAgentOutcome(labelEl, dispo) {
    document.querySelectorAll('#dialOutcomeList .dial-outcome-opt').forEach(opt => {
      opt.classList.remove('active');
      const r = opt.querySelector('.dial-radio-circle');
      if (r) r.classList.remove('checked');
      const t = opt.querySelector('.dial-outcome-text');
      if (t) t.classList.remove('active');
    });
    if (labelEl) {
      labelEl.classList.add('active');
      const r = labelEl.querySelector('.dial-radio-circle');
      if (r) r.classList.add('checked');
      const t = labelEl.querySelector('.dial-outcome-text');
      if (t) t.classList.add('active');
    }
    this.selectedDispo = dispo;
    this.showToast(`Outcome selected: ${dispo.replace(/_/g, ' ').toUpperCase()}`, 'info');
  }

  toggleAgentCheck(item) {
    if (!item) return;
    const box = item.querySelector('.dial-check-box');
    if (!box) return;
    const isChecked = box.classList.contains('checked');
    if (isChecked) {
      box.classList.remove('checked');
      box.innerHTML = '';
    } else {
      box.classList.add('checked');
      box.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    }
  }

  selectAgentDispo(btn, dispo) {
    this.selectAgentOutcome(btn, dispo);
  }

  handleAgentDialClick() {
    if (this.isAgentCallActive) {
      this.hangupAgentCall();
      return;
    }
    if (!this.activeLead || !this.activeLead.phone_number) {
      this.showToast('No customer selected to dial', 'warning');
      return;
    }
    this.originateAgentDirectCall(this.activeLead);
  }

  hangupAgentCall(showNotice = true) {
    this.sipHangup(1);
    this.isAgentCallActive = false;
    if (this.agentCallTimerInterval) {
      clearInterval(this.agentCallTimerInterval);
      this.agentCallTimerInterval = null;
    }
    this.stopRingbackTone();

    const btn = document.getElementById('btnAgentDial');
    if (btn) {
      btn.textContent = 'Dial';
      btn.classList.remove('in-call');
    }

    const badge = document.getElementById('agentScreenStatusBadge');
    if (badge) {
      badge.textContent = 'Call Ended';
      badge.className = 'dial-badge-gray';
    }

    if (this.activeLead) {
      this.activeLead.status = 'completed';
      this.renderAgentScreenNumbers();
    }

    if (showNotice) {
      this.showToast(`Call ended (${this.lastCallDuration || 0}s). Select outcome and click Save & next.`, 'info');
    }
  }

  originateAgentDirectCall(lead) {
    if (!lead || !lead.phone_number) {
      this.showToast('No customer phone number available', 'warning');
      return;
    }

    if (this.isAgentCallActive) {
      this.hangupAgentCall(false);
    }

    const normNumber = window.skykinNormalizeEtDial(lead.phone_number);
    this.isAgentCallActive = true;
    let callSec = 0;
    this.lastCallDuration = 0;
    if (this.agentCallTimerInterval) {
      clearInterval(this.agentCallTimerInterval);
      this.agentCallTimerInterval = null;
    }

    lead.status = 'calling';
    this.renderAgentScreenNumbers();

    const btn = document.getElementById('btnAgentDial');
    if (btn) {
      btn.textContent = 'Calling... (Hang Up)';
      btn.classList.add('in-call');
    }

    const badge = document.getElementById('agentScreenStatusBadge');
    if (badge) {
      badge.textContent = 'Dialing...';
      badge.className = 'dial-badge-mint';
    }

    this.showToast(`Calling ${lead.customer_name || 'Customer'} (${lead.phone_number}) directly...`, 'info');

    const updateTimer = () => {
      const m = String(Math.floor(callSec / 60)).padStart(2, '0');
      const s = String(callSec % 60).padStart(2, '0');
      if (btn && this.isAgentCallActive) {
        btn.textContent = `Hang Up (${m}:${s})`;
      }
      if (badge && this.isAgentCallActive) {
        badge.textContent = `In Call (${m}:${s})`;
      }
    };

    const dom = localStorage.getItem('sip_domain') || this.sipDomain || 'client1.skykin.local';

    if (this.line1 && this.line1.ua && this.line1.isRegistered) {
      this.sipMakeCall(normNumber, dom, {
        onEstablishing: () => {
          if (badge) {
            badge.textContent = 'Ringing...';
            badge.className = 'dial-badge-mint';
          }
          if (btn && this.isAgentCallActive) {
            btn.textContent = 'Ringing... (Hang Up)';
          }
        },
        onEstablished: (pc) => {
          this.showToast(`Connected to ${lead.customer_name || 'Customer'} (${lead.phone_number})`, 'success');
          if (this.agentCallTimerInterval) clearInterval(this.agentCallTimerInterval);
          this.agentCallTimerInterval = setInterval(() => {
            callSec++;
            this.lastCallDuration = callSec;
            updateTimer();
          }, 1000);
        },
        onTerminated: () => {
          this.hangupAgentCall(true);
        },
        onError: (err) => {
          this.hangupAgentCall(false);
          this.showToast('Call error: ' + (err?.message || 'Call failed'), 'error');
        },
        onReject: (resp) => {
          this.hangupAgentCall(false);
          this.showToast('Call declined or busy: ' + (resp?.reasonPhrase || 'Busy'), 'warning');
        }
      }, 1);
    } else {
      if (badge) badge.textContent = 'Ringing...';
      if (btn) btn.textContent = 'Ringing... (Hang Up)';
      this.startRingbackTone();

      setTimeout(() => {
        if (!this.isAgentCallActive) return;
        this.stopRingbackTone();
        this.showToast(`Connected to ${lead.customer_name || 'Customer'} (${lead.phone_number})`, 'success');
        if (this.agentCallTimerInterval) clearInterval(this.agentCallTimerInterval);
        this.agentCallTimerInterval = setInterval(() => {
          callSec++;
          this.lastCallDuration = callSec;
          updateTimer();
        }, 1000);
      }, 2000);
    }
  }

  async handleAgentSkipClick() {
    if (this.isAgentCallActive) {
      this.hangupAgentCall(false);
    }
    if (!this.activeLead) {
      this.showToast('No more leads to skip', 'warning');
      return;
    }
    this.showToast(`Skipped ${this.activeLead.customer_name}. Fetching next lead...`, 'warning');
    const currentIdx = this.leads.findIndex(l => l.id === this.activeLead.id);
    const remainingPending = this.leads.slice(currentIdx + 1).filter(l => l.status === 'pending');
    if (remainingPending.length > 0) {
      this.activeLead = remainingPending[0];
    } else {
      const anyPending = this.leads.filter(l => l.status === 'pending' && l.id !== this.activeLead.id);
      this.activeLead = anyPending.length > 0 ? anyPending[0] : null;
    }
    this.renderAgentScreen();
  }

  async handleAgentSaveNextClick() {
    if (this.isAgentCallActive) {
      this.hangupAgentCall(false);
    }
    if (!this.activeLead) {
      this.showToast('No active contact to save', 'warning');
      return;
    }

    const dispo = this.selectedDispo || 'fixed';
    const notes = document.getElementById('agentCallNotesInput')?.value || '';
    const promiseDate = document.getElementById('agentPromiseDateSelect')?.value || '';
    const duration = parseInt(this.lastCallDuration || 35, 10);

    const formData = new FormData();
    formData.append('lead_id', this.activeLead.id);
    formData.append('campaign_id', this.campaign?.id || 1);
    const sendSms = document.getElementById('agentSendSmsOnSave')?.checked ? '1' : '0';
    formData.append('send_sms', sendSms);
    formData.append('disposition', dispo);
    formData.append('promise_date', promiseDate);
    formData.append('notes', notes);
    formData.append('duration_sec', duration);

    try {
      const res = await fetch('api.php?action=save_agent_outcome', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Outcome recorded to PostgreSQL! Connecting next call...`, 'success');

        const notesInput = document.getElementById('agentCallNotesInput');
        if (notesInput) notesInput.value = '';

        const tag = document.getElementById('agentNextCallCountdownTag');
        if (tag) {
          let count = 5;
          tag.textContent = `Next call in ${count}s`;
          const timer = setInterval(() => {
            count--;
            if (count > 0) {
              tag.textContent = `Next call in ${count}s`;
            } else {
              clearInterval(timer);
              tag.textContent = 'Ready';
            }
          }, 1000);
        }

        if (data.next_lead) {
          this.activeLead = data.next_lead;
        } else {
          const remaining = this.leads.filter(l => l.status === 'pending' && l.id !== this.activeLead.id);
          this.activeLead = remaining.length > 0 ? remaining[0] : null;
        }

        await this.loadCampaignData();

        if (this.pacingMode === 'progressive' && this.activeLead && this.activeLead.status === 'pending') {
          this.showToast(`Progressive mode: auto-dialing next contact (${this.activeLead.customer_name}) in 3s...`, 'info');
          setTimeout(() => {
            if (this.pacingMode === 'progressive' && this.activeLead) {
              this.handleAgentDialClick();
            }
          }, 3000);
        }
      } else {
        this.showToast(data.error || 'Failed to save outcome', 'error');
      }
    } catch (e) {
      this.showToast('Network error saving outcome', 'error');
    }
  }

  async setPacingMode(mode) {
    if (mode !== 'preview' && mode !== 'progressive') {
      mode = 'preview';
    }
    this.pacingMode = mode;

    const btnPrev = document.getElementById('btnPacingPreview');
    const btnProg = document.getElementById('btnPacingProgressive');

    if (btnPrev) btnPrev.className = (mode === 'preview') ? 'dial-seg-btn active-green' : 'dial-seg-btn';
    if (btnProg) btnProg.className = (mode === 'progressive') ? 'dial-seg-btn active-green' : 'dial-seg-btn';

    const pacingSelect = document.getElementById('pacingModeSelect');
    if (pacingSelect) pacingSelect.value = mode;

    await this.savePacingSetting('pacing_mode', mode);
    this.renderAgentScreen();
  }

  /* ─────────────────────────────────────────────────────────
     Pacing & Regulatory Compliance Engine
     ───────────────────────────────────────────────────────── */
  async savePacingSetting(key, val) {
    const campId = this.campaign?.id || (this.selectedCampaignIds && this.selectedCampaignIds.length > 0 ? this.selectedCampaignIds[0] : 1);
    const formData = new FormData();
    formData.append('campaign_id', campId);
    formData.append(key, val);

    if (key === 'dial_ratio') {
      this.dialRatio = parseFloat(val);
      const disp = document.getElementById('dialRatioVal');
      if (disp) disp.textContent = parseFloat(val).toFixed(1);
    } else if (key === 'max_abandon_rate') {
      this.maxAbandonRate = parseFloat(val);
      const disp = document.getElementById('abandonRateVal');
      if (disp) disp.textContent = parseFloat(val).toFixed(1) + '%';
      this.checkAbandonCompliance();
    } else if (key === 'calling_hours') {
      this.callingHours = val;
    } else if (key === 'max_attempts') {
      this.maxAttempts = parseInt(val, 10);
    } else if (key === 'retry_after') {
      this.retryAfter = val;
    }

    try {
      const res = await fetch('api.php?action=save_pacing_settings', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        if (this.campaign) {
          if (key === 'dial_ratio') this.campaign.dial_ratio = parseFloat(val);
          if (key === 'max_abandon_rate') this.campaign.max_abandon_rate = parseFloat(val);
          if (key === 'calling_hours') this.campaign.calling_hours = val;
          if (key === 'max_attempts') this.campaign.max_retries = parseInt(val, 10);
          if (key === 'retry_after') this.campaign.retry_delay_min = data.retry_delay_min || 120;
          if (key === 'pacing_mode') this.campaign.type = val;
        }

        const msgs = {
          'dial_ratio': 'Dial ratio set to ' + parseFloat(val).toFixed(1) + 'x (concurrency adjusted)',
          'max_abandon_rate': 'Compliance cap set: max ' + parseFloat(val).toFixed(1) + '% abandon rate',
          'calling_hours': 'Calling hours set to ' + val.replace('_', ' ') + ' (compliance active)',
          'max_attempts': 'Max attempts set to ' + val + ' per contact',
          'retry_after': 'Retry callback delay set to ' + val,
          'pacing_mode': 'Dialing mode: ' + (val === 'progressive' ? 'Progressive (Auto-dialing)' : 'Preview (Manual click)')
        };
        this.showToast(msgs[key] || 'Pacing setting saved successfully', 'success');
      } else {
        this.showToast(data.error || 'Failed to save pacing setting', 'error');
      }
    } catch (e) {
      this.showToast('Network error saving pacing setting', 'error');
    }
  }

  renderPacingAndComplianceSettings() {
    const camp = this.campaign || {};

    // 1. Dialing mode
    const mode = camp.type || this.pacingMode || 'preview';
    this.pacingMode = mode;
    const modeSel = document.getElementById('pacingModeSelect');
    if (modeSel) modeSel.value = (mode === 'progressive') ? 'progressive' : 'preview';
    const btnPrev = document.getElementById('btnPacingPreview');
    const btnProg = document.getElementById('btnPacingProgressive');
    if (btnPrev) btnPrev.className = (mode === 'preview') ? 'dial-seg-btn active-green' : 'dial-seg-btn';
    if (btnProg) btnProg.className = (mode === 'progressive') ? 'dial-seg-btn active-green' : 'dial-seg-btn';

    // 2. Dial ratio
    const ratio = parseFloat(camp.dial_ratio || this.dialRatio || 2.1);
    this.dialRatio = ratio;
    const ratioSlider = document.getElementById('pacingDialRatioSlider');
    const ratioDisp = document.getElementById('dialRatioVal');
    if (ratioSlider) ratioSlider.value = ratio.toFixed(1);
    if (ratioDisp) ratioDisp.textContent = ratio.toFixed(1);

    // 3. Max abandon rate
    const abandon = parseFloat(camp.max_abandon_rate || this.maxAbandonRate || 2.4);
    this.maxAbandonRate = abandon;
    const abandonSlider = document.getElementById('pacingMaxAbandonSlider');
    const abandonDisp = document.getElementById('abandonRateVal');
    if (abandonSlider) abandonSlider.value = abandon.toFixed(1);
    if (abandonDisp) abandonDisp.textContent = abandon.toFixed(1) + '%';

    // 4. Calling hours
    const hours = camp.calling_hours || this.callingHours || 'standard';
    this.callingHours = hours;
    const hoursSel = document.getElementById('pacingCallingHoursSelect');
    if (hoursSel) hoursSel.value = hours;

    // 5. Max attempts
    const attempts = String(camp.max_retries || this.maxAttempts || 3);
    this.maxAttempts = parseInt(attempts, 10);
    const attemptsSel = document.getElementById('pacingMaxAttemptsSelect');
    if (attemptsSel) attemptsSel.value = attempts;

    // 6. Retry after
    const retryMin = parseInt(camp.retry_delay_min || 120, 10);
    let retryKey = '2h';
    if (retryMin <= 30) retryKey = '30m';
    else if (retryMin <= 60) retryKey = '1h';
    else if (retryMin <= 120) retryKey = '2h';
    else if (retryMin <= 240) retryKey = '4h';
    else retryKey = '24h';
    this.retryAfter = retryKey;
    const retrySel = document.getElementById('pacingRetryAfterSelect');
    if (retrySel) retrySel.value = retryKey;

    // 7. Update live metrics & chart
    this.updateTelephonyKpiCards();
    this.renderPacingChart(this.recentLogs || []);
    this.checkAbandonCompliance();
  }

  checkCallingHoursCompliance() {
    return { allowed: true, policyText: 'Unrestricted (24/7)' };
  }

  checkAbandonCompliance() {
    const m = this.telephonyMetrics || {};
    const curAbandon = parseFloat(m.abandon_rate || 0.0);
    const maxAllowed = this.maxAbandonRate || 2.4;
    const badge = document.getElementById('pacingAbandonRate');
    if (!badge) return;

    if (curAbandon > maxAllowed) {
      badge.style.color = '#dc2626';
      badge.title = 'Alert: Current abandon rate (' + curAbandon.toFixed(1) + '%) exceeds target cap (' + maxAllowed.toFixed(1) + '%). Pacing throttled.';
    } else {
      badge.style.color = '#00A651';
      badge.title = 'Compliant: Under target cap of ' + maxAllowed.toFixed(1) + '%';
    }
  }

  renderPacingChart(logs = []) {
    const chart = document.getElementById('pacingCallsBarChart');
    if (!chart) return;

    const now = Date.now();
    const bucketDurationMs = 10 * 60 * 1000;
    const buckets = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    logs.forEach(l => {
      const ts = l.timestamp ? new Date(l.timestamp).getTime() : 0;
      if (ts > 0) {
        const diff = now - ts;
        const bucketIdx = Math.floor(diff / bucketDurationMs);
        if (bucketIdx >= 0 && bucketIdx < 10) {
          buckets[9 - bucketIdx]++;
        }
      }
    });

    const maxCount = Math.max(1, ...buckets);
    chart.innerHTML = buckets.map((cnt, i) => {
      const minsAgo = (9 - i) * 10;
      const pct = Math.max(12, Math.round((cnt / maxCount) * 95));
      const isPeak = cnt === maxCount && cnt > 0;
      const title = minsAgo === 0 ? ('Current: ' + cnt + ' calls') : (minsAgo + ' min ago: ' + cnt + ' calls');
      return '<div class="sc-bar ' + (isPeak ? 'highlight' : '') + '" style="height:' + pct + '%;" title="' + title + '"></div>';
    }).join('');
  }

  getTodayLeads() {
    const today = this.serverToday || this.getLocalDateString();
    return this.leads.filter(l => l.is_today || l.effective_date === today || (!l.effective_date && !l.is_past && !l.is_past_day));
  }

  getHistoryLeads() {
    const today = this.serverToday || this.getLocalDateString();
    return (this.leads || []).filter(l => {
      // 1. Any lead that has been dialed / carried out (status is not pending)
      if (l.status && l.status !== 'pending') return true;
      // 2. Any lead from previous days
      if (l.is_past || l.is_past_day || (l.effective_date && l.effective_date < today)) return true;
      return false;
    });
  }

  getPastLeads() {
    return this.getHistoryLeads();
  }

  
  syncDialerControlButtons() {
    if (!this.btnStart || !this.btnPause || !this.btnStop) return;

    if (this.isRunning && !this.isPaused) {
      this.btnStart.disabled = true;
      this.btnPause.disabled = false;
      this.btnPause.textContent = 'Pause';
      this.btnPause.className = 'btn btn-warning';
      this.btnStop.disabled = false;
    } else if (this.isRunning && this.isPaused) {
      this.btnStart.disabled = true;
      this.btnPause.disabled = false;
      this.btnPause.textContent = 'Resume';
      this.btnPause.className = 'btn btn-success';
      this.btnStop.disabled = false;
    } else {
      this.btnStart.disabled = false;
      this.btnPause.disabled = true;
      this.btnPause.textContent = 'Pause';
      this.btnPause.className = 'btn btn-warning';
      this.btnStop.disabled = true;
    }
  }

  renderCampaignHeader() {
    if (!this.campaign) return;
    this.syncDialerControlButtons();
    if (this.campaignTitleText) this.campaignTitleText.textContent = this.campaign.name || 'Outbound Customer Calls';
    
    if (this.campaignStatusTag) {
      this.campaignStatusTag.textContent = this.isRunning ? (this.isPaused ? 'PAUSED' : 'ACTIVE') : 'IDLE';
      this.campaignStatusTag.className = `campaign-status-tag ${this.isRunning ? (this.isPaused ? 'paused' : 'running') : 'idle'}`;
    }

    if (this.activeAudioTitle) {
      this.activeAudioTitle.textContent = this.campaign.ivr_audio_name || (this.audioRecordings?.[0]?.name) || 'Active IVR Audio';
    }

    if (this.audioPlayerElement && this.campaign.ivr_audio_file) {
      this.audioPlayerElement.src = this.campaign.ivr_audio_file;
    }
    if (this.tabAudioPlayer && this.campaign.ivr_audio_file) {
      this.tabAudioPlayer.src = this.campaign.ivr_audio_file;
    }
  }

  renderStats() {
    const todayLeads = this.getTodayLeads();
    const todayTotal = todayLeads.length;
    let todayPending = 0;
    let todayConnected = 0;

    todayLeads.forEach(l => {
      if (l.status === 'pending') todayPending++;
      else if (['answered', 'ivr_playing', 'ivr_completed', 'completed'].includes(l.status)) todayConnected++;
    });

    if (this.kpiTotal) this.kpiTotal.textContent = todayTotal;
    if (this.kpiPending) this.kpiPending.textContent = todayPending;
    if (this.kpiConnected) this.kpiConnected.textContent = todayConnected;
    if (this.kpiAnswerRate) this.kpiAnswerRate.textContent = `${this.stats.answer_rate || 0}%`;
    if (this.kpiAvgDuration) this.kpiAvgDuration.textContent = `${this.stats.avg_duration || 0}s`;

    const badgePending = document.getElementById('badgePendingCount');
    if (badgePending) badgePending.textContent = todayPending;

    const badgeHistory = document.getElementById('badgeHistoryCount');
    if (badgeHistory) badgeHistory.textContent = this.getPastLeads().length;
  }

  updateLocalStats() {
    this.renderStats();
  }

  updateRolloverBanners() {
    const rolloverTag = document.getElementById('historyRolloverCount');
    if (rolloverTag) rolloverTag.textContent = this.remainingCount || 0;

    const btnRollover = document.getElementById('btnHistoryRollover');
    if (btnRollover) {
      btnRollover.style.display = (this.remainingCount > 0) ? 'inline-flex' : 'none';
    }
  }

  renderLeadsTables(search = null, filterStatus = null) {
    const todayLeads = this.getTodayLeads();

    const searchVal = (search !== null && search !== undefined) ? search : (document.getElementById('leadSearchInput')?.value || '');
    const filterVal = (filterStatus !== null && filterStatus !== undefined) ? filterStatus : (document.getElementById('leadStatusFilter')?.value || 'all');
    const query = searchVal.toLowerCase().trim();

    const filtered = todayLeads.filter(l => {
      const matchQuery = !query || 
        (l.customer_name && l.customer_name.toLowerCase().includes(query)) ||
        (l.phone_number && l.phone_number.includes(query)) ||
        (l.account_number && l.account_number.toLowerCase().includes(query));
      const matchStatus = filterVal === 'all' || l.status === filterVal;
      return matchQuery && matchStatus;
    });

    const renderTarget = (tbodyEl, isFull = false) => {
      if (!tbodyEl) return;
      tbodyEl.innerHTML = '';

      if (filtered.length === 0) {
        const colCount = isFull ? 10 : 8;
        const rolloverBtn = this.remainingCount > 0
          ? `<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" onclick="app.bulkRolloverRemainingToToday()">Roll Over ${this.remainingCount} Unanswered Calls from Previous Days</button></div>`
          : '';
        tbodyEl.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center;color:#64748b;padding:28px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">No contacts found matching filter</div>
          <div style="font-size:12px;color:#64748b;">Upload Excel/CSV, quick-add contacts, or adjust search criteria.</div>
          ${rolloverBtn}
        </td></tr>`;
        return;
      }

      filtered.forEach((l, idx) => {
        const tr = document.createElement('tr');
        const isImmediate = this.isImmediateCallTime(l.call_time);
        const targetTs = this.getLeadScheduledTimestamp(l);
        const isFuture = !isImmediate && targetTs > Date.now();
        const isDue = this.isLeadDueForCall(l);
        const stBadge = this.getStatusBadge(l.status, l);
        const callTime = l.call_time || 'Immediate';
        const dur = l.duration_sec ? `${l.duration_sec}s` : '-';

        let timeBadgeHtml = '';
        if (isImmediate) {
          timeBadgeHtml = `<span style="background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;">Immediate</span>`;
        } else if (isFuture) {
          const diffSec = Math.max(0, Math.round((targetTs - Date.now()) / 1000));
          const diffM = Math.floor(diffSec / 60);
          const diffH = Math.floor(diffM / 60);
          const relStr = diffH > 0 ? `in ${diffH}h ${diffM % 60}m` : `in ${diffM}m`;
          timeBadgeHtml = `<span style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;" title="Scheduled call time">${this.escapeHtml(callTime)} <span style="font-size:10px;color:#2563eb;font-weight:600;">(${relStr})</span></span>`;
        } else if (isDue) {
          timeBadgeHtml = `<span style="background:#ecfdf5;color:#15803d;border:1px solid #86efac;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;" title="Scheduled call time - Arrived">${this.escapeHtml(callTime)} <span style="font-size:10px;color:#16a34a;font-weight:600;">(Due Now)</span></span>`;
        } else if (targetTs > 0) {
          timeBadgeHtml = `<span style="background:#fefce8;color:#854d0e;border:1px solid #fef08a;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;" title="Scheduled call time has passed">${this.escapeHtml(callTime)} <span style="font-size:10px;color:#a16207;font-weight:600;">(Past Due)</span></span>`;
        } else {
          timeBadgeHtml = `<span style="background:#f8fafc;color:#475569;border:1px solid #cbd5e1;padding:3px 9px;border-radius:12px;font-size:11px;font-weight:700;" title="Scheduled call time">${this.escapeHtml(callTime)}</span>`;
        }

        const acct = l.account_number ? `<span style="font-family:monospace;background:#f1f5f9;padding:2px 7px;border-radius:4px;font-size:11.5px;color:#0f5132;font-weight:600;">${this.escapeHtml(l.account_number)}</span>` : '<span style="color:#94a3b8;">-</span>';
        const debtAmt = parseFloat(l.debt_amount || 0);
        const curr = l.currency || this.settings?.currency || 'USD';
        const debtFormatted = debtAmt > 0
          ? `<span style="font-weight:700;color:#15803d;font-size:12.5px;">${curr} ${debtAmt.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>`
          : `<span style="color:#64748b;font-size:12px;">-</span>`;

        const campDisplay = l.campaign_name || this.campaign?.name || 'Campaign';
        const campBadge = `<span class="sc-badge running" style="font-size:11px;font-weight:700;padding:2px 8px;white-space:nowrap;" title="Campaign: ${this.escapeHtml(campDisplay)}">${this.escapeHtml(campDisplay)}</span>`;

        if (isFull) {
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
            <td>
              <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" style="color:#00A651;font-weight:700;text-decoration:none;" title="Click to Call with Softphone">
                ${this.escapeHtml(l.phone_number)}
              </a>
            </td>
            <td>${campBadge}</td>
            <td>${timeBadgeHtml}</td>
            <td>${stBadge}</td>
            <td>${dur}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-primary btn-sm" onclick="app.dialSingleLeadWithIvr(${l.id})" title="Outbound Call with IVR">Call</button>
              <button class="btn btn-secondary btn-sm" onclick="app.deleteLead(${l.id})" style="color:#ef4444;margin-left:4px;" title="Delete">Delete</button>
            </td>
          `;
        } else {
          tr.innerHTML = `
            <td>${idx + 1}</td>
            <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
            <td>
              <a href="javascript:void(0)" onclick="app.dialSingleLeadWithIvr(${l.id})" style="color:#00A651;font-weight:700;text-decoration:none;" title="Click to Dial Outbound with IVR">
                ${this.escapeHtml(l.phone_number)}
              </a>
            </td>
            <td>${campBadge}</td>
            <td>${timeBadgeHtml}</td>
            <td>${stBadge}</td>
            <td>${dur}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-primary btn-sm" onclick="app.dialSingleLeadWithIvr(${l.id})" title="Outbound Call with IVR">Call</button>
              <button class="btn btn-secondary btn-sm" onclick="app.deleteLead(${l.id})" style="color:#ef4444;" title="Delete">Delete</button>
            </td>
          `;
        }
        tbodyEl.appendChild(tr);
      });
    };

    renderTarget(this.leadsTableBody, false);
    renderTarget(this.leadsTableBodyFull, true);
  }

  /* ─────────────────────────────────────────────────────────
     History Page & Past Calls Management
     ───────────────────────────────────────────────────────── */
  renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    // Populate History Date Filter Dropdown if not filled
    const dateSelect = document.getElementById('historyDateSelect');
    const today = this.serverToday || this.getLocalDateString();
    if (dateSelect && this.availableDates) {
      const currentSelected = dateSelect.value;
      const pastDates = this.availableDates.filter(d => d !== today);

      let optionsHtml = '<option value="all">All Dates</option><option value="today">Today</option><option value="yesterday">Yesterday</option>';
      pastDates.forEach(d => {
        optionsHtml += `<option value="${d}">${d}</option>`;
      });
      dateSelect.innerHTML = optionsHtml;
      if (currentSelected && (currentSelected === 'all' || currentSelected === 'yesterday' || pastDates.includes(currentSelected))) {
        dateSelect.value = currentSelected;
      }
    }

    const dateFilter = dateSelect?.value || 'all';
    const customDatePicker = document.getElementById('historyCustomDatePicker');
    const customDate = customDatePicker?.value || '';
    const searchInput = document.getElementById('historySearchInput');
    const query = searchInput?.value.toLowerCase().trim() || '';
    const statusFilter = document.getElementById('historyStatusFilter')?.value || 'all';

    const yestDate = this.getLocalDateString(new Date(this.getServerNow() - 86400000));
    const pastLeads = this.getPastLeads();

    const filtered = pastLeads.filter(l => {
      const effDate = l.effective_date || (l.created_at ? l.created_at.split(' ')[0] : '');

      // Date match
      if (customDate) {
        if (effDate !== customDate) return false;
      } else if (dateFilter === 'today') {
        if (effDate !== today) return false;
      } else if (dateFilter === 'yesterday') {
        if (effDate !== yestDate) return false;
      } else if (dateFilter !== 'all') {
        if (effDate !== dateFilter) return false;
      }

      // Search match
      if (query) {
        const matchName = l.customer_name && l.customer_name.toLowerCase().includes(query);
        const matchPhone = l.phone_number && l.phone_number.includes(query);
        if (!matchName && !matchPhone) return false;
      }

      // Status match
      if (statusFilter !== 'all') {
        if (statusFilter === 'answered') {
          if (!['answered', 'ivr_playing', 'ivr_completed', 'completed'].includes(l.status)) return false;
        } else if (l.status !== statusFilter) {
          return false;
        }
      }

      return true;
    });

    const countTag = document.getElementById('historyTotalRecordsTag');
    if (countTag) countTag.textContent = `${filtered.length} records`;

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:28px;">No historical call records found for selected filter.</td></tr>`;
      return;
    }

    filtered.forEach((l, idx) => {
      const tr = document.createElement('tr');
      const stBadge = this.getStatusBadge(l.status);
      const effDate = l.effective_date || (l.created_at ? l.created_at.split(' ')[0] : '-');
      const dur = l.duration_sec ? `${l.duration_sec}s` : '-';
      const callTime = l.call_time || 'Immediate';

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><span style="font-size:11.5px;font-weight:700;color:#00A651;">${this.escapeHtml(effDate)}</span></td>
        <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
        <td>
          <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" style="color:#00A651;font-weight:700;text-decoration:none;" title="Click to Call">
            ${this.escapeHtml(l.phone_number)}
          </a>
        </td>
        <td><span style="font-size:11.5px;color:#334155;">${this.escapeHtml(callTime)}</span></td>
        <td>${stBadge}</td>
        <td>${dur}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="app.openRedialModal(${l.id})" style="margin-right:4px;" title="Redial & Schedule with new date/time">
            Redial
          </button>
          <button class="btn btn-secondary btn-sm" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" title="Instant Call">
            Call
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  handleHistoryDateFilter(val) {
    const customPicker = document.getElementById('historyCustomDatePicker');
    if (customPicker) customPicker.value = '';
    this.renderHistoryTable();
  }

  handleHistoryCustomDate(val) {
    this.renderHistoryTable();
  }

  openRedialModal(leadId) {
    const lead = this.leads.find(l => Number(l.id) === Number(leadId));
    if (!lead) return;

    const idInp = document.getElementById('redialLeadId');
    const nameEl = document.getElementById('redialCustomerName');
    const phoneEl = document.getElementById('redialPhoneNumber');
    const dateInp = document.getElementById('redialDateInput');
    const timeInp = document.getElementById('redialCustomTimeInput');

    if (idInp) idInp.value = lead.id;
    if (nameEl) nameEl.textContent = lead.customer_name || 'Customer';
    if (phoneEl) phoneEl.textContent = lead.phone_number || '';
    
    const today = this.serverToday || this.getLocalDateString();
    if (dateInp) dateInp.value = today;

    const nowParts = this.getZonedDateParts(this.getServerNow());
    const hh = String(nowParts.hour).padStart(2, '0');
    const mm = String(nowParts.minute).padStart(2, '0');
    if (timeInp) timeInp.value = `${hh}:${mm}`;

    this.updateRedialPreview();
    this.openModal('modalRedialSchedule');
  }

  setRedialPreset(preset) {
    const now = new Date();
    let target = new Date();
    let hoursStr = '09:00';

    if (preset === '+15m') {
      target = new Date(now.getTime() + 15 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === '+1h') {
      target = new Date(now.getTime() + 60 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === '+3h') {
      target = new Date(now.getTime() + 180 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === 'tomorrow_am') {
      target = new Date(now.getTime() + 86400000);
      hoursStr = '09:00';
    } else if (preset === 'tomorrow_pm') {
      target = new Date(now.getTime() + 86400000);
      hoursStr = '14:00';
    } else if (preset === '+3days') {
      target = new Date(now.getTime() + 3 * 86400000);
      hoursStr = '10:00';
    }

    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');

    const dateInp = document.getElementById('redialDateInput');
    const timeInp = document.getElementById('redialCustomTimeInput');
    if (dateInp) dateInp.value = `${yyyy}-${mm}-${dd}`;
    if (timeInp) timeInp.value = hoursStr;

    this.updateRedialPreview();
  }

  updateRedialPreview() {
    const previewEl = document.getElementById('redialPreviewText');
    const dateVal = document.getElementById('redialDateInput')?.value;
    const timeVal = document.getElementById('redialCustomTimeInput')?.value || '09:00';

    if (!previewEl) return;
    if (!dateVal) {
      previewEl.textContent = 'Please choose a date from the calendar.';
      return;
    }

    try {
      const dt = new Date(`${dateVal}T${timeVal}`);
      const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      previewEl.textContent = `Redial scheduled for: ${dt.toLocaleDateString('en-US', options)}`;
    } catch (e) {
      previewEl.textContent = `Redial scheduled for: ${dateVal} at ${timeVal}`;
    }
  }

  async handleRedialSubmit(e) {
    if (e) e.preventDefault();
    const leadId = document.getElementById('redialLeadId')?.value;
    const newDate = document.getElementById('redialDateInput')?.value;
    const customTime = document.getElementById('redialCustomTimeInput')?.value || '09:00';

    if (!leadId || !newDate) {
      this.showToast('Please select a date from the calendar.', 'error');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('new_date', newDate);
      formData.append('new_time', customTime);

      const res = await fetch('api.php?action=reschedule_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.closeModal('modalRedialSchedule');
        this.showToast(data.message || 'Lead scheduled for redial', 'success');
        await this.loadCampaignData();
        await this.loadCallbacksList();
      } else {
        this.showToast(data.error || 'Failed to reschedule contact', 'error');
      }
    } catch(err) {
      this.showToast('Error rescheduling contact', 'error');
    }
  }

  async requeueSingleLead(leadId) {
    const formData = new FormData();
    formData.append('lead_id', leadId);
    try {
      const res = await fetch('api.php?action=requeue_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(data.message || 'Lead re-queued into active calling queue', 'success');
        await this.loadCallbacksList();
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to re-queue lead', 'error');
      }
    } catch (e) {
      this.showToast('Network error re-queueing lead', 'error');
    }
  }

  async bulkRolloverRemainingToToday() {
    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      formData.append('target_date', this.serverToday || this.getLocalDateString());
      formData.append('target_time', 'Immediate');

      const res = await fetch('api.php?action=bulk_rollover_to_today', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message, 'success');
        await this.loadCampaignData();
        switchTab('tabLiveRoom');
      } else {
        this.showToast(data.error || 'Rollover failed', 'error');
      }
    } catch (e) {
      this.showToast('Error during bulk rollover', 'error');
    }
  }

  exportHistoryCsv() {
    const pastLeads = this.getPastLeads();
    if (pastLeads.length === 0) {
      this.showToast('No historical records to export.', 'info');
      return;
    }
    let csv = "Date,Customer Name,Phone Number,Scheduled Time,Status,Duration (sec),Notes\n";
    pastLeads.forEach(l => {
      const effDate = l.effective_date || (l.created_at ? l.created_at.split(' ')[0] : '');
      csv += `"${effDate}","${(l.customer_name || '').replace(/"/g, '""')}","${l.phone_number}","${l.call_time || ''}","${l.status}","${l.duration_sec || 0}","${(l.notes || '').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call_history_${this.getLocalDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  renderLogsTable(logs) {
    if (!this.logsTableBody) return;
    this.logsTableBody.innerHTML = '';

    if (!logs || logs.length === 0) {
      this.logsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No call logs recorded yet.</td></tr>`;
      return;
    }

    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-size:11.5px;color:#64748b;">${this.escapeHtml(log.timestamp || '')}</td>
        <td><strong>${this.escapeHtml(log.customer_name || 'Customer')}</strong></td>
        <td>${this.escapeHtml(log.phone_number || '')}</td>
        <td>${this.getStatusBadge(log.status)}</td>
        <td>${log.duration_sec || 0}s</td>
        <td><span style="font-size:11px;background:#f1f5f9;padding:3px 8px;border-radius:6px;color:#334155;">${this.escapeHtml(log.audio_played || 'Human Audio')}</span></td>
        <td><span style="font-size:11px;color:#0369a1;">${this.escapeHtml(log.call_time || '-')}</span></td>
      `;
      this.logsTableBody.appendChild(tr);
    });
  }

  async loadCallbacksList() {
    try {
      const res = await fetch('api.php?action=get_callbacks');
      const data = await res.json();
      if (!data.success) return;
      this.callbacksList = data.callbacks || [];
      this.renderUnansweredTable();
    } catch (e) {
      console.warn('loadCallbacksList error:', e);
    }
  }

  getDialerTimezoneName() {
    return this.serverTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Addis_Ababa';
  }

  syncServerClock(data) {
    if (!data || typeof data !== 'object') return;
    if (data.server_timezone) {
      this.serverTimezone = data.server_timezone;
    }
    if (data.server_today) {
      this.serverToday = data.server_today;
    }
    const serverMs = Number(data.server_now_ms);
    if (Number.isFinite(serverMs) && serverMs > 0) {
      this.serverTimeOffsetMs = serverMs - Date.now();
    }
  }

  getServerNow() {
    return Date.now() + (Number(this.serverTimeOffsetMs) || 0);
  }

  getZonedDateParts(ms = this.getServerNow(), timeZone = null) {
    const tz = timeZone || this.getDialerTimezoneName();
    try {
      const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      const parts = {};
      dtf.formatToParts(new Date(ms)).forEach(p => {
        if (p.type !== 'literal') parts[p.type] = p.value;
      });
      const hour = Number(parts.hour) === 24 ? 0 : Number(parts.hour);
      return {
        year: Number(parts.year),
        month: Number(parts.month),
        day: Number(parts.day),
        hour,
        minute: Number(parts.minute),
        second: Number(parts.second),
        ymd: `${parts.year}-${parts.month}-${parts.day}`
      };
    } catch (e) {
      const d = new Date(ms);
      const pad = (n) => String(n).padStart(2, '0');
      return {
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour: d.getHours(),
        minute: d.getMinutes(),
        second: d.getSeconds(),
        ymd: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      };
    }
  }

  zonedWallTimeToUtcMs(year, month1Based, day, hour = 0, minute = 0, second = 0, timeZone = null) {
    const tz = timeZone || this.getDialerTimezoneName();
    const approxUtc = Date.UTC(year, month1Based - 1, day, hour, minute, second);
    try {
      const p1 = this.getZonedDateParts(approxUtc, tz);
      const wall1 = Date.UTC(p1.year, p1.month - 1, p1.day, p1.hour, p1.minute, p1.second);
      const corrected = approxUtc - (wall1 - approxUtc);
      const p2 = this.getZonedDateParts(corrected, tz);
      const wall2 = Date.UTC(p2.year, p2.month - 1, p2.day, p2.hour, p2.minute, p2.second);
      return corrected - (wall2 - approxUtc);
    } catch (e) {
      return new Date(year, month1Based - 1, day, hour, minute, second, 0).getTime();
    }
  }

  formatZonedCanonical(ms, timeZone = null) {
    const p = this.getZonedDateParts(ms, timeZone);
    const pad = (n) => String(n).padStart(2, '0');
    const ampm = p.hour >= 12 ? 'PM' : 'AM';
    const h12 = (p.hour % 12) || 12;
    return `${p.ymd} ${pad(h12)}:${pad(p.minute)}:${pad(p.second)} ${ampm}`;
  }

  getLocalDateString(d = new Date(this.getServerNow())) {
    const ms = (d instanceof Date) ? d.getTime() : Number(d);
    if (!Number.isFinite(ms)) return this.getZonedDateParts(this.getServerNow()).ymd;
    return this.getZonedDateParts(ms).ymd;
  }

  setUnansDatePreset(preset, triggerRender = true) {
    this.unansDatePreset = preset;
    const now = new Date();
    const todayStr = this.getLocalDateString(now);

    const pillIds = ['datePillToday', 'datePillYesterday', 'datePill7Days', 'datePill30Days', 'datePillCustom'];
    pillIds.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('active');
    });

    if (preset === 'today') {
      this.unansDateFrom = todayStr;
      this.unansDateTo = todayStr;
      document.getElementById('datePillToday')?.classList.add('active');
    } else if (preset === 'yesterday') {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      const yStr = this.getLocalDateString(y);
      this.unansDateFrom = yStr;
      this.unansDateTo = yStr;
      document.getElementById('datePillYesterday')?.classList.add('active');
    } else if (preset === '7days') {
      const d7 = new Date();
      d7.setDate(d7.getDate() - 7);
      this.unansDateFrom = this.getLocalDateString(d7);
      this.unansDateTo = todayStr;
      document.getElementById('datePill7Days')?.classList.add('active');
    } else if (preset === '30days') {
      const d30 = new Date();
      d30.setDate(d30.getDate() - 30);
      this.unansDateFrom = this.getLocalDateString(d30);
      this.unansDateTo = todayStr;
      document.getElementById('datePill30Days')?.classList.add('active');
    } else if (preset === 'custom') {
      document.getElementById('datePillCustom')?.classList.add('active');
    }

    const fromInp = document.getElementById('unansDateFrom');
    const toInp = document.getElementById('unansDateTo');
    if (fromInp) fromInp.value = this.unansDateFrom;
    if (toInp) toInp.value = this.unansDateTo;

    this.unansCurrentPage = 1;
    if (triggerRender) {
      this.renderUnansweredTable();
    }
  }

  onUnansDateInputChange() {
    this.unansDatePreset = 'custom';
    const pillIds = ['datePillToday', 'datePillYesterday', 'datePill7Days', 'datePill30Days'];
    pillIds.forEach(id => document.getElementById(id)?.classList.remove('active'));
    document.getElementById('datePillCustom')?.classList.add('active');

    this.unansDateFrom = document.getElementById('unansDateFrom')?.value || '';
    this.unansDateTo = document.getElementById('unansDateTo')?.value || '';
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  onUnansFilterChange() {
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  filterByResultCard(resultType) {
    const statusSelect = document.getElementById('callbackStatusFilter');
    if (statusSelect) {
      statusSelect.value = resultType;
    }
    this.updateActiveResultCard(resultType);
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  updateActiveResultCard(activeType) {
    const cards = [
      { id: 'unansCardAll', type: '' },
      { id: 'unansCardNoAnswer', type: 'no_answer' },
      { id: 'unansCardBusy', type: 'busy' },
      { id: 'unansCardFailed', type: 'failed' }
    ];
    cards.forEach(c => {
      const el = document.getElementById(c.id);
      if (el) {
        if (c.type === activeType) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });
  }

  clearUnansFilters() {
    this.setUnansDatePreset('today', false);
    const searchInp = document.getElementById('callbackSearchInput');
    const statusSelect = document.getElementById('callbackStatusFilter');
    const campSelect = document.getElementById('callbackCampaignFilter');
    const schedSelect = document.getElementById('callbackScheduleFilter');
    if (searchInp) searchInp.value = '';
    if (statusSelect) statusSelect.value = '';
    if (campSelect) campSelect.value = '';
    if (schedSelect) schedSelect.value = '';
    this.updateActiveResultCard('');
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  toggleSelectAllUnanswered(checked) {
    const checkboxes = document.querySelectorAll('#unansweredTableBody .unans-row-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = checked;
      const id = Number(cb.value);
      if (checked) {
        this.selectedUnansweredIds.add(id);
      } else {
        this.selectedUnansweredIds.delete(id);
      }
    });
    this.updateBatchSelectionBar();
  }

  onUnansweredRowCheck(checkbox, id) {
    const numId = Number(id);
    if (checkbox.checked) {
      this.selectedUnansweredIds.add(numId);
    } else {
      this.selectedUnansweredIds.delete(numId);
    }
    this.updateBatchSelectionBar();
  }

  clearUnansweredSelection() {
    this.selectedUnansweredIds.clear();
    const selectAll = document.getElementById('unansSelectAllCheck');
    if (selectAll) selectAll.checked = false;
    const checkboxes = document.querySelectorAll('#unansweredTableBody .unans-row-checkbox');
    checkboxes.forEach(cb => { cb.checked = false; });
    this.updateBatchSelectionBar();
  }

  updateBatchSelectionBar() {
    const count = this.selectedUnansweredIds.size;
    const countEl = document.getElementById('unansBatchSelectedCount');
    if (countEl) {
      countEl.textContent = `${count} selected`;
    }
    const selectAll = document.getElementById('unansSelectAllCheck');
    const checkboxes = document.querySelectorAll('#unansweredTableBody .unans-row-checkbox');
    if (selectAll && checkboxes.length > 0) {
      const allChecked = Array.from(checkboxes).every(cb => cb.checked);
      selectAll.checked = allChecked;
    }
  }

  async requeueSelectedUnanswered() {
    if (!this.selectedUnansweredIds || this.selectedUnansweredIds.size === 0) {
      this.showToast('Please select at least one contact to re-queue.', 'info');
      return;
    }
    const leadIds = Array.from(this.selectedUnansweredIds);
    const targetCampaignId = this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('campaign_id', targetCampaignId);
    formData.append('lead_ids', leadIds.join(','));

    try {
      const res = await fetch('api.php?action=requeue_unanswered', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.selectedUnansweredIds.clear();
        this.showToast(data.message || `Re-queued ${leadIds.length} contact(s)!`, 'success');
        await this.loadCampaignData();
        await this.loadCallbacksList();
      } else {
        this.showToast(data.error || 'Failed to re-queue selected contacts', 'error');
      }
    } catch (e) {
      this.showToast('Network error re-queuing contacts', 'error');
    }
  }

  rescheduleSelectedUnanswered() {
    if (!this.selectedUnansweredIds || this.selectedUnansweredIds.size === 0) {
      this.showToast('Please select at least one contact to reschedule.', 'info');
      return;
    }
    const leadIds = Array.from(this.selectedUnansweredIds);
    if (leadIds.length === 1) {
      this.openRedialModal(leadIds[0]);
    } else {
      this.openBulkSmartRescheduleModal();
    }
  }

  onUnansRowsPerPageChange(val) {
    this.unansRowsPerPage = parseInt(val, 10) || 25;
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  prevUnansPage() {
    if (this.unansCurrentPage > 1) {
      this.unansCurrentPage--;
      this.renderUnansweredTable();
    }
  }

  nextUnansPage() {
    this.unansCurrentPage++;
    this.renderUnansweredTable();
  }

  formatHumanDateTime(raw) {
    if (!raw || raw === '-') return '-';
    const str = String(raw).trim();
    if (str.startsWith('Today') || str.startsWith('Yesterday')) {
      return str.replace(/,\s*0(\d:)/, ', $1');
    }
    const iso = str.replace(/(\+\d{2})$/, '$1:00').replace(' ', 'T');
    let d = new Date(iso);
    if (isNaN(d.getTime())) {
      d = new Date(str.split('.')[0].replace(' ', 'T'));
    }
    if (isNaN(d.getTime())) return str;
    const now = new Date();
    const today = this.getLocalDateString(now);
    const dYmd = this.getLocalDateString(d);
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    if (dYmd === today) return `Today, ${timeStr}`;
    const yest = new Date();
    yest.setDate(yest.getDate() - 1);
    if (dYmd === this.getLocalDateString(yest)) return `Yesterday, ${timeStr}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`;
  }

  getLeadEffectiveYmd(lead) {
    if (!lead) return '';
    const raw = lead.last_attempt_at || lead.scheduled_time || lead.created_at || '';
    if (raw) {
      const m = String(raw).match(/(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
    }
    const ct = lead.call_time || '';
    if (ct.includes('Today')) {
      return this.getLocalDateString(new Date());
    }
    if (ct.includes('Yesterday')) {
      const y = new Date();
      y.setDate(y.getDate() - 1);
      return this.getLocalDateString(y);
    }
    const m2 = String(ct).match(/(\d{4}-\d{2}-\d{2})/);
    if (m2) return m2[1];
    return '';
  }

  renderUnansweredTable() {
    const tbody = document.getElementById('unansweredTableBody');
    const badge = document.getElementById('badgeUnansweredCount');
    const missedBadge = document.getElementById('unansTabCountBadge');
    const cbsBadge = document.getElementById('callbacksTabCountBadge');

    const cbs = this.callbacksList || [];
    const missed = (this.leads || []).filter(l => ['no_answer', 'busy', 'failed'].includes(l.status));
    const totalCount = cbs.length + missed.length;
    if (badge) {
      badge.textContent = totalCount;
      badge.style.display = totalCount > 0 ? 'inline-block' : 'none';
    }
    if (missedBadge) missedBadge.textContent = missed.length;
    if (cbsBadge) cbsBadge.textContent = cbs.length;

    // Metric counts
    const countNoAnswer = missed.filter(l => l.status === 'no_answer').length;
    const countBusy = missed.filter(l => l.status === 'busy').length;
    const countFailed = missed.filter(l => l.status === 'failed').length;
    const elAll = document.getElementById('unansMetricAll');
    const elNoAnswer = document.getElementById('unansMetricNoAnswer');
    const elBusy = document.getElementById('unansMetricBusy');
    const elFailed = document.getElementById('unansMetricFailed');
    if (elAll) elAll.textContent = missed.length;
    if (elNoAnswer) elNoAnswer.textContent = countNoAnswer;
    if (elBusy) elBusy.textContent = countBusy;
    if (elFailed) elFailed.textContent = countFailed;

    // Populate Campaign Filter dropdown if not populated
    const campSelect = document.getElementById('callbackCampaignFilter');
    if (campSelect && campSelect.options.length <= 1) {
      const campaigns = this.allCampaigns || this.selectedCampaigns || [];
      if (campaigns.length > 0) {
        campaigns.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name;
          campSelect.appendChild(opt);
        });
      }
    }

    // Ensure Date inputs initialized
    if (!this.unansDateFrom && !this.unansDateTo) {
      this.setUnansDatePreset('today', false);
    }

    if (!tbody) return;

    const isCallbacks = (this.unansweredSubTab === 'callbacks');
    const searchVal = document.getElementById('callbackSearchInput')?.value.toLowerCase().trim() || '';
    const statusVal = document.getElementById('callbackStatusFilter')?.value.toLowerCase().trim() || '';
    const campVal = document.getElementById('callbackCampaignFilter')?.value || '';
    const schedVal = document.getElementById('callbackScheduleFilter')?.value || '';

    // Synchronize active card outline with statusVal
    this.updateActiveResultCard(statusVal);

    let itemsToFilter = isCallbacks ? cbs : missed;

    const filtered = itemsToFilter.filter(item => {
      // 1. Search filter
      if (searchVal) {
        const name = (item.customer_name || item.lead_name || '').toLowerCase();
        const phone = (item.phone_number || '').toLowerCase();
        const camp = (item.campaign_name || '').toLowerCase();
        const notes = (item.notes || '').toLowerCase();
        const reason = (item.error_message || '').toLowerCase();
        if (!name.includes(searchVal) && !phone.includes(searchVal) && !camp.includes(searchVal) && !notes.includes(searchVal) && !reason.includes(searchVal)) {
          return false;
        }
      }

      // 2. Call result filter
      if (statusVal) {
        if (!isCallbacks) {
          if (item.status !== statusVal) return false;
        } else {
          if (statusVal === 'completed' && item.status !== 'completed') return false;
          if (statusVal === 'pending' && item.status === 'completed') return false;
        }
      }

      // 3. Campaign filter
      if (campVal) {
        const itemCampId = item.campaign_id;
        if (itemCampId && String(itemCampId) !== String(campVal)) return false;
      }

      // 4. Schedule filter
      if (schedVal) {
        const sched = this.getLeadScheduleInfo ? this.getLeadScheduleInfo(item) : { type: 'today' };
        if (schedVal === 'today' && sched.type !== 'today') return false;
        if (schedVal === 'past_due' && sched.type !== 'past_due') return false;
        if (schedVal === 'upcoming' && sched.type !== 'upcoming') return false;
      }

      // 5. Date filter
      if (!isCallbacks) {
        const itemYmd = this.getLeadEffectiveYmd(item);
        if (itemYmd) {
          if (this.unansDateFrom && itemYmd < this.unansDateFrom) return false;
          if (this.unansDateTo && itemYmd > this.unansDateTo) return false;
        }
      } else {
        if (this.unansDatePreset === 'yesterday' || this.unansDatePreset === '7days' || this.unansDatePreset === '30days' || this.unansDatePreset === 'custom') {
          const itemYmd = this.getLeadEffectiveYmd(item);
          if (itemYmd) {
            if (this.unansDateFrom && itemYmd < this.unansDateFrom) return false;
            if (this.unansDateTo && itemYmd > this.unansDateTo) return false;
          }
        }
      }

      return true;
    });

    // Subtitle update
    const subTitle = document.getElementById('callbacksSubtitle');
    if (subTitle) {
      subTitle.textContent = isCallbacks
        ? `Showing ${filtered.length} of ${cbs.length} scheduled follow-up callbacks requested by contacts.`
        : `Calls that were not answered, were busy, or failed, and follow-up calls requested by contacts.`;
    }

    // Pagination calculations
    const total = filtered.length;
    const rowsPerPage = this.unansRowsPerPage || 25;
    const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
    if (this.unansCurrentPage > totalPages) this.unansCurrentPage = totalPages;
    if (this.unansCurrentPage < 1) this.unansCurrentPage = 1;

    const startIndex = (this.unansCurrentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, total);
    const pageItems = filtered.slice(startIndex, endIndex);

    // Showing text
    const showingText = document.getElementById('unansPaginationShowingText');
    if (showingText) {
      const fromNum = total === 0 ? 0 : startIndex + 1;
      const label = isCallbacks ? 'scheduled callbacks' : 'unanswered calls';
      showingText.textContent = `Showing ${fromNum} to ${endIndex} of ${total} ${label}`;
    }

    // Prev / Next button states
    const btnPrev = document.getElementById('unansBtnPrevPage');
    const btnNext = document.getElementById('unansBtnNextPage');
    if (btnPrev) btnPrev.disabled = (this.unansCurrentPage <= 1);
    if (btnNext) btnNext.disabled = (this.unansCurrentPage >= totalPages || total === 0);

    // Render Table Body
    tbody.innerHTML = '';
    if (pageItems.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:36px 16px;">No contacts match your filters in this view.</td></tr>`;
      this.updateBatchSelectionBar();
      return;
    }

    const defaultCampName = this.campaign?.name || 'Default';

    pageItems.forEach(item => {
      const isChecked = this.selectedUnansweredIds.has(Number(item.id));
      const tr = document.createElement('tr');
      if (isChecked) tr.style.background = '#f0fdf4';

      const custName = item.customer_name || item.lead_name || 'Customer';
      const phone = item.phone_number || '';
      const campName = item.campaign_name || defaultCampName;
      const attempts = item.attempts || item.attempt_count || 1;
      const lastAttempt = this.formatHumanDateTime(item.last_attempt_at || item.created_at);
      const scheduledCall = this.formatHumanDateTime(item.call_time || item.scheduled_time);

      // Result Badge
      let badgeHtml = '';
      if (!isCallbacks) {
        if (item.status === 'no_answer') {
          badgeHtml = `
            <div class="unans-result-badge unans-badge-no-answer">
              <span class="unans-badge-title">No answer</span>
              <span class="unans-badge-sub">Timeout</span>
            </div>
          `;
        } else if (item.status === 'busy') {
          badgeHtml = `
            <div class="unans-result-badge unans-badge-busy">
              <span class="unans-badge-title">Busy</span>
              <span class="unans-badge-sub">Busy line</span>
            </div>
          `;
        } else {
          badgeHtml = `
            <div class="unans-result-badge unans-badge-failed">
              <span class="unans-badge-title">Failed</span>
              <span class="unans-badge-sub">${this.escapeHtml(item.error_message || 'Call failed')}</span>
            </div>
          `;
        }
      } else {
        const isDone = item.status === 'completed';
        badgeHtml = `
          <div class="unans-result-badge ${isDone ? 'unans-badge-completed' : 'unans-badge-callback'}">
            <span class="unans-badge-title">${isDone ? 'Completed' : 'Callback'}</span>
            <span class="unans-badge-sub">${this.escapeHtml(item.notes || (isDone ? 'Finished' : 'Pending'))}</span>
          </div>
        `;
      }

      // Actions
      let actionsHtml = '';
      if (!isCallbacks) {
        actionsHtml = `
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;">
            <button type="button" class="unans-row-btn" onclick="app.clickToDial('${this.escapeHtml(phone)}', '${this.escapeHtml(custName)}')">Call now</button>
            <button type="button" class="unans-row-btn" onclick="app.requeueSingleLead(${item.id})">Re-queue</button>
            <button type="button" class="unans-row-btn" onclick="app.openRedialModal(${item.id})">Reschedule</button>
          </div>
        `;
      } else {
        const isDone = item.status === 'completed';
        actionsHtml = `
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:4px;">
            <button type="button" class="unans-row-btn" onclick="app.clickToDial('${this.escapeHtml(phone)}', '${this.escapeHtml(custName)}')">Call now</button>
            <button type="button" class="unans-row-btn" onclick="app.completeCallback(${item.id})">${isDone ? 'Completed' : 'Done'}</button>
            <button type="button" class="unans-row-btn" onclick="app.openRescheduleModal(${item.id}, '${this.escapeHtml(custName)}', '${this.escapeHtml(phone)}', '${item.scheduled_time || ''}')">Reschedule</button>
          </div>
        `;
      }

      tr.innerHTML = `
        <td style="width:36px;text-align:center;">
          <input type="checkbox" class="unans-row-checkbox" value="${item.id}" ${isChecked ? 'checked' : ''} onchange="app.onUnansweredRowCheck(this, ${item.id})">
        </td>
        <td><strong style="color:#0f172a;">${this.escapeHtml(custName)}</strong></td>
        <td>
          <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(phone)}', '${this.escapeHtml(custName)}')" style="color:#00A651;font-weight:700;text-decoration:none;">
            ${this.escapeHtml(phone)}
          </a>
        </td>
        <td style="color:#334155;">${this.escapeHtml(campName)}</td>
        <td>${badgeHtml}</td>
        <td style="color:#334155;font-weight:600;">${attempts}</td>
        <td style="color:#334155;white-space:nowrap;">${lastAttempt}</td>
        <td style="color:#334155;white-space:nowrap;">${scheduledCall}</td>
        <td style="text-align:right;white-space:nowrap;">${actionsHtml}</td>
      `;

      tbody.appendChild(tr);
    });

    this.updateBatchSelectionBar();
  }

  async completeCallback(callbackId) {
    const formData = new FormData();
    formData.append('callback_id', callbackId);
    try {
      const res = await fetch('api.php?action=complete_callback', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast('Callback marked completed in PostgreSQL', 'success');
        this.loadCallbacksList();
      }
    } catch (e) {
      this.showToast('Failed to update callback', 'error');
    }
  }

  openRescheduleModal(callbackId, name = 'Customer', phone = '', scheduledTime = '') {
    const idInp = document.getElementById('rescheduleCallbackId');
    const nameEl = document.getElementById('rescheduleCustomerName');
    const phoneEl = document.getElementById('reschedulePhoneNumber');
    const dateInp = document.getElementById('rescheduleDateInput');
    const timeInp = document.getElementById('rescheduleTimeInput');
    const notesInp = document.getElementById('rescheduleNotesInput');

    if (idInp) idInp.value = callbackId;
    if (nameEl) nameEl.textContent = name || 'Customer';
    if (phoneEl) phoneEl.textContent = phone || '';
    if (notesInp) notesInp.value = '';

    // If existing scheduled time is provided, parse it; otherwise default to tomorrow at 09:00
    let targetDate = new Date(Date.now() + 86400000);
    let hoursStr = '09:00';

    if (scheduledTime && scheduledTime.length >= 10) {
      try {
        const parsed = new Date(scheduledTime.replace(' ', 'T'));
        if (!isNaN(parsed.getTime())) {
          targetDate = parsed;
          hoursStr = String(parsed.getHours()).padStart(2, '0') + ':' + String(parsed.getMinutes()).padStart(2, '0');
        }
      } catch (e) {}
    }

    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');

    if (dateInp) dateInp.value = `${yyyy}-${mm}-${dd}`;
    if (timeInp) timeInp.value = hoursStr;

    this.updateReschedulePreview();
    this.openModal('modalRescheduleCallback');
  }

  setReschedulePreset(preset) {
    const now = new Date();
    let target = new Date();
    let hoursStr = '09:00';

    if (preset === '+15m') {
      target = new Date(now.getTime() + 15 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === '+1h') {
      target = new Date(now.getTime() + 60 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === '+3h') {
      target = new Date(now.getTime() + 180 * 60000);
      hoursStr = String(target.getHours()).padStart(2, '0') + ':' + String(target.getMinutes()).padStart(2, '0');
    } else if (preset === 'tomorrow_am') {
      target = new Date(now.getTime() + 86400000);
      hoursStr = '09:00';
    } else if (preset === 'tomorrow_pm') {
      target = new Date(now.getTime() + 86400000);
      hoursStr = '14:00';
    } else if (preset === '+3days') {
      target = new Date(now.getTime() + 3 * 86400000);
      hoursStr = '10:00';
    }

    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');

    const dateInp = document.getElementById('rescheduleDateInput');
    const timeInp = document.getElementById('rescheduleTimeInput');
    if (dateInp) dateInp.value = `${yyyy}-${mm}-${dd}`;
    if (timeInp) timeInp.value = hoursStr;

    this.updateReschedulePreview();
  }

  updateReschedulePreview() {
    const previewEl = document.getElementById('reschedulePreviewText');
    const dateVal = document.getElementById('rescheduleDateInput')?.value;
    const timeVal = document.getElementById('rescheduleTimeInput')?.value || '09:00';

    if (!previewEl) return;
    if (!dateVal) {
      previewEl.textContent = 'Please choose a date from the calendar.';
      return;
    }

    try {
      const dt = new Date(`${dateVal}T${timeVal}`);
      const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
      previewEl.textContent = `Scheduled for: ${dt.toLocaleDateString('en-US', options)}`;
    } catch (e) {
      previewEl.textContent = `Scheduled for: ${dateVal} at ${timeVal}`;
    }
  }

  async handleRescheduleSubmit(e) {
    if (e) e.preventDefault();
    const callbackId = document.getElementById('rescheduleCallbackId')?.value;
    const dateVal = document.getElementById('rescheduleDateInput')?.value;
    const timeVal = document.getElementById('rescheduleTimeInput')?.value || '09:00';
    const notesVal = document.getElementById('rescheduleNotesInput')?.value.trim() || '';

    if (!callbackId || !dateVal) {
      this.showToast('Please select a date from the calendar.', 'error');
      return;
    }

    const fullTimestamp = `${dateVal} ${timeVal}:00`;
    const formData = new FormData();
    formData.append('callback_id', callbackId);
    formData.append('scheduled_time', fullTimestamp);
    if (notesVal) formData.append('notes', notesVal);

    try {
      const res = await fetch('api.php?action=reschedule_callback', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`Callback successfully rescheduled for ${dateVal} at ${timeVal}!`, 'success');
        this.closeModal('modalRescheduleCallback');
        await this.loadCallbacksList();
      } else {
        this.showToast(data.error || 'Failed to reschedule callback.', 'error');
      }
    } catch (err) {
      this.showToast('Network error rescheduling callback.', 'error');
    }
  }

  async rescheduleCallback(callbackId) {
    const cb = (this.callbacksList || []).find(c => Number(c.id) === Number(callbackId));
    this.openRescheduleModal(callbackId, cb?.customer_name, cb?.phone_number, cb?.scheduled_time);
  }

  async loadDncList() {
    try {
      const res = await fetch('api.php?action=get_dnc_list');
      const data = await res.json();
      if (!data.success) return;
      this.dncList = data.dnc_list || [];

      const tbody = document.getElementById('dncTableBody');
      const countTag = document.getElementById('dncCountTag');
      if (countTag) countTag.textContent = this.dncList.length;

      if (!tbody) return;
      if (this.dncList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#64748b;">No numbers currently registered on Do-Not-Call list.</td></tr>`;
        return;
      }

      tbody.innerHTML = this.dncList.map(item => {
        const dateStr = item.created_at ? item.created_at.substring(0, 10) : 'Today';
        return `
          <tr style="border-bottom:1px solid #f0f5f1;">
            <td style="font-weight:700;color:#0d2e1b;font-family:monospace;">${this.escapeHtml(item.phone_number)}</td>
            <td style="font-size:12px;color:#526e5f;">${this.escapeHtml(item.reason || 'Customer opt-out')}</td>
            <td style="font-size:11.5px;color:#64748b;">${this.escapeHtml(dateStr)}</td>
            <td style="font-size:11.5px;color:#1a3d2a;">${this.escapeHtml(item.added_by || 'Agent')}</td>
            <td style="text-align:right;">
              <button class="btn btn-xs btn-danger" onclick="app.removeDncNumber(${item.id})" style="font-size:11px;padding:3px 8px;" title="Remove from DNC">
                Unblock
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (e) {
      console.warn('loadDncList error:', e);
    }
  }

  async handleAddDncSubmit(e) {
    e.preventDefault();
    const phoneInput = document.getElementById('dncInputPhone');
    const reasonSelect = document.getElementById('dncInputReason');
    const phone = phoneInput ? phoneInput.value.trim() : '';
    const reason = reasonSelect ? reasonSelect.value : '';

    if (!phone) {
      this.showToast('Please enter a phone number', 'warning');
      return;
    }

    const formData = new FormData();
    formData.append('phone_number', phone);
    formData.append('reason', reason);

    try {
      const res = await fetch('api.php?action=add_dnc_number', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || 'Number added to DNC list!', 'success');
        if (phoneInput) phoneInput.value = '';
        await this.loadDncList();
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to add number to DNC', 'error');
      }
    } catch (err) {
      this.showToast('Network error adding to DNC', 'error');
    }
  }

  async removeDncNumber(id) {
    if (!confirm('Are you sure you want to remove this number from the Do-Not-Call registry?')) return;
    const formData = new FormData();
    formData.append('id', id);
    try {
      const res = await fetch('api.php?action=remove_dnc_number', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast('Number removed from DNC list', 'info');
        this.loadDncList();
      }
    } catch (e) {
      this.showToast('Failed to remove number from DNC', 'error');
    }
  }

  async scrubQueueDnc() {
    this.showToast('Running pre-dial regulatory DNC scrub...', 'info');
    try {
      const res = await fetch('api.php?action=scrub_dnc_queue', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message, 'success');
        await this.loadCampaignData();
      }
    } catch (e) {
      this.showToast('Failed to run DNC scrub', 'error');
    }
  }


  async requeueUnansweredLeads() {
    let count = 0;
    this.leads.forEach(l => {
      if (['no_answer', 'busy', 'failed'].includes(l.status)) {
        l.status = 'pending';
        l.duration_sec = 0;
        count++;
      }
    });
    this.renderLeadsTables();
    this.renderUnansweredTable();
    this.updateLocalStats();
    this.renderActiveChannels();
    this.showToast(`Re-queued ${count} unanswered leads!`, 'success');

    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      await fetch('api.php?action=requeue_unanswered', { method: 'POST', body: formData });
    } catch (e) {
      this.showToast('Failed to sync re-queue with server', 'error');
    }
  }

  async requeueSingleLead(leadId) {
    const lead = this.leads.find(l => Number(l.id) === Number(leadId));
    if (lead) {
      lead.status = 'pending';
      lead.duration_sec = 0;
      this.renderLeadsTables();
      this.renderUnansweredTable();
      this.updateLocalStats();
      this.renderActiveChannels();
    }
    this.showToast('Contact moved back to calling queue!', 'success');

    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('status', 'pending');
      formData.append('duration_sec', 0);
      await fetch('api.php?action=update_lead_status', { method: 'POST', body: formData });
    } catch(e) {
      this.showToast('Error syncing contact status', 'error');
    }
  }

  exportUnansweredCsv() {
    const unansweredLeads = this.leads.filter(l => ['no_answer', 'busy', 'failed'].includes(l.status));
    if (unansweredLeads.length === 0) {
      this.showToast('No unanswered leads to export.', 'info');
      return;
    }
    let csv = "Customer Name,Phone Number,Status,Call Time,Notes\n";
    unansweredLeads.forEach(l => {
      csv += `"${(l.customer_name || '').replace(/"/g, '""')}","${l.phone_number}","${l.status}","${l.call_time || ''}","${(l.notes || '').replace(/"/g, '""')}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `unanswered_leads_${this.getLocalDateString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getStatusBadge(st, lead = null) {
    let baseBadge = '';
    if (st === 'pending' && lead && this.isLeadPastDue(lead)) {
      baseBadge = '<span style="background:#fff7ed;color:#c2410c;padding:3px 9px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fed7aa;box-shadow:0 1px 2px rgba(194,65,12,0.08);" title="Scheduled call time has passed"><span style="width:6px;height:6px;border-radius:50%;background:#f97316;display:inline-block;"></span>Past Due</span>';
    } else if (st === 'pending') {
      baseBadge = '<span style="background:#f1f5f9;color:#475569;padding:3px 9px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #cbd5e1;"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>Pending</span>';
    } else {
      const map = {
        'pending': '<span style="background:#f1f5f9;color:#475569;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #e2e8f0;"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>Pending</span>',
        'calling': '<span style="background:#fef3c7;color:#b45309;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fde68a;box-shadow:0 0 8px rgba(245,158,11,0.25);"><span style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>Calling...</span>',
        'answered': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Answered</span>',
        'ivr_playing': '<span style="background:#dbeafe;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bfdbfe;"><span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;display:inline-block;"></span>IVR Playing</span>',
        'ivr_completed': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Completed</span>',
        'completed': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Completed</span>',
        'callback': '<span style="background:#eff6ff;color:#1e40af;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bfdbfe;"><span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;display:inline-block;"></span>Callback</span>',
        'busy': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>Busy</span>',
        'no_answer': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>No Answer</span>',
        'failed': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>Failed</span>'
      };
      baseBadge = map[st] || `<span style="background:#f1f5f9;color:#475569;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;">${st}</span>`;
    }

    return baseBadge;
  }

  populateAudioDropdown() {
    const fill = (el) => {
      if (!el) return;
      el.innerHTML = '';
      this.audioRecordings.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        if (this.campaign && (this.campaign.ivr_audio_name === a.name || this.campaign.ivr_audio_file === a.filepath)) {
          opt.selected = true;
        }
        el.appendChild(opt);
      });
    };
    fill(this.audioSelectDropdown);
    fill(this.audioSelectDropdownTab);
    this.renderAudioListTable();
  }

  renderAudioListTable() {
    const tbody = document.getElementById('audioListTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!this.audioRecordings || this.audioRecordings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px;">No audio recordings uploaded yet. Click "Upload New Audio" to add one.</td></tr>`;
      return;
    }

    this.audioRecordings.forEach((a) => {
      const isActive = this.campaign && (this.campaign.ivr_audio_name === a.name || this.campaign.ivr_audio_file === a.filepath);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong style="color:#00A651;">${this.escapeHtml(a.name)}</strong> ${isActive ? '<span class="sc-badge done" style="font-size:10px;padding:1px 6px;">Active</span>' : ''}</td>
        <td style="font-size:12px;color:#64748b;font-family:monospace;">${this.escapeHtml(a.filename || a.filepath)}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" onclick="app.previewAudioItem('${this.escapeHtml(a.filepath || '')}')">Play</button>
        </td>
        <td style="text-align:right;white-space:nowrap;">
          ${isActive 
            ? '<button type="button" class="btn btn-sm btn-success" disabled>Active</button>' 
            : `<button type="button" class="btn btn-sm btn-primary" onclick="app.selectAudioRecording(${a.id})">Use for Calls</button>`}
          <button type="button" class="btn btn-sm btn-danger" onclick="app.deleteAudioRecording(${a.id})" style="margin-left:4px;">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  previewAudioItem(filepath) {
    if (!filepath) return;
    const tabPlayer = document.getElementById('tabAudioPlayer');
    if (tabPlayer) {
      tabPlayer.src = filepath;
      tabPlayer.play().catch(() => {});
    }
    const mainPlayer = document.getElementById('mainAudioPlayer');
    if (mainPlayer) {
      mainPlayer.src = filepath;
    }
  }

  async selectAudioRecording(audioId) {
    try {
      const formData = new FormData();
      formData.append('audio_id', audioId);
      formData.append('campaign_id', this.campaign?.id || 1);

      const res = await fetch('api.php?action=select_audio', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message, 'success');
        const selectedAudio = this.audioRecordings.find(a => String(a.id) === String(audioId));
        if (selectedAudio && selectedAudio.filepath) {
          const tabPlayer = document.getElementById('tabAudioPlayer');
          if (tabPlayer) tabPlayer.src = selectedAudio.filepath;
          const mainPlayer = document.getElementById('mainAudioPlayer');
          if (mainPlayer) mainPlayer.src = selectedAudio.filepath;
        }
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to select audio recording', 'error');
      }
    } catch (e) {
      this.showToast('Failed to select audio recording', 'error');
    }
  }

  async deleteAudioRecording(audioId) {
    const originalAudios = [...this.audioRecordings];
    this.audioRecordings = this.audioRecordings.filter(a => Number(a.id) !== Number(audioId));
    this.renderAudioListTable();
    this.populateAudioDropdown();
    this.showToast('Audio recording deleted', 'info');

    try {
      const formData = new FormData();
      formData.append('audio_id', audioId);
      const res = await fetch('api.php?action=delete_audio', { method: 'POST', body: formData });
      const data = await res.json();
      if (!data.success) {
        this.audioRecordings = originalAudios;
        this.renderAudioListTable();
        this.populateAudioDropdown();
        this.showToast(data.error || 'Failed to delete audio recording', 'error');
      }
    } catch(e) {
      this.audioRecordings = originalAudios;
      this.renderAudioListTable();
      this.populateAudioDropdown();
      this.showToast('Error deleting audio recording', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Scheduled Call Time Parsers & Precise Time Engine
     ───────────────────────────────────────────────────────── */
  isImmediateCallTime(callTime) {
    if (!callTime) return true;
    const s = String(callTime).trim().toLowerCase();
    if (s === '' || s === 'immediate' || s === 'now') return true;
    if (s.includes('immediate') || s.includes('now')) return true;
    return false;
  }

  isLeadFromPastDay(lead) {
    if (!lead) return false;
    const today = this.serverToday || this.getLocalDateString();
    if (lead.is_past_day) return true;
    if (lead.effective_date && lead.effective_date < today) return true;
    if (lead.is_past && !lead.effective_date) return true;
    return false;
  }

  isLeadPastDue(lead) {
    if (!lead || (lead.status || '').toLowerCase() !== 'pending') return false;
    if (this.isLeadFromPastDay(lead)) {
      return true;
    }
    if (this.isImmediateCallTime(lead.call_time)) {
      return false;
    }
    const scheduledTs = this.getLeadScheduledTimestamp(lead);
    // UI indicator: scheduled minute has elapsed (60+ seconds past scheduled timestamp)
    return scheduledTs > 0 && this.getServerNow() >= (scheduledTs + 60000);
  }

  isLeadDueForCall(lead) {
    if (!lead || (lead.status || '').toLowerCase() !== 'pending') return false;
    // Exclude previous-day historical leads unless rolled over to today
    if (this.isLeadFromPastDay(lead)) return false;
    if (this.isImmediateCallTime(lead.call_time)) {
      return true; // Immediate calls are always ready
    }

    const scheduledTs = this.getLeadScheduledTimestamp(lead);
    if (scheduledTs <= 0) return false;

    // Dial once the scheduled second has arrived; same-day delayed calls remain eligible
    return this.getServerNow() >= scheduledTs;
  }

  formatTo12HourAmPm(timeStr) {
    if (!timeStr) return '';
    const s = String(timeStr).trim();
    if (!s || this.isImmediateCallTime(s)) return 'Immediate';

    // If already contains AM or PM: normalize padding and keep non-zero seconds
    if (/\b(AM|PM)\b/i.test(s)) {
      return s.replace(/(\d{1,2})[:.](\d{2})(?::(\d{2}))?\s*(AM|PM)/i, (m, h, min, sec, ap) => {
        const hh = String(parseInt(h, 10)).padStart(2, '0');
        const ssPart = (sec && sec !== '00') ? `:${sec}` : '';
        return `${hh}:${min}${ssPart} ${ap.toUpperCase()}`;
      });
    }

    // ISO date + 24-hr time: "2026-10-28 17:00" or "2026-10-26 09:10:30"
    const isoMatch = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2})[:.](\d{2})(?::(\d{2}))?/);
    if (isoMatch) {
      const datePart = isoMatch[1];
      const hrs24 = parseInt(isoMatch[2], 10);
      const mins = isoMatch[3];
      const sec = isoMatch[4];
      const ssPart = (sec && sec !== '00') ? `:${sec}` : '';
      const ampm = hrs24 >= 12 ? 'PM' : 'AM';
      let hrs12 = hrs24 % 12;
      if (hrs12 === 0) hrs12 = 12;
      const hh = String(hrs12).padStart(2, '0');
      return `${datePart} ${hh}:${mins}${ssPart} ${ampm}`;
    }

    // Bare 24-hr time: "17:00" or "14:10" or "09:10"
    const timeMatch = s.match(/^(\d{1,2})[:.](\d{2})(?::(\d{2}))?$/);
    if (timeMatch) {
      const hrs24 = parseInt(timeMatch[1], 10);
      const mins = timeMatch[2];
      const sec = timeMatch[3];
      const ssPart = (sec && sec !== '00') ? `:${sec}` : '';
      const ampm = hrs24 >= 12 ? 'PM' : 'AM';
      let hrs12 = hrs24 % 12;
      if (hrs12 === 0) hrs12 = 12;
      const hh = String(hrs12).padStart(2, '0');
      return `${hh}:${mins}${ssPart} ${ampm}`;
    }

    return s;
  }

  getLeadScheduleInfo(lead) {
    if (!lead || !lead.call_time) {
      return {
        type: 'immediate',
        targetTs: 0,
        badgeClass: 'des-badge-immediate',
        badgeText: 'Immediate',
        fullLabel: 'Immediate',
        displayTime: 'Immediate',
        formatted: 'Immediate',
        isDue: true,
        isFuture: false,
        isPast: false
      };
    }

    let raw = String(lead.call_time).trim();
    // Strip redundant trailing badge labels if already present
    raw = raw.replace(/\s*[·•-]\s*(Past due|Scheduled|Ready)\s*$/i, '').trim();

    if (!raw || this.isImmediateCallTime(raw)) {
      return {
        type: 'immediate',
        targetTs: 0,
        badgeClass: 'des-badge-immediate',
        badgeText: 'Immediate',
        fullLabel: 'Immediate',
        displayTime: 'Immediate',
        formatted: 'Immediate',
        isDue: true,
        isFuture: false,
        isPast: false
      };
    }

    // Always format with 12-hour AM/PM: e.g. "2026-10-28 05:00 PM"
    const displayTime = this.formatTo12HourAmPm(raw);
    const targetTs = this.getLeadScheduledTimestamp({ ...lead, call_time: raw });
    const now = this.getServerNow();
    const isPastDay = this.isLeadFromPastDay(lead);

    // 1. Future scheduled call (e.g. tomorrow, next week, or upcoming later today)
    if (targetTs > now) {
      return {
        type: 'upcoming',
        targetTs: targetTs,
        badgeClass: 'des-badge-scheduled',
        badgeText: displayTime,
        fullLabel: `${displayTime} · Scheduled`,
        displayTime: displayTime,
        formatted: displayTime,
        isDue: false,
        isFuture: true,
        isPast: false
      };
    }

    // 2. Scheduled call that arrived right now (within 60-second current window)
    if (!isPastDay && targetTs > 0 && (now - targetTs) <= 60 * 1000) {
      return {
        type: 'today',
        targetTs: targetTs,
        badgeClass: 'des-badge-ready',
        badgeText: displayTime,
        fullLabel: `${displayTime} · Ready`,
        displayTime: displayTime,
        formatted: displayTime,
        isDue: true,
        isFuture: false,
        isPast: false
      };
    }

    // 3. Past due call (scheduled time has passed by > 60 seconds or is from a past day)
    if (isPastDay || targetTs > 0) {
      return {
        type: 'past_due',
        targetTs: targetTs,
        badgeClass: 'des-badge-pastdue',
        badgeText: displayTime,
        fullLabel: `${displayTime} · Past due`,
        displayTime: displayTime,
        formatted: displayTime,
        isDue: !isPastDay && targetTs > 0 && now >= targetTs,
        isFuture: false,
        isPast: true
      };
    }

    return {
      type: 'immediate',
      targetTs: 0,
      badgeClass: 'des-badge-immediate',
      badgeText: displayTime,
      fullLabel: displayTime,
      displayTime: displayTime,
      formatted: displayTime,
      isDue: true,
      isFuture: false,
      isPast: false
    };
  }

  getLeadScheduledTimestamp(lead) {
    if (!lead || !lead.call_time) return 0;
    const s = String(lead.call_time).trim();
    if (!s || this.isImmediateCallTime(s)) {
      return 0; // Immediate priority
    }

    // Prefer exact server-computed epoch ms when available and not locally mutated
    const serverSchedMs = Number(lead.scheduled_ts_ms);
    if (!lead._dirtySchedule && Number.isFinite(serverSchedMs) && serverSchedMs > 0) {
      return serverSchedMs;
    }

    const nowMs = this.getServerNow();

    // Helper: parse lead.created_at accurately (respecting server created_at_ms or ISO offset)
    const getAnchorMs = () => {
      if (Number.isFinite(Number(lead.created_at_ms)) && Number(lead.created_at_ms) > 0) {
        return Number(lead.created_at_ms);
      }
      if (lead.created_at) {
        const rawCr = String(lead.created_at).trim();
        if (/(Z|[+-]\d{2}(?::?\d{2})?)$/i.test(rawCr)) {
          const t = new Date(rawCr.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).getTime();
          if (Number.isFinite(t)) return t;
        }
        const mCr = rawCr.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
        if (mCr) {
          return this.zonedWallTimeToUtcMs(
            parseInt(mCr[1], 10), parseInt(mCr[2], 10), parseInt(mCr[3], 10),
            parseInt(mCr[4], 10), parseInt(mCr[5], 10), mCr[6] ? parseInt(mCr[6], 10) : 0
          );
        }
      }
      if (lead.effective_date && /^\d{4}-\d{2}-\d{2}$/.test(lead.effective_date)) {
        const [ey, em, ed] = lead.effective_date.split('-').map(Number);
        return this.zonedWallTimeToUtcMs(ey, em, ed, 0, 0, 0);
      }
      return nowMs;
    };

    // 1. Relative offsets (e.g. "+30 secs", "+5 mins", "+1 hour")
    const relSecMatch = s.match(/^\+(\d+)\s*(?:sec|secs|second|seconds)$/i);
    if (relSecMatch) {
      return getAnchorMs() + parseInt(relSecMatch[1], 10) * 1000;
    }
    const relMatch = s.match(/^\+(\d+)\s*(?:min|mins|minute|minutes)$/i);
    if (relMatch) {
      return getAnchorMs() + parseInt(relMatch[1], 10) * 60 * 1000;
    }
    const relHourMatch = s.match(/^\+(\d+)\s*(?:hr|hrs|hour|hours)$/i);
    if (relHourMatch) {
      return getAnchorMs() + parseInt(relHourMatch[1], 10) * 3600 * 1000;
    }

    // 2. Full ISO-8601 with explicit offset / Z
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
      const isoMs = new Date(s).getTime();
      if (Number.isFinite(isoMs) && isoMs > 0) return isoMs;
    }

    // Anchor wall-clock calendar date in dialer timezone
    const anchorParts = this.getZonedDateParts(getAnchorMs());
    let baseYear = anchorParts.year;
    let baseMonth = anchorParts.month; // 1-12
    let baseDay = anchorParts.day;
    let hasExplicitDate = false;
    let cleanStr = s;

    const relPrefix = s.match(/^(today|tomorrow|yesterday)\b[,\s]*(?:at\s*)?(.*)$/i);
    if (relPrefix) {
      hasExplicitDate = true;
      const kw = relPrefix[1].toLowerCase();
      let offsetDays = 0;
      if (kw === 'tomorrow') offsetDays = 1;
      else if (kw === 'yesterday') offsetDays = -1;
      const shiftedAnchor = this.getZonedDateParts(
        this.zonedWallTimeToUtcMs(baseYear, baseMonth, baseDay, 12, 0, 0) + offsetDays * 86400000
      );
      baseYear = shiftedAnchor.year;
      baseMonth = shiftedAnchor.month;
      baseDay = shiftedAnchor.day;
      cleanStr = (relPrefix[2] || '').trim();
      if (!cleanStr) {
        return this.zonedWallTimeToUtcMs(baseYear, baseMonth, baseDay, 9, 0, 0);
      }
    } else {
      const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const dateMatch = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?(?:[,\s]+(\d{4}))?(.*)$/i);
      if (dateMatch) {
        const mIdx = monthNames.indexOf(dateMatch[1].toLowerCase().slice(0, 3));
        if (mIdx !== -1) {
          hasExplicitDate = true;
          baseMonth = mIdx + 1;
          baseDay = parseInt(dateMatch[2], 10);
          if (dateMatch[3]) baseYear = parseInt(dateMatch[3], 10);
          cleanStr = (dateMatch[4] || '').replace(/^[,\s]+/, '').trim();
        }
      } else {
        const isoMatch = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[T,\s]+(.*))?$/);
        if (isoMatch) {
          hasExplicitDate = true;
          baseYear = parseInt(isoMatch[1], 10);
          baseMonth = parseInt(isoMatch[2], 10);
          baseDay = parseInt(isoMatch[3], 10);
          cleanStr = (isoMatch[4] || '').trim();
        } else {
          const dmyMatch = s.match(/^(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})(?:[,\s]+(.*))?$/);
          if (dmyMatch) {
            hasExplicitDate = true;
            const p1 = parseInt(dmyMatch[1], 10);
            const p2 = parseInt(dmyMatch[2], 10);
            baseYear = parseInt(dmyMatch[3], 10);
            if (p2 >= 1 && p2 <= 12 && p1 <= 31) {
              baseDay = p1; baseMonth = p2;
            } else {
              baseMonth = p1; baseDay = p2;
            }
            cleanStr = (dmyMatch[4] || '').trim();
          }
        }
      }
    }

    if (hasExplicitDate && (!cleanStr || this.isImmediateCallTime(cleanStr))) {
      return this.zonedWallTimeToUtcMs(baseYear, baseMonth, baseDay, 0, 0, 0);
    }

    // 3. Standard 12-hour format: "01:50 PM", "01:50:30 PM"
    const match12 = cleanStr.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*(AM|PM)/i);
    if (match12) {
      let hours = parseInt(match12[1], 10);
      const minutes = parseInt(match12[2], 10);
      const seconds = match12[3] ? parseInt(match12[3], 10) : 0;
      const ampm = match12[4].toUpperCase();

      if (ampm === 'PM' && hours < 12) hours += 12;
      else if (ampm === 'AM' && hours === 12) hours = 0;

      return this.zonedWallTimeToUtcMs(baseYear, baseMonth, baseDay, hours, minutes, seconds);
    }

    // 4. 24-hour time or bare time without AM/PM
    const matchTime = cleanStr.match(/(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/);
    if (matchTime) {
      let hours = parseInt(matchTime[1], 10);
      const minutes = parseInt(matchTime[2], 10);
      const seconds = matchTime[3] ? parseInt(matchTime[3], 10) : 0;
      const nowParts = this.getZonedDateParts(nowMs);

      if (!hasExplicitDate && hours >= 1 && hours <= 6 && nowParts.hour >= 12) {
        hours += 12;
      }

      return this.zonedWallTimeToUtcMs(baseYear, baseMonth, baseDay, hours, minutes, seconds);
    }

    // 5. Fallback Date parse (only accept realistic years >= 2020)
    try {
      const stripped = s.replace(/^Today,\s*/i, '').replace(/^Tomorrow,\s*/i, '');
      const parsedDate = new Date(stripped);
      if (!isNaN(parsedDate.getTime()) && parsedDate.getFullYear() >= 2020) {
        return parsedDate.getTime();
      }
    } catch (e) {}

    return 0;
  }

  startSchedulerLoop() {
    this.stopSchedulerLoop();
    this.schedulerInterval = setInterval(() => {
      if (this.isRunning && !this.isPaused) {
        const maxConcurrent = parseInt(document.getElementById('maxConcurrentInput')?.value || 2, 10);
        const l1Busy = !!this.line1?.activeChannelId || (this.line1?.session && this.line1.session.state !== 'Terminated');
        const l2Busy = !!this.line2?.activeChannelId || (this.line2?.session && this.line2.session.state !== 'Terminated');

        const isL1Free = !l1Busy;
        const isL2Free = maxConcurrent >= 2 && this.line2?.enabled && !l2Busy;

        if (isL1Free || isL2Free) {
          this.processOutboundQueue();
        }
      }
    }, 1000); // Check every 1 second for scheduled call arrivals
  }

  stopSchedulerLoop() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /* ─────────────────────────────────────────────────────────
     Automated Outbound Campaign Calling Engine (Dual-Line Ready)
     ───────────────────────────────────────────────────────── */
  async startCampaign() {
    // If already running and scheduler active, nothing to do
    if (this.isRunning && !this.isPaused && this.schedulerInterval) return;

    this._dialerTransitionLock = true;
    try {
      // Refresh latest queue data from database BEFORE asserting active status
      await this.loadCampaignData();

      let pendingLeads = this.getTodayLeads().filter(l => l.status === 'pending' && !this.isLeadFromPastDay(l));
      if (pendingLeads.length === 0) {
        pendingLeads = (this.leads || []).filter(l => l.status === 'pending' && !this.isLeadFromPastDay(l));
      }
      if (pendingLeads.length === 0) {
        const pastDayPending = (this.leads || []).filter(l => l.status === 'pending').length;
        this.isRunning = false;
        this.isPaused = false;
        this.stopSchedulerLoop();
        this.syncDialerControlButtons();
        if (pastDayPending > 0) {
          this.showToast(`Found ${pastDayPending} contact(s) from previous days. Click Rollover to Today or Reset Leads before starting.`, 'warning');
        } else {
          this.showToast('No pending leads in queue! Import an Excel file, add numbers, or roll over remaining calls from History.', 'warning');
        }
        return;
      }

      // Persist running status synchronously before starting scheduler loop
      if (this.campaign && this.campaign.id) {
        const formData = new FormData();
        formData.append('campaign_id', this.campaign.id);
        formData.append('status', 'running');
        try {
          await fetch('api.php?action=set_campaign_status', { method: 'POST', body: formData });
        } catch (e) {}
        this.campaign.status = 'running';
      }

      this.isRunning = true;
      this.isPaused = false;
      this.syncDialerControlButtons();

      const l1Registered = this.line1?.isRegistered;
      const l2Registered = this.line2?.enabled && this.line2?.isRegistered;
      const lineMode = (this.line2?.enabled) ? 'Dual-Line (2 Concurrent Numbers)' : 'Single Line';

      if (l1Registered || l2Registered) {
        this.showToast(`Auto-Dialer active [${lineMode}] (SIP Softphone Connected): Monitoring queue...`, 'success');
      } else {
        this.showToast(`Auto-Dialer active [${lineMode}] (Voice Broadcast Mode): Monitoring queue...`, 'success');
      }

      this.renderCampaignHeader();
      this.startSchedulerLoop();
      this.processOutboundQueue();
    } finally {
      this._dialerTransitionLock = false;
    }
  }

  async togglePauseCampaign() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    this.syncDialerControlButtons();
    this.renderCampaignHeader();
    this.showToast(this.isPaused ? 'Auto-Dialer Paused' : 'Auto-Dialer Resumed', 'info');

    this._dialerTransitionLock = true;
    try {
      if (this.campaign && this.campaign.id) {
        const formData = new FormData();
        formData.append('campaign_id', this.campaign.id);
        formData.append('status', this.isPaused ? 'paused' : 'running');
        try {
          await fetch('api.php?action=set_campaign_status', { method: 'POST', body: formData });
        } catch (e) {}
        this.campaign.status = this.isPaused ? 'paused' : 'running';
      }

      if (!this.isPaused) {
        this.startSchedulerLoop();
        this.processOutboundQueue();
      } else {
        this.stopSchedulerLoop();
        if (this._displayCountdownTimer) {
          clearInterval(this._displayCountdownTimer);
          this._displayCountdownTimer = null;
        }
      }
    } finally {
      this._dialerTransitionLock = false;
    }
  }

  stopCampaign() {
    this._dialerTransitionLock = true;
    this.isRunning = false;
    this.isPaused = false;
    this.stopSchedulerLoop();
    if (this._displayCountdownTimer) {
      clearInterval(this._displayCountdownTimer);
      this._displayCountdownTimer = null;
    }
    this.nextScheduledLeadWaiting = null;
    this.syncDialerControlButtons();

    if (this.campaign && this.campaign.id) {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign.id);
      formData.append('status', 'idle');
      fetch('api.php?action=set_campaign_status', { method: 'POST', body: formData })
        .catch(() => {})
        .finally(() => { this._dialerTransitionLock = false; });
      this.campaign.status = 'idle';
    } else {
      this._dialerTransitionLock = false;
    }

    // Terminate any in-flight SIP or IVR audio on both lines
    this.sipHangup(1);
    this.sipHangup(2);
    if (this.activeAudioPlayer) {
      try { this.activeAudioPlayer.pause(); } catch(e) {}
      this.activeAudioPlayer = null;
    }

    this.activeChannels.forEach(ch => {
      if (ch.timerInterval) clearInterval(ch.timerInterval);
    });
    this.activeChannels.clear();
    if (this.line1) this.line1.activeChannelId = null;
    if (this.line2) this.line2.activeChannelId = null;

    this.renderActiveChannels();
    this.renderCampaignHeader();
    this.showToast('Auto-Dialer Stopped', 'info');
  }

  async processOutboundQueue() {
    if (!this.isRunning || this.isPaused || this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    try {
      const maxConcurrent = parseInt(document.getElementById('maxConcurrentInput')?.value || 2, 10);
      const pacingDelay = parseInt(document.getElementById('pacingDelayInput')?.value || 2, 10);

      // Collect currently active lead IDs and normalized phone numbers across both channels
      const activeLeadIds = new Set();
      const activePhoneNumbers = new Set();
      this.activeChannels.forEach(ch => {
        if (ch.lead?.id) activeLeadIds.add(Number(ch.lead.id));
        if (ch.lead?.phone_number) {
          activePhoneNumbers.add(window.skykinNormalizeEtDial(ch.lead.phone_number));
        }
      });

      // Filter today & future pending leads (excluding previous-day leads or numbers already in progress)
      let pendingLeads = this.getTodayLeads().filter(l => {
        if (l.status !== 'pending') return false;
        if (this.isLeadFromPastDay(l)) return false;
        if (activeLeadIds.has(Number(l.id))) return false;
        const normPhone = window.skykinNormalizeEtDial(l.phone_number);
        if (activePhoneNumbers.has(normPhone)) return false;
        return true;
      });

      // Fallback: check future scheduled leads across this.leads when today has none left
      if (pendingLeads.length === 0) {
        pendingLeads = (this.leads || []).filter(l => {
          if (l.status !== 'pending') return false;
          if (this.isLeadFromPastDay(l)) return false;
          if (activeLeadIds.has(Number(l.id))) return false;
          const normPhone = window.skykinNormalizeEtDial(l.phone_number);
          if (activePhoneNumbers.has(normPhone)) return false;
          return true;
        });
      }

      if (pendingLeads.length === 0 && this.activeChannels.size === 0) {
        const anyRemaining = (this.leads || []).some(l => l.status === 'pending');
        if (!anyRemaining) {
          this.stopCampaign();
          this.showToast('All pending customer leads in queue have been processed!', 'success');
          await this.loadCampaignData();
        } else {
          this.renderActiveChannels();
        }
        return;
      }

      const now = this.getServerNow();

      // 1. Immediate leads
      const immediateLeads = pendingLeads.filter(l => this.isImmediateCallTime(l.call_time));

      // 2. Scheduled leads whose time has arrived (including same-day delayed calls)
      const dueScheduledLeads = pendingLeads.filter(l => {
        if (this.isImmediateCallTime(l.call_time)) return false;
        return this.isLeadDueForCall(l);
      });

      dueScheduledLeads.sort((a, b) => {
        const aTime = this.getLeadScheduledTimestamp(a);
        const bTime = this.getLeadScheduledTimestamp(b);
        return aTime - bTime;
      });

      const dueLeads = [...dueScheduledLeads, ...immediateLeads];

      // Check which lines are free
      const isLine1Free = !this.line1?.activeChannelId && (!this.line1?.session || this.line1.session.state === 'Terminated');
      const isLine2Free = maxConcurrent >= 2 && this.line2?.enabled && !this.line2?.activeChannelId && (!this.line2?.session || this.line2.session.state === 'Terminated');

      const availableDue = [...dueLeads];

      // Dispatch Line 1 if free
      if (isLine1Free && availableDue.length > 0 && this.activeChannels.size < maxConcurrent) {
        const lead1 = availableDue.shift();
        lead1.status = 'calling';
        activeLeadIds.add(Number(lead1.id));
        activePhoneNumbers.add(window.skykinNormalizeEtDial(lead1.phone_number));
        this.renderLeadsTables();
        this.updateLeadStatusBackend(lead1.id, 'calling', 0);
        this.dialCustomerLead(lead1, 1, pacingDelay);
      }

      // Dispatch Line 2 simultaneously if free and another distinct number is due
      if (isLine2Free && availableDue.length > 0 && this.activeChannels.size < maxConcurrent) {
        const l2Idx = availableDue.findIndex(l => {
          const norm = window.skykinNormalizeEtDial(l.phone_number);
          return !activeLeadIds.has(Number(l.id)) && !activePhoneNumbers.has(norm);
        });
        if (l2Idx !== -1) {
          const lead2 = availableDue.splice(l2Idx, 1)[0];
          lead2.status = 'calling';
          activeLeadIds.add(Number(lead2.id));
          activePhoneNumbers.add(window.skykinNormalizeEtDial(lead2.phone_number));
          this.renderLeadsTables();
          this.updateLeadStatusBackend(lead2.id, 'calling', 0);
          this.dialCustomerLead(lead2, 2, pacingDelay);
        }
      }

      if (this.activeChannels.size === 0) {
        this.renderActiveChannels();
      }
    } finally {
      this._isProcessingQueue = false;
    }
  }

  getNextLeadInQueue() {
    const now = this.getServerNow();
    let pending = (this.leads || []).filter(l => l.status === 'pending' && !this.isLeadFromPastDay(l));
    if (pending.length === 0) return null;

    // Filter to active campaign if activeCampaignId is set
    const campId = Number(this.activeCampaignId || this.campaign?.id || 0);
    if (campId > 0) {
      const campPending = pending.filter(l => Number(l.campaign_id) === campId);
      if (campPending.length > 0) {
        pending = campPending;
      }
    }

    const dueNowLeads = [];
    const futureLeads = [];
    const immediateLeads = [];

    pending.forEach(l => {
      if (this.isImmediateCallTime(l.call_time)) {
        immediateLeads.push(l);
      } else {
        const ts = this.getLeadScheduledTimestamp(l);
        if (this.isLeadDueForCall(l)) {
          dueNowLeads.push(l);
        } else if (ts > now) {
          futureLeads.push(l);
        }
      }
    });

    // 1. Prioritize scheduled calls whose time has arrived (sorted earliest scheduled call first)
    if (dueNowLeads.length > 0) {
      dueNowLeads.sort((a, b) => this.getLeadScheduledTimestamp(a) - this.getLeadScheduledTimestamp(b));
      return dueNowLeads[0];
    }

    // 2. Immediate calls
    if (immediateLeads.length > 0) {
      return immediateLeads[0];
    }

    // 3. Next upcoming future scheduled calls (sorted nearest upcoming time first)
    if (futureLeads.length > 0) {
      futureLeads.sort((a, b) => this.getLeadScheduledTimestamp(a) - this.getLeadScheduledTimestamp(b));
      return futureLeads[0];
    }

    return null;
  }

  async dialCustomerLead(lead, lineNum = 1, pacingDelay = 2) {
    const channelId = `ch_l${lineNum}_${lead.id}_${Date.now()}`;
    const audioSrc = lead.ivr_audio_file || this.campaign?.ivr_audio_file || (this.audioRecordings?.[0]?.filepath) || '';
    const dom = localStorage.getItem('sip_domain') || this.sipDomain || 'client1.skykin.local';

    const lineObj = lineNum === 2 ? this.line2 : this.line1;
    lineObj.activeChannelId = channelId;

    const channelData = {
      channelId: channelId,
      lineNum: lineNum,
      lineExt: lineObj.ext,
      lead: lead,
      status: 'dialing',
      duration: 0,
      startTime: Date.now(),
      timerInterval: null
    };
    this.activeChannels.set(channelId, channelData);

    this.renderActiveChannels();
    this.renderLeadsTables();

    let isFinished = false;
    const finishCall = async (finalStatus, durationSec, errorMsg = '', dtmfPressed = '') => {
      if (isFinished) return;
      isFinished = true;

      if (channelData.ivrTimeoutTimer) {
        clearTimeout(channelData.ivrTimeoutTimer);
        channelData.ivrTimeoutTimer = null;
      }
      if (channelData.timerInterval) clearInterval(channelData.timerInterval);
      this.activeChannels.delete(channelId);
      lineObj.activeChannelId = null;

      const finalDtmf = dtmfPressed || channelData.dtmfPressed || lead.dtmf_response || '';
      const finalOutcome = errorMsg || channelData.dtmfOutcome || lead.error_message || '';

      lead.status = finalStatus;
      lead.duration_sec = durationSec;
      if (finalOutcome) lead.error_message = finalOutcome;
      if (finalDtmf) lead.dtmf_response = finalDtmf;
      this.renderActiveChannels();
      this.renderLeadsTables();

      await this.updateLeadStatusBackend(lead.id, finalStatus, durationSec, finalOutcome, finalDtmf);
      await this.loadCampaignData();

      // Proceed to the next customer in the queue for this line
      if (this.isRunning && !this.isPaused) {
        const delay = Math.max(1, pacingDelay);
        setTimeout(() => {
          if (this.isRunning && !this.isPaused) {
            this.processOutboundQueue();
          }
        }, delay * 1000);
      }
    };

    if (!lineObj.isRegistered || !lineObj.ua) {
      // Voice Broadcast Mode / Telephony Engine Mode
      channelData.status = 'ringing';
      lead.status = 'calling';
      this.renderActiveChannels();
      this.renderLeadsTables();
      this.updateLeadStatusBackend(lead.id, 'calling', 0);

      let callSec = 0;
      let broadcastAudio = null;
      let ringingTimeout = null;

      channelData.cancelRinging = () => {
        if (ringingTimeout) clearTimeout(ringingTimeout);
      };
      channelData.finishCall = (st, dur, err, dtmf) => finishCall(st, dur, err, dtmf);

      ringingTimeout = setTimeout(async () => {
        if (isFinished || !this.isRunning) return;

        channelData.status = 'answered';
        lead.status = 'answered';
        this.renderActiveChannels();
        this.renderLeadsTables();
        await this.updateLeadStatusBackend(lead.id, 'answered', 1);
        this.showToast(`Line ${lineNum}: Connected to ${lead.customer_name || 'Customer'} (${lead.phone_number})`, 'success');

        channelData.timerInterval = setInterval(() => {
          callSec++;
          channelData.duration = callSec;
          lead.duration_sec = callSec;
          this.renderActiveChannels();
        }, 1000);

        await this.startIvrSessionForChannel(channelData, null, lineNum, audioSrc, finishCall);
      }, 2500);

      return;
    }

    let callSec = 0;
    this.sipMakeCall(lead.phone_number, dom, {
      onEstablishing: () => {
        channelData.status = 'ringing';
        lead.status = 'calling';
        this.renderActiveChannels();
        this.renderLeadsTables();
      },
      onEstablished: async (pc) => {
        channelData.status = 'answered';
        lead.status = 'answered';
        this.renderActiveChannels();
        this.renderLeadsTables();
        await this.updateLeadStatusBackend(lead.id, 'answered', 1);

        channelData.timerInterval = setInterval(() => {
          callSec++;
          channelData.duration = callSec;
          lead.duration_sec = callSec;
          this.renderActiveChannels();
        }, 1000);

        await this.startIvrSessionForChannel(channelData, pc, lineNum, audioSrc, finishCall);
      },
      onTerminated: () => {
        const curDtmf = channelData.dtmfPressed || lead.dtmf_response || '';
        const isCb = channelData.isCallbackRequested || (channelData.dtmfOutcome && channelData.dtmfOutcome.toLowerCase().includes('callback'));
        const curOutcome = channelData.dtmfOutcome || (curDtmf ? `Option ${curDtmf}` : (callSec > 0 ? 'Announcement listened' : 'No Answer'));
        const finalSt = isCb ? 'callback' : (callSec > 0 ? 'completed' : 'no_answer');
        finishCall(finalSt, callSec, curOutcome, curDtmf);
      },
      onError: (err) => {
        finishCall('failed', 0, err?.message || 'Call Failed');
      },
      onReject: (resp) => {
        finishCall('no_answer', 0, resp?.reasonPhrase || 'Declined / Busy');
      }
    }, lineNum);
  }

  renderAgentScreenIvrLive() {
    const box = document.getElementById('agentInteractiveIvrBox');
    if (!box) return;

    const ch = [...this.activeChannels.values()].find(c => c.ivrMode === 'interactive' || c.status === 'answered') || [...this.activeChannels.values()][0];

    if (!ch || ch.ivrMode !== 'interactive' || (ch.status !== 'answered' && ch.status !== 'connected')) {
      box.style.display = 'none';
      return;
    }

    box.style.display = 'block';

    const stepBadge = document.getElementById('agentIvrStepBadge');
    const descEl = document.getElementById('agentIvrStatusDesc');
    const keyAlert = document.getElementById('agentIvrKeyDetectedAlert');
    const keyNumEl = document.getElementById('agentIvrDetectedKeyNum');
    const keyLabelEl = document.getElementById('agentIvrDetectedKeyLabel');
    const keypadBtnsContainer = document.getElementById('agentIvrLiveKeypadButtons');

    if (ch.dtmfPressed) {
      if (stepBadge) {
        stepBadge.textContent = `Key [${ch.dtmfPressed}] Detected`;
        stepBadge.style.background = '#e0f2fe';
        stepBadge.style.color = '#0369a1';
        stepBadge.style.borderColor = '#bae6fd';
      }
      if (descEl) {
        descEl.textContent = ch.ivrState === 'playing_response_audio'
          ? `Playing response audio for Option ${ch.dtmfPressed}...`
          : `Caller selected Option ${ch.dtmfPressed}: ${ch.dtmfOutcome || 'Confirmed'}. Finalizing call.`;
      }
      if (keyAlert) {
        keyAlert.style.display = 'inline-flex';
        if (keyNumEl) keyNumEl.textContent = ch.dtmfPressed;
        if (keyLabelEl) keyLabelEl.textContent = ch.dtmfOutcome || 'Selected';
      }
    } else {
      if (keyAlert) keyAlert.style.display = 'none';

      if (ch.ivrState === 'playing_greeting') {
        if (stepBadge) {
          stepBadge.textContent = 'Step 1: Playing Greeting';
          stepBadge.style.background = '#e8f8ee';
          stepBadge.style.color = '#007A3D';
          stepBadge.style.borderColor = '#bbf7d0';
        }
        if (descEl) descEl.textContent = 'Caller is listening to opening announcement. Keypad is active for input.';
      } else if (ch.ivrState === 'playing_menu') {
        if (stepBadge) {
          stepBadge.textContent = 'Step 2: Playing Menu';
          stepBadge.style.background = '#fef3c7';
          stepBadge.style.color = '#b45309';
          stepBadge.style.borderColor = '#fde68a';
        }
        if (descEl) descEl.textContent = 'Playing menu instructions. Awaiting key press...';
      } else if (ch.ivrState === 'playing_option') {
        if (stepBadge) {
          stepBadge.textContent = ch.currentAudioName || 'Playing Option';
          stepBadge.style.background = '#fef3c7';
          stepBadge.style.color = '#b45309';
          stepBadge.style.borderColor = '#fde68a';
        }
        if (descEl) descEl.textContent = `Playing ${ch.currentAudioName || 'menu option'}. Keypad is active for caller input.`;
      } else {
        if (stepBadge) {
          stepBadge.textContent = 'Awaiting Caller Keypad';
          stepBadge.style.background = '#eff6ff';
          stepBadge.style.color = '#1d4ed8';
          stepBadge.style.borderColor = '#bfdbfe';
        }
        if (descEl) descEl.textContent = 'Waiting for caller to press a number key on their phone keypad...';
      }
    }

    if (keypadBtnsContainer) {
      const keysObj = ch.ivrConfig?.keys || this.ivrResponses?.keys || {
        '1': { key: '1', outcome: 'Confirmed' },
        '2': { key: '2', outcome: 'Callback requested' }
      };
      const keyList = Object.values(keysObj);
      keypadBtnsContainer.innerHTML = keyList.map(k => `
        <button type="button" class="ivr-live-keypad-btn" onclick="app.handleIvrDtmfInput(${ch.lineNum || 1}, '${k.key}')" title="Click to simulate or register key ${k.key}">
          <span class="ivr-key-num" style="background:#00A651;width:18px;height:18px;font-size:11px;">${k.key}</span>
          <span>${this.escapeHtml(k.outcome || ('Option ' + k.key))}</span>
        </button>
      `).join('');
    }
  }

  renderActiveChannels() {
    if (!this.channelsContainer) return;
    this.updateTelephonyKpiCards();
    this.renderAgentScreenIvrLive();

    if (this._displayCountdownTimer) {
      clearInterval(this._displayCountdownTimer);
      this._displayCountdownTimer = null;
    }

    this.channelsContainer.innerHTML = '';

    // 1. In-Call State (Active calling lines with live duration)
    if (this.activeChannels.size > 0) {
      this.activeChannels.forEach((ch, id) => {
        const mins = Math.floor(ch.duration / 60);
        const secs = ch.duration % 60;
        const durStr = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        const campDisplay = ch.lead.campaign_name || this.campaign?.name || 'Outbound';
        const audioNameDisplay = ch.lead.ivr_audio_name || this.campaign?.ivr_audio_name || 'Human Greeting';
        const isAnswered = (ch.status === 'answered');
        const isInteractive = (ch.ivrMode === 'interactive');

        let modeBadge = 'Dialing...';
        if (isAnswered) {
          modeBadge = isInteractive ? 'Interactive IVR Menu' : 'Announcement IVR';
        }

        let interactiveHtml = '';
        if (isAnswered && isInteractive) {
          if (ch.dtmfPressed) {
            interactiveHtml = `
              <div style="font-size:11.5px;color:#0369a1;background:#e0f2fe;border:1px solid #bae6fd;padding:6px 10px;border-radius:6px;font-weight:700;margin-top:6px;">
                Key [${ch.dtmfPressed}] Pressed: ${this.escapeHtml(ch.dtmfOutcome || '')}
                ${ch.ivrState === 'playing_response_audio' ? '<br><span style="font-size:10.5px;color:#0284c7;font-weight:600;">🔊 Playing Key Response Audio...</span>' : ''}
              </div>
            `;
          } else {
            const stepLabel = ch.ivrState === 'playing_greeting'
              ? '🔊 Step 1: Playing Greeting Audio'
              : (ch.ivrState === 'playing_menu'
                  ? '📢 Step 2: Playing Menu Instructions (Press 1 or 2)'
                  : '⏳ Step 3: Awaiting Customer Keypad (1 or 2)');
            const keysObj = ch.ivrConfig?.keys || {};
            const keyList = Object.values(keysObj);
            interactiveHtml = `
              <div style="font-size:11px;color:#334155;background:#f8fafc;padding:6px 8px;border-radius:6px;border:1px solid #e2e8f0;margin-top:6px;">
                <div style="font-weight:700;margin-bottom:4px;color:#0369a1;font-size:11px;">${stepLabel}</div>
                <div style="font-weight:600;margin-bottom:4px;color:#64748b;font-size:10.5px;">Keypad Options (Caller phone or click to simulate):</div>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  ${keyList.map(k => `
                    <button type="button" class="btn btn-xs btn-outline-success" onclick="app.handleIvrDtmfInput(${ch.lineNum}, '${k.key}')" style="font-size:11px;font-weight:700;padding:2px 8px;background:#fff;border-color:#86efac;color:#166534;" title="${this.escapeHtml(k.outcome || k.action)}">
                      [${k.key}] ${this.escapeHtml(k.outcome || k.action)}
                    </button>
                  `).join('')}
                </div>
              </div>
            `;
          }
        } else if (isAnswered && !isInteractive) {
          interactiveHtml = `
            <div style="font-size:11px;color:#166534;background:#f0fdf4;border:1px solid #bbf7d0;padding:4px 8px;border-radius:4px;margin-top:6px;">
              📢 Play &amp; Hang Up Mode: Call will auto-disconnect upon completion.
            </div>
          `;
        }

        const card = document.createElement('div');
        card.className = `channel-card ${isAnswered ? 'connected' : 'ringing'}`;
        card.innerHTML = `
          <div class="ch-header">
            <span class="ch-badge ${isAnswered ? 'active' : 'dialing'}">
              Line ${ch.lineNum} (Ext ${ch.lineExt}) &bull; ${modeBadge}
            </span>
            <span style="font-family:monospace;font-weight:700;color:#0c3629;">${durStr}</span>
          </div>
          <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:2px;">
            ${this.escapeHtml(ch.lead.customer_name || 'Customer')}
          </div>
          <div style="font-size:12px;color:#64748b;margin-bottom:6px;">
            ${this.escapeHtml(ch.lead.phone_number)} &bull; <span style="color:#00A651;font-weight:700;">${this.escapeHtml(campDisplay)}</span>
          </div>
          <div style="font-size:11px;color:#0c3629;background:#eaf8f0;border:1px solid #bce8ce;padding:4px 8px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
            <span>${this.escapeHtml(ch.currentAudioName || audioNameDisplay)}</span>
            <button class="btn btn-secondary btn-sm" onclick="app.sipHangup(${ch.lineNum})" style="padding:1px 6px;font-size:10px;height:auto;line-height:1.2;">End Call</button>
          </div>
          ${interactiveHtml}
        `;
        this.channelsContainer.appendChild(card);
      });
      return;
    }

    // Helper: build countdown text from a timestamp using synchronized server clock
    const makeCountdown = (targetTs) => {
      const diff = Math.max(0, Math.ceil((targetTs - this.getServerNow()) / 1000));
      if (diff <= 0) return 'Calling now...';
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) return `${h}h ${m}m ${s}s`;
      if (m > 0) return `${m}m ${s}s`;
      return `${s}s`;
    };

    // Get the next lead (future-prioritized)
    const next = this.getNextLeadInQueue();
    const targetTs = next ? this.getLeadScheduledTimestamp(next) : 0;
    const isFuture = targetTs > this.getServerNow();

    // 2. Auto-Dialer Running
    if (this.isRunning) {
      if (!next) {
        const pendingCount = (this.leads || []).filter(l => l.status === 'pending').length;
        if (pendingCount > 0) {
          this.channelsContainer.innerHTML = `
            <div style="grid-column:1/-1;background:#fffbeb;border:1.5px solid #fde68a;border-radius:10px;padding:16px;text-align:center;">
              <div style="font-weight:700;color:#92400e;font-size:14px;margin-bottom:4px;">
                Auto-Dialer Active &bull; Historical Leads Remaining
              </div>
              <div style="font-size:12.5px;color:#a16207;">
                ${pendingCount} pending contact(s) belong to previous calendar days. Click Rollover to Today, Reset Leads, or click "Call" on a row to dial manually.
              </div>
            </div>
          `;
          return;
        }

        this.channelsContainer.innerHTML = `
          <div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-weight:700;color:#64748b;font-size:13px;margin-bottom:2px;">Auto-Dialer Idle &bull; All Contacts Completed</div>
            <div style="font-size:12px;color:#94a3b8;">All contacts in queue have been dialed. Add numbers or click "Reset Leads" to dial again.</div>
          </div>
        `;
        return;
      }

      // Render the waiting card with a live countdown or immediate dial indicator
      const countdownId = `cd_${Date.now()}`;
      this.channelsContainer.innerHTML = `
        <div style="grid-column:1/-1;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:18px 20px;text-align:center;">
          <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:7px;">
            <span style="width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block;animation:pulse 1.2s ease-in-out infinite;"></span>
            Auto-Dialer Active &bull; ${isFuture ? 'Next Scheduled Call' : 'Next Call in Queue'}
          </div>
          <div style="font-size:14px;color:#1e293b;font-weight:600;margin-bottom:4px;">
            ${this.escapeHtml(next.customer_name || 'Customer')}
            <span style="color:#64748b;font-weight:400;"> &middot; </span>
            <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(next.phone_number)}')" style="color:#00A651;font-weight:700;text-decoration:none;">${this.escapeHtml(next.phone_number)}</a>
          </div>
          <div style="font-size:12.5px;color:#166534;margin-bottom:8px;">
            Scheduled: <strong>${this.escapeHtml(next.call_time || 'Immediate')}</strong>
          </div>
          <div id="${countdownId}" style="display:inline-block;background:#dcfce7;color:#15803d;font-weight:800;font-size:20px;padding:6px 20px;border-radius:20px;font-family:monospace;letter-spacing:1px;">
            ${isFuture ? makeCountdown(targetTs) : 'Dialing next contact...'}
          </div>
        </div>
      `;

      if (isFuture) {
        this._displayCountdownTimer = setInterval(() => {
          const el = document.getElementById(countdownId);
          if (!el) { clearInterval(this._displayCountdownTimer); return; }
          el.textContent = makeCountdown(targetTs);
        }, 1000);
      }
      return;
    }

    // 3. Auto-Dialer is Idle
    if (!next) {
      this.channelsContainer.innerHTML = `
        <div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #e2e8f0;border-radius:8px;padding:14px;text-align:center;color:#94a3b8;font-size:12px;">
          No active calls. Add numbers to the queue or click <strong>Start Auto-Dialer</strong>.
        </div>
      `;
      return;
    }

    const countdownIdIdle = `cd_idle_${Date.now()}`;
    this.channelsContainer.innerHTML = `
      <div style="grid-column:1/-1;background:#f8fafc;border:1.5px dashed #bce8ce;border-radius:10px;padding:16px 18px;text-align:center;">
        <div style="font-weight:700;color:#00A651;font-size:13px;margin-bottom:4px;">
          Next Scheduled Call
        </div>
        <div style="font-size:14px;color:#1e293b;font-weight:600;margin-bottom:3px;">
          ${this.escapeHtml(next.customer_name || 'Customer')}
          <span style="color:#64748b;font-weight:400;"> &middot; </span>
          ${this.escapeHtml(next.phone_number)}
        </div>
        <div style="font-size:12px;color:#475569;margin-bottom:8px;">
          Scheduled: <strong>${this.escapeHtml(next.call_time || 'Immediate')}</strong>
        </div>
        ${isFuture ? `<div id="${countdownIdIdle}" style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-weight:700;font-size:16px;padding:4px 16px;border-radius:16px;font-family:monospace;">${makeCountdown(targetTs)}</div>` : ''}
        <div style="font-size:11px;color:#94a3b8;margin-top:8px;">Click <strong style="color:#15803d;">Start Auto-Dialer</strong> to enable automatic calling at scheduled time.</div>
      </div>
    `;

    if (isFuture) {
      this._displayCountdownTimer = setInterval(() => {
        const el = document.getElementById(countdownIdIdle);
        if (!el) { clearInterval(this._displayCountdownTimer); return; }
        el.textContent = makeCountdown(targetTs);
      }, 1000);
    }
  }

  async updateLeadStatusBackend(leadId, status, duration, errorMsg = '', dtmf = '') {
    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('status', status);
      formData.append('duration_sec', duration);
      formData.append('audio_played', this.campaign?.ivr_audio_name || (this.audioRecordings?.[0]?.name) || 'IVR Audio');
      if (errorMsg) formData.append('error_message', errorMsg);
      if (dtmf) formData.append('dtmf_response', dtmf);

      await fetch('api.php?action=update_lead_status', { method: 'POST', body: formData });
    } catch (e) {
      console.error(e);
    }
  }

    async resetLeads() {
    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', campId);
      const res = await fetch('api.php?action=reset_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || 'All leads reset to pending. Elapsed scheduled calls reset to Immediate.', 'success');
        await this.loadCampaignData();
        if (this.isRunning && !this.isPaused) {
          this.processOutboundQueue();
        }
      } else {
        this.showToast(data.error || 'Failed to reset leads', 'error');
      }
    } catch (e) {
      this.showToast('Network error resetting leads', 'error');
    }
  }

  async clearQueue() {
    if (!confirm('Are you sure you want to clear all leads in the current calling queue?')) return;
    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', campId);
      const res = await fetch('api.php?action=clear_all_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast('Calling queue cleared.', 'info');
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to clear queue', 'error');
      }
    } catch (e) {
      this.showToast('Network error clearing queue', 'error');
    }
  }

  async deleteLead(leadId) {
    if (String(leadId).startsWith('sample_')) {
      this._deletedSampleIds = this._deletedSampleIds || new Set();
      this._deletedSampleIds.add(leadId);
      this.renderDesignerContactsTable();
      this.showToast('Contact removed', 'info');
      return;
    }
    // Ultra-fast optimistic UI removal (0ms latency)
    const originalLeads = [...this.leads];
    this.leads = this.leads.filter(l => Number(l.id) !== Number(leadId));
    this.renderLeadsTables();
    this.renderUnansweredTable();
    this.updateLocalStats();
    this.renderActiveChannels();
    this.renderDesignerContactsTable();
    this.showToast('Lead removed', 'info');

    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('campaign_id', this.campaign?.id || 1);
      await fetch('api.php?action=delete_lead', { method: 'POST', body: formData });
    } catch (e) {
      // Revert if network failed
      this.leads = originalLeads;
      this.renderLeadsTables();
      this.renderUnansweredTable();
      this.updateLocalStats();
      this.renderActiveChannels();
      this.renderDesignerContactsTable();
      this.showToast('Could not delete lead from server', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Quick Add Single Contact & Scheduler with Date and Time
     ───────────────────────────────────────────────────────── */
  handleTimePresetChange(preset) {
    const customDate = document.getElementById('quickAddCustomDate');
    const customTime = document.getElementById('quickAddCustomTime');
    if (preset === 'custom') {
      const defParts = this.getZonedDateParts(this.getServerNow() + 15 * 60 * 1000);
      if (customDate) {
        customDate.style.display = 'inline-block';
        if (!customDate.value) {
          customDate.value = defParts.ymd;
        }
      }
      if (customTime) {
        customTime.style.display = 'inline-block';
        if (!customTime.value) {
          customTime.value = `${String(defParts.hour).padStart(2, '0')}:${String(defParts.minute).padStart(2, '0')}`;
        }
      }
    } else {
      if (customDate) customDate.style.display = 'none';
      if (customTime) customTime.style.display = 'none';
    }
  }

  handleModalPresetChange(preset) {
    const wrap = document.getElementById('modalCustomDateTimeWrap');
    const customDate = document.getElementById('modalAddCustomDate');
    const customTime = document.getElementById('modalAddCustomTime');
    if (preset === 'custom') {
      const defParts = this.getZonedDateParts(this.getServerNow() + 15 * 60 * 1000);
      if (wrap) wrap.style.display = 'flex';
      if (customDate && !customDate.value) {
        customDate.value = defParts.ymd;
      }
      if (customTime && !customTime.value) {
        customTime.value = `${String(defParts.hour).padStart(2, '0')}:${String(defParts.minute).padStart(2, '0')}`;
      }
    } else {
      if (wrap) wrap.style.display = 'none';
    }
  }

  getCalculatedCallTime(presetValue, dateVal = '', timeVal = '') {
    if (presetValue === 'immediate' || !presetValue) return 'Immediate';
    if (presetValue === 'custom') {
      const todayYmd = this.getLocalDateString();
      const d = dateVal ? dateVal.trim() : todayYmd;
      const tRaw = timeVal ? timeVal.trim() : '12:00';
      const tm = tRaw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM))?$/i);
      const [y, m, day] = d.split('-').map(Number);
      if (tm && y && m && day) {
        let hrs = parseInt(tm[1], 10);
        const mins = parseInt(tm[2], 10);
        const secs = tm[3] ? parseInt(tm[3], 10) : 0;
        if (tm[4]) {
          const ap = tm[4].toUpperCase();
          if (ap === 'PM' && hrs < 12) hrs += 12;
          else if (ap === 'AM' && hrs === 12) hrs = 0;
        }
        const targetMs = this.zonedWallTimeToUtcMs(y, m, day, hrs, mins, secs);
        return this.formatZonedCanonical(targetMs);
      }
      return `${d} ${tRaw}`;
    }
    const minsMatch = presetValue.match(/\+(\d+)min/);
    if (minsMatch) {
      const mins = parseInt(minsMatch[1], 10);
      const targetMs = this.getServerNow() + mins * 60 * 1000;
      return this.formatZonedCanonical(targetMs);
    }
    return 'Immediate';
  }

  async handleQuickAddSubmit(e) {
    if (e) e.preventDefault();
    const nameInp = document.getElementById('quickAddName');
    const phoneInp = document.getElementById('quickAddPhone');
    const presetSelect = document.getElementById('quickAddTimePreset');
    const customDate = document.getElementById('quickAddCustomDate')?.value;
    const customTime = document.getElementById('quickAddCustomTime')?.value;

    const name = nameInp?.value.trim() || 'Customer';
    const phone = phoneInp?.value.trim() || '';
    const callTime = this.getCalculatedCallTime(presetSelect?.value, customDate, customTime);

    if (!phone) {
      this.showToast('Please enter a phone number', 'error');
      return null;
    }

    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      formData.append('customer_name', name);
      formData.append('phone_number', phone);
      formData.append('call_time', callTime);
      formData.append('notes', 'Quick Add');

      const res = await fetch('api.php?action=add_single_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.syncServerClock(data);
        this.showToast(data.message || `Contact ${name} added!`, 'success');
        if (nameInp) nameInp.value = '';
        if (phoneInp) phoneInp.value = '';
        if (presetSelect) presetSelect.value = 'immediate';
        document.getElementById('quickAddCustomDate')?.style.setProperty('display', 'none');
        document.getElementById('quickAddCustomTime')?.style.setProperty('display', 'none');

        if (data.lead) {
          this.leads.push(data.lead);
          this.renderLeadsTables();
          this.renderUnansweredTable();
          this.updateLocalStats();
          this.renderActiveChannels();
        } else {
          this.loadCampaignData();
        }
        return data.lead;
      } else {
        this.showToast(data.error || 'Failed to add contact', 'error');
        return null;
      }
    } catch(err) {
      this.showToast('Network error adding contact', 'error');
      return null;
    }
  }

  async quickAddAndCall() {
    const nameInp = document.getElementById('quickAddName');
    const phoneInp = document.getElementById('quickAddPhone');
    const name = nameInp?.value.trim() || 'Customer';
    const phone = phoneInp?.value.trim() || '';

    if (!phone) {
      this.showToast('Please enter a phone number to call', 'error');
      return;
    }

    const lead = await this.handleQuickAddSubmit();
    if (lead) {
      this.dialCustomerLead(lead, 1, 2);
    } else if (phone) {
      this.clickToDial(phone, name);
    }
  }

  dialSingleLeadWithIvr(leadId) {
    const lead = this.leads.find(l => Number(l.id) === Number(leadId));
    if (!lead) return;
    this.dialCustomerLead(lead, 1, 2);
  }

  async handleModalSingleAdd(e) {
    if (e) e.preventDefault();
    const nameInp = document.getElementById('modalAddName');
    const phoneInp = document.getElementById('modalAddPhone');
    const acctInp = document.getElementById('modalAddAccount');
    const debtInp = document.getElementById('modalAddDebt');
    const presetSelect = document.getElementById('modalAddTimePreset');
    const customDate = document.getElementById('modalAddCustomDate')?.value;
    const customTime = document.getElementById('modalAddCustomTime')?.value;
    const notesInp = document.getElementById('modalAddNotes');

    const name = nameInp?.value.trim() || 'Customer';
    const phone = phoneInp?.value.trim() || '';
    const account = acctInp?.value.trim() || '';
    const debt = debtInp?.value.trim() || '0.00';
    const notes = notesInp?.value.trim() || 'Quick Add';
    const callTime = this.getCalculatedCallTime(presetSelect?.value, customDate, customTime);

    if (!phone) {
      this.showToast('Please enter a phone number', 'error');
      return;
    }

    try {
      const targetCampaignId = document.getElementById('singleAddCampaignSelect')?.value || this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', targetCampaignId);
    formData.append('client_time', Math.floor(Date.now() / 1000));
    formData.append('client_timezone', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Addis_Ababa');
      formData.append('customer_name', name);
      formData.append('phone_number', phone);
      formData.append('account_number', account);
      formData.append('debt_amount', debt);
      formData.append('call_time', callTime);
      formData.append('notes', notes);

      const res = await fetch('api.php?action=add_single_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Contact ${name} added to PostgreSQL queue!`, 'success');
        if (nameInp) nameInp.value = '';
        if (phoneInp) phoneInp.value = '';
        if (acctInp) acctInp.value = '';
        if (debtInp) debtInp.value = '';
        if (notesInp) notesInp.value = '';
        if (presetSelect) presetSelect.value = 'immediate';
        const wrap = document.getElementById('modalCustomDateTimeWrap');
        if (wrap) wrap.style.display = 'none';

        this.closeModal('modalSingleAdd');
        await this.loadCampaignsOverview();
        if (String(this.campaign?.id) === String(targetCampaignId)) {
          await this.loadCampaignData(targetCampaignId);
        }
      } else {
        this.showToast(data.error || 'Failed to add contact', 'error');
      }
    } catch(err) {
      this.showToast('Network error adding contact', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Audio & File Upload Handlers
     ───────────────────────────────────────────────────────── */
  async handleAudioUpload(e) {
    if (e) e.preventDefault();
    const nameInp = document.getElementById('audioNameInput');
    const fileInp = document.getElementById('audioFileInput');
    const submitBtn = document.getElementById('btnUploadAudioSubmit');

    if (!fileInp || !fileInp.files || fileInp.files.length === 0) {
      this.showToast('Please select an audio file (.wav or .mp3) to upload.', 'error');
      return;
    }

    const file = fileInp.files[0];
    const name = nameInp?.value.trim() || file.name.replace(/\.[^/.]+$/, "");

    const formData = new FormData();
    formData.append('audio_file', file);
    formData.append('audio_name', name);
    formData.append('campaign_id', this.campaign?.id || 1);

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Uploading Audio...';
    }

    this.showToast('Uploading voice audio recording...', 'info');

    try {
      const res = await fetch('api.php?action=upload_audio', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Audio "${name}" uploaded & selected as Active IVR!`, 'success');
        if (nameInp) nameInp.value = '';
        if (fileInp) fileInp.value = '';
        this.closeAllModals();
        await this.loadCampaignData();

        // Switch to Human IVR Audio tab to view the newly uploaded file
        if (typeof window.switchTab === 'function') {
          window.switchTab('tabIVRStudio');
        }
      } else {
        this.showToast(data.error || 'Failed to upload audio file', 'error');
      }
    } catch(err) {
      console.error('Audio upload error:', err);
      this.showToast('Error uploading audio file', 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Upload & Set as Active IVR';
      }
    }
  }

  async handleFileUpload(e) {
    if (e) e.preventDefault();
    if (this._isUploadingLeads) return;

    const fileInp = document.getElementById('leadFileInput');
    if (!fileInp || !fileInp.files || fileInp.files.length === 0) {
      this.showToast('Please select a CSV, Excel, or TXT file to upload.', 'error');
      return;
    }

    const submitBtn = document.getElementById('btnSubmitUploadLeads') || e?.target?.querySelector('button[type="submit"]');
    this._isUploadingLeads = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Importing leads...';
    }

    const targetCampaignId = document.getElementById('uploadCampaignSelect')?.value || this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('lead_file', fileInp.files[0]);
    formData.append('campaign_id', targetCampaignId);

    const autoSchedule = document.getElementById('uploadAutoScheduleToggle')?.checked;
    if (autoSchedule !== undefined) {
      formData.append('auto_schedule', autoSchedule ? '1' : '0');
    }
    const strat = document.getElementById('uploadScheduleStrategy')?.value || 'interval';
    formData.append('schedule_strategy', strat);

    if (strat === 'interval') {
      const intv = document.getElementById('uploadScheduleInterval')?.value || '5';
      formData.append('schedule_interval_mins', intv);
    } else if (strat === 'window') {
      const winStart = document.getElementById('uploadWindowStart')?.value || '09:00';
      const winEnd = document.getElementById('uploadWindowEnd')?.value || '17:00';
      formData.append('schedule_window_start', winStart);
      formData.append('schedule_window_end', winEnd);
    } else if (strat === 'batch') {
      const batchSize = document.getElementById('uploadBatchSize')?.value || '5';
      const intv = document.getElementById('uploadScheduleInterval')?.value || '5';
      formData.append('schedule_batch_size', batchSize);
      formData.append('schedule_interval_mins', intv);
    }

    this.showToast('Importing customer leads...', 'info');
    try {
      const res = await fetch('api.php?action=upload_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Imported ${data.imported} leads!`, 'success');
        fileInp.value = '';
        const nameLabel = document.getElementById('selectedFileName');
        if (nameLabel) nameLabel.textContent = '';
        this.closeAllModals();

        await this.loadCampaignData(targetCampaignId);
        await this.loadCampaignsOverview();
        this.renderDesignerContactsTable();
        this.updateDesignerUI();
      } else {
        this.showToast(data.error || 'Failed to import file', 'error');
      }
    } catch (err) {
      this.showToast('Error uploading lead file', 'error');
    } finally {
      this._isUploadingLeads = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Import Numbers to Campaign';
      }
    }
  }

  async handleManualUpload(e) {
    if (e) e.preventDefault();
    if (this._isSavingManual) return;

    const textInp = document.getElementById('manualLeadsText');
    const text = textInp?.value.trim() || '';
    if (!text) {
      this.showToast('Please enter at least one contact line', 'error');
      return;
    }

    const submitBtn = e?.target?.querySelector('button[type="submit"]');
    this._isSavingManual = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Adding numbers...';
    }

    const targetCampaignId = document.getElementById('manualCampaignSelect')?.value || this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('leads_text', text);
    formData.append('campaign_id', targetCampaignId);

    const autoSchedule = document.getElementById('manualAutoScheduleToggle')?.checked;
    if (autoSchedule !== undefined) {
      formData.append('auto_schedule', autoSchedule ? '1' : '0');
    }
    const strat = document.getElementById('manualScheduleStrategy')?.value || 'interval';
    formData.append('schedule_strategy', strat);

    if (strat === 'interval') {
      const intv = document.getElementById('manualScheduleInterval')?.value || '5';
      formData.append('schedule_interval_mins', intv);
    } else if (strat === 'window') {
      const winStart = document.getElementById('manualWindowStart')?.value || '09:00';
      const winEnd = document.getElementById('manualWindowEnd')?.value || '17:00';
      formData.append('schedule_window_start', winStart);
      formData.append('schedule_window_end', winEnd);
    } else if (strat === 'batch') {
      const batchSize = document.getElementById('manualBatchSize')?.value || '5';
      const intv = document.getElementById('manualScheduleInterval')?.value || '5';
      formData.append('schedule_batch_size', batchSize);
      formData.append('schedule_interval_mins', intv);
    }

    try {
      const res = await fetch('api.php?action=save_manual_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Added ${data.imported} leads!`, 'success');
        if (textInp) textInp.value = '';
        this.closeAllModals();

        await this.loadCampaignData(targetCampaignId);
        await this.loadCampaignsOverview();
        this.renderDesignerContactsTable();
        this.updateDesignerUI();
      } else {
        this.showToast(data.error || 'Failed to add leads', 'error');
      }
    } catch (err) {
      this.showToast('Error saving leads', 'error');
    } finally {
      this._isSavingManual = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Numbers to Campaign';
      }
    }
  }

  /* ─────────────────────────────────────────────────────────
     Direct Outbound Call Trigger
     ───────────────────────────────────────────────────────── */
  clickToDial(number, name = 'Customer') {
    if (!number) return;
    const matchingLead = (this.leads || []).find(l => l.phone_number === number || window.skykinNormalizeEtDial(l.phone_number) === window.skykinNormalizeEtDial(number));
    if (matchingLead) {
      this.activeLead = matchingLead;
      this.renderAgentScreen();
    } else {
      this.activeLead = {
        id: 'direct_' + Date.now(),
        customer_name: name || 'Customer',
        phone_number: number,
        account_number: 'DIRECT',
        status: 'calling',
        call_time: 'Immediate'
      };
      this.renderAgentScreen();
    }
    this.originateAgentDirectCall(this.activeLead);
  }

  startManualCall(rawNumber, name = 'Customer') {
    const raw = rawNumber || document.getElementById('dialInput')?.value.trim();
    if (!raw) {
      this.showToast('Please enter a phone number to call', 'error');
      return;
    }

    const number = window.skykinNormalizeEtDial(raw);

    const banner = document.getElementById('callActiveBanner');
    const callNum = document.getElementById('activeCallNumber');
    const callSub = document.getElementById('activeCallSub');
    const timer = document.getElementById('callTimer');
    const btnHangup = document.getElementById('btnHangup');
    const btnHold = document.getElementById('btnHold');
    const btnMute = document.getElementById('btnMute');
    const btnKeypad = document.getElementById('btnKeypadToggle');

    if (banner) banner.style.display = 'block';
    if (callNum) callNum.textContent = raw;
    if (callSub) callSub.textContent = `Dialing ${name} (${number})...`;
    if (timer) { timer.style.display = 'block'; timer.textContent = '00:00'; }
    if (btnHangup) btnHangup.style.display = 'block';
    if (btnHold) btnHold.style.display = 'flex';
    if (btnMute) btnMute.style.display = 'flex';
    if (btnKeypad) btnKeypad.style.display = 'flex';

    // Originate SIP outbound call
    const dom = localStorage.getItem('sip_domain') || 'client1.skykin.local';
    this.sipMakeCall(number, dom);
    this.updateTelephonyKpiCards();

    // Start live timer
    let sec = 0;
    clearInterval(this.manualTimerInterval);
    this.manualTimerInterval = setInterval(() => {
      sec++;
      const m = String(Math.floor(sec / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      if (timer) timer.textContent = `${m}:${s}`;
    }, 1000);
  }

  hangupManualCall() {
    this.sipHangup();

    if (this.activeAudioPlayer) {
      try { this.activeAudioPlayer.pause(); } catch(e) {}
      this.activeAudioPlayer = null;
    }

    clearInterval(this.manualTimerInterval);
    this.manualTimerInterval = null;

    const banner = document.getElementById('callActiveBanner');
    const timer = document.getElementById('callTimer');
    const btnHangup = document.getElementById('btnHangup');
    const btnHold = document.getElementById('btnHold');
    const btnMute = document.getElementById('btnMute');
    const btnKeypad = document.getElementById('btnKeypadToggle');

    if (banner) banner.style.display = 'none';
    if (timer) timer.style.display = 'none';
    if (btnHangup) btnHangup.style.display = 'none';
    if (btnHold) btnHold.style.display = 'none';
    if (btnMute) btnMute.style.display = 'none';
    if (btnKeypad) btnKeypad.style.display = 'none';

    const ext = localStorage.getItem('sip_ext') || '101';
    this.updateSipStatus('registered', `Registered (${ext})`);
    this.showToast('Call ended', 'info');
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────
     Phone Number Validator & Pre-Call Verification
     ───────────────────────────────────────────────────────── */
  verifyNumber(raw) {
    const s = String(raw || '').trim();
    if (!s) return { valid: false, formatted: '', operator: 'Unknown', reason: 'Empty number' };
    const digits = s.replace(/\D/g, '');
    if (s.startsWith('+') && digits.length >= 7 && digits.length <= 15) {
      return { valid: true, formatted: '+' + digits, national: '+' + digits, operator: 'E.164', type: 'Mobile' };
    }
    if (digits.length >= 7 && digits.length <= 15) {
      const cc = (this.settings?.default_country_code || '+251').replace(/\D/g, '');
      const formatted = s.startsWith('0') ? ('+' + cc + digits.slice(1)) : ('+' + cc + digits);
      return { valid: true, formatted: formatted, national: digits, operator: 'Standard', type: 'Mobile' };
    }
    return { valid: false, formatted: s, operator: 'Invalid Length', reason: `Invalid digits length (${digits.length})` };
  }

  async openVerificationModal() {
    this.openModal('modalVerifyList');
    const content = document.getElementById('verifyDetailsContent');
    if (content) content.innerHTML = '<div style="color:#64748b;text-align:center;padding:14px;">Analyzing queue phone numbers...</div>';

    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const res = await fetch(`api.php?action=verify_leads_list&campaign_id=${campId}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Verification failed');

      const validCount = data.valid_count ?? (data.valid ? data.valid.length : (data.total || 0));
      const dupCount = data.duplicate_count ?? (data.duplicates ? data.duplicates.length : 0);
      const invCount = data.invalid_count ?? (data.invalid ? data.invalid.length : 0);

      const elValid = document.getElementById('verifyValidCount') || document.getElementById('verifyTotalCount');
      if (elValid) elValid.textContent = validCount;

      const elBreakdown = document.getElementById('verifyOperatorBreakdown');
      if (elBreakdown) {
        if (data.type_breakdown) {
          elBreakdown.textContent = `Mobile: ${data.type_breakdown.mobile || 0} | Landline: ${data.type_breakdown.landline || 0} | Int'l: ${data.type_breakdown.international || 0}`;
        } else {
          elBreakdown.textContent = `Verified: ${validCount}`;
        }
      }

      const elDup = document.getElementById('verifyDuplicateCount') || document.getElementById('verifyDuplicatesCount');
      if (elDup) elDup.textContent = dupCount;

      const elInv = document.getElementById('verifyInvalidCount');
      if (elInv) elInv.textContent = invCount;

      let detailHtml = '';
      const invalidList = data.invalid || [];
      const duplicateList = data.duplicates || [];

      if (invalidList.length === 0 && duplicateList.length === 0) {
        detailHtml = '<div style="text-align:center;color:#16a34a;font-weight:700;padding:12px;">✅ All phone numbers in the queue are valid and verified!</div>';
      } else {
        if (invalidList.length > 0) {
          detailHtml += `<div style="font-weight:700;color:#dc2626;margin-bottom:4px;">❌ Invalid Numbers (${invalidList.length}):</div>`;
          invalidList.slice(0, 15).forEach(inv => {
            const p = inv.phone_number || inv.formatted_phone || inv.original_phone || 'Number';
            const reason = inv.reason || inv.error || 'Invalid format';
            detailHtml += `<div style="padding:2px 0;color:#b91c1c;">• <strong>${this.escapeHtml(p)}</strong> (${this.escapeHtml(inv.customer_name || 'Customer')}): ${this.escapeHtml(reason)}</div>`;
          });
          if (invalidList.length > 15) detailHtml += `<div style="color:#64748b;font-style:italic;">...and ${invalidList.length - 15} more invalid</div>`;
        }
        if (duplicateList.length > 0) {
          detailHtml += `<div style="font-weight:700;color:#b45309;margin-top:8px;margin-bottom:4px;">⚠️ Duplicate Numbers (${duplicateList.length}):</div>`;
          duplicateList.slice(0, 15).forEach(dup => {
            const p = dup.phone_number || dup.formatted_phone || dup.original_phone || 'Number';
            detailHtml += `<div style="padding:2px 0;color:#92400e;">• <strong>${this.escapeHtml(p)}</strong> (${this.escapeHtml(dup.customer_name || 'Customer')}) - appears multiple times in queue</div>`;
          });
          if (duplicateList.length > 15) detailHtml += `<div style="color:#64748b;font-style:italic;">...and ${duplicateList.length - 15} more duplicates</div>`;
        }
      }
      if (content) content.innerHTML = detailHtml;
    } catch(err) {
      if (content) content.innerHTML = `<div style="color:#dc2626;padding:10px;">Error verifying numbers: ${this.escapeHtml(err.message)}</div>`;
    }
  }

  async executeQueueClean(cleanType, notify = true) {
    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', campId);
      formData.append('clean_type', cleanType);

      const res = await fetch('api.php?action=clean_invalid_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        if (notify) this.showToast(data.message, 'success');
        await this.loadCampaignData();
        const modal = document.getElementById('modalVerifyList');
        if (modal && modal.classList.contains('open')) {
          this.openVerificationModal();
        }
      } else {
        if (notify) this.showToast(data.error || 'Clean failed', 'error');
      }
    } catch(err) {
      if (notify) this.showToast('Error cleaning queue leads', 'error');
    }
  }

  closeVerificationAndStart() {
    this.closeModal('modalVerifyList');
    this.startCampaign();
  }

  /* ─────────────────────────────────────────────────────────
     Retry Policy & Schedule Rules Handlers
     ───────────────────────────────────────────────────────── */
  openRetrySettingsModal() {
    if (this.campaign) {
      const retriesEl = document.getElementById('cfgMaxRetries');
      const modeEl = document.getElementById('cfgRetryDateMode');
      const delayEl = document.getElementById('cfgRetryDelayMin');
      const customDateEl = document.getElementById('cfgRetryCustomDate');

      if (retriesEl) retriesEl.value = (this.campaign.max_retries !== undefined) ? this.campaign.max_retries : 2;
      if (modeEl) modeEl.value = this.campaign.retry_date_mode || 'same_day';
      if (delayEl) delayEl.value = this.campaign.retry_delay_min || 15;
      if (customDateEl) customDateEl.value = this.campaign.retry_custom_date || '';

      this.handleRetryModeChange(modeEl?.value || 'same_day');
    }
    this.openModal('modalRetrySettings');
  }

  handleRetryModeChange(mode) {
    const delayWrap = document.getElementById('cfgRetryDelayWrap');
    const customWrap = document.getElementById('cfgRetryCustomDateWrap');
    if (delayWrap) delayWrap.style.display = (mode === 'same_day') ? 'block' : 'none';
    if (customWrap) {
      customWrap.style.display = (mode === 'custom_date') ? 'block' : 'none';
      if (mode === 'custom_date') {
        const tomorrow = this.getLocalDateString(new Date(this.getServerNow() + 86400000));
        const dateInput = document.getElementById('cfgRetryCustomDate');
        if (dateInput && !dateInput.value) dateInput.value = tomorrow;
      }
    }
  }

  async handleSaveRetrySettings(e) {
    if (e) e.preventDefault();
    const maxRetries = document.getElementById('cfgMaxRetries')?.value || 2;
    const retryMode = document.getElementById('cfgRetryDateMode')?.value || 'same_day';
    const retryDelay = document.getElementById('cfgRetryDelayMin')?.value || 15;
    const customDate = document.getElementById('cfgRetryCustomDate')?.value || '';
    const pacingDelay = document.getElementById('pacingDelayInput')?.value || 2;
    const maxConcurrent = document.getElementById('maxConcurrentInput')?.value || 2;

    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', campId);
      formData.append('max_retries', maxRetries);
      formData.append('retry_date_mode', retryMode);
      formData.append('retry_delay_min', retryDelay);
      formData.append('retry_custom_date', customDate);
      formData.append('pacing_delay_sec', pacingDelay);
      formData.append('max_concurrent', maxConcurrent);

      const res = await fetch('api.php?action=save_campaign_settings', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        if (this.campaign) {
          this.campaign.max_retries = parseInt(maxRetries, 10);
          this.campaign.retry_date_mode = retryMode;
          this.campaign.retry_delay_min = parseInt(retryDelay, 10);
          this.campaign.retry_custom_date = customDate;
        }
        this.closeModal('modalRetrySettings');
        this.showToast('Retry policy and schedule rules saved!', 'success');
      } else {
        this.showToast(data.error || 'Failed to save retry rules', 'error');
      }
    } catch(err) {
      this.showToast('Error saving retry settings', 'error');
    }
  }

  async requeueUnansweredLeads(applyRules = true) {
    try {
      const campId = this.activeCampaignId || this.campaign?.id || 1;
      const formData = new FormData();
      formData.append('campaign_id', campId);
      formData.append('apply_rules', applyRules ? '1' : '0');

      const res = await fetch('api.php?action=requeue_unanswered', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message, 'success');
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to re-queue leads', 'error');
      }
    } catch (e) {
      this.showToast('Error re-queueing leads', 'error');
    }
  }

  async requeueSingleLead(leadId, applyRules = true) {
    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('apply_rules', applyRules ? '1' : '0');

      const res = await fetch('api.php?action=requeue_single_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message, 'success');
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to re-queue lead', 'error');
      }
    } catch (e) {
      this.showToast('Error re-queueing lead', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Send Test Call Modal & API Handler
     ───────────────────────────────────────────────────────── */
  openSendTestCallModal(prefillNumber = '', prefillName = '') {
    const sel = document.getElementById('testCallCampaignSelect');
    if (sel) {
      sel.innerHTML = '<option value="">Default Audio Prompt</option>' + (this.allCampaigns || []).map(c => `<option value="${c.id}">${this.escapeHtml(c.name)}</option>`).join('');
    }
    const inp = document.getElementById('testCallPhone');
    if (inp) inp.value = prefillNumber || '';
    this.openModal('modalSendTestCall');
  }

  async handleSendTestCallSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const phone = document.getElementById('testCallPhone')?.value?.trim();
    const campId = document.getElementById('testCallCampaignSelect')?.value || '';
    if (!phone) {
      this.showToast('Please enter a destination phone number', 'warning');
      return;
    }
    const btn = document.getElementById('btnSubmitTestCall');
    if (btn) { btn.disabled = true; btn.textContent = 'Initiating call...'; }
    try {
      const formData = new FormData();
      formData.append('phone_number', phone);
      if (campId) formData.append('campaign_id', campId);
      const res = await fetch('api.php?action=send_test_call', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(data.message || 'Test call initiated successfully!', 'success');
        this.closeModal('modalSendTestCall');
      } else {
        this.showToast(data?.error || 'Failed to initiate test call', 'error');
      }
    } catch (err) {
      this.showToast('Network error placing test call', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Place Test Call'; }
    }
  }

  /* ─────────────────────────────────────────────────────────
     Settings & Business Configuration Handlers
     ───────────────────────────────────────────────────────── */
  async loadSettingsAndData() {
    try {
      // 1. Business & Dialing Configuration
      const resSet = await fetch('api.php?action=get_settings');
      const dataSet = await resSet.json();
      if (dataSet && dataSet.success && dataSet.settings) {
        this.settings = dataSet.settings;
        const s = dataSet.settings;
        const setVal = (id, val) => { const el = document.getElementById(id); if (el && val !== undefined) el.value = val; };
        setVal('settingCompanyName', s.company_name);
        setVal('settingTimezone', s.timezone);
        setVal('settingCurrency', s.currency);
        setVal('settingCountryCode', s.default_country_code);
        setVal('settingAvailableLines', s.available_lines);
        setVal('settingWindowStart', s.default_window_start);
        setVal('settingWindowEnd', s.default_window_end);
        setVal('settingMaxRetries', s.max_retries);
        setVal('settingRetryDelay', s.retry_delay_min);
      }

      // 2. Caller IDs
      const resCid = await fetch('api.php?action=get_caller_ids');
      const dataCid = await resCid.json();
      this.renderCallerIdsTable(dataCid?.caller_ids || []);

      // 3. Configurable Languages
      const resLang = await fetch('api.php?action=get_languages');
      const dataLang = await resLang.json();
      this.renderLanguagesTable(dataLang?.languages || []);

      // 4. Audio recordings library
      await this.loadAudioRecordings();
      this.renderAudioListTable();
    } catch (err) {
      console.warn('loadSettingsAndData error:', err);
    }
  }

  async handleSaveSettingsSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const getVal = id => document.getElementById(id)?.value?.trim() || '';
    const formData = new FormData();
    formData.append('company_name', getVal('settingCompanyName'));
    formData.append('timezone', getVal('settingTimezone'));
    formData.append('currency', getVal('settingCurrency'));
    formData.append('default_country_code', getVal('settingCountryCode'));
    formData.append('available_lines', getVal('settingAvailableLines'));
    formData.append('default_window_start', getVal('settingWindowStart'));
    formData.append('default_window_end', getVal('settingWindowEnd'));
    formData.append('max_retries', getVal('settingMaxRetries'));
    formData.append('retry_delay_min', getVal('settingRetryDelay'));

    try {
      const res = await fetch('api.php?action=save_settings', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast('Business and dialing settings saved!', 'success');
        const newTz = getVal('settingTimezone');
        if (newTz) {
          this.serverTimezone = newTz;
          this.serverToday = this.getLocalDateString();
        }
        this.settings = data.settings || this.settings;
        if (data.metrics) this.updateTelephonyKpiCards(data.metrics);
      } else {
        this.showToast(data?.error || 'Failed to save settings', 'error');
      }
    } catch (err) {
      this.showToast('Network error saving settings', 'error');
    }
  }

  renderCallerIdsTable(callerIds) {
    const tbody = document.getElementById('callerIdsTableBody');
    if (!tbody) return;
    if (!callerIds || callerIds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:14px;color:#94a3b8;">No caller IDs added yet.</td></tr>';
      return;
    }
    tbody.innerHTML = callerIds.map(c => `
      <tr>
        <td style="font-weight:600;color:#0f172a;">${this.escapeHtml(c.name)} ${c.is_default ? '<span class="sc-badge done" style="font-size:10px;padding:1px 6px;">Default</span>' : ''}</td>
        <td style="font-family:monospace;color:#1e293b;">${this.escapeHtml(c.phone_number)}</td>
        <td style="text-align:right;">
          <button type="button" class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:11px;" onclick="app.handleDeleteCallerId(${c.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  async handleAddCallerIdSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const name = document.getElementById('newCallerIdName')?.value?.trim();
    const number = document.getElementById('newCallerIdNumber')?.value?.trim();
    if (!name || !number) {
      this.showToast('Please enter both label and phone number', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('name', name);
    formData.append('phone_number', number);
    try {
      const res = await fetch('api.php?action=save_caller_id', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`Caller ID "${name}" added!`, 'success');
        const elN = document.getElementById('newCallerIdName');
        const elNum = document.getElementById('newCallerIdNumber');
        if (elN) elN.value = '';
        if (elNum) elNum.value = '';
        const cidRes = await fetch('api.php?action=get_caller_ids');
        const cidData = await cidRes.json();
        this.renderCallerIdsTable(cidData?.caller_ids || []);
      } else {
        this.showToast(data?.error || 'Failed to add caller ID', 'error');
      }
    } catch (err) {
      this.showToast('Network error adding caller ID', 'error');
    }
  }

  async handleDeleteCallerId(id) {
    if (!confirm('Are you sure you want to delete this Caller ID?')) return;
    const formData = new FormData();
    formData.append('id', id);
    try {
      const res = await fetch('api.php?action=delete_caller_id', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast('Caller ID deleted', 'success');
        const cidRes = await fetch('api.php?action=get_caller_ids');
        const cidData = await cidRes.json();
        this.renderCallerIdsTable(cidData?.caller_ids || []);
      } else {
        this.showToast(data?.error || 'Failed to delete caller ID', 'error');
      }
    } catch (err) {
      this.showToast('Network error deleting caller ID', 'error');
    }
  }

  renderLanguagesTable(languages) {
    const tbody = document.getElementById('languagesTableBody');
    if (!tbody) return;
    if (!languages || languages.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:14px;color:#94a3b8;">No languages configured yet.</td></tr>';
      return;
    }
    tbody.innerHTML = languages.map(l => `
      <tr>
        <td style="font-family:monospace;font-weight:700;color:#0f5132;">${this.escapeHtml(l.code)}</td>
        <td style="color:#0f172a;font-weight:600;">${this.escapeHtml(l.name)} ${l.is_default ? '<span class="sc-badge done" style="font-size:10px;padding:1px 6px;">Default</span>' : ''}</td>
        <td style="text-align:right;">
          <button type="button" class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:11px;" onclick="app.handleDeleteLanguage(${l.id})">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  async handleAddLanguageSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    const code = document.getElementById('newLanguageCode')?.value?.trim();
    const name = document.getElementById('newLanguageName')?.value?.trim();
    if (!code || !name) {
      this.showToast('Please enter both code and language name', 'warning');
      return;
    }
    const formData = new FormData();
    formData.append('code', code);
    formData.append('name', name);
    try {
      const res = await fetch('api.php?action=save_language', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast(`Language "${name}" added!`, 'success');
        const elC = document.getElementById('newLanguageCode');
        const elN = document.getElementById('newLanguageName');
        if (elC) elC.value = '';
        if (elN) elN.value = '';
        const langRes = await fetch('api.php?action=get_languages');
        const langData = await langRes.json();
        this.renderLanguagesTable(langData?.languages || []);
      } else {
        this.showToast(data?.error || 'Failed to add language', 'error');
      }
    } catch (err) {
      this.showToast('Network error adding language', 'error');
    }
  }

  async handleDeleteLanguage(id) {
    if (!confirm('Are you sure you want to delete this language?')) return;
    const formData = new FormData();
    formData.append('id', id);
    try {
      const res = await fetch('api.php?action=delete_language', { method: 'POST', body: formData });
      const data = await res.json();
      if (data && data.success) {
        this.showToast('Language deleted', 'success');
        const langRes = await fetch('api.php?action=get_languages');
        const langData = await langRes.json();
        this.renderLanguagesTable(langData?.languages || []);
      } else {
        this.showToast(data?.error || 'Failed to delete language', 'error');
      }
    } catch (err) {
      this.showToast('Network error deleting language', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Designer Personalization Chips & Live Preview (Section 5)
     ───────────────────────────────────────────────────────── */
  insertVariableToScript(varName) {
    const txt = document.getElementById('campaignMessageText');
    if (!txt) return;
    const start = txt.selectionStart !== undefined ? txt.selectionStart : txt.value.length;
    const end = txt.selectionEnd !== undefined ? txt.selectionEnd : txt.value.length;
    const val = txt.value;
    txt.value = val.substring(0, start) + varName + val.substring(end);
    txt.selectionStart = txt.selectionEnd = start + varName.length;
    txt.focus();
    this.updateDesignerPreview();
  }

  updateDesignerPreview() {
    const txt = document.getElementById('campaignMessageText');
    const previewBox = document.getElementById('designerPreviewScriptBox');
    const durationEl = document.getElementById('designerPreviewDuration');
    const labelEl = document.getElementById('previewSampleContactLabel');
    const warnEl = document.getElementById('designerVariableWarning');

    const rawText = txt ? txt.value.trim() : '';
    const sample = (this.leads && this.leads.length > 0) ? this.leads[0] : null;

    if (labelEl) {
      labelEl.textContent = 'Sample contact';
    }

    const isPersonalize = document.getElementById('chkPersonalize')?.checked ?? true;
    let rendered = rawText || 'Your script will appear here, filled in with sample contact fields.';

    if (rawText && isPersonalize) {
      const contactName = sample?.customer_name || 'Contact';
      const contactPhone = sample?.phone_number || '';
      const contactAcct = sample?.account_number || '';
      const contactDebt = (sample?.debt_amount !== undefined && sample?.debt_amount !== null)
        ? (typeof sample.debt_amount === 'number' ? `${sample.debt_amount.toFixed(2)}` : String(sample.debt_amount))
        : '';

      rendered = rendered.replace(/\{customer_name\}|\{name\}/gi, `<strong>${contactName}</strong>`);
      rendered = rendered.replace(/\{phone_number\}|\{phone\}/gi, `<strong>${contactPhone}</strong>`);
      rendered = rendered.replace(/\{account_number\}|\{account\}|\{order_number\}/gi, `<strong>${contactAcct}</strong>`);
      rendered = rendered.replace(/\{debt_amount\}|\{amount\}|\{balance\}/gi, `<strong>${contactDebt}</strong>`);
    }

    if (previewBox) {
      previewBox.innerHTML = rendered.replace(/\n/g, '<br>');
    }

    if (warnEl) {
      const matchedVars = rawText.match(/\{([a-zA-Z0-9_]+)\}/g) || [];
      const knownVars = ['{customer_name}', '{name}', '{phone_number}', '{phone}', '{account_number}', '{account}', '{order_number}', '{debt_amount}', '{amount}', '{balance}'];
      const unknownVars = matchedVars.filter(v => !knownVars.includes(v.toLowerCase()));
      if (unknownVars.length > 0) {
        warnEl.style.display = 'block';
        warnEl.textContent = `Warning: ${unknownVars.join(', ')} is not in standard contact columns.`;
      } else {
        warnEl.style.display = 'none';
      }
    }

    const wordCount = rawText ? rawText.trim().split(/\s+/).length : 0;
    const estSec = wordCount > 0 ? Math.max(5, Math.round(wordCount / 2.5)) : 0;
    if (durationEl) {
      durationEl.textContent = estSec > 0 ? `Estimated length: ${estSec} s (${wordCount} words)` : 'Estimated length: 0 s (0 words)';
    }

    this.updateDesignerChecklist();
  }

  updateDesignerChecklist() {
    const btnLaunch = document.getElementById('btnLaunchDesignerCampaign');
    if (btnLaunch && this.campaign?.status !== 'running') {
      btnLaunch.disabled = false;
      btnLaunch.title = 'Click to start outbound dialing';
      btnLaunch.style.opacity = '1';
      btnLaunch.style.cursor = 'pointer';
    }
  }

  /* ─────────────────────────────────────────────────────────
     Smart Scheduling Proposal & Acceptance (Section 4)
     ───────────────────────────────────────────────────────── */
  async openSmartScheduleModal(campId = null) {
    const id = campId || this.activeCampaignId || this.campaign?.id || 1;
    try {
      const res = await fetch(`api.php?action=get_smart_schedule_plan&campaign_id=${id}`);
      const data = await res.json();
      if (data.success && data.plan) {
        this.activeSmartPlan = data.plan;
        this.renderSmartScheduleProposal(data.plan);
        this.openModal('modalSmartScheduleProposal');
      } else {
        this.showToast(data.error || 'Failed to generate schedule proposal', 'error');
      }
    } catch (e) {
      this.showToast('Network error loading schedule proposal', 'error');
    }
  }

  renderSmartScheduleProposal(plan) {
    if (!plan) return;
    const elTot = document.getElementById('smartPropTotalContacts');
    const elLines = document.getElementById('smartPropLines');
    const elAns = document.getElementById('smartPropAnswerRate');
    const elSaved = document.getElementById('smartPropTimeSaved');
    const elComp = document.getElementById('smartPropCompletionText');
    const rulesList = document.getElementById('smartPropRulesList');
    const batchTbody = document.getElementById('smartPropBatchesTableBody');
    const batchCountLabel = document.getElementById('smartPropBatchCountLabel');

    if (elTot) elTot.textContent = plan.total_contacts || 0;
    if (elLines) elLines.textContent = plan.available_lines || 2;
    if (elAns) elAns.textContent = plan.estimated_answered_rate || '68%';
    if (elSaved) elSaved.textContent = plan.estimated_time_saved || '1.5h saved';
    if (elComp) elComp.textContent = plan.expected_completion || 'Immediate';
    if (batchCountLabel) batchCountLabel.textContent = `${plan.total_batches || 0} Batches`;

    if (rulesList && plan.rules_used) {
      rulesList.innerHTML = plan.rules_used.map(r => `<li>${this.escapeHtml(r)}</li>`).join('');
    }

    if (batchTbody && plan.batches) {
      batchTbody.innerHTML = plan.batches.map(b => `
        <tr>
          <td><strong style="color:#00A651;">#${b.batch_number}</strong></td>
          <td>${b.date} (${b.day_name})</td>
          <td><strong>${b.hour_slot}</strong></td>
          <td>${b.contacts_count} calls</td>
          <td>${b.active_lines} lines</td>
          <td><span style="color:#15803d;font-weight:700;">${b.estimated_answered} (${b.answer_probability})</span></td>
          <td><span style="font-size:11px;color:#64748b;">${b.explanation}</span></td>
        </tr>
      `).join('');
    }
  }

  toggleSmartPlanEditDrawer() {
    const dr = document.getElementById('smartPropEditDrawer');
    if (!dr) return;
    dr.style.display = (dr.style.display === 'none') ? 'block' : 'none';
  }

  async recalculateSmartPlanProposal() {
    const id = this.activeCampaignId || this.campaign?.id || 1;
    const wStart = document.getElementById('smartEditWindowStart')?.value || '09:00';
    const wEnd = document.getElementById('smartEditWindowEnd')?.value || '17:00';
    const lines = parseInt(document.getElementById('smartEditLines')?.value || '2', 10);

    try {
      const res = await fetch(`api.php?action=get_smart_schedule_plan&campaign_id=${id}&calling_hours_start=${encodeURIComponent(wStart)}&calling_hours_end=${encodeURIComponent(wEnd)}&available_lines=${lines}`);
      const data = await res.json();
      if (data.success && data.plan) {
        this.activeSmartPlan = data.plan;
        this.renderSmartScheduleProposal(data.plan);
        this.showToast('Schedule proposal recalculated with your updated parameters!', 'info');
      }
    } catch (e) {
      this.showToast('Failed to recalculate plan', 'error');
    }
  }

  async acceptSmartSchedulePlan() {
    if (!this.activeSmartPlan) return;
    const id = this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('campaign_id', id);
    formData.append('plan_json', JSON.stringify(this.activeSmartPlan));

    try {
      const res = await fetch('api.php?action=accept_smart_schedule_plan', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.showToast('Smart schedule plan accepted and applied to contacts!', 'success');
        this.closeModal('modalSmartScheduleProposal');
        if (this.campaign) {
          this.campaign.smart_schedule_plan = JSON.stringify(this.activeSmartPlan);
        }
        const bannerText = document.getElementById('designerSmartPlanText');
        if (bannerText) {
          bannerText.innerHTML = '✔ Smart schedule plan active &middot; Next batch ready';
        }
        await this.loadCampaignData();
        this.updateDesignerChecklist();
      } else {
        this.showToast(data.error || 'Failed to accept schedule plan', 'error');
      }
    } catch (e) {
      this.showToast('Network error saving schedule plan', 'error');
    }
  }

  useManualScheduleFromModal() {
    this.closeModal('modalSmartScheduleProposal');
    const sel = document.getElementById('designerCallingMethodSelect');
    if (sel) {
      sel.value = 'manual';
      this.handleDesignerCallingMethodChange('manual');
    }
    this.showToast('Switched to manual scheduling mode.', 'info');
  }

  openBulkSmartRescheduleModal() {
    this.openSmartScheduleModal(this.activeCampaignId || this.campaign?.id || 1);
  }

  /* ─────────────────────────────────────────────────────────
     IVR & Call Flow Configuration (FusionPBX Style)
     ───────────────────────────────────────────────────────── */
  async setIvrMode(mode) {
    if (!this.ivrResponses) {
      this.ivrResponses = {
        mode: mode,
        broadcast_outcome: 'Announcement Listened',
        timeout_sec: 10,
        timeout_action: 'no_response_hangup',
        keys: {
          '1': { key: '1', outcome: 'Confirmed', action: 'log_outcome', audio_file: '', audio_name: '' },
          '2': { key: '2', outcome: 'Callback requested', action: 'callback_requested', audio_file: '', audio_name: '' },
          '3': { key: '3', outcome: 'Opted out', action: 'opt_out', audio_file: '', audio_name: '' }
        }
      };
    }
    this.ivrResponses.mode = mode;

    const lblB = document.getElementById('lblIvrModeBroadcast');
    const lblI = document.getElementById('lblIvrModeInteractive');
    const radB = document.getElementById('radioIvrBroadcast');
    const radI = document.getElementById('radioIvrInteractive');
    const panelB = document.getElementById('designerIvrBroadcastPanel');
    const panelI = document.getElementById('designerIvrInteractivePanel');

    if (mode === 'broadcast') {
      if (radB) radB.checked = true;
      if (lblB) { lblB.style.borderColor = '#00A651'; lblB.style.background = '#f0fdf4'; }
      if (lblI) { lblI.style.borderColor = '#cbd5e1'; lblI.style.background = '#fff'; }
      if (panelB) panelB.style.display = 'block';
      if (panelI) panelI.style.display = 'none';
    } else {
      if (radI) radI.checked = true;
      if (lblI) { lblI.style.borderColor = '#00A651'; lblI.style.background = '#f0fdf4'; }
      if (lblB) { lblB.style.borderColor = '#cbd5e1'; lblB.style.background = '#fff'; }
      if (panelB) panelB.style.display = 'none';
      if (panelI) panelI.style.display = 'block';
    }

    const id = this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('campaign_id', id);
    formData.append('responses_json', JSON.stringify(this.ivrResponses));
    try {
      await fetch('api.php?action=save_ivr_responses', { method: 'POST', body: formData });
      this.showToast(mode === 'broadcast' ? 'IVR mode set to Play & Hang Up' : 'IVR mode set to Interactive Menu', 'info');
    } catch(e) {}
  }

  setModalIvrMode(mode) {
    const lblB = document.getElementById('modalLblModeBroadcast');
    const lblI = document.getElementById('modalLblModeInteractive');
    const radB = document.getElementById('modalRadioBroadcast');
    const radI = document.getElementById('modalRadioInteractive');
    const secB = document.getElementById('modalBroadcastOptionsSection');
    const secI = document.getElementById('modalInteractiveOptionsSection');

    if (mode === 'broadcast') {
      if (radB) radB.checked = true;
      if (lblB) { lblB.style.borderColor = '#00A651'; lblB.style.background = '#f0fdf4'; }
      if (lblI) { lblI.style.borderColor = '#cbd5e1'; lblI.style.background = '#fff'; }
      if (secB) secB.style.display = 'block';
      if (secI) secI.style.display = 'none';
    } else {
      if (radI) radI.checked = true;
      if (lblI) { lblI.style.borderColor = '#00A651'; lblI.style.background = '#f0fdf4'; }
      if (lblB) { lblB.style.borderColor = '#cbd5e1'; lblB.style.background = '#fff'; }
      if (secB) secB.style.display = 'none';
      if (secI) secI.style.display = 'block';
    }
  }

  async openIvrResponsesModal() {
    const id = this.activeCampaignId || this.campaign?.id || 1;
    try {
      if (!this.audioRecordings || this.audioRecordings.length === 0) {
        try {
          const aRes = await fetch('api.php?action=get_audio_recordings');
          const aData = await aRes.json();
          if (aData.success && aData.recordings) {
            this.audioRecordings = aData.recordings;
          }
        } catch (ae) {}
      }

      const res = await fetch(`api.php?action=get_ivr_responses&campaign_id=${id}`);
      const data = await res.json();
      if (data.success && data.responses) {
        this.ivrResponses = data.responses;
      }
    } catch (e) {
      console.warn('Error loading IVR responses for modal:', e);
    }

    const resp = this.ivrResponses || {};
    const mode = resp.mode || 'interactive';
    this.setModalIvrMode(mode);

    const bOutcome = document.getElementById('modalBroadcastOutcomeLabel');
    if (bOutcome) bOutcome.value = resp.broadcast_outcome || 'Announcement Listened';

    const modalMenuSel = document.getElementById('modalIvrMenuAudioSelect');
    if (modalMenuSel && this.audioRecordings) {
      const curMenuVal = resp.menu_audio_file || '';
      modalMenuSel.innerHTML = this.audioRecordings.map(a => {
        const isSel = (curMenuVal === a.filepath || resp.menu_audio_name === a.name);
        return `<option value="${this.escapeHtml(a.filepath)}" data-audio-name="${this.escapeHtml(a.name)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(a.name)}</option>`;
      }).join('');
      if (curMenuVal) modalMenuSel.value = curMenuVal;
      else if (this.audioRecordings.length > 1) modalMenuSel.selectedIndex = 1;
    }

    this.renderIvrModalKeys();

    const tSec = document.getElementById('ivrModalTimeoutSec');
    const tAct = document.getElementById('ivrModalTimeoutAction');
    if (tSec) tSec.value = resp.timeout_sec || 15;
    if (tAct) tAct.value = resp.timeout_action || 'no_response_hangup';

    this.openModal('modalIvrResponses');
  }

  renderIvrModalKeys() {
    const container = document.getElementById('ivrModalKeyRowsContainer');
    if (!container) return;

    const resp = this.ivrResponses || {};
    const keys = resp.keys || {
      '1': { key: '1', action: 'play_audio', outcome: 'Confirmed', audio_file: '', audio_name: '' },
      '2': { key: '2', action: 'play_audio', outcome: 'Callback requested', audio_file: '', audio_name: '' },
      '3': { key: '3', action: 'play_audio', outcome: 'Opted out', audio_file: '', audio_name: '' }
    };

    const keyList = Object.values(keys);
    container.innerHTML = '';
    keyList.forEach(k => this.addIvrKeyRow(k));
  }

  addIvrKeyRow(keyData = null) {
    const container = document.getElementById('ivrModalKeyRowsContainer');
    if (!container) return;

    const nextIdx = container.children.length + 1;
    const k = keyData || {
      key: String(nextIdx),
      action: 'play_audio',
      outcome: 'Option ' + nextIdx,
      audio_file: '',
      audio_name: '',
      description: ''
    };

    const audioOptions = (this.audioRecordings || []).map(a => {
      const isSel = (k.audio_file === a.filepath || k.audio_name === a.name);
      return `<option value="${this.escapeHtml(a.filepath)}" data-audio-name="${this.escapeHtml(a.name)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(a.name)}</option>`;
    }).join('');

    const row = document.createElement('div');
    row.className = 'ivr-key-row';
    row.style.cssText = 'display:grid;grid-template-columns:52px 1.4fr 1.6fr 1.2fr 28px;gap:8px;align-items:center;background:#fff;padding:8px 10px;border-radius:6px;border:1px solid #cbd5e1;';
    row.innerHTML = `
      <div>
        <input type="text" class="form-control ivr-key-input" value="${this.escapeHtml(k.key || '')}" maxlength="2" style="font-weight:700;text-align:center;font-size:13px;padding:5px 6px;" placeholder="1" required>
      </div>
      <div>
        <select class="form-control ivr-action-select" style="font-size:12px;padding:5px 6px;">
          <option value="play_audio" ${k.action === 'play_audio' ? 'selected' : ''}>Play audio</option>
          <option value="play_audio_hangup" ${k.action === 'play_audio_hangup' ? 'selected' : ''}>Play audio &amp; Hang up</option>
          <option value="callback_requested" ${k.action === 'callback_requested' ? 'selected' : ''}>Schedule callback</option>
          <option value="log_outcome" ${k.action === 'log_outcome' ? 'selected' : ''}>Log outcome</option>
          <option value="opt_out" ${k.action === 'opt_out' ? 'selected' : ''}>Opt out / DNC</option>
          <option value="transfer_call" ${k.action === 'transfer_call' ? 'selected' : ''}>Transfer call</option>
          <option value="repeat_menu" ${k.action === 'repeat_menu' ? 'selected' : ''}>Repeat menu</option>
        </select>
      </div>
      <div>
        <div style="display:flex;gap:4px;align-items:center;">
          <select class="form-control ivr-audio-select" style="font-size:12px;padding:5px 6px;flex:1;">
            <option value="" data-audio-name="">(None - direct)</option>
            ${audioOptions}
          </select>
          <button type="button" class="btn btn-xs btn-outline-secondary" onclick="app.triggerKeyAudioUpload(this)" title="Upload audio for this key" style="font-size:10.5px;padding:4px 7px;font-weight:700;white-space:nowrap;display:flex;align-items:center;gap:3px;border-color:#cbd5e1;background:#f8fafc;cursor:pointer;">
            <span>⬆</span><span>Upload</span>
          </button>
        </div>
      </div>
      <div>
        <input type="text" class="form-control ivr-outcome-input" value="${this.escapeHtml(k.outcome || '')}" placeholder="Outcome label" style="font-size:12px;padding:5px 6px;">
      </div>
      <div style="text-align:center;">
        <button type="button" class="btn btn-xs btn-outline-danger" onclick="this.closest('.ivr-key-row').remove()" style="padding:2px 6px;color:#dc2626;border:none;background:none;font-weight:800;font-size:15px;cursor:pointer;" title="Delete key">&times;</button>
      </div>
    `;
    container.appendChild(row);
  }

  triggerKeyAudioUpload(btn) {
    const row = btn.closest('.ivr-key-row');
    const sel = row ? row.querySelector('.ivr-audio-select') : null;
    this._currentKeyAudioSelect = sel;
    const fileInput = document.getElementById('ivrKeyAudioFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.click();
    }
  }

  async handleIvrKeyAudioFileChosen(input) {
    if (!input || !input.files || input.files.length === 0) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('audio_file', file);
    formData.append('audio_name', file.name.replace(/\.[^/.]+$/, ''));
    formData.append('skip_campaign_update', '1');
    formData.append('campaign_id', this.activeCampaignId || this.campaign?.id || 1);

    try {
      this.showToast('Uploading key response audio...', 'info');
      const res = await fetch('api.php?action=upload_audio', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success && data.audio) {
        this.showToast(`Audio "${data.audio.name}" uploaded successfully!`, 'success');
        if (!this.audioRecordings.some(a => a.filepath === data.audio.filepath)) {
          this.audioRecordings.push(data.audio);
        }
        if (this._currentKeyAudioSelect) {
          let opt = document.createElement('option');
          opt.value = data.audio.filepath;
          opt.textContent = `${data.audio.name} (uploaded)`;
          opt.dataset.audioName = data.audio.name;
          opt.selected = true;
          this._currentKeyAudioSelect.appendChild(opt);
          this._currentKeyAudioSelect.value = data.audio.filepath;
        }
        this.refreshAllIvrAudioSelects();
      } else {
        this.showToast(data.error || 'Failed to upload audio', 'error');
      }
    } catch (err) {
      this.showToast('Network error uploading audio', 'error');
    }
  }

  refreshAllIvrAudioSelects() {
    document.querySelectorAll('.ivr-key-row .ivr-audio-select').forEach(sel => {
      const curVal = sel.value;
      const opts = ['<option value="" data-audio-name="">(None - direct)</option>'];
      (this.audioRecordings || []).forEach(a => {
        const isSel = (curVal === a.filepath);
        opts.push(`<option value="${this.escapeHtml(a.filepath)}" data-audio-name="${this.escapeHtml(a.name)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(a.name)}</option>`);
      });
      sel.innerHTML = opts.join('');
      if (curVal) sel.value = curVal;
    });
  }

  async handleSaveIvrResponsesSubmit(e) {
    e.preventDefault();
    const id = this.activeCampaignId || this.campaign?.id || 1;
    const isBroadcast = document.getElementById('modalRadioBroadcast')?.checked;
    const mode = isBroadcast ? 'broadcast' : 'interactive';
    const broadcastOutcome = document.getElementById('modalBroadcastOutcomeLabel')?.value.trim() || 'Announcement Listened';

    const modalMenuSel = document.getElementById('modalIvrMenuAudioSelect');
    const menuAudioFile = modalMenuSel ? modalMenuSel.value : '';
    const menuAudioName = modalMenuSel && modalMenuSel.selectedOptions[0] ? (modalMenuSel.selectedOptions[0].dataset.audioName || modalMenuSel.selectedOptions[0].textContent) : '';

    const keysObj = {};
    document.querySelectorAll('.ivr-key-row').forEach(row => {
      const keyVal = row.querySelector('.ivr-key-input')?.value.trim();
      const actionVal = row.querySelector('.ivr-action-select')?.value || 'log_outcome';
      const selAudio = row.querySelector('.ivr-audio-select');
      const audioFile = selAudio ? selAudio.value : '';
      const audioName = selAudio && selAudio.selectedOptions[0] ? (selAudio.selectedOptions[0].dataset.audioName || selAudio.selectedOptions[0].textContent) : '';
      const outcomeVal = row.querySelector('.ivr-outcome-input')?.value.trim();
      if (keyVal) {
        keysObj[keyVal] = {
          key: keyVal,
          action: actionVal,
          audio_file: audioFile,
          audio_name: audioName,
          outcome: outcomeVal || (actionVal === 'play_audio_hangup' ? 'Played Audio' : actionVal.replace(/_/g, ' ')),
          description: ''
        };
      }
    });

    const timeoutSec = parseInt(document.getElementById('ivrModalTimeoutSec')?.value || '15', 10);
    const timeoutAction = document.getElementById('ivrModalTimeoutAction')?.value || 'no_response_hangup';

    const fullResponses = {
      mode: mode,
      broadcast_outcome: broadcastOutcome,
      menu_audio_name: menuAudioName,
      menu_audio_file: menuAudioFile,
      timeout_sec: timeoutSec,
      timeout_action: timeoutAction,
      keys: keysObj
    };

    const formData = new FormData();
    formData.append('campaign_id', id);
    formData.append('responses_json', JSON.stringify(fullResponses));

    try {
      const res = await fetch('api.php?action=save_ivr_responses', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.success) {
        this.ivrResponses = fullResponses;
        this.showToast('IVR setup saved successfully!', 'success');
        this.closeModal('modalIvrResponses');
        this.renderIvrResponsesSummary();
        this.updateDesignerChecklist();
      } else {
        this.showToast(data.error || 'Failed to save responses', 'error');
      }
    } catch (e) {
      this.showToast('Network error saving responses', 'error');
    }
  }

  async renderIvrResponsesSummary() {
    const listEl = document.getElementById('designerIvrResponsesSummaryList');
    const noticeEl = document.getElementById('designerIvrTimeoutNotice');
    const broadcastPanel = document.getElementById('designerIvrBroadcastPanel');
    const interactivePanel = document.getElementById('designerIvrInteractivePanel');
    const lblB = document.getElementById('lblIvrModeBroadcast');
    const lblI = document.getElementById('lblIvrModeInteractive');
    const radB = document.getElementById('radioIvrBroadcast');
    const radI = document.getElementById('radioIvrInteractive');

    if (!this.ivrResponses) {
      try {
        const res = await fetch(`api.php?action=get_ivr_responses&campaign_id=${this.campaign?.id || 0}`);
        const data = await res.json();
        if (data.success && data.responses) {
          this.ivrResponses = data.responses;
        }
      } catch (e) {}
    }

    const resp = this.ivrResponses || {
      mode: 'interactive',
      broadcast_outcome: 'Announcement Listened',
      timeout_sec: 10,
      timeout_action: 'no_response_hangup',
      keys: {
        '1': { key: '1', outcome: 'Confirmed', action: 'log_outcome' },
        '2': { key: '2', outcome: 'Callback requested', action: 'callback_requested' },
        '3': { key: '3', outcome: 'Opted out', action: 'opt_out' }
      }
    };

    const mode = resp.mode || 'interactive';

    if (mode === 'broadcast') {
      if (radB) radB.checked = true;
      if (lblB) { lblB.style.borderColor = '#00A651'; lblB.style.background = '#f0fdf4'; }
      if (lblI) { lblI.style.borderColor = '#cbd5e1'; lblI.style.background = '#fff'; }
      if (broadcastPanel) broadcastPanel.style.display = 'block';
      if (interactivePanel) interactivePanel.style.display = 'none';

      const bOutcomeEl = document.getElementById('designerBroadcastOutcomeLabel');
      if (bOutcomeEl) bOutcomeEl.textContent = resp.broadcast_outcome || 'Announcement Listened';
    } else {
      if (radI) radI.checked = true;
      if (lblI) { lblI.style.borderColor = '#00A651'; lblI.style.background = '#f0fdf4'; }
      if (lblB) { lblB.style.borderColor = '#cbd5e1'; lblB.style.background = '#fff'; }
      if (broadcastPanel) broadcastPanel.style.display = 'none';
      if (interactivePanel) interactivePanel.style.display = 'block';

      const designerMenuSel = document.getElementById('designerIvrMenuAudioSelect');
      if (designerMenuSel) {
        const curMenuVal = resp.menu_audio_file || '';
        let optionsHtml = '<option value="">None (Instructions included in greeting)</option>';
        if (this.audioRecordings && this.audioRecordings.length > 0) {
          optionsHtml += this.audioRecordings.map(a => {
            const isSel = (curMenuVal === a.filepath || resp.menu_audio_name === a.name);
            return `<option value="${this.escapeHtml(a.filepath)}" data-audio-name="${this.escapeHtml(a.name)}" ${isSel ? 'selected' : ''}>${this.escapeHtml(a.name)}</option>`;
          }).join('');
        }
        designerMenuSel.innerHTML = optionsHtml;
        designerMenuSel.value = curMenuVal || '';
      }

      const keys = resp.keys || {};
      const keyEntries = Object.values(keys);

      if (listEl) {
        if (keyEntries.length === 0) {
          listEl.innerHTML = '<div style="font-size:12px;color:#94a3b8;padding:8px;background:#f8fafc;border-radius:6px;text-align:center;">No keypad response keys configured yet. Click "Add key option" above.</div>';
        } else {
          listEl.innerHTML = keyEntries.map(k => {
            let actionClean = 'Play audio';
            if (k.action === 'play_audio') actionClean = 'Play audio';
            else if (k.action === 'play_audio_hangup') actionClean = 'Play audio, then hang up';
            else if (k.action === 'callback_requested') actionClean = 'Add to callback list';
            else if (k.action === 'opt_out') actionClean = 'Opt out / Do not call';
            else if (k.action === 'transfer_call') actionClean = 'Transfer call';
            else if (k.action === 'log_outcome') actionClean = 'Log outcome';
            else if (k.action === 'repeat_menu') actionClean = 'Repeat menu';
            else if (k.action) actionClean = k.action.replace(/_/g, ' ');

            const audioName = k.audio_name || (k.audio_file ? k.audio_file.split('/').pop().split('\\').pop() : '');

            return `
              <div style="display:grid;grid-template-columns:150px 1fr auto;align-items:center;background:#fff;padding:10px 14px;border-radius:6px;border:1px solid #e2e8f0;font-size:12px;gap:12px;">
                <div style="display:flex;align-items:center;gap:10px;">
                  <span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:4px;background:#00A651;color:#fff;font-weight:800;font-size:11.5px;flex-shrink:0;">${k.key}</span>
                  <span style="font-weight:700;color:#0f172a;">${this.escapeHtml(k.outcome || 'Confirmed')}</span>
                </div>
                <div style="color:#64748b;font-size:12px;">${actionClean}</div>
                <div style="color:#64748b;font-size:12px;font-weight:500;text-align:right;">${this.escapeHtml(audioName)}</div>
              </div>
            `;
          }).join('');
        }
      }

      if (noticeEl) {
        const timeoutSec = resp.timeout_sec || 15;
        noticeEl.innerHTML = `
          <span>No key pressed after ${timeoutSec} seconds: mark no response and hang up.</span>
          <a href="javascript:void(0)" onclick="app.openIvrResponsesModal()" style="color:#00A651;font-weight:700;text-decoration:none;font-size:12px;">Edit</a>
        `;
      }
    }
  }

  playAudioPreview(audioUrl) {
    if (!audioUrl) return;
    if (this._previewAudio) {
      try { this._previewAudio.pause(); } catch(e){}
      this._previewAudio = null;
    }
    const a = new Audio(audioUrl);
    this._previewAudio = a;
    a.play().then(() => {
      this.showToast('Playing audio preview...', 'info');
    }).catch(e => {
      console.warn('Audio preview note:', e);
    });
  }

  async handleDesignerIvrMenuAudioChange(audioPath) {
    if (!this.ivrResponses) this.ivrResponses = { mode: 'interactive', keys: {} };
    const sel = document.getElementById('designerIvrMenuAudioSelect');
    const opt = sel?.selectedOptions?.[0];
    const audioName = audioPath ? (opt?.dataset?.audioName || opt?.textContent || '') : '';
    this.ivrResponses.menu_audio_file = audioPath || '';
    this.ivrResponses.menu_audio_name = audioName;

    const id = this.activeCampaignId || this.campaign?.id || 1;
    const formData = new FormData();
    formData.append('campaign_id', id);
    formData.append('responses_json', JSON.stringify(this.ivrResponses));
    try {
      await fetch('api.php?action=save_ivr_responses', { method: 'POST', body: formData });
      this.showToast(audioPath ? `Menu instructions audio set to "${audioName}"` : 'Menu instructions set to None', 'success');
    } catch(e) {
      console.warn('Auto-save menu audio error:', e);
    }
  }

  previewSelectedMenuAudio() {
    const sel = document.getElementById('designerIvrMenuAudioSelect');
    if (sel && sel.value) {
      this.playAudioPreview(sel.value);
    } else {
      this.showToast('No menu audio selected to preview', 'warning');
    }
  }

  previewModalMenuAudio() {
    const sel = document.getElementById('modalIvrMenuAudioSelect');
    if (sel && sel.value) {
      this.playAudioPreview(sel.value);
    } else {
      this.showToast('No menu audio selected to preview', 'warning');
    }
  }

  async startIvrSessionForChannel(ch, pc, lineNum, audioSrc, finishCall) {
    if (!this.ivrResponses) {
      try {
        const campId = ch.lead?.campaign_id || this.campaign?.id || 0;
        const res = await fetch(`api.php?action=get_ivr_responses&campaign_id=${campId}`);
        const data = await res.json();
        if (data.success && data.responses) {
          this.ivrResponses = data.responses;
        }
      } catch (e) {}
    }

    const ivrCfg = this.ivrResponses || {
      mode: 'interactive',
      broadcast_outcome: 'Announcement Listened',
      menu_audio_name: '',
      menu_audio_file: '',
      timeout_sec: 15,
      timeout_action: 'no_response_hangup',
      keys: {
        '1': { key: '1', action: 'play_audio_hangup', outcome: 'Confirmed', audio_name: 'ivr2', audio_file: 'assets/audio/1793961705_ahununu_waiting.wav' },
        '2': { key: '2', action: 'callback_requested', outcome: 'Callback requested', audio_name: 'ivr', audio_file: 'assets/audio/1793961665_agent_buzy.wav' }
      }
    };

    const mode = (ivrCfg.mode || this.campaign?.ivr_mode || 'interactive');
    ch.ivrMode = mode;
    ch.ivrConfig = ivrCfg;
    ch.dtmfHandled = false;
    ch.dtmfPressed = null;
    ch.pc = pc;
    ch.lineNum = lineNum;
    ch.finishCall = finishCall;

    const greetingAudio = audioSrc || ch.lead?.ivr_audio_file || this.campaign?.ivr_audio_file || (this.audioRecordings?.[0]?.filepath) || '';
    const greetingName = ch.lead?.ivr_audio_name || this.campaign?.ivr_audio_name || (this.audioRecordings?.[0]?.name) || 'IVR Greeting';

    if (mode === 'broadcast') {
      ch.ivrState = 'playing_broadcast';
      ch.currentAudioName = greetingName;
      this.renderActiveChannels();

      const onBroadcastEnded = () => {
        setTimeout(() => {
          this.sipHangup(lineNum, false);
          const outcome = ivrCfg.broadcast_outcome || 'Announcement Listened';
          if (finishCall) finishCall('completed', ch.duration || 1, outcome);
        }, 600);
      };

      if (pc) {
        await this.playIvrAudioIntoPeerConnection(greetingAudio, pc, onBroadcastEnded, lineNum);
      } else {
        try {
          const a = new Audio(greetingAudio);
          ch.audioPlayer = a;
          a.play().catch(e => console.warn('Broadcast audio note:', e));
          a.onended = onBroadcastEnded;
          a.onerror = () => onBroadcastEnded();
        } catch (e) {
          setTimeout(onBroadcastEnded, 5000);
        }
      }
    } else {
      // Interactive IVR Mode: Step 1 (Greeting) -> Step 2 (Optional Menu Prompt) -> Step 3 (Keypad Options in Sequence) -> Step 4 (Timeout / Awaiting Keypad)
      ch.ivrState = 'playing_greeting';
      ch.currentAudioName = greetingName;
      ch.menuPlayCount = 1;
      this.renderActiveChannels();

      // Immediately arm remote DTMF detector on WebRTC audio track from customer phone
      if (pc) {
        this.setupRemoteDtmfDetector(pc, lineNum);
      }

      // Keypad options list ordered by key (1, 2, 3...)
      const keyEntries = Object.values(ivrCfg.keys || {})
        .filter(k => k && k.key)
        .sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));

      // Identify menu instructions prompt audio (only if explicitly configured and different from greeting and first option)
      let menuAudio = ivrCfg.menu_audio_file || '';
      let menuAudioName = ivrCfg.menu_audio_name || '';
      if (menuAudio === greetingAudio || (keyEntries.length > 0 && menuAudio === keyEntries[0].audio_file)) {
        menuAudio = '';
        menuAudioName = '';
      }

      const startTimeout = () => {
        if (ch.dtmfHandled) return;
        ch.ivrState = 'awaiting_keypad';
        ch.currentAudioName = 'Awaiting keypad input';
        this.renderActiveChannels();

        if (ch.ivrTimeoutTimer) clearTimeout(ch.ivrTimeoutTimer);
        const tSec = Math.max(3, ivrCfg.timeout_sec || 15);
        ch.ivrTimeoutTimer = setTimeout(async () => {
          if (ch.dtmfHandled || !this.activeChannels.has(ch.channelId || ch.id)) return;
          console.log(`[Line ${lineNum}] IVR keypad timeout (${tSec}s) reached.`);

          if (ivrCfg.timeout_action === 'repeat_menu' && ch.menuPlayCount < 2) {
            ch.menuPlayCount++;
            this.showToast(`[Line ${lineNum}] Repeating menu prompt...`, 'info');
            playSequence();
          } else if (ivrCfg.timeout_action === 'schedule_callback') {
            try {
              const cbData = new FormData();
              cbData.append('lead_id', ch.lead.id);
              cbData.append('campaign_id', ch.lead.campaign_id || this.campaign?.id || 1);
              cbData.append('notes', 'No keypad response: Follow-up callback auto-scheduled');
              await fetch('api.php?action=schedule_callback', { method: 'POST', body: cbData });
            } catch(e) {}
            this.sipHangup(lineNum, false);
            if (finishCall) finishCall('callback', ch.duration || 1, 'No response (Follow-up scheduled)', 'none');
          } else {
            this.sipHangup(lineNum, false);
            if (finishCall) finishCall('no_answer', ch.duration || 1, 'No response / Timeout', 'none');
          }
        }, tSec * 1000);
      };

      const playOptionAt = async (idx) => {
        if (ch.dtmfHandled) return;

        if (idx >= keyEntries.length) {
          // All available option audios finished, enter keypad wait
          startTimeout();
          return;
        }

        const k = keyEntries[idx];
        const optAudio = k.audio_file;
        const optAction = k.action || 'play_audio';
        const optKey = k.key;
        const optName = k.audio_name || `Option ${optKey}`;

        // If this key doesn't have an audio file, move directly to next
        if (!optAudio) {
          playOptionAt(idx + 1);
          return;
        }

        ch.ivrState = 'playing_option';
        ch.currentAudioName = `${optName} (Option ${optKey})`;
        this.renderActiveChannels();
        console.log(`[Line ${lineNum}] Playing Option ${optKey} audio: ${optAudio} [Action: ${optAction}]`);

        const onOptDone = () => {
          if (ch.dtmfHandled) return;

          // If action is explicitly configured as "Play audio & Hang up", hang up after this audio completes
          if (optAction === 'play_audio_hangup') {
            console.log(`[Line ${lineNum}] Option ${optKey} is play_audio_hangup: disconnecting.`);
            setTimeout(() => {
              this.sipHangup(lineNum, false);
              if (finishCall) finishCall('completed', ch.duration || 1, k.outcome || 'Confirmed', optKey);
            }, 600);
            return;
          }

          // If action is "Play audio" (or other continuing action), advance to next option in sequence!
          playOptionAt(idx + 1);
        };

        if (pc) {
          await this.playIvrAudioIntoPeerConnection(optAudio, pc, onOptDone, lineNum);
        } else {
          try {
            const a = new Audio(optAudio);
            ch.audioPlayer = a;
            a.play().catch(e => {
              console.warn(`[Line ${lineNum}] Option audio play warning:`, e);
              onOptDone();
            });
            a.onended = onOptDone;
            a.onerror = onOptDone;
          } catch(e) {
            onOptDone();
          }
        }
      };

      const playMenuPrompt = async () => {
        if (ch.dtmfHandled) return;
        if (!menuAudio) {
          playOptionAt(0);
          return;
        }
        ch.ivrState = 'playing_menu';
        ch.currentAudioName = menuAudioName || 'Menu Instructions';
        this.renderActiveChannels();
        console.log(`[Line ${lineNum}] Step 2: Playing Menu Instructions prompt: ${menuAudio}`);

        if (pc) {
          await this.playIvrAudioIntoPeerConnection(menuAudio, pc, () => {
            if (!ch.dtmfHandled) playOptionAt(0);
          }, lineNum);
        } else {
          try {
            const a = new Audio(menuAudio);
            ch.audioPlayer = a;
            a.play().catch(e => console.warn('Menu prompt audio note:', e));
            a.onended = () => { if (!ch.dtmfHandled) playOptionAt(0); };
            a.onerror = () => { if (!ch.dtmfHandled) playOptionAt(0); };
          } catch(e) {
            playOptionAt(0);
          }
        }
      };

      const playSequence = async () => {
        if (ch.dtmfHandled) return;
        if (greetingAudio) {
          ch.ivrState = 'playing_greeting';
          ch.currentAudioName = greetingName || 'IVR Greeting';
          this.renderActiveChannels();
          console.log(`[Line ${lineNum}] Step 1: Playing initial greeting IVR: ${greetingAudio}`);

          const onGreetingDone = () => {
            if (!ch.dtmfHandled) {
              if (menuAudio) {
                setTimeout(() => { playMenuPrompt(); }, 200);
              } else {
                playOptionAt(0);
              }
            }
          };

          if (pc) {
            await this.playIvrAudioIntoPeerConnection(greetingAudio, pc, onGreetingDone, lineNum);
          } else {
            try {
              const a = new Audio(greetingAudio);
              ch.audioPlayer = a;
              a.play().catch(e => console.warn('Interactive greeting audio note:', e));
              a.onended = onGreetingDone;
              a.onerror = onGreetingDone;
            } catch(e) {
              onGreetingDone();
            }
          }
        } else if (menuAudio) {
          playMenuPrompt();
        } else {
          playOptionAt(0);
        }
      };

      playSequence();
    }
  }

  async handleIvrDtmfInput(lineNum, tone) {
    const ch = [...this.activeChannels.values()].find(c => String(c.lineNum) === String(lineNum)) || [...this.activeChannels.values()][0];
    if (!ch) {
      console.warn(`[handleIvrDtmfInput] No active channel found for lineNum=${lineNum}`);
      return;
    }
    if (ch.dtmfHandled) return;

    const keyStr = String(tone).trim();
    let keyConfig = ch.ivrConfig?.keys?.[keyStr] || this.ivrResponses?.keys?.[keyStr] || (
      keyStr === '1' ? { key: '1', action: 'play_audio_hangup', outcome: 'Confirmed' } :
      keyStr === '2' ? { key: '2', action: 'callback_requested', outcome: 'Callback requested' } :
      null
    );
    if (!keyConfig) {
      keyConfig = { key: keyStr, action: 'log_outcome', outcome: `Key ${keyStr} Pressed` };
    }

    ch.ivrMode = 'interactive';
    ch.dtmfHandled = true;
    if (ch.ivrTimeoutTimer) {
      clearTimeout(ch.ivrTimeoutTimer);
      ch.ivrTimeoutTimer = null;
    }

    this.stopCurrentIvrAudio(lineNum);
    if (ch.audioPlayer) {
      try { ch.audioPlayer.pause(); } catch(e){}
      ch.audioPlayer = null;
    }

    ch.dtmfPressed = keyStr;
    ch.dtmfOutcome = keyConfig.outcome || keyConfig.action;
    ch.ivrState = 'executing_action';

    const isCallback = (keyConfig.action === 'callback_requested' || 
                        (ch.dtmfOutcome && ch.dtmfOutcome.toLowerCase().includes('callback')) ||
                        (keyConfig.outcome && keyConfig.outcome.toLowerCase().includes('callback')));
    if (isCallback) {
      ch.isCallbackRequested = true;
    }

    // Instantly persist the DTMF key into the backend DB so it is never lost even if caller hangs up
    if (ch.lead) {
      ch.lead.dtmf_response = keyStr;
      ch.lead.error_message = ch.dtmfOutcome;
      ch.lead.status = isCallback ? 'callback' : 'answered';

      try {
        const fd = new FormData();
        fd.append('lead_id', ch.lead.id);
        fd.append('campaign_id', ch.lead.campaign_id || this.campaign?.id || 1);
        fd.append('key', keyStr);
        fd.append('outcome', ch.dtmfOutcome);
        fd.append('action_type', keyConfig.action || (isCallback ? 'callback_requested' : ''));
        fd.append('duration_sec', ch.duration || 1);
        fetch('api.php?action=record_ivr_key', { method: 'POST', body: fd }).then(() => {
          if (isCallback && this.loadCallbacksList) {
            this.loadCallbacksList();
          }
        }).catch(e => console.warn('record_ivr_key note:', e));
      } catch(e) {}
    }

    // Show key pressed alert on agent live IVR card
    const detectedAlert = document.getElementById('agentIvrKeyDetectedAlert');
    const detectedKeyNum = document.getElementById('agentIvrDetectedKeyNum');
    const detectedKeyLabel = document.getElementById('agentIvrDetectedKeyLabel');
    if (detectedAlert && detectedKeyNum && detectedKeyLabel) {
      detectedKeyNum.textContent = keyStr;
      detectedKeyLabel.textContent = ch.dtmfOutcome;
      detectedAlert.style.display = 'inline-flex';
    }

    this.showToast(`[Line ${lineNum}] Caller pressed [${keyStr}]: ${ch.dtmfOutcome}`, 'success');
    this.renderActiveChannels();

    const finishWithAction = async () => {
      const act = keyConfig.action || 'log_outcome';
      const outcomeLabel = keyConfig.outcome || act.replace(/_/g, ' ');

      if (act === 'repeat_menu') {
        ch.dtmfHandled = false;
        ch.dtmfPressed = null;
        ch.ivrState = 'awaiting_keypad';
        this.renderActiveChannels();
        const replayAudio = ch.lead?.ivr_audio_file || this.campaign?.ivr_audio_file || (this.audioRecordings?.[0]?.filepath) || '';
        this.startIvrSessionForChannel(ch, ch.pc, lineNum, replayAudio, ch.finishCall);
        return;
      }

      if (act === 'callback_requested' || ch.isCallbackRequested) {
        try {
          const cbData = new FormData();
          cbData.append('lead_id', ch.lead?.id || 0);
          cbData.append('campaign_id', ch.lead?.campaign_id || this.campaign?.id || 1);
          cbData.append('customer_name', ch.lead?.customer_name || 'Contact');
          cbData.append('phone_number', ch.lead?.phone_number || '');
          cbData.append('notes', `Customer pressed key [${keyStr}]: ${outcomeLabel}`);
          await fetch('api.php?action=schedule_callback', { method: 'POST', body: cbData });
          if (this.loadCallbacksList) this.loadCallbacksList();
        } catch(e) {}
        setTimeout(() => {
          this.sipHangup(lineNum, false);
          if (ch.finishCall) ch.finishCall('callback', ch.duration || 1, outcomeLabel, keyStr);
        }, 600);
        return;
      }

      if (act === 'opt_out') {
        setTimeout(() => {
          this.sipHangup(lineNum, false);
          if (ch.finishCall) ch.finishCall('opt_out', ch.duration || 1, 'Opted out', keyStr);
        }, 600);
        return;
      }

      if (act === 'transfer_call') {
        setTimeout(() => {
          this.sipHangup(lineNum, false);
          if (ch.finishCall) ch.finishCall('completed', ch.duration || 1, `Transferred: ${outcomeLabel}`, keyStr);
        }, 600);
        return;
      }

      setTimeout(() => {
        this.sipHangup(lineNum, false);
        if (ch.finishCall) ch.finishCall('completed', ch.duration || 1, outcomeLabel, keyStr);
      }, 600);
    };

    const respAudio = keyConfig.audio_file;
    if (respAudio) {
      ch.ivrState = 'playing_response_audio';
      ch.responseAudioName = keyConfig.audio_name || 'Response Audio';
      this.renderActiveChannels();
      console.log(`[Line ${lineNum}] Playing response audio for key [${keyStr}]: ${respAudio}`);

      if (ch.pc) {
        await this.playIvrAudioIntoPeerConnection(respAudio, ch.pc, () => finishWithAction(), lineNum);
      } else {
        try {
          const a = new Audio(respAudio);
          ch.audioPlayer = a;
          a.play().catch(e => {
            console.warn('Key response audio play error:', e);
            finishWithAction();
          });
          a.onended = () => finishWithAction();
          a.onerror = () => finishWithAction();
        } catch(e) {
          finishWithAction();
        }
      }
    } else {
      await finishWithAction();
    }
  }

  /* =========================================================
     Interactive IVR Responses and Analytics Page
     ========================================================= */
  async loadIvrResponsesReport() {
    const campSelect = document.getElementById('ivrRespCampaignSelect');
    if (!this._ivrCampaignsPopulated || !campSelect || campSelect.options.length <= 1) {
      await this.populateIvrCampaignDropdown();
    }

    const campId = campSelect?.value;
    if (!campId) {
      this.ivrReportRows = [];
      this.renderIvrResponsesTable();
      return;
    }

    const keySelect = document.getElementById('ivrRespKeySelect');
    const fromInput = document.getElementById('ivrRespDateFrom');
    const toInput = document.getElementById('ivrRespDateTo');
    const searchInput = document.getElementById('ivrRespSearchInput');

    const keyVal = keySelect?.value || '';
    const dateFrom = fromInput?.value || '';
    const dateTo = toInput?.value || '';
    const search = searchInput?.value || '';

    const params = new URLSearchParams({
      action: 'get_ivr_responses_report',
      campaign_id: campId,
      key: keyVal,
      date_from: dateFrom,
      date_to: dateTo,
      search: search
    });

    try {
      const res = await fetch(`api.php?${params.toString()}`);
      const data = await res.json();
      if (!data.success) {
        this.showToast(data.error || 'Failed to load IVR responses report', 'error');
        return;
      }

      // Update KPI Cards
      const sum = data.summary || {};
      const totalEl = document.getElementById('ivrKpiTotalCalls');
      const k1CallsEl = document.getElementById('ivrKpiKey1Calls');
      const k1PctEl = document.getElementById('ivrKpiKey1Pct');
      const k2CallsEl = document.getElementById('ivrKpiKey2Calls');
      const k2PctEl = document.getElementById('ivrKpiKey2Pct');
      const noneCallsEl = document.getElementById('ivrKpiNoneCalls');
      const nonePctEl = document.getElementById('ivrKpiNonePct');

      if (totalEl) totalEl.textContent = sum.total || 0;
      if (k1CallsEl) k1CallsEl.textContent = sum.key_1_count || 0;
      if (k1PctEl) k1PctEl.textContent = `${sum.key_1_pct || 0}%`;
      if (k2CallsEl) k2CallsEl.textContent = sum.key_2_count || 0;
      if (k2PctEl) k2PctEl.textContent = `${sum.key_2_pct || 0}%`;
      if (noneCallsEl) noneCallsEl.textContent = sum.none_count || 0;
      if (nonePctEl) nonePctEl.textContent = `${sum.none_pct || 0}%`;

      // Update Distribution Bar
      const barK1 = document.getElementById('ivrDistBarKey1');
      const barK2 = document.getElementById('ivrDistBarKey2');
      const barNone = document.getElementById('ivrDistBarNone');
      const textK1 = document.getElementById('ivrDistKey1Text');
      const textK2 = document.getElementById('ivrDistKey2Text');
      const textNone = document.getElementById('ivrDistNoneText');

      if (barK1) barK1.style.width = `${sum.key_1_pct || 0}%`;
      if (barK2) barK2.style.width = `${sum.key_2_pct || 0}%`;
      if (barNone) barNone.style.width = `${sum.none_pct || 0}%`;
      if (textK1) textK1.textContent = `${sum.key_1_pct || 0}%`;
      if (textK2) textK2.textContent = `${sum.key_2_pct || 0}%`;
      if (textNone) textNone.textContent = `${sum.none_pct || 0}%`;

      this.ivrReportRows = data.rows || [];
      this.ivrRespCurrentPage = 1;
      this.renderIvrResponsesTable();
    } catch(err) {
      console.error('loadIvrResponsesReport error:', err);
    }
  }

  async populateIvrCampaignDropdown() {
    const sel = document.getElementById('ivrRespCampaignSelect');
    if (!sel) return;
    try {
      const res = await fetch('api.php?action=get_interactive_campaigns');
      const data = await res.json();
      const camps = (data && data.success && Array.isArray(data.campaigns)) ? data.campaigns : [];
      this._interactiveCampaignsList = camps;

      if (camps.length === 0) {
        sel.innerHTML = '<option value="">No interactive IVR campaigns found</option>';
        sel.disabled = true;
        this._ivrCampaignsPopulated = true;
        return;
      }

      sel.disabled = false;
      const curVal = sel.value;
      let html = '';
      camps.forEach(c => {
        html += `<option value="${c.id}">${this.escapeHtml(c.name)} (ID: ${c.id})</option>`;
      });
      sel.innerHTML = html;

      // Select previously chosen, active, or first available interactive campaign
      if (curVal && camps.some(c => String(c.id) === String(curVal))) {
        sel.value = curVal;
      } else if (this.activeCampaignId && camps.some(c => String(c.id) === String(this.activeCampaignId))) {
        sel.value = String(this.activeCampaignId);
      } else {
        sel.value = String(camps[0].id);
      }
      this._ivrCampaignsPopulated = true;
    } catch(err) {
      console.error('Error populating interactive IVR campaigns:', err);
    }
  }

  onIvrRespCampaignChange(campaignId) {
    this.loadIvrResponsesReport();
  }

  renderIvrResponsesTable() {
    const tbody = document.getElementById('ivrResponsesTableBody');
    const showingEl = document.getElementById('ivrRespPaginationShowingText');
    const prevBtn = document.getElementById('ivrRespBtnPrevPage');
    const nextBtn = document.getElementById('ivrRespBtnNextPage');

    if (!tbody) return;

    const rows = this.ivrReportRows || [];
    const total = rows.length;
    const rpp = this.ivrRespRowsPerPage || 25;
    const totalPages = Math.max(1, Math.ceil(total / rpp));
    if (this.ivrRespCurrentPage > totalPages) this.ivrRespCurrentPage = totalPages;
    if (this.ivrRespCurrentPage < 1) this.ivrRespCurrentPage = 1;
    const page = this.ivrRespCurrentPage;

    const startIdx = (page - 1) * rpp;
    const endIdx = Math.min(startIdx + rpp, total);
    const pageRows = rows.slice(startIdx, endIdx);

    if (showingEl) {
      showingEl.textContent = total > 0
        ? `Showing ${startIdx + 1} to ${endIdx} of ${total} responses`
        : 'Showing 0 of 0 responses';
    }

    if (prevBtn) prevBtn.disabled = (page <= 1);
    if (nextBtn) nextBtn.disabled = (page >= totalPages);

    if (pageRows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center;padding:36px;color:#94a3b8;font-size:13px;">
            No interactive IVR responses found matching the current filters.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = pageRows.map((r, i) => {
      const idx = startIdx + i + 1;
      const k = String(r.dtmf_key || 'none').trim();
      let badgeHtml = '';
      if (k === 'pending' || r.lead_status === 'pending') {
        badgeHtml = `<span class="ivr-key-badge" style="background:#f8fafc;color:#64748b;border:1px solid #cbd5e1;padding:3px 9px;border-radius:6px;font-size:11.5px;font-weight:600;"><span class="ivr-key-num" style="background:#94a3b8;color:#fff;">&#x25CB;</span> Awaiting Call</span>`;
      } else if (k === '1') {
        badgeHtml = `<span class="ivr-key-badge key-1"><span class="ivr-key-num">1</span> Option 1</span>`;
      } else if (k === '2') {
        badgeHtml = `<span class="ivr-key-badge key-2"><span class="ivr-key-num">2</span> Option 2</span>`;
      } else if (k === 'none' || k === '') {
        badgeHtml = `<span class="ivr-key-badge key-none">None (Timeout)</span>`;
      } else {
        badgeHtml = `<span class="ivr-key-badge key-other"><span class="ivr-key-num">${this.escapeHtml(k)}</span> Key ${this.escapeHtml(k)}</span>`;
      }

      const isPending = (k === 'pending' || r.lead_status === 'pending');
      const durM = Math.floor((r.duration_sec || 0) / 60);
      const durS = (r.duration_sec || 0) % 60;
      const durStr = isPending ? '-' : `${durM}:${String(durS).padStart(2, '0')}`;
      let timeClean = '-';
      if (!isPending && r.last_attempt_at && r.call_time) {
        timeClean = String(r.call_time).replace(/\.\d+/, '').replace(/\+.*$/, '').replace('T', ' ');
      }
      const outcomeHtml = isPending
        ? '<span style="color:#94a3b8;font-size:12px;">Scheduled / Not called yet</span>'
        : `<span style="font-size:12px;color:#334155;font-weight:600;">${this.escapeHtml(r.action_label || '-')}</span>`;

      return `
        <tr>
          <td style="color:#94a3b8;font-size:12px;font-weight:600;">${idx}</td>
          <td style="font-weight:700;color:#0f172a;">${this.escapeHtml(r.customer_name || 'Contact')}</td>
          <td style="font-family:monospace;font-size:12.5px;color:#007A3D;font-weight:600;">${this.escapeHtml(r.phone_number || '')}</td>
          <td><span class="sc-badge-clean mint">${this.escapeHtml(r.campaign_name || 'Campaign')}</span></td>
          <td>${badgeHtml}</td>
          <td>${outcomeHtml}</td>
          <td style="font-family:monospace;font-size:12px;color:#64748b;">${durStr}</td>
          <td style="font-size:12px;color:#64748b;">${this.escapeHtml(timeClean)}</td>
          <td style="text-align:right;">
            <button type="button" class="unans-row-btn" onclick="app.dialLeadDirectly(${r.lead_id}, '${this.escapeHtml(r.phone_number)}')">
              Dial
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  filterIvrByCard(key) {
    const sel = document.getElementById('ivrRespKeySelect');
    if (sel) {
      sel.value = (key === 'all') ? '' : key;
    }
    const cards = ['ivrCardTotal', 'ivrCardKey1', 'ivrCardKey2', 'ivrCardKeyNone'];
    cards.forEach(cId => {
      const el = document.getElementById(cId);
      if (el) el.classList.remove('active');
    });
    if (key === 'all') document.getElementById('ivrCardTotal')?.classList.add('active');
    else if (key === '1') document.getElementById('ivrCardKey1')?.classList.add('active');
    else if (key === '2') document.getElementById('ivrCardKey2')?.classList.add('active');
    else if (key === 'none') document.getElementById('ivrCardKeyNone')?.classList.add('active');

    this.loadIvrResponsesReport();
  }

  onIvrRespFilterChange() {
    this.loadIvrResponsesReport();
  }

  setIvrRespDatePreset(preset) {
    const presets = ['today', 'yesterday', '7d', '30d', 'custom'];
    presets.forEach(p => {
      const btn = document.getElementById('ivrRespDatePreset' + (p === '7d' ? '7d' : (p === '30d' ? '30d' : (p.charAt(0).toUpperCase() + p.slice(1)))));
      if (btn) btn.classList.remove('active');
    });
    const activeBtn = document.getElementById('ivrRespDatePreset' + (preset === '7d' ? '7d' : (preset === '30d' ? '30d' : (preset.charAt(0).toUpperCase() + preset.slice(1)))));
    if (activeBtn) activeBtn.classList.add('active');

    const fromInput = document.getElementById('ivrRespDateFrom');
    const toInput = document.getElementById('ivrRespDateTo');

    const fmt = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };

    const now = new Date();
    if (preset === 'today') {
      const t = fmt(now);
      if (fromInput) fromInput.value = t;
      if (toInput) toInput.value = t;
    } else if (preset === 'yesterday') {
      const y = new Date(now.getTime() - 86400000);
      const yt = fmt(y);
      if (fromInput) fromInput.value = yt;
      if (toInput) toInput.value = yt;
    } else if (preset === '7d') {
      const d7 = new Date(now.getTime() - 7 * 86400000);
      if (fromInput) fromInput.value = fmt(d7);
      if (toInput) toInput.value = fmt(now);
    } else if (preset === '30d') {
      const d30 = new Date(now.getTime() - 30 * 86400000);
      if (fromInput) fromInput.value = fmt(d30);
      if (toInput) toInput.value = fmt(now);
    } else if (preset === 'custom') {
      // Leave current values intact
    }

    this.loadIvrResponsesReport();
  }

  onIvrRespDateInputChange() {
    const presets = ['today', 'yesterday', '7d', '30d', 'custom'];
    presets.forEach(p => {
      const btn = document.getElementById('ivrRespDatePreset' + (p === '7d' ? '7d' : (p === '30d' ? '30d' : (p.charAt(0).toUpperCase() + p.slice(1)))));
      if (btn) btn.classList.remove('active');
    });
    document.getElementById('ivrRespDatePresetCustom')?.classList.add('active');
    this.loadIvrResponsesReport();
  }

  clearIvrRespFilters() {
    const keySelect = document.getElementById('ivrRespKeySelect');
    const fromInput = document.getElementById('ivrRespDateFrom');
    const toInput = document.getElementById('ivrRespDateTo');
    const searchInput = document.getElementById('ivrRespSearchInput');

    if (keySelect) keySelect.value = '';
    if (fromInput) fromInput.value = '';
    if (toInput) toInput.value = '';
    if (searchInput) searchInput.value = '';

    const presets = ['today', 'yesterday', '7d', '30d', 'custom'];
    presets.forEach(p => {
      const btn = document.getElementById('ivrRespDatePreset' + (p === '7d' ? '7d' : (p === '30d' ? '30d' : (p.charAt(0).toUpperCase() + p.slice(1)))));
      if (btn) btn.classList.remove('active');
    });
    document.getElementById('ivrRespDatePresetToday')?.classList.add('active');

    this.loadIvrResponsesReport();
  }

  exportIvrResponsesCsv() {
    const campSelect = document.getElementById('ivrRespCampaignSelect');
    const keySelect = document.getElementById('ivrRespKeySelect');
    const fromInput = document.getElementById('ivrRespDateFrom');
    const toInput = document.getElementById('ivrRespDateTo');
    const searchInput = document.getElementById('ivrRespSearchInput');

    const campId = campSelect?.value;
    if (!campId) {
      this.showToast('Please select an interactive campaign first', 'warning');
      return;
    }

    const keyVal = keySelect?.value || '';
    const dateFrom = fromInput?.value || '';
    const dateTo = toInput?.value || '';
    const search = searchInput?.value || '';

    const params = new URLSearchParams({
      action: 'export_ivr_responses_csv',
      campaign_id: campId,
      key: keyVal,
      date_from: dateFrom,
      date_to: dateTo,
      search: search
    });

    window.location.href = `api.php?${params.toString()}`;
  }

  prevIvrRespPage() {
    if ((this.ivrRespCurrentPage || 1) > 1) {
      this.ivrRespCurrentPage--;
      this.renderIvrResponsesTable();
    }
  }

  nextIvrRespPage() {
    const total = this.ivrReportRows?.length || 0;
    const rpp = this.ivrRespRowsPerPage || 25;
    const totalPages = Math.ceil(total / rpp);
    if ((this.ivrRespCurrentPage || 1) < totalPages) {
      this.ivrRespCurrentPage = (this.ivrRespCurrentPage || 1) + 1;
      this.renderIvrResponsesTable();
    }
  }

  onIvrRespRowsPerPageChange(val) {
    this.ivrRespRowsPerPage = parseInt(val, 10) || 25;
    this.ivrRespCurrentPage = 1;
    this.renderIvrResponsesTable();
  }

  dialLeadDirectly(leadId, phone) {
    let lead = (this.leads || []).find(l => Number(l.id) === Number(leadId));
    if (!lead) {
      const campSelect = document.getElementById('ivrRespCampaignSelect');
      const curCampId = parseInt(campSelect?.value || '0', 10) || this.campaign?.id || 1;
      lead = { id: leadId, phone_number: phone, customer_name: 'Contact', campaign_id: curCampId, status: 'pending' };
    }
    this.activeLead = lead;
    switchNav('tabDialer', 'dialer/agent');
    setTimeout(() => {
      this.dialCustomerLead(lead, 1, 2);
    }, 250);
  }

  /* =========================================================
     Unanswered and Callbacks Sub-Tabs
     ========================================================= */
  switchUnansweredSubTab(sub) {
    this.unansweredSubTab = sub;
    const btnMissed = document.getElementById('unansTabBtnMissed');
    const btnCbs = document.getElementById('unansTabBtnCallbacks');

    if (btnMissed) {
      btnMissed.className = (sub === 'unanswered') ? 'unans-subtab-btn active' : 'unans-subtab-btn';
    }
    if (btnCbs) {
      btnCbs.className = (sub === 'callbacks') ? 'unans-subtab-btn active' : 'unans-subtab-btn';
    }

    this.selectedUnansweredIds.clear();
    this.unansCurrentPage = 1;
    this.renderUnansweredTable();
  }

  // -------------------------------------------------------------------------
  // SMS Notification & Follow-Up Methods
  // -------------------------------------------------------------------------

  toggleWizardSmsOptions(checked) {
    const details = document.getElementById('newCampaignSmsDetails');
    if (details) details.style.display = checked ? 'block' : 'none';
    if (checked) {
      const txt = document.getElementById('newCampaignSmsTemplate');
      if (txt) this.updateSmsCharCount(txt, 'newCampSmsCharCount');
    }
  }

  toggleDesignerSmsOptions(checked) {
    const panel = document.getElementById('designerSmsConfigPanel');
    const badge = document.getElementById('designerSmsStatusBadge');
    const slider = document.getElementById('designerSmsSlider');
    if (panel) panel.style.display = checked ? 'block' : 'none';
    if (badge) {
      badge.textContent = checked ? 'Enabled (Simulator)' : 'Disabled';
      badge.style.background = checked ? '#dcfce7' : '#f1f5f9';
      badge.style.color = checked ? '#166534' : '#475569';
    }
    if (slider) {
      slider.style.backgroundColor = checked ? '#00A651' : '#cbd5e1';
    }
    if (checked) {
      this.updateDesignerSmsPreview();
    }
  }

  updateSmsCharCount(input, countId) {
    const el = document.getElementById(countId);
    if (!el || !input) return;
    const len = input.value.length;
    const segments = Math.max(1, Math.ceil(len / 160));
    el.textContent = `${len} / 160 chars (${segments} SMS)`;
  }

  insertSmsTag(textareaId, tag) {
    const ta = document.getElementById(textareaId);
    if (!ta) return;
    const start = ta.selectionStart || ta.value.length;
    const end = ta.selectionEnd || ta.value.length;
    const text = ta.value;
    ta.value = text.substring(0, start) + tag + text.substring(end);
    ta.selectionStart = ta.selectionEnd = start + tag.length;
    ta.focus();

    // Trigger input event
    ta.dispatchEvent(new Event('input', { bubbles: true }));

    // Explicit updates
    if (textareaId === 'smsDesignerTemplate') {
      this.updateSmsCharCount(ta, 'smsDesignerCharCount');
      this.updateSmsDesignerLivePreview();
    } else if (textareaId === 'designerSmsTemplate') {
      this.updateSmsCharCount(ta, 'designerSmsCharCount');
      this.updateDesignerSmsPreview();
    } else if (textareaId === 'newCampSmsOnlyTemplate') {
      this.updateSmsCharCount(ta, 'newCampSmsOnlyCharCount');
      this.updateWizardSmsOnlyPreview();
    } else if (textareaId === 'newCampaignSmsTemplate') {
      this.updateSmsCharCount(ta, 'newCampSmsCharCount');
    } else if (textareaId === 'newSmsModalTemplate') {
      this.updateNewSmsCharCount(ta.value);
    } else if (textareaId === 'editSmsTemplateText') {
      this.updateEditSmsCharCount(ta.value);
    }
  }

  updateDesignerSmsPreview() {
    const bubble = document.getElementById('designerSmsLivePreviewBubble');
    const txtEl = document.getElementById('designerSmsTemplate');
    const senderEl = document.getElementById('designerSmsSenderId');
    const previewSender = document.getElementById('previewSenderIdText');
    if (previewSender && senderEl) {
      previewSender.textContent = senderEl.value.trim() || 'SkyConnect';
    }
    if (!bubble) return;
    let template = (txtEl && txtEl.value.trim()) ? txtEl.value.trim() : 'Hello {name}, thank you for taking our call regarding {campaign}. We have recorded your response.';
    const sampleCamp = this.campaign?.name || 'Appointment Reminder';
    const rendered = this.renderSmsTemplate(template, {
      name: 'Abebe Bikila',
      campaign: sampleCamp,
      phone: '+251911223344',
      outcome: 'Confirmed',
      key: '1',
      date: this.getLocalDateString(),
      time: '10:30 AM'
    });
    bubble.textContent = rendered;
  }

  openAgentSmsModal() {
    const lead = this.activeLead;
    const custNameInp = document.getElementById('quickSmsCustomerName');
    const phoneInp = document.getElementById('quickSmsPhoneNumber');
    const msgInp = document.getElementById('quickSmsMessageText');
    const leadIdInp = document.getElementById('quickSmsLeadId');
    const campIdInp = document.getElementById('quickSmsCampaignId');
    const senderInp = document.getElementById('quickSmsSenderId');

    const name = lead?.customer_name || 'Contact';
    const phone = lead?.phone_number || '';
    const campName = this.campaign?.name || 'SkyConnect';

    if (custNameInp) custNameInp.value = name;
    if (phoneInp) phoneInp.value = phone;
    if (leadIdInp) leadIdInp.value = lead?.id || '';
    if (campIdInp) campIdInp.value = this.campaign?.id || '';
    if (senderInp && this.campaign?.sms_sender_id) senderInp.value = this.campaign.sms_sender_id;

    let template = this.campaign?.sms_template || 'Hello {name}, thank you for taking our call regarding {campaign}. We have recorded your response.';
    const rendered = this.renderSmsTemplate(template, {
      name: name,
      campaign: campName,
      phone: phone,
      outcome: this.selectedDispo || 'Completed',
      key: lead?.dtmf_response || '1',
      call_time: lead?.call_time
    });

    if (msgInp) {
      msgInp.value = rendered;
      this.updateSmsCharCount(msgInp, 'quickSmsCharCount');
    }

    this.openModal('modalAgentQuickSms');
  }

  async handleAgentQuickSmsSubmit(e) {
    if (e) e.preventDefault();
    const phone = document.getElementById('quickSmsPhoneNumber')?.value.trim();
    const message = document.getElementById('quickSmsMessageText')?.value.trim();
    const leadId = document.getElementById('quickSmsLeadId')?.value || 0;
    const campId = document.getElementById('quickSmsCampaignId')?.value || 0;
    const custName = document.getElementById('quickSmsCustomerName')?.value || '';
    const senderId = document.getElementById('quickSmsSenderId')?.value || 'SkyConnect';

    if (!phone || !message) {
      this.showToast('Please enter both phone number and message', 'warning');
      return;
    }

    const btn = document.getElementById('btnSubmitQuickSms');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

    const fd = new FormData();
    fd.append('phone_number', phone);
    fd.append('message', message);
    fd.append('lead_id', leadId);
    fd.append('campaign_id', campId);
    fd.append('customer_name', custName);
    fd.append('sender_id', senderId);

    try {
      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        this.showToast(`SMS captured: ${data.note || 'Logged in simulator mode'}`, 'success');
        this.closeModal('modalAgentQuickSms');
      } else {
        this.showToast(data.error || 'Failed to send SMS', 'error');
      }
    } catch(err) {
      this.showToast('Network error sending SMS', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send SMS Now'; }
    }
  }

  async sendTestSmsFromDesigner() {
    const phone = prompt('Enter recipient phone number for Test SMS (e.g. +251911223344):', '+251911000000');
    if (!phone) return;
    const txt = document.getElementById('designerSmsTemplate')?.value || 'Test SMS from SkyConnect';
    const sender = document.getElementById('designerSmsSenderId')?.value || 'SkyConnect';
    const camp = this.campaign?.name || 'Campaign';
    const rendered = this.renderSmsTemplate(txt, {
      name: 'Test Contact',
      campaign: camp,
      phone: phone,
      outcome: 'Confirmed',
      key: '1'
    });

    const fd = new FormData();
    fd.append('phone_number', phone);
    fd.append('message', rendered);
    fd.append('sender_id', sender);
    fd.append('campaign_id', this.campaign?.id || 0);

    try {
      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Test SMS captured (${data.mode || 'simulated'}): ${data.note}`, 'success');
      } else {
        this.showToast(data.error || 'Failed to dispatch test SMS', 'error');
      }
    } catch(e) {
      this.showToast('Network error testing SMS', 'error');
    }
  }

  async sendTestSmsFromSettings() {
    const phone = prompt('Enter recipient phone number for Test SMS (e.g. +251911223344):', '+251911000000');
    if (!phone) return;
    const sender = document.getElementById('smsSettingSenderId')?.value || 'SkyConnect';
    const fd = new FormData();
    fd.append('phone_number', phone);
    fd.append('message', 'SkyConnect SMS Gateway Test: Your SMS connection is working successfully.');
    fd.append('sender_id', sender);

    try {
      const res = await fetch('api.php?action=send_sms', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.success) {
        this.showToast(`Test SMS processed (${data.mode}): ${data.note}`, 'success');
      } else {
        this.showToast(data.error || 'Test SMS failed', 'error');
      }
    } catch(e) {
      this.showToast('Network error testing SMS', 'error');
    }
  }

  async loadSmsSettings() {
    try {
      const res = await fetch('api.php?action=get_sms_settings');
      const data = await res.json();
      if (data && data.success && data.settings) {
        const s = data.settings;
        const provEl = document.getElementById('smsSettingProvider');
        const urlEl = document.getElementById('smsSettingApiUrl');
        const keyEl = document.getElementById('smsSettingApiKey');
        const senderEl = document.getElementById('smsSettingSenderId');
        const mockEl = document.getElementById('smsSettingMockMode');
        const badge = document.getElementById('smsGatewayStatusBadge');

        if (provEl && s.provider) provEl.value = s.provider;
        if (urlEl && s.api_url) urlEl.value = s.api_url;
        if (keyEl && s.api_key) keyEl.value = s.api_key;
        if (senderEl && s.sender_id) senderEl.value = s.sender_id;
        if (mockEl) mockEl.value = String(s.mock_mode !== undefined ? s.mock_mode : 1);

        if (badge) {
          if (s.has_api_key && Number(s.mock_mode) === 0) {
            badge.textContent = 'Live Gateway Active';
            badge.style.background = '#dcfce7';
            badge.style.color = '#166534';
            badge.style.borderColor = '#86efac';
          } else {
            badge.textContent = 'Simulator Mode (Pending API Key)';
            badge.style.background = '#fef3c7';
            badge.style.color = '#92400e';
            badge.style.borderColor = '#fde68a';
          }
        }
      }
    } catch(e) {
      console.warn('Error loading SMS settings:', e);
    }
  }

  async handleSaveSmsSettingsSubmit(e) {
    if (e) e.preventDefault();
    const provider = document.getElementById('smsSettingProvider')?.value || 'generic_api';
    const apiUrl = document.getElementById('smsSettingApiUrl')?.value.trim() || '';
    const apiKey = document.getElementById('smsSettingApiKey')?.value.trim() || '';
    const senderId = document.getElementById('smsSettingSenderId')?.value.trim() || 'SkyConnect';
    const mockMode = document.getElementById('smsSettingMockMode')?.value || '1';

    const fd = new FormData();
    fd.append('sms_provider', provider);
    fd.append('sms_api_url', apiUrl);
    fd.append('sms_api_key', apiKey);
    fd.append('sms_sender_id', senderId);
    fd.append('sms_mock_mode', mockMode);
    fd.append('sms_enabled', '1');

    try {
      const res = await fetch('api.php?action=save_sms_settings', { method: 'POST', body: fd });
      const data = await res.json();
      if (data && data.success) {
        this.showToast('SMS Gateway settings saved successfully!', 'success');
        this.loadSmsSettings();
      } else {
        this.showToast(data.error || 'Failed to save SMS settings', 'error');
      }
    } catch(err) {
      this.showToast('Error saving SMS settings', 'error');
    }
  }

  handleSmsProviderChange(prov) {
    const urlEl = document.getElementById('smsSettingApiUrl');
    if (!urlEl) return;
    if (prov === 'afromessage') {
      urlEl.value = 'https://api.afromessage.com/api/send';
    } else if (prov === 'twilio') {
      urlEl.value = 'https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json';
    } else if (prov === 'africastalking') {
      urlEl.value = 'https://api.africastalking.com/version1/messaging';
    } else if (prov === 'infobip') {
      urlEl.value = 'https://api.infobip.com/sms/2/text/advanced';
    }
  }

  toggleApiKeyVisibility(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.type = (el.type === 'password') ? 'text' : 'password';
  }

}

// Global Softphone Handlers
let phonePopupOpen = false;
let lastDialedNumber = '';

function togglePhonePopup() {
  phonePopupOpen = !phonePopupOpen;
  document.getElementById('phonePopup')?.classList.toggle('open', phonePopupOpen);
  const fab = document.getElementById('phoneFab');
  if (fab) {
    fab.innerHTML = phonePopupOpen
      ? '&#x2715;<span class="fab-badge unreg" id="fabBadge"></span>'
      : '&#128222;<span class="fab-badge unreg" id="fabBadge"></span>';
  }
}

function openPhonePopup() {
  phonePopupOpen = true;
  document.getElementById('phonePopup')?.classList.add('open');
  const fab = document.getElementById('phoneFab');
  if (fab) fab.innerHTML = '&#x2715;<span class="fab-badge unreg" id="fabBadge"></span>';
}

function dpKey(digit) {
  const dial = document.getElementById('dialInput');
  if (dial) dial.value += digit;
  if (window.app) {
    window.app.sipSendDtmf(digit);
    window.app.handleIvrDtmfInput(1, digit);
  }
}

function dpDelete() {
  const dial = document.getElementById('dialInput');
  if (dial) dial.value = dial.value.slice(0, -1);
}

function dpCall() {
  const num = document.getElementById('dialInput')?.value.trim();
  if (num) {
    lastDialedNumber = num;
    if (window.app) {
      window.app.startManualCall(num);
    }
  }
}

function fillRecentNumber() {
  const dial = document.getElementById('dialInput');
  if (!dial) return;
  if (lastDialedNumber) {
    dial.value = lastDialedNumber;
    return;
  }
  if (window.app && window.app.leads && window.app.leads.length > 0) {
    dial.value = window.app.leads[0].phone_number || '';
  }
}

function hangupManualCall() {
  if (window.app) window.app.hangupManualCall();
}

function toggleManualMute() {
  const btn = document.getElementById('btnMute');
  if (!window.app) return;
  window.app.isMuted = !window.app.isMuted;
  if (window.app.isMuted) window.app.sipMute();
  else window.app.sipUnmute();
  if (btn) btn.classList.toggle('active', window.app.isMuted);
}

function toggleManualHold() {
  const btn = document.getElementById('btnHold');
  if (!window.app) return;
  window.app.isHeld = !window.app.isHeld;
  if (window.app.isHeld) window.app.sipHold();
  else window.app.sipUnhold();
  if (btn) btn.classList.toggle('active', window.app.isHeld);
}

function toggleCallKeypad() {
  const dp = document.getElementById('dpPanel');
  if (dp) {
    dp.style.display = dp.style.display === 'none' ? 'block' : 'none';
  }
}

// SIP Settings Modal Save Handler
async function saveSipSettings() {
  const ext = document.getElementById('sipExt')?.value.trim() || '';
  const pass = document.getElementById('sipPass')?.value.trim() || '';
  const ext2 = document.getElementById('sipExt2')?.value.trim() || '';
  const pass2 = document.getElementById('sipPass2')?.value.trim() || '';
  const l2Enabled = document.getElementById('line2EnabledCheck')?.checked ? 1 : 0;
  const server = document.getElementById('sipServer')?.value.trim() || 'webcc.skyconnectsolutions.et';
  const port = document.getElementById('sipPort')?.value.trim() || '443';
  const dom = document.getElementById('sipDomain')?.value.trim() || 'client1.skykin.local';

  if (!ext || !pass) {
    alert('Line 1 Extension and Password are required.');
    return;
  }

  // Save to database
  try {
    const formData = new FormData();
    formData.append('sip_extension', ext);
    formData.append('sip_password', pass);
    formData.append('sip_extension2', ext2);
    formData.append('sip_password2', pass2);
    formData.append('line2_enabled', l2Enabled);
    formData.append('sip_server', server);
    formData.append('sip_port', port);
    formData.append('sip_domain', dom);
    await fetch('api.php?action=save_sip_settings', { method: 'POST', body: formData });
  } catch(e) {}

  closeSipSettingsModal();
  if (window.app) {
    window.app.showToast('SIP settings saved. Connecting lines...', 'success');
    window.app.reconnectDualSip(ext, pass, ext2, pass2, l2Enabled, server, port, dom);
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  window.app = new SkyKinDialerApp();

  const dialInp = document.getElementById('dialInput');
  if (dialInp) {
    dialInp.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        dpCall();
      }
    });
  }
});

window.openModal = function(id) {
  if (window.app) window.app.openModal(id);
  else document.getElementById(id)?.classList.add('open');
};
window.closeModal = function(id) {
  if (window.app) window.app.closeModal(id);
  else document.getElementById(id)?.classList.remove('open');
};

window.selectCampaignForDesigner = function(id) {
  if (window.app && window.app.selectCampaignForDesigner) {
    window.app.selectCampaignForDesigner(id);
  } else if (typeof window.switchCampaignSubView === 'function') {
    window.switchCampaignSubView('designer');
  } else {
    const listEl = document.getElementById('subViewCampaignsList');
    const designerEl = document.getElementById('subViewCampaignsDesigner');
    if (listEl) listEl.style.display = 'none';
    if (designerEl) designerEl.style.display = 'block';
  }
};

window.openSendTestCallModal = function(num, name) {
  if (window.app && window.app.openSendTestCallModal) {
    window.app.openSendTestCallModal(num, name);
  } else {
    document.getElementById('modalSendTestCall')?.classList.add('open');
  }
};

// Keyboard listener for DTMF keypad testing (1-9, 0, *, #) during active calls
window.addEventListener('keydown', function(e) {
  if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '*', '#'].includes(e.key)) {
    const activeEl = document.activeElement;
    const tag = activeEl ? activeEl.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || activeEl?.isContentEditable) {
      return;
    }
    if (window.app && window.app.activeChannels && window.app.activeChannels.size > 0) {
      const activeCh = [...window.app.activeChannels.values()][0];
      if (activeCh && activeCh.status === 'answered' && !activeCh.dtmfHandled) {
        console.log(`[Keyboard DTMF] Triggering key [${e.key}] for Line ${activeCh.lineNum}`);
        window.app.handleIvrDtmfInput(activeCh.lineNum, e.key);
      }
    }
  }
});