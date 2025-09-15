/**
 * Power BI Configuration Module
 * Centralizes all Power BI settings and token management
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

let cachedAADToken = null;
let tokenExpiryTime = null;

/**
 * Validates required environment variables
 * @throws {Error} If any required variable is missing or invalid
 */
function validateConfig() {
  const required = ['CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID', 'WORKSPACE_ID', 'REPORT_ID'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  
  if (!guidPattern.test(process.env.TENANT_ID)) {
    throw new Error('TENANT_ID is not a valid GUID');
  }
  
  if (!guidPattern.test(process.env.CLIENT_ID)) {
    throw new Error('CLIENT_ID is not a valid GUID');
  }
}

/**
 * Gets Azure AD access token with caching
 * @returns {Promise<Object>} Token object with access_token and expires_in
 */
async function getAccessToken() {
  const correlationId = uuidv4();
  
  if (cachedAADToken && tokenExpiryTime && new Date() < tokenExpiryTime) {
    logger.info(`Using cached AAD token [${correlationId}]`);
    return { access_token: cachedAADToken };
  }

  logger.info(`Acquiring new AAD token [${correlationId}]`);
  
  const tokenUrl = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append('grant_type', 'client_credentials');
  params.append('client_id', process.env.CLIENT_ID);
  params.append('client_secret', process.env.CLIENT_SECRET);
  params.append('scope', 'https://analysis.windows.net/powerbi/api/.default');

  try {
    const response = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000
    });

    cachedAADToken = response.data.access_token;
    const expiresInMs = (response.data.expires_in - 300) * 1000;
    tokenExpiryTime = new Date(Date.now() + expiresInMs);
    
    logger.info(`AAD token acquired successfully [${correlationId}]`);
    return response.data;
  } catch (error) {
    logger.error(`Failed to get AAD token [${correlationId}]:`, error.message);
    if (error.response) {
      logger.error(`Response data:`, error.response.data);
    }
    throw new Error('Azure AD authentication failed: Check CLIENT_ID and CLIENT_SECRET in .env file');
  }
}

/**
 * Gets Power BI embed token
 * @returns {Promise<Object>} Embed token with URL and expiry
 */
async function getEmbedToken() {
  const correlationId = uuidv4();
  logger.info(`Generating Power BI embed token [${correlationId}]`);
  
  try {
    const tokenData = await getAccessToken();
    const embedUrl = `https://api.powerbi.com/v1.0/myorg/groups/${process.env.WORKSPACE_ID}/reports/${process.env.REPORT_ID}/GenerateToken`;
    
    const requestBody = {
      accessLevel: 'View',
      datasetId: null
    };

    const response = await axios.post(embedUrl, requestBody, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    const embedToken = response.data;
    const reportUrl = `https://app.powerbi.com/reportEmbed?reportId=${process.env.REPORT_ID}&groupId=${process.env.WORKSPACE_ID}`;
    
    logger.info(`Embed token generated successfully [${correlationId}]`);
    
    return {
      token: embedToken.token,
      embedUrl: reportUrl,
      expiry: embedToken.expiration,
      correlationId
    };
  } catch (error) {
    logger.error(`Failed to get embed token [${correlationId}]:`, error.message);
    if (error.response?.status === 403) {
      throw new Error('Power BI API error: Verify workspace access for service principal');
    }
    throw new Error(`Power BI embed token generation failed: ${error.message}`);
  }
}

module.exports = {
  validateConfig,
  getAccessToken,
  getEmbedToken
};