# Azure Deployment Guide

## Prerequisites
- Azure CLI installed and authenticated
- Node.js 18+ installed
- Azure subscription with appropriate permissions
- Power BI service principal configured

## Deployment Methods

### Method 1: Automated Script (Linux/Mac/WSL)

1. Navigate to the deploy directory:
   ```bash
   cd powerbi-embed/deploy
   ```

2. Make the script executable:
   ```bash
   chmod +x deploy.sh
   ```

3. Run the deployment:
   ```bash
   ./deploy.sh
   ```

### Method 2: Manual Azure CLI Deployment

1. Set variables:
   ```bash
   RESOURCE_GROUP="rg-powerbi-embed"
   APP_NAME="app-powerbi-embed-unique"
   LOCATION="eastus"
   ```

2. Create resource group:
   ```bash
   az group create --name $RESOURCE_GROUP --location $LOCATION
   ```

3. Deploy ARM template:
   ```bash
   az deployment group create \
     --resource-group $RESOURCE_GROUP \
     --template-file azure-deploy.json \
     --parameters appName=$APP_NAME \
     --parameters clientId="YOUR_CLIENT_ID" \
     --parameters clientSecret="YOUR_CLIENT_SECRET" \
     --parameters tenantId="YOUR_TENANT_ID" \
     --parameters workspaceId="YOUR_WORKSPACE_ID" \
     --parameters reportId="YOUR_REPORT_ID"
   ```

4. Deploy code:
   ```bash
   cd ..
   zip -r deploy.zip . -x "*.git*" -x "deploy/*" -x ".env"
   az webapp deployment source config-zip \
     --resource-group $RESOURCE_GROUP \
     --name $APP_NAME \
     --src deploy.zip
   ```

### Method 3: Azure Portal Deployment

1. Create a new Web App in Azure Portal
2. Configure as follows:
   - Runtime: Node 18 LTS
   - OS: Windows or Linux
   - Region: Your preferred region
   - Plan: B1 or higher

3. Set Application Settings:
   - CLIENT_ID
   - CLIENT_SECRET
   - TENANT_ID
   - WORKSPACE_ID
   - REPORT_ID
   - NODE_ENV = production
   - PORT = 8080

4. Deploy using:
   - GitHub Actions
   - Azure DevOps
   - VS Code Azure Extension
   - ZIP deployment

## Post-Deployment

### Verify Deployment
```bash
az webapp show --resource-group $RESOURCE_GROUP --name $APP_NAME --query state
```

### View Logs
```bash
az webapp log tail --resource-group $RESOURCE_GROUP --name $APP_NAME
```

### Enable Continuous Deployment
```bash
az webapp deployment source config --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --repo-url https://github.com/yourusername/yourrepo \
  --branch main --manual-integration
```

## Custom Domain Setup

1. Add custom domain:
   ```bash
   az webapp config hostname add \
     --webapp-name $APP_NAME \
     --resource-group $RESOURCE_GROUP \
     --hostname www.yourdomain.com
   ```

2. Add SSL certificate:
   ```bash
   az webapp config ssl upload \
     --name $APP_NAME \
     --resource-group $RESOURCE_GROUP \
     --certificate-file certificate.pfx \
     --certificate-password "password"
   ```

## Security Enhancements

### Enable Azure AD Authentication
```bash
az webapp auth update \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --enabled true \
  --action LoginWithAzureActiveDirectory \
  --aad-client-id $CLIENT_ID \
  --aad-token-issuer-url https://sts.windows.net/$TENANT_ID/
```

### Use Key Vault for Secrets
1. Create Key Vault:
   ```bash
   az keyvault create \
     --name kv-powerbi-embed \
     --resource-group $RESOURCE_GROUP \
     --location $LOCATION
   ```

2. Add secrets:
   ```bash
   az keyvault secret set \
     --vault-name kv-powerbi-embed \
     --name "ClientSecret" \
     --value "YOUR_CLIENT_SECRET"
   ```

3. Enable Managed Identity and grant access

## Troubleshooting

### Application won't start
- Check application logs
- Verify all environment variables are set
- Ensure Node.js version is 18+

### Token generation fails
- Verify service principal has correct permissions
- Check CLIENT_ID and CLIENT_SECRET
- Ensure Power BI workspace access is granted

### CORS errors
- Add your domain to CORS settings
- Ensure credentials are included in requests

## Cost Optimization

- Use B1 tier for development/testing
- Scale to S1/S2 for production
- Enable auto-scaling for production
- Use Application Insights sparingly
- Consider using Azure Front Door for caching

## Monitoring

### Enable Application Insights
```bash
az monitor app-insights component create \
  --app ai-powerbi-embed \
  --location $LOCATION \
  --resource-group $RESOURCE_GROUP
```

### Set up Alerts
```bash
az monitor metrics alert create \
  --name high-response-time \
  --resource-group $RESOURCE_GROUP \
  --scopes /subscriptions/{subscription}/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Web/sites/$APP_NAME \
  --condition "avg requests/duration > 1000" \
  --window-size 5m
```