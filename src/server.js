require('dotenv').config();
const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { pool, initDB } = require('./db');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ── WebSocket: broadcast to all connected clients ──
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  ws.on('error', () => {});
});

// ════════════════════════════════════════════════
// BOOKINGS
// ════════════════════════════════════════════════
app.get('/api/bookings', async (req, res) => {
  try {
    const result = await pool.query('SELECT data FROM bookings ORDER BY created_at ASC');
    res.json(result.rows.map(r => r.data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const bookings = req.body; // array
    if (!Array.isArray(bookings)) return res.status(400).json({ error: 'Expected array' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const b of bookings) {
        await client.query(
          'INSERT INTO bookings (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2',
          [b.id, JSON.stringify(b)]
        );
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    broadcast({ type: 'bookings_updated' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM bookings WHERE id = $1', [req.params.id]);
    broadcast({ type: 'bookings_updated' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════
// CAMERAS
// ════════════════════════════════════════════════
app.get('/api/cameras', async (req, res) => {
  try {
    const result = await pool.query('SELECT data FROM cameras ORDER BY data->>\'name\' ASC');
    res.json(result.rows.map(r => r.data));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cameras', async (req, res) => {
  try {
    const cameras = req.body;
    if (!Array.isArray(cameras)) return res.status(400).json({ error: 'Expected array' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Delete removed cameras
      if (cameras.length > 0) {
        const ids = cameras.map(c => c.id);
        await client.query('DELETE FROM cameras WHERE id != ALL($1::text[])', [ids]);
      } else {
        await client.query('DELETE FROM cameras');
      }
      for (const c of cameras) {
        await client.query(
          'INSERT INTO cameras (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()',
          [c.id, JSON.stringify(c)]
        );
      }
      await client.query('COMMIT');
    } catch(e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    broadcast({ type: 'cameras_updated' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════
app.get('/api/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/settings/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value, currentPassword } = req.body;

    // Password change requires verification
    if (key === 'password') {
      const pwRow = await pool.query('SELECT value FROM settings WHERE key = $1', ['password']);
      const currentPw = pwRow.rows[0]?.value;
      if (currentPw !== currentPassword) {
        return res.status(403).json({ error: 'Mật khẩu hiện tại không đúng' });
      }
    }

    await pool.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, JSON.stringify(value)]
    );
    if (key !== 'password') broadcast({ type: 'settings_updated', key, value });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify password (for login check)
app.post('/api/auth', async (req, res) => {
  try {
    const { password } = req.body;
    const result = await pool.query('SELECT value FROM settings WHERE key = $1', ['password']);
    const stored = result.rows[0]?.value;
    if (stored === password) {
      res.json({ ok: true });
    } else {
      res.status(401).json({ error: 'Sai mật khẩu' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Serve frontend for all other routes ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Start ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 hana.fujifilm server running on port ${PORT}`);
  });
}).catch(e => {
  console.error('Failed to init DB:', e);
  process.exit(1);
});
