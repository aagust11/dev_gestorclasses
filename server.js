const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const {
    DB_HOST,
    DB_PORT = 3306,
    DB_NAME,
    DB_USER,
    DB_PASSWORD,
    DATA_TABLE = 'data',
    API_PORT = 3000,
    API_TOKEN,
    API_ALLOWED_ORIGINS
} = process.env;

if (!DB_HOST || !DB_NAME || !DB_USER) {
    console.error('Missing required database configuration. Please check DB_HOST, DB_NAME and DB_USER.');
    process.exit(1);
}

const app = express();

const allowedOrigins = (API_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
if (allowedOrigins.length === 0 || allowedOrigins.includes('*')) {
    app.use(cors({ origin: true, credentials: true }));
} else {
    app.use(cors({ origin: allowedOrigins, credentials: true }));
}

app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
});

let pool;
let server;

async function initializePool() {
    pool = mysql.createPool({
        host: DB_HOST,
        port: Number(DB_PORT) || 3306,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        namedPlaceholders: true
    });

    const createTableSql = `
        CREATE TABLE IF NOT EXISTS \`${DATA_TABLE}\` (
            id INT PRIMARY KEY,
            payload LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `;
    await pool.query(createTableSql);
}

async function start() {
    try {
        await initializePool();
        server = app.listen(Number(API_PORT) || 3000, () => {
            console.log(`API listening on port ${API_PORT || 3000}`);
        });
    } catch (error) {
        console.error('Error initialising database pool', error);
        process.exit(1);
    }
}

start();

function authenticate(req, res, next) {
    if (!API_TOKEN) {
        return next();
    }
    const header = req.get('Authorization') || '';
    if (header.startsWith('Bearer ')) {
        const token = header.slice(7);
        if (token === API_TOKEN) {
            return next();
        }
    }
    return res.status(401).json({ error: 'unauthorized' });
}

app.get('/status', authenticate, async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Database status check failed', error);
        res.status(500).json({ error: 'db_error', message: error.message });
    }
});

app.get('/data', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(`SELECT payload FROM \`${DATA_TABLE}\` WHERE id = 1`);
        if (!rows || rows.length === 0) {
            return res.json({ data: {} });
        }
        const payload = rows[0].payload;
        let parsed = {};
        if (typeof payload === 'string' && payload.trim().length > 0) {
            try {
                parsed = JSON.parse(payload);
            } catch (error) {
                console.warn('Stored payload is not valid JSON, returning empty object');
            }
        }
        res.json({ data: parsed });
    } catch (error) {
        console.error('Error fetching data from database', error);
        res.status(500).json({ error: 'db_error', message: error.message });
    }
});

app.post('/data', authenticate, async (req, res) => {
    const payload = req.body?.data;
    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'invalid_payload' });
    }

    try {
        const serialized = JSON.stringify(payload);
        await pool.query(
            `INSERT INTO \`${DATA_TABLE}\` (id, payload) VALUES (1, ?)
             ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
            [serialized]
        );
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Error saving data to database', error);
        res.status(500).json({ error: 'db_error', message: error.message });
    }
});

app.use((req, res) => {
    res.status(404).json({ error: 'not_found' });
});

function shutdown(signal) {
    console.log(`Received ${signal}, shutting down...`);
    const closeServer = server
        ? new Promise(resolve => server.close(resolve))
        : Promise.resolve();
    closeServer.then(async () => {
        if (pool) {
            try {
                await pool.end();
            } catch (error) {
                console.error('Error closing database pool', error);
            }
        }
        process.exit(0);
    });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
