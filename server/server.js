import express from 'express';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const {
  DB_HOST = '192.168.0.100',
  DB_PORT = 3306,
  DB_NAME = 'aactecno_a2er5xd6amnr',
  DB_USER = 'aactecno_a2er5xd6amnr',
  DB_PASSWORD = 'sKUZKyC2MYkvvCgzBFAk',
  PORT = 3000,
} = process.env;

const app = express();
app.use(express.json({ limit: '5mb' }));
app.disable('x-powered-by');

const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

async function ensureSchema() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS encrypted_states (
      id TINYINT UNSIGNED PRIMARY KEY,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  await pool.query(createTableQuery);
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  if (typeof payload.version === 'undefined' || typeof payload.data !== 'string' || typeof payload.iv !== 'string') {
    return false;
  }
  return true;
}

app.get('/api/state', async (_req, res) => {
  try {
    const [rows] = await pool.query('SELECT payload FROM encrypted_states WHERE id = 1 LIMIT 1');
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(404).json({ message: 'No encrypted state stored.' });
    }

    const rawPayload = rows[0].payload;
    try {
      const parsed = JSON.parse(rawPayload);
      return res.json(parsed);
    } catch (parseError) {
      console.error('Stored payload is not valid JSON.', parseError);
      return res.status(500).json({ message: 'Stored payload is corrupt.' });
    }
  } catch (error) {
    console.error('Error retrieving encrypted state.', error);
    return res.status(500).json({ message: 'Unable to retrieve encrypted state.' });
  }
});

app.put('/api/state', async (req, res) => {
  const payload = req.body;
  if (!validatePayload(payload)) {
    return res.status(400).json({ message: 'Invalid encrypted payload format.' });
  }

  const serializedPayload = JSON.stringify(payload);

  try {
    await pool.query(
      `INSERT INTO encrypted_states (id, payload) VALUES (1, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = CURRENT_TIMESTAMP`,
      [serializedPayload]
    );
    return res.status(204).send();
  } catch (error) {
    console.error('Error saving encrypted state.', error);
    return res.status(500).json({ message: 'Unable to persist encrypted state.' });
  }
});

app.use((req, res) => {
  res.status(404).json({ message: 'Endpoint not found.' });
});

ensureSchema()
  .then(() => {
    app.listen(Number(PORT), () => {
      console.log(`Encrypted state API listening on port ${PORT}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize database schema.', error);
    process.exit(1);
  });
