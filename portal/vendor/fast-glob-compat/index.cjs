// Scoped adapter for vite-plugin-dynamic-import's globFiles implementation.
// Keep fast-glob's file-only directory behavior when resolving imports.
// oxlint-disable-next-line typescript/no-require-imports -- The consumer loads this adapter through CommonJS.
const tinyglobby = require('tinyglobby');
/**
 * @param {string | readonly string[]} patterns
 * @param {Omit<import('tinyglobby').GlobOptions, 'patterns'>} [options]
 */
module.exports.sync = (patterns, options = {}) =>
  tinyglobby.globSync(patterns, { ...options, expandDirectories: false });
