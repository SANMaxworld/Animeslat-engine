const { chromium } = require('playwright');

(async () => {
    console.log('=== TEST: Debugging fragLoadError ===');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('requestfailed', req => {
        console.log('[REQ FAILED]', req.url(), req.failure() ? req.failure().errorText : 'unknown');
    });

    page.on('response', res => {
        if (res.status() >= 400) {
            console.log(`[HTTP ${res.status()}]`, res.url());
        }
    });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    const masterUrl = 'https://ravok.buzz/cdn/hls/fe64b64c49fe23f0c9d7938e1a22ada6/master.m3u8?md5=LqwgtwMa56ry8-6g1zRoBg&expires=1795439760';
    await page.fill('#labStreamUrl', masterUrl);
    await page.click('#loadLabStreamBtn');

    await page.waitForTimeout(5000);
    await browser.close();
})();
