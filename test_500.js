const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    const url = 'http://localhost:3000/api/proxy-hls?url=https%3A%2F%2Fas-cdn27.top%2Fp%2FjJ7iW-8Ts9CVS1RxAYmL_o6h7ojsB4ECM-Dpp7GXIx_eG0x2PDUTqDrx-nBufT6tIBCmktJPz2PA9zVyGEB6Z8N61-4tsUaKXhjS58gfxw8.js&referer=https%3A%2F%2Fanimesalt.cx%2F';
    const res = await fetch(url);
    console.log('Status:', res.status);
    console.log('Headers:', [...res.headers.entries()]);
    const text = await res.text();
    console.log('Body:', text.substring(0, 300));
})();
