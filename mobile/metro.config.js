const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root so shared code changes trigger hot-reload
config.watchFolders = [monorepoRoot];

// Resolve node_modules from both mobile/ and the monorepo root (for hoisted deps)
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Map @cinezoo/shared to the shared source directory
config.resolver.extraNodeModules = {
  "@cinezoo/shared": path.resolve(monorepoRoot, "shared/src"),
};

module.exports = config;
