# Food API

Express and MongoDB backend for the Tomato React storefront.

## Setup

1. Copy `.env.example` to `.env` and set a long random `JWT_SECRET`. `DB_MODE=local` uses `data/local-db.json` for zero-setup development. For production, remove `DB_MODE` and set `MONGODB_URI` to MongoDB or Atlas.
2. Run `npm install` and `npm run server`.
3. Register a user, then promote an administrator when needed:
   `npm run make-admin -- user@example.com`
4. Populate an empty development catalog with the included food images: `npm run seed`.

Google sign-in requires a Web OAuth client ID from Google Cloud Console. Set the same
client ID in the backend as `GOOGLE_CLIENT_ID` and in the frontend as
`VITE_GOOGLE_CLIENT_ID`, then add your site's origin (for local development,
`http://localhost:5173`) to the client's authorized JavaScript origins. The backend
validates each Google ID token before creating or signing in a user.

For reliable Stripe fulfillment, set `STRIPE_WEBHOOK_SECRET` and register
`POST /api/order/webhook` for `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
and `checkout.session.expired`.
For refund reconciliation, also enable `refund.created`, `refund.updated`,
`refund.failed`, and `charge.refunded` on the same signed webhook endpoint.

When Resend is configured, customers receive deduplicated emails for order
creation, payment confirmation, status changes, cancellation, and refund state
changes. Provider failures are logged and never roll back the order operation.

To require email verification for new registrations, set `RESEND_API_KEY` and
`EMAIL_FROM` to a verified sender (for example, `Food <orders@yourdomain.com>`).
Verification links use the first origin in `CLIENT_URL` and expire after 24 hours.
If email is not configured, local registrations remain immediately usable.

The API validates request shapes, field lengths, identifiers, supported food
categories, image file signatures, checkout data, and environment settings.
Foods support `isAvailable` and optional integer `stock` fields. Empty/omitted
stock means unlimited inventory. Counted stock is reserved when an order is
created and restored once when an unpaid order expires or an eligible order is
cancelled.
Authentication and verification routes are rate limited in memory. Deployments
running multiple backend instances should replace this limiter with a shared
store such as Redis.

Clients should send a unique `Idempotency-Key` header (8-128 safe ASCII
characters) when placing an order. Retrying with the same key and payload returns
the original order without reserving inventory or creating another Stripe
session. Reusing a key for different checkout data returns `409`.

Unpaid Stripe orders are checked periodically after `UNPAID_ORDER_TTL_MINUTES`.
The API confirms or expires the Checkout Session at Stripe before changing the
local order and restoring inventory. Configure the frequency with
`ORDER_CLEANUP_INTERVAL_MINUTES`.

`GET /health/live` reports process liveness and `GET /health/ready` reports
database readiness. HTTP request logs are emitted as structured JSON with a
request ID, status, and duration. A caller-provided `X-Request-Id` is echoed.

The API runs at `http://localhost:4000` by default. Uploaded food images are served from `/uploads/<filename>`. Stripe Checkout is enabled only when `STRIPE_SECRET_KEY` is configured; otherwise an order is placed without online payment.

Interactive Swagger documentation is available at `http://localhost:4000/api-docs` while the server is running. The raw OpenAPI document is available at `/api-docs.json`.

Send authenticated requests with `Authorization: Bearer <token>`. The legacy `token` header is also accepted.

## Database collections

MongoDB stores this application's data in six collections:

| Collection | Features stored |
|---|---|
| `users` | Login, admin roles, email verification, password reset tokens, profile, cart, saved addresses, favorites |
| `foods` | Catalog, categories, prices, image filenames, availability, inventory, rating summaries |
| `orders` | Order items, delivery address snapshot, totals, status, payments, refunds, coupon snapshot, notification history |
| `coupons` | Discount rules, validity dates, usage limits, redemptions |
| `reviews` | Customer ratings, comments, purchase references, moderation |
| `categories` | Admin-created menu category names; the original eight categories remain built in |

Admins can add categories from **Admin Dashboard → Menu categories**. Names must
be 2–50 characters and unique without regard to case; `All` is reserved for filtering.
New categories appear in the food dropdown and customer menu, even before foods
are added. Their first food image is used as the menu thumbnail when available.
The public `GET /api/category/list` endpoint lists categories; admin-only
`POST /api/category/add` accepts JSON such as `{ "name": "Pizza" }`.

Run `npm run db:audit` to check the database selected by `MONGODB_URI`.
The read-only audit checks collection existence, schema-defined indexes, and
existing documents against Mongoose validation (including model defaults and
casting). It prints counts and invalid field names, never account values, and
exits nonzero when it finds issues. It does not check reference integrity,
external services, or every application-level business rule.
Empty coupons or reviews collections are normal until those features are used.
Email and Stripe delivery still require their environment configuration.

