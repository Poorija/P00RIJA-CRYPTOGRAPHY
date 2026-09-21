/*
 * P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
 * Copyright (C) 2026 Poorija <p00rija@tutamail.com>
 * https://github.com/Poorija/P00RIJA-Cryptography
 *
 * Licensed under the GNU Affero General Public License, version 3 only.
 * See LICENSE for the full text. Section 13 matters here: run a modified
 * version as a network service and its users are entitled to your source.
 */

module.exports = {
  rootDir: '..',
  testEnvironment: 'jsdom',
  testRunner: 'jest-circus/runner',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  /* Copies of this tree that live inside it. GitHub/ is the publishable export
     and npm-package/app is the installer payload; both carry a package.json,
     which jest reads as a second manifest for the same project and warns
     about. dist/ is the prepared web payload. None of them hold tests. */
  modulePathIgnorePatterns: [
    '<rootDir>/standalone-relay',
    '<rootDir>/GitHub',
    '<rootDir>/dist',
    '<rootDir>/npm-package/app',
  ],
};
