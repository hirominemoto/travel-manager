// お試し用：奈良井宿・松本・白馬の旅（2026年11月21日〜22日）
window.SEED_TRIP = {
  name: "奈良井宿・松本・白馬の旅",
  start: "2026-11-21",
  end: "2026-11-22",
  memo: "木〜金に雪予報。土曜の奈良井は最高2〜5℃、日曜の青鬼集落は標高約760mで0℃前後。防水で溝のある冬靴・厚手の防寒・手袋と帽子必須。塩尻⇔奈良井、奈良井→松本はICカード不可で紙のきっぷ。",
  items: [
    { date: "2026-11-21", time: "09:03", endTime: "09:35", type: "move", title: "川崎 → 新宿", amount: 440, paid: false, memo: "上野東京ライン、品川で山手線に乗換" },
    { date: "2026-11-21", time: "10:04", endTime: "12:57", type: "move", title: "あずさ83号の乗車券 新宿 → 塩尻", amount: 4180, paid: false, memo: "特急券とは別に必要。当日までに購入" },
    { date: "2026-11-21", time: "10:04", endTime: "12:57", type: "move", title: "あずさ83号 新宿 → 塩尻（特急券）", amount: 2550, paid: true, memo: "1号車6番D席、予約済み（チケットレス特急券）" },
    { date: "2026-11-21", time: "12:57", endTime: "13:45", type: "food", title: "塩尻駅で昼ごはん", amount: 0, paid: false, memo: "塩尻駅で48分の乗継待ち" },
    { date: "2026-11-21", time: "13:45", endTime: "14:09", type: "move", title: "塩尻 → 奈良井", amount: 420, paid: false, memo: "普通列車。奈良井駅はICカード不可、紙のきっぷを塩尻で購入" },
    { date: "2026-11-21", time: "14:09", endTime: "", type: "sight", title: "奈良井宿を散策", amount: 0, paid: false, memo: "木曽の大橋、水場、旧中村家住宅など。日没は16:37頃、店は夕方に閉まるところが多い" },
    { date: "2026-11-21", time: "", endTime: "", type: "move", title: "奈良井 → 松本", amount: 610, paid: false, memo: "直通の普通列車。発車時刻は当日選択：15:52→16:48着／16:57→17:47着／19:36→20:24着。紙のきっぷ（IC不可）" },
    { date: "2026-11-21", time: "", endTime: "", type: "stay", title: "MATSUMOTO CASTLE hostel（泊）", amount: 4500, paid: true, memo: "松本市中央2-1-12 2F。松本駅から徒歩6〜7分。チェックイン16:00〜23:30（タブレットでセルフ）、チェックアウト10:00" },
    { date: "2026-11-22", time: "09:20", endTime: "11:53", type: "move", title: "大糸線普通 松本 → 信濃森上", amount: 1340, paid: false, memo: "南小谷行。白馬11:16着のあと34分停車して森上へ。運賃は概算\n乗りたかった大糸線" },
    { date: "2026-11-22", time: "11:53", endTime: "14:35", type: "sight", title: "青鬼集落（往復徒歩）", amount: 0, paid: false, memo: "森上駅から徒歩約60分登り → 集落散策約50分 → 徒歩約50分下山\n重要伝統的建造物群保存地区。石垣の棚田と北アルプスの眺め。雪・凍結・ぬかるみ注意、防水の冬靴で" },
    { date: "2026-11-22", time: "15:01", endTime: "15:04", type: "move", title: "普通 信濃森上 → 白馬", amount: 190, paid: false, memo: "はくば2号に間に合う唯一の便。運賃は概算\n下山が遅れたら森上から白馬駅までタクシー（約8分）が保険" },
    { date: "2026-11-22", time: "15:21", endTime: "16:21", type: "move", title: "特急はくば2号 白馬 → 松本（特急券）", amount: 1930, paid: true, memo: "予約済み（特急券）。乗車券は白馬→新宿の通し乗車券で別計上" },
    { date: "2026-11-22", time: "15:21", endTime: "", type: "move", title: "乗車券 白馬 → 新宿（通し）", amount: 5720, paid: false, memo: "はくば2号・あずさ84号の両区間を通す乗車券。当日までに購入" },
    { date: "2026-11-22", time: "17:00", endTime: "19:59", type: "move", title: "あずさ84号 松本 → 新宿（特急券）", amount: 2550, paid: true, memo: "10号車15番D席、予約済み。松本での乗継は39分" },
    { date: "2026-11-22", time: "19:59", endTime: "20:40", type: "move", title: "新宿 → 川崎", amount: 440, paid: false, memo: "川崎着は目安" },
  ],
};