## API endpoints

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| GET | `/api/food/list` | Public | List foods |
| POST | `/api/food/add` | Admin | Add multipart food; optional `isAvailable` and `stock` control inventory |
| POST | `/api/food/remove` | Admin | Remove food using `{ "id": "..." }` |
| GET | `/api/food/:id/reviews` | Public | List visible, paginated food reviews |
| POST | `/api/food/:id/reviews` | User | Review a food from a delivered order |
| PUT/DELETE | `/api/food/:id/reviews/:reviewId` | User | Edit or delete an owned review |
| PATCH | `/api/food/:id/reviews/:reviewId/moderate` | Admin | Show or hide a review |
| POST | `/api/user/register` | Public | Register using `name`, `email`, `password` |
| POST | `/api/user/login` | Public | Login using `email`, `password` |
| POST | `/api/user/verify-email` | Public | Verify the token received by email |
| POST | `/api/user/resend-verification` | Public | Resend verification using `email` |
| POST | `/api/user/forgot-password` | Public | Send a single-use password reset link |
| POST | `/api/user/reset-password` | Public | Reset password using `token`, `password` |
| PATCH | `/api/user/profile` | User | Update the current user's name |
| GET/POST | `/api/user/addresses` | User | List or create saved delivery addresses |
| PUT/DELETE | `/api/user/addresses/:id` | User | Update or delete an owned address |
| GET | `/api/user/favorites` | User | List paginated favorite foods |
| POST/DELETE | `/api/user/favorites/:foodId` | User | Add or remove a favorite |
| POST | `/api/cart/add` | User | Increment `{ "itemId": "..." }` |
| POST | `/api/cart/remove` | User | Decrement `{ "itemId": "..." }` |
| POST | `/api/cart/get` | User | Retrieve persistent cart |
| POST | `/api/order/place` | User | Idempotently place an order using `items` and `address` |
| POST | `/api/order/verify` | User | Verify/cancel Stripe result |
| POST | `/api/order/webhook` | Stripe signature | Process Stripe Checkout events |
| GET/POST | `/api/order/userorders` | User | List the current user's orders; `page`/`limit` supported |
| GET | `/api/order/list` | Admin | List orders using `page`/`limit` |
| POST | `/api/order/status` | Admin | Update `orderId` and `status` |

Order items accept `{ "itemId": "food-id", "quantity": 2 }`. Prices and totals are always recalculated from MongoDB rather than trusted from the client.

## Sizes and priced options

In **Admin Dashboard > Add food / Edit food > Sizes / options**, add option
names and prices (for example Small, Medium, and Large). Leave options empty
for a food with one price. Customers see every option and its price on the food
details page and must choose one before adding it to the cart. Menu cards show
the lowest price with a "From" label and link to the option selector.

Food create/update requests accept a multipart `variants` field containing a
JSON array, such as `[{"name":"Small","price":8.99},{"name":"Large","price":16.99}]`.
Up to 12 uniquely named options are allowed. The API assigns stable `id` values;
include these when editing existing options. Omitting `variants` preserves
existing options, while `[]` removes them and requires a regular `price`.
For foods with options, the catalog `price` is the lowest option price.

Birthday Cake has Blue Teddy, Pink Teddy, Strawberry, and Chocolate Drip design
cards in the admin editor. Set sizes and prices separately for each design;
customers can then select quantities across designs and sizes in one order.
Food create/update accepts a multipart `designOptions` JSON array with all four
design IDs and each design's own `variants`. Each design needs at least one
size. Send its `designId` (`blue-teddy`,
`pink-teddy`, `strawberry`, or `chocolate-drip`) with each Birthday Cake cart or
checkout item. The selected design and size appear on its cart line and order
snapshot, with prices taken from that design's options.

Send `variantId` alongside `itemId` when adding, decrementing, or clearing an
option in the cart, and in each checkout item. Birthday Cake cart quantities
also include the design ID (`foodId:variantId:designId`); ordinary foods retain
their original keys. Different sizes and designs remain separate lines.
Checkout validates the choice and uses its current saved price. Orders snapshot
the option id, name, and price, so later menu edits do not change order history.
Stock is shared across all sizes and designs of a food.

## Coupons

Administrators can create fixed or percentage coupons with activation dates,
expiry dates, minimum order values, global usage limits, per-customer limits,
and an active switch. Customers can preview eligibility with
`POST /api/coupon/validate`, then include `couponCode` in `/api/order/place`.
The server calculates and snapshots the discount; client totals are never
trusted. Stripe receives the exact discounted subtotal plus delivery fee.
Cancelled, expired, and refunded orders release their coupon redemption once.

## Ratings and reviews

Customers may submit one 1-5 star review per food after that food appears in one
of their delivered orders. Reviews support an optional 1000-character comment,
editing, and deletion. Public review pages are paginated. Administrators can
hide or restore reviews, and hidden reviews do not contribute to `ratingAverage`
or `ratingCount` on food responses. Removing a food also removes its reviews.

## Favorites

Authenticated customers can save foods with idempotent add and remove
operations. `GET /api/user/favorites` returns food records in saved order with
`page` and `limit` metadata. Missing food references are repaired when favorites
are read, and deleting a food removes it from every customer's favorites.

| Method | Endpoint | Authentication | Purpose |
|---|---|---|---|
| POST | `/api/coupon/validate` | User | Preview eligibility and discount |
| GET | `/api/coupon` | Admin | List coupons and redemption counts |
| POST | `/api/coupon` | Admin | Create a coupon |
| PUT | `/api/coupon/:id` | Admin | Update a coupon |
| DELETE | `/api/coupon/:id` | Admin | Delete a coupon |

Run `npm test` for the zero-setup local integration suite. To exercise the real
MongoDB models, point `MONGODB_TEST_URI` at a disposable database whose name
contains `test`, then run `npm run test:mongo`. That suite drops the named test
database when it finishes.
