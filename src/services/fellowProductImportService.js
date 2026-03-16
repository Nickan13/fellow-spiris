const articleStore = require("./articleStore");
const ghlProductService = require("./ghlProductService");
const fellowProductMappingRepo = require("../db/repositories/fellowProductMappingRepo");

function isImportableSpirisArticle(article) {
  const raw = article?.raw || {};

  const isActive = raw.IsActive === true;

  const codingName = String(raw.CodingName || "").trim().toLowerCase();
  const articleName = String(raw.Name || article?.name || "").trim().toLowerCase();

  const isAccountingArticle =
    articleName === "ränta" ||
    codingName === "ränta";

  return (
    isActive &&
    !isAccountingArticle
  );
}

function mapSpirisArticleToFellowProductType(article) {
  return article?.raw?.IsStock === true ? "PHYSICAL" : "DIGITAL";
}

async function importProductsForLocation({
  locationId,
  limit = 10,
  articleFetchLimit = 1000
}) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.min(Number(limit), 100)
    : 10;

  const normalizedArticleFetchLimit =
    Number.isFinite(Number(articleFetchLimit)) && Number(articleFetchLimit) > 0
      ? Math.min(Number(articleFetchLimit), 5000)
      : 1000;

  const articles = await articleStore.listArticlesByLocation(
    locationId,
    normalizedArticleFetchLimit
  );

  const importableArticles = (articles || [])
    .filter((article) => {
      return isImportableSpirisArticle(article);
    })
    .slice(0, normalizedLimit);

  if (importableArticles.length === 0) {
    return {
      locationId,
      total: 0,
      created: 0,
      skippedAlreadyMapped: 0,
      failed: 0,
      results: []
    };
  }

  const results = [];
  let created = 0;
  let skippedAlreadyMapped = 0;
  let failed = 0;

  for (const article of importableArticles) {
    const spirisArticleNumber = article.articleNumber || null;
    const articleName = article.name || spirisArticleNumber || "Unnamed article";

    if (!spirisArticleNumber) {
      failed += 1;
      results.push({
        status: "failed",
        articleName,
        error: "Article is missing articleNumber"
      });
      continue;
    }

    try {
      const existingMapping =
        await fellowProductMappingRepo.getMappingBySpirisArticleNumber(
          locationId,
          spirisArticleNumber
        );

      if (existingMapping) {
        skippedAlreadyMapped += 1;
        results.push({
          status: "skippedAlreadyMapped",
          spirisArticleNumber,
          articleName,
          fellowProductId: existingMapping.fellowProductId
        });
        continue;
      }

      const productResult = await ghlProductService.createProduct(locationId, {
        name: articleName,
        description: "",
        productType: mapSpirisArticleToFellowProductType(article)
      });

      const productId =
        productResult.product?._id ||
        productResult.product?.id ||
        null;

      if (!productId) {
        throw new Error("Created Fellow product missing id");
      }

      const priceResult = await ghlProductService.createPrice(
        locationId,
        productId,
        {
          name: "Standardpris",
          currency: "SEK",
          amount: article.unitPrice ?? 0
        }
      );

      await fellowProductMappingRepo.upsertMapping({
        locationId,
        fellowProductId: productId,
        spirisArticleNumber
      });

      created += 1;
      results.push({
        status: "created",
        spirisArticleNumber,
        articleName,
        fellowProductId: productId,
        fellowPriceId: priceResult.price?._id || priceResult.price?.id || null
      });
    } catch (err) {
      failed += 1;
      results.push({
        status: "failed",
        spirisArticleNumber,
        articleName,
        error: err.response?.data || err.message
      });
    }
  }

  return {
    locationId,
    total: importableArticles.length,
    created,
    skippedAlreadyMapped,
    failed,
    results
  };
}

module.exports = {
  isImportableSpirisArticle,
  mapSpirisArticleToFellowProductType,
  importProductsForLocation
};