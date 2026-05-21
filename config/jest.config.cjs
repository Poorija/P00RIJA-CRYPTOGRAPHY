module.exports = {
  rootDir: '..',
  testEnvironment: 'jsdom',
  testRunner: 'jest-circus/runner',
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/standalone-relay'],
};
