/**
 * Centralized Logging & Event Bus System
 */
const EventEmitter = require('events');

class Logger extends EventEmitter {
    constructor(maxHistory = 200) {
        super();
        this.maxHistory = maxHistory;
        this.history = [];
    }

    log(level, message, meta = null) {
        const entry = {
            id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            timestamp: new Date().toISOString(),
            level: level.toUpperCase(),
            message,
            meta
        };

        this.history.push(entry);
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }

        const colorMap = {
            INFO: '\x1b[36m',    // Cyan
            SUCCESS: '\x1b[32m', // Green
            WARN: '\x1b[33m',    // Yellow
            ERROR: '\x1b[31m',   // Red
            CHALLENGE: '\x1b[35m', // Magenta
            DEBUG: '\x1b[90m'    // Gray
        };
        const reset = '\x1b[0m';
        const color = colorMap[entry.level] || reset;

        console.log(`[${entry.timestamp.split('T')[1].replace('Z', '')}] ${color}[${entry.level}]${reset} ${message}`);

        this.emit('log', entry);
        return entry;
    }

    info(msg, meta) { return this.log('INFO', msg, meta); }
    success(msg, meta) { return this.log('SUCCESS', msg, meta); }
    warn(msg, meta) { return this.log('WARN', msg, meta); }
    error(msg, meta) { return this.log('ERROR', msg, meta); }
    challenge(msg, meta) { return this.log('CHALLENGE', msg, meta); }
    debug(msg, meta) { return this.log('DEBUG', msg, meta); }

    getHistory() {
        return this.history;
    }

    clearHistory() {
        this.history = [];
        this.emit('clear');
    }
}

module.exports = new Logger();
