/**
 * Session Manager
 * Handles persistent cookies, storage state, and browser contexts.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class SessionManager {
    constructor(sessionDir = path.resolve(__dirname, '../../sessions')) {
        this.sessionDir = sessionDir;
        this.defaultSessionFile = path.join(this.sessionDir, 'default_session.json');
        this.ensureDir();
    }

    ensureDir() {
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    hasSavedSession() {
        return fs.existsSync(this.defaultSessionFile);
    }

    getSessionPath() {
        return this.hasSavedSession() ? this.defaultSessionFile : null;
    }

    async saveSession(context) {
        try {
            await context.storageState({ path: this.defaultSessionFile });
            const cookies = await context.cookies();
            logger.info(`Session persisted (${cookies.length} cookies saved to disk).`);
            return { success: true, cookieCount: cookies.length };
        } catch (err) {
            logger.error(`Failed to persist session: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    async getCookies(context) {
        if (!context) return [];
        try {
            return await context.cookies();
        } catch (err) {
            return [];
        }
    }

    clearSession() {
        try {
            if (fs.existsSync(this.defaultSessionFile)) {
                fs.unlinkSync(this.defaultSessionFile);
                logger.info('Saved session storage deleted from disk.');
            }
            return { success: true, message: 'Session cleared.' };
        } catch (err) {
            logger.error(`Failed to clear session: ${err.message}`);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new SessionManager();
