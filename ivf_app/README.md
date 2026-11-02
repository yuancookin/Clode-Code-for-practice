# 体外受精スケジュール（Streamlit + Supabase）

通院・採卵・移植の予定を条件から作り、表やフォームで手直しして、月カレンダーで見るアプリです。
予定は Supabase に保存され、合言葉を知っている人だけが読み書きできます。メールアドレスとパスワードはいりません。

## できること

- **カレンダー**：次の予定と、月ごとの色分けカレンダー
- **予定を直す**：1日ずつの追加・置き換え・削除、まとめて前後にずらす、表での直接編集（自動保存）
- **作り直す**：生理開始日・周期・採卵日から、通院／トリガー／培養／移植／判定の日を計算
- **書き出し・保存**：iPhoneカレンダー用の .ics、LINE用の文面、CSVのバックアップ

## セットアップ（最初の1回だけ・約15分）

### 1. Supabase

1. https://supabase.com でプロジェクトを作る（リージョンは Tokyo がおすすめ）
2. 左メニュー **SQL Editor** → `supabase/schema.sql` の中身を貼って **Run**
3. **Authentication → Sign In / Providers** で **Allow anonymous sign-ins をオン**（端末ごとに匿名でサインインし、合言葉で共有スペースに入る）
4. **Project Settings → API Keys** で、次の2つを控える
   - Project URL（`https://xxxx.supabase.co`）
   - **anon** キー（Legacy API Keys のタブにある `eyJ...` で始まるもの）
   - ※ `service_role` / secret キーは絶対に使わない
   - 新しい publishable key（`sb_publishable_...`）でも動きます

> アプリを更新して `schema.sql` が変わったときは、同じように SQL Editor で最新の中身を貼って Run します（何度実行しても大丈夫です）。

### パートナーとの共有

1. 片方が「新しく始める」で合言葉（8文字以上）を決める
2. もう片方が「合言葉で入る」に同じ合言葉を入れる
3. 以後、2人とも同じ予定を見て、どちらからでも直せます。同時に直した場合は、後から保存した側に「最新を読み込みました」と出て、上書きはされません

「この端末で覚えておく」をオンにすると、その端末では合言葉を入れずに開けます（iPhone の Safari では、7日間開かないと入れ直しになることがあります）。

- 合言葉は忘れるとメールでは戻せません。入れたままの端末があれば「保存・共有」タブの「合言葉を変える」で変えられます。変えると、ほかの端末は入り直しになります
- 以前メールアドレスで使っていた共有スペースは、入口の「以前メールアドレスで使っていた方はこちら」から、作った人のメールアドレスと暗証番号で引き継げます。引き継ぐときに合言葉を決めると、この入口は閉じます
- 合言葉をまちがえられる回数には上限があります（1人1時間に5回、全体で10分に30回）

### 2. GitHub

このフォルダの中身をリポジトリに入れる（`secrets.toml` は入れない）。

### 3. Streamlit Community Cloud

1. https://share.streamlit.io に GitHub でログイン → **Create app**
2. リポジトリ・ブランチを選び、Main file path に `app.py`（フォルダに入れた場合は `ivf_app/app.py`）
3. **Advanced settings → Secrets** に次を貼る

   ```toml
   SUPABASE_URL = "https://xxxx.supabase.co"
   SUPABASE_KEY = "eyJ...（anonキー）"
   ```

4. **Deploy** → 表示されたURLを Safari で開いて合言葉を決める

Secrets を入れないと「お試しモード」（保存なし）で動きます。

## ローカルで動かす

```bash
pip install -r requirements.txt
cp .streamlit/secrets.toml.example .streamlit/secrets.toml   # 中身を書き換える
streamlit run app.py
```

## ファイル

| ファイル | 役割 |
|---|---|
| `app.py` | 画面 |
| `schedule.py` | 日程の計算・カレンダー描画・ics/CSV/LINE文面（Streamlitに依存しない） |
| `store.py` | Supabase への匿名サインイン・合言葉での入室・保存 |
| `supabase/schema.sql` | テーブル・行レベルセキュリティ・保存用関数 |
