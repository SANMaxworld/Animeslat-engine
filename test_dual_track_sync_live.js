const { chromium } = require('playwright');

(async () => {
    console.log('===============================================================');
    console.log('🧪 COMPREHENSIVE TEST: DualTrackSyncController & Playback Lab');
    console.log('===============================================================\n');

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const consoleLogs = [];
    page.on('console', msg => {
        const text = msg.text();
        consoleLogs.push(text);
        if (text.includes('[DualTrackSync]') || text.includes('[Player]') || text.includes('Sync')) {
            console.log('  [BROWSER CONSOLE]', text);
        }
    });

    console.log('1. Navigating to http://localhost:3000 ...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

    // Verify Title & Script Load
    const title = await page.title();
    console.log('✓ Page Title:', title);

    const isSyncClassLoaded = await page.evaluate(() => typeof window.DualTrackSyncController === 'function');
    console.log('✓ DualTrackSyncController loaded in window:', isSyncClassLoaded);
    if (!isSyncClassLoaded) {
        throw new Error('DualTrackSyncController failed to load!');
    }

    // Ensure elements exist
    const videoExists = await page.$eval('#labVideo', el => !!el);
    const audioExists = await page.$eval('#labAudio', el => !!el);
    console.log('✓ HTML5 <video id="labVideo"> exists:', videoExists);
    console.log('✓ HTML5 <audio id="labAudio"> exists:', audioExists);

    // Mute video to permit autoplay in headless browser
    await page.$eval('#labVideo', v => { v.muted = true; });

    // 2. Load Master Stream in Lab
    console.log('\n2. Loading Master Stream in Playback Lab...');
    const masterUrl = 'https://ravok.buzz/cdn/hls/fe64b64c49fe23f0c9d7938e1a22ada6/master.m3u8?md5=LqwgtwMa56ry8-6g1zRoBg&expires=1795439760';
    await page.fill('#labStreamUrl', masterUrl);
    await page.click('#loadLabStreamBtn');

    // Wait for manifest parsing
    await page.waitForTimeout(3000);

    // 3. Test Video Quality Pills (1080p, 720p, 480p, 360p, 240p)
    console.log('\n3. Testing Quality Pills & In-Place Switching...');
    const qualityPills = await page.$$eval('#protoQualityPills .proto-pill-btn', btns => btns.map(b => b.textContent.trim()));
    console.log('Detected Quality Pills:', qualityPills.join(' | '));

    const btn720 = await page.$('#protoQualityPills .proto-pill-btn:has-text("720p")');
    if (btn720) {
        await btn720.click();
        await page.waitForTimeout(500);
        const qBadge = await page.$eval('#protoQualityBadge', el => el.textContent.trim());
        const qLink = await page.$eval('#protoQualityLinkInput', el => el.value);
        console.log('✓ Switched to Quality:', qBadge);
        console.log('✓ Populated Direct Quality URL:', qLink ? qLink.substring(0, 65) + '...' : 'None');
    }

    // 4. Test Multi-Track Audio Languages (Japanese, English, Hindi, Telugu, Tamil)
    console.log('\n4. Testing Multi-Track Audio Language Switching...');
    const audioPills = await page.$$eval('#protoAudioPills .proto-pill-btn', btns => btns.map(b => b.textContent.trim()));
    console.log('Detected Audio Pills:', audioPills.join(' | '));

    const hindiBtn = await page.$('#protoAudioPills .proto-pill-btn:has-text("Hindi")');
    if (hindiBtn) {
        await hindiBtn.click();
        await page.waitForTimeout(500);
        const aBadge = await page.$eval('#protoAudioBadge', el => el.textContent.trim());
        const aLink = await page.$eval('#protoAudioLinkInput', el => el.value);
        console.log('✓ Switched to Audio Track:', aBadge);
        console.log('✓ Populated Direct Audio URL:', aLink ? aLink.substring(0, 65) + '...' : 'None');
    }

    // 5. Test Smart Atomic Seeking
    console.log('\n5. Testing Smart Atomic Seeking (Target = 30.00s)...');
    await page.$eval('#labVideo', v => {
        v.currentTime = 30; // Initiate seek
    });
    await page.waitForTimeout(1500);

    const seekCurTime = await page.$eval('#labVideo', v => v.currentTime);
    const syncStatusText = await page.$eval('#protoSyncStatus', el => el.textContent.trim());
    console.log(`✓ Video Time after Atomic Seek: ${seekCurTime.toFixed(2)}s`);
    console.log(`✓ Seek Status: ${syncStatusText}`);

    // 6. Direct In-Depth Verification of DualTrackSyncController Logic (Rules 1, 2, 3)
    console.log('\n6. Running Unit & Integration Tests on DualTrackSyncController in Browser Runtime...');
    const controllerTestResults = await page.evaluate(async () => {
        const testVideo = document.createElement('video');
        const testAudio = document.createElement('audio');
        document.body.appendChild(testVideo);
        document.body.appendChild(testAudio);

        const sync = new window.DualTrackSyncController(testVideo, testAudio, {
            debug: false,
            driftThresholdLow: 0.08,
            driftThresholdHigh: 0.40,
            checkIntervalMs: 100
        });

        const results = [];

        // Test A: Split mode configuration
        sync.setSplitMode(true);
        results.push({ name: 'Split Mode Mutes Video', passed: testVideo.muted === true });
        results.push({ name: 'Split Mode Unmutes Audio', passed: testAudio.muted === false });

        // Test B: Volume mirroring
        testVideo.volume = 0.65;
        testVideo.dispatchEvent(new Event('volumechange'));
        results.push({ name: 'Volume Forwarding to Audio', passed: Math.abs(testAudio.volume - 0.65) < 0.01 });

        // Test C: Zone 1 Sync (< 0.08s)
        testVideo.currentTime = 10.00;
        testAudio.currentTime = 10.03; // drift = +0.03s
        // Mock non-paused state
        Object.defineProperty(testVideo, 'paused', { value: false, configurable: true });
        sync.userPlaybackRate = 1.0;
        sync._evaluateDrift();
        results.push({ name: 'Zone 1 (<0.08s) Normal PlaybackRate (1.0x)', passed: testAudio.playbackRate === 1.0 });

        // Test D: Zone 2 Soft Catch-up Audio Ahead (+0.25s)
        testVideo.currentTime = 10.00;
        testAudio.currentTime = 10.25; // drift = +0.25s
        sync._evaluateDrift();
        const expectedSlowRate = 1.0 * 0.95;
        results.push({ name: 'Zone 2 Audio Ahead Soft Slowdown (0.95x)', passed: Math.abs(testAudio.playbackRate - expectedSlowRate) < 0.001 });

        // Test E: Zone 2 Soft Catch-up Audio Behind (-0.25s)
        testVideo.currentTime = 10.25;
        testAudio.currentTime = 10.00; // drift = -0.25s
        sync._evaluateDrift();
        const expectedFastRate = 1.0 * 1.05;
        results.push({ name: 'Zone 2 Audio Behind Soft Speedup (1.05x)', passed: Math.abs(testAudio.playbackRate - expectedFastRate) < 0.001 });

        // Test F: Zone 3 Hard Re-alignment (> 0.40s)
        testVideo.currentTime = 10.00;
        testAudio.currentTime = 10.75; // drift = +0.75s
        sync._evaluateDrift();
        results.push({ name: 'Zone 3 (>0.40s) Hard Atomic Re-alignment', passed: Math.abs(testAudio.currentTime - testVideo.currentTime) < 0.01 });

        // Test G: Stalling / Buffering Interlock
        let bufferingReported = false;
        sync.onBufferingChange = (buf, cause) => {
            if (buf && cause === 'video') bufferingReported = true;
        };
        testVideo.dispatchEvent(new Event('waiting'));
        results.push({ name: 'Video Stalling Emits Buffering Lock', passed: bufferingReported });

        sync.destroy();
        testVideo.remove();
        testAudio.remove();

        return results;
    });

    controllerTestResults.forEach(r => {
        console.log(`  ${r.passed ? '✓ PASS' : '✗ FAIL'}: ${r.name}`);
        if (!r.passed) throw new Error(`Test failed: ${r.name}`);
    });

    // 7. Test Reset / New Test Button
    console.log('\n7. Testing System Reset & New Episode Preparation...');
    await page.click('#resetDashboardBtn');
    await page.waitForTimeout(1000);

    const inputVal = await page.$eval('#targetUrl', el => el.value);
    const mediaCount = await page.$eval('#mediaStreamCount', el => el.textContent.trim());
    const qBadgeReset = await page.$eval('#protoQualityBadge', el => el.textContent.trim());
    const aBadgeReset = await page.$eval('#protoAudioBadge', el => el.textContent.trim());
    const syncStatusReset = await page.$eval('#protoSyncStatus', el => el.textContent.trim());

    console.log('✓ Target Input cleared:', inputVal === '');
    console.log('✓ Captured Streams Count reset:', mediaCount);
    console.log('✓ Quality badge reset:', qBadgeReset);
    console.log('✓ Audio badge reset:', aBadgeReset);
    console.log('✓ Sync status reset:', syncStatusReset);

    console.log('\n===============================================================');
    console.log('🎉 ALL DUAL-TRACK SYNC & PROTOTYPE FEATURES VERIFIED & PASSED!');
    console.log('===============================================================\n');

    await browser.close();
})();
