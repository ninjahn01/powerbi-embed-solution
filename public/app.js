/**
 * Power BI Embed Frontend Application
 * Handles report embedding, token management, and UI interactions
 */

(function() {
    'use strict';
    
    let report = null;
    let tokenExpiryTime = null;
    let refreshTimer = null;
    let retryCount = 0;
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 2000;
    const LOAD_TIMEOUT = 10000; // 10 second timeout for initial load
    
    const elements = {
        loader: document.getElementById('loader'),
        errorContainer: document.getElementById('error-container'),
        errorText: document.getElementById('error-text'),
        reportContainer: document.getElementById('reportContainer'),
        connectionStatus: document.getElementById('connection-status'),
        tokenExpiry: document.getElementById('token-expiry'),
        refreshBtn: document.getElementById('refresh-btn'),
        fullscreenBtn: document.getElementById('fullscreen-btn'),
        retryBtn: document.getElementById('retry-btn')
    };
    
    /**
     * Load Power BI SDK dynamically
     */
    function loadPowerBISDK() {
        return new Promise((resolve, reject) => {
            if (typeof powerbi !== 'undefined') {
                resolve();
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/powerbi-client@2.22.4/dist/powerbi.min.js';
            script.async = true;
            script.defer = true;
            script.onload = () => {
                console.log('Power BI SDK loaded successfully');
                resolve();
            };
            script.onerror = () => {
                console.error('Failed to load Power BI SDK');
                reject(new Error('Failed to load Power BI SDK'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * Initialize the application
     */
    async function init() {
        console.log('Initializing Power BI Embedded Application');

        // Load Power BI SDK
        try {
            await loadPowerBISDK();
        } catch (error) {
            showError('Power BI SDK failed to load. Please refresh the page.');
            return;
        }

        elements.refreshBtn.addEventListener('click', () => loadReport());
        elements.fullscreenBtn.addEventListener('click', toggleFullscreen);
        elements.retryBtn.addEventListener('click', () => {
            retryCount = 0;
            loadReport();
        });

        await loadReport();
    }
    
    /**
     * Load Power BI report
     */
    async function loadReport() {
        try {
            showLoader();
            hideError();
            updateStatus('connecting', 'Connecting...');

            if (typeof powerbi === 'undefined') {
                throw new Error('Power BI SDK not loaded. Please refresh the page.');
            }

            const config = await fetchConfig();
            const tokenData = await fetchToken();
            
            if (!tokenData.success) {
                throw new Error(tokenData.error || 'Failed to get embed token');
            }
            
            const pbiClient = window['powerbi-client'];
            const models = pbiClient.models;

            const embedConfig = {
                type: 'report',
                tokenType: models.TokenType.Embed,
                accessToken: tokenData.token,
                embedUrl: tokenData.embedUrl,
                id: config.reportId,
                permissions: models.Permissions.Read,
                settings: {
                    filterPaneEnabled: true,
                    navContentPaneEnabled: true,
                    background: models.BackgroundType.Transparent,
                    layoutType: models.LayoutType.Custom,
                    customLayout: {
                        displayOption: models.DisplayOption.FitToWidth
                    }
                }
            };
            
            const powerbiService = new pbiClient.service.Service(
                pbiClient.factories.hpmFactory,
                pbiClient.factories.wpmpFactory,
                pbiClient.factories.routerFactory
            );
            report = powerbiService.embed(elements.reportContainer, embedConfig);
            
            report.off('loaded');
            report.on('loaded', () => {
                console.log('Report loaded successfully');
                hideLoader();
                updateStatus('connected', 'Connected');
                retryCount = 0;
            });
            
            report.off('rendered');
            report.on('rendered', () => {
                console.log('Report rendered successfully');
            });
            
            report.off('error');
            report.on('error', (event) => {
                handleEmbedError(event.detail);
            });
            
            setupTokenRefresh(tokenData.expiry);
            
        } catch (error) {
            console.error('Failed to load report:', error);
            handleLoadError(error);
        }
    }
    
    /**
     * Fetch non-sensitive configuration
     */
    async function fetchConfig() {
        const response = await fetch('/api/config');
        if (!response.ok) {
            throw new Error(`Config fetch failed: ${response.statusText}`);
        }
        return response.json();
    }
    
    /**
     * Fetch embed token from server
     */
    async function fetchToken() {
        const response = await fetch('/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok && response.status !== 400) {
            const error = await response.json();
            throw new Error(error.error || `Token fetch failed: ${response.statusText}`);
        }
        
        return response.json();
    }
    
    /**
     * Setup automatic token refresh
     */
    function setupTokenRefresh(expiryTime) {
        if (refreshTimer) {
            clearTimeout(refreshTimer);
        }
        
        tokenExpiryTime = new Date(expiryTime);
        updateTokenExpiry();
        
        const now = new Date();
        const refreshTime = new Date(tokenExpiryTime.getTime() - 5 * 60 * 1000);
        const delay = refreshTime - now;
        
        if (delay > 0) {
            console.log(`Token refresh scheduled in ${Math.round(delay / 1000)} seconds`);
            refreshTimer = setTimeout(async () => {
                console.log('Refreshing token...');
                await refreshToken();
            }, delay);
        }
    }
    
    /**
     * Refresh the embed token
     */
    async function refreshToken() {
        try {
            const tokenData = await fetchToken();
            
            if (!tokenData.success) {
                throw new Error(tokenData.error || 'Failed to refresh token');
            }
            
            if (report) {
                await report.setAccessToken(tokenData.token);
                console.log('Token refreshed successfully');
                setupTokenRefresh(tokenData.expiry);
            }
        } catch (error) {
            console.error('Token refresh failed:', error);
            showError('Token expired. Please refresh the page.');
        }
    }
    
    /**
     * Handle embed errors
     */
    function handleEmbedError(error) {
        console.error('Embed error:', error);
        
        if (error.message && error.message.includes('TokenExpired')) {
            console.log('Token expired, attempting refresh...');
            refreshToken();
        } else {
            showError(`Report error: ${error.message || 'Unknown error occurred'}`);
        }
    }
    
    /**
     * Handle load errors with retry logic
     */
    function handleLoadError(error) {
        hideLoader();
        updateStatus('disconnected', 'Disconnected');
        
        if (retryCount < MAX_RETRIES) {
            retryCount++;
            console.log(`Retrying... (${retryCount}/${MAX_RETRIES})`);
            showError(`Connection failed. Retrying ${retryCount}/${MAX_RETRIES}...`);
            
            setTimeout(() => {
                loadReport();
            }, RETRY_DELAY * retryCount);
        } else {
            showError(error.message || 'Failed to load report after multiple attempts');
        }
    }
    
    /**
     * Toggle fullscreen mode
     */
    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            elements.reportContainer.requestFullscreen().catch(err => {
                console.error('Error attempting fullscreen:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }
    
    /**
     * UI Helper Functions
     */
    function showLoader() {
        elements.loader.style.display = 'block';
        elements.reportContainer.style.display = 'none';
    }
    
    function hideLoader() {
        elements.loader.style.display = 'none';
        elements.reportContainer.style.display = 'block';
    }
    
    function showError(message) {
        elements.errorText.textContent = message;
        elements.errorContainer.style.display = 'block';
        hideLoader();
    }
    
    function hideError() {
        elements.errorContainer.style.display = 'none';
    }
    
    function updateStatus(status, text) {
        elements.connectionStatus.className = `status ${status}`;
        elements.connectionStatus.textContent = `● ${text}`;
    }
    
    
    function updateTokenExpiry() {
        if (tokenExpiryTime) {
            const expiryStr = tokenExpiryTime.toLocaleTimeString();
            elements.tokenExpiry.textContent = `Token Expires: ${expiryStr}`;
        }
    }
    
    setInterval(() => {
        if (tokenExpiryTime) {
            const now = new Date();
            const remaining = tokenExpiryTime - now;
            if (remaining > 0) {
                const minutes = Math.floor(remaining / 60000);
                const seconds = Math.floor((remaining % 60000) / 1000);
                elements.tokenExpiry.textContent = `Token Expires: ${minutes}:${seconds.toString().padStart(2, '0')}`;
            } else {
                elements.tokenExpiry.textContent = 'Token Expired';
            }
        }
    }, 1000);
    
    document.addEventListener('DOMContentLoaded', init);
})();