const spirisService = require("./spirisService");
const tokenService = require("./tokenService");
const ghlContactService = require("./ghlContactService");
const spirisCustomerMappingRepo = require("../db/repositories/spirisCustomerMappingRepo");

function splitPrivatePersonName(name) {
  const trimmed = String(name || "").trim();

  if (!trimmed) {
    return {
      firstName: "",
      lastName: ""
    };
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return {
      firstName: parts[0],
      lastName: ""
    };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" ")
  };
}

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
        const isPrivatePerson = !!customer.IsPrivatePerson;

        let created = null;

        if (isPrivatePerson) {
          const personName = splitPrivatePersonName(name);

          created = await ghlContactService.createContact(locationId, {
            firstName: personName.firstName,
            lastName: personName.lastName,
            name,
            email,
            phone,
            address1,
            city,
            postalCode,
            country,
            companyName: ""
          });
        } else {
          created = await ghlContactService.createContact(locationId, {
            firstName: name,
            lastName: "",
            name,
            email,
            phone,
            address1,
            city,
            postalCode,
            country,
            companyName: name
          });
        }

        fellowContactId =
          created.contact?.id ||
          created.contact?._id ||
          null;

        if (!fellowContactId) {
          throw new Error(`Created contact missing id for spirisCustomerId=${spirisCustomerId}`);
        }

        if (!isPrivatePerson) {
          const createdBusiness = await ghlContactService.createBusiness(locationId, {
            name,
            email,
            phone,
            address1,
            city,
            postalCode,
            country
          });

          const businessId =
            createdBusiness.business?.id ||
            createdBusiness.business?._id ||
            createdBusiness.business?.businessId ||
            createdBusiness.response?.id ||
            null;

          if (!businessId) {
            throw new Error(`Created business missing id for spirisCustomerId=${spirisCustomerId}`);
          }

          await ghlContactService.attachContactToBusiness(
            locationId,
            fellowContactId,
            businessId
          );
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
        providerResponse: err.response?.data || null,
        fellowContactId: null
      });

      console.error(
        "[customer-import] failed",
        {
          locationId,
          spirisCustomerId,
          email,
          error: err.message,
          providerResponse: err.response?.data || null
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

async function importAllCustomers({
  locationId,
  pageSize = 50,
  maxPages = 100
}) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const totals = {
    total: 0,
    mapped: 0,
    matched: 0,
    created: 0,
    skipped: 0,
    failed: 0,
    pagesProcessed: 0
  };

  const allResults = [];

  for (let page = 1; page <= maxPages; page++) {
    const result = await importCustomersPage({
      locationId,
      page,
      pageSize
    });

    totals.total += result.stats.total;
    totals.mapped += result.stats.mapped;
    totals.matched += result.stats.matched;
    totals.created += result.stats.created;
    totals.skipped += result.stats.skipped;
    totals.failed += result.stats.failed;
    totals.pagesProcessed += 1;

    allResults.push({
      page,
      stats: result.stats,
      results: result.results
    });

    if (!result.stats.total || result.stats.total < pageSize) {
      break;
    }
  }

  return {
    locationId,
    pageSize,
    maxPages,
    totals,
    pages: allResults
  };
}

module.exports = {
  importCustomersPage,
  importAllCustomers
};