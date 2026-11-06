# sphere-mcp

Sphere を Claude Code 等の MCP クライアントから使うためのローカル MCP サーバーです。
Sphere の設定画面で発行した個人用 API トークンで、自分の会話（グループルーム・DM）のメッセージを取得・検索・送信します。

- 動くのはあなたの PC 上だけです（MCP クライアントが起動し、終了時に止まります）。どこにもホストしません
- 通信先は Sphere の API（`/api/token/*`）だけです。https 以外は localhost にしか接続しません
- トークンは環境変数で受け取り、`Authorization` ヘッダに付けるだけです。保存せず、ログ（stderr）にも出しません

## 必要なもの

- Node.js 22 以上（Node 20 は 2026-04 に EOL）。2026-10-21 のセキュリティリリース以降の版（22.23.4 以上、または 24.22.1 以上）を使ってください
- Sphere の個人用 API トークン（`sph_` で始まる 47 文字）
- Sphere の API の URL。設定 > 「API トークン」に表示される Claude Code の登録コマンドの `SPHERE_API_URL=` の値です（Web 版の設定値 `API_ENDPOINT_BASE_URL` と同じ。末尾の `/api` は付けても付けなくても構いません）

## セットアップ

### 1. トークンを発行する

Sphere の設定 > 「API トークン」で発行します。

- **送信を許可する**: 普段は付けないことを勧めます（読み取り専用になり、送信・編集・削除・リアクションのツールが出ません）。AI に投稿させたいときだけ、送信可のトークンを別に発行してください
- **DM を含める**: AI に DM を読ませる必要がなければ外してください
- 有効期限: 30 日を勧めます。期限が切れたら発行し直します
- 平文は発行直後の 1 回しか表示されません。コピーしておいてください

### 2. Claude Code に登録する

トークンをコマンドラインに直接書くとシェルの履歴に残ります。次のブロックを丸ごとターミナル（macOS / Linux の bash・zsh）に貼り付けて実行し、`Sphere API token:` と表示されたらトークンを貼り付けて Enter を押してください（画面には出ません）。

```bash
{
  SPHERE_API_TOKEN=
  while [ -z "$SPHERE_API_TOKEN" ]; do
    printf 'Sphere API token: ' >&2
    read -rs SPHERE_API_TOKEN || break
    echo >&2
  done
  [ -n "$SPHERE_API_TOKEN" ] && claude mcp add sphere \
    -e SPHERE_API_URL=https://<Sphere の API のホスト> \
    -e SPHERE_API_TOKEN="$SPHERE_API_TOKEN" \
    -- npx -y --allow-git=root github:sphere-chat-team/sphere-mcp#6ea7c9bebe8f69b773b697123c8d1b9dde782c23
  unset SPHERE_API_TOKEN
}
```

- 全体を `{ ... }` で囲んでいるのは、bracketed paste の無いシェル（macOS 標準の bash 3.2 など）に複数行を貼っても、`read` が 2 行目以降をトークンとして読まないようにするためです。空のまま Enter を押すと聞き直します（空トークンで登録されるのを防ぐ）。`export` はせず、登録後に `unset` するので端末にトークンは残りません。PowerShell / fish では動きません

- 必ず `github:sphere-chat-team/sphere-mcp#<コミット SHA>` の形で指定してください（タグは付け替えられるため SHA で固定します。上の SHA は v0.1.0 のコミットです）。`npx sphere-mcp` のような npm の名前指定は使わないでください（同名の無関係なパッケージが動く可能性があります）
- `--allow-git=root` は npm 12 以降で必要です（git 参照のパッケージ取得が既定で禁止されたため）。許可するのは sphere-mcp 本体だけで、依存の git 参照は禁止のままです。npm 10 / 11 でもこのまま動きます
- `-s project` で登録しない（`.mcp.json` にトークンが平文で入り、リポジトリにコミットされ得ます）。チーム共有の `.mcp.json` に書く場合は値を `${SPHERE_API_TOKEN}` にして、各自の環境変数から展開してください

登録後、Claude Code で `/mcp` を開き `sphere` が接続済みになっていれば完了です。接続時に `[sphere-mcp] 接続しました: <API の URL> / <ユーザー名> / トークン「<名前>」（送信: 可, DM: 含む）` と stderr に出ます。

