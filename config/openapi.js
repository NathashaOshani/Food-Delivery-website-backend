const jsonBody = (schema) => ({
    required: true,
    content: { "application/json": { schema } },
});

const bearer = [{ bearerAuth: [] }];
const response = (description) => ({ description });

const openapiSpecification = {
    openapi: "3.0.3",
    info: {
        title: "Food API",
        version: "1.0.0",
        description: "Interactive documentation for the Tomato food ordering backend. Register or log in, then use Authorize with the returned JWT.",
    },
    servers: [{ url: "http://localhost:4000", description: "Local development server" }],
    tags: [
        { name: "Food" },
        { name: "Reviews" },
        { name: "Users" },
        { name: "Favorites" },
        { name: "Cart" },
        { name: "Orders" },
        { name: "Coupons" },
        { name: "Admin" },
    ],
    components: {
        securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
        schemas: {
            Credentials: {
                type: "object",
                required: ["email", "password"],
                properties: {
                    email: { type: "string", format: "email", example: "admin@example.com" },
                    password: { type: "string", format: "password", example: "admin123" },
                },
            },
            ItemId: {
                type: "object",
                required: ["itemId"],
                properties: { itemId: { type: "string", example: "507f1f77bcf86cd799439011" } },
            },
            Error: {
                type: "object",
                properties: { success: { type: "boolean", example: false }, message: { type: "string" } },
            },
        },
    },
    paths: {
        "/api/category/list": {
            get: { tags: ["Food"], summary: "List built-in and admin-created menu categories", responses: { 200: response("Category names") } },
        },
        "/api/category/add": {
            post: { tags: ["Admin"], summary: "Add a menu category", security: bearer,
                requestBody: jsonBody({ type: "object", required: ["name"], additionalProperties: false, properties: { name: { type: "string", minLength: 2, maxLength: 50 } } }),
                responses: { 201: response("Category added"), 400: response("Invalid name"), 401: response("Authentication required"), 403: response("Admin required"), 409: response("Duplicate or reserved name") } },
        },
        "/health/live": { get: { summary: "Liveness check", responses: { 200: response("Process is running") } } },
        "/health/ready": { get: { summary: "Readiness check", responses: { 200: response("Database is connected"), 503: response("Database is unavailable") } } },
        "/api/food/list": {
            get: {
                tags: ["Food"], summary: "List, search, filter, sort, and paginate food",
                parameters: [
                    { name: "search", in: "query", schema: { type: "string" } },
                    { name: "category", in: "query", schema: { type: "string" } },
                    { name: "sort", in: "query", schema: { type: "string", enum: ["newest", "name_asc", "price_asc", "price_desc"], default: "newest" } },
                    { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
                    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
                ],
                responses: { 200: response("Food list with pagination metadata"), 400: response("Invalid query parameters") },
            },
        },
        "/api/food/add": {
            post: {
                tags: ["Admin"], summary: "Add a food item", security: bearer,
                requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image", "name", "description", "price", "category"], properties: { image: { type: "string", format: "binary" }, name: { type: "string" }, description: { type: "string" }, price: { type: "number" }, category: { type: "string" }, isAvailable: { type: "boolean", default: true }, stock: { type: "integer", minimum: 0, nullable: true, description: "Null or omitted means unlimited inventory" } } } } } },
                responses: { 201: response("Food added"), 400: response("Invalid input"), 401: response("Not authenticated"), 403: response("Administrator required") },
            },
        },
        "/api/food/remove": {
            post: { tags: ["Admin"], summary: "Remove a food item", security: bearer, requestBody: jsonBody({ type: "object", required: ["id"], properties: { id: { type: "string" } } }), responses: { 200: response("Food removed"), 403: response("Administrator required"), 404: response("Food not found") } },
        },
        "/api/food/{id}": {
            put: {
                tags: ["Admin"], summary: "Update a food item", security: bearer,
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["name", "description", "price", "category"], properties: { image: { type: "string", format: "binary", description: "Optional replacement image" }, name: { type: "string" }, description: { type: "string" }, price: { type: "number" }, category: { type: "string" }, isAvailable: { type: "boolean" }, stock: { type: "integer", minimum: 0, nullable: true, description: "Empty means unlimited inventory" } } } } } },
                responses: { 200: response("Food updated"), 400: response("Invalid input"), 401: response("Not authenticated"), 403: response("Administrator required"), 404: response("Food not found") },
            },
        },
        "/api/food/{id}/reviews": {
            get: { tags: ["Reviews"], summary: "List visible reviews for a food", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 10 } }], responses: { 200: response("Paginated reviews"), 404: response("Food not found") } },
            post: { tags: ["Reviews"], summary: "Review a food from a delivered order", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], requestBody: jsonBody({ type: "object", required: ["rating"], properties: { rating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string", maxLength: 1000 } } }), responses: { 201: response("Review created"), 403: response("No delivered purchase"), 409: response("Food already reviewed by this customer") } },
        },
        "/api/food/{id}/reviews/{reviewId}": {
            put: { tags: ["Reviews"], summary: "Update your review", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "reviewId", in: "path", required: true, schema: { type: "string" } }], requestBody: jsonBody({ type: "object", required: ["rating"], properties: { rating: { type: "integer", minimum: 1, maximum: 5 }, comment: { type: "string", maxLength: 1000 } } }), responses: { 200: response("Review updated"), 404: response("Owned review not found") } },
            delete: { tags: ["Reviews"], summary: "Delete your review", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "reviewId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Review deleted"), 404: response("Owned review not found") } },
        },
        "/api/food/{id}/reviews/{reviewId}/moderate": {
            patch: { tags: ["Reviews", "Admin"], summary: "Show or hide a review", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "reviewId", in: "path", required: true, schema: { type: "string" } }], requestBody: jsonBody({ type: "object", required: ["isVisible"], properties: { isVisible: { type: "boolean" } } }), responses: { 200: response("Visibility updated"), 403: response("Administrator required"), 404: response("Review not found") } },
        },
        "/api/user/register": {
            post: { tags: ["Users"], summary: "Register a user", requestBody: jsonBody({ allOf: [{ $ref: "#/components/schemas/Credentials" }, { type: "object", required: ["name"], properties: { name: { type: "string", example: "Admin User" } } }] }), responses: { 201: response("Registered; returns JWT and user"), 400: response("Invalid input"), 409: response("Email already registered") } },
        },
        "/api/user/login": {
            post: { tags: ["Users"], summary: "Log in", requestBody: jsonBody({ $ref: "#/components/schemas/Credentials" }), responses: { 200: response("Returns JWT and user"), 401: response("Invalid credentials") } },
        },
        "/api/user/verify-email": {
            post: { tags: ["Users"], summary: "Verify an email address", requestBody: jsonBody({ type: "object", required: ["token"], properties: { token: { type: "string", description: "Token from the verification link" } } }), responses: { 200: response("Email verified"), 400: response("Invalid or expired verification link") } },
        },
        "/api/user/resend-verification": {
            post: { tags: ["Users"], summary: "Resend an email verification link", requestBody: jsonBody({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email" } } }), responses: { 200: response("Request accepted"), 400: response("Invalid email"), 503: response("Email delivery unavailable") } },
        },
        "/api/user/forgot-password": {
            post: { tags: ["Users"], summary: "Request a password reset email", requestBody: jsonBody({ type: "object", required: ["email"], properties: { email: { type: "string", format: "email", maxLength: 254 } } }), responses: { 200: response("Request accepted without revealing whether the account exists"), 400: response("Invalid email"), 429: response("Too many requests"), 503: response("Email delivery unavailable") } },
        },
        "/api/user/reset-password": {
            post: { tags: ["Users"], summary: "Reset a password with a single-use token", requestBody: jsonBody({ type: "object", required: ["token", "password"], properties: { token: { type: "string" }, password: { type: "string", format: "password", minLength: 8, maxLength: 72 } } }), responses: { 200: response("Password reset and existing sessions invalidated"), 400: response("Invalid input or expired token"), 429: response("Too many requests") } },
        },
        "/api/user/me": {
            get: { tags: ["Users"], summary: "Get current user", security: bearer, responses: { 200: response("Current user"), 401: response("Not authenticated") } },
        },
        "/api/user/profile": {
            patch: { tags: ["Users"], summary: "Update the current user's profile", security: bearer, requestBody: jsonBody({ type: "object", required: ["name"], properties: { name: { type: "string", minLength: 2, maxLength: 80 } } }), responses: { 200: response("Profile updated"), 400: response("Invalid name"), 401: response("Not authenticated") } },
        },
        "/api/user/addresses": {
            get: { tags: ["Users"], summary: "List saved delivery addresses", security: bearer, responses: { 200: response("Saved addresses") } },
            post: { tags: ["Users"], summary: "Save a delivery address", security: bearer, requestBody: jsonBody({ type: "object", required: ["label", "firstName", "lastName", "email", "street", "city", "state", "zipCode", "country", "phone"], properties: { label: { type: "string", maxLength: 50 }, firstName: { type: "string" }, lastName: { type: "string" }, email: { type: "string", format: "email" }, street: { type: "string" }, city: { type: "string" }, state: { type: "string" }, zipCode: { type: "string" }, country: { type: "string" }, phone: { type: "string" }, isDefault: { type: "boolean" } } }), responses: { 201: response("Address saved"), 400: response("Invalid address or limit reached") } },
        },
        "/api/user/addresses/{id}": {
            put: { tags: ["Users"], summary: "Update a saved address", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Address updated"), 404: response("Address not found") } },
            delete: { tags: ["Users"], summary: "Delete a saved address", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Address deleted"), 404: response("Address not found") } },
        },
        "/api/user/favorites": {
            get: { tags: ["Favorites"], summary: "List the current user's favorite foods", security: bearer, parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 12 } }], responses: { 200: response("Paginated favorite foods"), 401: response("Not authenticated") } },
        },
        "/api/user/favorites/{foodId}": {
            post: { tags: ["Favorites"], summary: "Add a food to favorites", security: bearer, parameters: [{ name: "foodId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Favorite added or already present"), 404: response("Food not found") } },
            delete: { tags: ["Favorites"], summary: "Remove a food from favorites", security: bearer, parameters: [{ name: "foodId", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Favorite removed or already absent") } },
        },
        "/api/cart/add": {
            post: { tags: ["Cart"], summary: "Add a quantity of a food to the cart", security: bearer, requestBody: jsonBody({ type: "object", required: ["itemId"], additionalProperties: false, properties: { itemId: { type: "string" }, quantity: { type: "integer", minimum: 1, maximum: 99, default: 1 } } }), responses: { 200: response("Updated cart"), 400: response("Invalid quantity or cart limit exceeded"), 409: response("Insufficient stock") } },
        },
        "/api/cart/remove": {
            post: { tags: ["Cart"], summary: "Decrement a cart item", security: bearer, requestBody: jsonBody({ $ref: "#/components/schemas/ItemId" }), responses: { 200: response("Updated cart") } },
        },
        "/api/cart/clear-item": {
            post: { tags: ["Cart"], summary: "Remove every unit of a cart item", security: bearer, requestBody: jsonBody({ $ref: "#/components/schemas/ItemId" }), responses: { 200: response("Updated cart") } },
        },
        "/api/cart/get": {
            post: { tags: ["Cart"], summary: "Get the current cart", security: bearer, responses: { 200: response("Cart contents") } },
        },
        "/api/order/config": {
            get: { tags: ["Orders"], summary: "Get delivery and payment configuration", responses: { 200: response("Order configuration") } },
        },
        "/api/order/place": {
            post: {
                tags: ["Orders"], summary: "Place an order", security: bearer,
                parameters: [{ name: "Idempotency-Key", in: "header", required: false, description: "Recommended unique checkout key; retries return the original order", schema: { type: "string", minLength: 8, maxLength: 128 } }],
                requestBody: jsonBody({
                    type: "object",
                    required: ["items", "address"],
                    properties: {
                        items: {
                            type: "array",
                            items: {
                                type: "object",
                                required: ["itemId", "quantity"],
                                properties: {
                                    itemId: { type: "string" },
                                    quantity: { type: "integer", minimum: 1, maximum: 99 },
                                },
                            },
                        },
                        address: {
                            type: "object",
                            required: ["firstName", "lastName", "email", "street", "city", "state", "zipCode", "country", "phone"],
                            properties: {
                                firstName: { type: "string" }, lastName: { type: "string" },
                                email: { type: "string", format: "email" }, street: { type: "string" },
                                city: { type: "string" }, state: { type: "string" }, zipCode: { type: "string" },
                                country: { type: "string" }, phone: { type: "string" },
                            },
                        },
                        couponCode: { type: "string", example: "SAVE10", description: "Optional active coupon code" },
                    },
                }),
                responses: { 200: response("Existing idempotent order returned"), 201: response("Order created and counted inventory reserved"), 400: response("Invalid order, unavailable item, or insufficient stock"), 409: response("Idempotency key conflict") },
            },
        },
        "/api/order/verify": {
            post: { tags: ["Orders"], summary: "Verify Stripe payment", security: bearer, requestBody: jsonBody({ type: "object", required: ["orderId"], properties: { orderId: { type: "string" } } }), responses: { 200: response("Payment result") } },
        },
        "/api/order/webhook": {
            post: { tags: ["Orders"], summary: "Receive signed Stripe Checkout events", description: "Called by Stripe with a raw JSON body and Stripe-Signature header.", responses: { 200: response("Event received"), 400: response("Invalid signature or event"), 503: response("Webhook not configured") } },
        },
        "/api/order/userorders": {
            get: { tags: ["Orders"], summary: "List the current user's orders", security: bearer, parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }], responses: { 200: response("Paginated order list") } },
            post: { tags: ["Orders"], summary: "List the current user's orders (legacy)", security: bearer, responses: { 200: response("Order list") } },
        },
        "/api/order/list": {
            get: { tags: ["Admin"], summary: "List every order", security: bearer, parameters: [{ name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } }, { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } }], responses: { 200: response("Paginated order list"), 403: response("Administrator required") } },
        },
        "/api/order/status": {
            post: { tags: ["Admin"], summary: "Update an order status", security: bearer, requestBody: jsonBody({ type: "object", required: ["orderId", "status"], properties: { orderId: { type: "string" }, status: { type: "string", enum: ["Food Processing", "Out for delivery", "Delivered", "Cancelled"] } } }), responses: { 200: response("Status updated"), 403: response("Administrator required") } },
        },
        "/api/order/{id}/cancel": {
            patch: {
                tags: ["Orders"], summary: "Cancel the current user's order", security: bearer,
                description: "Food Processing orders can be cancelled. Paid Stripe orders start a full idempotent refund and expose refundStatus on the order.",
                parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
                responses: { 200: response("Order cancelled; refund state included when applicable"), 400: response("Invalid order id"), 401: response("Not authenticated"), 404: response("Order not found"), 409: response("Order cannot be cancelled"), 502: response("Stripe refund could not be started"), 503: response("Stripe is not configured") },
            },
        },
        "/api/coupon/validate": {
            post: { tags: ["Coupons"], summary: "Preview a coupon discount", security: bearer, requestBody: jsonBody({ type: "object", required: ["code", "subtotal"], properties: { code: { type: "string" }, subtotal: { type: "number", minimum: 0 } } }), responses: { 200: response("Discount preview"), 400: response("Invalid or ineligible coupon"), 409: response("Usage limit reached") } },
        },
        "/api/coupon": {
            get: { tags: ["Coupons", "Admin"], summary: "List coupons", security: bearer, responses: { 200: response("Coupon list"), 403: response("Administrator required") } },
            post: { tags: ["Coupons", "Admin"], summary: "Create a coupon", security: bearer, requestBody: jsonBody({ type: "object", required: ["code", "type", "value", "expiresAt"], properties: { code: { type: "string" }, description: { type: "string" }, type: { type: "string", enum: ["percentage", "fixed"] }, value: { type: "number" }, minimumOrder: { type: "number" }, startsAt: { type: "string", format: "date-time" }, expiresAt: { type: "string", format: "date-time" }, usageLimit: { type: "integer", nullable: true }, perCustomerLimit: { type: "integer", default: 1 }, isActive: { type: "boolean", default: true } } }), responses: { 201: response("Coupon created"), 400: response("Invalid coupon"), 409: response("Code already exists") } },
        },
        "/api/coupon/{id}": {
            put: { tags: ["Coupons", "Admin"], summary: "Update a coupon", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Coupon updated"), 404: response("Coupon not found") } },
            delete: { tags: ["Coupons", "Admin"], summary: "Delete a coupon", security: bearer, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { 200: response("Coupon deleted"), 404: response("Coupon not found") } },
        },
    },
};

export default openapiSpecification;
