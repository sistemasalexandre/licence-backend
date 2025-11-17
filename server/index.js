// server/index.js
const express = require('express');
const cors = require('cors');
const routes = require('./routes');

const app = express();

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://vidacomgrana.pages.dev';

// CORS
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true
}));

// Parse JSON and keep raw body for Stripe
app.use(express.json({
  verify: function (req, res, buf) {
    req.rawBody = buf.toString();
  }
}));
app.use(express.urlencoded({ extended: false }));

app.use('/api', routes);

app.get('/', (req, res) => res.send('License backend running'));

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server listening on ${port}`));