Claude Desktop など他の MCP クライアントでは、`command: npx`、`args: ["-y", "--allow-git=root", "github:sphere-chat-team/sphere-mcp#6ea7c9bebe8f69b773b697123c8d1b9dde782c23"]`、`env` に同じ 2 つを設定してください。

### 3. 動作確認

Claude Code で次のように聞きます。

> Sphere の会話一覧を見せて

`list_conversations` が呼ばれ、参加中の会話が返れば動いています。

### 環境変数

| 変数 | 内容 |
|---|---|
| `SPHERE_API_URL` | Sphere の API の URL（スキームとホスト。末尾の `/api` は任意。https 必須。`http://localhost:8000` など localhost だけ http 可） |
| `SPHERE_API_TOKEN` | 個人用 API トークン |
| `SPHERE_MCP_READ_ONLY` | `1` にすると、トークンに送信権限があっても送信系ツールを出さない |

## ツール

| ツール | 内容 | 必要な権限 |
|---|---|---|
| `whoami` | トークンの持ち主と権限 | 読み取り |
| `list_conversations` | 参加中の会話一覧（最新メッセージ順） | 読み取り |
| `get_conversation` | 会話の名前・概要・メンバー | 読み取り |
| `list_messages` | 最新 30 件（`limit` で 1〜30 に減らせる）を古い順（時系列）で返す。応答の `paging.next_from_id` を `from_id` に、`direction` に `<` を渡すと過去へさかのぼれる | 読み取り |
| `search_messages` | 会話内のメッセージを部分一致で検索（既定・最大 100 件、`limit` で減らせる）。`since` / `until` で期間を絞れる | 読み取り |
| `search_all_messages` | 参加している全会話をまたいだ部分一致検索。会話名と一致箇所の前後（`snippet`）だけを返すので、全文は `list_messages` で読む。`q`・`since`・`until`・`limit`（1〜100、既定 20）を指定できる | 読み取り |
| `send_message` | メッセージを投稿（返信も可） | 送信 |
| `edit_message` | 自分のメッセージを編集 | 送信 |
| `delete_message` | 自分のメッセージを削除 | 送信 |
| `add_reaction` / `remove_reaction` | 絵文字リアクションの追加・削除 | 送信 |

- 読み取りで既読は付きません（未読数は変わりません）
- `since` / `until` は `YYYY-MM-DD` または `YYYY-MM-DD HH:MM:SS`（JST）です。`until` が日付だけなら、その日の終わりまで含みます
- `list_messages` と `search_messages` の `fields` で返す項目を絞れます（`id`・`sender`・`sent_at`・`edited_at`・`content`・`deleted`・`reply_to`・`sent_via`・`language` から選びます。`id` は常に含みます。省略すると全項目）。本文が要らないときに外すと応答が小さくなります
- `search_all_messages` の応答は `{ notice, results: [{ conversation_id, conversation_type, conversation_name, message_id, user_id, user_name, sent_at, snippet }] }` です。`snippet` は一致箇所の前後だけで、切った側に `…` が付きます
- 本文は HTML エスケープを戻した状態（`&amp;` ではなく `&`）で返ります。応答の JSON は改行なしの 1 行です
- メッセージは `{ id, sender, sent_at, content, ... }` の形で返り、本文は `content` に入ります。日時は日本時間（JST）です
- `whoami` は毎回 Sphere に問い合わせるので、トークンを失効させるとその場でエラーになります

## コマンドラインから使う

MCP サーバーと同じ入口から、サブコマンドを付けて起動するとコマンドラインのツールとして動きます（引数なしなら今までどおり MCP サーバーです）。トークンと URL は MCP と同じ環境変数（`SPHERE_API_URL` / `SPHERE_API_TOKEN`）から読みます。

```bash
npx -y --allow-git=root github:sphere-chat-team/sphere-mcp#<コミット SHA> search "語" --since 2026-10-01
```

