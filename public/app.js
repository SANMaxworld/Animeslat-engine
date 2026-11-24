/**
 * AnimeSalt HLS Dashboard & Playback Lab Controller
 * Integrates Hls.js, Web Audio API analysis, and real-time network interception.
 */

document.addEventListener('DOMContentLoaded', () => {
    // ── Application State ──
    const state = {
        traffic: [],
        currentFilter: 'all',
        mediaStreams: [],
        activeStreamUrl: null,
        activeReferer: 'https://animesalt.cx/',
        hls: null,
        audioContext: null,
        audioAnalyser: null,
        audioSourceNode: null,
        audioMeterAnimFrame: null,
        videoFragsCount: 0,
        audioFragsCount: 0
    };

    // ── UI Elements ──
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const cookieCount = document.getElementById('cookieCount');
    const clearSessionBtn = document.getElementById('clearSessionBtn');
    const challengeBanner = document.getElementById('challengeBanner');
    const challengeMessage = document.getElementById('challengeMessage');

    const fetchForm = document.getElementById('fetchForm');
    const targetUrlInput = document.getElementById('targetUrl');
    const headedCheck = document.getElementById('headedCheck');
    const autoMediaCheck = document.getElementById('autoMediaCheck');
    const fetchBtn = document.getElementById('fetchBtn');
    const activeUrlDisplay = document.getElementById('activeUrlDisplay');

    const mediaSpotlightCard = document.getElementById('mediaSpotlightCard');
    const mediaStreamCount = document.getElementById('mediaStreamCount');
    const mediaList = document.getElementById('mediaList');

    // Lab Player Elements
    const labStreamUrlInput = document.getElementById('labStreamUrl');
    const loadLabStreamBtn = document.getElementById('loadLabStreamBtn');
    const analyzeManifestBtn = document.getElementById('analyzeManifestBtn');
    const useProxyToggle = document.getElementById('useProxyToggle');
    const labVideo = document.getElementById('labVideo');
    const labAudio = document.getElementById('labAudio');
    const playerOverlay = document.getElementById('playerOverlay');
    const playerSpinner = document.getElementById('playerSpinner');
    const overlayMsg = document.getElementById('overlayMsg');

    // Dual-Track Synchronization Controller Instance
    let syncController = null;

    function initSyncEngine() {
        if (window.DualTrackSyncController && labVideo && labAudio) {
            if (syncController) {
                try { syncController.destroy(); } catch (_) {}
            }
            syncController = new window.DualTrackSyncController(labVideo, labAudio, {
                debug: true,
                driftThresholdSnap: 0.04, // >40ms snap immediately
                checkIntervalMs: 50,      // 50ms precision detector
                onSyncUpdate: ({ drift, status, vTime, aTime, rate }) => {
                    if (protoTimeReadout && labVideo.duration) {
                        protoTimeReadout.textContent = `${formatDuration(vTime)} / ${formatDuration(labVideo.duration)}`;
                    }
                    const protoDriftMs = document.getElementById('protoDriftMs');
                    if (protoDriftMs) {
                        const ms = Math.round(drift * 1000);
                        protoDriftMs.textContent = `(${ms >= 0 ? '+' : ''}${ms} ms drift)`;
                    }
                    if (protoSyncStatus) {
                        let badgeClass = 'sync-status in-sync';
                        let text = `Locked & Synced (${formatDuration(vTime)})`;
                        if (status === 'SEEKING') {
                            badgeClass = 'sync-status seeking';
                            text = `Seeking to ${formatDuration(vTime)}...`;
                        } else if (status === 'SLOWING_AUDIO') {
                            badgeClass = 'sync-status drift';
                            text = `Catch-up (-5% speed)`;
                        } else if (status === 'SPEEDING_AUDIO') {
                            badgeClass = 'sync-status drift';
                            text = `Catch-up (+5% speed)`;
                        } else if (status === 'SNAPPED_IN_SYNC') {
                            badgeClass = 'sync-status in-sync';
                            text = `PTS Re-aligned (<40ms)`;
                        }
                        protoSyncStatus.className = badgeClass;
                        protoSyncStatus.textContent = text;
                    }
                },
                onBufferingChange: (isBuffering, cause) => {
                    if (isBuffering) {
                        setDiagState(diagOverallStatus, 'warn', `BUFFERING (${cause ? cause.toUpperCase() : 'PAIR'})`);
                        playerSpinner.style.display = 'block';
                        playerOverlay.classList.remove('hidden');
                        if (protoSyncStatus) {
                            protoSyncStatus.className = 'sync-status seeking';
                            protoSyncStatus.textContent = `Buffering (${cause})...`;
                        }
                    } else {
                        setDiagState(diagOverallStatus, 'pass', 'PLAYING');
                        playerSpinner.style.display = 'none';
                        playerOverlay.classList.add('hidden');
                    }
                }
            });
            window.syncControllerInstance = syncController;
        }
    }

    const qualitySelect = document.getElementById('qualitySelect');
    const audioSelect = document.getElementById('audioSelect');
    const subtitleSelect = document.getElementById('subtitleSelect');

    // Diagnostics Indicators
    const diagPlaylistDetected = document.getElementById('diagPlaylistDetected');
    const diagPlaylistLoaded = document.getElementById('diagPlaylistLoaded');
    const diagManifestParsed = document.getElementById('diagManifestParsed');
    const diagVideoVariants = document.getElementById('diagVideoVariants');
    const diagAudioTracks = document.getElementById('diagAudioTracks');
    const diagVideoFrags = document.getElementById('diagVideoFrags');
    const diagAudioFrags = document.getElementById('diagAudioFrags');
    const diagVideoDecoding = document.getElementById('diagVideoDecoding');
    const diagAudioOutput = document.getElementById('diagAudioOutput');
    const diagOverallStatus = document.getElementById('diagOverallStatus');
    const audioLevelDb = document.getElementById('audioLevelDb');
    const meterFill = document.getElementById('meterFill');

    // Prototype Quick-Switch Controls
    const protoQualityBadge = document.getElementById('protoQualityBadge');
    const protoQualityPills = document.getElementById('protoQualityPills');
    const protoQualityLinkRow = document.getElementById('protoQualityLinkRow');
    const protoQualityLinkInput = document.getElementById('protoQualityLinkInput');
    const copyQualityLinkBtn = document.getElementById('copyQualityLinkBtn');

    const protoAudioBadge = document.getElementById('protoAudioBadge');
    const protoAudioPills = document.getElementById('protoAudioPills');
    const protoAudioLinkRow = document.getElementById('protoAudioLinkRow');
    const protoAudioLinkInput = document.getElementById('protoAudioLinkInput');
    const copyAudioLinkBtn = document.getElementById('copyAudioLinkBtn');

    const protoSyncStatus = document.getElementById('protoSyncStatus');
    const protoTimeReadout = document.getElementById('protoTimeReadout');

    const resetDashboardBtn = document.getElementById('resetDashboardBtn');
    const topResetDashboardBtn = document.getElementById('topResetDashboardBtn');

    // Structural Analyzer Elements
    const analyzerBox = document.getElementById('analyzerBox');
    const archBadge = document.getElementById('archBadge');
    const archDesc = document.getElementById('archDesc');
    const variantsTableBody = document.getElementById('variantsTableBody');
    const audioTableBody = document.getElementById('audioTableBody');

    // HTTP 403 Diagnostics Box
    const http403Box = document.getElementById('http403Box');
    const diag403Url = document.getElementById('diag403Url');
    const diag403ReasonsList = document.getElementById('diag403ReasonsList');

    // Traffic Table & Filters
    const trafficTableBody = document.getElementById('trafficTableBody');
    const countAll = document.getElementById('countAll');
    const countMedia = document.getElementById('countMedia');
    const countBlob = document.getElementById('countBlob');
    const countXhr = document.getElementById('countXhr');

    const consoleBox = document.getElementById('consoleBox');
    const clearLogsBtn = document.getElementById('clearLogsBtn');

    // ── Diagnostic Indicator Helper ──
    function setDiagState(el, stateType, text) {
        if (!el) return;
        el.className = 'diag-item ' + stateType; // pass | warn | fail
        const valSpan = el.querySelector('.diag-val');
        if (valSpan) valSpan.textContent = text;
    }

    function resetDiagnostics() {
        setDiagState(diagPlaylistDetected, '', 'No');
        setDiagState(diagPlaylistLoaded, '', 'No');
        setDiagState(diagManifestParsed, '', 'No');
        setDiagState(diagVideoVariants, '', '0');
        setDiagState(diagAudioTracks, '', '0');
        setDiagState(diagVideoFrags, '', '0 loaded');
        setDiagState(diagAudioFrags, '', '0 loaded');
        setDiagState(diagVideoDecoding, '', 'Waiting...');
        setDiagState(diagAudioOutput, '', 'Inactive');
        setDiagState(diagOverallStatus, '', 'IDLE');
        audioLevelDb.textContent = 'Mute / No Audio';
        meterFill.style.width = '0%';
        state.videoFragsCount = 0;
        state.audioFragsCount = 0;
    }

    // ── Web Audio API Real-Time Sound Meter ──
    function initWebAudioMeter() {
        if (state.audioContext) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            state.audioContext = new AudioContext();
            state.audioAnalyser = state.audioContext.createAnalyser();
            state.audioAnalyser.fftSize = 256;

            state.audioSourceNode = state.audioContext.createMediaElementSource(labVideo);
            state.audioSourceNode.connect(state.audioAnalyser);
            state.audioAnalyser.connect(state.audioContext.destination);

            monitorAudioSignal();
        } catch (e) {
            console.warn('[WebAudio] Audio context initialization skipped:', e.message);
        }
    }

    function monitorAudioSignal() {
        if (!state.audioAnalyser) return;
        const dataArray = new Uint8Array(state.audioAnalyser.frequencyBinCount);

        function updateMeter() {
            state.audioAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const percentage = Math.min(100, Math.round((average / 128) * 100));

            meterFill.style.width = percentage + '%';

            if (!labVideo.paused && labVideo.currentTime > 0) {
                if (percentage > 2) {
                    audioLevelDb.textContent = `Active Sound (${percentage}% volume)`;
                    setDiagState(diagAudioOutput, 'pass', `Active (${percentage}%)`);
                } else {
                    audioLevelDb.textContent = 'Silent (0% - No Audio Detected)';
                    setDiagState(diagAudioOutput, 'warn', 'MUTE / SILENT');
                }
            } else {
                audioLevelDb.textContent = 'Paused / Idle';
                meterFill.style.width = '0%';
            }

            state.audioMeterAnimFrame = requestAnimationFrame(updateMeter);
        }

        updateMeter();
    }

    // ── Hls.js Playback Engine ──
    function loadHlsStream(streamUrl, referer = state.activeReferer) {
        if (!streamUrl) return;

        // Reset previous player state
        if (state.hls) {
            state.hls.destroy();
            state.hls = null;
        }

        initSyncEngine();
        resetDiagnostics();
        analyzerBox.style.display = 'none';
        http403Box.style.display = 'none';

        state.activeStreamUrl = streamUrl;
        labStreamUrlInput.value = streamUrl;

        // Determine actual URL (Direct vs Proxy)
        const useProxy = useProxyToggle.checked;
        const playUrl = useProxy 
            ? `/api/proxy-hls?url=${encodeURIComponent(streamUrl)}&referer=${encodeURIComponent(referer || 'https://animesalt.cx/')}`
            : streamUrl;

        setDiagState(diagPlaylistDetected, 'pass', 'Yes');
        setDiagState(diagPlaylistLoaded, 'warn', 'Loading manifest...');
        setDiagState(diagOverallStatus, 'warn', 'BUFFERING');

        playerOverlay.classList.remove('hidden');
        playerSpinner.style.display = 'block';
        overlayMsg.textContent = useProxy ? 'Loading stream through HLS Proxy...' : 'Loading direct stream...';

        // Check Hls.js support
        if (window.Hls && window.Hls.isSupported()) {
            const hls = new window.Hls({
                debug: false,
                enableWorker: true,
                lowLatencyMode: true,
                maxBufferLength: 30,
                maxMaxBufferLength: 60
            });
            state.hls = hls;

            hls.attachMedia(labVideo);

            hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
                hls.loadSource(playUrl);
            });

            hls.on(window.Hls.Events.MANIFEST_LOADED, () => {
                setDiagState(diagPlaylistLoaded, 'pass', 'Loaded (HTTP 200)');
            });

            hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
                setDiagState(diagManifestParsed, 'pass', 'Valid Manifest');
                setDiagState(diagVideoVariants, 'pass', `${data.levels.length} detected`);

                // Populate Video Quality Selector
                qualitySelect.innerHTML = '<option value="-1">Auto (ABR Mode)</option>';
                data.levels.forEach((level, idx) => {
                    const opt = document.createElement('option');
                    opt.value = idx;
                    const res = level.height ? `${level.height}p` : `${level.width}x${level.height}`;
                    const kbps = level.bitrate ? `${Math.round(level.bitrate / 1000)} kbps` : '';
                    opt.textContent = `${res} (${kbps})`;
                    qualitySelect.appendChild(opt);
                });
                qualitySelect.disabled = false;

                // ── Render Single-Selection Video Quality Box ──
                function renderProtoQualityButtons() {
                    const container = document.getElementById('protoQualityList') || document.getElementById('protoQualityPills');
                    if (!container) return;
                    container.innerHTML = '';

                    // 1. Auto (ABR Dynamic) Card
                    const isAuto = hls.currentLevel === -1;
                    const autoCard = document.createElement('div');
                    autoCard.className = `selector-item ${isAuto ? 'selected' : ''}`;
                    autoCard.innerHTML = `
                        <div class="item-left">
                            <span class="radio-circle"><span class="radio-dot"></span></span>
                            <span class="item-label">⚡ Auto (ABR Dynamic)</span>
                        </div>
                        <span class="item-meta">Adaptive Bandwidth</span>
                        ${isAuto ? '<span class="active-check">✓ Active</span>' : ''}
                    `;
                    autoCard.onclick = () => {
                        if (syncController) {
                            syncController.switchVideoQuality(() => {
                                hls.currentLevel = -1;
                                qualitySelect.value = -1;
                            });
                        } else {
                            hls.currentLevel = -1;
                            qualitySelect.value = -1;
                        }
                        protoQualityBadge.textContent = 'Auto (ABR Mode)';
                        if (protoQualityLinkRow) protoQualityLinkRow.style.display = 'none';
                        renderProtoQualityButtons();
                    };
                    container.appendChild(autoCard);

                    // 2. Detected Resolution Levels (1080p, 720p, 480p, 360p, 240p)
                    data.levels.forEach((lvl, idx) => {
                        const isSelected = hls.currentLevel === idx;
                        const resLabel = lvl.height ? `${lvl.height}p` : `${lvl.width}x${lvl.height}`;
                        const kbps = lvl.bitrate ? `${Math.round(lvl.bitrate / 1000)} kbps` : '';
                        
                        let badgeDesc = '';
                        if (lvl.height >= 1080) badgeDesc = 'Full HD';
                        else if (lvl.height >= 720) badgeDesc = 'HD High';
                        else if (lvl.height >= 480) badgeDesc = 'Standard SD';
                        else badgeDesc = 'Data Saver';

                        const card = document.createElement('div');
                        card.className = `selector-item ${isSelected ? 'selected' : ''}`;
                        card.innerHTML = `
                            <div class="item-left">
                                <span class="radio-circle"><span class="radio-dot"></span></span>
                                <span class="item-label">🎞️ ${resLabel} (${badgeDesc})</span>
                            </div>
                            <span class="item-meta">${kbps}</span>
                            ${isSelected ? '<span class="active-check">✓ Active</span>' : ''}
                        `;

                        card.onclick = () => {
                            if (syncController) {
                                syncController.switchVideoQuality(() => {
                                    hls.currentLevel = idx;
                                    qualitySelect.value = idx;
                                });
                            } else {
                                hls.currentLevel = idx;
                                qualitySelect.value = idx;
                            }
                            protoQualityBadge.textContent = `${resLabel} (${kbps})`;

                            const lvlUrl = lvl.url || (lvl.details ? lvl.details.url : '');
                            if (lvlUrl && protoQualityLinkRow) {
                                protoQualityLinkRow.style.display = 'flex';
                                protoQualityLinkInput.value = lvlUrl;
                            }
                            renderProtoQualityButtons();
                        };
                        container.appendChild(card);
                    });
                }

                renderProtoQualityButtons();

                // ── Render Single-Selection Audio Language Box ──
                function updateAudioTracksUI(tracks) {
                    const audioTracks = tracks || hls.audioTracks || [];
                    setDiagState(diagAudioTracks, audioTracks.length > 0 ? 'pass' : 'warn', `${audioTracks.length} detected`);

                    audioSelect.innerHTML = '';
                    const container = document.getElementById('protoAudioList') || document.getElementById('protoAudioPills');
                    if (container) container.innerHTML = '';

                    if (audioTracks.length === 0) {
                        audioSelect.innerHTML = '<option value="-1">Multiplexed / Default Audio</option>';
                        if (container) container.innerHTML = '<div class="p-2 text-muted text-xs italic">Embedded / Multiplexed Audio in Video</div>';
                        if (protoAudioBadge) protoAudioBadge.textContent = 'Embedded Audio';
                        if (protoAudioLinkRow) protoAudioLinkRow.style.display = 'none';
                    } else {
                        audioTracks.forEach((track, idx) => {
                            const lang = track.lang ? track.lang.toUpperCase() : '';
                            let flag = '🔊';
                            if (lang === 'JPN') flag = '🇯🇵';
                            else if (lang === 'ENG') flag = '🇬🇧';
                            else if (lang === 'HIN') flag = '🇮🇳';
                            else if (lang === 'TEL' || lang === 'TAM') flag = '🇮🇳';

                            const label = `${flag} ${track.name || 'Track ' + (idx + 1)} [${lang}]`;

                            const opt = document.createElement('option');
                            opt.value = idx;
                            opt.textContent = `${label} ${track.default ? '(Default)' : ''}`;
                            if (idx === hls.audioTrack) opt.selected = true;
                            audioSelect.appendChild(opt);

                            // Single-Selection Audio Item
                            if (container) {
                                const isSelected = idx === hls.audioTrack;
                                const card = document.createElement('div');
                                card.className = `selector-item ${isSelected ? 'selected audio-selected' : ''}`;
                                card.innerHTML = `
                                    <div class="item-left">
                                        <span class="radio-circle"><span class="radio-dot"></span></span>
                                        <span class="item-label">${label}</span>
                                    </div>
                                    <span class="item-meta">${track.default ? 'Default Track' : 'Dubbed Audio'}</span>
                                    ${isSelected ? '<span class="active-check">✓ Active Voice</span>' : ''}
                                `;

                                card.onclick = () => {
                                    // 1. SILENCE and halt any secondary <audio> element to prevent multiple audios
                                    if (labAudio) {
                                        labAudio.pause();
                                        labAudio.removeAttribute('src');
                                        labAudio.src = '';
                                    }

                                    // 2. Switch Hls master audio track cleanly
                                    if (syncController) {
                                        syncController.setSplitMode(false); // Master mode
                                        syncController.switchAudioTrack(() => {
                                            hls.audioTrack = idx;
                                            audioSelect.value = idx;
                                        });
                                    } else {
                                        hls.audioTrack = idx;
                                        audioSelect.value = idx;
                                    }
                                    protoAudioBadge.textContent = label;

                                    const aUrl = track.url || '';
                                    if (aUrl && protoAudioLinkRow) {
                                        protoAudioLinkRow.style.display = 'flex';
                                        protoAudioLinkInput.value = aUrl;
                                    }
                                    updateAudioTracksUI(audioTracks);
                                };
                                container.appendChild(card);
                            }
                        });
                    }
                    audioSelect.disabled = audioTracks.length === 0;
                }

                // Initial populate
                updateAudioTracksUI(hls.audioTracks);

                hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, (event, data) => {
                    console.log('[Player] Audio tracks updated:', data.audioTracks ? data.audioTracks.length : 0);
                    updateAudioTracksUI(data.audioTracks);
                });

                hls.on(window.Hls.Events.AUDIO_TRACK_SWITCHED, (event, data) => {
                    const track = hls.audioTracks[data.id];
                    const trackName = track ? `${track.name} [${track.lang ? track.lang.toUpperCase() : ''}]` : `Track ${data.id}`;
                    console.log(`[Player] Active audio track switched to: ${trackName}`);
                    setDiagState(diagAudioTracks, 'pass', `Active: ${trackName}`);
                    if (protoAudioBadge) protoAudioBadge.textContent = trackName;
                    audioSelect.value = data.id;
                    updateAudioTracksUI(hls.audioTracks);
                });

                // Populate Subtitles
                const subTracks = hls.subtitleTracks || [];
                subtitleSelect.innerHTML = '<option value="-1">Disabled</option>';
                subTracks.forEach((sub, idx) => {
                    const opt = document.createElement('option');
                    opt.value = idx;
                    opt.textContent = `${sub.lang ? `[${sub.lang}] ` : ''}${sub.name || 'Sub ' + (idx + 1)}`;
                    subtitleSelect.appendChild(opt);
                });
                subtitleSelect.disabled = subTracks.length === 0;

                playerSpinner.style.display = 'none';
                playerOverlay.classList.remove('hidden');
                overlayMsg.textContent = 'Stream loaded & ready. Click Play to start playback.';
                labVideo.pause();

                // Auto-analyze structure in background
                analyzePlaylistManifest(streamUrl, referer);
            });

            // Fragment Load Tracking
            hls.on(window.Hls.Events.FRAG_LOADED, (event, data) => {
                if (data.frag.type === 'audio') {
                    state.audioFragsCount++;
                    setDiagState(diagAudioFrags, 'pass', `${state.audioFragsCount} frags`);
                } else {
                    state.videoFragsCount++;
                    setDiagState(diagVideoFrags, 'pass', `${state.videoFragsCount} frags`);
                }
            });

            // Quality level switched by ABR
            hls.on(window.Hls.Events.LEVEL_SWITCHED, (event, data) => {
                if (qualitySelect.value === '-1') {
                    const level = hls.levels[data.level];
                    if (level) {
                        setDiagState(diagVideoVariants, 'pass', `Auto: ${level.height}p`);
                    }
                }
            });

            // Error Handling
            hls.on(window.Hls.Events.ERROR, (event, data) => {
                console.error('[Hls.js Error]', data);

                if (data.response && data.response.code === 403) {
                    setDiagState(diagPlaylistLoaded, 'fail', 'HTTP 403 Forbidden');
                    setDiagState(diagOverallStatus, 'fail', 'ERROR (403)');
                    trigger403Diagnosis(streamUrl, referer);
                    document.getElementById('acc403').open = true;
                } else if (data.fatal) {
                    setDiagState(diagOverallStatus, 'fail', `FATAL: ${data.details}`);
                    overlayMsg.textContent = `Playback error: ${data.details}`;
                    playerOverlay.classList.remove('hidden');
                    playerSpinner.style.display = 'none';

                    switch (data.type) {
                        case window.Hls.ErrorTypes.NETWORK_ERROR:
                            if (!useProxy) {
                                overlayMsg.textContent = 'CORS Block / Network Error. Try enabling "Use HLS Proxy" above.';
                                document.getElementById('accCORS').open = true;
                            }
                            hls.startLoad();
                            break;
                        case window.Hls.ErrorTypes.MEDIA_ERROR:
                            document.getElementById('accCodec').open = true;
                            hls.recoverMediaError();
                            break;
                        default:
                            hls.destroy();
                            break;
                    }
                }
            });

        } else if (labVideo.canPlayType('application/vnd.apple.mpegurl')) {
            // Native HLS fallback (Safari / iOS)
            labVideo.src = playUrl;
            labVideo.addEventListener('loadedmetadata', () => {
                setDiagState(diagPlaylistLoaded, 'pass', 'Native HLS Loaded');
                setDiagState(diagManifestParsed, 'pass', 'Native Parser');
                playerSpinner.style.display = 'none';
                playerOverlay.classList.remove('hidden');
                overlayMsg.textContent = 'Stream loaded & ready. Click Play to start playback.';
                labVideo.pause();
            });
        } else {
            overlayMsg.textContent = 'HLS is not supported in this browser environment.';
            setDiagState(diagOverallStatus, 'fail', 'NO_HLS_SUPPORT');
        }

        // Initialize Audio Analyser on first user gesture
        initWebAudioMeter();
    }

    // ── HTML5 Video Player Event Listeners ──
    labVideo.addEventListener('playing', () => {
        setDiagState(diagOverallStatus, 'pass', 'PLAYING');
        setDiagState(diagVideoDecoding, 'pass', `Active (${labVideo.videoWidth}x${labVideo.videoHeight})`);
        playerOverlay.classList.add('hidden');
        if (state.audioContext && state.audioContext.state === 'suspended') {
            state.audioContext.resume();
        }
    });

    labVideo.addEventListener('pause', () => {
        if (!labVideo.ended) {
            setDiagState(diagOverallStatus, 'warn', 'PAUSED');
        }
    });

    labVideo.addEventListener('waiting', () => {
        setDiagState(diagOverallStatus, 'warn', 'BUFFERING');
        playerSpinner.style.display = 'block';
        playerOverlay.classList.remove('hidden');
    });

    function formatDuration(sec) {
        if (!sec || isNaN(sec)) return '00:00.000';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const ms = Math.floor((sec % 1) * 1000);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
    }

    // ── Dedicated Seeking & Audio/Video Timeline Synchronizer ──
    labVideo.addEventListener('seeking', () => {
        const cur = formatDuration(labVideo.currentTime);
        if (protoSyncStatus) {
            protoSyncStatus.textContent = `Seeking to ${cur}...`;
            protoSyncStatus.className = 'sync-status seeking';
        }
    });

    labVideo.addEventListener('seeked', () => {
        const cur = formatDuration(labVideo.currentTime);
        if (protoSyncStatus) {
            protoSyncStatus.textContent = `In Sync @ ${cur}`;
            protoSyncStatus.className = 'sync-status in-sync';
        }
    });

    labVideo.addEventListener('timeupdate', () => {
        if (labVideo.currentTime > 0 && labVideo.videoWidth > 0) {
            setDiagState(diagVideoDecoding, 'pass', `Rendering (${labVideo.videoWidth}x${labVideo.videoHeight})`);
        }
        if (protoTimeReadout && labVideo.duration) {
            protoTimeReadout.textContent = `${formatDuration(labVideo.currentTime)} / ${formatDuration(labVideo.duration)}`;
        }
    });

    // ── Prototype Copy URL Buttons ──
    if (copyQualityLinkBtn) {
        copyQualityLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(protoQualityLinkInput.value);
            copyQualityLinkBtn.textContent = '✓ Copied';
            setTimeout(() => copyQualityLinkBtn.textContent = '📋 Copy', 1500);
        });
    }

    if (copyAudioLinkBtn) {
        copyAudioLinkBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(protoAudioLinkInput.value);
            copyAudioLinkBtn.textContent = '✓ Copied';
            setTimeout(() => copyAudioLinkBtn.textContent = '📋 Copy', 1500);
        });
    }

    // ── Full System Refresh & Nuclear Reset Function ──
    async function resetFullDashboard() {
        console.log('[RESET] Nuclear Reset initiated: Silencing all background audio & media.');

        // 1. Destroy DualTrackSyncController
        if (syncController) {
            try { syncController.destroy(); } catch (_) {}
            syncController = null;
        }

        // 2. Destroy Hls.js instance on video
        if (state.hls) {
            try {
                state.hls.stopLoad();
                state.hls.detachMedia();
                state.hls.destroy();
            } catch (_) {}
            state.hls = null;
        }

        // 3. Complete teardown of video element
        labVideo.pause();
        labVideo.removeAttribute('src');
        labVideo.src = '';
        labVideo.load();
        labVideo.muted = true;
        labVideo.volume = 0;

        // 4. Complete teardown of audio element
        if (labAudio) {
            labAudio.pause();
            labAudio.removeAttribute('src');
            labAudio.src = '';
            labAudio.load();
            labAudio.muted = true;
            labAudio.volume = 0;
        }

        // 5. Nuclear teardown of Web Audio API (Stop all audio graph output)
        if (state.audioSourceNode) {
            try { state.audioSourceNode.disconnect(); } catch (_) {}
            state.audioSourceNode = null;
        }
        if (state.audioAnalyser) {
            try { state.audioAnalyser.disconnect(); } catch (_) {}
            state.audioAnalyser = null;
        }
        if (state.audioContext) {
            try { state.audioContext.close(); } catch (_) {}
            state.audioContext = null;
        }
        if (state.audioMeterAnimFrame) {
            cancelAnimationFrame(state.audioMeterAnimFrame);
            state.audioMeterAnimFrame = null;
        }

        playerOverlay.classList.remove('hidden');
        playerSpinner.style.display = 'none';
        overlayMsg.textContent = 'System completely reset. Audio silenced. Ready for new test.';

        resetDiagnostics();

        // Reset selector boxes
        const qList = document.getElementById('protoQualityList') || document.getElementById('protoQualityPills');
        const aList = document.getElementById('protoAudioList') || document.getElementById('protoAudioPills');
        if (qList) qList.innerHTML = '<span class="proto-hint">Available qualities will appear when stream loads...</span>';
        if (protoQualityBadge) protoQualityBadge.textContent = 'Auto (ABR Mode)';
        if (protoQualityLinkRow) protoQualityLinkRow.style.display = 'none';

        if (aList) aList.innerHTML = '<span class="proto-hint">Available audio tracks will appear when stream loads...</span>';
        if (protoAudioBadge) protoAudioBadge.textContent = 'Default Audio';
        if (protoAudioLinkRow) protoAudioLinkRow.style.display = 'none';

        if (protoSyncStatus) {
            protoSyncStatus.textContent = 'Locked & Synced';
            protoSyncStatus.className = 'sync-status in-sync';
        }
        const protoDriftMs = document.getElementById('protoDriftMs');
        if (protoDriftMs) protoDriftMs.textContent = '(0 ms drift)';
        if (protoTimeReadout) protoTimeReadout.textContent = '00:00.000 / 00:00.000';

        // Clear captured streams list
        state.mediaStreams = [];
        mediaStreamCount.textContent = '0 Found';
        mediaList.innerHTML = '<div class="empty-state">System reset. Enter a new episode link above to intercept.</div>';

        // Reset input box for new entry
        targetUrlInput.value = '';
        targetUrlInput.placeholder = 'Paste new AnimeSalt URL, e.g. https://animesalt.cx/episode/...';
        targetUrlInput.focus();

        activeUrlDisplay.textContent = 'about:blank';

        // Clear session on backend
        try {
            await fetch('/api/session/clear', { method: 'POST' });
            if (cookieCount) cookieCount.textContent = '0';
        } catch (_) {}

        alert('System & Lab reset complete. Background media silenced. Ready for new stream test!');
    }

    if (resetDashboardBtn) resetDashboardBtn.addEventListener('click', resetFullDashboard);
    if (topResetDashboardBtn) topResetDashboardBtn.addEventListener('click', resetFullDashboard);

    // ── Quality and Audio Selectors Change Handlers ──
    qualitySelect.addEventListener('change', () => {
        if (!state.hls) return;
        const levelIdx = parseInt(qualitySelect.value, 10);
        if (syncController) {
            syncController.switchVideoQuality(() => {
                state.hls.currentLevel = levelIdx; // -1 for auto
            });
        } else {
            state.hls.currentLevel = levelIdx;
        }
        console.log(`[Player] Quality switched to index: ${levelIdx}`);
    });

    audioSelect.addEventListener('change', () => {
        if (!state.hls) return;
        const trackIdx = parseInt(audioSelect.value, 10);
        if (syncController) {
            syncController.switchAudioTrack(() => {
                state.hls.audioTrack = trackIdx;
            });
        } else {
            state.hls.audioTrack = trackIdx;
        }
        console.log(`[Player] Audio track switched to: ${trackIdx}`);
    });

    subtitleSelect.addEventListener('change', () => {
        if (!state.hls) return;
        const subIdx = parseInt(subtitleSelect.value, 10);
        state.hls.subtitleTrack = subIdx;
        console.log(`[Player] Subtitle track switched to: ${subIdx}`);
    });

    // ── Master Playlist Analyzer Trigger ──
    async function analyzePlaylistManifest(url, referer) {
        if (!url) return;
        try {
            const res = await fetch('/api/analyze-playlist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, referer })
            });
            const data = await res.json();

            if (data.status === 403 || (data.diagnosis && data.status === 403)) {
                render403Diagnosis(data.diagnosis, url);
                return;
            }

            if (data.success && data.analysis) {
                renderManifestAnalysis(data.analysis);
            }
        } catch (e) {
            console.warn('[Analyzer] Failed to analyze manifest:', e.message);
        }
    }

    function renderManifestAnalysis(analysis) {
        analyzerBox.style.display = 'block';
        http403Box.style.display = 'none';

        archBadge.textContent = analysis.audioArchitecture || 'UNKNOWN';
        archDesc.textContent = analysis.audioDescription || '';

        if (analysis.audioArchitecture === 'VIDEO_ONLY') {
            archBadge.style.background = 'var(--accent-red)';
            document.getElementById('accMissingAudio').open = true;
        } else if (analysis.audioArchitecture === 'SEPARATE_AUDIO_RENDITIONS') {
            archBadge.style.background = 'var(--accent-green)';
            archBadge.style.color = '#000';
        } else {
            archBadge.style.background = 'var(--accent-blue)';
        }

        // Render Variants Table
        variantsTableBody.innerHTML = '';
        if (analysis.variants && analysis.variants.length > 0) {
            analysis.variants.forEach(v => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${v.resolutionString}</strong></td>
                    <td>${v.bandwidth ? Math.round(v.bandwidth / 1000) + ' kbps' : '-'}</td>
                    <td>${v.averageBandwidth ? Math.round(v.averageBandwidth / 1000) + ' kbps' : '-'}</td>
                    <td>${v.frameRate ? v.frameRate + ' fps' : '-'}</td>
                    <td class="text-xs text-muted font-mono">${v.codecs || 'None'}</td>
                    <td class="truncate" style="max-width:200px" title="${v.uri}">${v.rawUri}</td>
                `;
                variantsTableBody.appendChild(tr);
            });
        } else {
            variantsTableBody.innerHTML = '<tr><td colspan="6" class="text-muted">No variant streams declared in manifest.</td></tr>';
        }

        // Render Audio Renditions Table
        audioTableBody.innerHTML = '';
        if (analysis.audioRenditions && analysis.audioRenditions.length > 0) {
            analysis.audioRenditions.forEach(a => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><code>${a.groupId}</code></td>
                    <td><strong>${a.name}</strong></td>
                    <td><span class="badge badge-media">${a.language.toUpperCase()}</span></td>
                    <td>${a.isDefault ? '✓ Yes' : 'No'}</td>
                    <td>${a.autoSelect ? '✓ Yes' : 'No'}</td>
                    <td>${a.channels || '2.0'}</td>
                    <td class="truncate" style="max-width:200px" title="${a.uri}">${a.rawUri || '(Embedded)'}</td>
                `;
                audioTableBody.appendChild(tr);
            });
        } else {
            audioTableBody.innerHTML = '<tr><td colspan="7" class="text-muted">No separate audio renditions (#EXT-X-MEDIA:TYPE=AUDIO) found. Audio is multiplexed or absent.</td></tr>';
        }
    }

    // ── HTTP 403 Diagnostics Display ──
    async function trigger403Diagnosis(url, referer) {
        try {
            const res = await fetch('/api/diagnose-403', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, referer })
            });
            const data = await res.json();
            render403Diagnosis(data.diagnosis || [], url);
        } catch (_) {}
    }

    function render403Diagnosis(reasons, url) {
        http403Box.style.display = 'block';
        diag403Url.textContent = url;
        diag403ReasonsList.innerHTML = '';

        if (!reasons || reasons.length === 0) {
            reasons = [{
                title: 'HTTP 403 Forbidden Access Denial',
                detail: 'The media server rejected the request. Typically caused by missing Referer or expired token.',
                resolution: 'Enable "Use HLS Proxy" to inject provider Referer.'
            }];
        }

        reasons.forEach(r => {
            const item = document.createElement('div');
            item.className = 'diag-reason-item';
            item.innerHTML = `
                <div class="diag-reason-title">⚠️ ${r.title} [${r.category || '403'}]</div>
                <div class="diag-reason-detail">${r.detail}</div>
                <div class="diag-reason-resolution">💡 Resolution: ${r.resolution}</div>
            `;
            diag403ReasonsList.appendChild(item);
        });
    }

    // ── Load Lab Stream Button ──
    loadLabStreamBtn.addEventListener('click', () => {
        const url = labStreamUrlInput.value.trim();
        if (!url) return;
        loadHlsStream(url, state.activeReferer);
    });

    analyzeManifestBtn.addEventListener('click', () => {
        const url = labStreamUrlInput.value.trim();
        if (!url) return;
        analyzePlaylistManifest(url, state.activeReferer);
    });

    // ── Captured Resources List Rendering ──
    function addCapturedStream(stream) {
        const isMaster = stream.isMaster || stream.type === 'MASTER_HLS' || stream.url.includes('master.m3u8');
        const isAudio = stream.isAudio || stream.type === 'AUDIO_TRACK' || (stream.label && stream.label.includes('Audio')) || stream.url.includes('audio');
        const isBlob = stream.isBlob || stream.url.startsWith('blob:');

        let badgeBg = 'bg-[var(--surface-container-high)] text-[var(--foreground)]';
        let label = stream.label || (isMaster ? '⭐ Master (Video + Audio)' : (isAudio ? '🔊 Audio Track' : '🎬 Video Stream'));

        if (isBlob) {
            badgeBg = 'bg-gray-600 text-white font-bold';
            label = stream.label || '⚪ Blob Media Object';
        } else if (isMaster) {
            badgeBg = 'bg-[var(--accent-green)] text-black font-bold';
            label = stream.label || '⭐ Master (Video + Audio)';
        } else if (isAudio) {
            badgeBg = 'bg-purple-600 text-white font-bold';
            label = stream.label || '🔊 Audio Track';
        } else {
            badgeBg = 'bg-blue-600 text-white font-bold';
            label = stream.label || '🎬 Video Stream';
        }

        const existingIdx = state.mediaStreams.findIndex(s => s.url === stream.url);
        if (existingIdx !== -1) {
            // Update in-place
            state.mediaStreams[existingIdx] = { ...state.mediaStreams[existingIdx], ...stream, label, isAudio, isMaster };
            const existingEl = mediaList.querySelector(`[data-url="${CSS.escape(stream.url)}"]`);
            if (existingEl) {
                const badgeEl = existingEl.querySelector('.media-type-badge');
                if (badgeEl) {
                    badgeEl.className = `media-type-badge ${badgeBg}`;
                    badgeEl.textContent = label;
                }
            }
            return;
        }

        state.mediaStreams.push({ ...stream, label, isAudio, isMaster });

        mediaSpotlightCard.style.display = 'block';
        mediaStreamCount.textContent = `${state.mediaStreams.length} Found`;

        if (mediaList.querySelector('.empty-state')) {
            mediaList.innerHTML = '';
        }

        const item = document.createElement('div');
        item.className = `media-item ${isMaster ? 'master-item' : ''}`;
        item.setAttribute('data-url', stream.url);

        let actionBtns = '';
        if (!isBlob) {
            if (isAudio) {
                actionBtns += '<button class="btn btn-secondary btn-sm pair-audio-btn">🔊 Pair Audio</button>';
                actionBtns += '<button class="btn btn-primary btn-sm test-btn">🔬 Test Solo</button>';
            } else {
                actionBtns += '<button class="btn btn-primary btn-sm test-btn">🔬 Test in Lab</button>';
            }
        }
        actionBtns += '<button class="btn btn-secondary btn-sm copy-btn">📋 Copy</button>';

        item.innerHTML = `
            <span class="media-type-badge ${badgeBg}">${label}</span>
            <span class="media-url" title="${stream.url}">${stream.url}</span>
            <div class="flex gap-2">
                ${actionBtns}
            </div>
        `;

        if (!isBlob) {
            const testBtn = item.querySelector('.test-btn');
            if (testBtn) {
                testBtn.addEventListener('click', () => {
                    loadHlsStream(stream.url, state.activeReferer);
                    document.getElementById('playbackLabSection').scrollIntoView({ behavior: 'smooth' });
                });
            }

            const pairAudioBtn = item.querySelector('.pair-audio-btn');
            if (pairAudioBtn) {
                pairAudioBtn.addEventListener('click', () => {
                    initSyncEngine();
                    const useProxy = useProxyToggle.checked;
                    const playUrl = useProxy 
                        ? `/api/proxy-hls?url=${encodeURIComponent(stream.url)}&referer=${encodeURIComponent(state.activeReferer || 'https://animesalt.cx/')}`
                        : stream.url;
                    if (syncController) {
                        syncController.loadSplitAudioStream(playUrl);
                        if (protoAudioBadge) protoAudioBadge.textContent = stream.label || 'Split Audio Track';
                        if (protoAudioLinkRow) {
                            protoAudioLinkRow.style.display = 'flex';
                            protoAudioLinkInput.value = stream.url;
                        }
                        if (protoSyncStatus) {
                            protoSyncStatus.textContent = 'Dual-Track Split Synced';
                            protoSyncStatus.className = 'sync-status in-sync';
                        }
                    }
                });
            }
        }

        item.querySelector('.copy-btn').addEventListener('click', (e) => {
            navigator.clipboard.writeText(stream.url);
            e.target.textContent = '✓ Copied!';
            setTimeout(() => e.target.textContent = '📋 Copy', 2000);
        });

        // Insert Master streams at the top
        if (isMaster && mediaList.firstChild) {
            mediaList.insertBefore(item, mediaList.firstChild);
        } else {
            mediaList.appendChild(item);
        }

        // Auto-load master in lab if lab is currently idle
        if (isMaster && !state.activeStreamUrl) {
            labStreamUrlInput.value = stream.url;
        }
    }

    // ── Network Traffic Table & Filters ──
    document.querySelectorAll('#trafficFilterPills .pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('#trafficFilterPills .pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            state.currentFilter = pill.dataset.filter;
            renderTrafficTable();
        });
    });

    function addTrafficEntry(req) {
        state.traffic.push(req);
        if (state.traffic.length > 400) state.traffic.shift();

        updateTrafficCounters();
        renderTrafficTable();

        if (req.category === 'media' || req.isBlob) {
            addCapturedStream({
                url: req.url,
                type: req.url.includes('master.m3u8') ? 'MASTER_HLS' : (req.url.includes('audio') ? 'AUDIO_TRACK' : (req.isBlob ? 'BLOB_RESOURCE' : 'HLS_VARIANT')),
                isMaster: req.url.includes('master.m3u8'),
                isBlob: req.isBlob
            });
        }
    }

    function updateTrafficCounters() {
        countAll.textContent = state.traffic.length;
        countMedia.textContent = state.traffic.filter(t => t.category === 'media').length;
        countBlob.textContent = state.traffic.filter(t => t.category === 'blob' || t.isBlob).length;
        countXhr.textContent = state.traffic.filter(t => t.category === 'xhr').length;
    }

    function renderTrafficTable() {
        const filtered = state.currentFilter === 'all'
            ? state.traffic
            : state.traffic.filter(t => t.category === state.currentFilter || (state.currentFilter === 'blob' && t.isBlob));

        trafficTableBody.innerHTML = '';
        if (filtered.length === 0) {
            trafficTableBody.innerHTML = '<tr class="empty-row"><td colspan="4">No requests matching filter.</td></tr>';
            return;
        }

        filtered.slice(-50).reverse().forEach(t => {
            const tr = document.createElement('tr');
            let badgeClass = `badge-${t.category || 'other'}`;
            if (t.isBlob) badgeClass = 'badge-other';

            tr.innerHTML = `
                <td><strong>${t.method || 'GET'}</strong></td>
                <td><span class="badge ${badgeClass}">${t.isBlob ? 'BLOB' : (t.category || t.resourceType)}</span></td>
                <td><span class="${t.status === 403 ? 'text-error font-bold' : ''}">${t.status || '-'}</span></td>
                <td class="url-cell" title="${t.url}">${t.url}</td>
            `;
            trafficTableBody.appendChild(tr);
        });
    }

    // ── Log Line Appender ──
    function appendLog(entry) {
        const line = document.createElement('div');
        line.className = `log-line log-${entry.level}`;
        const time = entry.timestamp ? entry.timestamp.split('T')[1].replace('Z', '') : '';
        line.textContent = `[${time}] [${entry.level}] ${entry.message}`;
        consoleBox.appendChild(line);
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }

    // ── Server-Sent Events (SSE) ──
    function initEventStream() {
        const evtSource = new EventSource('/api/events');

        evtSource.addEventListener('log', (e) => {
            try { appendLog(JSON.parse(e.data)); } catch (_) {}
        });

        evtSource.addEventListener('challenge_required', (e) => {
            try {
                const data = JSON.parse(e.data);
                challengeBanner.style.display = 'flex';
                challengeMessage.textContent = `Security verification screen encountered on: ${data.url}. Please complete verification in the visible Chromium window.`;
                statusDot.className = 'dot challenge';
                statusText.textContent = 'CHALLENGE_REQUIRED';
            } catch (_) {}
        });

        evtSource.addEventListener('network_request', (e) => {
            try { 
                const req = JSON.parse(e.data);
                addTrafficEntry(req);
                if (req.category === 'media' || req.isBlob) {
                    addCapturedStream(req);
                }
            } catch (_) {}
        });

        evtSource.addEventListener('manifest_correlated', (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.tracks && Array.isArray(data.tracks)) {
                    data.tracks.forEach(track => addCapturedStream(track));
                }
            } catch (_) {}
        });

        evtSource.addEventListener('fetch_completed', (e) => {
            try {
                const res = JSON.parse(e.data);
                if (res.mediaStreams && res.mediaStreams.length > 0) {
                    res.mediaStreams.forEach(s => addCapturedStream(s));
                }
                fetchBtn.disabled = false;
                fetchBtn.innerHTML = '<span>🚀</span> Intercept Stream';
            } catch (_) {}
        });

        evtSource.onerror = () => {
            statusText.textContent = 'RECONNECTING';
            statusDot.className = 'dot error';
        };
    }

    // ── Target Fetch Submission ──
    fetchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = targetUrlInput.value.trim();
        if (!url) return;

        state.activeReferer = url;
        fetchBtn.disabled = true;
        fetchBtn.innerHTML = '<span>⏳</span> Intercepting...';
        challengeBanner.style.display = 'none';

        try {
            const res = await fetch('/api/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url,
                    headed: headedCheck.checked,
                    autoInteractMedia: autoMediaCheck.checked,
                    timeout: 40000
                })
            });

            const data = await res.json();
            if (data.mediaStreams && data.mediaStreams.length > 0) {
                data.mediaStreams.forEach(s => addCapturedStream(s));
            }
        } catch (err) {
            alert('Fetch failed: ' + err.message);
        } finally {
            fetchBtn.disabled = false;
            fetchBtn.innerHTML = '<span>🚀</span> Intercept Stream';
            pollStatus();
        }
    });

    // ── Clear Session ──
    clearSessionBtn.addEventListener('click', async () => {
        if (!confirm('Clear all stored cookies and session storage?')) return;
        try {
            await fetch('/api/session/clear', { method: 'POST' });
            state.mediaStreams = [];
            mediaList.innerHTML = '<div class="empty-state">Session cleared. Start a new fetch.</div>';
            alert('Session cleared.');
            pollStatus();
        } catch (err) {
            alert('Failed to clear session: ' + err.message);
        }
    });

    clearLogsBtn.addEventListener('click', () => {
        consoleBox.innerHTML = '';
    });

    // ── Status Polling ──
    async function pollStatus() {
        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            if (data.success) {
                const s = data.data;
                statusText.textContent = s.status || 'IDLE';
                statusDot.className = 'dot ' + (s.status ? s.status.toLowerCase() : 'idle');
                cookieCount.textContent = s.cookieCount || 0;
                activeUrlDisplay.textContent = s.currentUrl || 'about:blank';
                if (s.status === 'CHALLENGE_REQUIRED') {
                    challengeBanner.style.display = 'flex';
                } else {
                    challengeBanner.style.display = 'none';
                }
            }
        } catch (_) {}
    }

    // ── Initialization ──
    initEventStream();
    pollStatus();
    setInterval(pollStatus, 4000);
});
