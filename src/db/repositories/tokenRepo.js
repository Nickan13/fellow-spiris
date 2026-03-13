const db = require("../database");

function saveTokens(locationId, accessToken, refreshToken, expiresAt) {
  return new Promise((resolve, reject) => {

    db.run(
      `
      INSERT INTO spiris_tokens (
        location_id,
        encrypted_access_token,
        encrypted_refresh_token,
        token_expires_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(location_id)
      DO UPDATE SET
        encrypted_access_token = excluded.encrypted_access_token,
        encrypted_refresh_token = excluded.encrypted_refresh_token,
        token_expires_at = excluded.token_expires_at,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        locationId,
        JSON.stringify(accessToken),
        JSON.stringify(refreshToken),
        expiresAt
      ],
      function (err) {
        if (err) return reject(err);
        resolve(true);
      }
    );
  });
}

module.exports = {
  saveTokens
};