const { loadEnv } = require("@medusajs/utils");
loadEnv("test", process.cwd());

module.exports = {
  transform: {
    // .tsx included: notification-resend imports its React Email templates,
    // which are .tsx, and booting the app pulls that module in. Without it the
    // whole integration:http suite dies before the first test.
    "^.+\\.[jt]sx?$": [
      "@swc/jest",
      {
        jsc: {
          parser: { syntax: "typescript", tsx: true, decorators: true },
        },
      },
    ],
  },
  testEnvironment: "node",
  // src uses dynamic `import("./foo.js")` in a few places, which is correct at
  // runtime (Medusa compiles TS to .js) but unresolvable here, where the file
  // on disk is still .ts. Without this, any test touching chat's sendOutbound
  // or ingestInboundMessenger dies on "Cannot find module".
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  moduleFileExtensions: ["js", "ts", "tsx", "json"],
  modulePathIgnorePatterns: ["dist/", "<rootDir>/.medusa/"],
  setupFiles: ["./integration-tests/setup.js"],
};

if (process.env.TEST_TYPE === "integration:http") {
  module.exports.testMatch = ["**/integration-tests/http/*.spec.[jt]s"];
} else if (process.env.TEST_TYPE === "integration:modules") {
  module.exports.testMatch = ["**/src/modules/*/__tests__/**/*.[jt]s"];
} else if (process.env.TEST_TYPE === "unit") {
  module.exports.testMatch = ["**/src/**/__tests__/**/*.unit.spec.[jt]s"];
}
