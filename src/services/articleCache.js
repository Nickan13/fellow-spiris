const cache = new Map();

function makeKey(locationId, articleNumber) {
  return `${String(locationId).trim()}::${String(articleNumber).trim().toUpperCase()}`;
}

function get(locationId, articleNumber) {
  return cache.get(makeKey(locationId, articleNumber));
}

function set(locationId, articleNumber, article) {
  cache.set(makeKey(locationId, articleNumber), article);
}

function del(locationId, articleNumber) {
  cache.delete(makeKey(locationId, articleNumber));
}

function clearLocation(locationId) {
  const prefix = `${String(locationId).trim()}::`;

  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}

module.exports = {
  get,
  set,
  del,
  clearLocation
};