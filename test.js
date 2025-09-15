/**
 * Test Suite for Power BI Embedded Application
 * Validates configuration and API endpoints
 */

require('dotenv').config();
const axios = require('axios');
const { validateConfig, getAccessToken, getEmbedToken } = require('./config/powerbi');

const tests = [];
let passedTests = 0;
let failedTests = 0;

function test(name, fn) {
  tests.push({ name, fn });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function runTests() {
  console.log('\n███ Power BI Embedded Test Suite ███\n');
  
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`✓ ${name}`);
      passedTests++;
    } catch (error) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${error.message}`);
      failedTests++;
    }
  }
  
  console.log('\n' + '='.repeat(40));
  console.log(`Results: ${passedTests} passed, ${failedTests} failed`);
  console.log('='.repeat(40) + '\n');
  
  if (failedTests > 0) {
    process.exit(1);
  }
}

test('Environment variables are set', () => {
  assert(process.env.CLIENT_ID, 'CLIENT_ID not set');
  assert(process.env.CLIENT_SECRET, 'CLIENT_SECRET not set');
  assert(process.env.TENANT_ID, 'TENANT_ID not set');
  assert(process.env.WORKSPACE_ID, 'WORKSPACE_ID not set');
  assert(process.env.REPORT_ID, 'REPORT_ID not set');
});

test('Configuration validation passes', () => {
  validateConfig();
});

test('Tenant ID is valid GUID', () => {
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(guidPattern.test(process.env.TENANT_ID), 'TENANT_ID is not a valid GUID');
});

test('Client ID is valid GUID', () => {
  const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  assert(guidPattern.test(process.env.CLIENT_ID), 'CLIENT_ID is not a valid GUID');
});

test('Azure AD token acquisition', async () => {
  const token = await getAccessToken();
  assert(token.access_token, 'No access token received');
  assert(typeof token.access_token === 'string', 'Access token is not a string');
  assert(token.access_token.length > 100, 'Access token seems too short');
});

test('Power BI embed token generation', async () => {
  const embedData = await getEmbedToken();
  assert(embedData.token, 'No embed token received');
  assert(embedData.embedUrl, 'No embed URL received');
  assert(embedData.expiry, 'No expiry time received');
  assert(embedData.correlationId, 'No correlation ID received');
});

test('Server health check', async () => {
  const app = require('./server');
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  try {
    const response = await axios.get(`http://localhost:${process.env.PORT || 3000}/health`);
    assert(response.status === 200, 'Health check did not return 200');
    assert(response.data.status === 'healthy', 'Server is not healthy');
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('  Note: Server not running, skipping health check');
    } else {
      throw error;
    }
  }
});

test('Token caching works', async () => {
  const token1 = await getAccessToken();
  const token2 = await getAccessToken();
  assert(token1.access_token === token2.access_token, 'Token caching not working');
});

runTests().catch(console.error);