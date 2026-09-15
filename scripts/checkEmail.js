import "dotenv/config";
import { validateEnvironment } from "../config/env.js";
import { verifyEmailConnection } from "../config/email.js";

try {
    validateEnvironment();
    await verifyEmailConnection();
    console.log(`${process.env.EMAIL_PROVIDER === "brevo" ? "Brevo API authentication and sender verification" : "Gmail SMTP connection and authentication"} succeeded. No email was sent.`);
} catch (error) {
    console.error("Email check failed:", error.code || "CONFIGURATION_ERROR");
    if (error.code === "EAUTH") console.error("Check GMAIL_USER and your Google App Password. A normal Google password will not work.");
    else if (error.code) console.error("Check network access to smtp.gmail.com:465 and your Gmail account settings.");
    else console.error(error.message);
    process.exitCode = 1;
}
