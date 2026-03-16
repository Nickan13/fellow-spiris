const ghlCollectionService = require("./ghlCollectionService");
const ghlProductService = require("./ghlProductService");
const spirisArticleLabelCollectionRepo = require("../db/repositories/spirisArticleLabelCollectionRepo");

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function getCollectionsFromListResponse(response) {
  if (Array.isArray(response?.data?.data)) {
    return response.data.data;
  }

  if (Array.isArray(response?.data)) {
    return response.data;
  }

  if (Array.isArray(response?.collections)) {
    return response.collections;
  }

  return [];
}

function extractCollectionIdFromCreateResponse(response) {
  return (
    response?._id ||
    response?.id ||
    response?.data?._id ||
    response?.data?.id ||
    response?.collection?._id ||
    response?.collection?.id ||
    response?.data?.collection?._id ||
    response?.data?.collection?.id ||
    null
  );
}

function extractCollectionNameFromCreateResponse(response) {
  return (
    response?.name ||
    response?.data?.name ||
    response?.collection?.name ||
    response?.data?.collection?.name ||
    null
  );
}

function findCollectionByName(collections, name) {
  const wanted = normalizeName(name);

  return collections.find((collection) => {
    return normalizeName(collection?.name) === wanted;
  }) || null;
}

async function ensureCollectionsForArticle({
  locationId,
  article,
  fellowProductId
}) {
  if (!locationId) {
    throw new Error("locationId is required");
  }

  if (!article) {
    throw new Error("article is required");
  }

  if (!fellowProductId) {
    throw new Error("fellowProductId is required");
  }

  const labels = Array.isArray(article?.raw?.ArticleLabels)
    ? article.raw.ArticleLabels
    : [];

  if (labels.length === 0) {
    return {
      ok: true,
      locationId,
      fellowProductId,
      totalLabels: 0,
      collectionIds: [],
      results: []
    };
  }

  const existingCollectionsResponse =
    await ghlCollectionService.listCollections(locationId);

  const existingCollections =
    getCollectionsFromListResponse(existingCollectionsResponse);

  const collectionIds = [];
  const results = [];

  for (const label of labels) {
    const spirisLabelId = label?.Id || null;
    const spirisLabelName = label?.Name || null;

    if (!spirisLabelId || !spirisLabelName) {
      results.push({
        status: "skipped",
        reason: "Missing label id or name"
      });
      continue;
    }

    let fellowCollectionId = null;
    let fellowCollectionName = spirisLabelName;

    const existingMapping =
      await spirisArticleLabelCollectionRepo.getMappingBySpirisLabelId(
        locationId,
        spirisLabelId
      );

    if (existingMapping?.fellowCollectionId) {
      fellowCollectionId = existingMapping.fellowCollectionId;
      fellowCollectionName =
        existingMapping.fellowCollectionName || spirisLabelName;
    } else {
      const existingCollection =
        findCollectionByName(existingCollections, spirisLabelName);

      if (existingCollection?._id || existingCollection?.id) {
        fellowCollectionId = existingCollection._id || existingCollection.id;
        fellowCollectionName = existingCollection.name || spirisLabelName;
      } else {
        const createdCollectionResponse =
          await ghlCollectionService.createCollection(locationId, spirisLabelName);

        fellowCollectionId =
          extractCollectionIdFromCreateResponse(createdCollectionResponse);

        fellowCollectionName =
          extractCollectionNameFromCreateResponse(createdCollectionResponse) ||
          spirisLabelName;

        if (!fellowCollectionId) {
          const refreshedCollectionsResponse =
            await ghlCollectionService.listCollections(locationId);

          const refreshedCollections =
            getCollectionsFromListResponse(refreshedCollectionsResponse);

          const resolvedCollection =
            findCollectionByName(refreshedCollections, spirisLabelName);

          if (resolvedCollection?._id || resolvedCollection?.id) {
            fellowCollectionId =
              resolvedCollection._id || resolvedCollection.id;
            fellowCollectionName =
              resolvedCollection.name || spirisLabelName;
          }
        }

        if (!fellowCollectionId) {
          throw new Error(
            `Failed to resolve Fellow collection for label ${spirisLabelName}`
          );
        }
      }

      await spirisArticleLabelCollectionRepo.upsertMapping({
        locationId,
        spirisLabelId,
        spirisLabelName,
        fellowCollectionId,
        fellowCollectionName
      });
    }

    if (fellowCollectionId) {
      collectionIds.push(fellowCollectionId);
      results.push({
        status: "ready",
        spirisLabelId,
        spirisLabelName,
        fellowCollectionId,
        fellowCollectionName
      });
    }
  }

  const uniqueCollectionIds = [...new Set(collectionIds)];

  if (uniqueCollectionIds.length > 0) {
    const existingProduct =
      await ghlProductService.getProductById(locationId, fellowProductId);

    await ghlProductService.updateProduct(locationId, fellowProductId, {
      name: existingProduct?.name || article?.name || "Imported product",
      description: existingProduct?.description || "",
      productType: existingProduct?.productType || "DIGITAL",
      availableInStore:
        typeof existingProduct?.availableInStore === "boolean"
          ? existingProduct.availableInStore
          : true,
      collectionIds: uniqueCollectionIds
    });
  }

  return {
    ok: true,
    locationId,
    fellowProductId,
    totalLabels: labels.length,
    collectionIds: uniqueCollectionIds,
    results
  };
}

module.exports = {
  ensureCollectionsForArticle
};