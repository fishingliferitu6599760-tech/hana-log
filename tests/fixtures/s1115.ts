import { addBonus, endSession, newSession, updateBonus } from '../../src/logic';
import type { BonusType, LampColor, Session } from '../../src/types';

/**
 * 2026/11/15 タイホウ篭山 1617 ホウオウ天翔 の検証データ。
 * 指示書の途中データ（累計G・BIG・REG・ベル累計の7地点）と最終値に一致するよう、
 * 間の当選は明示的に合成した（実際の全当選履歴は未入手）。
 */
type Row = [BonusType, number, number | null];
const ROWS: Row[] = [
  ['BIG', 120, null], ['REG', 85, null], ['BIG', 210, null], ['REG', 40, null], ['BIG', 95, null], ['REG', 77, null], ['BIG', 100, 111], // 727G B4 R3
  ['REG', 180, null], ['BIG', 60, null], ['REG', 230, null], ['REG', 44, null], ['BIG', 180, 200], // 1421G B6 R6
  ['REG', 150, null], ['REG', 54, 229], // 1625G B6 R8
  ['BIG', 482, 291], // 2107G B7 R8
  ['REG', 210, null], ['REG', 76, 331], // 2393G B7 R10
  ['BIG', 302, 368], // 2695G B8 R10
];
const BIG_SUIKA = [1, 0, 1, 0, 2, 0, 1, 0]; // 計5
const REG_SIDE: LampColor[] = ['blue', 'yellow', 'yellow', 'blue', 'red', 'yellow', 'blue', 'yellow', 'blue', 'yellow']; // 青4黄5緑0赤1

export function build1115(): Session {
  let s = newSession({ date: '2026-11-15', store: 'タイホウ篭山', tableNo: '1617', machineId: 'houou-30', resetFlash: true });
  let bi = 0, ri = 0;
  ROWS.forEach(([t, g, bells]) => {
    s = addBonus(s, t, g, undefined, bells);
    const id = s.bonuses[s.bonuses.length - 1].id;
    if (t === 'BIG') {
      const first = bi === 0;
      s = updateBonus(s, id, { suika: BIG_SUIKA[bi] as 0 | 1 | 2, end: first ? null : 'white', retroRight: false, retroActual: false });
      bi++;
    } else {
      s = updateBonus(s, id, { side: REG_SIDE[ri], end: 'white', retroRight: false, retroActual: false });
      ri++;
    }
  });
  s = { ...s, bellTotal: 404, bellPending: true };
  return endSession(s, 254);
}

