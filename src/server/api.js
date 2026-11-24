/**
 * External REST & Real-Time API Server
 */
const express = require('express');
const path = require('path');
const browserController = require('../browser/controller');
const fetchEngine = require('../engine/fetcher');
const sessionManager = require('../session/manager');
const hlsParser = require('../parser/hlsParser');
const logger = require('../utils/logger');

function createServer(port = 3000) {
    const app = express();

    // Middleware
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    // CORS Headers for external clients
    app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Range');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        if (req.method === 'OPTIONS') {
            return res.sendStatus(200);
        }
        next();
    });

    // Static Web Dashboard
    app.use(express.static(path.resolve(__dirname, '../../public')));

    // SSE Clients list
    const sseClients = new Set();

    function broadcastSSE(eventType, data) {
        const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
        for (const client of sseClients) {
            try {
                client.write(payload);
            } catch (_) {
                sseClients.delete(client);
            }
        }
    }

    // Connect event listeners to SSE broadcaster
    logger.on('log', (entry) => broadcastSSE('log', entry));
    fetchEngine.on('network_request', (req) => broadcastSSE('network_request', req));
    fetchEngine.on('challenge_required', (info) => broadcastSSE('challenge_required', info));
    fetchEngine.on('manifest_correlated', (data) => broadcastSSE('manifest_correlated', data));

    // SSE Stream Endpoint
    app.get('/api/events', (req, res) => {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        res.write('retry: 3000\n\n');

        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
    });

    // System Status
    app.get('/api/status', async (req, res) => {
        try {
            const status = await browserController.getStatus();
            res.json({ success: true, data: status });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Master Playlist Analyzer
    app.post('/api/analyze-playlist', async (req, res) => {
        try {
            const { url, referer = '' } = req.body;
            if (!url) {
                return res.status(400).json({ success: false, error: 'url parameter is required' });
            }

            logger.info(`Analyzing HLS Playlist structure for: ${url.substring(0, 80)}...`);

            // Fetch manifest using fetch with proper headers
            const fetchHeaders = {
                'User-Agent': browserController.userAgent,
                'Accept': '*/*'
            };
            if (referer) {
                fetchHeaders['Referer'] = referer;
                fetchHeaders['Origin'] = new URL(referer).origin;
            }

            // Attach session cookies if available
            const cookies = await sessionManager.getCookies(browserController.context);
            if (cookies && cookies.length > 0) {
                const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                fetchHeaders['Cookie'] = cookieHeader;
            }

            let response;
            try {
                response = await fetch(url, { headers: fetchHeaders });
            } catch (netErr) {
                return res.json({
                    success: false,
                    isNetworkError: true,
                    error: netErr.message,
                    diagnosis: [{
                        category: 'NETWORK_TIMEOUT',
                        severity: 'CRITICAL',
                        title: 'Network Connection Failure',
                        detail: `Failed to reach ${url}: ${netErr.message}`,
                        resolution: 'Check network connectivity or server availability.'
                    }]
                });
            }

            const status = response.status;
            const respHeaders = {};
            response.headers.forEach((v, k) => { respHeaders[k] = v; });
            const contentType = respHeaders['content-type'] || '';

            if (status === 403) {
                const text = await response.text().catch(() => '');
                const diagnosis = diagnoseHttp403(url, fetchHeaders, status, respHeaders, text);
                logger.warn(`Playlist returned HTTP 403 Forbidden: ${url}`);
                return res.json({
                    success: false,
                    status: 403,
                    contentType,
                    headers: respHeaders,
                    bodyExcerpt: text.substring(0, 500),
                    diagnosis
                });
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                return res.json({
                    success: false,
                    status,
                    contentType,
                    headers: respHeaders,
                    bodyExcerpt: text.substring(0, 500),
                    diagnosis: [{
                        category: 'HTTP_ERROR',
                        severity: 'HIGH',
                        title: `HTTP ${status} Server Response`,
                        detail: `The playlist server responded with status code ${status}.`,
                        resolution: 'Check if the media endpoint is online.'
                    }]
                });
            }

            const manifestText = await response.text();

            if (hlsParser.isMasterPlaylist(manifestText)) {
                const parsed = hlsParser.parseMasterPlaylist(manifestText, url);
                logger.success(`Master manifest parsed: ${parsed.variantCount} variants, ${parsed.audioRenditionCount} audio tracks (${parsed.audioArchitecture}).`);
                return res.json({
                    success: true,
                    status,
                    contentType,
                    isMaster: true,
                    manifestText: manifestText.substring(0, 3000),
                    analysis: parsed
                });
            } else if (hlsParser.isMediaPlaylist(manifestText)) {
                const parsed = hlsParser.parseMediaPlaylist(manifestText, url);
                logger.info(`Media segment playlist parsed: ${parsed.segmentCount} segments.`);
                return res.json({
                    success: true,
                    status,
                    contentType,
                    isMaster: false,
                    manifestText: manifestText.substring(0, 3000),
                    analysis: parsed
                });
            } else {
                return res.json({
                    success: false,
                    status,
                    contentType,
                    isMaster: false,
                    manifestText: manifestText.substring(0, 1000),
                    diagnosis: [{
                        category: 'INVALID_PLAYLIST',
                        severity: 'HIGH',
                        title: 'Not a Valid HLS Playlist',
                        detail: 'Response does not contain #EXT-X-STREAM-INF, #EXT-X-MEDIA, or #EXTINF tags.',
                        resolution: 'Verify that the target URL is a valid .m3u8 manifest file.'
                    }]
                });
            }
        } catch (err) {
            logger.error(`Analyze playlist failure: ${err.message}`);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // HLS Stream Proxy Endpoint (Solves CORS and Injects Referer for Hls.js)
    app.get('/api/proxy-hls', async (req, res) => {
        try {
            const targetUrl = req.query.url;
            const referer = req.query.referer || '';

            if (!targetUrl) {
                return res.status(400).send('url query parameter required');
            }

            const fetchHeaders = {
                'User-Agent': browserController.userAgent,
                'Accept': '*/*'
            };
            // Note: Never forward Origin header to upstream CDNs (e.g. as-cdn*.top) as nginx returns 500 when Origin is present
            if (referer) {
                fetchHeaders['Referer'] = referer;
            }

            // Include range header if requested by player
            if (req.headers['range']) {
                fetchHeaders['Range'] = req.headers['range'];
            }

            // Attach session cookies only for provider domains (not third-party CDNs)
            const targetHost = new URL(targetUrl).hostname;
            if (targetHost.includes('ravok') || targetHost.includes('animesalt')) {
                const cookies = await sessionManager.getCookies(browserController.context);
                if (cookies && cookies.length > 0) {
                    fetchHeaders['Cookie'] = cookies.map(c => `${c.name}=${c.value}`).join('; ');
                }
            }

            const response = await fetch(targetUrl, { headers: fetchHeaders });
            const status = response.status;
            const contentType = response.headers.get('content-type') || '';

            // Forward relevant response headers
            res.status(status);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');

            if (contentType) res.setHeader('Content-Type', contentType);
            const contentLen = response.headers.get('content-length');
            if (contentLen) res.setHeader('Content-Length', contentLen);
            const contentRange = response.headers.get('content-range');
            if (contentRange) res.setHeader('Content-Range', contentRange);
            const acceptRanges = response.headers.get('accept-ranges');
            if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

            // If it's a playlist (.m3u8), rewrite relative URIs so child requests also go through proxy
            const isPlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('/hls/') || contentType.includes('mpegurl');

            if (isPlaylist && response.ok) {
                const text = await response.text();
                const host = req.get('host') || 'localhost:3000';
                const proto = req.protocol || 'http';
                const proxyBase = `${proto}://${host}`;

                // Clean up duplicate #EXTM3U and empty comments (#)
                let cleanedLines = [];
                let seenM3u = false;
                for (const rawLine of text.split(/\r?\n/)) {
                    const line = rawLine.trim();
                    if (line === '#EXTM3U') {
                        if (seenM3u) continue; // skip duplicate #EXTM3U
                        seenM3u = true;
                    }
                    if (line === '#') continue; // skip lonely comment lines
                    cleanedLines.push(rawLine);
                }

                const rewritten = cleanedLines.map(line => {
                    const trimmed = line.trim();
                    if (!trimmed || trimmed.startsWith('#')) {
                        // If it's an EXT-X-MEDIA URI attribute, rewrite URI="..."
                        if (trimmed.startsWith('#EXT-X-MEDIA:') && trimmed.includes('URI=')) {
                            return trimmed.replace(/URI="([^"]+)"/, (match, rawUri) => {
                                const resolved = hlsParser.resolveUri(targetUrl, rawUri);
                                const proxied = `${proxyBase}/api/proxy-hls?url=${encodeURIComponent(resolved)}&referer=${encodeURIComponent(referer || targetUrl)}`;
                                return `URI="${proxied}"`;
                            });
                        }
                        return line;
                    }
                    // It's a variant or segment URI! Rewrite it through proxy
                    const resolved = hlsParser.resolveUri(targetUrl, trimmed);
                    return `${proxyBase}/api/proxy-hls?url=${encodeURIComponent(resolved)}&referer=${encodeURIComponent(referer || targetUrl)}`;
                }).join('\n');

                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                return res.send(rewritten);
            }

            // Binary media segment (.ts, .m4s, or disguised .js/.css/.woff MPEG-TS segments)
            const arrayBuf = await response.arrayBuffer();
            const buf = Buffer.from(arrayBuf);

            // If payload starts with 0x47, it's a standard MPEG-TS segment regardless of filename extension (.js/.css)
            if (buf.length > 0 && buf[0] === 0x47) {
                res.setHeader('Content-Type', 'video/mp2t');
            }

            res.send(buf);
        } catch (err) {
            logger.error(`Proxy stream error: ${err.message}`);
            if (!res.headersSent) {
                res.status(502).json({ error: err.message });
            }
        }
    });

    // HTTP 403 Diagnostics Endpoint
    app.post('/api/diagnose-403', async (req, res) => {
        try {
            const { url, referer = '' } = req.body;
            if (!url) return res.status(400).json({ error: 'url parameter required' });

            const fetchHeaders = {
                'User-Agent': browserController.userAgent
            };
            if (referer) fetchHeaders['Referer'] = referer;

            const response = await fetch(url, { headers: fetchHeaders }).catch(e => ({ status: 0, headers: new Map(), text: async () => e.message }));
            const respHeaders = {};
            if (response.headers && typeof response.headers.forEach === 'function') {
                response.headers.forEach((v, k) => { respHeaders[k] = v; });
            }
            const body = await response.text().catch(() => '');

            const diagnosis = diagnoseHttp403(url, fetchHeaders, response.status, respHeaders, body);
            res.json({
                status: response.status,
                url,
                headers: respHeaders,
                diagnosis
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Helper: Diagnoses why an HTTP 403 Forbidden happened
    function diagnoseHttp403(targetUrl, requestHeaders, status, responseHeaders, responseBody = '') {
        const issues = [];
        let urlObj;
        try { urlObj = new URL(targetUrl); } catch (_) { urlObj = { hostname: 'unknown', searchParams: new URLSearchParams() }; }

        // 1. Expiration check in query parameters
        const expParam = urlObj.searchParams.get('e') || urlObj.searchParams.get('expires') || urlObj.searchParams.get('expire');
        if (expParam) {
            const expNum = parseInt(expParam, 10);
            const expMs = expNum < 1e11 ? expNum * 1000 : expNum;
            const nowMs = Date.now();
            if (nowMs > expMs) {
                const diffSec = Math.round((nowMs - expMs) / 1000);
                issues.push({
                    category: 'EXPIRED_SIGNED_URL',
                    severity: 'CRITICAL',
                    title: 'Signed Security Token Has Expired',
                    detail: `The URL contains timestamp 'e=${expParam}' which expired ${diffSec} seconds ago (${new Date(expMs).toISOString()}).`,
                    resolution: 'Re-trigger fetch from the provider page to obtain a newly signed URL.'
                });
            }
        }

        // 2. Referer / Origin Check
        if (!requestHeaders['Referer'] && !requestHeaders['referer']) {
            issues.push({
                category: 'MISSING_REFERER',
                severity: 'HIGH',
                title: 'Missing Referer / Origin Header',
                detail: `The media server (${urlObj.hostname}) rejected the request because the HTTP Referer header was omitted. Many CDNs enforce Hotlink Protection.`,
                resolution: 'Use the backend HLS Proxy (/api/proxy-hls) which preserves the authorized provider Referer.'
            });
        }

        // 3. CORS Policy Check
        const acao = responseHeaders['access-control-allow-origin'];
        if (!acao) {
            issues.push({
                category: 'CORS_RESTRICTIONS',
                severity: 'HIGH',
                title: 'CORS Policy Enforcement (No Access-Control-Allow-Origin)',
                detail: `The server did not send an Access-Control-Allow-Origin header. Browsers executing Hls.js directly will block reading manifest bytes.`,
                resolution: 'Test through the HLS Playback Lab with Proxy mode enabled to bypass local browser CORS isolation.'
            });
        }

        // 4. Cloudflare / WAF Edge Check
        if (responseHeaders['cf-ray'] || (responseHeaders['server'] && responseHeaders['server'].toLowerCase().includes('cloudflare'))) {
            issues.push({
                category: 'CLOUDFLARE_EDGE_BLOCK',
                severity: 'MEDIUM',
                title: 'Cloudflare / Edge Firewall Filter',
                detail: `Request was filtered by Cloudflare (Ray ID: ${responseHeaders['cf-ray'] || 'N/A'}).`,
                resolution: 'Ensure the Chromium session cookies are preserved and valid.'
            });
        }

        if (issues.length === 0) {
            issues.push({
                category: 'SERVER_ACCESS_DENIED',
                severity: 'HIGH',
                title: 'Server-Side Access Denial',
                detail: `HTTP 403 Forbidden. The provider's CDN token or IP session binding rejected this request.`,
                resolution: 'Re-open the provider page in Chromium to generate an authorized session token.'
            });
        }

        return issues;
    }

    // Trigger Fetch Request
    app.post('/api/fetch', async (req, res) => {
        try {
            const {
                url,
                method = 'GET',
                headers = {},
                extractMedia = true,
                waitForSelector = null,
                timeout = 30000,
                headed = true,
                autoInteractMedia = false
            } = req.body;

            if (!url) {
                return res.status(400).json({ success: false, error: 'url parameter is required.' });
            }

            const result = await fetchEngine.executeFetch({
                url,
                method,
                headers,
                extractMedia,
                waitForSelector,
                timeout,
                headed,
                autoInteractMedia
            });

            broadcastSSE('fetch_completed', result);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Fetch History
    app.get('/api/history', (req, res) => {
        res.json({ success: true, history: fetchEngine.getHistory() });
    });

    // System Logs
    app.get('/api/logs', (req, res) => {
        res.json({ success: true, logs: logger.getHistory() });
    });

    // Clear Session
    app.post('/api/session/clear', async (req, res) => {
        try {
            const result = sessionManager.clearSession();
            if (browserController.context) {
                await browserController.context.clearCookies();
            }
            logger.info('Session state reset via API request.');
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Initialize or reconfigure Chromium
    app.post('/api/browser/init', async (req, res) => {
        try {
            const { headed = true } = req.body;
            await browserController.init(headed);
            res.json({ success: true, status: await browserController.getStatus() });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // Close Chromium
    app.post('/api/browser/close', async (req, res) => {
        try {
            await browserController.close();
            res.json({ success: true, message: 'Browser closed.' });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    const server = app.listen(port, () => {
        logger.info(`External Fetch & Management Server listening on http://localhost:${port}`);
    });

    return { app, server };
}

module.exports = { createServer };
