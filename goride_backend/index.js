const express = require('express');
const cors = require('cors');
require('dotenv').config();

const logger = require('./src/middlewares/logger');
const authRoutes = require('./src/routes/authRoutes');
const rideRoutes = require('./src/routes/rideRoutes');
const driverRoutes = require('./src/routes/driverRoutes');
const walletRoutes = require('./src/routes/walletRoutes');
const chatRoutes = require('./src/routes/chatRoutes');


const http = require('http');
const { Server } = require('socket.io');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.set('io', io);
global.io = io; 

app.use(cors());
// Signature verification requires the unmodified request bytes.
app.post('/api/wallet/webhook', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res, next) => {
  try {
    await require('./src/config/payments').webhook(req.body, req.get('x-razorpay-signature'));
    res.json({ received: true });
  } catch (error) { next(error); }
});
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logger);

const { initSocket } = require('./src/socket/socketHandler');
initSocket(io);


// Routes
app.use('/api/auth', authRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api', rideRoutes);


app.get('/health', (req, res) => res.json({ status: 'ok', message: 'GoRide Backend is healthy!' }));
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  res.type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>GoRide</title><body><h1>GoRide</h1><p id="message">GoRide API is online.</p>
    <script>
      const params = new URLSearchParams(location.hash.slice(1));
      const message = document.getElementById('message');
      if (params.has('error')) message.textContent = 'Verification link is invalid or expired. Return to the app and request a new verification email.';
      else if (params.has('access_token')) message.textContent = 'Email verified. Return to the GoRide app and log in with your email and password.';
      history.replaceState(null, '', location.pathname);
    </script></body></html>`);
});

app.use((err, req, res, next) => {
  console.error('BACKEND ERROR:', err);
  const statusCode = err.statusCode || 500;
  const status = err.status || 'error';

  res.status(statusCode).json({
    status: status,
    message: err.message,
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on http://0.0.0.0:${PORT}`);
});

process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));
