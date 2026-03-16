const spirisService = require("./spirisService");

function normalizePriceListName(name) {
  return String(name || "").trim();
}

function mapSpirisPriceEntryToFellowPriceName(priceList) {
  if (priceList?.IsStandard === true) {
    return "Standardpris";
  }

  return normalizePriceListName(priceList?.Name) || "Prislista";
}

function mapSpirisPriceEntryAmount(priceEntry) {
  if (priceEntry?.NetPrice != null) {
    return Number(priceEntry.NetPrice);
  }

  if (priceEntry?.GrossPrice != null) {
    return Number(priceEntry.GrossPrice);
  }

  return 0;
}

function isActivePriceList(priceList) {
  return priceList?.IsActive === true;
}

function buildPriceListIndex(priceLists) {
  const index = new Map();

  for (const priceList of priceLists || []) {
    if (!priceList?.Id) {
      continue;
    }

    index.set(String(priceList.Id), priceList);
  }

  return index;
}

function getPricesForArticleFromPriceEntries({
  articleId,
  salesPriceLists,
  salesPriceListPrices
}) {
  if (!articleId) {
    throw new Error("articleId is required");
  }

  const priceLists = Array.isArray(salesPriceLists?.Data)
    ? salesPriceLists.Data
    : [];

  const priceEntries = Array.isArray(salesPriceListPrices?.Data)
    ? salesPriceListPrices.Data
    : [];

  const priceListIndex = buildPriceListIndex(priceLists);

  const matchingEntries = priceEntries.filter((entry) => {
    return String(entry?.ArticleId || "") === String(articleId);
  });

  const results = [];

  for (const entry of matchingEntries) {
    const salesPriceListId = String(entry?.SalesPriceListId || "");
    const priceList = priceListIndex.get(salesPriceListId);

    if (!priceList) {
      continue;
    }

    if (!isActivePriceList(priceList)) {
      continue;
    }

    results.push({
      salesPriceListId,
      spirisArticleId: String(entry.ArticleId),
      fellowPriceName: mapSpirisPriceEntryToFellowPriceName(priceList),
      amount: mapSpirisPriceEntryAmount(entry),
      currency: entry?.CurrencyCode || priceList?.CurrencyCode || "SEK",
      isStandard: priceList?.IsStandard === true,
      source: {
        priceListName: priceList?.Name || null,
        priceListNumber: priceList?.Number || null,
        netPrice: entry?.NetPrice ?? null,
        grossPrice: entry?.GrossPrice ?? null,
        changedUtc: entry?.ChangedUtc || null
      }
    });
  }

  results.sort((a, b) => {
    if (a.isStandard && !b.isStandard) return -1;
    if (!a.isStandard && b.isStandard) return 1;
    return a.fellowPriceName.localeCompare(b.fellowPriceName, "sv");
  });

  const deduped = [];
  const seenNames = new Set();

  for (const row of results) {
    const key = row.fellowPriceName;

    if (seenNames.has(key)) {
      continue;
    }

    seenNames.add(key);
    deduped.push(row);
  }

  return deduped;
}

async function getResolvedPricesForArticle({
  accessToken,
  articleId
}) {
  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  if (!articleId) {
    throw new Error("articleId is required");
  }

  const salesPriceLists = await spirisService.getSalesPriceLists(accessToken);
  const salesPriceListPrices = await spirisService.getSalesPriceListPrices(accessToken);

  const prices = getPricesForArticleFromPriceEntries({
    articleId,
    salesPriceLists,
    salesPriceListPrices
  });

  return {
    salesPriceLists,
    salesPriceListPrices,
    prices
  };
}

module.exports = {
  normalizePriceListName,
  mapSpirisPriceEntryToFellowPriceName,
  mapSpirisPriceEntryAmount,
  getPricesForArticleFromPriceEntries,
  getResolvedPricesForArticle
};