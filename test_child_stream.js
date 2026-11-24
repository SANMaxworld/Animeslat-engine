const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    // 1. Fetch child audio playlist
    const audioUrl = 'https://ravok.buzz/hls/eGZuamw1bnREdHplV21rTTJjcitJNEFFRWtnaDVIcnZUb1ByR0hJRGZwWktHVEllc3cxNHdGRjdaY2hBMDBRY0djTHpVL0dmVXVDUVdvRCtFcFB5em92cGxsL0cvVHR5WC8yL3RuM0tqYkRKSzBrYjVKR01URzkyK1JtcjJVSVVSdHhCSndVVzNPNWZzSGgrQ01GQ3c0Nm9GcTIvd2d3WVlOSHMzTk53dHZUMGNVb1BacHd4T1dCTlVpeVJmME9vdVIyRFpWVWZRUlpKYTdDcEZKOGdjSSthc0F2TjF3MTdjNzZNWXdSZnlmTWVkaFBJYzVHdFdDK1pVRlhPYVY5YVlwQnRwUjlMR2R0UlE2dFg3TXM5YTg1a3p6UEF2d0pDQUtTSEhwYnAwdUk9';
    const proxyAudio = 'http://localhost:3000/api/proxy-hls?url=' + encodeURIComponent(audioUrl) + '&referer=' + encodeURIComponent('https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f');
    
    console.log('--- Testing Proxied Audio Playlist ---');
    const aRes = await fetch(proxyAudio);
    console.log('Audio Status:', aRes.status);
    console.log('Audio Content-Type:', aRes.headers.get('content-type'));
    const aText = await aRes.text();
    console.log('Audio Length:', aText.length);
    console.log('Audio Preview:\n', aText.substring(0, 500));

    // 2. Fetch one segment from the audio playlist
    const firstSegmentLine = aText.split('\n').find(l => l.startsWith('/api/proxy-hls'));
    if (firstSegmentLine) {
        console.log('\n--- Testing Proxied Audio Segment ---');
        console.log('Segment URL:', firstSegmentLine.trim());
        const segRes = await fetch('http://localhost:3000' + firstSegmentLine.trim());
        console.log('Seg Status:', segRes.status);
        console.log('Seg Content-Type:', segRes.headers.get('content-type'));
        const buf = await segRes.arrayBuffer();
        console.log('Seg Byte Length:', buf.byteLength);
        const u8 = new Uint8Array(buf);
        console.log('First 4 bytes:', Array.from(u8.slice(0, 4)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' '));
    }
})();
