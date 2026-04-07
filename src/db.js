const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cameras (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed default cameras if empty
    const camCount = await client.query('SELECT COUNT(*) FROM cameras');
    if (parseInt(camCount.rows[0].count) === 0) {
      const defaultCameras = [
        { id: 'X100V', name: 'X100V', p1: 250000, p3: 220000, p5: 190000, p10: 170000, p15: 150000, pShift: 150000 },
        { id: 'XS20',  name: 'X-S20', p1: 220000, p3: 200000, p5: 175000, p10: 155000, p15: 135000, pShift: 130000 },
        { id: 'XS10',  name: 'X-S10', p1: 200000, p3: 180000, p5: 160000, p10: 140000, p15: 120000, pShift: 120000 },
        { id: 'XT4',   name: 'X-T4',  p1: 230000, p3: 210000, p5: 185000, p10: 165000, p15: 145000, pShift: 140000 },
      ];
      for (const cam of defaultCameras) {
        await client.query(
          'INSERT INTO cameras (id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [cam.id, JSON.stringify(cam)]
        );
      }
    }

    // Seed default settings if empty
    const settingsDefaults = [
      { key: 'password',  value: 'hana2024' },
      { key: 'fee_early', value: 50000 },
      { key: 'fee_late',  value: 50000 },
    ];
    for (const s of settingsDefaults) {
      await client.query(
        'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [s.key, JSON.stringify(s.value)]
      );
    }

    console.log('✅ Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
