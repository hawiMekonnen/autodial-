/**
 * SkyKin Automatic Outbound Dialer - Production Controller & WebRTC Bridge
 * Direct SIP Calling (with Ethiopian Number Normalization) + Automated IVR Engine
 */

// Ethiopian Dial Normalization (e.g. 09XXXXXXXX -> 9XXXXXXXX)
window.skykinNormalizeEtDial = function(raw) {
  var s = String(raw || '').trim();
  if (!s) return s;
  if (/^2\d{2}$/.test(s) || /^1\d{2}$/.test(s)) return s; // Internal extensions like 101, 102
  var d = s.replace(/\D/g, '');
  if (!d) return s;
  if (d.indexOf('00251') === 0 && d.length >= 12) d = d.slice(5);
  else if (d.indexOf('251') === 0 && d.length >= 12) d = d.slice(3);
  if (d.length === 10 && d.charAt(0) === '0') {
    if (/^09\d{8}$/.test(d) || /^07\d{8}$/.test(d)) return d.slice(1);
    return d;
  }
  if (d.length === 9) {
    if (/^[97]\d{8}$/.test(d)) return d;
    if (/^[1-8]\d{8}$/.test(d)) return '0' + d;
  }
  return d;
};

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

    this.initElements();
    this.initEventListeners();
    try {
      this.initSipTelephony();
    } catch(e) {
      console.warn('SIP Telephony init error:', e);
    }
    this.loadCampaignData();
  }

  initElements() {
    this.btnStart = document.getElementById('btnStartCampaign');
    this.btnPause = document.getElementById('btnPauseCampaign');
    this.btnStop = document.getElementById('btnStopCampaign');
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

    // Drag and Drop
    const dropzone = document.getElementById('dropzoneBox');
    const fileInput = document.getElementById('leadFileInput');
    if (dropzone && fileInput) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
          document.getElementById('selectedFileName').textContent = fileInput.files[0].name;
        }
      });
      ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        if (ev === 'drop' && e.dataTransfer.files.length > 0) {
          fileInput.files = e.dataTransfer.files;
          document.getElementById('selectedFileName').textContent = fileInput.files[0].name;
        }
      }));
    }

    // Lead Search & Filter
    document.getElementById('leadSearchInput')?.addEventListener('input', (e) => this.renderLeadsTables(e.target.value));
    document.getElementById('leadStatusFilter')?.addEventListener('change', (e) => this.renderLeadsTables('', e.target.value));
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
      const SIP = window.SIPjs;
      if (!SIP || !SIP.UserAgent) {
        if (tries < 30) {
          setTimeout(() => startBridge(tries + 1), 150);
          return;
        }
        this.updateSipStatus('failed', 'SIP library not loaded');
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
  }

  async sipMakeCall(rawTarget, dom, callbacks = {}, lineNum = 1) {
    const lineObj = (lineNum === 2 && this.line2.enabled) ? this.line2 : this.line1;
    const SIP = window.SIPjs;

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
        }
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

    try {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      if (audioCtx.state === 'suspended') {
        try { await audioCtx.resume(); } catch(e) {}
      }
      lineObj.audioCtx = audioCtx;

      // Get cloned ArrayBuffer for clean decoding without detaching issues
      const arrayBuffer = await this.getAudioArrayBuffer(audioUrl);
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const durationSec = Math.max(2, audioBuffer.duration || 5);

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;

      const destination = audioCtx.createMediaStreamDestination();
      source.connect(destination);

      const ivrTrack = destination.stream.getAudioTracks()[0];
      if (ivrTrack) {
        ivrTrack.enabled = true;
      }

      if (pc && ivrTrack) {
        const senders = pc.getSenders ? pc.getSenders() : [];
        let audioSender = senders.find(s => s.track && s.track.kind === 'audio');
        if (!audioSender && senders.length > 0) {
          audioSender = senders[0];
        }
        if (audioSender && audioSender.replaceTrack) {
          await audioSender.replaceTrack(ivrTrack);
          console.log(`[Line ${lineNum}] IVR Audio track attached to WebRTC`);
        } else {
          console.warn(`[Line ${lineNum}] Could not locate audio sender on peerConnection`, senders);
        }
      }

      lineObj.ivrSource = source;

      let finished = false;
      const finishPlayback = () => {
        if (finished) return;
        finished = true;
        lineObj.ivrSource = null;
        // Wait 1.5 seconds after audio finishes so customer hears the entire message completely
        setTimeout(() => {
          if (onEnded) onEnded();
        }, 1500);
      };

      source.onended = finishPlayback;
      source.start(0);

      // Fallback safety timer: guarantees completion after full audio length + 2s buffer
      setTimeout(() => {
        finishPlayback();
      }, (durationSec + 2) * 1000);

      return { source, duration: durationSec };
    } catch (err) {
      console.error(`[Line ${lineNum}] Error in playIvrAudioIntoPeerConnection:`, err);
      // Wait 8 seconds before hangup if audio decode had an issue so call isn't dropped instantly
      setTimeout(() => {
        if (onEnded) onEnded();
      }, 8000);
      return null;
    }
  }

  stopCurrentIvrAudio(lineNum = null) {
    const stopLineAudio = (lineObj) => {
      if (lineObj) {
        if (lineObj.ivrSource) {
          try { lineObj.ivrSource.stop(); } catch(e) {}
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

  sipHangup(lineNum = null) {
    this.stopRingbackTone();
    this.stopCurrentIvrAudio(lineNum);

    const hangupSession = (lineObj) => {
      if (lineObj && lineObj.session) {
        try {
          const SIP = window.SIPjs;
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
      el.muted = true;
      el.volume = 0;
      document.body.appendChild(el);
    }
    
    // Completely silence computer speakers during calls
    el.muted = true;
    el.volume = 0;

    const remote = new MediaStream();
    pc.getReceivers().forEach(r => { if (r.track) remote.addTrack(r.track); });
    pc.ontrack = (ev) => {
      if (el) {
        el.muted = true;
        el.volume = 0;
      }
    };
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
  }

  closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('open'));
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
  async loadCampaignData() {
    try {
      const res = await fetch('api.php?action=get_campaign_data&campaign_id=1');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load');

      this.campaign = data.campaign;
      this.leads = data.leads || [];
      this.stats = data.stats || {};
      this.audioRecordings = data.audio_recordings || [];
      this.recentLogs = data.recent_logs || [];
      this.serverToday = data.server_today || new Date().toISOString().split('T')[0];
      this.availableDates = data.available_dates || [];
      this.remainingCount = data.remaining_count || 0;

      this.renderCampaignHeader();
      this.renderStats();
      this.renderLeadsTables();
      this.renderActiveChannels();
      this.renderUnansweredTable();
      this.renderLogsTable(this.recentLogs);
      this.renderHistoryTable();
      this.populateAudioDropdown();
      this.updateRolloverBanners();
    } catch (err) {
      console.error(err);
      this.showToast('Could not load campaign data', 'error');
    }
  }

  getTodayLeads() {
    const today = this.serverToday || new Date().toISOString().split('T')[0];
    return this.leads.filter(l => l.is_today || l.effective_date === today || (!l.effective_date && !l.is_past));
  }

  getPastLeads() {
    const today = this.serverToday || new Date().toISOString().split('T')[0];
    return this.leads.filter(l => l.is_past || (l.effective_date && l.effective_date < today));
  }

  renderCampaignHeader() {
    if (!this.campaign) return;
    if (this.campaignTitleText) this.campaignTitleText.textContent = this.campaign.name || 'Outbound Customer Calls';
    
    if (this.campaignStatusTag) {
      this.campaignStatusTag.textContent = this.isRunning ? (this.isPaused ? 'PAUSED' : 'ACTIVE') : 'IDLE';
      this.campaignStatusTag.className = `campaign-status-tag ${this.isRunning ? (this.isPaused ? 'paused' : 'running') : 'idle'}`;
    }

    if (this.activeAudioTitle) {
      this.activeAudioTitle.textContent = this.campaign.ivr_audio_name || 'Human Welcome Recording (WAV)';
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

  renderLeadsTables(search = '', filterStatus = 'all') {
    const todayLeads = this.getTodayLeads();
    const renderTarget = (tbodyEl) => {
      if (!tbodyEl) return;
      tbodyEl.innerHTML = '';

      const query = search.toLowerCase().trim();
      const filtered = todayLeads.filter(l => {
        const matchQuery = !query || 
          (l.customer_name && l.customer_name.toLowerCase().includes(query)) ||
          (l.phone_number && l.phone_number.includes(query));
        const matchStatus = filterStatus === 'all' || l.status === filterStatus;
        return matchQuery && matchStatus;
      });

      if (filtered.length === 0) {
        const rolloverBtn = this.remainingCount > 0
          ? `<div style="margin-top:12px;"><button class="btn btn-primary btn-sm" onclick="app.bulkRolloverRemainingToToday()">Roll Over ${this.remainingCount} Unanswered Calls from Previous Days</button></div>`
          : '';
        tbodyEl.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#64748b;padding:28px;">
          <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px;">No calls in Today's List</div>
          <div style="font-size:12px;color:#64748b;">Upload today's Excel file, quick-add contacts, or roll over past unanswered calls from History.</div>
          ${rolloverBtn}
        </td></tr>`;
        return;
      }

      filtered.forEach((l, idx) => {
        const tr = document.createElement('tr');
        const stBadge = this.getStatusBadge(l.status);
        const callTime = l.call_time || 'Immediate';
        const dur = l.duration_sec ? `${l.duration_sec}s` : '-';
        const isImmediate = !l.call_time || l.call_time.toLowerCase() === 'immediate';
        const isDue = this.isLeadDueForCall(l);
        const timeBadgeStyle = (isImmediate || isDue)
          ? 'background:#e0f2fe;color:#0369a1;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;'
          : 'background:#f8fafc;color:#475569;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600;border:1px solid #e2e8f0;';

        tr.innerHTML = `
          <td>${idx + 1}</td>
          <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
          <td>
            <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" style="color:#0047AB;font-weight:700;text-decoration:none;" title="Click to Dial Outbound">
              ${this.escapeHtml(l.phone_number)}
            </a>
          </td>
          <td><span style="${timeBadgeStyle}" title="${isDue ? 'Ready to Call' : 'Scheduled for future'}">${this.escapeHtml(callTime)}</span></td>
          <td>${stBadge}</td>
          <td>${dur}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" title="Outbound Call">Call</button>
            <button class="btn btn-secondary btn-sm" onclick="app.deleteLead(${l.id})" style="color:#ef4444;" title="Delete">Delete</button>
          </td>
        `;
        tbodyEl.appendChild(tr);
      });
    };

    renderTarget(this.leadsTableBody);
    renderTarget(this.leadsTableBodyFull);
  }

  /* ─────────────────────────────────────────────────────────
     History Page & Past Calls Management
     ───────────────────────────────────────────────────────── */
  renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    if (!tbody) return;

    // Populate History Date Filter Dropdown if not filled
    const dateSelect = document.getElementById('historyDateSelect');
    if (dateSelect && this.availableDates) {
      const currentSelected = dateSelect.value;
      const today = this.serverToday || new Date().toISOString().split('T')[0];
      const pastDates = this.availableDates.filter(d => d !== today);

      let optionsHtml = '<option value="all">All Past Dates</option><option value="yesterday">Yesterday</option>';
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

    const yestDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const pastLeads = this.getPastLeads();

    const filtered = pastLeads.filter(l => {
      const effDate = l.effective_date || (l.created_at ? l.created_at.split(' ')[0] : '');

      // Date match
      if (customDate) {
        if (effDate !== customDate) return false;
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
        <td><span style="font-size:11.5px;font-weight:700;color:#0047AB;">${this.escapeHtml(effDate)}</span></td>
        <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
        <td>
          <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" style="color:#0047AB;font-weight:700;text-decoration:none;" title="Click to Call">
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

    document.getElementById('redialLeadId').value = lead.id;
    document.getElementById('redialCustomerName').textContent = lead.customer_name || 'Customer';
    document.getElementById('redialPhoneNumber').textContent = lead.phone_number || '';
    
    const today = this.serverToday || new Date().toISOString().split('T')[0];
    document.getElementById('redialDateInput').value = today;
    document.getElementById('redialTimePreset').value = 'immediate';
    const customTime = document.getElementById('redialCustomTimeInput');
    if (customTime) customTime.style.display = 'none';

    this.openModal('modalRedialSchedule');
  }

  handleRedialPresetChange(val) {
    const customTime = document.getElementById('redialCustomTimeInput');
    if (customTime) {
      customTime.style.display = (val === 'custom') ? 'block' : 'none';
      if (val === 'custom' && !customTime.value) {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        customTime.value = `${hh}:${mm}`;
      }
    }
  }

  async handleRedialSubmit(e) {
    e.preventDefault();
    const leadId = document.getElementById('redialLeadId').value;
    const newDate = document.getElementById('redialDateInput').value;
    const preset = document.getElementById('redialTimePreset').value;
    const customTime = document.getElementById('redialCustomTimeInput')?.value || '';

    let timeStr = 'Immediate';
    if (preset === 'custom' && customTime) {
      timeStr = customTime;
    } else if (preset === '+2min') {
      const d = new Date(Date.now() + 2 * 60000);
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else if (preset === '+5min') {
      const d = new Date(Date.now() + 5 * 60000);
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else if (preset === '+10min') {
      const d = new Date(Date.now() + 10 * 60000);
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else if (preset === '+30min') {
      const d = new Date(Date.now() + 30 * 60000);
      timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('new_date', newDate);
      formData.append('new_time', timeStr);

      const res = await fetch('api.php?action=reschedule_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.closeAllModals();
        this.showToast(data.message, 'success');
        await this.loadCampaignData();
        // If scheduled for today, switch to Auto-Dialer dashboard
        if (newDate === (this.serverToday || new Date().toISOString().split('T')[0])) {
          switchTab('tabLiveRoom');
        }
      } else {
        this.showToast(data.error || 'Failed to reschedule contact', 'error');
      }
    } catch(err) {
      this.showToast('Error rescheduling contact', 'error');
    }
  }

  async bulkRolloverRemainingToToday() {
    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      formData.append('target_date', this.serverToday || new Date().toISOString().split('T')[0]);
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
    a.download = `call_history_${new Date().toISOString().split('T')[0]}.csv`;
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

  renderUnansweredTable() {
    const tbody = document.getElementById('unansweredTableBody');
    const badge = document.getElementById('badgeUnansweredCount');

    const unansweredLeads = this.leads.filter(l => ['no_answer', 'busy', 'failed'].includes(l.status));
    if (badge) badge.textContent = unansweredLeads.length;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (unansweredLeads.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:24px;">No unanswered customer leads.</td></tr>`;
      return;
    }

    unansweredLeads.forEach((l, idx) => {
      const tr = document.createElement('tr');
      const stBadge = this.getStatusBadge(l.status);
      const lastAttempt = l.last_attempt_at || '-';
      const reason = l.error_message || (l.status === 'no_answer' ? 'No Answer / Timeout' : (l.status === 'busy' ? 'Busy Line' : 'Call Failed'));

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong>${this.escapeHtml(l.customer_name || 'Customer')}</strong></td>
        <td>
          <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(l.phone_number)}', '${this.escapeHtml(l.customer_name)}')" style="color:#0047AB;font-weight:700;text-decoration:none;">
            ${this.escapeHtml(l.phone_number)}
          </a>
        </td>
        <td>${stBadge} <small style="color:#64748b;margin-left:4px;">(${this.escapeHtml(reason)})</small></td>
        <td><span style="font-size:11.5px;color:#0369a1;">${this.escapeHtml(l.call_time || '-')}</span></td>
        <td style="font-size:11.5px;color:#64748b;">${this.escapeHtml(lastAttempt)}</td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="app.openRedialModal(${l.id})" title="Redial Customer">
            Redial
          </button>
          <button class="btn btn-secondary btn-sm" onclick="app.requeueSingleLead(${l.id})" style="margin-left:4px;" title="Move back to Calling Queue">
            Re-queue
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
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
    a.download = `unanswered_leads_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  getStatusBadge(st) {
    const map = {
      'pending': '<span style="background:#f1f5f9;color:#475569;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #e2e8f0;"><span style="width:6px;height:6px;border-radius:50%;background:#94a3b8;display:inline-block;"></span>Pending</span>',
      'calling': '<span style="background:#fef3c7;color:#b45309;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fde68a;box-shadow:0 0 8px rgba(245,158,11,0.25);"><span style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block;"></span>Calling...</span>',
      'answered': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Answered</span>',
      'ivr_playing': '<span style="background:#dbeafe;color:#1d4ed8;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bfdbfe;"><span style="width:6px;height:6px;border-radius:50%;background:#3b82f6;display:inline-block;"></span>IVR Playing</span>',
      'ivr_completed': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Completed</span>',
      'completed': '<span style="background:#dcfce7;color:#15803d;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #bbf7d0;"><span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block;"></span>Completed</span>',
      'busy': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>Busy</span>',
      'no_answer': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>No Answer</span>',
      'failed': '<span style="background:#fee2e2;color:#b91c1c;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;border:1px solid #fecaca;"><span style="width:6px;height:6px;border-radius:50%;background:#ef4444;display:inline-block;"></span>Failed</span>'
    };
    return map[st] || `<span style="background:#f1f5f9;color:#475569;padding:4px 10px;border-radius:12px;font-size:11.5px;font-weight:700;">${st}</span>`;
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
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px;">No audio recordings found. Click "Upload New Audio" to add one.</td></tr>`;
      return;
    }

    this.audioRecordings.forEach((a, idx) => {
      const isActive = this.campaign && (this.campaign.ivr_audio_name === a.name || this.campaign.ivr_audio_file === a.filepath);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td><strong style="color:#0047AB;">${this.escapeHtml(a.name)}</strong></td>
        <td style="font-size:12px;color:#64748b;font-family:monospace;">${this.escapeHtml(a.filename || a.filepath)}</td>
        <td>
          ${isActive 
            ? '<span class="status-badge answered" style="font-weight:700;">Active IVR</span>' 
            : '<span class="status-badge pending">Inactive</span>'}
        </td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="app.previewAudioItem('${this.escapeHtml(a.filepath || '')}')" title="Play Preview">Play</button>
        </td>
        <td>
          ${isActive 
            ? '<button class="btn btn-sm btn-success" disabled>Active</button>'
            : `<button class="btn btn-sm btn-primary" onclick="app.selectAudioRecording(${a.id})">Use for Calls</button>`}
          ${a.id > 1 
            ? `<button class="btn btn-sm btn-secondary" onclick="app.deleteAudioRecording(${a.id})" style="color:#ef4444;margin-left:4px;" title="Delete Recording">Delete</button>`
            : ''}
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
  isLeadDueForCall(lead) {
    if (!lead || !lead.call_time) return true;
    const timeStr = String(lead.call_time).trim();
    if (timeStr === '' || timeStr.toLowerCase() === 'immediate' || timeStr.toLowerCase() === 'now') {
      return true; // Immediate calls are always ready
    }

    const scheduledTs = this.getLeadScheduledTimestamp(lead);
    if (scheduledTs <= 0) return true;

    const now = Date.now();
    // If time is in the future -> WAIT
    if (now < scheduledTs) {
      return false;
    }

    // If scheduled time has arrived within the current active window (<= 3 minutes after scheduled time) -> DUE NOW
    const diffSec = (now - scheduledTs) / 1000;
    return diffSec <= 180;
  }

  getLeadScheduledTimestamp(lead) {
    if (!lead || !lead.call_time) return 0;
    const s = String(lead.call_time).trim();
    if (!s || s.toLowerCase() === 'immediate' || s.toLowerCase() === 'now') {
      return 0; // Immediate priority
    }

    // 1. Relative offsets (e.g. "+5 mins", "+15 min", "+1 hour")
    const relMatch = s.match(/^\+(\d+)\s*(?:min|mins|minute|minutes)$/i);
    if (relMatch) {
      const mins = parseInt(relMatch[1], 10);
      const created = lead.created_at ? new Date(lead.created_at).getTime() : Date.now();
      return (isNaN(created) ? Date.now() : created) + mins * 60 * 1000;
    }
    const relHourMatch = s.match(/^\+(\d+)\s*(?:hr|hrs|hour|hours)$/i);
    if (relHourMatch) {
      const hrs = parseInt(relHourMatch[1], 10);
      const created = lead.created_at ? new Date(lead.created_at).getTime() : Date.now();
      return (isNaN(created) ? Date.now() : created) + hrs * 3600 * 1000;
    }

    const now = new Date();
    let baseYear = now.getFullYear();
    let baseMonth = now.getMonth();
    let baseDate = now.getDate();

    // Check if Tomorrow
    if (/^tomorrow/i.test(s)) {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      baseYear = tomorrow.getFullYear();
      baseMonth = tomorrow.getMonth();
      baseDate = tomorrow.getDate();
    } else {
      // Check for date formats like "Sep 14, 2026", "2026-09-14", "Sep 14"
      const dateMatch = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
      if (dateMatch) {
        const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
        const mIdx = monthNames.indexOf(dateMatch[1].toLowerCase().slice(0, 3));
        if (mIdx !== -1) {
          baseMonth = mIdx;
          baseDate = parseInt(dateMatch[2], 10);
          if (dateMatch[3]) baseYear = parseInt(dateMatch[3], 10);
        }
      } else {
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) {
          baseYear = parseInt(isoMatch[1], 10);
          baseMonth = parseInt(isoMatch[2], 10) - 1;
          baseDate = parseInt(isoMatch[3], 10);
        }
      }
    }

    // 2. Standard 12-hour format: "Today, 01:50 PM", "01:50 PM", "1:50 PM", "12:50 PM", "07:50 AM"
    const match12 = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (match12) {
      let hours = parseInt(match12[1], 10);
      const minutes = parseInt(match12[2], 10);
      const seconds = match12[3] ? parseInt(match12[3], 10) : 0;
      const ampm = match12[4].toUpperCase();

      if (ampm === 'PM' && hours < 12) {
        hours += 12;
      } else if (ampm === 'AM' && hours === 12) {
        hours = 0;
      }

      const target = new Date(baseYear, baseMonth, baseDate, hours, minutes, seconds, 0);
      return target.getTime();
    }

    // 3. 24-hour time or time without AM/PM: "13:50", "13:50:00", "01:50"
    const matchTime = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if (matchTime) {
      let hours = parseInt(matchTime[1], 10);
      const minutes = parseInt(matchTime[2], 10);
      const seconds = matchTime[3] ? parseInt(matchTime[3], 10) : 0;

      // If hours is 1..6 during daytime afternoon (>= 12), infer PM
      if (hours >= 1 && hours <= 6 && now.getHours() >= 12) {
        hours += 12;
      }

      const target = new Date(baseYear, baseMonth, baseDate, hours, minutes, seconds, 0);
      return target.getTime();
    }

    // 4. Fallback Date.parse
    try {
      const cleanStr = s.replace(/^Today,\s*/i, '').replace(/^Tomorrow,\s*/i, '');
      const parsedDate = new Date(cleanStr);
      if (!isNaN(parsedDate.getTime())) {
        return parsedDate.getTime();
      }
    } catch (e) {}

    return 0;
  }

  startSchedulerLoop() {
    this.stopSchedulerLoop();
    this.schedulerInterval = setInterval(() => {
      if (this.isRunning && !this.isPaused && this.activeChannels.size === 0) {
        this.processOutboundQueue();
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
    if (this.isRunning && !this.isPaused) return;

    // Refresh queue data from database first
    await this.loadCampaignData();

    const pendingLeads = this.getTodayLeads().filter(l => l.status === 'pending');
    if (pendingLeads.length === 0) {
      this.showToast('No pending leads in today\'s list! Import an Excel file, add numbers, or roll over remaining calls from History.', 'warning');
      return;
    }

    // Ensure at least Line 1 is registered
    const l1Registered = this.line1.isRegistered;
    const l2Registered = this.line2.enabled && this.line2.isRegistered;

    if (!l1Registered && !l2Registered) {
      this.showToast('SIP Softphone is not registered to PBX! Please click Connect in Settings to register Extension.', 'error');
      openSipSettingsModal();
      return;
    }

    this.isRunning = true;
    this.isPaused = false;
    this.btnStart.disabled = true;
    this.btnPause.disabled = false;
    this.btnStop.disabled = false;

    this.renderCampaignHeader();
    const lineMode = (this.line2.enabled && l2Registered) ? 'Dual-Line (2 Concurrent Numbers)' : 'Single Line';
    this.showToast(`Auto-Dialer active [${lineMode}]: Monitoring queue...`, 'success');
    this.startSchedulerLoop();
    this.processOutboundQueue();
  }

  togglePauseCampaign() {
    if (!this.isRunning) return;
    this.isPaused = !this.isPaused;
    this.btnPause.textContent = this.isPaused ? 'Resume' : 'Pause';
    this.btnPause.className = this.isPaused ? 'btn btn-success' : 'btn btn-warning';
    this.renderCampaignHeader();
    this.showToast(this.isPaused ? 'Auto-Dialer Paused' : 'Auto-Dialer Resumed', 'info');

    if (!this.isPaused) {
      this.startSchedulerLoop();
      this.processOutboundQueue();
    } else {
      this.stopSchedulerLoop();
    }
  }

  stopCampaign() {
    this.isRunning = false;
    this.isPaused = false;
    this.stopSchedulerLoop();
    if (this._displayCountdownTimer) {
      clearInterval(this._displayCountdownTimer);
      this._displayCountdownTimer = null;
    }
    this.nextScheduledLeadWaiting = null;
    this.btnStart.disabled = false;
    this.btnPause.disabled = true;
    this.btnPause.textContent = 'Pause';
    this.btnPause.className = 'btn btn-warning';
    this.btnStop.disabled = true;

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
    this.line1.activeChannelId = null;
    this.line2.activeChannelId = null;

    this.renderActiveChannels();
    this.renderCampaignHeader();
    this.showToast('Auto-Dialer Stopped', 'info');
  }

  async processOutboundQueue() {
    if (!this.isRunning || this.isPaused) return;

    const maxConcurrent = parseInt(document.getElementById('maxConcurrentInput')?.value || 2, 10);
    const pacingDelay = parseInt(document.getElementById('pacingDelayInput')?.value || 2, 10);

    // Filter today's pending leads
    const pendingLeads = this.getTodayLeads().filter(l => l.status === 'pending');
    if (pendingLeads.length === 0 && this.activeChannels.size === 0) {
      this.stopCampaign();
      this.showToast('All pending customer leads in queue have been processed!', 'success');
      await this.loadCampaignData();
      return;
    }

    const now = Date.now();

    // 1. Immediate leads (no scheduled time)
    const immediateLeads = pendingLeads.filter(l => {
      const s = String(l.call_time || '').trim().toLowerCase();
      return !s || s === 'immediate' || s === 'now';
    });

    // 2. Scheduled leads whose time has arrived (within 60 seconds)
    const dueScheduledLeads = pendingLeads.filter(l => {
      const s = String(l.call_time || '').trim().toLowerCase();
      if (!s || s === 'immediate' || s === 'now') return false;
      const ts = this.getLeadScheduledTimestamp(l);
      if (ts <= 0) return false;
      return (now >= ts) && ((now - ts) <= 60000);
    });

    const dueLeads = [...immediateLeads, ...dueScheduledLeads];
    dueLeads.sort((a, b) => {
      const aTime = this.getLeadScheduledTimestamp(a);
      const bTime = this.getLeadScheduledTimestamp(b);
      return aTime - bTime;
    });

    // Check which lines are free
    const isLine1Free = !this.line1.activeChannelId && (!this.line1.session || this.line1.session.state === 'Terminated');
    const isLine2Free = maxConcurrent >= 2 && this.line2.enabled && this.line2.isRegistered && !this.line2.activeChannelId && (!this.line2.session || this.line2.session.state === 'Terminated');

    let leadIndex = 0;

    // Dispatch Line 1 if free
    if (isLine1Free && dueLeads.length > leadIndex && this.activeChannels.size < maxConcurrent) {
      const lead1 = dueLeads[leadIndex];
      lead1.status = 'calling';
      leadIndex++;
      this.renderLeadsTables();
      this.dialCustomerLead(lead1, 1, pacingDelay);
    }

    // Dispatch Line 2 simultaneously if free and another lead is due
    if (isLine2Free && dueLeads.length > leadIndex && this.activeChannels.size < maxConcurrent) {
      const lead2 = dueLeads[leadIndex];
      lead2.status = 'calling';
      leadIndex++;
      this.renderLeadsTables();
      this.dialCustomerLead(lead2, 2, pacingDelay);
    }

    if (this.activeChannels.size === 0) {
      this.renderActiveChannels();
    }
  }

  getNextLeadInQueue() {
    const now = Date.now();
    const pending = this.leads.filter(l => l.status === 'pending');
    if (pending.length === 0) return null;

    // Separate immediate, upcoming future, and past-expired leads
    const immediateLeads = pending.filter(l => {
      const s = String(l.call_time || '').trim().toLowerCase();
      return !s || s === 'immediate' || s === 'now';
    });

    // Future leads: scheduled time is still in the future
    const futureLeads = pending.filter(l => {
      const s = String(l.call_time || '').trim().toLowerCase();
      if (!s || s === 'immediate' || s === 'now') return false;
      const ts = this.getLeadScheduledTimestamp(l);
      return ts > now;
    });

    // Due right now leads: scheduled time arrived within last 60 seconds
    const dueNowLeads = pending.filter(l => {
      const s = String(l.call_time || '').trim().toLowerCase();
      if (!s || s === 'immediate' || s === 'now') return false;
      const ts = this.getLeadScheduledTimestamp(l);
      return ts > 0 && now >= ts && (now - ts) <= 60000;
    });

    // Priority: Immediate > Due Now > Soonest Future
    if (immediateLeads.length > 0) return immediateLeads[0];
    if (dueNowLeads.length > 0) return dueNowLeads[0];

    if (futureLeads.length > 0) {
      futureLeads.sort((a, b) => this.getLeadScheduledTimestamp(a) - this.getLeadScheduledTimestamp(b));
      return futureLeads[0];
    }

    return null;
  }

  async dialCustomerLead(lead, lineNum = 1, pacingDelay = 2) {
    const channelId = `ch_l${lineNum}_${lead.id}_${Date.now()}`;
    const audioSrc = this.campaign?.ivr_audio_file || 'assets/audio/welcome_human_voice.wav';
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
    const finishCall = async (finalStatus, durationSec, errorMsg = '') => {
      if (isFinished) return;
      isFinished = true;

      if (channelData.timerInterval) clearInterval(channelData.timerInterval);
      this.activeChannels.delete(channelId);
      lineObj.activeChannelId = null;
      lead.status = finalStatus;
      lead.duration_sec = durationSec;
      if (errorMsg) lead.error_message = errorMsg;
      this.renderActiveChannels();

      await this.updateLeadStatusBackend(lead.id, finalStatus, durationSec, errorMsg);
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

    if (!lineObj.isRegistered && !lineObj.ua) {
      this.showToast(`Cannot dial ${lead.phone_number}: Line ${lineNum} (${lineObj.ext}) is not registered!`, 'error');
      finishCall('failed', 0, `Line ${lineNum} Not Registered`);
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

        channelData.timerInterval = setInterval(() => {
          callSec++;
          channelData.duration = callSec;
          lead.duration_sec = callSec;
          this.renderActiveChannels();
        }, 1000);

        // Stream IVR audio directly into customer's phone call
        await this.playIvrAudioIntoPeerConnection(audioSrc, pc, () => {
          setTimeout(() => {
            this.sipHangup(lineNum);
            finishCall('completed', callSec || 1);
          }, 500);
        }, lineNum);
      },
      onTerminated: () => {
        finishCall(callSec > 0 ? 'completed' : 'no_answer', callSec);
      },
      onError: (err) => {
        finishCall('failed', 0, err?.message || 'Call Failed');
      },
      onReject: (resp) => {
        finishCall('no_answer', 0, resp?.reasonPhrase || 'Declined / Busy');
      }
    }, lineNum);
  }

  renderActiveChannels() {
    if (!this.channelsContainer) return;

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
        const card = document.createElement('div');
        card.className = `channel-card ${ch.status === 'answered' ? 'connected' : 'ringing'}`;
        card.innerHTML = `
          <div class="ch-header">
            <span class="ch-badge ${ch.status === 'answered' ? 'active' : 'dialing'}">
              Line ${ch.lineNum} (Ext ${ch.lineExt}) &bull; ${ch.status === 'answered' ? 'IVR Playing' : 'Dialing...'}
            </span>
            <span style="font-family:monospace;font-weight:700;color:#0047AB;">${durStr}</span>
          </div>
          <div style="font-weight:700;font-size:14px;color:#1e293b;margin-bottom:2px;">
            ${this.escapeHtml(ch.lead.customer_name || 'Customer')}
          </div>
          <div style="font-size:12px;color:#64748b;margin-bottom:6px;">
            ${this.escapeHtml(ch.lead.phone_number)}
          </div>
          <div style="font-size:11px;color:#0284c7;background:#e0f2fe;padding:4px 8px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;">
            <span>${this.escapeHtml(this.campaign?.ivr_audio_name || 'Human Greeting')}</span>
            <button class="btn btn-secondary btn-sm" onclick="app.sipHangup(${ch.lineNum})" style="padding:1px 6px;font-size:10px;height:auto;line-height:1.2;">End Call</button>
          </div>
        `;
        this.channelsContainer.appendChild(card);
      });
      return;
    }

    // Helper: build countdown text from a timestamp
    const makeCountdown = (targetTs) => {
      const diff = Math.max(0, Math.round((targetTs - Date.now()) / 1000));
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
    const isFuture = targetTs > Date.now();

    // 2. Auto-Dialer Running
    if (this.isRunning) {
      if (!next) {
        this.channelsContainer.innerHTML = `
          <div style="grid-column:1/-1;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:8px;padding:16px;text-align:center;">
            <div style="font-weight:700;color:#64748b;font-size:13px;margin-bottom:2px;">Auto-Dialer Active &bull; No Pending Leads</div>
            <div style="font-size:12px;color:#94a3b8;">All contacts have been dialed. Add numbers or click "Reset Leads" to dial again.</div>
          </div>
        `;
        return;
      }

      // Render the waiting card with a live countdown
      const countdownId = `cd_${Date.now()}`;
      this.channelsContainer.innerHTML = `
        <div style="grid-column:1/-1;background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:18px 20px;text-align:center;">
          <div style="font-weight:700;color:#15803d;font-size:14px;margin-bottom:6px;display:flex;align-items:center;justify-content:center;gap:7px;">
            <span style="width:9px;height:9px;border-radius:50%;background:#22c55e;display:inline-block;animation:pulse 1.2s ease-in-out infinite;"></span>
            Auto-Dialer Active &bull; Next Scheduled Call
          </div>
          <div style="font-size:14px;color:#1e293b;font-weight:600;margin-bottom:4px;">
            ${this.escapeHtml(next.customer_name || 'Customer')}
            <span style="color:#64748b;font-weight:400;"> &mdash; </span>
            <a href="javascript:void(0)" onclick="app.clickToDial('${this.escapeHtml(next.phone_number)}')" style="color:#0047AB;font-weight:700;text-decoration:none;">${this.escapeHtml(next.phone_number)}</a>
          </div>
          <div style="font-size:12.5px;color:#166534;margin-bottom:8px;">
            Scheduled: <strong>${this.escapeHtml(next.call_time || 'Immediate')}</strong>
          </div>
          <div id="${countdownId}" style="display:inline-block;background:#dcfce7;color:#15803d;font-weight:800;font-size:20px;padding:6px 20px;border-radius:20px;font-family:monospace;letter-spacing:1px;">
            ${isFuture ? makeCountdown(targetTs) : 'Dialing soon...'}
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
      <div style="grid-column:1/-1;background:#f8fafc;border:1.5px dashed #93c5fd;border-radius:10px;padding:16px 18px;text-align:center;">
        <div style="font-weight:700;color:#0047AB;font-size:13px;margin-bottom:4px;">
          Next Scheduled Call
        </div>
        <div style="font-size:14px;color:#1e293b;font-weight:600;margin-bottom:3px;">
          ${this.escapeHtml(next.customer_name || 'Customer')}
          <span style="color:#64748b;font-weight:400;"> &mdash; </span>
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

  async updateLeadStatusBackend(leadId, status, duration) {
    try {
      const formData = new FormData();
      formData.append('lead_id', leadId);
      formData.append('status', status);
      formData.append('duration_sec', duration);
      formData.append('audio_played', this.campaign?.ivr_audio_name || 'Human Welcome Audio');

      await fetch('api.php?action=update_lead_status', { method: 'POST', body: formData });
    } catch (e) {
      console.error(e);
    }
  }

  async resetLeads() {
    this.leads.forEach(l => {
      l.status = 'pending';
      l.duration_sec = 0;
      l.error_message = '';
    });
    this.renderLeadsTables();
    this.renderUnansweredTable();
    this.updateLocalStats();
    this.renderActiveChannels();
    this.showToast('All leads reset to pending.', 'success');

    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      await fetch('api.php?action=reset_leads', { method: 'POST', body: formData });
    } catch (e) {
      this.showToast('Failed to sync reset with database', 'error');
    }
  }

  async deleteLead(leadId) {
    // Ultra-fast optimistic UI removal (0ms latency)
    const originalLeads = [...this.leads];
    this.leads = this.leads.filter(l => Number(l.id) !== Number(leadId));
    this.renderLeadsTables();
    this.renderUnansweredTable();
    this.updateLocalStats();
    this.renderActiveChannels();
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
      if (customDate) {
        customDate.style.display = 'inline-block';
        if (!customDate.value) {
          customDate.value = new Date().toISOString().split('T')[0];
        }
      }
      if (customTime) {
        customTime.style.display = 'inline-block';
        if (!customTime.value) {
          const d = new Date(Date.now() + 15 * 60 * 1000);
          customTime.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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
      if (wrap) wrap.style.display = 'flex';
      if (customDate && !customDate.value) {
        customDate.value = new Date().toISOString().split('T')[0];
      }
      if (customTime && !customTime.value) {
        const d = new Date(Date.now() + 15 * 60 * 1000);
        customTime.value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    } else {
      if (wrap) wrap.style.display = 'none';
    }
  }

  getCalculatedCallTime(presetValue, dateVal = '', timeVal = '') {
    if (presetValue === 'immediate' || !presetValue) return 'Immediate';
    if (presetValue === 'custom') {
      let d = dateVal ? dateVal.trim() : '';
      let t = timeVal ? timeVal.trim() : '';
      if (!t && !d) return 'Immediate';
      if (!t) t = '12:00 PM';

      if (/^\d{1,2}:\d{2}$/.test(t)) {
        const [hh, mm] = t.split(':');
        const rawH = parseInt(hh, 10);
        let ampm = rawH >= 12 ? 'PM' : 'AM';
        let formattedH = (rawH % 12) || 12;
        if (rawH === 12) {
          ampm = 'PM';
          formattedH = 12;
        }
        t = `${String(formattedH).padStart(2, '0')}:${mm} ${ampm}`;
      }

      if (d) {
        try {
          const dtObj = new Date(d + 'T' + (timeVal || '12:00'));
          const today = new Date();
          if (dtObj.toDateString() === today.toDateString()) {
            return `Today, ${t}`;
          }
          const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
          return `${monthNames[dtObj.getMonth()]} ${dtObj.getDate()}, ${t}`;
        } catch(e) {
          return `${d} ${t}`;
        }
      }
      return `Today, ${t}`;
    }
    const minsMatch = presetValue.match(/\+(\d+)min/);
    if (minsMatch) {
      const mins = parseInt(minsMatch[1], 10);
      const targetDate = new Date(Date.now() + mins * 60 * 1000);
      let h = targetDate.getHours();
      const m = String(targetDate.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = (h % 12) || 12;
      return `Today, ${String(h).padStart(2, '0')}:${m} ${ampm}`;
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
    if (lead || phone) {
      this.clickToDial(phone, name);
    }
  }

  async handleModalSingleAdd(e) {
    if (e) e.preventDefault();
    const nameInp = document.getElementById('modalAddName');
    const phoneInp = document.getElementById('modalAddPhone');
    const presetSelect = document.getElementById('modalAddTimePreset');
    const customDate = document.getElementById('modalAddCustomDate')?.value;
    const customTime = document.getElementById('modalAddCustomTime')?.value;
    const notesInp = document.getElementById('modalAddNotes');

    const name = nameInp?.value.trim() || 'Customer';
    const phone = phoneInp?.value.trim() || '';
    const notes = notesInp?.value.trim() || 'Quick Add';
    const callTime = this.getCalculatedCallTime(presetSelect?.value, customDate, customTime);

    if (!phone) {
      this.showToast('Please enter a phone number', 'error');
      return;
    }

    try {
      const formData = new FormData();
      formData.append('campaign_id', this.campaign?.id || 1);
      formData.append('customer_name', name);
      formData.append('phone_number', phone);
      formData.append('call_time', callTime);
      formData.append('notes', notes);

      const res = await fetch('api.php?action=add_single_lead', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Contact ${name} added to queue!`, 'success');
        if (nameInp) nameInp.value = '';
        if (phoneInp) phoneInp.value = '';
        if (notesInp) notesInp.value = '';
        if (presetSelect) presetSelect.value = 'immediate';
        const wrap = document.getElementById('modalCustomDateTimeWrap');
        if (wrap) wrap.style.display = 'none';

        this.closeAllModals();
        if (data.lead) {
          this.leads.push(data.lead);
          this.renderLeadsTables();
          this.renderUnansweredTable();
          this.updateLocalStats();
          this.renderActiveChannels();
        } else {
          this.loadCampaignData();
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
    const fileInp = document.getElementById('leadFileInput');
    if (!fileInp || !fileInp.files || fileInp.files.length === 0) {
      this.showToast('Please select a CSV or TXT file to upload.', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('lead_file', fileInp.files[0]);
    formData.append('campaign_id', this.campaign?.id || 1);

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

        if (data.leads && Array.isArray(data.leads)) {
          this.leads = data.leads;
          this.renderLeadsTables();
          this.renderUnansweredTable();
          this.updateLocalStats();
        } else {
          await this.loadCampaignData();
        }
      } else {
        this.showToast(data.error || 'Failed to import file', 'error');
      }
    } catch (err) {
      this.showToast('Error uploading lead file', 'error');
    }
  }

  async handleManualUpload(e) {
    if (e) e.preventDefault();
    const textInp = document.getElementById('manualLeadsText');
    const text = textInp?.value.trim() || '';
    if (!text) {
      this.showToast('Please enter at least one contact line', 'error');
      return;
    }
    const formData = new FormData();
    formData.append('leads_text', text);
    formData.append('campaign_id', this.campaign?.id || 1);

    try {
      const res = await fetch('api.php?action=save_manual_leads', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        this.showToast(data.message || `Added ${data.imported} leads!`, 'success');
        if (textInp) textInp.value = '';
        this.closeAllModals();
        await this.loadCampaignData();
      } else {
        this.showToast(data.error || 'Failed to add leads', 'error');
      }
    } catch (err) {
      this.showToast('Error saving leads', 'error');
    }
  }

  /* ─────────────────────────────────────────────────────────
     Manual Outbound Calling with Dialpad
     ───────────────────────────────────────────────────────── */
  clickToDial(number, name) {
    openPhonePopup();
    const dialInput = document.getElementById('dialInput');
    if (dialInput) dialInput.value = number;
    this.startManualCall(number, name);
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
  if (window.app) window.app.sipSendDtmf(digit);
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
