const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const ghlContactService = require("./ghlContactService");

async function importCustomersPage({
  locationId,
  page = 1,
  pageSize = 50
}) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const accessToken = await tokenService.getAccessTokenForLocation(locationId);

  const spirisResult = await spirisService.getCustomersPage(
    accessToken,
    page,
    pageSize
  );

  const customers = spirisResult?.Data || spirisResult?.data || [];

  const stats = {
    total: customers.length,
    matched: 0,
    notMatched: 0
  };

  const results = [];

  for (const customer of customers) {
    const email =
      customer.EmailAddress ||
      customer.Email ||
      null;

    let contact = null;

    if (email) {
      try {
        contact = await ghlContactService.findContactByEmail(
          locationId,
          email
        );
      } catch (err) {
        console.error(
          "[customer-import] contact lookup failed",
          email,
          err.message
        );
      }
    }

    if (contact) {
      stats.matched++;
    } else {
      stats.notMatched++;
    }

    results.push({
      spirisCustomerId: customer.Id,
      name: customer.Name,
      email,
      matched: !!contact,
      fellowContactId: contact?.id || null
    });
  }

  return {
    page,
    pageSize,
    stats,
    results
  };
}

module.exports = {
  importCustomersPage
};