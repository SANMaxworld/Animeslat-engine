const fetch = globalThis.fetch || require('node-fetch');

(async () => {
    const cdnUrl = 'https://as-cdn27.top/p/jJ7iW-8Ts9CVS1RxAYmL_o6h7ojsB4ECM-Dpp7GXIx_eG0x2PDUTqDrx-nBufT6tIBCmktJPz2PA9zVyGEB6Z8N61-4tsUaKXhjS58gfxw8.js';
    
    console.log('Without Origin, with Referer:');
    const r1 = await fetch(cdnUrl, { headers: { 'Referer': 'https://animesalt.cx/' } });
    console.log('r1 status:', r1.status);
    const buf = await r1.arrayBuffer();
    console.log('r1 byteLength:', buf.byteLength);
    const u8 = new Uint8Array(buf);
    console.log('r1 sync byte:', '0x' + u8[0].toString(16));
})();
