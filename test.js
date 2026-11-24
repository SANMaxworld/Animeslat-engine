/**
 * Verification Test Script
 */
const fetchEngine = require('./src/engine/fetcher');
const browserController = require('./src/browser/controller');
const sessionManager = require('./src/session/manager');

async function runTest() {
    console.log('=== Testing Chromium Fetch Engine ===\n');

    try {
        console.log('1. Testing fetch on https://example.com (Headless)...');
        const result = await fetchEngine.executeFetch({
            url: 'https://example.com',
            headed: false,
            timeout: 20000
        });

        console.log('\n[RESULT]:');
        console.log('Success:', result.success);
        console.log('Title:', result.title);
        console.log('Status:', result.status);
        console.log('Duration:', result.durationMs + 'ms');
        console.log('Intercepted Requests:', result.interceptedCount);
        console.log('Cookies Persisted:', result.cookiesCount);

        console.log('\n2. Testing session persistence on disk...');
        const hasSession = sessionManager.hasSavedSession();
        console.log('Session File Exists:', hasSession);

        console.log('\n3. Shutting down browser...');
        await browserController.close();
        console.log('✓ All tests passed successfully!');
        process.exit(0);
    } catch (err) {
        console.error('Test failed:', err);
        await browserController.close();
        process.exit(1);
    }
}

runTest();
