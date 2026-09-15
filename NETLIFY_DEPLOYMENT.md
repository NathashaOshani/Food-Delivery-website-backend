# Free Netlify deployment

This backend can run as a Netlify Function without changing local `npm start`
development. The frontend remains a separate Netlify site in its own repository.

## Backend site

Create a Netlify site from the backend GitHub repository and set:

- Build command: `npm ci`
- Publish directory: `netlify-placeholder`
- Functions directory: `netlify/functions`

`netlify.toml` already contains these settings and routes `/api`, `/uploads`,
and `/health` to the function. The function entry point is
`netlify/functions/api.js`.

Set these backend environment variables in Netlify (never commit their values):

```env
NETLIFY=true
MONGODB_URI=your_mongodb_connection_string
IMAGE_STORAGE=mongodb
JWT_SECRET=a-long-random-secret-at-least-32-characters
CLIENT_URL=https://your-frontend-site.netlify.app
EMAIL_PROVIDER=brevo
BREVO_API_KEY=your_brevo_api_key
EMAIL_FROM=DailyDish <your-verified-sender@example.com>
```

Do not set `DB_MODE=local`, `GMAIL_APP_PASSWORD`, or `GMAIL_USER` for the hosted
function. MongoDB Atlas should allow connections from the deployed service.

## Frontend site

Create another Netlify site from the frontend repository. Its `netlify.toml`
already sets `npm run build`, publishes `dist`, and rewrites React routes to
`index.html`.

Set:

```env
VITE_API_URL=https://your-backend-site.netlify.app
```

Then redeploy the frontend. The URL must not end with `/`.

## Important serverless behavior

The free function has execution and request limits. The backend connects to
MongoDB on the first invocation and reuses the connection while the function
instance remains warm. Netlify functions do not provide a continuously running
process, so the abandoned-order and email retry timers run only when a function
invocation occurs. Stripe webhooks and normal requests still trigger their
corresponding order updates. This is suitable for a demo; an always-on paid
worker is better for unattended cleanup and guaranteed retry timing.

Uploaded images are written temporarily and immediately stored in MongoDB
GridFS. Existing catalog images were already migrated and verified: 40 files,
approximately 32 MB, with no missing references.

## Verify after deployment

Open `https://your-backend-site.netlify.app/health/ready` and expect database
status `connected`. Then test a food image, registration and Brevo verification,
login, favorites, checkout, and an admin upload. Refresh a direct frontend route
such as `/food/<id>` to verify the SPA rewrite.
