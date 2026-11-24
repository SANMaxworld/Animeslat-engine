/**
 * External Fetch Engine with Real-Time Interception and Verification Workflow
 */
const browserController = require('../browser/controller');
const sessionManager = require('../session/manager');
const responseParser = require('../parser/extractor');
const hlsParser = require('../parser/hlsParser');
const logger = require('../utils/logger');
const EventEmitter = require('events');

class FetchEngine extends EventEmitter {
    constructor() {
        super();
        this.fetchHistory = [];
        this.maxHistory = 50;
    }

    /**
     * Detects if the current page is an active verification challenge screen
     */
    async detectChallenge(page, response) {
        try {
            const title = (await page.title()) || '';
            const status = response ? response.status() : 200;

            const isChallengeTitle = (
                title.includes('Just a moment...') ||
                title.includes('Attention Required!') ||
                title.includes('Cloudflare') ||
                title.includes('Security Verification')
            );

            const isChallengeStatus = (status === 403 || status === 503);

            if (isChallengeTitle && isChallengeStatus) {
                return { isChallenge: true, reason: `HTTP ${status} with title '${title}'` };
            }

            // Check DOM selectors
            const hasChallengeElement = await page.evaluate(() => {
                return !!(
                    document.querySelector('#challenge-running') ||
                    document.querySelector('#cf-challenge-running') ||
                    document.querySelector('#turnstile-wrapper') ||
                    document.querySelector('.cf-browser-verification')
                );
            }).catch(() => false);

            if (hasChallengeElement || isChallengeTitle) {
                return { isChallenge: true, reason: hasChallengeElement ? 'Challenge DOM elements detected' : `Challenge title: ${title}` };
            }

            return { isChallenge: false };
        } catch (_) {
            return { isChallenge: false };
        }
    }

