# Eudaimon Diary — Claude Code 更新指示書 (v0.4)

これは既存の静的日記サイトを **PERMA 対応 + ファイル構成の再編** へ更新するための
実装指示書です。上から順に、確認を取りながら進めてください。

---

## 0. この更新の目的（なぜやるか）

1. **計算式の所在を一元化する。** 今は式がコードに埋もれて「どこにあるか」わからない。
   → 式は `formula.md`（人間可読）に集約し、コードはそれを実装するだけにする。
2. **スキーマ変更をネイティブアプリへ1ファイルで渡せるようにする。** JSON はアプリが
   生成するため、Web 側のルール（ラベル・範囲・必須項目）が変わったら `schema.json`
   1枚を渡せば差分でわかる状態にする。
3. **PERMA 5軸の日次評定を導入する。** 行動から軸を「算出」する旧方式は誤り
   （体験は行動時間では測れない）。5軸は毎晩 0–4 で直接自己評定し、行動ログは
   その説明変数として残す。

### 設計原則（実装中ずっと守る）

- **鏡であってゲームではない。** E_day や PERMA を「上げるべき点数」として演出しない。
  ストリーク・デイリー目標・ハイスコア表現は禁止。トレンドと差分のみ。
- **記録負荷を増やさない。** 新しい分析は既存データの計算から出す。唯一の追加入力は
  夜の PERMA 5問（約30秒）と、任意の1文字 `perma` タグのみ。
- **定義はデータファイルに、コードは読むだけ。** `model.js` は定数・ラベルを一切
  ハードコードしない。すべて `schema.json` / `weights.json` から実行時に読む。
  ルール変更 = JSON 編集のみ、コードは触らない。
- **記録より行動。** 分析は行動を促すためにある。特に R（関係性）が低下した時、
  正しい反応は「正確に記録する」ことではなく「誰かに連絡する」こと。UI はこの
  向きを保つ（下記 stats の famine nudge を参照）。

---

## 1. 目標ファイル構成

