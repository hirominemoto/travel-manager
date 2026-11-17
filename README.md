# 旅のしおり（travel-manager）

行程・電車の時刻・費用をまとめて、合計まで出る旅のプランノート。PCで計画して、旅先ではスマホで直せる。

## できること

- 旅を作る（名前・出発日・帰着日・メモ）
- 行程を足す・直す（日付・時刻・種類・金額・支払い済み・メモ）
  - 時刻を入れると、その日の時刻順の位置に自動で入る
  - 時刻のない行程（宿など）は、↑↓で好きな位置に動かせる
  - 「時刻順に並べ直す」で、その日をまとめて整列（時刻のない行程は直前の行程にくっついたまま）
- 「行かなかった」印：合計から外して、線を引いた状態で残す
- 総額・支払い済み・残り・日ごとの小計・種類ごとの内訳
- 「印刷・PDF」でしおりとして印刷・保存
- PCとスマホで同じ旅を見られる（Netlifyに保存）
- 合言葉で戸締まり（各端末で最初の1回だけ入力）
- 別の端末で先に保存されていたら、上書きせずに最新を読み込み直す

## Netlifyでの公開手順（最初の1回だけ）

1. Netlifyで「**Add new project**」→「**Import an existing project**」→「**GitHub**」を押し、`travel-manager` を選ぶ
2. ビルドの設定はそのままで「**Deploy**」を押す（`netlify.toml` に書いてある）
3. デプロイが終わったら、プロジェクトの「**Project configuration**」→「**Environment variables**」→「**Add a variable**」を押す
   - Key: `TABI_PASSWORD`
   - Value: 好きな合言葉
4. 「**Deploys**」→「**Trigger deploy**」→「**Deploy project**」を押して、合言葉を反映させる
5. 表示されたURLを開いて合言葉を入れる。スマホでも同じURLを開いて、合言葉を一度入れる

## しくみ

- `public/` … 画面（HTML・CSS・JavaScript）
- `netlify/functions/trips.mjs` … 旅を保存・読み出す窓口（Netlify Blobs に保存）。合言葉がないと使えない
- `public/seed.js` … お試し用の旅（奈良井宿・松本・白馬）。一覧の「お試しの旅を入れる」で入る
