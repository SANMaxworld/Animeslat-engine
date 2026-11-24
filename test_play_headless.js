const { chromium } = require('playwright');

(async () => {
    console.log('=== TEST: Explicit Play Call ===');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    const masterUrl = 'https://ravok.buzz/cdn/hls/fe64b64c49fe23f0c9d7938e1a22ada6/master.m3u8?md5=LqwgtwMa56ry8-6g1zRoBg&expires=1795439760';
    await page.fill('#labStreamUrl', masterUrl);
    await page.click('#loadLabStreamBtn');

    await page.waitForTimeout(2000);
    // Explicitly unmute and play via user gesture simulation
    console.log('Simulating click on video element to trigger play...');
    await page.$eval('#labVideo', v => {
        v.muted = true;
        return v.play().catch(e => console.log('Play err:', e.message));
    });

    for (let i = 0; i < 5; i++) {
        await page.waitForTimeout(1000);
        const cur = await page.$eval('#labVideo', v => ({ time: v.currentTime, paused: v.paused, w: v.videoWidth, h: v.videoHeight }));
        const status = await page.$eval('#diagOverallStatus', el => el.textContent.trim());
        const vFrags = await page.$eval('#diagVideoFrags', el => el.textContent.trim());
        const aFrags = await page.$eval('#diagAudioFrags', el => el.textContent.trim());
        console.log(`[T+${i+1}s] CurrentTime: ${cur.time.toFixed(2)}s | Paused: ${cur.paused} | Status: ${status} | V: ${vFrags} | A: ${aFrags}`);
        if (cur.time > 0.5) {
            console.log('🎉 PLAYING SUCCESSFULLY CONFIRMED!');
            break;
        }
    }

    await browser.close();
})();
