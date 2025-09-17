/**
 * Power BI Embedded Server
 * Express backend with Azure AD authentication and Power BI embedding
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { validateConfig, getEmbedToken } = require('./config/powerbi');
const { authenticate } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'error' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

try {
  validateConfig();
  logger.info('Configuration validated successfully');
} catch (error) {
  logger.error('Configuration validation failed:', error.message);
  process.exit(1);
}

// Enable compression for all responses
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6 // Balanced compression level
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://app.powerbi.com", "https://content.powerapps.com", "https://cdn.jsdelivr.net"],
      frameSrc: ["https://app.powerbi.com"],
      connectSrc: ["'self'", "https://api.powerbi.com", "https://analysis.windows.net", "https://wabi-*", "wss://wabi-*"],
      imgSrc: ["'self'", "data:", "https://*.powerbi.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://app.powerbi.com"]
    }
  }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGINS?.split(',') : true,
  credentials: true
}));

app.use(express.json());

// Serve static files with caching
app.use(express.static('public', {
  maxAge: process.env.NODE_ENV === 'production' ? '1d' : '0',
  etag: true,
  lastModified: true
}));

app.use((req, res, next) => {
  req.correlationId = uuidv4();
  logger.info(`${req.method} ${req.path} [${req.correlationId}]`);
  next();
});

const tokenLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many token requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    correlationId: req.correlationId
  });
});

/**
 * Get non-sensitive configuration
 */
app.get('/api/config', authenticate, (req, res) => {
  res.json({
    workspaceId: process.env.WORKSPACE_ID,
    reportId: process.env.REPORT_ID,
    environment: process.env.NODE_ENV,
    correlationId: req.correlationId
  });
});

/**
 * Generate Power BI embed token
 */
app.post('/api/token', tokenLimiter, authenticate, async (req, res) => {
  try {
    const embedData = await getEmbedToken();
    
    res.json({
      success: true,
      token: embedData.token,
      embedUrl: embedData.embedUrl,
      expiry: embedData.expiry,
      correlationId: req.correlationId
    });
  } catch (error) {
    logger.error(`Token generation failed [${req.correlationId}]:`, error.message);
    
    let statusCode = 500;
    let userMessage = 'Failed to generate embed token';
    
    if (error.message.includes('Azure AD')) {
      statusCode = 401;
      userMessage = 'Authentication failed. Please check configuration.';
    } else if (error.message.includes('workspace access')) {
      statusCode = 403;
      userMessage = 'Access denied. Please verify Power BI permissions.';
    }
    
    res.status(statusCode).json({
      success: false,
      error: userMessage,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString()
    });
  }
});


/**
 * Error handling middleware
 */
app.use((err, req, res, next) => {
  logger.error(`Unhandled error [${req.correlationId}]:`, err);
  res.status(500).json({
    success: false,
    error: 'An unexpected error occurred',
    correlationId: req.correlationId
  });
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    correlationId: req.correlationId
  });
});

const server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  logger.info('Received shutdown signal, closing server gracefully...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

module.exports = app;