const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const ghlContactService = require("./ghlContactService");
const spirisCustomerMappingRepo = require("../db/repositories/spirisCustomerMappingRepo");

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
    mapped: 0,
    matched: 0,
    created: 0,
    skipped: 0,
    failed: 0
  };

  const results = [];

  for (const customer of customers) {
    const spirisCustomerId = customer.Id;
    const email = customer.EmailAddress || customer.Email || null;
    const phone = customer.Phone || customer.MobilePhone || "";
    const name = customer.Name || "";
    const address1 = customer.InvoiceAddress1 || customer.Address1 || "";
    const city = customer.InvoiceCity || customer.City || "";
    const postalCode = customer.InvoicePostalCode || customer.PostalCode || "";
    const country = customer.InvoiceCountryCode || customer.CountryCode || "SE";

    try {
      const existingMapping = await spirisCustomerMappingRepo.getBySpirisCustomerId(
        locationId,
        spirisCustomerId
      );

      if (existingMapping) {
        stats.mapped++;

        results.push({
          spirisCustomerId,
          name,
          email,
          status: "mapped",
          fellowContactId: existingMapping.fellowContactId
        });

        continue;
      }

      let contact = null;
      let status = null;
      let fellowContactId = null;

      if (email) {
        contact = await ghlContactService.findContactByEmail(locationId, email);
      }

      if (contact) {
        fellowContactId = contact.id || contact._id || null;

        if (!fellowContactId) {
          throw new Error(`Matched contact missing id for email=${email}`);
        }

        await spirisCustomerMappingRepo.createMapping({
          locationId,
          spirisCustomerId,
          fellowContactId
        });

        stats.matched++;
        status = "matched";
      } else {
        const created = await ghlContactService.createContact(locationId, {
          name,
          email,
          phone,
          address1,
          city,
          postalCode,
          country,
          companyName: customer.IsPrivatePerson ? "" : name
        });

        fellowContactId =
          created.contact?.id ||
          created.contact?._id ||
          null;

        if (!fellowContactId) {
          throw new Error(`Created contact missing id for spirisCustomerId=${spirisCustomerId}`);
        }

        await spirisCustomerMappingRepo.createMapping({
          locationId,
          spirisCustomerId,
          fellowContactId
        });

        stats.created++;
        status = "created";
      }

      results.push({
        spirisCustomerId,
        name,
        email,
        status,
        fellowContactId
      });
    } catch (err) {
      stats.failed++;

      results.push({
        spirisCustomerId,
        name,
        email,
        status: "failed",
        error: err.message,
        fellowContactId: null
      });

      console.error(
        "[customer-import] failed",
        {
          locationId,
          spirisCustomerId,
          email,
          error: err.message
        }
      );
    }
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