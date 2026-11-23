
export const healthResponseSchema = {
  200: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
      database: { type: "string" },
      timestamp: { type: "string" }
    },
    required: ["success", "message", "database", "timestamp"]
  },

  503: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      message: { type: "string" },
      database: { type: "string" }
    },
    required: ["success", "message", "database"]
  }
};
