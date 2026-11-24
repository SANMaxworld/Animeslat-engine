/**
 * HLS Manifest Analyzer (RFC 8216 Compliant)
 * Accurately parses Master and Media Playlists, distinguishing audio/video architectures.
 */

class HlsParser {
    /**
     * Determines if manifest content is a Master Playlist
     */
    static isMasterPlaylist(content) {
        if (!content || typeof content !== 'string') return false;
        return content.includes('#EXT-X-STREAM-INF') || 
              (content.includes('#EXT-X-MEDIA') && (content.includes('TYPE=AUDIO') || content.includes('TYPE=VIDEO')));
    }

    /**
     * Determines if manifest content is a Media / Variant Playlist (segment list)
     */
    static isMediaPlaylist(content) {
        if (!content || typeof content !== 'string') return false;
        return content.includes('#EXTINF') || content.includes('#EXT-X-TARGETDURATION');
    }

    /**
     * Resolves relative URI against base URL
     */
    static resolveUri(base, relative) {
        if (!relative) return null;
        if (relative.startsWith('http://') || relative.startsWith('https://')) {
            return relative;
        }
        try {
            return new URL(relative, base).href;
        } catch (_) {
            return relative;
        }
    }

    /**
     * Parses attributes from an HLS tag string (e.g. #EXT-X-STREAM-INF:ATTR=VAL,ATTR="VAL")
     */
    static parseAttributes(tagLine) {
        const colonIndex = tagLine.indexOf(':');
        if (colonIndex === -1) return {};
        const attrString = tagLine.substring(colonIndex + 1);
        const attrs = {};

        // Regex handles both quoted strings and unquoted keys
        const regex = /([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi;
        let match;
        while ((match = regex.exec(attrString)) !== null) {
            const key = match[1].toUpperCase();
            const val = match[2] !== undefined ? match[2] : match[3];
            attrs[key] = val;
        }
        return attrs;
    }

    /**
     * Parses a Master Playlist content string
     */
    static parseMasterPlaylist(content, baseUrl = '') {
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const variants = [];
        const audioRenditions = [];
        const subtitles = [];

        let currentStreamInf = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            if (line.startsWith('#EXT-X-MEDIA:')) {
                const attrs = this.parseAttributes(line);
                const type = (attrs.TYPE || '').toUpperCase();

                if (type === 'AUDIO') {
                    audioRenditions.push({
                        groupId: attrs['GROUP-ID'] || 'default',
                        name: attrs.NAME || 'Audio Track',
                        language: attrs.LANGUAGE || 'und',
                        isDefault: attrs.DEFAULT === 'YES',
                        autoSelect: attrs.AUTOSELECT === 'YES',
                        channels: attrs.CHANNELS || null,
                        rawUri: attrs.URI || null,
                        uri: attrs.URI ? this.resolveUri(baseUrl, attrs.URI) : null
                    });
                } else if (type === 'SUBTITLES') {
                    subtitles.push({
                        groupId: attrs['GROUP-ID'] || 'default',
                        name: attrs.NAME || 'Subtitles',
                        language: attrs.LANGUAGE || 'und',
                        isDefault: attrs.DEFAULT === 'YES',
                        autoSelect: attrs.AUTOSELECT === 'YES',
                        rawUri: attrs.URI || null,
                        uri: attrs.URI ? this.resolveUri(baseUrl, attrs.URI) : null
                    });
                }
            } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
                currentStreamInf = this.parseAttributes(line);
            } else if (!line.startsWith('#') && currentStreamInf) {
                // Next non-comment line is the URI for the variant
                const rawUri = line;
                const fullUri = this.resolveUri(baseUrl, rawUri);

                const resMatch = (currentStreamInf.RESOLUTION || '').match(/(\d+)x(\d+)/);
                const resolution = resMatch ? { width: parseInt(resMatch[1], 10), height: parseInt(resMatch[2], 10) } : null;

                const codecs = currentStreamInf.CODECS || '';
                const hasVideoCodec = /avc1|hvc1|hev1|vp9|av01/i.test(codecs);
                const hasAudioCodec = /mp4a|ac-3|ec-3|opus/i.test(codecs);

                variants.push({
                    bandwidth: currentStreamInf.BANDWIDTH ? parseInt(currentStreamInf.BANDWIDTH, 10) : null,
                    averageBandwidth: currentStreamInf['AVERAGE-BANDWIDTH'] ? parseInt(currentStreamInf['AVERAGE-BANDWIDTH'], 10) : null,
                    resolution,
                    resolutionString: currentStreamInf.RESOLUTION || (resolution ? `${resolution.width}x${resolution.height}` : 'Unknown'),
                    frameRate: currentStreamInf['FRAME-RATE'] ? parseFloat(currentStreamInf['FRAME-RATE']) : null,
                    codecs,
                    hasVideoCodec,
                    hasAudioCodec,
                    audioGroup: currentStreamInf.AUDIO || null,
                    subtitlesGroup: currentStreamInf.SUBTITLES || null,
                    rawUri,
                    uri: fullUri
                });

                currentStreamInf = null;
            }
        }

        // Determine Audio Architecture
        let audioArchitecture = 'UNKNOWN';
        let audioDescription = '';

        if (audioRenditions.length > 0) {
            audioArchitecture = 'SEPARATE_AUDIO_RENDITIONS';
            audioDescription = `Found ${audioRenditions.length} separate audio track(s) (Demuxed stream). Video variants contain video only; player syncs external audio renditions.`;
        } else if (variants.some(v => v.hasAudioCodec)) {
            audioArchitecture = 'MULTIPLEXED_AUDIO';
            audioDescription = 'Audio is multiplexed into the transport stream segments alongside video (Single TS with video + audio).';
        } else if (variants.length > 0 && variants.every(v => v.hasVideoCodec && !v.hasAudioCodec)) {
            audioArchitecture = 'VIDEO_ONLY';
            audioDescription = 'Warning: Master manifest explicitly specifies video codecs only without any audio renditions. This stream will play MUTE.';
        } else {
            audioArchitecture = 'UNDETERMINED';
            audioDescription = 'Playlist does not specify audio tracks or codecs. Audio status depends on segment payload.';
        }

        return {
            isMaster: true,
            variantCount: variants.length,
            audioRenditionCount: audioRenditions.length,
            subtitleCount: subtitles.length,
            audioArchitecture,
            audioDescription,
            variants,
            audioRenditions,
            subtitles
        };
    }

    /**
     * Parses a Media Playlist (segment list)
     */
    static parseMediaPlaylist(content, baseUrl = '') {
        const lines = content.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        let targetDuration = 0;
        let segmentCount = 0;
        let totalDuration = 0;

        for (const line of lines) {
            if (line.startsWith('#EXT-X-TARGETDURATION:')) {
                targetDuration = parseFloat(line.split(':')[1]) || 0;
            } else if (line.startsWith('#EXTINF:')) {
                const dur = parseFloat(line.split(':')[1].split(',')[0]) || 0;
                totalDuration += dur;
                segmentCount++;
            }
        }

        return {
            isMaster: false,
            isMediaPlaylist: true,
            targetDuration,
            segmentCount,
            totalDurationSec: Math.round(totalDuration),
            audioArchitecture: 'MEDIA_SEGMENT_PLAYLIST',
            audioDescription: 'This is a child Media Playlist containing individual media segments (.ts / .m4s).'
        };
    }
}

module.exports = HlsParser;