    /**
     * Executes an external fetch request using Chromium
     */
    async executeFetch(options = {}) {
        const {
            url,
            method = 'GET',
            headers = {},
            extractMedia = true,
            waitForSelector = null,
            timeout = 30000,
            headed = true,
            autoInteractMedia = false
        } = options;

        if (!url) {
            throw new Error('URL is required for fetch operation.');
        }

        const startTime = Date.now();
        const interceptedRequests = [];
        const mediaStreams = [];
        const manifestTrackMap = new Map();
        let mainResponse = null;

        logger.info(`Initiating fetch for: ${url} (Method: ${method})`);
        const { page, context } = await browserController.ensureReady(headed);

        browserController.setStatus('NAVIGATING');
        browserController.currentUrl = url;

        // Clean up any previous listeners
        page.removeAllListeners('request');
        page.removeAllListeners('response');

        // Setup Request Listener
        const onRequest = (req) => {
            const reqUrl = req.url();
            const isBlob = reqUrl.startsWith('blob:');
            const resourceType = req.resourceType();
            const category = isBlob ? 'blob' : responseParser.classifyResource(reqUrl, resourceType);

            // Deduplicate: check if this identical URL already exists
            const existing = interceptedRequests.find(r => r.url === reqUrl && r.method === req.method());
            if (existing) {
                existing.count = (existing.count || 1) + 1;
                existing.lastTimestamp = new Date().toISOString();
                return;
            }

            // Classify media stream type & determine label
            let streamType, label, isMaster;
            if (category === 'media' || isBlob) {
                const knownTrack = manifestTrackMap.get(reqUrl);
                if (knownTrack) {
                    streamType = knownTrack.type;
                    label = knownTrack.label;
                    isMaster = false;
                } else {
                    streamType = isBlob ? 'BLOB_RESOURCE' : responseParser.getMediaStreamType(reqUrl);
                    isMaster = streamType === 'MASTER_HLS';
                    label = isBlob 
                        ? '⚪ Blob Media Object' 
                        : (isMaster ? '⭐ Master (Video + Audio)' : (streamType === 'AUDIO_TRACK' ? '🔊 Audio Track' : '🎬 Video Stream'));
                }
            }

            const reqEntry = {
                id: Date.now() + '-' + Math.random().toString(36).substr(2, 4),
                timestamp: new Date().toISOString(),
                method: req.method(),
                url: reqUrl,
                isBlob,
                resourceType,
                category,
                status: null,
                contentType: null,
                headers: req.headers(),
                count: 1,
                streamType: streamType || null,
                label: label || null,
                isMaster: isMaster || false,
                isAudio: streamType === 'AUDIO_TRACK' || (label && label.includes('Audio')) || false
            };

            interceptedRequests.push(reqEntry);
            this.emit('network_request', reqEntry);

            // Log media stream requests in real-time
            if (category === 'media' || isBlob) {
                logger.success(`[${label.toUpperCase()}] -> ${reqUrl.substring(0, 100)}...`);

                const existingStream = mediaStreams.find(m => m.url === reqUrl);
                if (!existingStream) {
                    mediaStreams.push({
                        type: streamType,
                        label,
                        isBlob,
                        isMaster,
                        isAudio: reqEntry.isAudio,
                        url: reqUrl,
                        headers: req.headers()
                    });
                } else if (manifestTrackMap.has(reqUrl)) {
                    const match = manifestTrackMap.get(reqUrl);
                    existingStream.type = match.type;
                    existingStream.label = match.label;
                    existingStream.isAudio = match.isAudio || false;
                }
            }
        };

        // Setup Response Listener
        const onResponse = (res) => {
            const resUrl = res.url();
            const status = res.status();
            const headers = res.headers();
            const contentType = headers['content-type'] || '';
            const category = resUrl.startsWith('blob:') ? 'blob' : responseParser.classifyResource(resUrl, res.request().resourceType(), contentType);

            // Update matching intercepted request with status code and content-type
            const matchedReq = interceptedRequests.find(r => r.url === resUrl);
            if (matchedReq) {
                matchedReq.status = status;
                matchedReq.contentType = contentType;
            }

            const resEntry = {
                url: resUrl,
                status,
                contentType,
                category
            };

            this.emit('network_response', resEntry);

            // If response is a master manifest or child playlist, read and correlate all tracks
            if ((resUrl.includes('.m3u8') || resUrl.includes('/hls/') || contentType.includes('mpegurl')) && status === 200) {
                res.text().then(text => {
                    if (hlsParser.isMasterPlaylist(text)) {
                        const parsed = hlsParser.parseMasterPlaylist(text, resUrl);
                        // Map audio tracks
                        parsed.audioRenditions.forEach(a => {
                            if (a.uri) {
                                manifestTrackMap.set(a.uri, {
                                    type: 'AUDIO_TRACK',
                                    label: `🔊 Audio: ${a.name} [${a.language.toUpperCase()}]`,
                                    language: a.language,
                                    name: a.name,
                                    isAudio: true
                                });
                            }
                        });
                        // Map video variants
                        parsed.variants.forEach(v => {
                            if (v.uri) {
                                manifestTrackMap.set(v.uri, {
                                    type: 'HLS_VARIANT',
                                    label: `🎬 Video: ${v.resolutionString}`,
                                    resolution: v.resolutionString,
                                    isVideo: true
                                });
                            }
                        });

                        // Retroactively re-label any mediaStreams that were already captured
                        mediaStreams.forEach(stream => {
                            const match = manifestTrackMap.get(stream.url);
                            if (match) {
                                stream.type = match.type;
                                stream.label = match.label;
                                stream.isAudio = match.isAudio || false;
                                if (match.language) stream.language = match.language;
                                if (match.name) stream.name = match.name;
                                if (match.resolution) stream.resolution = match.resolution;
                            }
                        });

                        // Add all audio renditions directly to mediaStreams so user can test any language
                        parsed.audioRenditions.forEach(a => {
                            if (a.uri && !mediaStreams.find(m => m.url === a.uri)) {
                                mediaStreams.push({
                                    type: 'AUDIO_TRACK',
                                    label: `🔊 Audio: ${a.name} [${a.language.toUpperCase()}]`,
                                    isBlob: false,
                                    isMaster: false,
                                    isAudio: true,
                                    language: a.language,
                                    name: a.name,
                                    url: a.uri
                                });
                            }
                        });

                        // Add all video variants directly to mediaStreams so user can test any resolution
                        parsed.variants.forEach(v => {
                            if (v.uri && !mediaStreams.find(m => m.url === v.uri)) {
                                mediaStreams.push({
                                    type: 'HLS_VARIANT',
                                    label: `🎬 Video: ${v.resolutionString}`,
                                    isBlob: false,
                                    isMaster: false,
                                    isVideo: true,
                                    resolution: v.resolutionString,
                                    url: v.uri
                                });
                            }
                        });

                        this.emit('manifest_correlated', {
                            masterUrl: resUrl,
                            tracks: Array.from(manifestTrackMap.entries()).map(([url, t]) => ({ url, ...t }))
                        });
                        logger.success(`Correlated Master Manifest tracks: ${parsed.audioRenditionCount} Audio tracks, ${parsed.variantCount} Video variants.`);
                    } else if (hlsParser.isMediaPlaylist(text)) {
                        // Check if this child media playlist is audio or video based on target duration
                        const isAudioPlaylist = text.includes('TARGETDURATION:1') || text.includes('EXTINF:10.') || text.includes('EXTINF:9.');
                        const isVideoPlaylist = text.includes('TARGETDURATION:2') || text.includes('EXTINF:2.');

                        const stream = mediaStreams.find(m => m.url === resUrl);
                        if (stream && !manifestTrackMap.has(resUrl)) {
                            if (isAudioPlaylist) {
                                stream.type = 'AUDIO_TRACK';
                                stream.label = '🔊 Audio Track (Demuxed Stream)';
                                stream.isAudio = true;
                            } else if (isVideoPlaylist) {
                                stream.type = 'HLS_VARIANT';
                                stream.label = '🎬 Video Variant';
                                stream.isVideo = true;
                            }
                        }
                    }
                }).catch(() => {});
            }

            if (category === 'media' && !mediaStreams.find(m => m.url === resUrl)) {
                const knownTrack = manifestTrackMap.get(resUrl);
                let streamType, label, isMaster;

                if (knownTrack) {
                    streamType = knownTrack.type;
                    label = knownTrack.label;
                    isMaster = false;
                } else {
                    streamType = responseParser.getMediaStreamType(resUrl, contentType);
                    isMaster = streamType === 'MASTER_HLS';
                    label = isMaster ? '⭐ Master (Video + Audio)' : (streamType === 'AUDIO_TRACK' ? '🔊 Audio Track' : '🎬 Video Stream');
                }

                mediaStreams.push({
                    type: streamType,
                    label,
                    isMaster,
                    isAudio: streamType === 'AUDIO_TRACK' || (label && label.includes('Audio')) || false,
                    isBlob: false,
                    url: resUrl,
                    status,
                    headers: res.request().headers()
                });
            }
        };

        page.on('request', onRequest);
        page.on('response', onResponse);

        try {
            // Set custom headers if provided
            if (Object.keys(headers).length > 0) {
                await page.setExtraHTTPHeaders(headers);
            }

            // Navigate to page
            mainResponse = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout
            });

