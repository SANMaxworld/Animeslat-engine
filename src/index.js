/**
 * Main Application Entry Point
 * Chromium-Based External Fetch & Web Compatibility System
 */
const { createServer } = require('./server/api');
const browserController = require('./browser/controller');
const logger = require('./utils/logger');

const PORT = process.env.PORT || 3000;

async function bootstrap() {
    logger.info('Starting Chromium-Based External Fetch System...');

    // Start API Server
    const { server } = createServer(PORT);

    // Initialize Chromium in background
    try {
        await browserController.init(true);
    } catch (err) {
        logger.warn(`Initial browser launch deferred: ${err.message}`);
    }

    // Graceful Shutdown
    const shutdown = async () => {
        logger.info('Shutting down server and saving session...');
        await browserController.close();
        server.close(() => {
            logger.info('Server stopped.');
            process.exit(0);
        });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

bootstrap().catch(err => {
    logger.error(`Bootstrap failure: ${err.message}`);
    process.exit(1);
});