| サブコマンド | 内容 |
|---|---|
| `search <語> [--since 日付] [--until 日付] [--limit 件数] [--conversation <id>]` | 全会話を検索する。`--conversation` を付けるとその会話内だけを検索する（`--limit` は 1〜100） |
| `messages <conversation_id> [--limit 件数] [--before <message_id>]` | 会話のメッセージを古い順に表示する（既定は最新から、`--limit` は 1〜30）。`--before` でその ID より前を取得する |
| `conversations` | 参加している会話の一覧 |
| `help` | 使い方 |

- 出力は 1 行 1 件です。例: `2026-11-05 10:22:00  [会話名] 送信者: snippet  (conversation_id #message_id)`。本文の改行や制御文字は空白に置き換えます
- `--json` を付けると 1 行 1 件の JSON（JSON Lines）で出力します
- エラーは stderr に出て、終了コードは 1 です。トークンの値は出しません
- 毎回 `npx` で取得すると重いので、シェルの alias や関数で短くしておくと便利です

```bash
# ~/.zshrc や ~/.bashrc に追記（<コミット SHA> は登録コマンドと同じものにする）
sphere() {
  npx -y --allow-git=root "github:sphere-chat-team/sphere-mcp#<コミット SHA>" "$@"
}
# 使い方: sphere search "語" --since 2026-10-01
```

トークンは環境変数として設定済みのシェルで使ってください（コマンドラインには書かないでください）。

## MCP を使わずに API を直接呼ぶ

スクリプト（curl・Python など）から呼ぶときの仕様です。この MCP サーバーも同じ API を呼んでいます。

- URL は `<SPHERE_API_URL>/api/token/...` です。トークンが使えるのはこのパスだけで、Web 版が使う他の `/api/...` に送ると認証エラーになります
- `Authorization: Bearer <トークン>` と `Accept: application/json` を付けます
- 応答は `{ "status": "...", "message": "...", "data": ... }` の形で、中身は `data` に入ります。エラーのときは `errors`（項目ごとのメッセージキーの配列）が付くことがあります。ただし 429 と、パスの形式が違うときの 404 は `{ "message": "..." }` だけです
- 日時は日本時間（JST、`YYYY-MM-DD HH:MM:SS`）です。`GET /api/token/me` のトークンの日時だけは ISO 8601（`+09:00` 付き）です。読み取りで既読は付きません

```bash
# トークンはコマンドに直接書かず、read -rs SPHERE_API_TOKEN などで変数に入れる（シェルの履歴に残さないため）
curl -s -H "Authorization: Bearer $SPHERE_API_TOKEN" -H "Accept: application/json" \
  "$SPHERE_API_URL/api/token/conversations"
```

| メソッドとパス | 内容 | 必要な権限 |
|---|---|---|
| `GET /api/token/me` | トークンの持ち主と権限（`can_write`・`include_dm`・有効期限） | 読み取り |
| `GET /api/token/conversations` | 参加中の会話一覧（グループルームと DM、最新メッセージ順）。DM を含めないトークンでは DM は出ません | 読み取り |
| `GET /api/token/conversations/{id}` | 会話の名前・概要・メンバー | 読み取り |
| `GET /api/token/conversations/{id}/messages` | 最新 30 件を古い順（時系列）で返す。さかのぼり方・追加パラメータは下記 | 読み取り |
| `GET /api/token/conversations/{id}/messages/search?q=<検索語>` | 会話内の部分一致検索（新しい順、既定・最大 100 件）。`q` は 255 文字まで。本文と、自分の表示言語への翻訳文に一致します。削除済みは出ず、結果に `edited_at` は含まれません。FREE プランの組織は直近 30 日分だけが対象です。追加パラメータは下記 | 読み取り |
| `GET /api/token/messages/search?q=<検索語>` | 参加している全会話（DM を含めないトークンでは DM を除く）をまたいだ部分一致検索（新しい順）。追加パラメータは下記 | 読み取り |
| `POST /api/token/conversations/{id}/messages` | 送信。`{ "message_text": "...", "reply_message_id": 123 }`（返信先は省略可。本文は 5000 文字まで） | 送信 |
| `PATCH /api/token/conversations/{id}/messages/{message_id}` | 自分のメッセージを編集。`{ "message_text": "..." }` | 送信 |
| `DELETE /api/token/conversations/{id}/messages/{message_id}` | 自分のメッセージを削除 | 送信 |
| `POST` / `DELETE /api/token/conversations/{id}/messages/{message_id}/reactions` | リアクションの追加・削除。`{ "selected_stamp": "👍" }` | 送信 |

