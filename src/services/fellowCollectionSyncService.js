const ghlCollectionService = require("./ghlCollectionService");
const spirisArticleLabelCollectionRepo = require("../db/repositories/spirisArticleLabelCollectionRepo");

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

  const existingCollections = Array.isArray(existingCollectionsResponse?.collections)
    ? existingCollectionsResponse.collections
    : Array.isArray(existingCollectionsResponse?.data?.collections)
      ? existingCollectionsResponse.data.collections
      : [];

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
      fellowCollectionName = existingMapping.fellowCollectionName || spirisLabelName;
    } else {
      const existingCollection = existingCollections.find((collection) => {
        return String(collection?.name || "").trim().toLowerCase() ===
          String(spirisLabelName).trim().toLowerCase();
      });

      if (existingCollection?._id || existingCollection?.id) {
        fellowCollectionId = existingCollection._id || existingCollection.id;
        fellowCollectionName = existingCollection.name || spirisLabelName;
      } else {
        const createdCollection =
          await ghlCollectionService.createCollection(locationId, spirisLabelName);

        fellowCollectionId =
          createdCollection?._id ||
          createdCollection?.id ||
          createdCollection?.collection?._id ||
          createdCollection?.collection?.id ||
          null;

        fellowCollectionName =
          createdCollection?.name ||
          createdCollection?.collection?.name ||
          spirisLabelName;

        if (!fellowCollectionId) {
          throw new Error(`Failed to create Fellow collection for label ${spirisLabelName}`);
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
    await ghlCollectionService.assignProductToCollections(
      locationId,
      fellowProductId,
      uniqueCollectionIds
    );
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