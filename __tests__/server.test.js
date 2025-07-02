const request = require('supertest');
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

// Create a test app to avoid port conflicts
const app = express();
app.use(cors({ origin: 'http://localhost:3004' }));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.get('/api/users', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT user_id, email, role, tier, created_at FROM users');
    client.release();
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching users:', err.stack);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

app.post('/api/sensors', async (req, res) => {
  try {
    const { dive_id, temperature, depth } = req.body;
    if (!dive_id) {
      return res.status(400).json({ error: 'dive_id is required' });
    }
    const client = await pool.connect();
    const result = await client.query(
      'INSERT INTO sensor_data (dive_id, temperature, depth) VALUES ($1, $2, $3) RETURNING *',
      [dive_id, temperature, depth]
    );
    client.release();
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error inserting sensor data:', err.stack);
    res.status(500).json({ error: 'Failed to insert sensor data' });
  }
});

describe('API Endpoints', () => {
  afterAll(async () => {
    await pool.end(); // Close the database pool after tests
  });

  describe('GET /api/users', () => {
    it('should return a list of users', async () => {
      const response = await request(app).get('/api/users');
      expect(response.status).toBe(200);
      expect(response.body).toBeInstanceOf(Array);
      expect(response.body[0]).toHaveProperty('user_id');
      expect(response.body[0]).toHaveProperty('email', 'test@aquorix.com');
    });
  });

  describe('POST /api/sensors', () => {
    it('should insert sensor data', async () => {
      const response = await request(app)
        .post('/api/sensors')
        .send({ dive_id: 'dive_456', temperature: 23.7, depth: 12.5 });
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('sensor_id');
      expect(response.body).toHaveProperty('dive_id', 'dive_456');
      expect(response.body).toHaveProperty('temperature', '23.7');
      expect(response.body).toHaveProperty('depth', '12.5');
    });
  });
});