### メッセージの取得とさかのぼり方

- クエリは `from_id`（この ID を基準にする）、`direction`（`<` で古い方向、`>` で新しい方向。`<=` / `>=` も可）、`loaded_by`（この日時より前を取得する。`from_id` を指定したときは無視される）です
- 古い方へ読むには、返ってきたメッセージの最小の `id` を `from_id` に、`direction` に `<` を指定して呼び直します
- グループルームでは、メッセージのほかにフィード行（`type` が `feed`、`id` は 0）が混ざります。読み飛ばしてください。フィード行しか返らなかったときは、その中で最も古い `created_at` を `loaded_by` に指定して続けます
- メッセージの主な項目は `id`、`user_id`（送信者）、`user_name`、`message_text`、`created_at`、`edited_at`、`reply_message_id`、`quoted_text`、`sent_via`（0: アプリ、1: API トークン）です。`sub_type` が `deleted_message`、または `status` が 0 以外の行は削除済みです
- `message_text` は HTML エスケープされた状態で返ります（`&amp;` `&lt;` `&#039;` など）。プレーンテキストとして使うときはデコードしてください

### 追加パラメータ（すべて任意）

- `GET /api/token/conversations/{id}/messages`: `limit`（1〜30。`direction` が `<` / `<=` / 指定なしのときは新しい方から `limit` 件、`>` / `>=` のときは古い方から `limit` 件。返る順序はどちらも古い順）、`unescape`（`1` で本文の HTML エスケープを戻して返す）、`fields`（返す項目の絞り込み。API を直接使う人向け）
- `GET /api/token/conversations/{id}/messages/search`: `since` / `until`（`YYYY-MM-DD` または `YYYY-MM-DD HH:MM:SS`、JST。`until` が日付だけならその日の終わりまで含む）、`limit`（1〜100、既定 100）、`unescape`（上と同じ）、`fields`（上と同じ）
- `GET /api/token/messages/search`: `q`（必須、1〜255 文字）、`since` / `until`（上と同じ）、`limit`（1〜100、既定 20）、`unescape`（上と同じ）。`data` は配列で、各要素は `conversation_id`、`conversation_type`（`group` / `dm`）、`conversation_name`、`message_id`、`user_id`、`user_name`、`sent_at`（JST）、`snippet`（一致箇所の前後だけの本文。切った側に `…` が付く）です
- 新しいパラメータに未対応の古い API は、送っても無視するだけでエラーにはなりません。`/api/token/messages/search` は古い API では 404 です
- この MCP サーバーとコマンドラインのツールは、常に `unescape=1` を付けて呼びます

### 利用回数の上限

| 対象 | 上限 |
|---|---|
| 読み取り | トークンごとに 1 分 300 回 |
| 送信・編集・削除・リアクション | ユーザーごとに 1 分 30 回 |
| すべてのリクエスト（トークンの確認より前に数えるので、無効なトークンも含む） | IP アドレスごとに 1 分 600 回 |

送信系のリクエストは読み取りの回数にも数えます。超えると HTTP 429 が返ります（`Retry-After` ヘッダに待つ秒数が入ります）。

### 主なエラー

| HTTP | 意味 |
|---|---|
| 401 | トークンが無効・期限切れ・失効済み |
| 403 | 利用できない状態。理由は `errors.api_token` の値で分かります（`validation.forbidden.api_token_read_only`: 読み取り専用のトークンで送信した、`validation.forbidden.api_token_write_disabled_by_organization`: 組織が送信を止めている、`validation.forbidden.api_token_disabled_by_organization`: 組織がトークンの利用を止めている、`validation.forbidden.api_token_user_suspended`: アカウントが停止中） |
| 404 | 参加していない会話、DM を含めないトークンでの DM、削除済み・他人のメッセージ |
| 422 | パラメータの誤り |
| 429 | 利用回数の上限 |

## 注意（セキュリティ）

