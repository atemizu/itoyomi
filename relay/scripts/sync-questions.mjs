// 拡張機能の jev.js から質問文を写す。質問を変えたら `npm run sync`（deploy は自動で実行する）。
import { writeFileSync } from 'node:fs';
import { QUESTIONS, MAX_TEXT, QUESTION_VERSION } from '../../extension/jev.js';
writeFileSync(new URL('../src/questions.json', import.meta.url), JSON.stringify({ QUESTIONS, MAX_TEXT, QUESTION_VERSION }, null, 2) + '\n');
console.log('questions.json を更新しました', QUESTION_VERSION);
