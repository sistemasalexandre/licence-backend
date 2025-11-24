// server/index.js
// Entry point for Express server (production-ready adjustments for Render/Cloudflare Pages)
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const routes = require('./routes');

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';

// Trust proxy when behind a reverse proxy (Render, Cloudflare)
app.set('trust proxy', 1);

// IMPORTANT: keep express.json off for the Stripe webhook route so we can use express.raw there.
// We apply JSON body parsing for all routes except the exact webhook path.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') return next();
  express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// Configure CORS: allow only the frontend URL (change if needed)
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

// health check
app.get('/', (req, res) => res.send('API is running'));

// mount API routes under /api
app.use('/api', routes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