            // Check for Cloudflare / Verification challenge
            const challenge = await this.detectChallenge(page, mainResponse);
            if (challenge.isChallenge) {
                browserController.setStatus('CHALLENGE_REQUIRED');
                logger.challenge(`Browser verification challenge encountered (${challenge.reason}).`);
                logger.info('Presenting Chromium window to authorized user. Please complete verification in browser.');

                this.emit('challenge_required', {
                    url,
                    reason: challenge.reason,
                    timestamp: new Date().toISOString()
                });

                // Wait for the user to complete verification (watch for title or navigation change)
                const challengeResolved = await this.waitForUserVerification(page, 45000);
                if (challengeResolved) {
                    logger.success('User verification passed! Preserving session state...');
                    browserController.setStatus('NAVIGATING');
                    await sessionManager.saveSession(context);
                } else {
                    logger.warn('Verification timeout exceeded without user completion.');
                }
            }

            // Optional wait for specific selector
            if (waitForSelector) {
                try {
                    logger.info(`Waiting for selector: ${waitForSelector}`);
                    await page.waitForSelector(waitForSelector, { timeout: 10000 });
                } catch (_) {
                    logger.warn(`Selector '${waitForSelector}' was not found within timeout.`);
                }
            }

            // If auto-interact media is requested, find and click play buttons inside frames/page
            if (autoInteractMedia) {
                logger.info('Attempting to trigger media playback to intercept stream URLs...');
                await this.triggerMediaPlayback(page);

                // Wait for video player to fire streaming requests & capture master and variant manifests
                logger.info('Waiting for video player to fire streaming requests & master manifest...');
                const mediaWaitStart = Date.now();
                while (Date.now() - mediaWaitStart < 8000) {
                    const hasMaster = mediaStreams.some(m => m.isMaster || m.url.includes('master.m3u8'));
                    const hasChild = mediaStreams.some(m => m.url.includes('/hls/'));
                    if (hasMaster && hasChild && manifestTrackMap.size > 0) {
                        logger.success(`Captured Master Manifest and correlated ${manifestTrackMap.size} tracks!`);
                        await page.waitForTimeout(1000);
                        break;
                    }
                    await page.waitForTimeout(500);
                }
                // Immediately silence and pause all media players on crawled page
                await this.pauseAllMedia(page);
            } else {
                // Allow normal network requests to stabilize
                await page.waitForTimeout(2000);
            }

