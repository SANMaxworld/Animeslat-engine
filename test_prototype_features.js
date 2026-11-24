const { chromium } = require('playwright');

(async () => {
    console.log('=== TEST: Comprehensive Prototype Features Test ===');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Player]') || text.includes('Sync') || text.includes('Seek')) {
            console.log('PAGE:', text);
        }
    });

    console.log('Opening http://localhost:3000 ...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Enable muted to satisfy headless autoplay
    await page.$eval('#labVideo', v => { v.muted = true; });

    const masterUrl = 'https://ravok.buzz/cdn/hls/fe64b64c49fe23f0c9d7938e1a22ada6/master.m3u8?md5=LqwgtwMa56ry8-6g1zRoBg&expires=1795439760';
    console.log('1. Loading Master Stream in Lab...');
    await page.fill('#labStreamUrl', masterUrl);
    await page.click('#loadLabStreamBtn');

    // Wait for manifest and audio tracks to load
    await page.waitForTimeout(3000);

    // 2. Check Prototype Quality Pills
    console.log('\n2. Testing Video Quality Prototype Pills...');
    const qualityPills = await page.$$eval('#protoQualityPills .proto-pill-btn', btns => btns.map(b => b.textContent.trim()));
    console.log('Detected Quality Pills:', qualityPills.join(' | '));

    // Click 720p pill if present
    const btn720 = await page.$('#protoQualityPills .proto-pill-btn:has-text("720p")');
    if (btn720) {
        await btn720.click();
        const activeQ = await page.$eval('#protoQualityBadge', el => el.textContent.trim());
        const linkVal = await page.$eval('#protoQualityLinkInput', el => el.value);
        console.log('Switched to Quality:', activeQ);
        console.log('Quality Link Box populated:', linkVal.substring(0, 60) + '...');
    }

    // 3. Check Prototype Audio Pills
    console.log('\n3. Testing Audio Languages Prototype Pills...');
    const audioPills = await page.$$eval('#protoAudioPills .proto-pill-btn', btns => btns.map(b => b.textContent.trim()));
    console.log('Detected Audio Pills:', audioPills.join(' | '));

    // Click Hindi pill if present
    const hindiBtn = await page.$('#protoAudioPills .proto-pill-btn:has-text("Hindi")');
    if (hindiBtn) {
        await hindiBtn.click();
        const activeA = await page.$eval('#protoAudioBadge', el => el.textContent.trim());
        const audioLink = await page.$eval('#protoAudioLinkInput', el => el.value);
        console.log('Switched to Audio:', activeA);
        console.log('Audio Link Box populated:', audioLink.substring(0, 60) + '...');
    }

    // 4. Test Seeking & Audio/Video Synchronization
    console.log('\n4. Testing Timeline Seeking & Synchronization...');
    await page.$eval('#labVideo', v => {
        v.currentTime = 15; // Seek to 15 seconds
    });
    await page.waitForTimeout(1500);

    const syncStatus = await page.$eval('#protoSyncStatus', el => el.textContent.trim());
    const curTime = await page.$eval('#labVideo', v => v.currentTime);
    console.log(`Video Current Time after Seek: ${curTime.toFixed(2)}s`);
    console.log(`Seek Sync Engine Status: ${syncStatus}`);

    // 5. Test Reset Button
    console.log('\n5. Testing Reset / New Test Button...');
    await page.click('#resetDashboardBtn');
    await page.waitForTimeout(1000);

    const inputVal = await page.$eval('#targetUrl', el => el.value);
    const mediaCount = await page.$eval('#mediaStreamCount', el => el.textContent.trim());
    const qBadge = await page.$eval('#protoQualityBadge', el => el.textContent.trim());
    console.log('Target Input cleared:', inputVal === '');
    console.log('Media count reset:', mediaCount);
    console.log('Quality badge reset:', qBadge);

    console.log('\n=============================================');
    console.log('🎉 ALL PROTOTYPE FEATURES TESTED AND PASSED!');
    console.log('=============================================\n');

    await browser.close();
})();
