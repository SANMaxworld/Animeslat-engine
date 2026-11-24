const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    console.log('=== E2E TEST: Triggering /api/fetch on AnimeSalt ===');
    const res = await fetch('http://localhost:3000/api/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: 'https://animesalt.cx/episode/solo-leveling-1x1/',
            headed: true,
            autoInteractMedia: true,
            timeout: 35000
        })
    });

    const data = await res.json();
    console.log('Fetch Success:', data.success);
    console.log('Total Intercepted Media Streams:', (data.mediaStreams || []).length);
    console.log('\n--- Captured Media Items & Classified Tags ---');
    (data.mediaStreams || []).forEach((m, idx) => {
        console.log(`[#${idx + 1}] Type: ${m.type.padEnd(16)} | Tag: ${m.label.padEnd(35)} | URL: ${m.url.substring(0, 75)}...`);
    });
})();
