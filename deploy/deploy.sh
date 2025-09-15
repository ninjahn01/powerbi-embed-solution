#!/bin/bash

# Power BI Embedded - Azure Deployment Script
# This script deploys the application to Azure App Service

set -e

echo "====================================="
echo "Power BI Embedded Deployment Script"
echo "====================================="
echo ""

# Configuration
RESOURCE_GROUP="rg-powerbi-embed"
APP_NAME="app-powerbi-embed-$(date +%s)"
LOCATION="eastus"
SKU="B1"

# Load environment variables
if [ -f ../.env ]; then
    export $(cat ../.env | grep -v '^#' | xargs)
else
    echo "Error: .env file not found"
    exit 1
fi

# Validate required variables
if [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ] || [ -z "$TENANT_ID" ] || [ -z "$WORKSPACE_ID" ] || [ -z "$REPORT_ID" ]; then
    echo "Error: Missing required environment variables"
    exit 1
fi

echo "1. Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION --output none

echo "2. Deploying ARM template..."
az deployment group create \
    --resource-group $RESOURCE_GROUP \
    --template-file azure-deploy.json \
    --parameters \
        appName=$APP_NAME \
        location=$LOCATION \
        sku=$SKU \
        clientId=$CLIENT_ID \
        clientSecret=$CLIENT_SECRET \
        tenantId=$TENANT_ID \
        workspaceId=$WORKSPACE_ID \
        reportId=$REPORT_ID \
    --output none

echo "3. Building application..."
cd ..
npm install --production

echo "4. Creating deployment package..."
zip -r deploy.zip . -x "*.git*" -x "deploy/*" -x ".env" -x "test.js" -x "*.log" -x "README.md"

echo "5. Deploying to Azure App Service..."
az webapp deployment source config-zip \
    --resource-group $RESOURCE_GROUP \
    --name $APP_NAME \
    --src deploy.zip \
    --output none

echo "6. Restarting App Service..."
az webapp restart --resource-group $RESOURCE_GROUP --name $APP_NAME --output none

echo "7. Waiting for application to start..."
sleep 30

echo "8. Running health check..."
APP_URL="https://$APP_NAME.azurewebsites.net"
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" $APP_URL/health)

if [ $HEALTH_CHECK -eq 200 ]; then
    echo ""
    echo "====================================="
    echo "Deployment Successful!"
    echo "====================================="
    echo "Application URL: $APP_URL"
    echo "Health Check: $APP_URL/health"
    echo ""
else
    echo "Warning: Health check returned status $HEALTH_CHECK"
    echo "Check application logs: az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME"
fi

echo "Cleaning up deployment package..."
rm -f deploy.zip

echo "Deployment complete!"