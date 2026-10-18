# 体外受精スケジュール（Streamlit + Supabase）

通院・採卵・移植の予定を条件から作り、表やフォームで手直しして、月カレンダーで見るアプリです。
予定は Supabase に保存され、ログインした本人だけが読み書きできます。

## できること

- **カレンダー**：次の予定と、月ごとの色分けカレンダー
- **予定を直す**：1日ずつの追加・置き換え・削除、まとめて前後にずらす、表での直接編集（自動保存）
- **作り直す**：生理開始日・周期・採卵日から、通院／トリガー／培養／移植／判定の日を計算
- **書き出し・保存**：iPhoneカレンダー用の .ics、LINE用の文面、CSVのバックアップ

## セットアップ（最初の1回だけ・約15分）

### 1. Supabase

1. https://supabase.com でプロジェクトを作る（リージョンは Tokyo がおすすめ）
2. 左メニュー **SQL Editor** → `supabase/schema.sql` の中身を貼って **Run**
3. **Authentication → Users → Add user → Create new user** で、自分のメールアドレスとパスワードを登録（「Auto Confirm User」にチェック）
4. **Authentication → Sign In / Providers** で **Allow new users to sign up をオフ**（他人が登録できないようにする）
5. **Project Settings → API Keys** で、次の2つを控える
   - Project URL（`https://xxxx.supabase.co`）
   - **anon** キー（Legacy API Keys のタブにある `eyJ...` で始まるもの）
   - ※ `service_role` / secret キーは絶対に使わない

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

4. **Deploy** → 表示されたURLを Safari で開いてログイン

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
| `store.py` | Supabase のログインと保存 |
| `supabase/schema.sql` | テーブル・行レベルセキュリティ・保存用関数 |
