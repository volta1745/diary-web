# Eudaimon Diary — 計算式定義

「式はどこ？」の答えがこのファイル。計算式の人間可読な single source of truth。

- 係数の**実値**はここには書かない。すべて `data/weights.json` の `current` を参照。
- `js/model.js` はこのファイルの式を実装するだけで、定数・ラベルを一切持たない
  （`schema.json` / `weights.json` を実行時に読む）。

---

## E_day（補助スカラー）

```
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
```

### 記号定義

- `*_hours`: ラベルごとの合計時間（時間単位）。`activity` の各ブロックは
  前ブロックの `time`（最初は 0:00）から自身の `time`（終了時刻）まで。
- `omega_work` / `omega_code`: `value`（0–2）ごとの係数表。
  `value` の無い Work / Code ブロックは `value = 1` として扱う。
- `bedtime(d)`: `Sleep` ブロック（隣接は結合）のうち、
  1. 長さ ≥ 3h、かつ
  2. 開始が `[d 12:00, d+1 12:00)` に入り、かつ
  3. 起床（終了）が 5:00–11:00 に入るもの
  の開始時刻（時間単位、深夜越えは ≥ 24 で表現）。複数該当時は最長。
  該当なしの場合は「開始が窓内の最長ブロック」を採り **low-confidence** として
  マークする（stats に警告表示。位相項は計算する）。
- `circ_distance(a, b) = min(|a − b|, 24 − |a − b|)`（24時間巡回距離）。
- 位相項は**閾値 `phase_free`（= 1.0h）**: 1h までのシフトは無罰、超過分のみ罰。
- `bedtime(d−1)` が無い場合（初回エントリ・前日ファイル欠損）、位相項 = 0。

---

## PERMA（主指標）

5軸（P / E / R / M / A）は毎晩の自己評定値（各 0–4）を**そのまま**用いる。

- **行動ログからの算出はしない。** 体験は行動時間では測れない。
- 表示は各軸の値と 0–4 スケールを常に併記する（例 `P 3/4`）。
- **合計スコア化はしない**（軸ごとの情報が潰れるため）。
- `highlights[].perma` タグは「その出来事がどの軸の根拠か」の注釈であり、
  評定値とは連動させない（独立測定）。分析時の理由参照に使う。

---

## スケール（UI で明示すること）

| フィールド | 範囲 |
|---|---|
| `highlights[].value` | −5..−1 または +1..+5（0 は不可） |
| `activity.value`（Work / Code のみ） | 0..2（欠落は 1 扱い） |
| `perma`（各軸） | 0..4（**0 が最小・4 が最大**であることを UI 上で必ず明示） |
