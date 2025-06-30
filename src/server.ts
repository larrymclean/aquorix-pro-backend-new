// AQUORIX Pro Backend TypeScript File
// └── File: server.ts (Main Express server)
// └── Purpose: Sets up minimal Express server for AQUORIX Pro APIs
// Version: 1.0.0 - 2025-06-30 00:22 PDT
// Author: Larry M.
// License: AQUORIX Pro Backend, Copyright 2025 AQUORIX
// Changelog:
//   - 1.0.0: Initial setup of minimal Express server (commit: <git_hash_initial>)
import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
// ... (keep existing imports at the top)
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

app.use(express.json());

// ... (keep existing code up to the /api/health endpoint)

app.get('/api/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('user_id').limit(1);
    if (error) throw error;
    res.json({ status: 'healthy', dbConnected: true, userCount: data.length });
  } catch (error: any) {
    res.status(500).json({ status: 'unhealthy', dbConnected: false, error: error.message });
  }
});

// Add these new endpoints
const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-secret-key'; // Use the env variable
const SALT_ROUNDS = 10;

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { data, error } = await supabase.from('users').insert({ email, password_hash: passwordHash }).select();
    if (error) throw error;
    res.json({ message: 'User registered', user: data[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabase.from('users').select('*').eq('email', email).single();
    if (error) throw new Error('User not found');
    const match = await bcrypt.compare(password, data.password_hash);
    if (!match) throw new Error('Invalid password');
    const token = jwt.sign({ user_id: data.user_id, role: data.role }, JWT_SECRET, { expiresIn: '1h' });
    res.json({ message: 'Login successful', token });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`AQUORIX Pro Backend running at http://localhost:${port}`);
});