# Licence Backend - Deploy Render

1) Push este repo para GitHub.
2) No Supabase: crie DB e execute create tables (SQL or create-tables.js).
3) No Render: New -> Web Service -> conectar repo GitHub.
   - Build command: npm install
   - Start command: npm start
4) Add Environment Variables on Render:
   - DATABASE_URL = (Supabase Session Pooler URL)
   - STRIPE_SECRET_KEY = sk_test_...
   - STRIPE_WEBHOOK_SECRET = (do webhook no Stripe)
   - ALLOWED_ORIGIN = https://vidacomgrana.pages.dev
   - SENDGRID_API_KEY = (se quiser enviar email)
   - EMAIL_FROM = suporte@seudominio.com (deve ser verificado no SendGrid)
5) After deploy, in Stripe Dashboard add a webhook to:
   https://<YOUR_RENDER_SERVICE>/api/stripe-webhook
   and choose event checkout.session.completed
6) Test flows:
   - curl POST /api/test-create-license to create pending license manually
   - user registers via POST /api/register with email+password+licenseKey
   - user login via POST /api/login
