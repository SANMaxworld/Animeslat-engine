const { chromium } = require('playwright');

(async () => {
    console.log('=== TEST: No Background Autoplay Upon Stream Interception ===');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });
    console.log('1. Dashboard loaded at http://localhost:3000');

    // Check initial video state
    const initialPaused = await page.$eval('#labVideo', v => v.paused);
    console.log('2. Initial labVideo.paused:', initialPaused);

    // Click "Intercept Stream" for Solo Leveling
    console.log('3. Triggering Intercept Stream via UI...');
    await page.fill('#targetUrl', 'https://animesalt.cx/episode/solo-leveling-1x1/');
    await page.click('#fetchBtn');

    // Wait 15 seconds for crawler to intercept streams
    console.log('4. Waiting for stream capture...');
    await page.waitForTimeout(15000);

    // Check media stream count
    const streamCount = await page.$eval('#mediaStreamCount', el => el.textContent.trim());
    console.log('5. Media streams captured:', streamCount);

    // Verify labVideo in the dashboard is NOT playing automatically
    const isPausedAfterIntercept = await page.$eval('#labVideo', v => v.paused);
    const currentTime = await page.$eval('#labVideo', v => v.currentTime);
    console.log(`6. Lab Video State: paused = ${isPausedAfterIntercept}, currentTime = ${currentTime}`);

    if (!isPausedAfterIntercept && currentTime > 0) {
        throw new Error('FAILED: Video autoplays automatically in the background after intercept!');
    }

    console.log('✓ SUCCESS: No background playback upon interception! Player remains cleanly paused & silent.');

    await browser.close();
    process.exit(0);
})().catch(err => {
    console.error('❌ TEST FAILED:', err);
    process.exit(1);
});