            // Extract structured page data
            browserController.setStatus('EXTRACTING');
            const pageData = await responseParser.extractPageData(page, mainResponse);
            const cookies = await sessionManager.getCookies(context);

            // Save session state to disk
            await sessionManager.saveSession(context);

            // Sort media streams so Master (Video + Audio) is first, followed by Audio, then Video variants
            mediaStreams.sort((a, b) => {
                if (a.isMaster && !b.isMaster) return -1;
                if (!a.isMaster && b.isMaster) return 1;
                if (a.type === 'AUDIO_TRACK' && b.type !== 'AUDIO_TRACK') return -1;
                return 0;
            });

            const durationMs = Date.now() - startTime;
            const result = {
                success: true,
                url: page.url(),
                title: pageData.title,
                status: pageData.status,
                contentType: pageData.contentType,
                durationMs,
                mediaStreams,
                interceptedCount: interceptedRequests.length,
                interceptedRequests: interceptedRequests.slice(-100), // last 100 entries
                cookiesCount: cookies.length,
                cookies,
                headers: pageData.headers,
                htmlPreview: pageData.htmlPreview,
                json: pageData.json
            };

            await this.pauseAllMedia(page);
            this.recordHistory(result);
            browserController.setStatus('IDLE');
            logger.success(`Fetch completed successfully in ${durationMs}ms. Found ${mediaStreams.length} media stream(s).`);

            return result;
        } catch (err) {
            browserController.setStatus('ERROR');
            logger.error(`Fetch operation failed: ${err.message}`);
            const errorResult = {
                success: false,
                url,
                error: err.message,
                durationMs: Date.now() - startTime,
                mediaStreams,
                interceptedRequests: interceptedRequests.slice(-50)
            };
            this.recordHistory(errorResult);
            return errorResult;
        }
    }

    /**
     * Waits for user verification by polling page state
     */
    async waitForUserVerification(page, maxWaitMs = 45000) {
        const interval = 1000;
        let elapsed = 0;

        while (elapsed < maxWaitMs) {
            await page.waitForTimeout(interval);
            elapsed += interval;

            const check = await this.detectChallenge(page, null);
            if (!check.isChallenge) {
                // Additional wait for redirection to finalize
                await page.waitForTimeout(2000);
                return true;
            }
        }
        return false;
    }

    /**
     * Programmatically clicks visible play buttons to trigger video player stream calls
     */
    async triggerMediaPlayback(page) {
        try {
            for (const frame of page.frames()) {
                try {
                    const playBtn = frame.locator('button[class*="play"], [aria-label*="play" i], video, .vjs-big-play-button, .jw-display-icon-container').first();
                    if (await playBtn.isVisible({ timeout: 1000 })) {
                        await playBtn.click({ timeout: 2000 });
                        logger.info('Clicked media play trigger inside frame.');
                        await page.waitForTimeout(2500);
                    }
                } catch (_) {}
            }
        } catch (_) {}
    }

    /**
     * Mutes and pauses all media players across all frames on the crawler page
     */
    async pauseAllMedia(page) {
        if (!page || page.isClosed()) return;
        try {
            for (const frame of page.frames()) {
                try {
                    await frame.evaluate(() => {
                        const media = document.querySelectorAll('video, audio');
                        media.forEach(el => {
                            try {
                                el.pause();
                                el.muted = true;
                                el.volume = 0;
                            } catch (_) {}
                        });
                    }).catch(() => {});
                } catch (_) {}
            }
            logger.info('Muted and paused all crawler background media playback.');
        } catch (_) {}
    }

    recordHistory(result) {
        this.fetchHistory.unshift({
            id: Date.now(),
            timestamp: new Date().toISOString(),
            url: result.url,
            success: result.success,
            status: result.status,
            mediaCount: (result.mediaStreams || []).length,
            durationMs: result.durationMs
        });
        if (this.fetchHistory.length > this.maxHistory) {
            this.fetchHistory.pop();
        }
    }

    getHistory() {
        return this.fetchHistory;
    }
}

module.exports = new FetchEngine();
