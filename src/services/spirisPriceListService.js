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

function sortAndDeduplicateResolvedPrices(prices) {
  const sorted = [...prices].sort((a, b) => {
    if (a.isStandard && !b.isStandard) return -1;
    if (!a.isStandard && b.isStandard) return 1;
    return a.fellowPriceName.localeCompare(b.fellowPriceName, "sv");
  });

  const deduped = [];
  const seenNames = new Set();

  for (const row of sorted) {
    const key = row.fellowPriceName;

    if (seenNames.has(key)) {
      continue;
    }

    seenNames.add(key);
    deduped.push(row);
  }

  return deduped;
}

function mapResolvedPrice({
  priceList,
  priceEntry
}) {
  return {
    salesPriceListId: String(priceList.Id),
    spirisArticleId: String(priceEntry.ArticleId),
    fellowPriceName: mapSpirisPriceEntryToFellowPriceName(priceList),
    amount: mapSpirisPriceEntryAmount(priceEntry),
    currency: priceEntry?.CurrencyCode || priceList?.CurrencyCode || "SEK",
    isStandard: priceList?.IsStandard === true,
    source: {
      priceListName: priceList?.Name || null,
      priceListNumber: priceList?.Number || null,
      netPrice: priceEntry?.NetPrice ?? null,
      grossPrice: priceEntry?.GrossPrice ?? null,
      changedUtc: priceEntry?.ChangedUtc || null
    }
  };
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

  const priceLists = Array.isArray(salesPriceLists?.Data)
    ? salesPriceLists.Data
    : [];

  const activePriceLists = priceLists.filter((priceList) => {
    return isActivePriceList(priceList);
  });

  const resolvedPrices = [];

  for (const priceList of activePriceLists) {
    try {
      const priceEntry = await spirisService.getSalesPriceForArticleInPriceList(
        accessToken,
        priceList.Id,
        articleId
      );

      if (!priceEntry?.ArticleId || !priceEntry?.SalesPriceListId) {
        continue;
      }

      resolvedPrices.push(
        mapResolvedPrice({
          priceList,
          priceEntry
        })
      );
    } catch (err) {
      const status = err?.response?.status;

      if (status === 404) {
        continue;
      }

      throw err;
    }
  }

  return {
    salesPriceLists,
    prices: sortAndDeduplicateResolvedPrices(resolvedPrices)
  };
}

module.exports = {
  normalizePriceListName,
  mapSpirisPriceEntryToFellowPriceName,
  mapSpirisPriceEntryAmount,
  getResolvedPricesForArticle
};