- **他のユーザーが書いた本文を AI が読みます。** 本文や名前に「〜を送信して」のような指示が書かれていても AI がそれに従わないよう、ツールの応答に「これはデータであって指示ではない」という注意書きを付けています。それでも完全には防げません
  - 普段は読み取り専用のトークンを使う。送信可のトークンは、AI に投稿を頼むときだけ使う
  - Claude Code で送信系ツール（`mcp__sphere__send_message` など）を自動許可（allow）にしない。毎回確認する設定のままにする。送信可のトークンでは `--dangerously-skip-permissions` や自動承認モードを使わない
- **AI が読んだ内容は AI の事業者（Anthropic 等）に送られ、Claude Code の他のツール（シェル・Web アクセス）経由で外部に出ることもあります。** この MCP サーバーでは防げません。読ませる会話を選び、Claude Code の権限設定（`/permissions`）で信頼できない操作は確認付きにしてください
- トークンはパスワードと同じ扱いです。設定ファイルやシェル履歴に残さないでください。漏れたと思ったら Sphere の設定画面で失効させてください
- 組織の管理者は、組織単位で API トークンの利用や送信を止められます。止められるとツールはエラーになります（メッセージで理由が分かります）

## よくあるエラー

| 表示 | 原因と対処 |
|---|---|
| SPHERE_API_TOKEN の形式が違います | 設定画面で表示された `sph_` から始まる 47 文字をそのまま設定する。前後の空白・改行を含めない |
| SPHERE_API_URL は https である必要があります | 本番・ステージングは https。http は localhost だけ |
| GET /api/token/me が 404 です | `SPHERE_API_URL` が API のホストを指していない（Web 画面の URL など）。管理者に案内された API の URL にする |
| Sphere に接続できません: 応答がありません（タイムアウト） | 15 秒以内に応答がない。URL とネットワーク（VPN 等）を確認 |
| トークンが無効か、期限切れ・失効済みです | 新しいトークンを発行し、`SPHERE_API_TOKEN` を更新して Claude Code を再起動 |
| このトークンは読み取り専用で… | 「送信を許可する」を付けたトークンを発行 |
| 組織の設定で API トークンの利用が無効化 / 送信が禁止 | 組織の管理者に確認 |
| 会話またはメッセージが見つかりません | 自分がメンバーでない会話、DM を含めないトークンでの DM、削除済み・他人のメッセージ |
| レート制限に達しました | 読み取り 300 回/分（トークン単位）、送信 30 回/分（ユーザー単位）。1 分待つ |

## 開発

```bash
npm ci --ignore-scripts
npm run typecheck
npm run compile    # dist/ を作り直す。dist はコミットする（npx github: で install script なしに動かすため）
npm test           # ビルド済みの dist を stdio で起動するテストを含む
```

lint は TypeScript の型検査（`npm run typecheck`）で代えています（ESLint は入れていません）。
ビルドのスクリプト名を `build` にしていないのは、npm が git 依存の `build` / `prepare` を見つけると devDependencies まで入れてビルドを走らせようとするためです。

ローカルの Sphere（`http://localhost:8000`）に対して動かすには、`SPHERE_API_URL=http://localhost:8000` を指定します。

- `src/config.ts`: 環境変数の検証（トークンの形式、https の強制）
- `src/client.ts`: API クライアントとエラー文言
- `src/tools.ts`: ツール定義。送信系はトークンに送信権限があるときだけ登録
- `src/format.ts`: API の行をツール応答の形に整える
- `src/index.ts`: 起動。引数がなければ `GET /api/token/me` でトークンを確認してから stdio で待ち受ける（MCP サーバー）。引数があればコマンドラインのツールとして動く
- `src/cli.ts`: コマンドラインのツール（`search` / `messages` / `conversations` / `help`）。`bin` は `sphere-mcp` 1 つのままにしています（2 つにすると npx が実行するものを決められず、登録済みのコマンドが壊れるため）

依存は `npm-shrinkwrap.json` で固定しています（`github:` から install するときにも効きます）。更新するときは `npm install` のあと `npm shrinkwrap` で作り直してください。

PR を出す前に `npm run check-dist` が通ること（dist がソースと一致し、未コミットの dist が無いこと）を確認してください。CI でも検査します。リリースは `src/version.ts` と `package.json` の version を上げ、`v<version>` のタグを打ち、README と Sphere の設定画面のコマンド例のコミット SHA を更新します。
