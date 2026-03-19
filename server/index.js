import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import sogniRoutes from './routes/sogni.js';
import { shutdownSogniServices } from './services/sogni.js';
import process from 'process';

// Load environment variables FIRST
dotenv.config();

// Automatically allow self-signed certificates when in local environment
if (process.env.SOGNI_ENV === 'local') {
  console.log('Local environment detected: Self-signed certificates allowed');
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3103;

// Middleware ordering is important
// 1. Trust proxy (if applicable)
app.set('trust proxy', 1);

// 2. CORS Configuration
const allowedOrigins = [
  'https://makeover.sogni.ai',
  'https://makeover-staging.sogni.ai',
  'https://makeover-local.sogni.ai',
  'http://localhost:5176',
  'http://localhost:3003',
  'http://127.0.0.1:5176',
  'http://127.0.0.1:3003'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, Postman, or curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || origin.endsWith('.sogni.ai')) {
      callback(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Client-App-ID', 'Accept'],
  exposedHeaders: ['Set-Cookie']
}));

// 3. Cookie Parser
app.use(cookieParser());

// 4. Body Parsers (50mb limit for base64 images)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// API routes
app.use('/sogni', sogniRoutes);
app.use('/api/sogni', sogniRoutes);

// Health check endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'Server is running',
    environment: process.env.NODE_ENV || 'development'
  });
});

// Determine static directory for production builds
const isLocalEnv = process.env.SOGNI_ENV === 'local' ||
                   process.env.CLIENT_ORIGIN?.includes('local') ||
                   process.env.NODE_ENV !== 'production';

let staticDir;
if (isLocalEnv) {
  staticDir = path.join(__dirname, '..', 'dist');
} else {
  if (process.env.CLIENT_ORIGIN?.includes('staging')) {
    staticDir = '/var/www/makeover-staging.sogni.ai/dist';
  } else {
    staticDir = '/var/www/makeover.sogni.ai';
  }
}

console.log('Environment: ' + (isLocalEnv ? 'LOCAL' : 'PRODUCTION'));
console.log('Static directory:', staticDir);

// Static files and catch-all - only for production/staging (local uses Vite)
if (!isLocalEnv) {
  app.use(express.static(staticDir));

  app.get('*', (req, res) => {
    // Return 404 for missing static assets
    const isStaticAsset = /\.(png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot|webp|bmp|tiff)$/i.test(req.path);

    if (isStaticAsset) {
      console.log(`[Catch-all] Returning 404 for missing static asset: ${req.path}`);
      return res.status(404).send('Not Found');
    }

    // Serve index.html for SPA routing
    console.log(`[Catch-all] Serving index.html for path: ${req.path}`);
    res.sendFile(path.join(staticDir, 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: err.message });
  } else {
    next(err);
  }
});

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  if (process.env.NODE_ENV !== 'production') {
    console.debug('Promise object:', promise);
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Start the server
const server = app.listen(port, () => {
  console.log(`Sogni Makeover server running on port ${port}`);
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);

  // Force shutdown after 10 seconds
  const forceTimeout = setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);

  try {
    await shutdownSogniServices();
  } catch (err) {
    console.error('Error cleaning up Sogni services:', err);
  }

  server.close(() => {
    clearTimeout(forceTimeout);
    console.log('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
