// Scoped adapter for vite-plugin-dynamic-import's globFiles implementation.
// Keep fast-glob's file-only directory behavior when resolving imports.
// oxlint-disable-next-line typescript/no-require-imports -- The consumer loads this adapter through CommonJS.
const { globSync } = require('tinyglobby');
module.exports.sync = (patterns, options = {}) =>
  globSync(patterns, { ...options, expandDirectories: false });
