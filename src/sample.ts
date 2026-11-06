import { NA, type Bonus, type LampColor, type Session } from './types';
import { newSession } from './logic';

/**
 * 2026/10/25 ニューキングV実戦の「最終集計値」を再現するテスト用データ。
 * 実際の31回の当選内容は指示書に無いため、先頭4件（指示書の表示例）以外は
 * 集計値が一致するように明示的に合成したもの。事実の履歴ではない。
 */
export const SAMPLE_NOTE = '※テスト用合成データ：最終集計値のみ2026/10/25実戦と一致。個々の当選内容・当選時ベル累計・REGレトロは合成。';

// 種別と当選間G（合計5,765G）
const SEQ: Array<['B' | 'R', number]> = [
  ['R', 14], ['B', 8], ['R', 43], ['B', 476], ['B', 122], ['R', 251], ['B', 37], ['R', 188],
  ['B', 305], ['B', 96], ['R', 142], ['R', 61], ['B', 233], ['R', 417], ['B', 159], ['R', 27],
  ['B', 284], ['R', 196], ['B', 73], ['R', 350], ['B', 211], ['R', 108], ['B', 165], ['R', 239],
  ['B', 52], ['R', 312], ['B', 187], ['R', 90], ['B', 268], ['R', 244], ['B', 407],
];

// BIG 16件ぶん：自然スイカ(計10)・後半サイド(青6黄4緑3赤3)・終了(白15青1)・レトロ実発生(1)
const BIG_SUIKA = [1, 0, 2, 0, 1, 0, 0, 1, 0, 2, 0, 1, 0, 1, 1, 0];
const BIG_SIDE: LampColor[] = ['green', 'red', 'blue', 'yellow', 'blue', 'green', 'blue', 'red', 'yellow', 'blue', 'yellow', 'blue', 'red', 'green', 'yellow', 'blue'];
const BIG_END: LampColor[] = ['white', 'white', 'white', 'white', 'white', 'white', 'white', 'white', 'white', 'blue', 'white', 'white', 'white', 'white', 'white', 'white'];
const BIG_RETRO_ACTUAL = [false, false, false, false, false, false, true, false, false, false, false, false, false, false, false, false];
// REG 15件ぶん：自然スイカ(計3)・REG中サイド(未記録)・終了(白14青1)
const REG_SUIKA = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0];
const REG_END: LampColor[] = ['white', 'white', 'white', 'white', 'white', 'white', 'white', 'white', 'blue', 'white', 'white', 'white', 'white', 'white', 'white'];

export function buildSample(): Session {
  const start = new Date('2026-10-25T10:00:00+09:00').getTime();
  let t = start;
  let bi = 0;
  let ri = 0;
  // 区間ベル：合計876（最後の284G区間を含む）になるよう G/6.905 で按分
  const all = [...SEQ.map(([, g]) => g), 284];
  const bells = all.map((g) => Math.round(g / 6.905));
  bells[bells.length - 1] += 876 - bells.reduce((a, b) => a + b, 0);
  let acc = 0;
  const cumBells = bells.map((n) => (acc += n)); // 外部カウンターの累計値
  const bonuses: Bonus[] = SEQ.map(([k, g], i) => {
    t += g * 4200 + (i ? 60000 : 0); // 1G≒4.2秒＋ボーナス消化
    const at = new Date(t).toISOString();
    if (k === 'B') {
      const j = bi++;
      return {
        id: `s${i + 1}`, type: 'BIG', games: g, bellsAt: cumBells[i], at, memo: '',
        suika: BIG_SUIKA[j] as 0 | 1 | 2, side: BIG_SIDE[j], end: BIG_END[j],
        retroRight: true, retroActual: BIG_RETRO_ACTUAL[j],
      };
    }
    const j = ri++;
    return {
      id: `s${i + 1}`, type: 'REG', games: g, bellsAt: cumBells[i], at, memo: '',
      suika: REG_SUIKA[j] as 0 | 1, side: NA, end: REG_END[j], retroRight: false, retroActual: false,
    };
  });
  return newSession({
    date: '2026-10-25', store: 'タイホウ篭山', tableNo: '1625', machineId: 'new-king-v30',
    seatTotalGames: 0, seatCurrentGames: 0, seatBig: 0, seatReg: 0, lendRate: null,
    bellTotal: 876, bellPending: true, bonuses, endGames: 284, endedAt: new Date(t + 284 * 4200).toISOString(), memo: SAMPLE_NOTE,
  });
}
