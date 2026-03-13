const spirisService = require("./spirisService");
const articleStore = require("./articleStore");
const articleCache = require("./articleCache");

function mapSpirisArticleToLocalArticle(spirisArticle) {
  return {
    spirisArticleId: spirisArticle.Id,
    articleNumber: spirisArticle.Number,
    name: spirisArticle.Name || null,
    unitPrice:
      spirisArticle.NetPrice != null
        ? spirisArticle.NetPrice
        : spirisArticle.GrossPrice != null
          ? spirisArticle.GrossPrice
          : null,
    changedUtc: spirisArticle.ChangedUtc || null,
    raw: spirisArticle
  };
}

async function syncArticlesForLocation({ locationId, accessToken, pageSize = 50 }) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!accessToken) {
    throw new Error("accessToken is required");
  }

  const firstPage = await spirisService.getArticlesPage(accessToken, 1, pageSize);

  if (!firstPage || !Array.isArray(firstPage.Data)) {
    throw new Error("Invalid Spiris articles response on page 1");
  }

  const totalPages = Number(firstPage.Meta?.TotalNumberOfPages || 1);
  let syncedCount = 0;

  for (const spirisArticle of firstPage.Data) {
    if (!spirisArticle?.Id || !spirisArticle?.Number) {
      continue;
    }

    const mappedArticle = mapSpirisArticleToLocalArticle(spirisArticle);

    await articleStore.upsertArticle(locationId, mappedArticle);
    articleCache.set(locationId, mappedArticle.articleNumber, mappedArticle);

    syncedCount += 1;
  }

  if (totalPages > 1) {
    for (let page = 2; page <= totalPages; page += 1) {
      const pageResponse = await spirisService.getArticlesPage(accessToken, page, pageSize);

      if (!pageResponse || !Array.isArray(pageResponse.Data)) {
        throw new Error(`Invalid Spiris articles response on page ${page}`);
      }

      for (const spirisArticle of pageResponse.Data) {
        if (!spirisArticle?.Id || !spirisArticle?.Number) {
          continue;
        }

        const mappedArticle = mapSpirisArticleToLocalArticle(spirisArticle);

        await articleStore.upsertArticle(locationId, mappedArticle);
        articleCache.set(locationId, mappedArticle.articleNumber, mappedArticle);

        syncedCount += 1;
      }
    }
  }

  return {
    ok: true,
    locationId,
    totalPages,
    syncedCount
  };
}

module.exports = {
  syncArticlesForLocation
};