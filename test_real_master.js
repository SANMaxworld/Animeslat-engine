const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    const target = 'https://ravok.buzz/cdn/hls/fe64b64c49fe23f0c9d7938e1a22ada6/master.m3u8?md5=LqwgtwMa56ry8-6g1zRoBg&expires=1795439760';
    const proxyUrl = 'http://localhost:3000/api/proxy-hls?url=' + encodeURIComponent(target) + '&referer=' + encodeURIComponent('https://ravok.buzz/video/ec4de54f2f3afa14175e5eabfc16ce1f');
    console.log('Fetching:', proxyUrl);
    
    try {
        const res = await fetch(proxyUrl);
        console.log('Status:', res.status);
        console.log('Content-Type:', res.headers.get('content-type'));
        const text = await res.text();
        console.log('Length:', text.length);
        console.log('Preview:\n', text.substring(0, 1000));
    } catch (e) {
        console.error('Error:', e.message);
    }
})();
