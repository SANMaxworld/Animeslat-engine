const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    // 1. Fetch child video playlist
    const videoUrl = 'https://ravok.buzz/hls/eGZuamw1bnREdHplV21rTTJjcitJNEFFRWtnaDVIcnZUb1ByR0hJRGZwWktHVEllc3cxNHdGRjdaY2hBMDBRY1FuVkU0K00wK0ZSWDdvWWpzKzVpUTNjNTZqS3RBNCszaGhlc3BjWUdZaGYwc3ZMQ0lNWUpxd3J6VEQxem1pOEVnOUF6Tzh4aVl3OUJKRTUrRlY0bVVGdXhhSSsyK1ROeWRqM3pRbkhCUVdLYzNEUWRMZ3VzV1d1a2dpZWpYTjZGSEFBWG5DK2hBSFduUllxMVhzbFd0NFdHdE1wYWZyQVdYTHFZZmdpbWVJMncvVzlGVEpFRUd1QjJTOVBzQUtFVDNHZWlOdmw5S3lGTnVZUkZNYlpyZzJvdXh1YkZtUnp4dlBNUjFpOEtQZnc9';
    const proxyVideo = 'http://localhost:3000/api/proxy-hls?url=' + encodeURIComponent(videoUrl) + '&referer=' + encodeURIComponent('https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f');
    
    console.log('--- Testing Proxied Video Playlist ---');
    const vRes = await fetch(proxyVideo);
    console.log('Video Status:', vRes.status);
    console.log('Video Content-Type:', vRes.headers.get('content-type'));
    const vText = await vRes.text();
    console.log('Video Length:', vText.length);
    console.log('Video Preview:\n', vText.substring(0, 500));

    // 2. Fetch one segment from the video playlist
    const firstSegmentLine = vText.split('\n').find(l => l.startsWith('/api/proxy-hls'));
    if (firstSegmentLine) {
        console.log('\n--- Testing Proxied Video Segment ---');
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