\`\`\`
diary/
├── CLAUDE.md
├── schema.json         ← 入力の契約書。アプリと共有する唯一のファイル。
├── formula.md          ← E_day と PERMA の計算式（人間可読）。「式はどこ？」の答え。
├── index.html          ← Book view
├── stats.html          ← Stats view
├── css/
│   └── style.css
├── js/
│   ├── model.js        ← formula.md を実装。schema.json + weights.json を読む。定数を持たない。
│   ├── app.js          ← Book view のロジック
│   └── stats.js        ← Stats view のロジック
└── data/
    ├── YYYYMMDD.json   ← 日次エントリ
    └── weights.json    ← 係数（omega_work, k_sleep, PERMA 重みなど）
\`\`\`

\`model.js\` が single source of truth の消費者。両ビューがこれを import する。
式のコードを複製しないこと。

---

## 2. \`schema.json\`（新規・アプリと共有）

入力の約束事だけを宣言的に持つ。バージョン番号必須。

\`\`\`json
{
  "schema_version": "0.4",
  "activity_labels": ["Sleep","Work","Code","Life","Hobby","Go-out","Transit","None"],
  "value_field": {
    "applies_to": ["Work","Code"],
    "range": [0, 2],
    "default": 1,
    "note": "この項目は Work / Code のブロックにのみ存在。他ラベルには絶対に付けない。"
  },
  "highlights": {
    "value":     { "range": [-5, 5], "exclude": [0], "required": true },
    "note":      { "type": "string", "required": false },
    "perma_tag": { "one_of": ["P","E","R","M","A"], "required": false, "default": "P" }
  },
  "perma_daily": {
    "axes": ["P","E","R","M","A"],
    "range": [0, 4],
    "required": true,
    "note": "毎晩の自己評定。行動ログから算出しない。"
  },
  "condition": ["Poor","Fair","Good","Very Good","Excellent"]
}
\`\`\`

**運用ルール:** ルールを変えるたびに \`schema_version\` を上げ、このファイルを
アプリ開発者に渡す。各 JSON エントリにも \`schema_version\` を記録し、どの形式で
書かれたか常に判別できるようにする。

---

## 3. JSON エントリスキーマ（データ）

\`\`\`json
{
  "schema_version": "0.4",
  "date": "20260715",
  "activity": [
    { "time": "8:30",  "label": "Sleep" },
    { "time": "12:00", "label": "Work", "value": 1 },
    { "time": "17:30", "label": "Transit" },
    { "time": "18:00", "label": "Go-out" },
    { "time": "24:00", "label": "Code", "value": 2 }
  ],
  "highlights": [
    { "value": 3, "note": "shipped the exporter", "perma": "A" },
    { "value": -1, "note": "" }
  ],
  "perma": { "P": 3, "E": 2, "R": 1, "M": 2, "A": 4 },
  "condition": "Good"
}
\`\`\`

- \`time\` は各ブロックの **終了時刻**。ブロックは前ブロックの \`time\`（最初は 0:00）
  から自身の \`time\` まで。\`24:00\` は終端として許可。
- \`perma\`（5キー・各0–4）は required。\`highlights[].perma\` タグは任意で、
  「その出来事がどの軸の根拠か」を残す注釈。**評定値とは連動させない**（独立測定）。
- 旧ファイル: \`diary\` フィールドは無視。\`Game\` ラベルは全て \`Hobby\` へ書換済み。
  \`Happy\` ラベルは集計から除外。

---

## 4. \`formula.md\`（新規・計算式の人間可読な定義）

### E_day（補助スカラー・v0.2 係数）

\`\`\`
E_day = baseline
      − k_sleep · |sleep_hours − sleep_opt|
      + Σ_work_blocks hours · omega_work[value]
      + Σ_code_blocks hours · omega_code[value]
      − k_life · life_hours
      + k_hobby · min(hobby_hours, hobby_opt)
        − k_hobby_excess · max(0, hobby_hours − hobby_opt)
      + k_goout · goout_hours
      − k_transit · transit_hours
      − k_none · none_hours
      − k_phase · max(0, circ_distance(bedtime(d), bedtime(d−1)) − phase_free)
      + k_highlight · Σ highlights[i].value
\`\`\`

- \`bedtime(d)\`: \`Sleep\` ブロック（隣接は結合）で、長さ ≥ 3h、開始が
  \`[d 12:00, d+1 12:00)\`、かつ **起床（終了）が 5:00–11:00** のものの開始時刻。
  複数該当時は最長。該当なしなら開始が窓内の最長ブロックを採り low-confidence
  としてマーク（stats に警告表示、位相項は計算する）。
- \`circ_distance(a,b) = min(|a−b|, 24 − |a−b|)\`（24時間巡回）。
- 位相項は **閾値 1.0h**: 1h までのシフトは無罰、超過分のみ罰。
- \`bedtime(d−1)\` が無ければ位相項 = 0。

### PERMA（主指標・日次評定をそのまま使用）

5軸は評定値をそのまま用いる。**行動からの算出はしない。** 各軸 0–4。
表示は各軸の値と 0–4 スケールを常に併記（例 \`P 3/4\`）。合計スコア化はしない
（軸ごとの情報が潰れるため）。\`highlights[].perma\` は分析時の理由参照に使う。

### スケール（UI で明示すること）

- \`highlights[].value\`: −5..−1 または +1..+5（0 は不可）
- \`activity.value\`: 0..2
- \`perma\`: 各軸 0..4（**0 が最小・4 が最大であることを UI 上で必ず明示**）

---

## 5. \`weights.json\`（係数の外部化）

\`\`\`json
{
  "current": {
    "version": "0.2",
    "updated": "20260714",
    "baseline": 3.0,
    "k_sleep": 0.20, "sleep_opt": 7.5,
    "omega_work": { "0": -0.62, "1": 0.0, "2": 0.15 },
    "omega_code": { "0": 0.08, "1": 0.15, "2": 0.30 },
    "k_life": 0.08,
    "k_hobby": 1.00, "k_hobby_excess": 0.40, "hobby_opt": 1.0,
    "k_goout": 0.15,
    "k_transit": 0.05,
    "k_none": 0.35,
    "k_phase": 0.15, "phase_free": 1.0,
    "k_highlight": 1.0
  },
  "history": [
    {
      "date": "20260714",
      "changed": "omega_work.0: -0.20 -> -0.62",
      "rationale": "grid search vs condition, 6/26-7/4 excl 6/30 outlier, r 0.64 -> 0.94. 8 samples; re-validate.",
      "data_range": "20260626-20260704"
    }
  ]
}
\`\`\`

\`omega_work[0] = -0.62\` は8サンプルでの相関最大化フィット。過学習の可能性あり、
データ蓄積後に再検証。\`omega_work[2]\` は value=2 の Work がまだ少なく据え置き。

**変更ルール（stats の再調整ツールが UI 上で明示）:** 変更は月1回まで。毎変更で
\`rationale\` と \`data_range\` を持つ \`history\` エントリを追加。理由なき変更は不可。
特定日を高くするための変更は禁止。

---

## 6. Book View (\`index.html\`) — レイアウト

見開き2ページ。左=記録、右=その日のサマリ。

**左ページ: activity タイムライン**
- 日付ヘッダ + タイムライン。
- **時刻が読めること。上下マージンまで使い切る（0:00–24:00 を全高に割り当て）。**
- **比率保持**: 4h ブロックは 1h ブロックの縦4倍。
- 各ブロックは activity カラー（下記パレット）。

**右ページ: 上半分 / 下半分**
- 上半分をさらに左右分割:
  - **左: highlights メッセージ。** 符号付き降順ソート（\`+5,+2,-1,-3\`）。
    各行に \`+\` / \`-\` プレフィックス（\`0\` は防御的に \`●\`）。数値は出さず符号と
    並び順で強度を示す。\`perma\` タグがあれば小バッジ（P/E/R/M/A）表示。
  - **右: その日の PERMA。** 日次評定なのでレーダー等で当日の形を表示。
    **各軸 0–4 のスケールを明示**（外周=4、中心=0、または各軸に \`n/4\`）。
    その日 highlight で触れた軸を強調。
- **下半分: CONDITION + EUDAIMON パネル。**
  - CONDITION 表示。
  - E_day の項目別内訳（各項ごとの寄与値）+ 合計。値のみ、評価語は付けない。
    activity パレットで各項を出典に紐づけ。正負の発散棒（0軸から正=右/負=左）推奨。
  - **式インフォアイコン**: "EUDAIMON" 見出しのすぐ右に丸い "i"。クリック/タップで
    formula.md の式をモーダル表示。外側クリック / Esc で閉じる。body スクロールは
    ロックしない。

**ナビ**: PC は左右矢印、モバイルはスワイプ。ロード時は最新エントリ。
左=過去 / 右=未来。ファイルのある日付のみ表示、無い日はスキップ。
ヘッダに Stats へのリンク。

### activity カラーパレット（\`schema.json\` 由来の共有定数）

| Activity | Color |
|---|---|
| Sleep（+ bedtime 位相項） | green |
| Work | red |
| Code | purple |
| Life | amber |
| Hobby | blue |
| Go-out | teal |
| Transit / None | gray |
| Highlights | pink |

---

## 7. Stats View (\`stats.html\`) — 4分割レイアウト

\`\`\`
   (1)         |     (4)
--------------------------
 (2)    (3)    |     (5)
\`\`\`

**(1) 左上: 月次構成比（オセロ式タイル）**
- **デフォルトは1ヶ月前**。左右矢印で前後どちらの月へも移動。
- 長方形の枠にタイルを詰めて時間比率を面積表示。
  **1タイル = 1時間、14×12 = 168（= 24h×7）の長方形グリッド**（縦横逆でも可）。
- タイルは **activity ごとにまとめ、値の大きい順**に配置。
- **凡例テキスト**（色 → ラベル、activity パレットと同色）を併記。

**(2) 左下・左: E_day 折れ線**
- (3) で選択中の曜日の E_day を日付順で結ぶ。実データの値を使う
  （欠損日はスキップ、補間しない）。0 ライン明示。

**(3) 左下・右: 曜日別テーブル（(2)と下段を共有）**
- 各曜日の E_day 平均・condition 平均・サンプル数。
- **各曜日をタップすると (2) のグラフがその曜日に切り替わる。**

**(4) 右上: PERMA トレンド**
- **週は月曜開始**。左右矢印で過去週へ。週ラベルは \`wk of 7/6\` 形式
  （**"Mon" は不要**。常に月曜開始なので冗長）。
- 各軸 0–4 のバー + 先週比の増減（▲▼）。**0–4 スケールを明示**。
- テキストコメントは不要。
- **famine nudge（設計原則の実装）**: ある軸の14日移動平均が閾値未満の時のみ、
  その軸を控えめにマーク。特に R 低下時は「記録」でなく行動（人に連絡する）へ
  向ける最小限の一言に留める。通知・警告音・ランキング表現はしない。

**(5) 右下: 重み再調整ツール（実装する）**
- 手動・決定的・AI 不要。手法は確立済み（グリッドサーチ、r 0.64→0.94 実証済み）。
  ブラウザ内 JS で完結。
- 係数をドロップダウンで1つ選び、範囲をスイープして E_day と condition の
  Pearson r を計算。日付範囲指定と外れ値除外リスト対応。
- 出力: 現在値 / 最良候補 / r（前後）/ E_day×condition の散布図。
- **\`weights.json\` は自動で書き換えない。** 貼付用の JSON スニペット（新 \`current\`
  + ドラフト \`history\`）を提示し、ユーザーが手動反映。意図的な摩擦。
- 直近の \`history\` が28日以内なら「前回変更から N 日」の注意表示（ハードブロック
  はしない）。

---

## 8. 開発ステップ（順に、都度確認）

1. ステップ提示
2. ファイル構成の提示（本書の 1章）
3. \`schema.json\` / \`formula.md\` / \`weights.json\` の作成と確認
4. Book view UI モックの提示（確認まで着手しない）
5. Book view UI 実装
6. Book view ロジック実装（JSON 読込、E_day 内訳、PERMA 表示、式モーダル）
7. Stats view UI モックの提示
8. Stats view 実装（(1)構成比 (2)(3)曜日連動 (4)PERMA）
9. 重み再調整ツール実装（(5)）

**各ステップは明示的な確認なしに次へ進まない。** 各ステップ完了後、下の
Current Status を更新し、トークン節約のため新セッション開始を促す。

---

## 9. Current Status

- [x] Step 1: ステップ提示
- [x] Step 2: ファイル構成提示
- [x] Step 3: schema.json / formula.md / weights.json 作成
- [x] Step 4: Book view UI モック（実装に統合）
- [x] Step 5: Book view UI 実装
- [x] Step 6: Book view ロジック
- [x] Step 7: Stats view UI モック（実装に統合）
- [x] Step 8: Stats view 実装
- [x] Step 9: 再調整ツール

**Next:** 実データ（2026-06〜）への PERMA 付与運用、およびデータ蓄積後の
weights 再検証。実装はユーザー承認のもと全ステップ一括完了（2026-07-19）。

実装メモ:
- ES モジュール構成。`js/model.js` が formula.md を実装し `schema.json` /
  `data/weights.json` を実行時ロード。`app.js` / `stats.js` が import する。
  色は `schema.json` の `palette` に集約（model.js は色定数を持たない）。
- 既存の実データ（6/14〜7/13）は `perma` 未記入 → Book/Stats とも "not rated"
  として graceful に表示。旧 `diary` / `Happy` は無視・フォールバック配色。
- テスト用ダミーは `data/20200101〜20200108.json`（2020クラスタ）。Book の
  366日スキャン・Stats の45日ギャップスキャンとも到達しないため実データを
  汚さない。Book で `index.html?date=20200101` により個別閲覧可能。不要なら削除可。

---

## 10. Publishing

ユーザーが **「公開して」**（または publish / deploy）と言ったら、\`publish\` skill を
実行: 全変更をコミットして GitHub リモートへ push、GitHub Pages を更新。ビルド
ステップの無い静的サイト。\`data/YYYYMMDD.json\` を追加して push すれば、アプリは
日付を probing してエントリを発見する（manifest 不要）。

---

## 11. Out of Scope

- 管理画面 / ログイン / データ入力 UI（入力はネイティブアプリが担当）
- 複数ユーザー対応・ユーザー別重みフィット（重みは本人専用。他人には無意味）
- アプリ内 AI 分析（再調整は決定的 JS）
- \`standing.json\`（持続的な生活状態レイヤー）: 設計済みだが延期。PERMA タグ付き
  データが1ヶ月以上溜まってから再訪。

---

## 12. Testing

\`data/\` 下のダミー JSON が以下を網羅すること: Work/Code の value 0/1/2、
highlights の ±値、\`perma\` タグ有り/無し、空の highlights 配列、\`perma\` 5軸評定、
旧 \`diary\`+\`Happy\` を含むレガシーファイル、夜間睡眠が該当しない日（bedtime
フォールバック）、月境界（stats ナビ用）。
