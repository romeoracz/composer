# Vercel Deployment (Web)

- Project Root Directory: apps/web
- Install Command: npm ci
- Build Command: npm run build
- Node: 20 (picked up from .nvmrc)

## Environment Variables
- NEXT_PUBLIC_API_ORIGIN: https://api.yourdomain.com (prod) or staging URL
- SECRET_ENC_KEY: base64 32-byte key shared with API (store in Vercel environment)
- ENABLE_TEST_ENDPOINTS: optional; set to `false` for production

## CORS
- Set API WEB_ORIGIN to your Vercel domain(s):
  - Production: https://yourapp.vercel.app or custom domain
  - Preview: allow preview URLs or use a regex origin match in the API
