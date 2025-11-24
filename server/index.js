// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const routes = require('./routes');

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://vidacomgrana.pages.dev';

app.set('trust proxy', 1);

// Keep raw body for Stripe webhook route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/stripe-webhook') return next();
  express.json()(req, res, next);
});
app.use(express.urlencoded({ extended: true }));

// CORS - restrict to frontend
app.use(cors({ origin: FRONTEND_URL, credentials: true }));

app.get('/', (req, res) => res.send('API is running'));
app.use('/api', routes);

// 404
app.use((req, res) => res.status(404).json({ error: 'not_found' }));

// error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_server_error' });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
