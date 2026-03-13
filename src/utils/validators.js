const AppError = require("./AppError");

function assertRequired(value, fieldName) {
  if (value === undefined || value === null || value === "") {
    throw new AppError(`${fieldName} is required`, 400, "validation_error");
  }
}

function assertPositiveNumber(value, fieldName) {
  if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
    throw new AppError(`${fieldName} must be a positive number`, 400, "validation_error");
  }
}

function validateInvoiceRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("rows are required");
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];

    assertRequired(row.articleNumber, `rows[${i}].articleNumber`);
    assertPositiveNumber(row.quantity, `rows[${i}].quantity`);
    assertPositiveNumber(row.unitPrice, `rows[${i}].unitPrice`);
  }
}

function validateCreateDraftInput(input) {
  assertRequired(input.locationId, "locationId");
  assertRequired(input.estimateId, "estimateId");
  assertRequired(input.opportunityId, "opportunityId");
  assertRequired(input.customerType, "customerType");

  if (!["b2b", "b2c", "auto"].includes(input.customerType)) {
    throw new AppError("customerType must be one of: b2b, b2c, auto", 400, "validation_error");
  }

  if (input.customerType === "b2b" && !input.orgNumber) {
    throw new AppError("orgNumber is required for b2b", 400, "validation_error");
  }

  if (input.customerType === "b2c" && !input.email) {
    throw new AppError("email is required for b2c", 400, "validation_error");
  }

  validateInvoiceRows(input.rows);
}

module.exports = {
  assertRequired,
  assertPositiveNumber,
  validateInvoiceRows,
  validateCreateDraftInput
};