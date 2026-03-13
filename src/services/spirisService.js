const axios = require("axios");
const env = require("../config/env");

function getAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json"
  };
}

function escapeODataString(value) {
  return String(value).replace(/'/g, "''");
}

async function getCompanySettings(accessToken) {
  const response = await axios.get(
    `${env.spirisApiBase}/v2/CompanySettings`,
    {
      headers: getAuthHeaders(accessToken)
    }
  );

  return response.data;
}

async function getArticlesPage(accessToken, page = 1, pageSize = 50) {
  const response = await axios.get(
    `${env.spirisApiBase}/v2/articles`,
    {
      headers: getAuthHeaders(accessToken),
      params: {
        $page: page,
        $pagesize: pageSize
      }
    }
  );

  return response.data;
}

async function findArticleByNumber(accessToken, articleNumber) {
  const escaped = escapeODataString(articleNumber);

  const url =
    `${env.spirisApiBase}/v2/articles` +
    `?$filter=${encodeURIComponent(`Number eq '${escaped}'`)}`;

  const response = await axios.get(url, {
    headers: getAuthHeaders(accessToken)
  });

  return response.data;
}

async function findCustomerByOrgNumber(accessToken, orgNumber) {
  const escaped = escapeODataString(orgNumber);

  const url =
    `${env.spirisApiBase}/v2/customers` +
    `?$filter=${encodeURIComponent(`CorporateIdentityNumber eq '${escaped}'`)}`;

  const response = await axios.get(url, {
    headers: getAuthHeaders(accessToken)
  });

  return response.data;
}

async function findCustomerByEmail(accessToken, email) {
  const escaped = escapeODataString(email);

  const url =
    `${env.spirisApiBase}/v2/customers` +
    `?$filter=${encodeURIComponent(`EmailAddress eq '${escaped}'`)}`;

  const response = await axios.get(url, {
    headers: getAuthHeaders(accessToken)
  });

  return response.data;
}

async function createCustomer(accessToken, payload) {
  const response = await axios.post(
    `${env.spirisApiBase}/v2/customers`,
    payload,
    {
      headers: getAuthHeaders(accessToken)
    }
  );

  return response.data;
}

async function createInvoiceDraft(accessToken, payload) {
  const response = await axios.post(
    `${env.spirisApiBase}/v2/customerinvoicedrafts`,
    payload,
    {
      headers: getAuthHeaders(accessToken)
    }
  );

  return response.data;
}

module.exports = {
  getCompanySettings,
  getArticlesPage,
  findArticleByNumber,
  findCustomerByOrgNumber,
  findCustomerByEmail,
  createCustomer,
  createInvoiceDraft
};