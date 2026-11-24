const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    page.on('request', req => {
        if (req.url().includes('as-cdn')) {
            console.log('CDN REQ URL:', req.url().substring(0, 80));
            console.log('CDN REQ HEADERS:', JSON.stringify(req.headers(), null, 2));
        }
    });

    console.log('Navigating to ravok...');
    await page.goto('https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    await browser.close();
})();
