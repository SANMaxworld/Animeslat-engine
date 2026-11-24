const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    console.log('=== LIVE TEST: Investigating AnimeSalt Stream Extraction ===\n');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    const mediaRequests = [];

    page.on('request', req => {
        const url = req.url();
        const type = req.resourceType();
        if (url.includes('.m3u8') || url.includes('/hls/') || url.includes('blob:') || type === 'media' || url.includes('ravok') || url.includes('player')) {
            mediaRequests.push({
                type: 'REQUEST',
                method: req.method(),
                resourceType: type,
                url: url,
                headers: req.headers()
            });
            console.log(`[REQ] [${type}] ${req.method()} -> ${url}`);
        }
    });

    page.on('response', async res => {
        const url = res.url();
        const ct = res.headers()['content-type'] || '';
        if (url.includes('.m3u8') || url.includes('/hls/') || ct.includes('mpegurl') || ct.includes('video') || ct.includes('audio')) {
            console.log(`[RES] Status: ${res.status()} | Content-Type: ${ct} | URL: ${url}`);
            
            // Try to read first 500 chars of playlist if it's text
            if (url.includes('.m3u8') || ct.includes('mpegurl') || url.includes('/hls/')) {
                try {
                    const text = await res.text();
                    console.log(`\n--- CONTENT OF ${url} ---\n${text.substring(0, 500)}\n-------------------------\n`);
                } catch (e) {
                    console.log(`[RES BODY ERROR] Could not read body: ${e.message}`);
                }
            }
        }
    });

    console.log('Navigating to: https://animesalt.cx/episode/solo-leveling-1x1/');
    try {
        await page.goto('https://animesalt.cx/episode/solo-leveling-1x1/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        console.log('Page loaded. Current URL:', page.url());
        console.log('Page title:', await page.title());

        console.log('\nScanning frames and clicking play buttons...');
        for (const frame of page.frames()) {
            try {
                console.log(`Frame URL: ${frame.url()}`);
                const btn = frame.locator('button, video, [class*="play"], [id*="play"], .vjs-big-play-button').first();
                if (await btn.isVisible({ timeout: 1500 })) {
                    console.log(`Clicking button in frame: ${frame.url()}`);
                    await btn.click({ timeout: 2000 });
                }
            } catch (err) {
                // frame click timeout
            }
        }

        console.log('Waiting 10 seconds for playback and network traffic...');
        await page.waitForTimeout(10000);

    } catch (err) {
        console.error('Navigation error:', err.message);
    } finally {
        await browser.close();
        console.log('\n=== Live Test Complete. Total intercepted media items:', mediaRequests.length);
    }
})();
