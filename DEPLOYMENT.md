# Free DailyDish demo

The repositories stay separate. `render.yaml` in the backend repository defines
a free Node backend and a static frontend from their respective GitHub repos.
MongoDB remains the database, including food images stored in `foodImages.files`
and `foodImages.chunks`. Existing account, order, and catalog data are not reset.

## 1. Set up HTTPS email

1. Create a free account at https://www.brevo.com/ and complete account activation.
2. In Senders, add `DailyDish` and your sender email address. Complete the email
   verification. Transactional sending must be enabled for the account.
3. In SMTP & API > API Keys, create an **API key** (not an SMTP key).
4. To check it locally, set these entries in the backend `.env`:

   ```env
   EMAIL_PROVIDER=brevo
   BREVO_API_KEY=your-private-api-key
   EMAIL_FROM="DailyDish <your-verified-sender@example.com>"
   ```

5. Run `npm run email:check`. This checks authentication and sender status without
   sending a message. Then test a verification or password-reset email to an
   account you control to confirm actual delivery. Do not commit `.env` or paste
   the API key into a public repository or chat.

Brevo's free plan currently allows 300 emails per day. Gmail senders may be
rewritten by Brevo to meet recipient-provider requirements. See
[Brevo sender requirements](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders).

The existing Gmail credentials can stay in local `.env`; only EMAIL_PROVIDER
selects the active provider. Render's free backend blocks Gmail SMTP.

## 2. Preserve existing food images

From the backend directory with the existing MongoDB `.env`:

```powershell
node scripts/migrateImages.js
node scripts/migrateImages.js --apply
```

The first command reports what is missing from MongoDB without writing. The
second copies only images referenced by foods, verifies each new copy by SHA-256,
and leaves the local files and catalog documents intact. Run it before deployment.
Investigate any nonzero `missing` count before going live. Images consume the
existing MongoDB storage allowance; this does not purchase or provision storage.

The deployed `IMAGE_STORAGE=mongodb` setting makes new admin uploads persistent.
Local development defaults to filesystem storage unless you change that setting.

## 3. Push and deploy

Commit and push the prepared changes in **both** repositories to `main`.
In Render, connect GitHub with access to both repositories, choose New > Blueprint,
and select the backend repository. Review the configuration: backend plan `free`,
frontend runtime `static`, no paid disks or Render databases.

Provide the prompted values:

| Service | Variable | Value |
| --- | --- | --- |
| Backend | `MONGODB_URI` | Existing private MongoDB connection string |
| Backend | `BREVO_API_KEY` | Private Brevo API key |
| Backend | `EMAIL_FROM` | Verified sender in `Name <email>` format |
| Backend | `CLIENT_URL` | Frontend's HTTPS URL, with no trailing slash |
| Frontend | `VITE_API_URL` | Backend's HTTPS URL, with no trailing slash |

Render generates a new JWT secret. Do not set `DB_MODE=local` on the hosted service.
For the first Blueprint form, the requested names suggest
`https://dailydish-demo.onrender.com` and `https://dailydish-demo-api.onrender.com`.
**Use the URLs Render actually assigns**, which may differ. Correct CLIENT_URL
and VITE_API_URL after creation if needed. Changing VITE_API_URL requires rebuilding
the frontend; changing CLIENT_URL restarts the backend.

In MongoDB Atlas Network Access, allow the backend service's outbound IP ranges
shown by Render. This is separate from your laptop's existing access permission.
Keep the connection string only in the backend's secret environment variables.

The frontend build is `npm ci && npm run build`, output directory `dist`.
The backend build is `npm ci`, start command `npm start`.
The Blueprint includes the `/*` -> `/index.html` rewrite so page refreshes and
email links work with React Router.

## 4. Optional integrations and final checks

- Google sign-in: set the same Google client ID in backend `GOOGLE_CLIENT_ID` and
  frontend `VITE_GOOGLE_CLIENT_ID`; authorize the deployed frontend origin in
  Google Cloud. Rebuild the frontend after changing its environment.
- Stripe: this demo leaves Stripe disabled by default. For payment testing, add
  **test-mode** Stripe secrets and configure the signed webhook at
  `https://YOUR-BACKEND/api/order/webhook` using the events listed in README.md.
- Open the backend `/health/ready`: expect HTTP 200 with database connected.
- Open the storefront: inspect existing food images, sign up, verify email,
  sign in, save a favorite, add to cart, apply a coupon, and place a test order.
- Check admin delivery details, order pages, and reviews after marking the test
  order delivered. Test an image upload and confirm it survives a backend restart.
- Test direct links and refreshes on `/myorders`, `/verify-email`, and `/info/about`.

Render free backends sleep after 15 minutes without traffic and can take about
a minute to wake. Order-email retries and cleanup timers run only while the
backend is awake. This is a demo setup, not an always-available ordering service.
See [Render free limits](https://render.com/docs/free) and
[Blueprint configuration](https://render.com/docs/blueprint-spec).
