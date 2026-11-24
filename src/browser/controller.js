/**
 * Chromium Browser Controller
 * Manages Chromium browser lifecycle, contexts, and headed/headless switching.
 */
const { chromium } = require('playwright');
const sessionManager = require('../session/manager');
const logger = require('../utils/logger');

class BrowserController {
    constructor() {
        this.browser = null;
        this.context = null;
        this.page = null;
        this.status = 'IDLE'; // IDLE | NAVIGATING | CHALLENGE_REQUIRED | EXTRACTING | ERROR
        this.currentUrl = 'about:blank';
        this.isHeaded = true; // Default to headed mode so user can see and complete verification if challenged
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    }

    setStatus(newStatus, meta = {}) {
        this.status = newStatus;
        logger.debug(`Browser status changed to: ${newStatus}`, meta);
    }

    async init(headed = this.isHeaded) {
        if (this.browser && this.isHeaded === headed) {
            return;
        }

        if (this.browser) {
            await this.close();
        }

        this.isHeaded = headed;
        logger.info(`Launching Chromium (Headed: ${this.isHeaded})...`);

        this.browser = await chromium.launch({
            headless: !this.isHeaded,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
                '--window-size=1280,800',
                '--mute-audio'
            ]
        });

        const storageState = sessionManager.getSessionPath();
        const contextOptions = {
            viewport: { width: 1280, height: 800 },
            userAgent: this.userAgent,
            locale: 'en-US',
            timezoneId: 'Asia/Kolkata',
            deviceScaleFactor: 1,
            hasTouch: false
        };

        if (storageState) {
            logger.info('Restoring saved session state from disk...');
            contextOptions.storageState = storageState;
        }

        this.context = await this.browser.newContext(contextOptions);

        // Inject evasion script to mask automated webdriver flags
        await this.context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            window.chrome = {
                runtime: {}
            };
        });

        this.page = await this.context.newPage();
        this.currentUrl = 'about:blank';
        this.setStatus('IDLE');
        logger.success('Chromium instance initialized and ready.');
    }

    async ensureReady(headed = this.isHeaded) {
        if (!this.browser || !this.page || this.page.isClosed() || this.isHeaded !== headed) {
            await this.init(headed);
        }
        return { browser: this.browser, context: this.context, page: this.page };
    }

    async close() {
        if (this.context) {
            try {
                await sessionManager.saveSession(this.context);
            } catch (_) {}
        }
        if (this.browser) {
            logger.info('Closing Chromium instance...');
            await this.browser.close();
            this.browser = null;
            this.context = null;
            this.page = null;
        }
        this.setStatus('IDLE');
        this.currentUrl = 'about:blank';
    }

    async getStatus() {
        const cookies = await sessionManager.getCookies(this.context);
        return {
            status: this.status,
            currentUrl: this.currentUrl,
            isHeaded: this.isHeaded,
            isReady: !!this.browser && !!this.page && !this.page.isClosed(),
            cookieCount: cookies.length,
            hasSavedSession: sessionManager.hasSavedSession()
        };
    }
}

module.exports = new BrowserController();
