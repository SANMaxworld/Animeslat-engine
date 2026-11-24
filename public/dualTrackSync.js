/**
 * DualTrackSyncController.js
 * 
 * Professional Smart Dual-Track Audio-Video Synchronization & Detection Engine.
 * Enforces:
 * 1. Single-Audio Invariant: Never allow multiple audio tracks to play simultaneously.
 * 2. Hard Master-Slave State Lock: When video pauses or stalls, audio pauses instantly.
 * 3. Atomic Seeking: Zero background bleed during scrubbing; re-aligns to exact same timestamp.
 * 4. Active Precision Detector (50ms interval): Keeps audio within 0.04s (40ms) of video PTS.
 * 5. Nuclear Reset: Complete teardown and absolute silence.
 */

(function (global) {
    'use strict';

    class DualTrackSyncController {
        /**
         * @param {HTMLVideoElement} videoElement Master video element
         * @param {HTMLAudioElement} audioElement Slave audio element
         * @param {Object} options Configuration
         */
        constructor(videoElement, audioElement, options = {}) {
            if (!videoElement) {
                throw new Error('[DualTrackSyncController] A valid <video> element is required.');
            }

            this.video = videoElement;
            this.audio = audioElement || null;

            this.debug = options.debug !== undefined ? options.debug : true;
            this.driftThresholdSnap = options.driftThresholdSnap || 0.04; // >40ms snap instantly
            this.checkIntervalMs = options.checkIntervalMs || 50;        // 50ms precision detector

            this.isSplitMode = false; // true ONLY when playing separate audio element
            this.isSeeking = false;
            this.isBuffering = false;
            this.userPlaybackRate = 1.0;
            this.lastDrift = 0;
            this.audioHls = null;

            this._listeners = [];
            this._syncTimer = null;

            this.onSyncUpdate = options.onSyncUpdate || null;           // ({ drift, status, vTime, aTime, rate })
            this.onBufferingChange = options.onBufferingChange || null; // (isBuffering, cause)
            this.onStateChange = options.onStateChange || null;

            this._initListeners();
            this._startPrecisionDetector();

            this.log('DualTrackSyncController initialized. Mode: UNIFIED_MASTER');
        }

        log(...args) {
            if (this.debug) {
                console.log('%c[DualTrackSync]', 'background: #2563eb; color: #fff; padding: 2px 5px; border-radius: 3px;', ...args);
            }
        }

        /**
         * Enforces Single-Audio Mode
         * @param {boolean} active true for Split Mode (video muted, audio in <audio>), false for Unified Master
         */
        setSplitMode(active) {
            this.isSplitMode = !!active;
            this.log('Split Mode switched to:', this.isSplitMode);

            if (this.isSplitMode) {
                // SPLIT MODE: Video is completely silenced; audio element owns playback
                this.video.muted = true;
                this.video.volume = 0;
                if (this.audio) {
                    this.audio.muted = false;
                    this.audio.volume = 1.0;
                }
            } else {
                // UNIFIED MASTER MODE: Video element plays audio via Hls.js demuxer
                this.video.muted = false;
                this.video.volume = 1.0;
                if (this.audio) {
                    this.audio.pause();
                    this.audio.removeAttribute('src');
                    this.audio.src = '';
                    this.audio.muted = true;
                    this.audio.volume = 0;
                }
                if (this.audioHls) {
                    try {
                        this.audioHls.stopLoad();
                        this.audioHls.detachMedia();
                        this.audioHls.destroy();
                    } catch (_) {}
                    this.audioHls = null;
                }
            }
            this._emitState();
        }

        // ─────────────────────────────────────────────────────────────
        // 1. HARD MASTER-SLAVE PLAY/PAUSE LOCK & LISTENERS
        // ─────────────────────────────────────────────────────────────
        _initListeners() {
            const add = (target, event, handler) => {
                if (!target) return;
                target.addEventListener(event, handler);
                this._listeners.push({ target, event, handler });
            };

            // Play synchronization
            add(this.video, 'play', async () => {
                if (this.isSeeking || this.isBuffering) return;
                this.log('Master <video> play event detected.');
                if (this.isSplitMode && this.audio) {
                    this.audio.currentTime = this.video.currentTime;
                    try {
                        await this.audio.play();
                    } catch (err) {
                        this.log('Audio play failed on video trigger:', err.message);
                    }
                }
                this._emitState();
            });

            // Pause synchronization (UNCONDITIONAL HARD PAUSE)
            add(this.video, 'pause', () => {
                this.log('Master <video> pause event detected.');
                if (this.audio && !this.audio.paused) {
                    this.audio.pause();
                }
                this._emitState();
            });

            // Guard: Audio must NEVER play while video is paused
            if (this.audio) {
                add(this.audio, 'play', () => {
                    if (this.video.paused) {
                        this.log('[Guard] Audio tried to play while video was paused! Forcing audio pause.');
                        this.audio.pause();
                    }
                });
            }

            // Buffering Handlers
            add(this.video, 'waiting', () => {
                this.log('Master <video> buffering (waiting).');
                this._handleBuffering(true, 'video');
            });
            add(this.video, 'stalled', () => {
                this.log('Master <video> stalled.');
                this._handleBuffering(true, 'video');
            });

            if (this.audio) {
                add(this.audio, 'waiting', () => {
                    if (!this.isSplitMode) return;
                    this.log('Slave <audio> buffering (waiting).');
                    this._handleBuffering(true, 'audio');
                });
            }

            // Resume when both ready
            const checkResumeFromBuffer = () => {
                if (!this.isBuffering || this.isSeeking) return;

                const videoReady = this.video.readyState >= 3;
                const audioReady = !this.isSplitMode || (this.audio && this.audio.readyState >= 3);

                if (videoReady && audioReady) {
                    this.log('Both media elements ready (readyState >= 3). Resuming pair.');
                    this._handleBuffering(false);
                }
            };

            add(this.video, 'canplay', checkResumeFromBuffer);
            add(this.video, 'canplaythrough', checkResumeFromBuffer);
            if (this.audio) {
                add(this.audio, 'canplay', checkResumeFromBuffer);
                add(this.audio, 'canplaythrough', checkResumeFromBuffer);
            }

            // Seeking Event Listener
            add(this.video, 'seeking', () => {
                if (!this.isSeeking) {
                    this.atomicSeek(this.video.currentTime);
                }
            });

            // Volume Mirroring (Forward video volume to audio in split mode)
            add(this.video, 'volumechange', () => {
                if (this.isSplitMode && this.audio) {
                    this.audio.volume = this.video.volume;
                    if (!this.video.muted) {
                        this.video.muted = true; // Maintain video silence in split mode
                    }
                }
            });

            // Video End
            add(this.video, 'ended', () => {
                this.log('Playback ended.');
                if (this.audio) {
                    this.audio.pause();
                    this.audio.currentTime = 0;
                }
                this._emitState();
            });
        }

        async _handleBuffering(isBuffering, cause = '') {
            if (this.isBuffering === isBuffering) return;
            this.isBuffering = isBuffering;

            if (this.onBufferingChange) {
                this.onBufferingChange(isBuffering, cause);
            }

            if (isBuffering) {
                this.log(`Buffering triggered by ${cause}. Pausing pair.`);
                if (this.audio && !this.audio.paused) this.audio.pause();
                if (this.video && !this.video.paused) this.video.pause();
            } else {
                if (this.isSplitMode && this.audio) {
                    this.audio.currentTime = this.video.currentTime;
                }
                this.playBoth();
            }
            this._emitState();
        }

        // ─────────────────────────────────────────────────────────────
        // 2. SMART ATOMIC SEEKING (Exact Timestamp Alignment)
        // ─────────────────────────────────────────────────────────────
        async atomicSeek(targetTime) {
            if (this.isSeeking) return;

            this.isSeeking = true;
            const wasPlaying = !this.video.paused;

            this.log(`Atomic Seek initiated -> ${targetTime.toFixed(3)}s (Was Playing: ${wasPlaying})`);

            // Step a: Hard-pause both immediately
            try {
                this.video.pause();
                if (this.audio) this.audio.pause();
            } catch (_) {}

            if (this.onSyncUpdate) {
                this.onSyncUpdate({
                    drift: 0,
                    status: 'SEEKING',
                    vTime: targetTime,
                    aTime: targetTime,
                    rate: this.userPlaybackRate
                });
            }

            // Step b: Set target timestamps on both
            this.video.currentTime = targetTime;
            if (this.isSplitMode && this.audio) {
                this.audio.currentTime = targetTime;
            }

            // Step c: Await seek completion on both with safety timeout
            const waitForSeek = (element) => {
                return new Promise((resolve) => {
                    if (!element) return resolve();
                    let finished = false;
                    const onDone = () => {
                        if (!finished) {
                            finished = true;
                            element.removeEventListener('seeked', onDone);
                            element.removeEventListener('canplay', onDone);
                            resolve();
                        }
                    };
                    element.addEventListener('seeked', onDone, { once: true });
                    element.addEventListener('canplay', onDone, { once: true });
                    setTimeout(onDone, 1200);
                });
            };

            const promises = [waitForSeek(this.video)];
            if (this.isSplitMode && this.audio) {
                promises.push(waitForSeek(this.audio));
            }
            await Promise.all(promises);

            // Step d: Hard re-align audio to video timestamp before unlock
            if (this.isSplitMode && this.audio) {
                this.audio.currentTime = this.video.currentTime;
            }

            this.isSeeking = false;
            this.log(`Atomic Seek completed @ ${this.video.currentTime.toFixed(3)}s.`);

            if (this.onSyncUpdate) {
                this.onSyncUpdate({
                    drift: 0,
                    status: 'LOCKED',
                    vTime: this.video.currentTime,
                    aTime: this.audio ? this.audio.currentTime : this.video.currentTime,
                    rate: this.userPlaybackRate
                });
            }

            // Step e: Resume together if playing before seek
            if (wasPlaying) {
                await this.playBoth();
            }

            this._emitState();
        }

        // ─────────────────────────────────────────────────────────────
        // 3. ACTIVE PRECISION DETECTOR LOOP (50ms interval)
        // ─────────────────────────────────────────────────────────────
        _startPrecisionDetector() {
            if (this._syncTimer) clearInterval(this._syncTimer);

            this._syncTimer = setInterval(() => {
                this._detectAndCorrectDrift();
            }, this.checkIntervalMs);
        }

        _detectAndCorrectDrift() {
            // Guard 1: If video is paused, audio MUST be paused
            if (this.video.paused) {
                if (this.audio && !this.audio.paused) {
                    this.log('[Detector Guard] Video paused but audio is running! Halting audio.');
                    this.audio.pause();
                }
                return;
            }

            // Guard 2: Skip during seek or buffer
            if (this.isSeeking || this.isBuffering) {
                if (this.audio && !this.audio.paused) {
                    this.audio.pause();
                }
                return;
            }

            // In unified mode, Hls.js demuxer keeps PTS in sync; report status
            if (!this.isSplitMode || !this.audio) {
                if (this.onSyncUpdate) {
                    this.onSyncUpdate({
                        drift: 0,
                        status: 'UNIFIED_SYNC',
                        vTime: this.video.currentTime,
                        aTime: this.video.currentTime,
                        rate: this.userPlaybackRate
                    });
                }
                return;
            }

            // In split mode, calculate exact drift
            const vTime = this.video.currentTime;
            const aTime = this.audio.currentTime;
            const drift = aTime - vTime; // positive = audio ahead
            this.lastDrift = drift;
            const absDrift = Math.abs(drift);

            let syncStatus = 'LOCKED';

            // ZERO TOLERANCE: If drift exceeds 0.04s (40ms), snap immediately
            if (absDrift > this.driftThresholdSnap) {
                this.audio.currentTime = vTime;
                this.audio.playbackRate = this.userPlaybackRate;
                syncStatus = 'SNAPPED_IN_SYNC';
            } else if (absDrift > 0.015) {
                // Micro-catch up for 15ms-40ms
                if (drift > 0) {
                    this.audio.playbackRate = this.userPlaybackRate * 0.95;
                    syncStatus = 'SLOWING_AUDIO';
                } else {
                    this.audio.playbackRate = this.userPlaybackRate * 1.05;
                    syncStatus = 'SPEEDING_AUDIO';
                }
            } else {
                if (this.audio.playbackRate !== this.userPlaybackRate) {
                    this.audio.playbackRate = this.userPlaybackRate;
                }
                syncStatus = 'LOCKED';
            }

            if (this.onSyncUpdate) {
                this.onSyncUpdate({
                    drift,
                    status: syncStatus,
                    vTime,
                    aTime,
                    rate: this.audio.playbackRate
                });
            }
        }

        // ─────────────────────────────────────────────────────────────
        // 4. SEAMLESS QUALITY & AUDIO SWITCHING
        // ─────────────────────────────────────────────────────────────
        async switchVideoQuality(switchAction) {
            const savedTime = this.video.currentTime;
            const wasPlaying = !this.video.paused;

            this.log(`Switching video quality @ ${savedTime.toFixed(2)}s...`);

            if (this.isSplitMode && this.audio) {
                this.audio.pause();
            }

            if (typeof switchAction === 'function') {
                await switchAction();
            }

            const onCanPlay = async () => {
                this.video.removeEventListener('canplay', onCanPlay);
                this.video.currentTime = savedTime;
                if (this.isSplitMode && this.audio) {
                    this.audio.currentTime = savedTime;
                }
                if (wasPlaying) {
                    await this.playBoth();
                }
                this.log(`Quality switch complete @ ${this.video.currentTime.toFixed(2)}s`);
            };

            this.video.addEventListener('canplay', onCanPlay, { once: true });
            setTimeout(onCanPlay, 1000);
        }

        async switchAudioTrack(switchAction) {
            const savedTime = this.video.currentTime;
            const wasPlaying = !this.video.paused;

            this.log(`Switching audio track @ ${savedTime.toFixed(2)}s...`);

            if (typeof switchAction === 'function') {
                await switchAction();
            }

            if (this.isSplitMode && this.audio) {
                this.audio.currentTime = savedTime;
                this.audio.playbackRate = this.userPlaybackRate;
            }

            if (wasPlaying) {
                await this.playBoth();
            }
        }

        /**
         * Loads an independent audio HLS stream into the <audio> element for split playback
         */
        loadSplitAudioStream(audioUrl, hlsConfig = {}) {
            if (!this.audio || !audioUrl) return;

            // Stop previous audio stream completely
            if (this.audioHls) {
                try {
                    this.audioHls.stopLoad();
                    this.audioHls.detachMedia();
                    this.audioHls.destroy();
                } catch (_) {}
                this.audioHls = null;
            }
            this.audio.pause();
            this.audio.removeAttribute('src');
            this.audio.src = '';
            this.audio.load();

            this.setSplitMode(true);

            if (typeof window !== 'undefined' && window.Hls && window.Hls.isSupported()) {
                this.audioHls = new window.Hls({
                    debug: false,
                    enableWorker: true,
                    lowLatencyMode: true,
                    ...hlsConfig
                });
                this.audioHls.attachMedia(this.audio);
                this.audioHls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
                    this.audioHls.loadSource(audioUrl);
                });
                this.audioHls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                    this.log('Split audio manifest parsed.');
                    this.audio.currentTime = this.video.currentTime;
                    if (!this.video.paused) {
                        this.audio.play().catch(() => {});
                    }
                });
            } else if (this.audio.canPlayType('application/vnd.apple.mpegurl')) {
                this.audio.src = audioUrl;
                this.audio.currentTime = this.video.currentTime;
                if (!this.video.paused) {
                    this.audio.play().catch(() => {});
                }
            }
        }

        // ─────────────────────────────────────────────────────────────
        // 5. PLAYBACK CONTROLS
        // ─────────────────────────────────────────────────────────────
        async playBoth() {
            if (this.isSeeking) return;

            try {
                if (this.isSplitMode && this.audio) {
                    this.audio.currentTime = this.video.currentTime;
                    this.audio.playbackRate = this.userPlaybackRate;
                    await Promise.all([
                        this.video.play().catch(e => this.log('Video play error:', e.message)),
                        this.audio.play().catch(e => this.log('Audio play error:', e.message))
                    ]);
                } else {
                    await this.video.play();
                }
            } catch (err) {
                this.log('Play error:', err.message);
            }
            this._emitState();
        }

        pauseBoth() {
            try {
                if (this.video) this.video.pause();
                if (this.audio) this.audio.pause();
            } catch (_) {}
            this._emitState();
        }

        setPlaybackRate(rate) {
            const speed = parseFloat(rate) || 1.0;
            this.userPlaybackRate = speed;
            if (this.video) this.video.playbackRate = speed;
            if (this.audio) this.audio.playbackRate = speed;
            this._emitState();
        }

        _emitState() {
            if (this.onStateChange) {
                this.onStateChange({
                    isPlaying: !this.video.paused,
                    isSeeking: this.isSeeking,
                    isBuffering: this.isBuffering,
                    isSplitMode: this.isSplitMode,
                    rate: this.userPlaybackRate
                });
            }
        }

        getStats() {
            const vTime = this.video ? this.video.currentTime : 0;
            const aTime = (this.isSplitMode && this.audio) ? this.audio.currentTime : vTime;
            const drift = (this.isSplitMode && this.audio) ? Math.abs(this.audio.currentTime - vTime) : 0;
            return {
                videoTime: vTime,
                audioTime: aTime,
                drift: drift,
                isSplitMode: this.isSplitMode,
                isPlaying: this.video ? !this.video.paused : false,
                isSeeking: this.isSeeking,
                isBuffering: this.isBuffering
            };
        }

        // ─────────────────────────────────────────────────────────────
        // 6. NUCLEAR RESET & COMPLETE SILENCE
        // ─────────────────────────────────────────────────────────────
        destroy() {
            this.log('Nuclear reset called on DualTrackSyncController.');
            if (this._syncTimer) {
                clearInterval(this._syncTimer);
                this._syncTimer = null;
            }

            this.pauseBoth();

            if (this.audioHls) {
                try {
                    this.audioHls.stopLoad();
                    this.audioHls.detachMedia();
                    this.audioHls.destroy();
                } catch (_) {}
                this.audioHls = null;
            }

            if (this.audio) {
                this.audio.pause();
                this.audio.removeAttribute('src');
                this.audio.src = '';
                this.audio.load();
                this.audio.muted = true;
                this.audio.volume = 0;
            }

            if (this.video) {
                this.video.pause();
                this.video.removeAttribute('src');
                this.video.src = '';
                this.video.load();
                this.video.muted = true;
            }

            this._listeners.forEach(({ target, event, handler }) => {
                try {
                    target.removeEventListener(event, handler);
                } catch (_) {}
            });
            this._listeners = [];

            this.video = null;
            this.audio = null;
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DualTrackSyncController;
    } else {
        global.DualTrackSyncController = DualTrackSyncController;
    }

})(typeof window !== 'undefined' ? window : this);
