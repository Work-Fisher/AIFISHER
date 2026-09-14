import {defineConfig} from 'vitest/config';
export default defineConfig({test:{include:['tests/community.test.js'],environment:'node'}});
