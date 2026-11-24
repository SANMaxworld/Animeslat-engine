const { chromium } = require('playwright');
const path = require('path');

(async () => {
    console.log('Testing fetch_tester.html artifact...');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });

    const artifactPath = 'file:///C:/Users/LeNoVo/.gemini/antigravity/brain/1a218994-31bf-4e8e-99c7-c13e0037c93b/fetch_tester.html';
    await page.goto(artifactPath, { waitUntil: 'networkidle' });

    console.log('Artifact loaded successfully.');
    const syncStatus = await page.$eval('#protoSyncStatus', el => el.textContent.trim());
    console.log('Sync status in artifact:', syncStatus);

    if (errors.length > 0) {
        console.error('Errors encountered in artifact:', errors);
        throw new Error('Artifact had errors: ' + errors.join('; '));
    }

    console.log('✓ Artifact fetch_tester.html passed with zero errors!');
    await browser.close();
})();
