const express = require("express");

const healthRoute = require("./routes/health");
const oauthRoutes = require("./routes/oauth");
const adminRoutes = require("./routes/admin");
const webhookRoutes = require("./routes/webhooks");
const api2Routes = require("./routes/api2");

const app = express();

app.use(express.json());

app.use("/health", healthRoute);
app.use("/oauth", oauthRoutes);
app.use("/admin", adminRoutes);
app.use("/api2/admin", adminRoutes);
app.use("/webhooks", webhookRoutes);
app.use("/api2", api2Routes);
app.use("/api2/webhooks", webhookRoutes);

module.exports = app;