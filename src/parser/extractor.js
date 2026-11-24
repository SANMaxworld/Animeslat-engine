/**
 * Response & Media Extractor Parser
 */
class ResponseParser {
    /**
     * Determines if a request/response is a streaming media or playlist
     */
    static isMediaOrPlaylist(url, contentType = '') {
        const lowerUrl = url.toLowerCase();
        const lowerType = (contentType || '').toLowerCase();

        // Exclude tracking pings/analytics/favicons
        if (lowerUrl.includes('ping.gif') || lowerUrl.includes('analytics') || lowerUrl.includes('telemetry') || lowerUrl.includes('favicon')) {
            return false;
        }

        return (
            lowerUrl.includes('.m3u8') ||
            lowerUrl.includes('/hls/') ||
            lowerUrl.includes('.mpd') ||
            lowerUrl.includes('.mp4') ||
            lowerUrl.includes('.aac') ||
            lowerUrl.includes('.m4a') ||
            lowerType.includes('application/vnd.apple.mpegurl') ||
            lowerType.includes('application/x-mpegurl') ||
            lowerType.includes('application/dash+xml') ||
            (lowerType.includes('video/') && !lowerType.includes('image/')) ||
            lowerType.includes('audio/')
        );
    }

    /**
     * Classifies media stream specificity: MASTER (Audio+Video) vs VIDEO_ONLY vs AUDIO_ONLY
     */
    static getMediaStreamType(url, contentType = '') {
        const lowerUrl = url.toLowerCase();
        const lowerType = (contentType || '').toLowerCase();

        if (lowerUrl.includes('master.m3u8') || lowerUrl.includes('playlist.m3u8') || lowerUrl.includes('index.m3u8')) {
            return 'MASTER_HLS'; // Contains manifest linking Video + Audio together!
        }
        if (lowerUrl.includes('audio') || lowerUrl.includes('.aac') || lowerUrl.includes('.m4a') || lowerType.includes('audio/')) {
            return 'AUDIO_TRACK';
        }
        if (lowerUrl.includes('.m3u8') || lowerUrl.includes('/hls/')) {
            return 'HLS_VARIANT'; // Child stream (demuxed video-only)
        }
        if (lowerUrl.includes('.mpd')) {
            return 'DASH_MANIFEST';
        }
        if (lowerUrl.includes('.mp4')) {
            return 'MP4_VIDEO';
        }
        return 'MEDIA_STREAM';
    }

    /**
     * Classifies network resource category
     */
    static classifyResource(url, resourceType, contentType = '') {
        if (this.isMediaOrPlaylist(url, contentType)) return 'media';
        if (resourceType === 'media' && !url.includes('.gif') && !url.includes('.png')) return 'media';
        if (resourceType === 'xhr' || resourceType === 'fetch' || contentType.includes('application/json')) return 'xhr';
        if (resourceType === 'document') return 'document';
        if (resourceType === 'stylesheet' || resourceType === 'script') return 'asset';
        return resourceType || 'other';
    }

    /**
     * Parses structured metadata from page DOM and responses
     */
    static async extractPageData(page, response) {
        let title = '';
        let url = page.url();
        let status = response ? response.status() : 200;
        let headers = response ? response.headers() : {};
        let htmlPreview = '';
        let rawHtml = '';
        let json = null;

        try {
            title = await page.title();
        } catch (_) {}

        try {
            rawHtml = await page.content();
            // preview first 2000 chars for light UI preview
            htmlPreview = rawHtml.length > 2000 ? rawHtml.substring(0, 2000) + '... [truncated]' : rawHtml;
        } catch (_) {}

        // Check if response is JSON
        const contentType = headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            try {
                json = JSON.parse(await response.text());
            } catch (_) {}
        }

        return {
            title,
            url,
            status,
            contentType,
            headers,
            rawHtml,
            htmlPreview,
            json
        };
    }
}

module.exports = ResponseParser;
