const spirisService = require("./spirisService");

function normalizeOrgNumber(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

async function resolveExistingCustomer({
  accessToken,
  customerType,
  orgNumber,
  email
}) {
  
  if (customerType === "b2b" && orgNumber) {
    const result = await spirisService.findCustomerByOrgNumber(
      accessToken,
      normalizeOrgNumber(orgNumber)
    );

    if (result?.Data?.length) {
      return result.Data[0];
    }
  }

  if (email) {
    const result = await spirisService.findCustomerByEmail(
      accessToken,
      email
    );

    if (result?.Data?.length) {
      return result.Data[0];
    }
  }

  return null;
}

function buildB2BCustomerPayload({
  name,
  orgNumber,
  email,
  address1,
  postalCode,
  city,
  countryCode,
  termsOfPaymentId
}) {
  return {
    Name: name,
    CorporateIdentityNumber: normalizeOrgNumber(orgNumber),
    EmailAddress: email || "",
    InvoiceAddress1: address1 || "",
    InvoicePostalCode: postalCode || "",
    InvoiceCity: city || "",
    InvoiceCountryCode: countryCode || "SE",
    IsPrivatePerson: false,
    TermsOfPaymentId: termsOfPaymentId
  };
}

function buildB2CCustomerPayload({
  name,
  email,
  address1,
  postalCode,
  city,
  countryCode,
  termsOfPaymentId
}) {
  return {
    Name: name,
    EmailAddress: email || "",
    InvoiceAddress1: address1 || "",
    InvoicePostalCode: postalCode || "",
    InvoiceCity: city || "",
    InvoiceCountryCode: countryCode || "SE",
    IsPrivatePerson: true,
    TermsOfPaymentId: termsOfPaymentId
  };
}

module.exports = {
  resolveExistingCustomer,
  buildB2BCustomerPayload,
  buildB2CCustomerPayload
};