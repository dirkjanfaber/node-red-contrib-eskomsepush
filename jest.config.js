/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/lib/**/*.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }]
  }
}
