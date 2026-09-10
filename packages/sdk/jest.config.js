module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  // index.ts 只有 re-export，types.ts 只有类型，纳入覆盖率只会稀释信号
  collectCoverageFrom: ['**/*.ts', '!**/*.spec.ts', '!index.ts', '!types.ts'],
  coverageDirectory: '../coverage',
  // SDK 是阻断登录的判定核心，覆盖率不达标就是在赌客户不会被误锁
  coverageThreshold: {
    global: { branches: 85, functions: 90, lines: 90, statements: 90 },
  },
  testEnvironment: 'node',
}
